'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { locateRuntime } = require('../src/main/runtime');
const { contentHash } = require('../scripts/after-pack');

function tmp(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'fuxaw-runtime-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

test('kurulumsuz paket: runtime resources içinde', (t) => {
  const res = tmp(t);
  fs.mkdirSync(path.join(res, 'fuxa'));
  assert.deepEqual(locateRuntime({ resourcesPath: res, programData: path.join(res, 'pd') }), { dir: res });
});

test('NSIS kurulumu: runtime ProgramData altında, .complete şart', (t) => {
  const root = tmp(t);
  const res = path.join(root, 'res'); const pd = path.join(root, 'pd');
  fs.mkdirSync(res);
  fs.writeFileSync(path.join(res, 'fuxaw-runtime.json'), JSON.stringify({ id: 'fuxa-1.3.4_node-24.19.0_abc' }));
  const dir = path.join(pd, 'fuxaw-runtime', 'fuxa-1.3.4_node-24.19.0_abc');
  fs.mkdirSync(dir, { recursive: true });
  assert.deepEqual(locateRuntime({ resourcesPath: res, programData: pd }), { missing: dir }); // yarım kalmış
  fs.writeFileSync(path.join(dir, '.complete'), 'x');
  assert.deepEqual(locateRuntime({ resourcesPath: res, programData: pd }), { dir });
});

test('kimlik dosyası yok ya da geçersiz: eksik', (t) => {
  const res = tmp(t);
  assert.ok(locateRuntime({ resourcesPath: res, programData: res }).missing);
  fs.writeFileSync(path.join(res, 'fuxaw-runtime.json'), JSON.stringify({ id: '..\\..\\x' }));
  assert.ok(locateRuntime({ resourcesPath: res, programData: res }).missing);
});

test('runtime kimliği içerikten: aynı içerik aynı, farklı içerik farklı', (t) => {
  const a = tmp(t); const b = tmp(t);
  for (const d of [a, b]) {
    fs.mkdirSync(path.join(d, 'x', 'y'), { recursive: true });
    fs.writeFileSync(path.join(d, 'x', 'y', 'f.js'), 'abc');
    fs.writeFileSync(path.join(d, 'g.txt'), '1');
  }
  assert.equal(contentHash(a), contentHash(b));
  fs.writeFileSync(path.join(b, 'g.txt'), '2');
  assert.notEqual(contentHash(a), contentHash(b));
});
