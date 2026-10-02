'use strict';
// FUXA proje JSON'u: temizleme, karşılaştırma ve öğelere (cihaz, ekran, script…) bölme.
//
// Öğe anahtarı "<tür>:<id>" (ör. "view:v_1471...", "device:d_31db...") veya tekil
// türlerde sadece "<tür>" (ör. "layout"). Lint ve tag tablosu öğeler üzerinde çalışır.

const crypto = require('node:crypto');

// tür -> [proje içindeki liste yolu, anahtar alanı]
const LIST_KINDS = {
  device: ['devices', 'id'],
  view: ['hmi.views', 'id'],
  script: ['scripts', 'id'],
  text: ['texts', 'id'],
  alarm: ['alarms', 'name'],
  notification: ['notifications', 'id'],
  report: ['reports', 'id'],
  mapsLocation: ['mapsLocations', 'id'],
  arMarker: ['ar.markers', 'id'],
};
const SINGLE_KINDS = {
  layout: 'hmi.layout',
  charts: 'charts',
  graphs: 'graphs',
  languages: 'languages',
  clientAccess: 'clientAccess',
};
// Her GET'te değişen tag alanları: dosyaya yazılmaz, karşılaştırmada yok sayılır.
const VOLATILE_TAG_FIELDS = ['value', 'timestamp'];

function kindOf(key) {
  return key.split(':', 1)[0];
}

function getPath(obj, path) {
  for (const part of path.split('.')) {
    if (obj === null || typeof obj !== 'object' || !(part in obj)) return undefined;
    obj = obj[part];
  }
  return obj;
}

function clone(obj) {
  return obj === undefined ? undefined : structuredClone(obj);
}

/** Dosyaya yazılacak hal: tag value/timestamp atılır, script satır sonları LF. */
function cleanProject(prj) {
  prj = clone(prj);
  for (const dev of Object.values(prj.devices || {})) {
    for (const tag of Object.values((dev && dev.tags) || {})) {
      for (const f of VOLATILE_TAG_FIELDS) delete tag[f];
    }
  }
  for (const sc of prj.scripts || []) {
    if (typeof sc.code === 'string') sc.code = sc.code.replace(/\r\n/g, '\n');
  }
  return prj;
}

/** Anahtar sırasından bağımsız JSON (karşılaştırma için). */
function canonical(obj) {
  if (Array.isArray(obj)) return '[' + obj.map(canonical).join(',') + ']';
  if (obj !== null && typeof obj === 'object') {
    return '{' + Object.keys(obj).sort()
      .filter((k) => obj[k] !== undefined)
      .map((k) => JSON.stringify(k) + ':' + canonical(obj[k])).join(',') + '}';
  }
  return JSON.stringify(obj === undefined ? null : obj);
}

// FUXA editörü bir ekranı açınca SVG'yi yeniden yazar ve öznitelik sırası değişir
// (ör. id x y → y x id); içerik aynıdır. Karşılaştırmada öznitelikler sıralanır.
const SVG_TAG = /<([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)>/g;
const SVG_ATTR = /[\w:.-]+="[^"]*"/g;

function normalizeSvg(svg) {
  return svg.replace(SVG_TAG, (_m, tag, attrs, close) => {
    const sorted = (attrs.match(SVG_ATTR) || []).sort();
    return `<${tag}${sorted.length ? ' ' + sorted.join(' ') : ''}${close}>`;
  });
}

/** Değişiklik takibi için özet: uçucu tag alanları ve SVG öznitelik sırası yok sayılır. */
function digest(prj) {
  const p = cleanProject(prj);
  for (const v of (p.hmi && p.hmi.views) || []) {
    if (typeof v.svgcontent === 'string') v.svgcontent = normalizeSvg(v.svgcontent);
  }
  return crypto.createHash('sha256').update(canonical(p)).digest('hex');
}

/** Tam proje -> {anahtar: öğe} (temizlenmiş kopyalar). */
function splitProject(prj) {
  prj = cleanProject(prj);
  const items = {};
  for (const [kind, [path, keyf]] of Object.entries(LIST_KINDS)) {
    let coll = getPath(prj, path);
    if (coll && !Array.isArray(coll) && typeof coll === 'object') coll = Object.values(coll);
    for (const obj of coll || []) {
      if (obj && obj[keyf] !== undefined) items[`${kind}:${obj[keyf]}`] = obj;
    }
  }
  for (const [kind, path] of Object.entries(SINGLE_KINDS)) {
    const val = getPath(prj, path);
    if (val !== undefined) items[kind] = val;
  }
  return items;
}

/** İnsan okunur ad: 'view MainView', 'device tc3_ads', 'layout'. */
function label(key, obj) {
  const kind = kindOf(key);
  if (!key.includes(':')) return kind;
  const name = (obj && obj.name) || key.slice(kind.length + 1);
  return `${kind} ${name}`;
}

function itemsOfKind(items, kind) {
  return Object.entries(items).filter(([k]) => kindOf(k) === kind);
}

module.exports = {
  LIST_KINDS, SINGLE_KINDS, VOLATILE_TAG_FIELDS,
  kindOf, getPath, clone, cleanProject, canonical, normalizeSvg, digest, splitProject, label, itemsOfKind,
};
