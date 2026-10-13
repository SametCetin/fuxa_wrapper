'use strict';
// Proje klasörü (.fxprj biçim 2: src/core/folder.js + fxprj.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const model = require('../src/core/model');
const folder = require('../src/core/folder');
const fxprj = require('../src/core/fxprj');

const LIVE_TEXT = fs.readFileSync(path.join(__dirname, 'fixtures', 'fuxa1_live.json'), 'utf8');
const live = () => JSON.parse(LIVE_TEXT);

function folderProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fuxaw-folder-'));
  const file = path.join(root, 'p.fxprj');
  const doc = fxprj.newDoc('p');
  doc.project = live();
  const hash = fxprj.write(file, doc);
  return { root, file, doc, hash };
}

const tree = (root) => fs.readdirSync(root, { recursive: true }).map((f) => f.split(path.sep).join('/')).sort();

test('yaz/oku: parçalar ayrı dosyalarda, proje aynen geri gelir', () => {
  const { root, file, hash } = folderProject();
  assert.deepEqual(tree(root), [
    'devices', 'devices/FUXA Server.json', 'devices/tc3_ads.json', 'p.fxprj',
    'scripts', 'scripts/OpPanelStopToggle.js', 'scripts/OpPanelStopToggle.json',
    'scripts/SimuHmiToggle.js', 'scripts/SimuHmiToggle.json',
    'scripts/SimuMachineToggle.js', 'scripts/SimuMachineToggle.json',
    'views', 'views/MainView.json', 'views/MainView.svg',
  ]);
  const main = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(main.fxprj, 2);
  assert.ok(!('views' in main.project.hmi) && !('devices' in main.project) && !('scripts' in main.project));
  assert.ok(main.project.hmi.layout); // layout .fxprj'de kalır
  assert.ok(fs.readFileSync(path.join(root, 'views/MainView.svg'), 'utf8').startsWith('<svg'));
  assert.ok(!('code' in JSON.parse(fs.readFileSync(path.join(root, 'scripts/SimuHmiToggle.json'), 'utf8'))));
  const back = fxprj.read(file);
  assert.equal(back.hash, hash);
  assert.equal(fxprj.fileHash(file), hash);
  assert.equal(model.digest(back.doc.project), model.digest(live()));
  // sıra korunur
  assert.deepEqual(back.doc.project.scripts.map((s) => s.id), live().scripts.map((s) => s.id));
});

test('tek parça dosyası değişince özet değişir ve okunan proje onu içerir', () => {
  const { root, file, hash } = folderProject();
  const js = path.join(root, 'scripts/SimuHmiToggle.js');
  fs.writeFileSync(js, '// ajan\n');
  assert.notEqual(fxprj.fileHash(file), hash);
  assert.equal(fxprj.read(file).doc.project.scripts.find((s) => s.name === 'SimuHmiToggle').code, '// ajan\n');
});

test('kaydet sadece değişen dosyaları yazar, ad değişince eski dosya silinir', () => {
  const { root, file } = folderProject();
  const { doc } = fxprj.read(file);
  const svg = path.join(root, 'views/MainView.svg');
  const before = fs.statSync(path.join(root, 'devices/tc3_ads.json')).mtimeMs;
  doc.project.hmi.views[0].name = 'Ana Ekran';
  const r = folder.writeFiles(root, folder.explode(model.cleanProject(doc.project)).files);
  assert.deepEqual(r.written.sort(), ['views/Ana Ekran.json', 'views/Ana Ekran.svg']);
  assert.deepEqual(r.removed.sort(), ['views/MainView.json', 'views/MainView.svg']);
  assert.ok(!fs.existsSync(svg));
  assert.equal(fs.statSync(path.join(root, 'devices/tc3_ads.json')).mtimeMs, before);
});

