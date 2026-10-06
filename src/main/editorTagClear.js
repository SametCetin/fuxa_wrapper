'use strict';

/** Gömülü editöre servis edilen kopyayı düzeltir; paket dosyalarını değiştirmez. */
function installEditorTagClear(engineDir, transform = source => source) {
  const fs = require('node:fs');
  const path = require('node:path');
  const engineRequire = require('node:module').createRequire(path.join(engineDir, 'main.js'));
  const version = engineRequire('./package.json').version;
  if (version !== '1.3.4') throw new Error('Tag bağlantısı düzeltmesi bu editör sürümüyle doğrulanmamış.');
  const dist = path.join(engineDir, 'dist');
  const bundles = fs.readdirSync(dist).filter(name => /^main\.[\w]+\.js$/.test(name));
  if (bundles.length !== 1) throw new Error('Editör betiği bulunamadı.');
  const source = fs.readFileSync(path.join(dist, bundles[0]), 'utf8');
  const needle = 'onChanged(){if(this.tagFilter.value?.startsWith';
  if (source.split(needle).length !== 3) throw new Error('Editör tag seçicisi değişmiş; düzeltme doğrulanmalı.');
  // Her iki tag seçicisinde de boş arama metni eski variableId'yi koruyordu.
  const patched = transform(source.replaceAll(needle,
    'onChanged(){if(typeof this.tagFilter.value==="string"&&!this.tagFilter.value.trim())this.variableId=null;if(this.tagFilter.value?.startsWith'));
  const express = engineRequire('express');
  const originalStatic = express.static;
  express.static = function (root, ...args) {
    const fallback = originalStatic.call(this, root, ...args);
    if (path.resolve(root) !== path.resolve(dist)) return fallback;
    return (req, res, next) => {
      if ((req.method === 'GET' || req.method === 'HEAD') && req.path === '/' + bundles[0]) {
        return res.type('application/javascript').set('Cache-Control', 'no-store').send(patched);
      }
      return fallback(req, res, next);
    };
  };
  // Başlatıcı require(main)'den sonra global fabrika uyarlamasını kaldırır.
  return () => { express.static = originalStatic; };
}

module.exports = { installEditorTagClear };
