'use strict';
// Proje klasörü (.fxprj biçim 2): ekranlar, bağlantılar ve script'ler ayrı dosyalarda.
//
//   proje.fxprj           "parts": {"views": [id…], "devices": [id…], "scripts": [id…]}  (sıra)
//                         "project": geri kalan (layout, metinler, alarmlar, …)
//   views/<ad>.json       ekran (svgcontent hariç)       views/<ad>.svg   çizim
//   devices/<ad>.json     bağlantı + tag'leri
//   scripts/<ad>.json     script (code hariç)            scripts/<ad>.js  kod
//
// Öğeler dosya adıyla değil içlerindeki id ile eşlenir; ad değişince dosya adı da değişir.
// Böylece git farkı/birleştirmesi öğe başına olur, AI ajanı tek bir ekranı okuyup yazabilir,
// aynı adlı iki ekran dosya sisteminde oluşamaz. Kaydet sadece içeriği değişen dosyaları yazar.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const model = require('./model');

// tür -> proje içindeki yeri, dizi mi, ayrı dosyaya alınan gövde alanı
const KINDS = {
  views: { path: 'hmi.views', array: true, body: 'svgcontent', ext: '.svg' },
  devices: { path: 'devices', array: false },
  scripts: { path: 'scripts', array: true, body: 'code', ext: '.js' },
};

class FolderError extends Error {}

function safeFileName(name) {
  const s = String(name || '').trim().replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_').replace(/^\.+|[. ]+$/g, '');
  // Windows'ta ayrılmış adlar (CON, NUL, COM1…)
  return !s ? '_' : /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s) ? `_${s}` : s;
}

function getColl(prj, kind) {
  const coll = model.getPath(prj, KINDS[kind].path);
  if (!coll) return [];
  return KINDS[kind].array ? coll.filter(Boolean) : Object.values(coll).filter(Boolean);
}

/** Her öğeye benzersiz dosya adı (büyük/küçük harf farkı aynı sayılır; çakışırsa id eklenir). */
function fileNames(items) {
  const count = new Map();
  for (const o of items) {
    const k = safeFileName(o.name).toLowerCase();
    count.set(k, (count.get(k) || 0) + 1);
  }
  return items.map((o) => {
    const base = safeFileName(o.name);
    return count.get(base.toLowerCase()) > 1 ? `${base}__${safeFileName(o.id)}` : base;
  });
}

/**
 * Proje -> {rest, parts, files}: rest = parçalar çıkarılmış proje, parts = tür başına id sırası,
 * files = {"views/Main.json": metin, …} (yollar / ile).
 */
function explode(project) {
  const rest = model.clone(project);
  const parts = {};
  const files = {};
  for (const [kind, k] of Object.entries(KINDS)) {
    const items = getColl(project, kind);
    parts[kind] = items.map((o) => String(o.id));
    fileNames(items).forEach((name, i) => {
      const obj = model.clone(items[i]);
      if (k.body) {
        const body = typeof obj[k.body] === 'string' ? obj[k.body] : '';
        delete obj[k.body];
        files[`${kind}/${name}${k.ext}`] = body;
      }
      files[`${kind}/${name}.json`] = JSON.stringify(obj, null, 2) + '\n';
    });
    setPath(rest, k.path, undefined);
  }
  return { rest, parts, files };
}

function setPath(obj, p, val) {
  const keys = p.split('.');
  let o = obj;
  for (const key of keys.slice(0, -1)) {
    if (!o[key] || typeof o[key] !== 'object') {
      if (val === undefined) return;
      o[key] = {};
    }
    o = o[key];
  }
  if (val === undefined) delete o[keys[keys.length - 1]];
  else o[keys[keys.length - 1]] = val;
}

function listDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return [];
  }
}

