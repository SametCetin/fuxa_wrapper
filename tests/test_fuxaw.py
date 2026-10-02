"""Uçtan uca testler: sahte FUXA + gerçek proje kopyası (tests/fixtures/fuxa1_live.json).

Çalıştır:  python -m unittest discover -s tests -v   (repo kökünden)
"""
import contextlib
import copy
import io
import json
import os
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

from fuxaw import cli, lint, model  # noqa: E402
from mock_fuxa import MockFuxa  # noqa: E402

with open(os.path.join(HERE, "fixtures", "fuxa1_live.json"), encoding="utf-8") as f:
    LIVE = json.load(f)
# Export dosyasında tag value/timestamp yok; gerçek GET'teki gibi ekle
for _dev in LIVE["devices"].values():
    for _tag in (_dev.get("tags") or {}).values():
        _tag.setdefault("value", 0 if _tag.get("type") == "Number" else False)
        _tag.setdefault("timestamp", 0)

DEV = "d_31db3b81-3ebe4777"
VIEW = "v_147143a11-5510"


def run(*argv):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc = cli.main(list(argv))
    return rc, buf.getvalue()


class Base(unittest.TestCase):
    def setUp(self):
        self.mock = MockFuxa(LIVE)
        self.dir = tempfile.mkdtemp(prefix="fuxaw_")
        self.prj = os.path.join(self.dir, "p1")
        rc, o = run("init", self.prj, "--name", "p1", "--url", self.mock.url)
        self.assertEqual(rc, 0, o)

    def tearDown(self):
        self.mock.close()
        shutil.rmtree(self.dir, ignore_errors=True)

    def cli(self, *argv):
        return run("-p", self.prj, *argv)

    def src(self, *parts):
        return os.path.join(self.prj, "src", *parts)

    def edit_json(self, path, fn):
        with open(path, encoding="utf-8") as f:
            obj = json.load(f)
        fn(obj)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(obj, f, indent=2)


class TestModel(unittest.TestCase):
    def test_roundtrip(self):
        items = model.split_project(LIVE)
        again = model.split_project(model.join_project(items))
        self.assertEqual({k: model.digest(v) for k, v in items.items()},
                         {k: model.digest(v) for k, v in again.items()})

    def test_volatile_ignored(self):
        p2 = copy.deepcopy(LIVE)
        for t in p2["devices"][DEV]["tags"].values():
            t["value"], t["timestamp"] = 12345, 1
        a, b = model.split_project(LIVE), model.split_project(p2)
        self.assertEqual(model.digest(a[f"device:{DEV}"]), model.digest(b[f"device:{DEV}"]))

    def test_live_project_lints_clean(self):
        errs = [f for f in lint.lint(model.split_project(LIVE)) if f[0] == lint.ERROR]
        self.assertEqual(errs, [])


