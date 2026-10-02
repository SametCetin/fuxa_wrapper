"""fuxaw – FUXA proje wrapper'ı (komut satırı).

  fuxaw status              yerel / hedef / son senkron karşılaştırması
  fuxaw diff [filtre]       değişen öğelerin JSON farkı
  fuxaw pull                hedefteki değişiklikleri src/'ye al
  fuxaw publish             yerel değişiklikleri hedefe gönder (yedek + doğrulama)
  fuxaw lint                bilinen FUXA tuzaklarını kontrol et
  fuxaw build               src/'den import edilebilir proje JSON'unu üret
  fuxaw backup              hedefte yedek al
  fuxaw init                yeni proje klasörü oluştur
"""
import argparse
import difflib
import json
import os
import sys

from . import lint as lintmod
from . import model, store, sync
from .target import Target, TargetError

MARK = {sync.LOCAL: "[publish]", sync.TARGET: "[pull]   ", sync.CONFLICT: "[ÇAKIŞMA]", sync.UNKNOWN: "[farklı] "}


def out(*a):
    print(*a, flush=True)


def load_project(args):
    return store.Project(store.find_project(explicit=args.project))


def open_target(prj):
    return Target(prj.config, local_backup_dir=prj.local_backup_dir(), log=out)


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


def print_entries(entries, show_same=False):
    shown = 0
    for e in entries:
        if e.state == sync.SAME and not show_same:
            continue
        side = "target" if e.state == sync.TARGET else "local"
        how = e.change(side) if e.state != sync.CONFLICT else "iki tarafta değişti"
        ro = "  [API ile yazılamaz]" if e.readonly else ""
        out(f"  {MARK.get(e.state, '         ')} {e.label:<40} {how}{detail(e)}{ro}")
        shown += 1
    return shown


def summary(entries):
    cnt = {}
    for e in entries:
        cnt[e.state] = cnt.get(e.state, 0) + 1
    return cnt


# ---------------------------------------------------------------- komutlar
def cmd_status(args):
    prj = load_project(args)
    local = prj.read_items()
    base = prj.read_base()
    st = prj.read_state()
    out(f"Proje : {prj.name}  ({prj.root})")
    out(f"Hedef : {store.target_label(prj.config)}   son senkron: {st.get('synced_at', 'yok')}")
    try:
        with open_target(prj) as t:
            tprj, _raw = t.get_project()
    except TargetError as ex:
        out(f"\n!! Hedefe ulaşılamadı: {ex}")
        if base is None:
            return 1
        out("Sadece yerel değişiklikler (son senkrona göre):")
        entries = sync.compare(local, base, base)
        if not print_entries(entries):
            out("  (yerel değişiklik yok)")
        return 1
    entries = sync.compare(local, model.split_project(tprj), base)
    c = summary(entries)
    out(f"\nYerel değişiklik: {c.get(sync.LOCAL, 0)} (publish)   Hedefte değişiklik: {c.get(sync.TARGET, 0)} (pull)"
        f"   Çakışma: {c.get(sync.CONFLICT, 0)}" + (f"   Taban yok/farklı: {c[sync.UNKNOWN]}" if c.get(sync.UNKNOWN) else ""))
    if not print_entries(entries, args.all):
        out("  Yerel proje ve hedef aynı.")
    if c.get(sync.TARGET) or c.get(sync.CONFLICT):
        out("\nNot: hedefte değişiklik var (FUXA editöründe kaydedilmiş olabilir). Önce 'fuxaw pull'.")
    return 0


def _pretty_lines(obj, full):
    if obj is None:
        return []
    lines = json.dumps(obj, indent=2, ensure_ascii=False, sort_keys=True).splitlines(keepends=True)
    if not full:
        lines = [(ln[:200] + " …\n") if len(ln) > 200 else ln for ln in lines]
    return lines


def cmd_diff(args):
    prj = load_project(args)
    local = prj.read_items()
    base = prj.read_base()
    if args.base:
        if base is None:
            out("Taban (son senkron) yok.")
            return 1
        other, other_name = base, "taban"
        entries = sync.compare(local, base, base)
    else:
        with open_target(prj) as t:
            tprj, _raw = t.get_project()
        other, other_name = model.split_project(tprj), "hedef"
        entries = sync.compare(local, other, base)
    flt = [f.lower() for f in args.filter]
    n = 0
    for e in entries:
        if e.state == sync.SAME:
            continue
        if flt and not any(f in e.label.lower() or f in e.key.lower() for f in flt):
            continue
        n += 1
        out(f"=== {e.label}  [{e.state}]{detail(e)}")
        a = _pretty_lines(other.get(e.key), args.full)
        b = _pretty_lines(local.get(e.key), args.full)
        sys.stdout.writelines(difflib.unified_diff(a, b, f"{other_name}: {e.label}", f"yerel: {e.label}", n=2))
        out()
    if not n:
        out("Fark yok.")
    return 0


