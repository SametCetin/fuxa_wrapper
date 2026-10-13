'use strict';
// Bağlantı ortamları: cihazların bağlantı ayarları .fxprj'den ayrı, ortam başına bir dosyada.
//
//   proje.fxprj               "connections": {"dir": "connections", "default": "dev"}
//                             cihazlar: ad, tür, tag'ler (bağlantı alanları yok)
//   connections/dev.json      {"<cihaz id>": {"name", "enabled", "polling", "property"}}
//   connections/saha.json
//
// Böylece ekranlar ve tag'ler tek ve ortak kalır; geliştirme ile sahadaki PLC adresi, açık/kapalı
// durumu ve okuma aralığı ayrı dosyalarda durur. Hangi ortamın etkin olduğu kişiye özeldir
// (uygulama ayarlarında; .fxprj'de sadece varsayılan). "connections" alanı olmayan .fxprj
// eski düzendir: ayarlar projenin içindedir.
//
// Sunucu içi cihazlar (FUXA Server) ortam dosyasına girmez.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const model = require('./model');
const { isInternal } = require('./tags');

const FIELDS = ['enabled', 'polling', 'property'];
const DEFAULT_DIR = 'connections';
const NAME_RE = /^[\w.-]+$/; // ortam adı = dosya adı

class EnvError extends Error {}

function isSplit(doc) {
  return !!(doc && doc.connections && typeof doc.connections === 'object');
}

function externalDevices(prj) {
  return Object.values((prj && prj.devices) || {}).filter((d) => d && d.id !== undefined && !isInternal(d.type));
}

/** Projeden bağlantı ayarlarını ayır: {project: alanları atılmış kopya, conn: ortam içeriği}. */
function extract(prj) {
  const project = model.clone(prj);
  const conn = {};
  for (const dev of externalDevices(project)) {
    const entry = { name: dev.name };
    for (const f of FIELDS) {
      if (dev[f] !== undefined) entry[f] = dev[f];
      delete dev[f];
    }
    conn[dev.id] = entry;
  }
  return { project, conn };
}

/**
 * Ortam ayarlarını projeye uygula. Ortamda ayarı olmayan harici cihaz kapalı ve boş adresle
 * yüklenir ve "missing" listesine girer (publish'te hata).
 */
function compose(prj, conn) {
  const project = model.clone(prj);
  const missing = [];
  for (const dev of externalDevices(project)) {
    const entry = conn && conn[dev.id];
    if (!entry) {
      missing.push(dev.name || dev.id);
      dev.enabled = false;
      if (dev.property === undefined) dev.property = {};
      continue;
    }
    for (const f of FIELDS) {
      if (entry[f] !== undefined) dev[f] = model.clone(entry[f]);
    }
  }
  return { project, missing };
}

function resolveDir(doc, fxprjPath) {
  const dir = (doc.connections && doc.connections.dir) || DEFAULT_DIR;
  if (path.isAbsolute(dir)) return dir;
  return fxprjPath ? path.resolve(path.dirname(fxprjPath), dir) : null;
}

function envFile(dir, name) {
  if (!NAME_RE.test(name)) throw new EnvError(`Geçersiz ortam adı "${name}": harf, rakam, "_", "-", "." kullan.`);
  return path.join(dir, `${name}.json`);
}

function list(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.json'))
      .map((f) => f.slice(0, -5)).filter((n) => NAME_RE.test(n)).sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

/** {conn, text}: dosya yoksa conn null. */
function read(dir, name) {
  const file = envFile(dir, name);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { conn: null, text: '' };
  }
  let obj;
  try {
    obj = JSON.parse(text.replace(/^﻿/, ''));
  } catch (e) {
    throw new EnvError(`${file} geçerli JSON değil: ${e.message}`);
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new EnvError(`${file}: ortam dosyası bir nesne olmalı`);
  return { conn: obj, text };
}

/** Cihaz adına göre sıralı, girintili JSON (git farkı düzgün kalsın). */
function serialize(conn) {
  const ids = Object.keys(conn).sort((a, b) => String(conn[a].name || a).localeCompare(String(conn[b].name || b)) || a.localeCompare(b));
  const out = {};
  for (const id of ids) {
    const e = conn[id];
    out[id] = { name: e.name };
    for (const f of FIELDS) if (e[f] !== undefined) out[id][f] = e[f];
  }
  return JSON.stringify(out, null, 2) + '\n';
}

function write(dir, name, conn) {
  const file = envFile(dir, name);
  fs.mkdirSync(dir, { recursive: true });
  const text = serialize(conn);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
  return text;
}

/** .fxprj ve etkin ortam dosyası içeriğinden tek özet (dışarıdan değişiklik tespiti). */
function combinedHash(fxprjHash, envText) {
  if (!fxprjHash) return null;
  if (envText === undefined) return fxprjHash;
  return crypto.createHash('sha256').update(fxprjHash).update('\0').update(envText || '').digest('hex');
}

module.exports = {
  FIELDS, DEFAULT_DIR, EnvError, isSplit, extract, compose, resolveDir, envFile, list, read, serialize, write, combinedHash,
};
