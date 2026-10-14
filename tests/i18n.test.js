'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const i18n = require('../src/core/i18n');
const lint = require('../src/core/lint');
const model = require('../src/core/model');
const { patchEditor } = require('../integrations/native-ads/editor');

const withLanguage = (lang, fn) => {
  const prev = i18n.getLanguage();
  i18n.setLanguage(lang);
  try { return fn(); } finally { i18n.setLanguage(prev); }
};

test('iki dilde aynı metin anahtarları var', () => {
  assert.deepEqual(Object.keys(i18n.STRINGS.en).sort(), Object.keys(i18n.STRINGS.tr).sort());
});

test('kullanılan her metin anahtarı tabloda var', () => {
  const root = path.resolve(__dirname, '../src');
  const files = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(js|html)$/.test(e.name) && e.name !== 'i18n.js') files.push(p);
  });
  walk(root);
  const keys = new Set();
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    for (const m of text.matchAll(/\bt\('([\w.]+)'/g)) keys.add(m[1]);
    for (const m of text.matchAll(/data-i18n(?:-title|-placeholder)?="([\w.]+)"/g)) keys.add(m[1]);
    for (const m of text.matchAll(/confirmDiscard\('([\w.]+)'\)/g)) keys.add(m[1]);
  }
  const missing = [...keys].filter((k) => !(k in i18n.STRINGS.tr));
  assert.deepEqual(missing, []);
  assert.ok(keys.size > 100, `${keys.size} anahtar bulundu`);
});

test('dil seçimi, yer tutucular ve sistem dili', () => {
  assert.equal(i18n.resolve('tr-TR'), 'tr');
  assert.equal(i18n.resolve('en-US'), 'en');
  assert.equal(i18n.resolve('de-DE'), 'en');
  withLanguage('en', () => assert.equal(i18n.t('ui.tagCount', { shown: 2, total: 5 }), '2 / 5 tags'));
  withLanguage('tr', () => assert.equal(i18n.t('ui.tagCount', { shown: 2, total: 5 }), '2 / 5 tag'));
  assert.deepEqual(i18n.all('project.untitled'), ['Adsız', 'Untitled']);
});

test('lint mesajları seçili dilde, seviye kodu dilden bağımsız', () => {
  const prj = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/fuxa1_live.json'), 'utf8'));
  const view = Object.values(prj.hmi.views)[0];
  const item = Object.values(view.items)[0];
  item.property = { ...(item.property || {}), variableId: 't_yok' };
  const en = withLanguage('en', () => lint.lint(model.splitProject(prj)));
  const tr = withLanguage('tr', () => lint.lint(model.splitProject(prj)));
  assert.ok(en.some((f) => f.level === lint.ERROR && f.message === 'bound tag does not exist: t_yok'));
  assert.ok(tr.some((f) => f.level === lint.ERROR && f.message === 'bağlı tag yok: t_yok'));
});

const dist = path.resolve(__dirname, '../fuxa-runtime/node_modules/@frangoteam/fuxa/dist');
test('ADS form etiketleri editör diline göre', { skip: !fs.existsSync(dist) }, () => {
  const file = path.join(dist, fs.readdirSync(dist).find((n) => /^main\.[\w]+\.js$/.test(n)));
  const original = fs.readFileSync(file, 'utf8');
  const en = patchEditor(original, 'en');
  const tr = patchEditor(original, 'tr');
  assert.ok(en.includes('"Connection method · fuxaw ADS"') && !en.includes('Bağlantı yöntemi'));
  assert.ok(tr.includes('"Bağlantı yöntemi · fuxaw ADS"') && !tr.includes('Connection method · fuxaw ADS'));
  assert.ok(en.includes('"ADSclient (original)"') && tr.includes('"ADSclient (orijinal)"'));
});
