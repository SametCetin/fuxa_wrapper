'use strict';
// Çekirdek modül testleri (FUXA ve Electron gerekmez): node --test tests/
// Test verisi: tests/fixtures/fuxa1_live.json (gerçek projenin kopyası).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const model = require('../src/core/model');
const { lint, ERROR } = require('../src/core/lint');
const { tagTable } = require('../src/core/tags');
const fxprj = require('../src/core/fxprj');
const publisher = require('../src/core/publish');

const LIVE_TEXT = fs.readFileSync(path.join(__dirname, 'fixtures', 'fuxa1_live.json'), 'utf8');
const DEV = 'd_31db3b81-3ebe4777';

function live() {
  const prj = JSON.parse(LIVE_TEXT);
  // Gerçek GET'teki gibi tag value/timestamp ekle
  for (const dev of Object.values(prj.devices)) {
    for (const tag of Object.values(dev.tags || {})) {
      tag.value = tag.type === 'Number' ? 0 : false;
      tag.timestamp = 0;
    }
  }
  return prj;
}

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fuxaw-test-'));
}

function errors(prj) {
  return lint(model.splitProject(prj)).filter((f) => f.level === ERROR);
}

// ---------------------------------------------------------------- model
test('tag value/timestamp değişikliği özeti değiştirmez', () => {
  const a = live();
  const b = live();
  for (const t of Object.values(b.devices[DEV].tags)) { t.value = 12345; t.timestamp = 1; }
  assert.equal(model.digest(a), model.digest(b));
  b.devices[DEV].tags[Object.keys(b.devices[DEV].tags)[0]].address = 'BAŞKA';
  assert.notEqual(model.digest(a), model.digest(b));
});

test('SVG öznitelik sırası özeti değiştirmez, içerik değişikliği değiştirir', () => {
  const a = live();
  const b = live();
  const v = b.hmi.views[0];
  v.svgcontent = v.svgcontent.replace('<filter id="blur-filter" x="-3" y="-3" width="200" height="200">',
    '<filter height="200" width="200" y="-3" x="-3" id="blur-filter">');
  assert.notEqual(v.svgcontent, a.hmi.views[0].svgcontent);
  assert.equal(model.digest(a), model.digest(b));
  v.svgcontent = v.svgcontent.replace('y="-3" x="-3"', 'y="-4" x="-3"');
  assert.notEqual(model.digest(a), model.digest(b));
});

test('cleanProject uçucu alanları atar, script satır sonlarını LF yapar, aslını bozmaz', () => {
  const prj = live();
  prj.scripts[0].code = 'a\r\nb';
  const c = model.cleanProject(prj);
  assert.equal(c.scripts[0].code, 'a\nb');
  assert.ok(!('value' in Object.values(c.devices[DEV].tags)[0]));
  assert.ok('value' in Object.values(prj.devices[DEV].tags)[0]);
});

// ---------------------------------------------------------------- lint
test('gerçek proje lint hatası vermez', () => {
  assert.deepEqual(errors(live()), []);
});

test("Boolean ADS tag'ine metin False yazmak hata", () => {
  const prj = live();
  for (const ga of Object.values(prj.hmi.views[0].items)) {
    for (const ev of (ga.property && ga.property.events) || []) {
      if (ev.type === 'mouseup') ev.actparam = 'False';
    }
  }
  assert.ok(errors(prj).some((f) => f.message.includes('1 / 0 kullan')));
});

test('aynı adlı iki ekran hata', () => {
  const prj = live();
  prj.hmi.views.push({ ...structuredClone(prj.hmi.views[0]), id: 'v_dup' });
  assert.ok(errors(prj).some((f) => f.message.includes('aynı adlı')));
});

test('olmayan tag ve script referansı hata', () => {
  const prj = live();
  delete prj.devices[DEV].tags['t_2c4f4e40-ccdc4848'];
  prj.scripts = [];
  const msgs = errors(prj).map((f) => f.message).join('\n');
  assert.match(msgs, /tag yok|bağlı tag yok/);
  assert.match(msgs, /script yok|\$getTagId/);
});

test("script'te olmayan tag adı ($getTagId) hata", () => {
  const prj = live();
  prj.scripts[0].code += "\nconst x = $getTagId('YokBoyleTag', 'tc3_ads');";
  assert.ok(errors(prj).some((f) => f.message.includes("'YokBoyleTag'")));
});

