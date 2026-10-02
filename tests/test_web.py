"""web.py: API uçları ve güvenlik kontrolleri (sahte FUXA ile, tarayıcı gerekmez)."""
import json
import os
import shutil
import socket
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.parse
import urllib.request
from http.server import ThreadingHTTPServer
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

from fuxaw import web  # noqa: E402
from mock_fuxa import MockFuxa  # noqa: E402
from test_fuxaw import LIVE, run  # noqa: E402


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class WebTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="fuxaw_web_")
        self.env = mock.patch.dict(os.environ, {"FUXAW_DATA": os.path.join(self.tmp, "app")})
        self.env.start()
        self.fuxa = MockFuxa(LIVE)
        self.prj = os.path.join(self.tmp, "repo", "p1")
        rc, o = run("init", self.prj, "--name", "p1", "--url", self.fuxa.url)
        self.assertEqual(rc, 0, o)
        self.port = free_port()
        self.httpd = ThreadingHTTPServer(("127.0.0.1", self.port),
                                         web.make_handler(web.App([os.path.join(self.tmp, "repo")]), self.port))
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.fuxa.close()
        self.env.stop()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def req(self, path, body=None, headers=None):
        h = {"X-Fuxaw": "1", "Content-Type": "application/json"} if body is not None else {}
        h.update(headers or {})
        r = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}",
                                   data=None if body is None else json.dumps(body).encode(), headers=h)
        try:
            with urllib.request.urlopen(r) as resp:
                return resp.status, json.loads(resp.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def q(self, name, **params):
        return f"/api/{name}?" + urllib.parse.urlencode({"path": self.prj, **params})

    def test_projects_found(self):
        code, d = self.req("/api/projects")
        self.assertEqual(code, 200)
        self.assertEqual([p["name"] for p in d["projects"]], ["p1"])

    def test_index_served(self):
        with urllib.request.urlopen(f"http://127.0.0.1:{self.port}/") as r:
            self.assertIn(b"fuxaw", r.read())

    def test_post_requires_header(self):
        code, d = self.req("/api/pull", {"path": self.prj}, headers={"X-Fuxaw": ""})
        self.assertEqual(code, 403)
        self.assertEqual(self.fuxa.calls, [])

    def test_bad_host_rejected(self):
        code, _d = self.req("/api/projects", headers={"Host": "evil.example:80"})
        self.assertEqual(code, 403)

    def test_unknown_project_rejected(self):
        code, d = self.req("/api/status?" + urllib.parse.urlencode({"path": self.tmp}))
        self.assertEqual(code, 400)
        self.assertIn("bilinmeyen proje", d["error"])

    def test_status_tags_publish(self):
        code, d = self.req(self.q("status"))
        self.assertEqual(code, 200)
        self.assertTrue(d["reachable"])
        self.assertFalse([e for e in d["entries"] if e["state"] != "aynı"])

        code, d = self.req(self.q("tags"))
        start = next(t for t in d["tags"] if t["name"] == "Start_button")
        self.assertEqual(len(start["uses"]), 3)  # mousedown / mouseup / mouseout

        with open(os.path.join(self.prj, "src", "scripts", "SimuHmiToggle.js"), "a", encoding="utf-8") as f:
            f.write("\n// web\n")
        code, d = self.req("/api/publish", {"path": self.prj, "dry_run": True})
        self.assertEqual([x["cmd"] for x in d["plan"]], ["set-script"])
        self.assertEqual(self.fuxa.calls, [])
        code, d = self.req("/api/publish", {"path": self.prj})
        self.assertEqual(d["rc"], 0, d["log"])
        self.assertEqual([c for c, _ in self.fuxa.calls], ["set-script"])


if __name__ == "__main__":
    unittest.main()
