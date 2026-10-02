"""fuxaw web arayüzü: yerel HTTP sunucusu (sadece 127.0.0.1) + tek sayfalık arayüz (fuxaw/static/).

JSON API (hepsi /api altında):
  GET  projects                         bilinen projeler ve arama kökleri
  POST roots         {add|remove}       arama kökü ekle/çıkar
  GET  status?path=                     yerel / hedef karşılaştırması
  GET  diff?path=&key=[&base=1]         bir öğenin farkı
  GET  tags?path=                       tag tablosu + kullanım yerleri
  GET  lint?path=
  POST pull          {path, force}
  POST publish       {path, dry_run, force}   (sadece yerel test FUXA'sına)
  POST export        {path}             hedef makine için klasöre çıkar (proje JSON + README)
  GET  designer                         yerel FUXA durumu
  POST designer/start {install, port}   POST designer/stop

Güvenlik: sunucu 127.0.0.1'e bağlanır, Host başlığı denetlenir (DNS rebinding), POST'lar
"X-Fuxaw: 1" başlığı ister (başka bir sitenin tarayıcı üzerinden publish tetiklemesini engeller).
"""
import json
import mimetypes
import os
import threading
import traceback
import urllib.parse
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import designer, lint as lintmod, ops, store
from .target import TargetError

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
SKIP_DIRS = {".git", ".fuxaw", "node_modules", "__pycache__", "src"}


# ---------------------------------------------------------------- proje bulma
def _settings_path():
    return os.path.join(designer.app_dir(), "ui.json")


def load_roots():
    try:
        with open(_settings_path(), encoding="utf-8") as f:
            return [r for r in json.load(f).get("roots", []) if isinstance(r, str)]
    except (OSError, ValueError):
        return []


def save_roots(roots):
    os.makedirs(designer.app_dir(), exist_ok=True)
    with open(_settings_path(), "w", encoding="utf-8") as f:
        json.dump({"roots": roots}, f, indent=2, ensure_ascii=False)


def scan(root, depth=2):
    """root ve en fazla `depth` alt seviyede fuxaw.json içeren klasörler."""
    found = []
    root = os.path.abspath(root)
    if not os.path.isdir(root):
        return found
    if os.path.isfile(os.path.join(root, store.CONFIG_NAME)):
        found.append(root)
    if depth > 0:
        try:
            names = sorted(os.listdir(root))
        except OSError:
            names = []
        for n in names:
            p = os.path.join(root, n)
            if n in SKIP_DIRS or n.startswith(".") or not os.path.isdir(p):
                continue
            found.extend(scan(p, depth - 1))
    return found


class App:
    def __init__(self, roots):
        self.roots = []
        for r in roots + load_roots():
            r = os.path.abspath(r)
            if r not in self.roots:
                self.roots.append(r)
        self.lock = threading.Lock()  # yazan işlemler sırayla

    def projects(self):
        out, seen = [], set()
        for r in self.roots:
            for p in scan(r):
                if p in seen:
                    continue
                seen.add(p)
                try:
                    prj = store.Project(p)
                except (OSError, ValueError) as ex:
                    out.append({"path": p, "name": os.path.basename(p), "error": str(ex)})
                    continue
                out.append({"path": p, "name": prj.name, "target": store.target_label(prj.config),
                            "synced_at": prj.read_state().get("synced_at")})
        return out

    def project(self, path):
        path = os.path.abspath(path or "")
        if path not in {p["path"] for p in self.projects()}:
            raise store.ProjectError(f"bilinmeyen proje: {path}")
        return store.Project(path)


# ---------------------------------------------------------------- işlemler
def _collect():
    lines = []
    return lines, (lambda *a: lines.append(" ".join(str(x) for x in a)))


def api_status(app, q):
    prj = app.project(q.get("path"))
    res = ops.status(prj)
    st = prj.read_state()
    return {"name": prj.name, "root": prj.root, "target": store.target_label(prj.config),
            "synced_at": st.get("synced_at"), "reachable": res["reachable"], "error": res["error"],
            "has_base": res["has_base"], "counts": res["counts"],
            "entries": [ops.entry_info(e) for e in res["entries"]]}


def api_diff(app, q):
    prj = app.project(q.get("path"))
    key = q.get("key")
    result = ops.diff(prj, use_base=q.get("base") == "1", full=True)
    return {"diffs": [{"key": e.key, "label": e.label, "state": e.state, "detail": ops.detail(e).strip(" ()"),
                       "lines": lines} for e, lines in result if not key or e.key == key]}


def api_tags(app, q):
    prj = app.project(q.get("path"))
    return {"tags": ops.tag_table(prj.read_items())}


def api_lint(app, q):
    prj = app.project(q.get("path"))
    return {"findings": [{"level": lvl, "where": w, "msg": m} for lvl, w, m in lintmod.lint(prj.read_items())],
            "error_level": lintmod.ERROR}


