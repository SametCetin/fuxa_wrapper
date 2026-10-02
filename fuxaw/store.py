"""Proje klasörü: fuxaw.json (ayarlar), src/ (düzenlenen kaynak), .fuxaw/ (senkron durumu).

src/ düzeni (her öğe ayrı dosya, git diff'i okunur olsun diye):
  project.json              meta (name, version, server, ...) – API ile yazılamaz
  layout.json               hmi.layout
  devices/<ad>.json         cihaz + tag'leri (value/timestamp yok)
  views/<ad>.json           ekran
  scripts/<ad>.json + .js   script ayarları + kodu (kod sadece .js'de)
  <tür>s/<ad>.json          text, alarm, notification, report, ...
  charts.json, ...          tekil türler
"""
import datetime
import json
import os
import re
import shutil

from . import model
from .target import TargetError, target_url

CONFIG_NAME = "fuxaw.json"
SRC = "src"
STATE_DIR = ".fuxaw"

DIRS = {kind: kind + "s" for kind in model.LIST_KINDS}
MANAGED_DIRS = set(DIRS.values())
SINGLE_FILES = {"layout": "layout.json", **{k: k + ".json" for k in model.SINGLE_KINDS if k != "layout"}}


class ProjectError(Exception):
    pass


def _dump(obj):
    return json.dumps(obj, indent=2, ensure_ascii=False) + "\n"


def _write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def _read_json(path):
    with open(path, encoding="utf-8-sig") as f:
        return json.load(f)


def safe_name(name):
    return re.sub(r"[^A-Za-z0-9._-]+", "_", str(name)).strip("._") or "item"


def find_project(start=None, explicit=None):
    """fuxaw.json içeren proje klasörünü bul."""
    if explicit:
        path = os.path.abspath(explicit)
        if os.path.isfile(path):
            path = os.path.dirname(path)
        if not os.path.isfile(os.path.join(path, CONFIG_NAME)):
            raise ProjectError(f"{path} içinde {CONFIG_NAME} yok")
        return path
    cur = os.path.abspath(start or os.getcwd())
    while True:
        if os.path.isfile(os.path.join(cur, CONFIG_NAME)):
            return cur
        parent = os.path.dirname(cur)
        if parent == cur:
            break
        cur = parent
    # Repo kökündeysek alt klasörlere bak
    base = os.path.abspath(start or os.getcwd())
    found = [os.path.join(base, d) for d in sorted(os.listdir(base))
             if os.path.isfile(os.path.join(base, d, CONFIG_NAME))]
    if len(found) == 1:
        return found[0]
    if not found:
        raise ProjectError(f"{CONFIG_NAME} bulunamadı. 'fuxaw init' ile proje oluştur veya -p ile klasör ver.")
    names = ", ".join(os.path.basename(f) for f in found)
    raise ProjectError(f"Birden fazla proje var ({names}); -p ile seç.")


