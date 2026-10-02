"""Yerel test FUXA'sı ile konuşma (REST API).

fuxaw sadece bu makinedeki FUXA'ya (127.0.0.1 / localhost) publish eder; bu test içindir.
Hedef makineye proje ağ üzerinden gönderilmez: 'fuxaw export' ile klasöre çıkarılır ve elle taşınır.

fuxaw.json "target" alanı (isteğe bağlı, varsayılan yerel designer):
  {"url": "http://127.0.0.1:1881"}
Yedekler proje klasöründe .fuxaw/backups altına alınır.
"""
import datetime
import json
import os
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_URL = "http://127.0.0.1:1881"
LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}


class TargetError(Exception):
    pass


def target_url(config):
    """fuxaw.json'dan hedef adresi; yerel değilse hata."""
    t = config.get("target") or {}
    if "ssh" in t:
        raise TargetError("fuxaw.json: uzak hedef (ssh) desteklenmiyor. 'target' alanını sil veya "
                          f'{{"url": "{DEFAULT_URL}"}} yap; hedef makine için \'fuxaw export\' kullan.')
    url = (t.get("url") or DEFAULT_URL).rstrip("/")
    host = urllib.parse.urlsplit(url).hostname
    if host not in LOCAL_HOSTS:
        raise TargetError(f"fuxaw.json: hedef sadece bu makine olabilir (127.0.0.1/localhost), verilen: {url}")
    return url


class Target:
    def __init__(self, config, local_backup_dir=None, log=print):
        self.base = target_url(config)
        self.local_backup_dir = local_backup_dir
        self.log = log

    @property
    def label(self):
        return self.base

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        pass

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
            raise TargetError(f"{self.label} erişilemiyor ({path}): {e}. Yerel FUXA çalışıyor mu? "
                              f"('fuxaw designer')") from None

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
        """Yerel FUXA'daki projenin yedeğini proje klasörüne al, yolunu döndür."""
        stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        if raw is None:
            _prj, raw = self.get_project()
        os.makedirs(self.local_backup_dir, exist_ok=True)
        path = os.path.join(self.local_backup_dir, f"backup_before_{topic}_{stamp}.json")
        with open(path, "wb") as f:
            f.write(raw)
        return path