/** Klasördeki parça dosyalarının metinleri: {"views/Main.json": metin, …}. */
function readFiles(root) {
  const files = {};
  for (const [kind, k] of Object.entries(KINDS)) {
    for (const name of listDir(path.join(root, kind))) {
      const lower = name.toLowerCase();
      if (!lower.endsWith('.json') && !(k.ext && lower.endsWith(k.ext))) continue;
      files[`${kind}/${name}`] = fs.readFileSync(path.join(root, kind, name), 'utf8');
    }
  }
  return files;
}

/**
 * rest + parts sırası + dosyalar -> proje. Sırada olmayan (ör. dışarıda eklenen) öğeler sona,
 * dosya adına göre eklenir; dosyası olmayan id atlanır (silinmiş).
 */
function implode(rest, parts, files) {
  const project = model.clone(rest);
  for (const [kind, k] of Object.entries(KINDS)) {
    const byId = new Map();
    const jsons = Object.keys(files).filter((f) => f.startsWith(`${kind}/`) && f.toLowerCase().endsWith('.json')).sort();
    for (const f of jsons) {
      let obj;
      try {
        obj = JSON.parse(files[f].replace(/^﻿/, ''));
      } catch (e) {
        throw new FolderError(`${f} geçerli JSON değil: ${e.message}`);
      }
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new FolderError(`${f}: nesne olmalı`);
      if (obj.id === undefined || obj.id === null || obj.id === '') throw new FolderError(`${f}: "id" alanı yok`);
      const id = String(obj.id);
      if (byId.has(id)) throw new FolderError(`${f} ve ${byId.get(id).file} aynı id'yi (${id}) kullanıyor`);
      if (k.body) {
        const bodyFile = f.slice(0, -5) + k.ext;
        const body = Object.keys(files).find((x) => x.toLowerCase() === bodyFile.toLowerCase());
        if (body !== undefined) obj[k.body] = files[body];
      }
      byId.set(id, { obj, file: f });
    }
    const order = ((parts && parts[kind]) || []).map(String).filter((id) => byId.has(id));
    const extra = [...byId.keys()].filter((id) => !order.includes(id));
    const items = [...order, ...extra].map((id) => byId.get(id).obj);
    if (k.array) {
      setPath(project, k.path, items);
    } else {
      const coll = {};
      for (const o of items) coll[o.id] = o;
      setPath(project, k.path, coll);
    }
  }
  return project;
}

/**
 * Dosyaları yaz: sadece içeriği değişenleri (atomik), klasörlerde artık olmayan parça dosyalarını sil.
 * Dönüş: {written: [...], removed: [...]}.
 */
function writeFiles(root, files) {
  const written = [];
  const removed = [];
  const existing = readFiles(root);
  for (const [rel, text] of Object.entries(files)) {
    if (existing[rel] === text) continue;
    const file = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Windows'ta yalnız büyük/küçük harfi değişen ad: önce eskisini kaldır.
    const sameCase = Object.keys(existing).find((x) => x !== rel && x.toLowerCase() === rel.toLowerCase());
    if (sameCase) fs.rmSync(path.join(root, ...sameCase.split('/')), { force: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, text, 'utf8');
    fs.renameSync(tmp, file);
    written.push(rel);
  }
  const wanted = new Set(Object.keys(files).map((f) => f.toLowerCase()));
  for (const rel of Object.keys(existing)) {
    if (!wanted.has(rel.toLowerCase())) {
      fs.rmSync(path.join(root, ...rel.split('/')), { force: true });
      removed.push(rel);
    }
  }
  return { written, removed };
}

/** .fxprj metni + parça dosyalarından tek özet (dışarıdan değişiklik tespiti). */
function hashFiles(mainText, files) {
  const h = crypto.createHash('sha256').update(mainText, 'utf8');
  for (const rel of Object.keys(files).sort()) h.update('\0').update(rel).update('\0').update(files[rel], 'utf8');
  return h.digest('hex');
}

module.exports = { KINDS, FolderError, safeFileName, explode, implode, readFiles, writeFiles, hashFiles };
