"""fuxaw – FUXA proje wrapper'ı (komut satırı).

  fuxaw status              yerel / hedef / son senkron karşılaştırması
  fuxaw diff [filtre]       değişen öğelerin JSON farkı
  fuxaw pull                hedefteki değişiklikleri src/'ye al
  fuxaw publish             yerel değişiklikleri hedefe gönder (yedek + doğrulama)
  fuxaw lint                bilinen FUXA tuzaklarını kontrol et
  fuxaw build               src/'den import edilebilir proje JSON'unu üret
  fuxaw backup              hedefte yedek al
  fuxaw init                yeni proje klasörü oluştur
  fuxaw designer            yerel FUXA editörü (eksik bileşenleri kurar, başlatır)
  fuxaw ui                  web arayüzü (proje durumu, pull/publish, tag tablosu, designer)
"""
import argparse
import json
import os
import sys

from . import lint as lintmod
from . import designer, model, ops, store, sync
from .target import TargetError

MARK = {sync.LOCAL: "[publish]", sync.TARGET: "[pull]   ", sync.CONFLICT: "[ÇAKIŞMA]", sync.UNKNOWN: "[farklı] "}


def out(*a):
    print(*a, flush=True)


def load_project(args):
    return store.Project(store.find_project(explicit=args.project))


def print_entries(entries, show_same=False):
    shown = 0
    for e in entries:
        if e.state == sync.SAME and not show_same:
            continue
        side = "target" if e.state == sync.TARGET else "local"
        how = e.change(side) if e.state != sync.CONFLICT else "iki tarafta değişti"
        ro = "  [API ile yazılamaz]" if e.readonly else ""
        out(f"  {MARK.get(e.state, '         ')} {e.label:<40} {how}{ops.detail(e)}{ro}")
        shown += 1
    return shown


# ---------------------------------------------------------------- komutlar
def cmd_status(args):
    prj = load_project(args)
    st = prj.read_state()
    out(f"Proje : {prj.name}  ({prj.root})")
    out(f"Hedef : {store.target_label(prj.config)}   son senkron: {st.get('synced_at', 'yok')}")
    res = ops.status(prj)
    entries = res["entries"]
    if not res["reachable"]:
        out(f"\n!! Hedefe ulaşılamadı: {res['error']}")
        if not res["has_base"]:
            return 1
        out("Sadece yerel değişiklikler (son senkrona göre):")
        if not print_entries(entries):
            out("  (yerel değişiklik yok)")
        return 1
    c = res["counts"]
    out(f"\nYerel değişiklik: {c.get(sync.LOCAL, 0)} (publish)   Hedefte değişiklik: {c.get(sync.TARGET, 0)} (pull)"
        f"   Çakışma: {c.get(sync.CONFLICT, 0)}" + (f"   Taban yok/farklı: {c[sync.UNKNOWN]}" if c.get(sync.UNKNOWN) else ""))
    if not print_entries(entries, args.all):
        out("  Yerel proje ve hedef aynı.")
    if c.get(sync.TARGET) or c.get(sync.CONFLICT):
        out("\nNot: hedefte değişiklik var (FUXA editöründe kaydedilmiş olabilir). Önce 'fuxaw pull'.")
    return 0


def cmd_diff(args):
    prj = load_project(args)
    if args.base and prj.read_base() is None:
        out("Taban (son senkron) yok.")
        return 1
    result = ops.diff(prj, args.filter, use_base=args.base, full=args.full)
    for e, lines in result:
        out(f"=== {e.label}  [{e.state}]{ops.detail(e)}")
        sys.stdout.writelines(lines)
        out()
    if not result:
        out("Fark yok.")
    return 0


def cmd_pull(args):
    return ops.pull(load_project(args), force=args.force, log=out)["rc"]


def cmd_lint(args):
    prj = load_project(args)
    found = lintmod.lint(prj.read_items())
    if not found:
        out("Sorun bulunmadı.")
        return 0
    ops.print_lint(found, out)
    return 1 if any(f[0] == lintmod.ERROR for f in found) else 0


def cmd_publish(args):
    def confirm():
        if args.yes:
            return True
        if not sys.stdin.isatty():
            out("Onay alınamadı (etkileşimsiz). --yes ile çalıştır.")
            return 2
        if input("Devam? [e/H] ").strip().lower() not in ("e", "evet", "y", "yes"):
            out("İptal edildi.")
            return 1
        return True

    return ops.publish(load_project(args), dry_run=args.dry_run, force=args.force,
                       no_lint=args.no_lint, confirm=confirm, log=out)["rc"]


def cmd_build(args):
    prj = load_project(args)
    paths = prj.write_exports(prj.read_items())
    for p in paths:
        out(f"yazıldı: {p}")
    return 0


def cmd_backup(args):
    prj = load_project(args)
    with ops.open_target(prj, out) as t:
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


def cmd_designer(args):
    if args.action == "stop":
        designer.stop(log=out)
    elif args.action == "status":
        designer.status(log=out)
    else:
        designer.start(port=args.port, version=args.fuxa_version, assume_yes=args.yes,
                       open_browser=not args.no_browser, log=out)
    return 0


def cmd_ui(args):
    from . import web
    roots = args.root or []
    if not roots:
        try:
            # Proje klasöründeysek onun üstü (proje reposu), değilsek bulunduğumuz klasör
            roots = [os.path.dirname(store.find_project(explicit=args.project))]
        except store.ProjectError:
            roots = [os.getcwd()]
    return web.serve(roots, port=args.port, open_browser=not args.no_browser, log=out)


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
    g.add_argument("--ssh", help="SSH alias (uzak makinedeki FUXA için)")
    g.add_argument("--url", help="doğrudan FUXA adresi (ör. http://127.0.0.1:1881)")
    p.add_argument("--port", type=int, default=1881)
    p.add_argument("--local-port", type=int, default=11881)
    p.add_argument("--backup-dir", help="hedef makinede yedek klasörü")
    p.add_argument("--no-pull", action="store_true")
    p.add_argument("--from-file", help="pull yerine bu proje JSON'undan başla (hedef kapalıyken)")
    p.set_defaults(fn=cmd_init)

    p = sp.add_parser("designer", help="yerel FUXA editörü: bileşen kontrolü/kurulum, başlat/durdur")
    p.add_argument("action", nargs="?", default="start", choices=["start", "stop", "status"])
    p.add_argument("--port", type=int, default=1881)
    p.add_argument("--fuxa-version", default=designer.DEFAULT_FUXA_VERSION)
    p.add_argument("-y", "--yes", action="store_true", help="kurulumlar için onay sorma")
    p.add_argument("--no-browser", action="store_true", help="tarayıcıyı açma")
    p.set_defaults(fn=cmd_designer)

    p = sp.add_parser("ui", help="web arayüzü")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--root", action="append", help="projelerin aranacağı klasör (birden fazla verilebilir)")
    p.add_argument("--no-browser", action="store_true", help="tarayıcıyı açma")
    p.set_defaults(fn=cmd_ui)

    args = ap.parse_args(argv)
    try:
        return args.fn(args) or 0
    except (store.ProjectError, TargetError, designer.DesignerError) as ex:
        out(f"Hata: {ex}")
        return 1
    except KeyboardInterrupt:
        return 130