// ---------------------------------------------------------------- tag tablosu
test('tag tablosu kullanım yerlerini bulur', () => {
  const rows = tagTable(model.splitProject(live()));
  assert.ok(rows.length > 5);
  const used = rows.filter((r) => r.uses.length);
  assert.ok(used.length > 0);
  assert.ok(rows.every((r) => r.device && r.id.startsWith('t_')));
});

// ---------------------------------------------------------------- .fxprj
test('.fxprj yaz/oku: proje aynı kalır, uçucu alanlar yazılmaz', () => {
  const dir = tmpdir();
  const file = path.join(dir, 'p1.fxprj');
  const doc = fxprj.newDoc('p1');
  doc.project = live();
  fxprj.write(file, doc);
  const text = fs.readFileSync(file, 'utf8');
  // (Ekran event'lerindeki variableRaw kopyası FUXA'nın proje verisidir; ona dokunulmaz.)
  const savedTags = Object.values(JSON.parse(text).project.devices[DEV].tags);
  assert.ok(savedTags.every((t) => !('value' in t) && !('timestamp' in t)));
  assert.ok(!text.includes('\r\n'));
  const back = fxprj.read(file);
  assert.equal(back.imported, false);
  assert.equal(back.doc.name, 'p1');
  assert.equal(model.digest(back.doc.project), model.digest(doc.project));
  assert.deepEqual(fs.readdirSync(dir), ['p1.fxprj']); // geçici dosya kalmaz
});

test('düz FUXA JSON içe aktarılır (eski <ad>_live.json)', () => {
  const { doc, imported } = fxprj.parse(LIVE_TEXT, 'C:/x/fuxa1_live.json');
  assert.equal(imported, true);
  assert.equal(doc.name, 'fuxa1');
  assert.equal(doc.fxprj, fxprj.FORMAT_VERSION);
});

test('yeni sürüm .fxprj ve bozuk dosya anlaşılır hata verir', () => {
  assert.throws(() => fxprj.parse('{"fxprj": 99, "project": {"hmi": {}}}', 'a.fxprj'), /biçim sürümü 99/);
  assert.throws(() => fxprj.parse('{bozuk', 'a.fxprj'), /geçerli JSON değil/);
  assert.throws(() => fxprj.parse('{"a": 1}', 'a.json'), /proje JSON dosyası değil/);
});

test('safeName dosya adına uygun ad üretir', () => {
  assert.equal(fxprj.safeName('Hat 1: Pres/Kalıp'), 'Hat 1_ Pres_Kalıp');
  assert.equal(fxprj.safeName('  '), 'proje');
});

// ---------------------------------------------------------------- publish
test('publish klasöre proje JSON + README yazar', () => {
  const dir = tmpdir();
  const file = path.join(dir, 'p1.fxprj');
  const doc = fxprj.newDoc('p1');
  doc.project = live();
  fxprj.write(file, doc);
  const res = publisher.publish(fxprj.read(file).doc, file);
  assert.equal(res.ok, true);
  assert.equal(res.dir, path.join(dir, 'publish', 'p1'));
  const out = JSON.parse(fs.readFileSync(path.join(res.dir, 'p1.json'), 'utf8'));
  assert.equal(model.digest(out), model.digest(doc.project));
  const readme = fs.readFileSync(path.join(res.dir, 'README.md'), 'utf8');
  assert.match(readme, /Open Project/);
  assert.match(readme, /tc3_ads/);
});

test('publish lint hatasında yazmaz', () => {
  const dir = tmpdir();
  const file = path.join(dir, 'p1.fxprj');
  const doc = fxprj.newDoc('p1');
  doc.project = live();
  delete doc.project.devices[DEV].tags['t_2c4f4e40-ccdc4848'];
  const res = publisher.publish(doc, file);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'lint');
  assert.ok(!fs.existsSync(path.join(dir, 'publish')));
});

test('publish klasörü mutlak veya .fxprj klasörüne göreli olabilir', () => {
  const doc = fxprj.newDoc('p1');
  const file = path.join(os.tmpdir(), 'a', 'p1.fxprj');
  assert.equal(publisher.resolveDir(doc, file), path.join(os.tmpdir(), 'a', 'publish'));
  doc.publish.dir = path.join(os.tmpdir(), 'abs');
  assert.equal(publisher.resolveDir(doc, file), path.join(os.tmpdir(), 'abs'));
  doc.publish.dir = 'publish';
  assert.equal(publisher.resolveDir(doc, null), null);
});

