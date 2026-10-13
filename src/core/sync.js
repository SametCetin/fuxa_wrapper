'use strict';
// Dışarıdan değişen .fxprj'i açık projeye öğe öğe (ekran, cihaz, script…) uygulamak.
//
// Üç yönlü birleştirme öğe düzeyinde yapılır:
//   diskBase -> theirs : dosyada (git, Syncthing, ajan) ne değişti
//   liveBase -> mine   : editörde ne değişti
// Sadece bir tarafta değişen öğe o taraftan alınır; iki tarafta farklı değişen öğe çakışmadır.
// Değişiklikler gömülü sunucuya /api/projectData komutlarıyla tek tek gönderilir: ekran/script
// değişikliği bağlantıları koparmaz, set-device sadece o cihazın sürücüsünü yeniden başlatır.
// Öğelere bölünemeyen bir fark varsa (ör. proje genel alanları) planOps null döner; o zaman
// tüm proje gönderilir.

const model = require('./model');

// tür -> [kaydet komutu, sil komutu] (FUXA 1.3.4 runtime/project ProjectDataCmdType)
const ITEM_CMDS = {
  device: ['set-device', 'del-device'],
  view: ['set-view', 'del-view'],
  script: ['set-script', 'del-script'],
  text: ['set-text', 'del-text'],
  alarm: ['set-alarm', 'del-alarm'],
  notification: ['set-notification', 'del-notification'],
  report: ['set-report', 'del-report'],
  mapsLocation: ['set-maps-location', 'del-maps-location'],
  arMarker: ['set-ar-marker', 'del-ar-marker'],
};
const SINGLE_CMDS = {
  layout: 'layout',
  charts: 'charts',
  graphs: 'graphs',
  languages: 'languages',
  clientAccess: 'client-access',
};
// Önce silmeler; cihazlar (tag'ler) ve script'ler ekranlardan önce: ekranlar onlara başvurur.
const SET_ORDER = ['device', 'script', 'text', 'alarm', 'notification', 'report', 'mapsLocation', 'arMarker',
  'layout', 'charts', 'graphs', 'languages', 'clientAccess', 'view'];

// Öğelerin dışında kalan proje alanları (version, name, server, …) tek bir öğe sayılır.
const REST = 'project';

/** Proje -> {anahtar: karşılaştırma metni}; REST anahtarı öğe dışı alanlar. */
function fingerprints(prj) {
  const items = model.splitProject(prj);
  const out = {};
  for (const [key, obj] of Object.entries(items)) {
    let o = obj;
    if (model.kindOf(key) === 'view' && typeof o.svgcontent === 'string') {
      o = { ...o, svgcontent: model.normalizeSvg(o.svgcontent) };
    }
    out[key] = model.canonical(o);
  }
  out[REST] = model.canonical(restOf(prj));
  return out;
}

function restOf(prj) {
  const rest = model.cleanProject(prj);
  for (const [p] of Object.values(model.LIST_KINDS)) setPath(rest, p, undefined);
  for (const p of Object.values(model.SINGLE_KINDS)) setPath(rest, p, undefined);
  return rest;
}

/** a -> b: {changed: [b'de yeni/farklı anahtarlar], removed: [b'de olmayanlar]} (REST dahil). */
function diff(a, b) {
  const fa = fingerprints(a);
  const fb = fingerprints(b);
  const changed = Object.keys(fb).filter((k) => fa[k] !== fb[k]);
  const removed = Object.keys(fa).filter((k) => !(k in fb));
  return { changed, removed };
}

/** Projeye öğe koy (varsa yerini değiştir) ya da obj undefined ise öğeyi sil. Projeyi yerinde değiştirir. */
function putItem(prj, key, obj) {
  const kind = model.kindOf(key);
  if (key === REST) {
    const keep = {};
    for (const [p] of Object.values(model.LIST_KINDS)) keep[p] = model.getPath(prj, p);
    for (const p of Object.values(model.SINGLE_KINDS)) keep[p] = model.getPath(prj, p);
    for (const k of Object.keys(prj)) delete prj[k];
    Object.assign(prj, model.clone(obj));
    for (const [p, v] of Object.entries(keep)) setPath(prj, p, v);
    return;
  }
  if (kind in model.SINGLE_KINDS) {
    setPath(prj, model.SINGLE_KINDS[kind], model.clone(obj));
    return;
  }
  const [p, keyf] = model.LIST_KINDS[kind];
  const id = key.slice(kind.length + 1);
  let coll = model.getPath(prj, p);
  if (coll === undefined) {
    if (obj === undefined) return;
    coll = kind === 'device' ? {} : [];
    setPath(prj, p, coll);
  }
  if (Array.isArray(coll)) {
    const i = coll.findIndex((o) => o && String(o[keyf]) === id);
    if (obj === undefined) { if (i >= 0) coll.splice(i, 1); } else if (i >= 0) coll[i] = model.clone(obj);
    else coll.push(model.clone(obj));
  } else {
    const k = Object.keys(coll).find((x) => coll[x] && String(coll[x][keyf]) === id) ?? id;
    if (obj === undefined) delete coll[k];
    else coll[k] = model.clone(obj);
  }
}

