"""Hedef FUXA sunucusu ile konuşma (REST API).

fuxaw.json "target" alanı:
  {"ssh": "hypervm", "port": 1881, "local_port": 11881, "backup_dir": "C:\\sct\\fuxa1_prj"}
      -> SSH tüneli açılır (zaten açıksa kullanılır), yedek hedef makinede alınır.
  {"url": "http://127.0.0.1:1881"}
      -> doğrudan HTTP (test / yerel FUXA), yedek proje klasöründe .fuxaw/backups'a alınır.
"""
import datetime
import json
import os
import socket
import subprocess
import time
import urllib.error
import urllib.request


class TargetError(Exception):
    pass


def _port_open(host, port, timeout=0.5):
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


class Target:
    def __init__(self, config, local_backup_dir=None, log=print):
        self.cfg = config.get("target") or {}
        self.local_backup_dir = local_backup_dir
        self.log = log
        self._tunnel = None
        if self.cfg.get("url"):
            self.base = self.cfg["url"].rstrip("/")
        elif self.cfg.get("ssh"):
            self.base = f"http://127.0.0.1:{self.cfg.get('local_port', 11881)}"
        else:
            raise TargetError("fuxaw.json: target.url veya target.ssh gerekli")

    @property
    def label(self):
        if self.cfg.get("url"):
            return self.cfg["url"]
        return f"{self.cfg['ssh']}:{self.cfg.get('port', 1881)}"

    # ---------- bağlantı ----------
    def __enter__(self):
        if self.cfg.get("ssh"):
            self._open_tunnel()
        return self

    def __exit__(self, *exc):
        self.close()

    def _open_tunnel(self):
        lp = int(self.cfg.get("local_port", 11881))
        if _port_open("127.0.0.1", lp):
            return  # kullanıcının açık tüneli (veya önceki) var, onu kullan
        rp = int(self.cfg.get("port", 1881))
        # Uzak tarafta 127.0.0.1 (localhost ::1'e gidiyor, FUXA orada dinlemiyor)
        cmd = ["ssh", "-N", "-o", "ExitOnForwardFailure=yes", "-o", "ConnectTimeout=10",
               "-L", f"127.0.0.1:{lp}:127.0.0.1:{rp}", self.cfg["ssh"]]
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        self._tunnel = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                        stderr=subprocess.PIPE, creationflags=flags)
        deadline = time.time() + 20
        while time.time() < deadline:
            if self._tunnel.poll() is not None:
                err = self._tunnel.stderr.read().decode(errors="replace").strip()
                self._tunnel = None
                raise TargetError(f"SSH tüneli açılamadı ({self.cfg['ssh']}): {err or 'bilinmeyen hata'}")
            if _port_open("127.0.0.1", lp):
                return
            time.sleep(0.2)
        self.close()
        raise TargetError(f"SSH tüneli 20 sn içinde hazır olmadı ({self.cfg['ssh']})")

    def close(self):
        # Sadece kendi açtığımız tünel sürecini kapat
        if self._tunnel and self._tunnel.poll() is None:
            self._tunnel.terminate()
            try:
                self._tunnel.wait(5)
            except subprocess.TimeoutExpired:
                self._tunnel.kill()
        self._tunnel = None

    # ---------- REST ----------
    def _request(self, path, body=None, timeout=30):
        data = None
        headers = {}
        if body is not None:
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(self.base + path, data=data, headers=headers,
                                     method="POST" if data is not None else "GET")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            msg = e.read().decode(errors="replace")[:300]
            raise TargetError(f"{path}: HTTP {e.code} {msg}") from None
        except (urllib.error.URLError, OSError) as e:
            raise TargetError(f"{self.label} erişilemiyor ({path}): {e}") from None

    def get_project(self):
        raw = self._request("/api/project")
        prj = json.loads(raw.decode("utf-8"))
        if not isinstance(prj, dict) or "hmi" not in prj:
            raise TargetError("GET /api/project beklenmeyen cevap döndü")
        return prj, raw

    def project_data(self, cmd, data):
        self._request("/api/projectData", {"cmd": cmd, "data": data})

    # ---------- yedek ----------
    def backup(self, topic="fuxaw", raw=None):
        """Hedefteki projenin yedeğini al, yolunu döndür."""
        stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        fname = f"backup_before_{topic}_{stamp}.json"
        if self.cfg.get("ssh") and self.cfg.get("backup_dir"):
            remote = self.cfg["backup_dir"].rstrip("\\/") + "\\" + fname
            port = self.cfg.get("port", 1881)
            out = subprocess.run(
                ["ssh", "-o", "ConnectTimeout=10", self.cfg["ssh"],
                 f'curl -s -f -o "{remote}" http://127.0.0.1:{port}/api/project && for %I in ("{remote}") do @echo %~zI'],
                capture_output=True, text=True, timeout=60)
            size = out.stdout.strip().splitlines()[-1] if out.stdout.strip() else ""
            if out.returncode != 0 or not size.isdigit() or int(size) < 100:
                raise TargetError(f"Hedefte yedek alınamadı: {out.stderr.strip() or out.stdout.strip()}")
            return f"{self.cfg['ssh']}:{remote} ({int(size):,} bayt)"
        # url modu: yerel yedek
        if raw is None:
            _prj, raw = self.get_project()
        os.makedirs(self.local_backup_dir, exist_ok=True)
        path = os.path.join(self.local_backup_dir, fname)
        with open(path, "wb") as f:
            f.write(raw)
        return path