// ---------------------------------------------------------------- yeni tag
const tags = require('../src/core/tags');

test('ADS cihazına tag: editörün biçimi, adres zorunlu, aynı ad reddedilir', () => {
  const dev = live().devices[DEV];
  assert.deepEqual(tags.tagTypesFor(dev), ['Boolean', 'Number', 'String']);
  const ok = tags.buildTag(dev, { name: 'Motor1_Start', type: 'Boolean', address: 'GVL.Motor1.Start' });
  assert.ok(ok.tag);
  assert.match(ok.tag.id, /^t_[0-9a-f]{8}-[0-9a-f]{8}$/);
  assert.equal(ok.tag.address, 'GVL.Motor1.Start');
  assert.ok(!('init' in ok.tag));
  const existing = Object.values(dev.tags)[0].name;
  assert.match(tags.buildTag(dev, { name: existing.toUpperCase(), type: 'Number', address: 'x' }).errors.join(), /zaten var/);
  assert.match(tags.buildTag(dev, { name: 'Yeni', type: 'Number', address: ' ' }).errors.join(), /Adres/);
  assert.match(tags.buildTag(dev, { name: 'Yeni', type: 'number', address: 'x' }).errors.join(), /geçersiz tip/);
});

test('sunucu içi tag: adres yok, başlangıç değeri var', () => {
  const srv = live().devices['0'];
  const res = tags.buildTag(srv, { name: 'Sayac', type: 'number', init: '0' });
  assert.ok(res.tag);
  assert.equal(res.tag.init, '0');
  assert.equal(res.tag.label, 'Sayac');
  assert.ok(!('address' in res.tag));
});

test('yeni tag id mevcut id ile çakışmaz', () => {
  const seq = ['aaaaaaaabbbbbbbb', 'ccccccccdddddddd'];
  const id = tags.newTagId({ 't_aaaaaaaa-bbbbbbbb': {} }, () => seq.shift());
  assert.equal(id, 't_cccccccc-dddddddd');
});

test('tag silme yalnız seçilen cihazı hazırlar; kaynak proje ve diğer taglar korunur', () => {
  const project = live();
  const device = project.devices[DEV];
  const tagId = Object.keys(device.tags)[0];
  const before = structuredClone(project);
  const result = tags.prepareTagRemoval(project, { deviceId: DEV, tagId });
  assert.equal(result.tag.id, tagId);
  assert.ok(!Object.hasOwn(result.device.tags, tagId));
  assert.equal(Object.keys(result.device.tags).length, Object.keys(device.tags).length - 1);
  assert.deepEqual(project, before);
  const expected = structuredClone(device);
  delete expected.tags[tagId];
  assert.deepEqual(result.device, expected);
  assert.ok(tags.prepareTagRemoval(project, { deviceId: DEV, tagId: 'yok' }).errors);
  assert.ok(tags.prepareTagRemoval(project, { deviceId: '__proto__', tagId }).errors);
});

test('tag silme uyarısı grup görünürlüğü, düğme olayları ve script kullanımlarını içerir', () => {
  const project = {
    devices: { d: { id: 'd', name: 'PLC', tags: { t_test: { id: 't_test', name: 'Dialog' } } } },
    hmi: { views: [{ id: 'v', name: 'Ekran', items: {
      g: { name: 'Grup', property: { actions: [{ variableId: 't_test', type: 'hide' }] } },
      b: { name: 'Evet', property: { events: [{ type: 'click', action: 'onSetValue', actoptions: { variable: { variableId: 't_test' } } }] } },
    } }] },
    scripts: [{ id: 's', name: 'Script', code: "$getTagId('Dialog', 'PLC'); $getTag('t_test');" }],
  };
  const result = tags.prepareTagRemoval(project, { deviceId: 'd', tagId: 't_test' });
  assert.equal(result.uses.length, 4);
  assert.ok(result.uses.some(u => u.where === 'Ekran / Grup'));
  assert.ok(result.uses.some(u => u.where === 'Ekran / Evet'));
  assert.equal(tags.tagTable(model.splitProject(project))[0].deviceId, 'd');
});
