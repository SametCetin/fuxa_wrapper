"""Yerel (src/) – hedef (FUXA) – taban (son senkron) üçlü karşılaştırması, pull ve publish."""
from dataclasses import dataclass

from . import model

# Durumlar
SAME = "aynı"
LOCAL = "yerelde değişti"     # publish edilecek
TARGET = "hedefte değişti"    # pull edilecek (ör. editörde kaydedildi)
CONFLICT = "çakışma"          # iki tarafta da değişti
UNKNOWN = "farklı (taban yok)"


@dataclass
class Entry:
    key: str
    label: str
    state: str
    local: object
    target: object
    base: object

    @property
    def kind(self):
        return model.kind_of(self.key)

    @property
    def readonly(self):
        return self.kind == model.META

    def change(self, side):
        """'eklendi' / 'silindi' / 'değişti' – side: 'local' veya 'target' tarafındaki değişiklik."""
        new = self.local if side == "local" else self.target
        if self.state == UNKNOWN:  # taban yok: diğer tarafa göre
            old = self.target if side == "local" else self.local
        else:
            old = self.base
        if old is None and new is not None:
            return "eklendi"
        if new is None and old is not None:
            return "silindi"
        return "değişti"


def compare(local, target, base):
    entries = []
    keys = set(local) | set(target) | set(base or {})
    for key in keys:
        l, t = local.get(key), target.get(key)
        b = (base or {}).get(key)
        hl, ht, hb = model.digest(l), model.digest(t), model.digest(b)
        if hl == ht:
            state = SAME
        elif base is None:
            state = UNKNOWN
        else:
            lc, tc = hl != hb, ht != hb
            state = CONFLICT if (lc and tc) else LOCAL if lc else TARGET
        obj = l if l is not None else t if t is not None else b
        entries.append(Entry(key, model.label(key, obj), state, l, t, b))
    order = {k: i for i, k in enumerate(model.PUBLISH_ORDER)}
    entries.sort(key=lambda e: (order.get(e.kind, 99), e.label))
    return entries


def publish_plan(entries, force=False, raw_target=None):
    """Gönderilecek (cmd, key, data) listesi + atlanan/engelleyen öğeler.

    raw_target: hedefin ham projesi; cihazlarda tag value/timestamp oradan korunur.
    """
    raw_devices = (raw_target or {}).get("devices") or {}
    sets, dels, skipped, blocked = [], [], [], []
    for e in entries:
        if e.state in (SAME, TARGET):
            continue
        if e.state in (CONFLICT, UNKNOWN) and not force:
            blocked.append(e)
            continue
        if e.readonly:
            skipped.append(e)
            continue
        if e.local is not None:
            raw = raw_devices.get(e.local.get("id")) if e.kind == "device" else None
            data = model.with_volatile(e.key, e.local, raw)
            cmd = (model.LIST_KINDS[e.kind][2] if e.kind in model.LIST_KINDS
                   else model.SINGLE_KINDS[e.kind][1])
            sets.append((cmd, e, data))
        elif e.kind in model.LIST_KINDS:
            dels.append((model.LIST_KINDS[e.kind][3], e, e.target))
        else:
            skipped.append(e)  # tekil tür silinemez
    dorder = {k: i for i, k in enumerate(model.DELETE_ORDER)}
    dels.sort(key=lambda x: dorder.get(x[1].kind, 99))
    # Ekran silmeleri önce: FUXA set-view'ı aynı adlı başka ekran varken sessizce atlar
    # (ör. hedefteki "MainView" farklı id ile yerelde yeniden oluşturulmuşsa).
    view_dels = [d for d in dels if d[1].kind == "view"]
    other_dels = [d for d in dels if d[1].kind != "view"]
    return view_dels + sets + other_dels, skipped, blocked


def pull_merge(local, base, entries, force=False):
    """Hedefteki değişiklikleri yerel öğelere uygula. (yeni_yerel, yeni_taban, alınan, engellenen)"""
    new_local = dict(local)
    new_base = dict(base or {})
    pulled, blocked = [], []
    for e in entries:
        if e.state == SAME:
            _set(new_base, e.key, e.target)
        elif e.state == TARGET or (e.state in (CONFLICT, UNKNOWN) and force):
            _set(new_local, e.key, e.target)
            _set(new_base, e.key, e.target)
            pulled.append(e)
        elif e.state in (CONFLICT, UNKNOWN):
            blocked.append(e)
        # LOCAL: yerel değişiklik korunur, taban değişmez
    return new_local, new_base, pulled, blocked


def _set(d, key, val):
    if val is None:
        d.pop(key, None)
    else:
        d[key] = val
