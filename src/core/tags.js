'use strict';
// Tag tablosu: tüm tag'ler + kullanıldıkları yerler (ekran öğeleri, event'ler, script'ler).

const model = require('./model');
const { GET_TAG_ID } = require('./lint');

const byText = (f) => (a, b) => String(f(a)).localeCompare(String(f(b)));

function tagTable(items) {
  const rows = [];
  const byId = new Map();
  const devices = model.itemsOfKind(items, 'device').sort(byText(([k, v]) => model.label(k, v)));
  for (const [, dev] of devices) {
    const tags = Object.entries(dev.tags || {}).sort(byText(([, t]) => t.name || ''));
    for (const [tid, tag] of tags) {
      const row = {
        id: tid, name: tag.name || '', type: tag.type || '', address: tag.address || '',
        deviceId: dev.id, device: dev.name || '', deviceType: dev.type || '', uses: [],
      };
      rows.push(row);
      byId.set(tid, row);
    }
  }
  const byName = new Map();
  for (const r of rows) {
    if (!byName.has(r.name)) byName.set(r.name, []);
    byName.get(r.name).push(r);
  }
  for (const [, view] of model.itemsOfKind(items, 'view')) {
    for (const [gid, ga] of Object.entries(view.items || {})) {
      const where = `${view.name} / ${ga.name || gid}`;
      const prop = ga.property || {};
      if (byId.has(prop.variableId)) byId.get(prop.variableId).uses.push({ where, how: 'gösterim/renk' });
      for (const action of prop.actions || []) {
        if (byId.has(action.variableId)) byId.get(action.variableId).uses.push({ where, how: `aksiyon → ${action.type}` });
      }
      for (const ev of prop.events || []) {
        const opts = ev.actoptions || {};
        const tid = (opts.variable && opts.variable.variableId) || opts.variableId;
        if (byId.has(tid)) {
          byId.get(tid).uses.push({ where, how: `${ev.type} → ${ev.action} ${ev.actparam ?? ''}`.trim() });
        }
      }
    }
  }
  for (const [, sc] of model.itemsOfKind(items, 'script')) {
    for (const r of rows) {
      if ((sc.code || '').includes(r.id)) r.uses.push({ where: `script ${sc.name}`, how: 'tag kimliği' });
    }
    for (const m of (sc.code || '').matchAll(GET_TAG_ID)) {
      for (const r of byName.get(m[2]) || []) {
        if (m[4] === undefined || m[4] === r.device) r.uses.push({ where: `script ${sc.name}`, how: '$getTagId' });
      }
    }
  }
  return rows;
}

/** Silinecek cihaz kopyası; proje ve diğer taglar değiştirilmez. */
function prepareTagRemoval(project, spec) {
  const device = project.devices && Object.hasOwn(project.devices, spec.deviceId) && project.devices[spec.deviceId];
  if (!device || !device.tags || !Object.hasOwn(device.tags, spec.tagId)) {
    return { errors: ['Tag bulunamadı; listeyi yenile.'] };
  }
  const row = tagTable(model.splitProject(project)).find(r => r.deviceId === device.id && r.id === spec.tagId);
  const updated = model.clone(device);
  delete updated.tags[spec.tagId];
  return { device: updated, tag: device.tags[spec.tagId], uses: row ? row.uses : [] };
}

// ---------------------------------------------------------------- yeni tag
// Editörün tag pencerelerinin ürettiği biçim (FUXA 1.3.4). ADS: tip anahtarları (Number/Boolean/String) ve adres.
// Sunucu içi (FuxaServer/internal): küçük harfli tip, adres yok, başlangıç değeri (init) var.
const INTERNAL_TYPES = new Set(['FuxaServer', 'internal']);
const TYPES = {
  ADSclient: ['Boolean', 'Number', 'String'],
  internal: ['number', 'boolean', 'string'],
};

function isInternal(deviceType) {
  return INTERNAL_TYPES.has(deviceType);
}

/** Cihaz tipine göre seçilebilecek tag tipleri; bilinmeyen cihazda cihazdaki mevcut tipler. */
function tagTypesFor(device) {
  if (device.type === 'ADSclient' || device.type === 'FuxawADS') return TYPES.ADSclient;
  if (isInternal(device.type)) return TYPES.internal;
  const seen = [...new Set(Object.values(device.tags || {}).map((t) => t.type).filter(Boolean))];
  return seen.sort();
}

/** Yeni tag id'si: t_xxxxxxxx-xxxxxxxx (editörün biçimi). */
function newTagId(existing, random = () => require('node:crypto').randomBytes(8).toString('hex')) {
  for (;;) {
    const h = random();
    const id = `t_${h.slice(0, 8)}-${h.slice(8, 16)}`;
    if (!existing || !(id in existing)) return id;
  }
}

/**
 * Cihaza eklenecek tag'i oluşturur. Hatalıysa {errors: [...]}, değilse {tag}.
 * spec: {name, type, address, description, init}
 */
function buildTag(device, spec, id = newTagId(device.tags)) {
  const errors = [];
  const name = String(spec.name || '').trim();
  const type = String(spec.type || '').trim();
  const address = String(spec.address || '').trim();
  const description = String(spec.description || '').trim();
  const internal = isInternal(device.type);
  const types = tagTypesFor(device);
  if (!name) errors.push('Ad boş olamaz.');
  else if (Object.values(device.tags || {}).some((t) => String(t.name).toLowerCase() === name.toLowerCase())) {
    errors.push(`"${device.name}" cihazında "${name}" adlı tag zaten var.`);
  }
  if (!type) errors.push('Tip seçilmeli.');
  else if (types.length && !types.includes(type)) errors.push(`Bu cihaz için geçersiz tip: ${type}`);
  if (!internal && !address) errors.push('Adres boş olamaz.');
  if (errors.length) return { errors };

  const daq = { enabled: false, interval: 60, changed: false, restored: false };
  const tag = internal
    ? { id, name, label: name, type, init: String(spec.init ?? ''), daq, description: description || null }
    : { id, name, type, address, daq, description: description || null };
  return { tag };
}

module.exports = { tagTable, tagTypesFor, isInternal, newTagId, buildTag, prepareTagRemoval };