test('dışarıda eklenen dosya sona eklenir, silinen dosyanın öğesi düşer', () => {
  const { root, file } = folderProject();
  fs.writeFileSync(path.join(root, 'scripts/Yeni.json'), JSON.stringify({ id: 's_yeni', name: 'Yeni', sync: false, parameters: [], mode: 'SERVER' }));
  fs.writeFileSync(path.join(root, 'scripts/Yeni.js'), 'return 1;');
  fs.rmSync(path.join(root, 'scripts/SimuMachineToggle.json'));
  const ids = fxprj.read(file).doc.project.scripts.map((s) => s.id);
  assert.deepEqual(ids, ['s_opstop_toggle', 's_0b26152a-452043eb', 's_yeni']);
});

test('hatalı parça: aynı id iki dosyada / id yok / bozuk JSON', () => {
  const { root, file } = folderProject();
  const v = fs.readFileSync(path.join(root, 'views/MainView.json'), 'utf8');
  fs.writeFileSync(path.join(root, 'views/Kopya.json'), v);
  assert.throws(() => fxprj.read(file), /aynı id/);
  fs.writeFileSync(path.join(root, 'views/Kopya.json'), '{"name":"x"}');
  assert.throws(() => fxprj.read(file), /"id" alanı yok/);
  fs.writeFileSync(path.join(root, 'views/Kopya.json'), '{bozuk');
  assert.throws(() => fxprj.read(file), /geçerli JSON değil/);
});

test('aynı (büyük/küçük harf farklı) adlı öğeler id ile ayrılır; Windows ayrılmış adları', () => {
  const items = [{ id: 'a', name: 'Pompa' }, { id: 'b', name: 'pompa' }, { id: 'c', name: 'CON' }, { id: 'd', name: 'a/b' }];
  const prj = { hmi: { views: items }, devices: {}, scripts: [] };
  assert.deepEqual(Object.keys(folder.explode(prj).files).sort(), [
    'views/_CON.json', 'views/_CON.svg',
    'views/Pompa__a.json', 'views/Pompa__a.svg', 'views/a_b.json', 'views/a_b.svg',
    'views/pompa__b.json', 'views/pompa__b.svg',
  ].sort());
});

test('eski tek dosya .fxprj ve düz JSON içe aktarılır, yazınca klasör biçimi olur', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fuxaw-folder-'));
  const old = path.join(root, 'eski.fxprj');
  fs.writeFileSync(old, JSON.stringify({ fxprj: 1, name: 'eski', fuxaVersion: '1.3.4', publish: { dir: 'cikti' }, project: live() }));
  const r = fxprj.read(old);
  assert.equal(r.imported, true);
  assert.equal(r.doc.name, 'eski');
  assert.equal(r.doc.publish.dir, 'cikti');
  assert.equal(fxprj.parse(LIVE_TEXT, 'x_live.json').imported, true);
  const file = path.join(root, 'yeni', 'eski.fxprj');
  fs.mkdirSync(path.dirname(file));
  fxprj.write(file, r.doc);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).fxprj, 2);
  const back = fxprj.read(file);
  assert.equal(back.imported, false);
  assert.equal(model.digest(back.doc.project), model.digest(live()));
});

test('klasör çakışması: başka .fxprj ya da dolu parça klasörü', () => {
  const { root, file } = folderProject();
  assert.equal(fxprj.folderConflict(file), null); // kendi projesinin üzerine yazmak serbest
  assert.match(fxprj.folderConflict(path.join(root, 'baska.fxprj')), /başka proje var \(p\.fxprj\)/);
  const r2 = fs.mkdtempSync(path.join(os.tmpdir(), 'fuxaw-folder-'));
  fs.mkdirSync(path.join(r2, 'views'));
  fs.writeFileSync(path.join(r2, 'views', 'x.json'), '{}');
  assert.match(fxprj.folderConflict(path.join(r2, 'yeni.fxprj')), /views\/ klasörü dolu/);
  assert.equal(fxprj.folderConflict(path.join(r2, 'yok', 'yeni.fxprj')), null);
});
