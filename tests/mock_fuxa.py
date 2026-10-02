"""Testler için sahte FUXA: GET /api/project ve POST /api/projectData (1.3.4 davranışına yakın).

- Her GET'te tag value/timestamp değişir (gerçekteki gibi).
- set-view aynı adlı başka ekran varsa sessizce atlanır (project.js setView).
"""
import copy
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LISTS = {"script": "scripts", "text": "texts", "alarm": "alarms", "notification": "notifications",
         "report": "reports", "maps-location": "mapsLocations"}


class MockFuxa:
    def __init__(self, project):
        self.project = copy.deepcopy(project)
        self.calls = []
        self.lock = threading.Lock()
        mock = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _send(self, code, body):
                data = json.dumps(body).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def do_GET(self):
                if self.path != "/api/project":
                    return self._send(404, {"error": "not found"})
                with mock.lock:
                    mock._tick()
                    self._send(200, mock.project)

            def do_POST(self):
                if self.path != "/api/projectData":
                    return self._send(404, {"error": "not found"})
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                with mock.lock:
                    try:
                        mock.apply(body["cmd"], body["data"])
                    except KeyError as ex:
                        return self._send(400, {"error": f"bad cmd {ex}"})
                    mock.calls.append((body["cmd"], body["data"].get("id") or body["data"].get("name")))
                self._send(200, {})

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()

    def _tick(self):
        now = int(time.time() * 1000)
        for dev in self.project.get("devices", {}).values():
            for tag in (dev.get("tags") or {}).values():
                tag["timestamp"] = now
                if isinstance(tag.get("value"), (int, float)) and not isinstance(tag.get("value"), bool):
                    tag["value"] = tag["value"] + 1

    def apply(self, cmd, data):
        p = self.project
        if cmd == "set-view":
            views = p["hmi"]["views"]
            if any(v["name"] == data["name"] and v["id"] != data["id"] for v in views):
                return  # FUXA: duplicate name -> skip
            p["hmi"]["views"] = [v for v in views if v["id"] != data["id"]] + [data]
        elif cmd == "del-view":
            p["hmi"]["views"] = [v for v in p["hmi"]["views"] if v["id"] != data["id"]]
        elif cmd == "set-device":
            p["devices"][data["id"]] = data
        elif cmd == "del-device":
            p["devices"].pop(data["id"], None)
        elif cmd == "layout":
            p["hmi"]["layout"] = data
        elif cmd.split("-", 1)[1] in LISTS:
            op, kind = cmd.split("-", 1)
            key = "name" if kind == "alarm" else "id"
            coll = [x for x in p.get(LISTS[kind], []) if x[key] != data[key]]
            if op == "set":
                coll.append(data)
            p[LISTS[kind]] = coll
        else:
            raise KeyError(cmd)
