'use strict';
// Publish öncesi kontroller: FUXA 1.3.4'te bilinen tuzaklar ve kırık referanslar.
// Bkz. AGENTS.md "Tuzaklar". Her bulgu {level, where, message}; level "HATA" publish'i durdurur.

const model = require('./model');
const { ADS_DEVICE_TYPES, parseAdsAddress, adsConnectOptions, symbolAddressKey } = require('./adsSymbols');
const { t } = require('./i18n');

const ERROR = 'HATA';
const WARN = 'UYARI';

const BOOL_TEXT = new Set(['true', 'false']);
const ADS_TAG_TYPES = new Set(['boolean', 'number', 'string']);
// $getTagId('ad') veya $getTagId('ad', 'cihaz')
const GET_TAG_ID = /\$getTagId\(\s*(['"])(.*?)\1\s*(?:,\s*(['"])(.*?)\3)?\s*\)/g;
const PAGE_ACTIONS = new Set(['onpage', 'ondialog', 'onwindow', 'oncard', 'onViewToPanel']);

function tagIndex(items) {
  const tags = new Map();   // id -> {tag, dev}
  const byName = new Map(); // "cihaz\0tag" -> id
  for (const [, dev] of model.itemsOfKind(items, 'device')) {
    for (const [tid, tag] of Object.entries(dev.tags || {})) {
      tags.set(tid, { tag, dev });
      const k = `${dev.name}\0${tag.name}`;
      if (!byName.has(k)) byName.set(k, tid);
    }
  }
  return { tags, byName };
}

function isBoolAds(tag, dev) {
  return dev.type === 'ADSclient' && String(tag.type || '').toLowerCase() === 'boolean';
}

function eventTagId(opts) {
  return (opts.variable && opts.variable.variableId) || opts.variableId || (opts.variable && opts.variable.id);
}

function lint(items) {
  const found = [];
  const add = (level, where, message) => found.push({ level, where, message });
  const { tags, byName } = tagIndex(items);
  const scripts = new Set(model.itemsOfKind(items, 'script').map(([, s]) => s.id));
  const views = new Set(model.itemsOfKind(items, 'view').map(([, v]) => v.id));

  // ADS bağlantı ayarları ve tag'leri: çevrimdışı kurallar, PLC'ye bağlanmadan çalışır.
  for (const [k, dev] of model.itemsOfKind(items, 'device')) {
    if (!ADS_DEVICE_TYPES.has(dev.type)) continue;
    const label = model.label(k, dev);
    const prop = dev.property || {};
    const parsed = parseAdsAddress(prop.address);
    const cfg = adsConnectOptions({ ...prop, ...(dev.type === 'ADSclient' ? { adsTransport: 'tcp' } : {}) });
    if (cfg.error === 'port') add(ERROR, label, t('conn.port'));
    if (cfg.error === 'local') add(ERROR, label, t('conn.local'));
    if (cfg.error === 'router') add(ERROR, label, t('conn.router'));
    if (!String(prop.address || '').trim()) add(ERROR, label, t('lint.adsAddressMissing'));
    else if (!parsed) add(ERROR, label, t('lint.adsAddress', { address: prop.address }));
    else if (parsed.port === null && !(Number(prop.port) >= 1 && Number(prop.port) <= 65535)) {
      add(WARN, label, t('lint.adsPort'));
    }
    if (dev.type === 'FuxawADS') {
      const transport = prop.adsTransport;
      if (transport === undefined || transport === '') add(WARN, label, t('lint.adsTransportMissing'));
      else if (transport !== 'native' && transport !== 'tcp') add(ERROR, label, t('lint.adsTransport', { transport: String(transport) }));
    }
    const seenAddresses = new Map();
    for (const [tid, tag] of Object.entries(dev.tags || {})) {
      const where = `${label} / ${tag.name || tid}`;
      const address = String(tag.address || '').trim();
      if (!address) add(ERROR, where, t('lint.adsTagAddress'));
      if (!ADS_TAG_TYPES.has(String(tag.type || '').toLowerCase())) {
        add(ERROR, where, t('lint.adsTagType', { type: String(tag.type || '') }));
      }
      if (!address) continue;
      if (seenAddresses.has(symbolAddressKey(address))) add(WARN, where, t('lint.adsDuplicateAddress', { address, other: seenAddresses.get(symbolAddressKey(address)) }));
      else seenAddresses.set(symbolAddressKey(address), tag.name || tid);
    }
  }

  // Aynı adlı ekranlar: FUXA set-view'da sessizce atlıyor
  const seen = new Map();
  for (const [k, v] of model.itemsOfKind(items, 'view')) {
    if (seen.has(v.name)) {
      add(ERROR, model.label(k, v), t('lint.duplicateView', { id: seen.get(v.name) }));
    }
    seen.set(v.name, v.id);
  }

  for (const [k, view] of model.itemsOfKind(items, 'view')) {
    const vlabel = model.label(k, view);
    for (const [gid, ga] of Object.entries(view.items || {})) {
      const where = `${vlabel} / ${ga.name || gid}`;
      const prop = ga.property || {};
      const vid = prop.variableId;
      if (vid && !tags.has(vid)) add(ERROR, where, t('lint.missingTag', { id: vid }));
      const evs = prop.events || [];
      for (const ev of evs) {
        const act = ev.action;
        const opts = ev.actoptions || {};
        const evname = `${ev.type}→${act}`;
        if (act === 'onSetValue' || act === 'onToggleValue') {
          const tid = eventTagId(opts);
          if (!tid) { add(ERROR, where, t('lint.eventNoTag', { event: evname })); continue; }
          if (!tags.has(tid)) { add(ERROR, where, t('lint.eventMissingTag', { event: evname, id: tid })); continue; }
          const { tag, dev } = tags.get(tid);
          if (isBoolAds(tag, dev)) {
            if (act === 'onToggleValue') {
              add(ERROR, where, t('lint.boolToggle', { event: evname, tag: tag.name }));
            } else if (BOOL_TEXT.has(String(ev.actparam ?? '').trim().toLowerCase())) {
              add(ERROR, where, t('lint.boolText', { event: evname, value: ev.actparam }));
            }
          }
        } else if (act === 'onRunScript') {
          if (!scripts.has(ev.actparam)) add(ERROR, where, t('lint.missingScript', { event: evname, id: ev.actparam }));
        } else if (PAGE_ACTIONS.has(act)) {
          if (ev.actparam && !views.has(ev.actparam)) add(WARN, where, t('lint.missingView', { event: evname, id: ev.actparam }));
        }
      }
      // Boolean tag'e bağlı öğe, renk aralığı FUXA varsayılanında (20–80, renk boş)
      if (vid && tags.has(vid) && String(tags.get(vid).tag.type || '').toLowerCase() === 'boolean') {
        const ranges = prop.ranges || [];
        const is01 = (x) => x === 0 || x === 1;
        if (ranges.length && !ranges.some((r) => is01(r.min) || is01(r.max))) {
          add(WARN, where, t('lint.boolRanges'));
        }
      }
      // Momentary: mousedown 1 var ama mouseout 0 yok
      const downs = evs.some((e) => e.type === 'mousedown' && e.action === 'onSetValue');
      const outs = evs.some((e) => e.type === 'mouseout' && e.action === 'onSetValue');
      if (downs && !outs) {
        add(WARN, where, t('lint.momentary'));
      }
    }
  }

  for (const [k, sc] of model.itemsOfKind(items, 'script')) {
    for (const m of (sc.code || '').matchAll(GET_TAG_ID)) {
      const tname = m[2];
      const dname = m[4];
      const ok = dname !== undefined
        ? byName.has(`${dname}\0${tname}`)
        : [...byName.keys()].some((key) => key.split('\0')[1] === tname);
      if (!ok) {
        add(ERROR, model.label(k, sc), t('lint.getTagId', { name: tname, device: dname !== undefined ? ` (${dname})` : '' }));
      }
    }
  }
  return found;
}

module.exports = { ERROR, WARN, GET_TAG_ID, lint };
