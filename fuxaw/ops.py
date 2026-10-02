"""CLI ve web arayüzünün ortak işlemleri: durum, fark, pull, publish, tag tablosu, yerel FUXA'ya yükleme.

Her işlem ilerleme mesajlarını `log` ile verir (CLI ekrana basar, arayüz toplar) ve sonucu
{"rc": çıkış kodu, ...} sözlüğü olarak döndürür. Çıkış kodları: 0 tamam, 1 hata, 2 durduruldu,
3 gönderim yarıda kaldı / doğrulama tutmadı.
"""
import difflib
import json
import os
import re

from . import lint as lintmod
from . import model, store, sync
from .target import Target, TargetError


def _nolog(*_a):
    pass


def open_target(prj, log=_nolog):
    return Target(prj.config, local_backup_dir=prj.local_backup_dir(), log=log)


def detail(e, side=None):
    """Satır sonu açıklaması: cihazlarda tag değişiklik özeti."""
    if e.kind != "device":
        return ""
    if side is None:
        side = "target" if e.state == sync.TARGET else "local"
    new = e.target if side == "target" else e.local
    if e.state == sync.UNKNOWN or e.base is None:
        old = e.local if side == "target" else e.target
    else:
        old = e.base
    if old is None or new is None:
        return ""
    a, r, c, props = model.device_tag_changes(old, new)
    parts = []
    if a:
        parts.append("+" + ", +".join(a))
    if r:
        parts.append("-" + ", -".join(r))
    if c:
        parts.append("~" + ", ~".join(c))
    if props:
        parts.append("cihaz ayarları")
    return "  (" + "; ".join(parts) + ")" if parts else ""


def entry_info(e, side=None):
    """Arayüz için öğe özeti."""
    if side is None:
        side = "target" if e.state == sync.TARGET else "local"
    return {
        "key": e.key, "label": e.label, "kind": e.kind, "state": e.state,
        "change": e.change(side) if e.state not in (sync.CONFLICT, sync.SAME) else
                  ("iki tarafta değişti" if e.state == sync.CONFLICT else ""),
        "detail": detail(e, side).strip(" ()"), "readonly": e.readonly,
    }


def counts(entries):
    cnt = {}
    for e in entries:
        cnt[e.state] = cnt.get(e.state, 0) + 1
    return cnt


# ---------------------------------------------------------------- durum / fark
def status(prj):
    """Yerel / hedef / taban karşılaştırması. Hedefe ulaşılamazsa sadece yerel değişiklikler."""
    local = prj.read_items()
    base = prj.read_base()
    res = {"rc": 0, "reachable": True, "error": None, "has_base": base is not None}
    try:
        with open_target(prj) as t:
            tprj, _raw = t.get_project()
        res["entries"] = sync.compare(local, model.split_project(tprj), base)
    except TargetError as ex:
        res.update(rc=1, reachable=False, error=str(ex))
        res["entries"] = sync.compare(local, base, base) if base is not None else []
    res["counts"] = counts(res["entries"])
    return res


def _pretty_lines(obj, full):
    if obj is None:
        return []
    code = None
    if isinstance(obj, dict) and isinstance(obj.get("code"), str):
        # Script kodu JSON içinde tek satır olur; satır satır karşılaştırılsın
        code = obj["code"]
        obj = {k: v for k, v in obj.items() if k != "code"}
    lines = json.dumps(obj, indent=2, ensure_ascii=False, sort_keys=True).splitlines(keepends=True)
    if code is not None:
        lines.append("--- code ---\n")
        lines.extend(ln if ln.endswith("\n") else ln + "\n" for ln in code.splitlines())
    if not full:
        lines = [(ln[:200] + " …\n") if len(ln) > 200 else ln for ln in lines]
    return lines


def diff(prj, filters=(), use_base=False, full=False):
    """[(entry, unified diff satırları)] – değişen öğeler, filtreye uyanlar."""
    local = prj.read_items()
    base = prj.read_base()
    if use_base:
        if base is None:
            raise store.ProjectError("Taban (son senkron) yok.")
        other, other_name = base, "taban"
        entries = sync.compare(local, base, base)
    else:
        with open_target(prj) as t:
            tprj, _raw = t.get_project()
        other, other_name = model.split_project(tprj), "hedef"
        entries = sync.compare(local, other, base)
    flt = [f.lower() for f in filters]
    result = []
    for e in entries:
        if e.state == sync.SAME:
            continue
        if flt and not any(f in e.label.lower() or f in e.key.lower() for f in flt):
            continue
        a = _pretty_lines(other.get(e.key), full)
        b = _pretty_lines(local.get(e.key), full)
        result.append((e, list(difflib.unified_diff(a, b, f"{other_name}: {e.label}", f"yerel: {e.label}", n=2))))
    return result