function setPath(obj, p, val) {
  const parts = p.split('.');
  let o = obj;
  for (const part of parts.slice(0, -1)) {
    if (!o[part] || typeof o[part] !== 'object') {
      if (val === undefined) return;
      o[part] = {};
    }
    o = o[part];
  }
  if (val === undefined) delete o[parts[parts.length - 1]];
  else o[parts[parts.length - 1]] = val;
}

function itemOf(prj, key) {
  if (key === REST) return restOf(prj);
  return model.splitProject(prj)[key];
}

/**
 * Üç yönlü öğe birleştirme.
 * @returns {{target, theirs: string[], mine: string[], conflicts: string[]}}
 *   target: mine + diskteki çakışmasız değişiklikler (+ resolve(conflicts) 'disk' ise çakışanlar).
 */
function merge({ liveBase, mine, diskBase, theirs }, takeTheirsOnConflict = false) {
  const dTheirs = diff(diskBase, theirs);
  const dMine = diff(liveBase, mine);
  const mineKeys = new Set([...dMine.changed, ...dMine.removed]);
  const theirKeys = [...dTheirs.changed, ...dTheirs.removed];
  const fMine = fingerprints(mine);
  const fTheirs = fingerprints(theirs);
  const conflicts = theirKeys.filter((k) => mineKeys.has(k) && fMine[k] !== fTheirs[k]);
  const target = model.clone(mine);
  for (const k of theirKeys) {
    if (conflicts.includes(k) && !takeTheirsOnConflict) continue;
    putItem(target, k, itemOf(theirs, k));
  }
  return { target, theirs: theirKeys, mine: [...mineKeys], conflicts };
}

/**
 * from -> to için sunucu komutları: [{cmd, data}]. Öğelere bölünemeyen fark varsa null
 * (tüm projeyi gönder). Fark yoksa boş dizi.
 */
function planOps(from, to) {
  const { changed, removed } = diff(from, to);
  if (changed.includes(REST) || removed.includes(REST)) return null;
  const fromItems = model.splitProject(from);
  const toItems = model.splitProject(to);
  const ops = [];
  for (const key of removed) {
    const kind = model.kindOf(key);
    if (!ITEM_CMDS[kind]) return null; // tekil öğe silinemez (layout vb.)
    ops.push({ cmd: ITEM_CMDS[kind][1], data: fromItems[key], key });
  }
  const byOrder = (k) => SET_ORDER.indexOf(model.kindOf(k));
  for (const key of [...changed].sort((a, b) => byOrder(a) - byOrder(b))) {
    const kind = model.kindOf(key);
    const cmd = ITEM_CMDS[kind] ? ITEM_CMDS[kind][0] : SINGLE_CMDS[kind];
    if (!cmd) return null;
    ops.push({ cmd, data: toItems[key], key });
  }
  return ops;
}

/** Kullanıcıya gösterilecek kısa öğe adları: "ekran Main", "cihaz PLC1". */
const KIND_TR = {
  device: 'bağlantı', view: 'ekran', script: 'script', text: 'metin', alarm: 'alarm', notification: 'bildirim',
  report: 'rapor', mapsLocation: 'harita konumu', arMarker: 'AR işareti', layout: 'yerleşim', charts: 'grafikler',
  graphs: 'çizelgeler', languages: 'diller', clientAccess: 'istemci erişimi', [REST]: 'proje ayarları',
};

function describe(keys, ...projects) {
  return keys.map((key) => {
    const kind = model.kindOf(key);
    const obj = projects.map((p) => p && itemOf(p, key)).find(Boolean);
    const name = key.includes(':') ? ((obj && obj.name) || key.slice(kind.length + 1)) : '';
    return `${KIND_TR[kind] || kind}${name ? ` "${name}"` : ''}`;
  });
}

module.exports = { REST, ITEM_CMDS, SINGLE_CMDS, fingerprints, diff, putItem, merge, planOps, describe };
