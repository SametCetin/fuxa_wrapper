'use strict';
// .fxprj dosyası: tek dosya, girintili JSON (git'te farkı okunur).
//
//   {
//     "fxprj": 1,                       biçim sürümü (2 = klasör biçimi, "parts" var)
//     "name": "fuxa1",                  proje adı (publish klasörü/dosya adı)
//     "fuxaVersion": "1.3.4",           projenin hazırlandığı FUXA
//     "publish": {"dir": "publish"},    publish klasörü (.fxprj'e göre göreli veya mutlak)
//     "connections": {"dir": "connections", "default": "dev"}
//                                       isteğe bağlı: bağlantı ayarları ortam dosyalarında (envs.js)
//     "parts": {"views": [id…], …}      isteğe bağlı: ekran/bağlantı/script ayrı dosyalarda (folder.js)
//     "project": { ...FUXA projesi... } tag value/timestamp olmadan (klasör biçiminde parçalar hariç)
//   }
//
// Düz FUXA proje JSON'u (editörde "Save Project As", eski <ad>_live.json) da açılabilir:
// içe aktarma sayılır, ilk kayıtta .fxprj yolu sorulur.

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

/** Dosya içeriğinden belge: {doc, imported}. imported = düz FUXA JSON'du. */
function parse(text, fileName = '') {
  let obj;
  try {
    obj = JSON.parse(text.replace(/^﻿/, ''));
  } catch (e) {
    throw new FxprjError(`${fileName || 'dosya'} geçerli JSON değil: ${e.message}`);
  }
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
      project: migrateAdsPlugin(obj.project),
    };
    // Bağlantı ayarları ayrı ortam dosyalarında (bkz. envs.js)
    if (obj.connections && typeof obj.connections === 'object') doc.connections = { ...obj.connections };
    // Klasör biçimi: parçalar ayrı dosyalarda; read() birleştirir.
    if (obj.parts && typeof obj.parts === 'object') doc.parts = { ...obj.parts };
    return { doc, imported: false };
  }
  if (isFuxaProject(obj)) {
    const name = obj.name || path.basename(fileName, path.extname(fileName)).replace(/_live$/, '');
    const doc = newDoc(name);
    doc.project = migrateAdsPlugin(obj);
    return { doc, imported: true };
  }
  throw new FxprjError(`${fileName}: .fxprj ya da proje JSON dosyası değil`);
}

function hashText(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Dosya içeriğinin özeti; dosya yoksa/okunamıyorsa null. Klasör biçiminde parça dosyaları dahil. */
function fileHash(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
  let parts = false;
  try { parts = !!JSON.parse(text.replace(/^﻿/, '')).parts; } catch { /* bozuk: düz özet */ }
  try {
    return parts ? folder.hashFiles(text, folder.readFiles(path.dirname(filePath))) : hashText(text);
  } catch {
    return null;
  }
}

/** {doc, imported, hash}: hash okunan içeriğin özeti (fileHash ile karşılaştırılır). */
function read(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    throw new FxprjError(`${filePath} okunamadı: ${e.message}`);
  }
  const r = parse(text, filePath);
  if (!r.doc.parts) return { ...r, hash: hashText(text) };
  let files;
  try {
    files = folder.readFiles(path.dirname(filePath));
    r.doc.project = migrateAdsPlugin(folder.implode(r.doc.project, r.doc.parts, files));
  } catch (e) {
    throw new FxprjError(`${filePath}: ${e.message}`);
  }
  return { ...r, hash: folder.hashFiles(text, files) };
}

function serialize(doc) {
  const out = {
    fxprj: doc.parts ? 2 : 1, // eski sürümler klasör biçimini açmasın
    name: doc.name,
    fuxaVersion: doc.fuxaVersion || FUXA_VERSION,
    publish: doc.publish || { dir: 'publish' },
    ...(doc.connections ? { connections: doc.connections } : {}),
    ...(doc.parts ? { parts: doc.parts } : {}),
    project: model.cleanProject(doc.project),
  };
  return JSON.stringify(out, null, 2) + '\n';
}

/** Önce geçici dosyaya yazar, sonra yerine taşır (yarım kalan kayıt eski dosyayı bozmasın). Yazılanın özetini döner. */
function write(filePath, doc) {
  let files = null;
  if (doc.parts) {
    // Önce parça dosyaları (sadece değişenler), en son .fxprj.
    const ex = folder.explode(model.cleanProject(doc.project));
    files = ex.files;
    folder.writeFiles(path.dirname(filePath), files);
    doc = { ...doc, parts: ex.parts, project: ex.rest };
  }
  const text = serialize(doc);
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, filePath);
  return files ? folder.hashFiles(text, files) : hashText(text);
}

module.exports = { FORMAT_VERSION, EXT, FUXA_VERSION, FxprjError, safeName, emptyFuxaProject, newDoc, parse, read, serialize, write, fileHash };
