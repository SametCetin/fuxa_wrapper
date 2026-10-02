"""Publish öncesi kontroller: FUXA 1.3.4'te bilinen tuzaklar ve kırık referanslar.

Bkz. AGENTS.md "Tuzaklar". Her bulgu (seviye, öğe etiketi, mesaj); seviye "HATA" publish'i durdurur.
"""
import re

from . import model

ERROR = "HATA"
WARN = "UYARI"

BOOL_TEXT = {"true", "false"}
GET_TAG_ID = re.compile(r"""\$getTagId\(\s*(['"])(.*?)\1\s*(?:,\s*(['"])(.*?)\3)?\s*\)""")


def _tag_index(items):
    tags, by_name = {}, {}
    for key, dev in items.items():
        if model.kind_of(key) != "device":
            continue
        for tid, tag in (dev.get("tags") or {}).items():
            tags[tid] = (tag, dev)
            by_name.setdefault((dev.get("name"), tag.get("name")), tid)
    return tags, by_name


def _is_bool_ads(tag, dev):
    return dev.get("type") == "ADSclient" and str(tag.get("type", "")).lower() == "boolean"


def lint(items):
    found = []
    tags, by_name = _tag_index(items)
    scripts = {obj["id"] for k, obj in items.items() if model.kind_of(k) == "script"}
    views = {obj["id"] for k, obj in items.items() if model.kind_of(k) == "view"}

    # Aynı adlı ekranlar: FUXA set-view'da sessizce atlıyor
    seen = {}
    for k, v in items.items():
        if model.kind_of(k) == "view":
            if v.get("name") in seen:
                found.append((ERROR, model.label(k, v), f"aynı adlı başka ekran var ({seen[v['name']]}); FUXA bu ekranı kaydetmez"))
            seen[v.get("name")] = v["id"]

    for k, view in items.items():
        if model.kind_of(k) != "view":
            continue
        vlabel = model.label(k, view)
        for gid, ga in (view.get("items") or {}).items():
            where = f"{vlabel} / {ga.get('name') or gid}"
            prop = ga.get("property") or {}
            vid = prop.get("variableId")
            if vid and vid not in tags:
                found.append((ERROR, where, f"bağlı tag yok: {vid}"))
            for ev in prop.get("events") or []:
                act = ev.get("action")
                opts = ev.get("actoptions") or {}
                evname = f"{ev.get('type')}→{act}"
                if act in ("onSetValue", "onToggleValue"):
                    tid = ((opts.get("variable") or {}).get("variableId")
                           or opts.get("variableId") or (opts.get("variable") or {}).get("id"))
                    if not tid:
                        found.append((ERROR, where, f"{evname}: tag seçilmemiş"))
                        continue
                    if tid not in tags:
                        found.append((ERROR, where, f"{evname}: tag yok ({tid})"))
                        continue
                    tag, dev = tags[tid]
                    if _is_bool_ads(tag, dev):
                        if act == "onToggleValue":
                            found.append((ERROR, where, f"{evname} Boolean ADS tag'inde TRUE→FALSE yazamaz "
                                                        f"({tag.get('name')}); toggle script'i kullan"))
                        elif str(ev.get("actparam", "")).strip().lower() in BOOL_TEXT:
                            found.append((ERROR, where, f"{evname} değeri '{ev.get('actparam')}': Boolean ADS tag'ine "
                                                        f"metin true/false her zaman TRUE yazılır; 1 / 0 kullan"))
                elif act == "onRunScript":
                    if ev.get("actparam") not in scripts:
                        found.append((ERROR, where, f"{evname}: script yok ({ev.get('actparam')})"))
                elif act in ("onpage", "ondialog", "onwindow", "oncard", "onViewToPanel"):
                    if ev.get("actparam") and ev["actparam"] not in views:
                        found.append((WARN, where, f"{evname}: ekran yok ({ev.get('actparam')})"))
            # Boolean tag'e bağlı buton, renk aralığı FUXA varsayılanında (20–80, renk boş)
            if vid in tags and str(tags[vid][0].get("type", "")).lower() == "boolean":
                ranges = prop.get("ranges") or []
                if ranges and not any(r.get("min") in (0, 1) or r.get("max") in (0, 1) for r in ranges):
                    found.append((WARN, where, "Boolean tag'e bağlı ama renk aralıkları 0/1 değil (varsayılan 20–80?)"))
            # Momentary: mousedown 1 var ama mouseout 0 yok
            evs = prop.get("events") or []
            downs = [e for e in evs if e.get("type") == "mousedown" and e.get("action") == "onSetValue"]
            outs = [e for e in evs if e.get("type") == "mouseout" and e.get("action") == "onSetValue"]
            if downs and not outs:
                found.append((WARN, where, "momentary buton: mouseout → 0 yok, dışarıda bırakılırsa değer 1'de kalabilir"))

    for k, sc in items.items():
        if model.kind_of(k) != "script":
            continue
        for m in GET_TAG_ID.finditer(sc.get("code") or ""):
            tname, dname = m.group(2), m.group(4)
            if dname is not None:
                ok = (dname, tname) in by_name
            else:
                ok = any(n == tname for (_d, n) in by_name)
            if not ok:
                where = f"'{tname}'" + (f" ({dname})" if dname else "")
                found.append((ERROR, model.label(k, sc), f"$getTagId: tag bulunamadı {where}"))
    return found
