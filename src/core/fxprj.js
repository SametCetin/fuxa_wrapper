'use strict';
// Proje = bir klasör: .fxprj (başlık) + ekran/bağlantı/script dosyaları (folder.js).
//
//   fuxa1/
//   ├─ fuxa1.fxprj           {"fxprj": 2, "name", "fuxaVersion", "publish": {"dir"},
//   │                          "parts": {"views": [id…], "devices": [id…], "scripts": [id…]},  (sıra)
//   │                          "project": {…geri kalan: layout, metinler, alarmlar…}}
//   ├─ views/<ad>.json + .svg
//   ├─ devices/<ad>.json     (tag'leriyle)
//   └─ scripts/<ad>.json + .js
//
// Ekran çizimi ve script kodu düz metin dosyalarda: AI ajanı tek bir ekranı/script'i rahatça
// düzenler, git farkı satır satır okunur. Tag value/timestamp yazılmaz. Bir klasörde tek proje.
//
// İçe aktarılanlar (ilk kayıtta yer sorulur, klasör biçiminde yazılır):
//   - eski tek dosya .fxprj ("fxprj": 1, proje tek JSON içinde)
//   - düz FUXA proje JSON'u (editörde "Save Project As", eski <ad>_live.json)

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const model = require('./model');
const folder = require('./folder');

const FORMAT_VERSION = 2;
const EXT = '.fxprj';
const FUXA_VERSION = '1.3.4';

class FxprjError extends Error {}

function safeName(name) {
  const s = String(name || '').trim().replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_').replace(/^\.+|\.+$/g, '');
  return s || 'proje';
}

function emptyFuxaProject(name) {
  return {
    version: '1.00',
    name,
    devices: {},
    hmi: { views: [] },
    server: { id: '0', name: 'FUXA Server', type: 'FuxaServer', property: {} },
  };
}

function newDoc(name) {
  return {
    fxprj: FORMAT_VERSION,
    name,
    fuxaVersion: FUXA_VERSION,
    publish: { dir: 'publish' },
    project: emptyFuxaProject(name),
  };
}

function isFuxaProject(obj) {
  return obj && typeof obj === 'object' && obj.hmi && typeof obj.hmi === 'object';
}

// Earlier wrapper releases stored the plugin method under the original type.
// The explicit method is our marker; ordinary original ADS projects stay as-is.
function migrateAdsPlugin(project) {
  for (const device of Object.values(project.devices || {})) {
    if (device.type === 'ADSclient' && ['native', 'tcp'].includes(device.property?.adsTransport)) {
      device.type = 'FuxawADS';
    }
  }
  return project;
}

function parseJson(text, fileName) {
  try {
    return JSON.parse(text.replace(/^﻿/, ''));
  } catch (e) {
    throw new FxprjError(`${fileName || 'dosya'} geçerli JSON değil: ${e.message}`);
  }
}

/**
 * Dosya içeriğinden belge: {doc, imported, parts}. imported = eski tek dosya .fxprj ya da düz
 * FUXA JSON'u (yolu yok sayılır, ilk kayıtta sorulur). Klasör biçiminde doc.project parçasızdır;
 * read() parçaları dosyalardan ekler.
 */
function parse(text, fileName = '') {
  const obj = parseJson(text, fileName);
  if (obj && typeof obj === 'object' && 'fxprj' in obj) {
    if (typeof obj.fxprj !== 'number' || obj.fxprj > FORMAT_VERSION) {
      throw new FxprjError(`${fileName}: .fxprj biçim sürümü ${obj.fxprj} desteklenmiyor (en fazla ${FORMAT_VERSION}). Uygulamayı güncelle.`);
    }
    if (!isFuxaProject(obj.project)) throw new FxprjError(`${fileName}: "project" alanı geçerli bir proje değil`);
    const doc = {
      fxprj: FORMAT_VERSION,
      name: obj.name || obj.project.name || path.basename(fileName, EXT),
      fuxaVersion: obj.fuxaVersion || FUXA_VERSION,
      publish: { dir: 'publish', ...(obj.publish || {}) },
      project: obj.project,
    };
    if (obj.fxprj < 2) return { doc: { ...doc, project: migrateAdsPlugin(doc.project) }, imported: true, parts: null };
    if (!obj.parts || typeof obj.parts !== 'object') throw new FxprjError(`${fileName}: "parts" alanı yok`);
    return { doc, imported: false, parts: obj.parts };
  }
  if (isFuxaProject(obj)) {
    const name = obj.name || path.basename(fileName, path.extname(fileName)).replace(/_live$/, '');
    const doc = newDoc(name);
    doc.project = migrateAdsPlugin(obj);
    return { doc, imported: true, parts: null };
  }
  throw new FxprjError(`${fileName}: .fxprj ya da proje JSON dosyası değil`);
}