def cmd_pull(args):
    prj = load_project(args)
    with open_target(prj) as t:
        tprj, _raw = t.get_project()
    titems = model.split_project(tprj)
    if not prj.has_src():
        prj.write_items(titems)
        prj.write_base(titems)
        paths = prj.write_exports(titems)
        out(f"İlk pull: {len(titems)} öğe src/'ye yazıldı. Export: {', '.join(os.path.basename(p) for p in paths)}")
        return 0
    local = prj.read_items()
    base = prj.read_base()
    entries = sync.compare(local, titems, base)
    new_local, new_base, pulled, blocked = sync.pull_merge(local, base, entries, force=args.force)
    if blocked:
        out("Pull durduruldu, iki tarafta da değişen öğeler var:")
        for e in blocked:
            out(f"  [ÇAKIŞMA] {e.label}{detail(e, 'target')}")
        out("'fuxaw diff' ile bak. Hedefteki hali almak için: fuxaw pull --force "
            "(yereldeki bu öğelerin değişiklikleri kaybolur; git'te kalır).")
        return 2
    for e in pulled:
        out(f"  [pull] {e.label:<40} {e.change('target')}{detail(e, 'target')}")
    if pulled:
        prj.write_items(new_local)
    prj.write_base(new_base)
    prj.write_exports(new_local)
    kept = [e for e in entries if e.state == sync.LOCAL]
    out(f"{len(pulled)} öğe alındı." + (f" {len(kept)} yerel değişiklik korundu (henüz publish edilmedi)." if kept else ""))
    return 0


def _print_lint(found):
    for lvl, where, msg in found:
        out(f"  {lvl:<5} {where}: {msg}")


def cmd_lint(args):
    prj = load_project(args)
    found = lintmod.lint(prj.read_items())
    if not found:
        out("Sorun bulunmadı.")
        return 0
    _print_lint(found)
    return 1 if any(f[0] == lintmod.ERROR for f in found) else 0


def cmd_publish(args):
    prj = load_project(args)
    local = prj.read_items()
    base = prj.read_base()

    found = lintmod.lint(local)
    errors = [f for f in found if f[0] == lintmod.ERROR]
    if found:
        out("Lint:")
        _print_lint(found)
    if errors and not args.no_lint:
        out("Lint hataları var, publish yapılmadı (bilerek göndermek için --no-lint).")
        return 2

    with open_target(prj) as t:
        tprj, raw = t.get_project()
        titems = model.split_project(tprj)
        entries = sync.compare(local, titems, base)
        plan, skipped, blocked = sync.publish_plan(entries, force=args.force, raw_target=tprj)

        if blocked:
            out("Publish durduruldu:")
            for e in blocked:
                why = "hedefte de değişmiş" if e.state == sync.CONFLICT else "son senkron kaydı yok"
                out(f"  [{e.state}] {e.label} ({why})")
            out("Önce 'fuxaw pull' (hedefteki değişiklikleri al) veya 'fuxaw diff' ile bak. "
                "Yereldeki hali zorla göndermek için --force.")
            return 2
        for e in skipped:
            out(f"  [atlandı] {e.label}: FUXA API bu kısmı yazamıyor (editörden yap)")
        if not plan:
            out("Gönderilecek değişiklik yok.")
            return 0

        out(f"Hedef {t.label} üzerinde yapılacaklar:")
        for cmd, e, _data in plan:
            out(f"  {cmd:<12} {e.label}{detail(e, 'local')}")
        others = [e for e in entries if e.state == sync.TARGET]
        if others:
            out(f"  (hedefte değişen {len(others)} öğeye dokunulmayacak; sonra 'fuxaw pull')")
        if any(cmd == "set-device" or cmd == "del-device" for cmd, _e, _d in plan):
            out("  ! set-device ADS sürücüsünü yeniden başlatır (bağlantı ~1 sn kopar).")
        if args.dry_run:
            out("--dry-run: hiçbir şey gönderilmedi.")
            return 0
        if not args.yes:
            if not sys.stdin.isatty():
                out("Onay alınamadı (etkileşimsiz). --yes ile çalıştır.")
                return 2
            if input("Devam? [e/H] ").strip().lower() not in ("e", "evet", "y", "yes"):
                out("İptal edildi.")
                return 1

        out(f"Yedek: {t.backup('fuxaw', raw)}")
        done = []
        for cmd, e, data in plan:
            try:
                t.project_data(cmd, data)
            except TargetError as ex:
                out(f"!! {cmd} {e.label} başarısız: {ex}")
                out(f"   Gönderilenler: {', '.join(x.label for x in done) or 'yok'}. 'fuxaw status' ile kontrol et.")
                return 3
            done.append(e)
            out(f"  ok  {cmd:<12} {e.label}")

        # Doğrulama: hedefi yeniden oku, gönderilen her öğe yerel ile aynı mı?
        tprj2, _ = t.get_project()
    titems2 = model.split_project(tprj2)
    bad = [e for e in done if model.digest(titems2.get(e.key)) != model.digest(local.get(e.key))]
    new_base = dict(base or {})
    for e in sync.compare(local, titems2, base):
        if e.state == sync.SAME:
            sync._set(new_base, e.key, e.target)
    prj.write_base(new_base)
    prj.write_exports(local)
    if bad:
        out("!! Doğrulama: şu öğeler hedefte yerelden farklı görünüyor: " + ", ".join(e.label for e in bad))
        return 3
    out(f"Publish tamam, {len(done)} öğe doğrulandı. Açık runtime/editör sayfalarını yenile "
        f"(eski haliyle açık bir editör kaydederse bu değişiklikler ezilir).")
    return 0


