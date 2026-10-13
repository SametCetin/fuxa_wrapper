'use strict';
// Bağlantı ortamları (src/core/envs.js) ve ortamlı publish.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const model = require('../src/core/model');
const envs = require('../src/core/envs');
const fxprj = require('../src/core/fxprj');
const publisher = require('../src/core/publish');

const LIVE_TEXT = fs.readFileSync(path.join(__dirname, 'fixtures', 'fuxa1_live.json'), 'utf8');
const DEV = 'd_31db3b81-3ebe4777';
const live = () => JSON.parse(LIVE_TEXT);
const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fuxaw-env-'));

test('extract: harici cihazın bağlantı alanları ayrılır, sunucu içi cihaz projede kalır', () => {
  const { project, conn } = envs.extract(live());
  assert.deepEqual(Object.keys(conn), [DEV]);
  assert.equal(conn[DEV].name, 'tc3_ads');
  assert.equal(conn[DEV].property.address, '127.0.0.1.1.1:851');
  assert.equal(conn[DEV].polling, 100);
  assert.equal(conn[DEV].enabled, true);
  for (const f of envs.FIELDS) assert.ok(!(f in project.devices[DEV]), f);
  assert.ok(Object.keys(project.devices[DEV].tags).length > 0); // tag'ler projede
  assert.deepEqual(project.devices['0'].property, live().devices['0'].property);
});

test('compose(extract) projeyi aynen geri verir', () => {
  const { project, conn } = envs.extract(live());
  const back = envs.compose(project, conn);
  assert.deepEqual(back.missing, []);
  assert.equal(model.digest(back.project), model.digest(live()));
});

test('compose: ortamda ayarı olmayan bağlantı kapalı yüklenir ve bildirilir', () => {
  const { project } = envs.extract(live());
  const r = envs.compose(project, {});
  assert.deepEqual(r.missing, ['tc3_ads']);
  assert.equal(r.project.devices[DEV].enabled, false);
  assert.deepEqual(r.project.devices[DEV].property, {});
});

test('ortam dosyası yaz/oku/listele, ad doğrulanır', () => {
  const dir = path.join(tmpdir(), 'connections');
  const { conn } = envs.extract(live());
  const text = envs.write(dir, 'saha', conn);
  assert.equal(envs.read(dir, 'saha').text, text);
  assert.deepEqual(envs.read(dir, 'saha').conn, conn);
  assert.equal(envs.read(dir, 'yok').conn, null);
  assert.deepEqual(envs.list(dir), ['saha']);
  assert.throws(() => envs.envFile(dir, '../x'), envs.EnvError);
  assert.deepEqual(fs.readdirSync(dir), ['saha.json']); // geçici dosya kalmaz
});

test('.fxprj "connections" alanını korur; resolveDir .fxprj klasörüne göre', () => {
  const dir = tmpdir();
  const file = path.join(dir, 'p.fxprj');
  const doc = fxprj.newDoc('p');
  doc.connections = { dir: 'connections', default: 'dev' };
  fxprj.write(file, doc);
  const back = fxprj.read(file).doc;
  assert.ok(envs.isSplit(back));
  assert.deepEqual(back.connections, { dir: 'connections', default: 'dev' });
  assert.equal(envs.resolveDir(back, file), path.join(dir, 'connections'));
  assert.ok(!envs.isSplit(fxprj.newDoc('q')));
});

test('combinedHash: ortam dosyası değişince özet değişir', () => {
  assert.equal(envs.combinedHash('abc', undefined), 'abc');
  assert.notEqual(envs.combinedHash('abc', 'x'), envs.combinedHash('abc', 'y'));
  assert.equal(envs.combinedHash(null, 'x'), null);
});

test('publish: ortamda ayarı olmayan bağlantı HATA, README ortamı yazar', () => {
  const dir = tmpdir();
  const file = path.join(dir, 'p1.fxprj');
  const doc = fxprj.newDoc('p1');
  doc.project = live();
  const bad = publisher.publish(doc, file, new Date(), { env: 'saha', missing: ['tc3_ads'] });
  assert.equal(bad.ok, false);
  assert.ok(bad.lint.some((f) => f.where === 'bağlantı tc3_ads' && f.message.includes('saha')));
  const ok = publisher.publish(doc, file, new Date(), { env: 'saha', missing: [] });
  assert.equal(ok.ok, true);
  assert.match(fs.readFileSync(ok.files[1], 'utf8'), /Bağlantı ortamı: \*\*saha\*\*/);
});