class TestFlow(Base):
    def test_init_writes_src_and_status_clean(self):
        self.assertTrue(os.path.isfile(self.src("devices", "tc3_ads.json")))
        self.assertTrue(os.path.isfile(self.src("views", "MainView.json")))
        self.assertTrue(os.path.isfile(self.src("scripts", "SimuHmiToggle.js")))
        self.assertTrue(os.path.isfile(os.path.join(self.prj, "p1_live.json")))
        rc, o = self.cli("status")
        self.assertIn("aynı", o)
        self.assertIn("Yerel değişiklik: 0", o)

    def test_publish_local_changes(self):
        # script kodunu değiştir, tag ekle, tag sil
        with open(self.src("scripts", "SimuHmiToggle.js"), "a", encoding="utf-8") as f:
            f.write("\n// yeni satir\n")

        def tags(dev):
            dev["tags"]["t_new"] = {"id": "t_new", "name": "NewTag", "type": "Boolean", "address": ".NewTag"}
            del dev["tags"]["t_2c4f4e40-ccdc4848"]  # AxisX_ActPos (VAL öğesine bağlı)
        self.edit_json(self.src("devices", "tc3_ads.json"), tags)

        rc, o = self.cli("status")
        self.assertIn("+NewTag", o)
        self.assertIn("-AxisX_ActPos", o)
        # AxisX_ActPos silindi -> output_1 kırık referans -> lint publish'i durdurur
        rc, o = self.cli("publish", "--yes")
        self.assertEqual(rc, 2, o)
        self.assertIn("bağlı tag yok", o)
        self.assertEqual(self.mock.calls, [])

        # tag'i geri koy, tekrar dene
        self.edit_json(self.src("devices", "tc3_ads.json"),
                       lambda d: d["tags"].__setitem__("t_2c4f4e40-ccdc4848",
                                                       LIVE["devices"][DEV]["tags"]["t_2c4f4e40-ccdc4848"]))
        rc, o = self.cli("publish", "--yes")
        self.assertEqual(rc, 0, o)
        self.assertEqual([c for c, _ in self.mock.calls], ["set-device", "set-script"])
        self.assertIn("NewTag", [t["name"] for t in self.mock.project["devices"][DEV]["tags"].values()])
        # value'lar korunmuş olmalı (with_volatile)
        self.assertIn("value", self.mock.project["devices"][DEV]["tags"]["t_229c5968-ab464eb1"])
        self.assertTrue(os.listdir(os.path.join(self.prj, ".fuxaw", "backups")))
        rc, o = self.cli("status")
        self.assertIn("Yerel değişiklik: 0", o)
        self.assertIn("Hedefte değişiklik: 0", o)

    def test_target_change_is_pulled_not_overwritten(self):
        # "editörde kaydedildi": hedefte ekran değişir
        v = next(v for v in self.mock.project["hmi"]["views"] if v["id"] == VIEW)
        v["profile"]["bkcolor"] = "#123456"
        # yerelde başka bir değişiklik
        self.edit_json(self.src("layout.json"), lambda l: l.__setitem__("autoresize", True))
        rc, o = self.cli("status")
        self.assertIn("[pull]", o)
        self.assertIn("[publish]", o)
        rc, o = self.cli("publish", "--yes")
        self.assertEqual(rc, 0, o)
        self.assertEqual([c for c, _ in self.mock.calls], ["layout"])  # ekrana dokunulmadı
        rc, o = self.cli("pull")
        self.assertEqual(rc, 0, o)
        with open(self.src("views", "MainView.json"), encoding="utf-8") as f:
            self.assertEqual(json.load(f)["profile"]["bkcolor"], "#123456")
        rc, o = self.cli("status")
        self.assertIn("Yerel proje ve hedef aynı", o)

    def test_conflict_blocks_both_ways(self):
        self.mock.project["scripts"][0]["code"] += "\n// editor\n"
        name = self.mock.project["scripts"][0]["name"]
        with open(self.src("scripts", name + ".js"), "a", encoding="utf-8") as f:
            f.write("\n// yerel\n")
        rc, o = self.cli("publish", "--yes")
        self.assertEqual(rc, 2)
        self.assertIn("çakışma", o)
        rc, o = self.cli("pull")
        self.assertEqual(rc, 2)
        rc, o = self.cli("pull", "--force")
        self.assertEqual(rc, 0, o)
        with open(self.src("scripts", name + ".js"), encoding="utf-8") as f:
            self.assertIn("// editor", f.read())
        self.assertEqual(self.mock.calls, [])

    def test_lint_bool_text(self):
        def bad(view):
            for ga in view["items"].values():
                for ev in (ga.get("property") or {}).get("events") or []:
                    if ev["type"] == "mouseup":
                        ev["actparam"] = "False"
        self.edit_json(self.src("views", "MainView.json"), bad)
        rc, o = self.cli("lint")
        self.assertEqual(rc, 1)
        self.assertIn("1 / 0 kullan", o)

    def test_add_and_delete_view(self):
        with open(self.src("views", "MainView.json"), encoding="utf-8") as f:
            v = json.load(f)
        v["id"], v["name"], v["items"] = "v_new", "Page2", {}
        with open(self.src("views", "Page2.json"), "w", encoding="utf-8") as f:
            json.dump(v, f)
        rc, o = self.cli("publish", "--yes")
        self.assertEqual(rc, 0, o)
        self.assertIn("Page2", [x["name"] for x in self.mock.project["hmi"]["views"]])
        os.remove(self.src("views", "Page2.json"))
        rc, o = self.cli("publish", "--yes")
        self.assertEqual(rc, 0, o)
        self.assertEqual(self.mock.calls[-1], ("del-view", "v_new"))

    def test_view_recreated_with_same_name(self):
        # Yerelde MainView yeni id ile yeniden oluşturuldu: eski ekran set-view'dan önce silinmeli,
        # yoksa FUXA aynı ad yüzünden yenisini kaydetmez.
        with open(self.src("views", "MainView.json"), encoding="utf-8") as f:
            v = json.load(f)
        v["id"] = "v_recreated"
        with open(self.src("views", "MainView.json"), "w", encoding="utf-8") as f:
            json.dump(v, f)
        rc, o = self.cli("publish", "--yes", "--force")
        self.assertEqual(rc, 0, o)
        self.assertEqual([(c, i) for c, i in self.mock.calls if c in ("set-view", "del-view")],
                         [("del-view", VIEW), ("set-view", "v_recreated")])
        self.assertEqual([x["id"] for x in self.mock.project["hmi"]["views"]], ["v_recreated"])

    def test_duplicate_view_name_is_lint_error(self):
        with open(self.src("views", "MainView.json"), encoding="utf-8") as f:
            v = json.load(f)
        v["id"] = "v_dup"
        with open(self.src("views", "MainView2.json"), "w", encoding="utf-8") as f:
            json.dump(v, f)
        rc, o = self.cli("publish", "--yes")
        self.assertEqual(rc, 2)
        self.assertIn("aynı adlı", o)

    def test_export_folder(self):
        out = os.path.join(self.dir, "out")
        rc, o = self.cli("export", "-o", out)
        self.assertEqual(rc, 0, o)
        with open(os.path.join(out, "p1", "p1.json"), encoding="utf-8") as f:
            exported = json.load(f)
        self.assertEqual({k: model.digest(v) for k, v in model.split_project(exported).items()},
                         {k: model.digest(v) for k, v in model.split_project(LIVE).items()})
        with open(os.path.join(out, "p1", "README.md"), encoding="utf-8") as f:
            readme = f.read()
        self.assertIn("Open Project", readme)
        self.assertIn("tc3_ads", readme)
        self.assertEqual(self.mock.calls, [])  # hedefe hiçbir şey gönderilmez

    def test_export_blocked_by_lint(self):
        self.edit_json(self.src("devices", "tc3_ads.json"),
                       lambda d: d["tags"].pop("t_2c4f4e40-ccdc4848"))  # output_1 kırık referans
        rc, o = self.cli("export", "-o", os.path.join(self.dir, "out"))
        self.assertEqual(rc, 2, o)
        self.assertFalse(os.path.exists(os.path.join(self.dir, "out")))

    def test_remote_targets_rejected(self):
        cfg = os.path.join(self.prj, "fuxaw.json")
        for target in ({"ssh": "vm", "port": 1881}, {"url": "http://192.168.1.10:1881"}):
            with open(cfg, "w", encoding="utf-8") as f:
                json.dump({"name": "p1", "target": target}, f)
            rc, o = self.cli("status")
            self.assertEqual(rc, 1, o)
            self.assertIn("fuxaw.json", o)
        rc, o = run("init", os.path.join(self.dir, "p2"), "--url", "http://10.0.0.5:1881", "--no-pull")
        self.assertEqual(rc, 1, o)
        self.assertFalse(os.path.exists(os.path.join(self.dir, "p2")))

    def test_unreachable_target_status_offline(self):
        self.mock.close()
        with open(self.src("scripts", "SimuHmiToggle.js"), "a", encoding="utf-8") as f:
            f.write("//x")
        rc, o = self.cli("status")
        self.assertEqual(rc, 1)
        self.assertIn("ulaşılamadı", o)
        self.assertIn("script SimuHmiToggle", o)
        self.mock = MockFuxa(LIVE)  # tearDown için


if __name__ == "__main__":
    unittest.main()