# ---------------------------------------------------------------- pull
def pull(prj, force=False, log=_nolog):
    with open_target(prj, log) as t:
        tprj, _raw = t.get_project()
    titems = model.split_project(tprj)
    if not prj.has_src():
        prj.write_items(titems)
        prj.write_base(titems)
        paths = prj.write_exports(titems)
        log(f"İlk pull: {len(titems)} öğe src/'ye yazıldı. Export: {', '.join(os.path.basename(p) for p in paths)}")
        return {"rc": 0, "pulled": list(titems), "blocked": []}
    local = prj.read_items()
    base = prj.read_base()
    entries = sync.compare(local, titems, base)
    new_local, new_base, pulled, blocked = sync.pull_merge(local, base, entries, force=force)
    if blocked:
        log("Pull durduruldu, iki tarafta da değişen öğeler var:")
        for e in blocked:
            log(f"  [ÇAKIŞMA] {e.label}{detail(e, 'target')}")
        log("'fuxaw diff' ile bak. Hedefteki hali almak için: fuxaw pull --force "
            "(yereldeki bu öğelerin değişiklikleri kaybolur; git'te kalır).")
        return {"rc": 2, "pulled": [], "blocked": [e.label for e in blocked]}
    for e in pulled:
        log(f"  [pull] {e.label:<40} {e.change('target')}{detail(e, 'target')}")
    if pulled:
        prj.write_items(new_local)
    prj.write_base(new_base)
    prj.write_exports(new_local)
    kept = [e for e in entries if e.state == sync.LOCAL]
    log(f"{len(pulled)} öğe alındı." + (f" {len(kept)} yerel değişiklik korundu (henüz publish edilmedi)." if kept else ""))
    return {"rc": 0, "pulled": [e.label for e in pulled], "blocked": []}


# ---------------------------------------------------------------- publish
def print_lint(found, log):
    for lvl, where, msg in found:
        log(f"  {lvl:<5} {where}: {msg}")


def publish(prj, dry_run=False, force=False, no_lint=False, confirm=None, log=_nolog):
    """Yerel değişiklikleri hedefe gönder. confirm: plan gösterildikten sonra çağrılır, False dönerse iptal."""
    local = prj.read_items()
    base = prj.read_base()
    res = {"rc": 0, "plan": [], "done": [], "blocked": [], "skipped": [], "backup": None}

    found = lintmod.lint(local)
    res["lint"] = [list(f) for f in found]
    errors = [f for f in found if f[0] == lintmod.ERROR]
    if found:
        log("Lint:")
        print_lint(found, log)
    if errors and not no_lint:
        log("Lint hataları var, publish yapılmadı (bilerek göndermek için --no-lint).")
        return {**res, "rc": 2}

    with open_target(prj, log) as t:
        tprj, raw = t.get_project()
        titems = model.split_project(tprj)
        entries = sync.compare(local, titems, base)
        plan, skipped, blocked = sync.publish_plan(entries, force=force, raw_target=tprj)
        res["plan"] = [{"cmd": cmd, "label": e.label, "detail": detail(e, "local").strip(" ()")} for cmd, e, _d in plan]
        res["skipped"] = [e.label for e in skipped]

        if blocked:
            log("Publish durduruldu:")
            for e in blocked:
                why = "hedefte de değişmiş" if e.state == sync.CONFLICT else "son senkron kaydı yok"
                log(f"  [{e.state}] {e.label} ({why})")
            log("Önce 'fuxaw pull' (hedefteki değişiklikleri al) veya 'fuxaw diff' ile bak. "
                "Yereldeki hali zorla göndermek için --force.")
            return {**res, "rc": 2, "blocked": [e.label for e in blocked]}
        for e in skipped:
            log(f"  [atlandı] {e.label}: FUXA API bu kısmı yazamıyor (editörden yap)")
        if not plan:
            log("Gönderilecek değişiklik yok.")
            return res

        log(f"Hedef {t.label} üzerinde yapılacaklar:")
        for cmd, e, _data in plan:
            log(f"  {cmd:<12} {e.label}{detail(e, 'local')}")
        others = [e for e in entries if e.state == sync.TARGET]
        if others:
            log(f"  (hedefte değişen {len(others)} öğeye dokunulmayacak; sonra 'fuxaw pull')")
        if any(cmd == "set-device" or cmd == "del-device" for cmd, _e, _d in plan):
            log("  ! set-device ADS sürücüsünü yeniden başlatır (bağlantı ~1 sn kopar).")
        if dry_run:
            log("--dry-run: hiçbir şey gönderilmedi.")
            return res
        if confirm is not None:
            ok = confirm()
            if ok is not True:
                return {**res, "rc": ok if isinstance(ok, int) else 1}

        res["backup"] = t.backup("fuxaw", raw)
        log(f"Yedek: {res['backup']}")
        done = []
        for cmd, e, data in plan:
            try:
                t.project_data(cmd, data)
            except TargetError as ex:
                log(f"!! {cmd} {e.label} başarısız: {ex}")
                log(f"   Gönderilenler: {', '.join(x.label for x in done) or 'yok'}. 'fuxaw status' ile kontrol et.")
                return {**res, "rc": 3, "done": [x.label for x in done]}
            done.append(e)
            log(f"  ok  {cmd:<12} {e.label}")

        # Doğrulama: hedefi yeniden oku, gönderilen her öğe yerel ile aynı mı?
        tprj2, _ = t.get_project()
    res["done"] = [e.label for e in done]
    titems2 = model.split_project(tprj2)
    bad = [e for e in done if model.digest(titems2.get(e.key)) != model.digest(local.get(e.key))]
    new_base = dict(base or {})
    for e in sync.compare(local, titems2, base):
        if e.state == sync.SAME:
            sync._set(new_base, e.key, e.target)
    prj.write_base(new_base)
    prj.write_exports(local)
    if bad:
        log("!! Doğrulama: şu öğeler hedefte yerelden farklı görünüyor: " + ", ".join(e.label for e in bad))
        return {**res, "rc": 3, "bad": [e.label for e in bad]}
    log(f"Publish tamam, {len(done)} öğe doğrulandı. Açık runtime/editör sayfalarını yenile "
        f"(eski haliyle açık bir editör kaydederse bu değişiklikler ezilir).")
    return res


