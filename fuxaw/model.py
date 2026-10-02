"""FUXA proje JSON'u <-> öğe (item) sözlüğü.

Proje, karşılaştırılabilir ve tek tek gönderilebilir parçalara bölünür. Her
parçanın anahtarı "<tür>:<id>" (ör. "view:v_1471...", "device:d_31db...")
veya tekil türlerde sadece "<tür>" (ör. "layout").

Karşılaştırmada her GET'te değişen alanlar (tag value/timestamp) atılır.
"""
import copy
import hashlib
import json

# tür -> (proje içindeki liste yolu, anahtar alanı, set komutu, del komutu)
LIST_KINDS = {
    "device": ("devices", "id", "set-device", "del-device"),
    "view": ("hmi.views", "id", "set-view", "del-view"),
    "script": ("scripts", "id", "set-script", "del-script"),
    "text": ("texts", "id", "set-text", "del-text"),
    "alarm": ("alarms", "name", "set-alarm", "del-alarm"),
    "notification": ("notifications", "id", "set-notification", "del-notification"),
    "report": ("reports", "id", "set-report", "del-report"),
    "mapsLocation": ("mapsLocations", "id", "set-maps-location", "del-maps-location"),
    "arMarker": ("ar.markers", "id", "set-ar-marker", "del-ar-marker"),
}
# tekil türler -> (proje yolu, komut)
SINGLE_KINDS = {
    "layout": ("hmi.layout", "layout"),
    "charts": ("charts", "charts"),
    "graphs": ("graphs", "graphs"),
    "languages": ("languages", "languages"),
    "clientAccess": ("clientAccess", "client-access"),
}
# API ile yazılamayan kısım (name, version, server, ar.enabled, bilinmeyen anahtarlar)
META = "meta"

# Publish sırası: önce cihazlar (tag'ler hazır olsun), sonra script, ekran, layout.
PUBLISH_ORDER = ["device", "script", "text", "alarm", "notification", "report",
                 "mapsLocation", "arMarker", "view", "layout", "charts", "graphs",
                 "languages", "clientAccess"]
DELETE_ORDER = ["view", "arMarker", "mapsLocation", "report", "notification",
                "alarm", "text", "script", "device"]

VOLATILE_TAG_FIELDS = ("value", "timestamp")
KNOWN_TOP = {"devices", "hmi", "scripts", "texts", "alarms", "notifications",
             "reports", "mapsLocations", "ar", "charts", "graphs", "languages",
             "clientAccess"}


def kind_of(key):
    return key.split(":", 1)[0]


def _get_path(obj, path):
    for part in path.split("."):
        if not isinstance(obj, dict) or part not in obj:
            return None
        obj = obj[part]
    return obj


def normalize(key, obj):
    """Karşılaştırma için kopya: uçucu alanlar atılır, satır sonları birleştirilir."""
    obj = copy.deepcopy(obj)
    kind = kind_of(key)
    if kind == "device" and isinstance(obj.get("tags"), dict):
        for tag in obj["tags"].values():
            for f in VOLATILE_TAG_FIELDS:
                tag.pop(f, None)
    if kind == "script" and isinstance(obj.get("code"), str):
        obj["code"] = obj["code"].replace("\r\n", "\n")
    return obj


def canonical(obj):
    return json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def digest(obj):
    if obj is None:
        return None
    return hashlib.sha256(canonical(obj).encode("utf-8")).hexdigest()


def split_project(prj):
    """Tam proje -> {anahtar: normalize edilmiş öğe}."""
    items = {}
    for kind, (path, keyf, _s, _d) in LIST_KINDS.items():
        coll = _get_path(prj, path)
        if isinstance(coll, dict):
            coll = list(coll.values())
        for obj in coll or []:
            k = f"{kind}:{obj[keyf]}"
            items[k] = normalize(k, obj)
    for kind, (path, _c) in SINGLE_KINDS.items():
        val = _get_path(prj, path)
        if val is not None:
            items[kind] = copy.deepcopy(val)
    meta = {k: copy.deepcopy(v) for k, v in prj.items() if k not in KNOWN_TOP}
    if isinstance(prj.get("ar"), dict):
        meta["ar"] = {k: v for k, v in prj["ar"].items() if k != "markers"}
    items[META] = meta
    return items


def join_project(items):
    """{anahtar: öğe} -> FUXA'nın import edebildiği tam proje."""
    meta = copy.deepcopy(items.get(META, {}))
    prj = {"devices": {}, "hmi": {"views": []}}
    for key in sorted(items, key=lambda k: (k.split(":", 1)[0], label(k, items[k]))):
        kind = kind_of(key)
        obj = copy.deepcopy(items[key])
        if kind == "device":
            prj["devices"][obj["id"]] = obj
        elif kind == "view":
            prj["hmi"]["views"].append(obj)
        elif kind == "arMarker":
            meta.setdefault("ar", {"enabled": False}).setdefault("markers", []).append(obj)
        elif kind in LIST_KINDS:
            prj.setdefault(LIST_KINDS[kind][0], []).append(obj)
        elif kind == "layout":
            prj["hmi"]["layout"] = obj
        elif kind in SINGLE_KINDS:
            prj[SINGLE_KINDS[kind][0]] = obj
    if "ar" in meta:
        meta["ar"].setdefault("markers", [])
    prj.update(meta)
    return prj


def label(key, obj):
    """İnsan okunur ad: 'view MainView', 'device tc3_ads', 'layout'."""
    kind = kind_of(key)
    if ":" not in key:
        return kind
    name = (obj or {}).get("name") or key.split(":", 1)[1]
    return f"{kind} {name}"


def with_volatile(key, obj, target_obj):
    """Gönderilecek cihaza hedefteki tag value/timestamp'i geri koy."""
    if kind_of(key) != "device" or not target_obj:
        return obj
    obj = copy.deepcopy(obj)
    ttags = target_obj.get("tags") or {}
    for tid, tag in (obj.get("tags") or {}).items():
        for f in VOLATILE_TAG_FIELDS:
            if f in ttags.get(tid, {}) and f not in tag:
                tag[f] = ttags[tid][f]
    return obj


def device_tag_changes(old, new):
    """İki cihaz arasındaki tag farkı: (eklenen, silinen, değişen) ad listeleri."""
    ot = (old or {}).get("tags") or {}
    nt = (new or {}).get("tags") or {}
    added = [nt[i].get("name", i) for i in nt if i not in ot]
    removed = [ot[i].get("name", i) for i in ot if i not in nt]
    changed = [nt[i].get("name", i) for i in nt if i in ot and canonical(ot[i]) != canonical(nt[i])]
    rest_old = {k: v for k, v in (old or {}).items() if k != "tags"}
    rest_new = {k: v for k, v in (new or {}).items() if k != "tags"}
    props = canonical(rest_old) != canonical(rest_new)
    return added, removed, changed, props