def api_pull(app, body):
    prj = app.project(body.get("path"))
    lines, log = _collect()
    with app.lock:
        res = ops.pull(prj, force=bool(body.get("force")), log=log)
    return {**res, "log": lines}


def api_publish(app, body):
    prj = app.project(body.get("path"))
    lines, log = _collect()
    with app.lock:
        res = ops.publish(prj, dry_run=bool(body.get("dry_run")), force=bool(body.get("force")), log=log)
    return {**res, "log": lines}


def api_export(app, body):
    prj = app.project(body.get("path"))
    lines, log = _collect()
    with app.lock:
        res = ops.export(prj, log=log)
    return {**res, "log": lines}


def api_designer_start(app, body):
    lines, log = _collect()
    with app.lock:
        designer.start(port=int(body.get("port") or 1881), assume_yes=bool(body.get("install")),
                       open_browser=False, log=log)
    return {"log": lines, **designer.info()}


def api_designer_stop(app, body):
    lines, log = _collect()
    designer.stop(log=log)
    return {"log": lines, **designer.info()}


def api_roots(app, body):
    roots = load_roots()
    if body.get("add"):
        r = os.path.abspath(body["add"])
        if not os.path.isdir(r):
            raise store.ProjectError(f"klasör yok: {r}")
        if r not in roots:
            roots.append(r)
        if r not in app.roots:
            app.roots.append(r)
    if body.get("remove"):
        r = os.path.abspath(body["remove"])
        roots = [x for x in roots if x != r]
        app.roots = [x for x in app.roots if x != r]
    save_roots(roots)
    return {"roots": app.roots, "projects": app.projects()}


GET = {"status": api_status, "diff": api_diff, "tags": api_tags, "lint": api_lint,
       "projects": lambda app, q: {"roots": app.roots, "projects": app.projects()},
       "designer": lambda app, q: designer.info()}
POST = {"pull": api_pull, "publish": api_publish, "export": api_export, "roots": api_roots,
        "designer/start": api_designer_start, "designer/stop": api_designer_stop}
ERRORS = (store.ProjectError, TargetError, designer.DesignerError, OSError, ValueError)


# ---------------------------------------------------------------- HTTP
def make_handler(app, port):
    allowed_hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _send(self, code, data, ctype="application/json; charset=utf-8"):
            if not isinstance(data, bytes):
                data = json.dumps(data, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(data)

        def _host_ok(self):
            if self.headers.get("Host") in allowed_hosts:
                return True
            self._send(403, {"error": "geçersiz Host"})
            return False

        def _api(self, table, name, arg):
            fn = table.get(name)
            if not fn:
                return self._send(404, {"error": f"bilinmeyen: {name}"})
            try:
                self._send(200, fn(app, arg))
            except ERRORS as ex:
                self._send(400, {"error": str(ex)})
            except Exception as ex:  # arayüz çökmesin, ayrıntıyı göster
                traceback.print_exc()
                self._send(500, {"error": f"{type(ex).__name__}: {ex}"})

        def do_GET(self):
            if not self._host_ok():
                return
            u = urllib.parse.urlsplit(self.path)
            if u.path.startswith("/api/"):
                q = {k: v[-1] for k, v in urllib.parse.parse_qs(u.query).items()}
                return self._api(GET, u.path[5:], q)
            name = "index.html" if u.path in ("/", "") else u.path.lstrip("/")
            path = os.path.normpath(os.path.join(STATIC, name))
            if not path.startswith(STATIC + os.sep) or not os.path.isfile(path):
                return self._send(404, {"error": "yok"})
            ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
            if ctype.startswith("text/") or ctype.endswith("javascript"):
                ctype += "; charset=utf-8"
            with open(path, "rb") as f:
                self._send(200, f.read(), ctype)

        def do_POST(self):
            if not self._host_ok():
                return
            if self.headers.get("X-Fuxaw") != "1":
                return self._send(403, {"error": "X-Fuxaw başlığı gerekli"})
            u = urllib.parse.urlsplit(self.path)
            if not u.path.startswith("/api/"):
                return self._send(404, {"error": "yok"})
            try:
                n = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(n) or b"{}")
            except ValueError:
                return self._send(400, {"error": "geçersiz JSON"})
            self._api(POST, u.path[5:], body)

    return H


def serve(roots, port=8765, open_browser=True, log=print):
    app = App(roots)
    httpd = ThreadingHTTPServer(("127.0.0.1", port), make_handler(app, port))
    url = f"http://127.0.0.1:{port}/"
    log(f"fuxaw arayüzü: {url}  (durdurmak için Ctrl+C)")
    log("Proje arama kökleri: " + (", ".join(app.roots) or "yok"))
    if open_browser:
        webbrowser.open(url)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
    return 0
