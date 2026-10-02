'use strict';
// .fxprj dosyası: tek dosya, girintili JSON (git'te farkı okunur).
//
//   {
//     "fxprj": 1,                       biçim sürümü
//     "name": "fuxa1",                  proje adı (publish klasörü/dosya adı)
//     "fuxaVersion": "1.3.4",           projenin hazırlandığı FUXA
//     "publish": {"dir": "publish"},    publish klasörü (.fxprj'e göre göreli veya mutlak)
//     "project": { ...FUXA projesi... } tag value/timestamp olmadan
//   }
//
// Düz FUXA proje JSON'u (editörde "Save Project As", eski <ad>_live.json) da açılabilir:
// içe aktarma sayılır, ilk kayıtta .fxprj yolu sorulur.

const fs = require('node:fs');
const path = require('node:path');
const model = require('./model');

const FORMAT_VERSION = 1;
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
      project: obj.project,
    };
    return { doc, imported: false };
  }
  if (isFuxaProject(obj)) {
    const name = obj.name || path.basename(fileName, path.extname(fileName)).replace(/_live$/, '');
    const doc = newDoc(name);
    doc.project = obj;
    return { doc, imported: true };
  }
  throw new FxprjError(`${fileName}: .fxprj ya da proje JSON dosyası değil`);
}

function read(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    throw new FxprjError(`${filePath} okunamadı: ${e.message}`);
  }
  return parse(text, filePath);
}

function serialize(doc) {
  const out = {
    fxprj: FORMAT_VERSION,
    name: doc.name,
    fuxaVersion: doc.fuxaVersion || FUXA_VERSION,
    publish: doc.publish || { dir: 'publish' },
    project: model.cleanProject(doc.project),
  };
  return JSON.stringify(out, null, 2) + '\n';
}

/** Önce geçici dosyaya yazar, sonra yerine taşır (yarım kalan kayıt eski dosyayı bozmasın). */
function write(filePath, doc) {
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, serialize(doc), 'utf8');
  fs.renameSync(tmp, filePath);
}

module.exports = { FORMAT_VERSION, EXT, FUXA_VERSION, FxprjError, safeName, emptyFuxaProject, newDoc, parse, read, serialize, write };