function hashText(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/** .fxprj + parça dosyalarının özeti; dosya yoksa/okunamıyorsa null. Dışarıdan değişiklik tespiti için. */
function fileHash(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
  let parts = false;
  try { parts = !!JSON.parse(text.replace(/^﻿/, '')).parts; } catch { /* yarım yazılmış: düz özet */ }
  try {
    return parts ? folder.hashFiles(text, folder.readFiles(path.dirname(filePath))) : hashText(text);
  } catch {
    return null;
  }
}

/** {doc, imported, hash}: doc.project tam proje; hash fileHash ile karşılaştırılır. */
function read(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    throw new FxprjError(`${filePath} okunamadı: ${e.message}`);
  }
  const { doc, imported, parts } = parse(text, filePath);
  if (!parts) return { doc, imported, hash: hashText(text) };
  let files;
  try {
    files = folder.readFiles(path.dirname(filePath));
    doc.project = migrateAdsPlugin(folder.implode(doc.project, parts, files));
  } catch (e) {
    throw new FxprjError(`${filePath}: ${e.message}`);
  }
  return { doc, imported, hash: folder.hashFiles(text, files) };
}

/** Başlık dosyasının metni (rest = parçaları çıkarılmış proje). */
function serialize(doc, parts, rest) {
  const out = {
    fxprj: FORMAT_VERSION,
    name: doc.name,
    fuxaVersion: doc.fuxaVersion || FUXA_VERSION,
    publish: doc.publish || { dir: 'publish' },
    parts,
    project: rest,
  };
  return JSON.stringify(out, null, 2) + '\n';
}

/**
 * Projeyi klasöre yaz: önce parça dosyaları (sadece değişenler, artık olmayanlar silinir),
 * en son .fxprj (geçici dosya + rename). Yazılanın özetini döner.
 */
function write(filePath, doc) {
  const { rest, parts, files } = folder.explode(model.cleanProject(doc.project));
  folder.writeFiles(path.dirname(filePath), files);
  const text = serialize(doc, parts, rest);
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, filePath);
  return folder.hashFiles(text, files);
}

/**
 * Bu klasöre proje yazılabilir mi? Başka bir .fxprj ya da dolu parça klasörü varsa
 * (başka projenin dosyaları silinebilirdi) neden döner, yoksa null.
 */
function folderConflict(filePath) {
  const dir = path.dirname(filePath);
  let names;
  try { names = fs.readdirSync(dir); } catch { return null; } // klasör yok: oluşturulur
  const others = names.filter((f) => f.toLowerCase().endsWith(EXT) && f.toLowerCase() !== path.basename(filePath).toLowerCase());
  if (others.length) return `klasörde başka proje var (${others.join(', ')})`;
  if (!fs.existsSync(filePath)) {
    const used = Object.keys(folder.KINDS).filter((k) => {
      try { return fs.readdirSync(path.join(dir, k)).length > 0; } catch { return false; }
    });
    if (used.length) return `${used.map((k) => `${k}/`).join(', ')} klasörü dolu`;
  }
  return null;
}

module.exports = {
  FORMAT_VERSION, EXT, FUXA_VERSION, FxprjError, safeName, emptyFuxaProject, newDoc, parse, read, serialize, write, fileHash, folderConflict,
};