# ---------------------------------------------------------------- yerel FUXA'ya yükleme
def load_into(prj, url, backup_dir, log=_nolog):
    """Yerel src/'yi başka bir FUXA'ya (ör. yerel designer) olduğu gibi yükle.

    Projenin hedefi ve senkron tabanı değişmez. O FUXA'da yerelde olmayan öğeler silinir;
    önce onun yedeği backup_dir'e alınır.
    """
    local = prj.read_items()
    t = Target({"target": {"url": url}}, local_backup_dir=backup_dir, log=log)
    with t:
        tprj, raw = t.get_project()
        entries = sync.compare(local, model.split_project(tprj), None)
        plan, skipped, _blocked = sync.publish_plan(entries, force=True, raw_target=tprj)
        if not plan:
            log(f"{url} zaten yerel proje ile aynı.")
            return {"rc": 0, "done": []}
        log(f"Yedek: {t.backup('fuxaw_load', raw)}")
        done = []
        for cmd, e, data in plan:
            try:
                t.project_data(cmd, data)
            except TargetError as ex:
                log(f"!! {cmd} {e.label} başarısız: {ex}")
                return {"rc": 3, "done": done}
            done.append(e.label)
            log(f"  ok  {cmd:<12} {e.label}")
    for e in skipped:
        if e.local is not None:
            log(f"  [atlandı] {e.label}: FUXA API bu kısmı yazamıyor")
    log(f"{len(done)} öğe {url} adresine yüklendi. Editörü yenile.")
    return {"rc": 0, "done": done}


# ---------------------------------------------------------------- tag tablosu
_GET_TAG_ID = re.compile(r"""\$getTagId\(\s*(['"])(.*?)\1\s*(?:,\s*(['"])(.*?)\3)?\s*\)""")


def tag_table(items):
    """Tüm tag'ler + kullanıldıkları yerler (ekran öğeleri, event'ler, script'ler)."""
    rows, by_id = [], {}
    for key, dev in sorted(items.items(), key=lambda kv: model.label(*kv)):
        if model.kind_of(key) != "device":
            continue
        for tid, tag in sorted((dev.get("tags") or {}).items(), key=lambda kv: str(kv[1].get("name", ""))):
            row = {"id": tid, "name": tag.get("name", ""), "type": tag.get("type", ""),
                   "address": tag.get("address", ""), "device": dev.get("name", ""),
                   "device_type": dev.get("type", ""), "uses": []}
            rows.append(row)
            by_id[tid] = row
    by_name = {}
    for r in rows:
        by_name.setdefault(r["name"], []).append(r)
    for key, view in items.items():
        if model.kind_of(key) != "view":
            continue
        for gid, ga in (view.get("items") or {}).items():
            where = f"{view.get('name')} / {ga.get('name') or gid}"
            prop = ga.get("property") or {}
            if prop.get("variableId") in by_id:
                by_id[prop["variableId"]]["uses"].append({"where": where, "how": "gösterim/renk"})
            for ev in prop.get("events") or []:
                opts = ev.get("actoptions") or {}
                tid = (opts.get("variable") or {}).get("variableId") or opts.get("variableId")
                if tid in by_id:
                    by_id[tid]["uses"].append({"where": where,
                                               "how": f"{ev.get('type')} → {ev.get('action')} {ev.get('actparam', '')}".strip()})
    for key, sc in items.items():
        if model.kind_of(key) != "script":
            continue
        for m in _GET_TAG_ID.finditer(sc.get("code") or ""):
            for r in by_name.get(m.group(2), []):
                if m.group(4) in (None, r["device"]):
                    r["uses"].append({"where": f"script {sc.get('name')}", "how": "$getTagId"})
    return rows