class Project:
    def __init__(self, root):
        self.root = root
        self.config = _read_json(os.path.join(root, CONFIG_NAME))
        self.src = os.path.join(root, SRC)
        self.state_dir = os.path.join(root, STATE_DIR)

    @property
    def name(self):
        return self.config.get("name") or os.path.basename(self.root)

    # ---------- kaynak (src/) ----------
    def has_src(self):
        return os.path.isdir(self.src)

    def read_items(self):
        if not self.has_src():
            raise ProjectError(f"{self.src} yok; önce 'fuxaw pull' çalıştır.")
        items = {}
        p = os.path.join(self.src, "project.json")
        items[model.META] = _read_json(p) if os.path.isfile(p) else {}
        for kind, fname in SINGLE_FILES.items():
            p = os.path.join(self.src, fname)
            if os.path.isfile(p):
                items[kind] = _read_json(p)
        for kind, dname in DIRS.items():
            d = os.path.join(self.src, dname)
            if not os.path.isdir(d):
                continue
            keyf = model.LIST_KINDS[kind][1]
            for fn in sorted(os.listdir(d)):
                if not fn.endswith(".json"):
                    continue
                obj = _read_json(os.path.join(d, fn))
                if kind == "script":
                    js = os.path.join(d, fn[:-5] + ".js")
                    if os.path.isfile(js):
                        with open(js, encoding="utf-8-sig", newline="") as f:
                            obj["code"] = f.read()
                if keyf not in obj:
                    raise ProjectError(f"{dname}/{fn}: '{keyf}' alanı yok")
                key = f"{kind}:{obj[keyf]}"
                if key in items:
                    raise ProjectError(f"{dname}/{fn}: aynı {keyf} başka dosyada da var ({obj[keyf]})")
                items[key] = model.normalize(key, obj)
        return items

    def write_items(self, items):
        """src/'yi öğelerden baştan üret (yönetilen dosyalar silinip yeniden yazılır)."""
        os.makedirs(self.src, exist_ok=True)
        for d in MANAGED_DIRS:
            shutil.rmtree(os.path.join(self.src, d), ignore_errors=True)
        for fname in ["project.json", *SINGLE_FILES.values()]:
            p = os.path.join(self.src, fname)
            if os.path.isfile(p):
                os.remove(p)
        _write(os.path.join(self.src, "project.json"), _dump(items.get(model.META, {})))
        used = {}
        for key in sorted(items):
            kind = model.kind_of(key)
            obj = items[key]
            if kind in SINGLE_FILES:
                _write(os.path.join(self.src, SINGLE_FILES[kind]), _dump(obj))
            elif kind in DIRS:
                d = DIRS[kind]
                base = safe_name(obj.get("name") or key.split(":", 1)[1])
                if (d, base.lower()) in used:
                    base = f"{base}__{safe_name(key.split(':', 1)[1])}"
                used[(d, base.lower())] = key
                if kind == "script" and isinstance(obj.get("code"), str):
                    meta = {k: v for k, v in obj.items() if k != "code"}
                    _write(os.path.join(self.src, d, base + ".json"), _dump(meta))
                    _write(os.path.join(self.src, d, base + ".js"), obj["code"])
                else:
                    _write(os.path.join(self.src, d, base + ".json"), _dump(obj))

    # ---------- export (editörde Import project ile açılabilen dosyalar) ----------
    def export_paths(self):
        exp = self.config.get("export", {})
        return (os.path.join(self.root, exp.get("project", f"{self.name}_live.json")),
                os.path.join(self.root, exp.get("devices", f"{self.name}-devices_live.json")))

    def write_exports(self, items):
        prj_path, dev_path = self.export_paths()
        prj = model.join_project(items)
        _write(prj_path, _dump(prj))
        _write(dev_path, _dump(list(prj["devices"].values())))
        return prj_path, dev_path

    # ---------- senkron durumu (.fuxaw/) ----------
    def read_base(self):
        p = os.path.join(self.state_dir, "base.json")
        return _read_json(p) if os.path.isfile(p) else None

    def write_base(self, items):
        _write(os.path.join(self.state_dir, "base.json"), _dump(items))
        _write(os.path.join(self.state_dir, "state.json"), _dump({
            "synced_at": datetime.datetime.now().isoformat(timespec="seconds"),
            "target": target_label(self.config),
        }))

    def read_state(self):
        p = os.path.join(self.state_dir, "state.json")
        return _read_json(p) if os.path.isfile(p) else {}

    def local_backup_dir(self):
        return os.path.join(self.state_dir, "backups")


def target_label(config):
    try:
        return target_url(config)
    except TargetError:
        return "(geçersiz hedef)"


def create_config(root, name, target):
    path = os.path.join(root, CONFIG_NAME)
    if os.path.exists(path):
        raise ProjectError(f"{path} zaten var")
    _write(path, _dump({"name": name, "target": target}))
    return path
