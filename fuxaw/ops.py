"""CLI ve web arayüzünün ortak işlemleri: durum, fark, pull, publish (yerel test FUXA'sına), export (hedef makine için klasöre), tag tablosu.

Her işlem ilerleme mesajlarını `log` ile verir (CLI ekrana basar, arayüz toplar) ve sonucu
{"rc": çıkış kodu, ...} sözlüğü olarak döndürür. Çıkış kodları: 0 tamam, 1 hata, 2 durduruldu,
3 gönderim yarıda kaldı / doğrulama tutmadı.
"""
import datetime
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


# ---------------------------------------------------------------- hedef makine için klasöre çıkarma
def export(prj, out_dir=None, no_lint=False, log=_nolog):
    """src/'den hedef makineye taşınacak klasörü üret: <out>/<ad>/<ad>.json + README.md.

    Ağ üzerinden hiçbir yere gönderilmez. Varsayılan çıktı: <proje>/publish/.
    """
    items = prj.read_items()
    found = lintmod.lint(items)
    errors = [f for f in found if f[0] == lintmod.ERROR]
    if found:
        log("Lint:")
        print_lint(found, log)
    if errors and not no_lint:
        log("Lint hataları var, export yapılmadı (bilerek çıkarmak için --no-lint).")
        return {"rc": 2, "lint": [list(f) for f in found], "dir": None, "files": []}

    out = os.path.join(os.path.abspath(out_dir or os.path.join(prj.root, "publish")), store.safe_name(prj.name))
    os.makedirs(out, exist_ok=True)
    fname = f"{store.safe_name(prj.name)}.json"
    prj_path = os.path.join(out, fname)
    with open(prj_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(model.join_project(items), indent=2, ensure_ascii=False) + "\n")
    readme = os.path.join(out, "README.md")
    with open(readme, "w", encoding="utf-8", newline="\n") as f:
        f.write(_export_readme(prj, items, fname, found))
    log(f"Export: {out}")
    log(f"  {fname}  (tam proje)")
    log("  README.md  (hedef makinede nereye/nasıl koyulacağı)")
    return {"rc": 0, "lint": [list(f) for f in found], "dir": out, "files": [prj_path, readme]}


def _export_readme(prj, items, fname, found):
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    meta = items.get(model.META, {})
    devs = [v for k, v in sorted(items.items()) if model.kind_of(k) == "device"]
    views = sorted(v.get("name", "") for k, v in items.items() if model.kind_of(k) == "view")
    scripts = sorted(v.get("name", "") for k, v in items.items() if model.kind_of(k) == "script")
    warns = [f for f in found if f[0] != lintmod.ERROR]
    lines = [
        f"# {prj.name} – FUXA projesi (hedef makine için)",
        "",
        f"- Üretildi: {now} (`fuxaw export`)",
        f"- Kaynak: `{prj.root}`",
        f"- FUXA sürümü (projede kayıtlı): {meta.get('version', '?')}",
        f"- Lint: {'temiz' if not found else f'{len(warns)} uyarı, hata yok'}",
        "",
        "## Dosyalar",
        "",
        f"- `{fname}`: tam proje (cihazlar, tag'ler, ekranlar, script'ler). FUXA editöründe *Open Project* ile açılır.",
        "",
        "## Hedef makinede nereye koyulur",
        "",
        "FUXA projeyi kendi veritabanında tutar; bu dosya FUXA'nın kurulum veya `_appdata` klasörüne **kopyalanmaz**,",
        "editörden içeri alınır.",
        "",
        f"1. Bu klasörü hedef makineye kopyala, ör. `C:\\fuxa_publish\\{store.safe_name(prj.name)}\\`.",
        "2. Hedef makinede FUXA editörünü aç: `http://127.0.0.1:1881/editor` (port farklıysa onu yaz).",
        "3. **Önce mevcut projeyi yedekle:** sol üst ☰ menü → *Save Project As...* → inen JSON'u sakla.",
        f"4. ☰ menü → *Open Project* (Türkçe arayüzde *Aç*) → `{fname}` dosyasını seç. Proje hemen FUXA sunucusuna kaydedilir.",
        "5. Açık runtime sayfalarını (`/home`) yenile.",
        "",
        "Geri almak için 3. adımdaki yedeği aynı yolla (*Open Project*) aç.",
        "",
        "## Kontrol et",
        "",
        "Cihaz bağlantı ayarları dosyada nasılsa hedefe öyle gider; hedefteki PLC'ye uyduğunu kontrol et:",
        "",
        "| Cihaz | Tip | Tag sayısı |",
        "| ----- | --- | ---------- |",
    ]
    lines += [f"| {d.get('name', '')} | {d.get('type', '')} | {len(d.get('tags') or {})} |" for d in devs]
    lines += ["", f"Ekranlar: {', '.join(views) or '-'}", "", f"Script'ler: {', '.join(scripts) or '-'}", ""]
    if warns:
        lines += ["## Lint uyarıları", ""] + [f"- {w}: {m}" for _l, w, m in warns] + [""]
    return "\n".join(lines)


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
