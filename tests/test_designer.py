"""designer.py: bileşen bulma (ağ ve kurulum gerektirmez)."""
import json
import os
import shutil
import sys
import tempfile
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from fuxaw import designer  # noqa: E402


class DesignerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.env = mock.patch.dict(os.environ, {"FUXAW_DATA": self.tmp})
        self.env.start()

    def tearDown(self):
        self.env.stop()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_app_dir_from_env(self):
        self.assertEqual(designer.app_dir(), os.path.abspath(self.tmp))

    def test_app_local_node_preferred(self):
        node = os.path.join(self.tmp, "node", "node.exe")
        os.makedirs(os.path.dirname(node))
        open(node, "w").close()
        self.assertEqual(designer.find_node(), node)

    def test_fuxa_version(self):
        self.assertIsNone(designer.fuxa_version())
        pkg_dir = os.path.dirname(designer.fuxa_main())
        os.makedirs(pkg_dir)
        with open(os.path.join(pkg_dir, "package.json"), "w", encoding="utf-8") as f:
            json.dump({"version": "1.3.4"}, f)
        self.assertEqual(designer.fuxa_version(), "1.3.4")

    def test_install_refused_without_tty(self):
        with mock.patch.object(designer, "find_node", return_value=None), \
                mock.patch.object(designer.sys.stdin, "isatty", return_value=False):
            with self.assertRaises(designer.DesignerError):
                designer.ensure_components(log=lambda *a: None)


class AppEntryTest(unittest.TestCase):
    def test_no_args_runs_app(self):
        from fuxaw import cli, web
        calls = []
        with mock.patch.object(designer, "start", lambda **kw: calls.append(("start", kw))), \
                mock.patch.object(web, "running", return_value=False), \
                mock.patch.object(web, "serve", lambda roots, **kw: calls.append(("serve", kw)) or 0), \
                mock.patch("sys.stdout"):
            self.assertEqual(cli.main([]), 0)
        self.assertEqual([c[0] for c in calls], ["start", "serve"])
        self.assertTrue(calls[0][1]["assume_yes"])  # eksik bileşenler sormadan kurulur
        self.assertEqual(calls[1][1]["port"], 8765)


if __name__ == "__main__":
    unittest.main()