def cmd_build(args):
    prj = load_project(args)
    paths = prj.write_exports(prj.read_items())
    for p in paths:
        out(f"yazıldı: {p}")
    return 0


def cmd_backup(args):
    prj = load_project(args)
    with open_target(prj) as t:
        out(f"Yedek: {t.backup(args.topic)}")
    return 0


def cmd_init(args):
    root = os.path.abspath(args.dir)
    os.makedirs(root, exist_ok=True)
    if args.url:
        target = {"url": args.url}
    else:
        target = {"ssh": args.ssh, "port": args.port, "local_port": args.local_port}
        if args.backup_dir:
            target["backup_dir"] = args.backup_dir
    path = store.create_config(root, args.name or os.path.basename(root), target)
    out(f"oluşturuldu: {path}")
    if args.from_file:
        # Hedefe ulaşmadan, hedefin bilinen son hali (ör. eski GET çıktısı) ile başla
        with open(args.from_file, encoding="utf-8-sig") as f:
            items = model.split_project(json.load(f))
        prj = store.Project(root)
        prj.write_items(items)
        prj.write_base(items)
        prj.write_exports(items)
        out(f"{len(items)} öğe {args.from_file} dosyasından alındı (taban = bu dosya). "
            f"Hedefe ulaşınca 'fuxaw status' ile kontrol et.")
        return 0
    if args.no_pull:
        return 0
    args.project = root
    args.force = False
    return cmd_pull(args)


def main(argv=None):
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass
    ap = argparse.ArgumentParser(prog="fuxaw", description="FUXA proje wrapper'ı: yerel proje <-> hedef FUXA")
    ap.add_argument("-p", "--project", help="proje klasörü (fuxaw.json); verilmezse aranır")
    sp = ap.add_subparsers(dest="cmd", required=True)

    p = sp.add_parser("status", help="yerel / hedef karşılaştırması")
    p.add_argument("-a", "--all", action="store_true", help="aynı olanları da listele")
    p.set_defaults(fn=cmd_status)

    p = sp.add_parser("diff", help="değişen öğelerin farkı")
    p.add_argument("filter", nargs="*", help="öğe adı/türü filtresi (ör. MainView, device)")
    p.add_argument("--base", action="store_true", help="hedef yerine son senkrona göre (çevrimdışı)")
    p.add_argument("--full", action="store_true", help="uzun satırları kesme")
    p.set_defaults(fn=cmd_diff)

    p = sp.add_parser("pull", help="hedefteki değişiklikleri al")
    p.add_argument("--force", action="store_true", help="çakışmada hedefteki hali al")
    p.set_defaults(fn=cmd_pull)

    p = sp.add_parser("publish", help="yerel değişiklikleri hedefe gönder")
    p.add_argument("-n", "--dry-run", action="store_true", help="sadece planı göster")
    p.add_argument("-y", "--yes", action="store_true", help="onay sorma")
    p.add_argument("--force", action="store_true", help="çakışmada yereldeki hali gönder")
    p.add_argument("--no-lint", action="store_true", help="lint hatalarına rağmen gönder")
    p.set_defaults(fn=cmd_publish)

    sp.add_parser("lint", help="bilinen tuzakları kontrol et").set_defaults(fn=cmd_lint)
    sp.add_parser("build", help="src/'den export JSON'larını üret").set_defaults(fn=cmd_build)

    p = sp.add_parser("backup", help="hedefte yedek al")
    p.add_argument("--topic", default="manual")
    p.set_defaults(fn=cmd_backup)

    p = sp.add_parser("init", help="yeni proje klasörü")
    p.add_argument("dir")
    p.add_argument("--name")
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--ssh", help="SSH alias (ör. hypervm)")
    g.add_argument("--url", help="doğrudan FUXA adresi (ör. http://127.0.0.1:1881)")
    p.add_argument("--port", type=int, default=1881)
    p.add_argument("--local-port", type=int, default=11881)
    p.add_argument("--backup-dir", help="hedef makinede yedek klasörü")
    p.add_argument("--no-pull", action="store_true")
    p.add_argument("--from-file", help="pull yerine bu proje JSON'undan başla (hedef kapalıyken)")
    p.set_defaults(fn=cmd_init)

    args = ap.parse_args(argv)
    try:
        return args.fn(args) or 0
    except (store.ProjectError, TargetError) as ex:
        out(f"Hata: {ex}")
        return 1
    except KeyboardInterrupt:
        return 130
