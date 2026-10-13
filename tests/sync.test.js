'use strict';
// Dışarıdan değişen projeyi öğe öğe birleştirme ve sunucu komutları (src/core/sync.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const model = require('../src/core/model');
const sync = require('../src/core/sync');

const LIVE_TEXT = fs.readFileSync(path.join(__dirname, 'fixtures', 'fuxa1_live.json'), 'utf8');
const DEV = 'd_31db3b81-3ebe4777';
const VIEW = 'v_147143a11-5510';
const SCRIPT = 's_opstop_toggle';

const live = () => JSON.parse(LIVE_TEXT);
const view = (p) => p.hmi.views.find((v) => v.id === VIEW);
const script = (p, id = SCRIPT) => p.scripts.find((s) => s.id === id);

test('aynı proje: fark yok, komut yok', () => {
  assert.deepEqual(sync.diff(live(), live()), { changed: [], removed: [] });
  assert.deepEqual(sync.planOps(live(), live()), []);
});

test('SVG öznitelik sırası ve tag değerleri fark sayılmaz', () => {
  const b = live();
  view(b).svgcontent = view(b).svgcontent.replace(/<svg ([^>]*?)(\S+="[^"]*")>/, '<svg $2 $1>');
  for (const tag of Object.values(b.devices[DEV].tags)) tag.value = 42;
  assert.deepEqual(sync.diff(live(), b).changed, []);
});

test('ekran değişikliği: sadece set-view (bağlantılar yeniden başlamaz)', () => {
  const b = live();
  view(b).name = 'MainView2';
  const ops = sync.planOps(live(), b);
  assert.deepEqual(ops.map((o) => o.cmd), ['set-view']);
  assert.equal(ops[0].data.name, 'MainView2');
});

test('sıra: silmeler önce, cihaz ve script ekrandan önce', () => {
  const b = live();
  view(b).name = 'X';
  script(b).code += '\n// x';
  b.devices[DEV].name = 'PLC9';
  b.scripts = b.scripts.filter((s) => s.id !== 's_simumachine_toggle');
  const ops = sync.planOps(live(), b);
  assert.deepEqual(ops.map((o) => o.cmd), ['del-script', 'set-device', 'set-script', 'set-view']);
  assert.equal(ops[0].data.id, 's_simumachine_toggle');
});

test('öğe dışı alan değişirse planOps null (tüm proje gönderilir)', () => {
  const b = live();
  b.version = '9.99';
  assert.equal(sync.planOps(live(), b), null);
  const c = live();
  delete c.hmi.layout; // tekil öğe silinemez
  assert.equal(sync.planOps(live(), c), null);
});

test('birleştirme: farklı öğeler çakışmaz, ikisi de korunur', () => {
  const base = live();
  const mine = live();
  view(mine).name = 'Benim';
  const theirs = live();
  script(theirs).code = '// disk';
  const r = sync.merge({ liveBase: base, mine, diskBase: base, theirs });
  assert.deepEqual(r.conflicts, []);
  assert.deepEqual(r.theirs, [`script:${SCRIPT}`]);
  assert.equal(view(r.target).name, 'Benim');
  assert.equal(script(r.target).code, '// disk');
  assert.deepEqual(sync.planOps(mine, r.target).map((o) => o.cmd), ['set-script']);
});

test('birleştirme: aynı öğe iki tarafta farklı değişirse çakışma', () => {
  const base = live();
  const mine = live();
  view(mine).name = 'Benim';
  const theirs = live();
  view(theirs).name = 'Disk';
  const keep = sync.merge({ liveBase: base, mine, diskBase: base, theirs });
  assert.deepEqual(keep.conflicts, [`view:${VIEW}`]);
  assert.equal(view(keep.target).name, 'Benim');
  const take = sync.merge({ liveBase: base, mine, diskBase: base, theirs }, true);
  assert.equal(view(take.target).name, 'Disk');
  assert.deepEqual(sync.describe(keep.conflicts, theirs), ['ekran "Disk"']);
});

test('birleştirme: iki tarafta aynı değişiklik çakışma değildir', () => {
  const base = live();
  const mine = live();
  view(mine).name = 'Ortak';
  const theirs = live();
  view(theirs).name = 'Ortak';
  assert.deepEqual(sync.merge({ liveBase: base, mine, diskBase: base, theirs }).conflicts, []);
});

test('birleştirme: diskte eklenen ve silinen öğeler, proje ayarları', () => {
  const base = live();
  const theirs = live();
  theirs.scripts.push({ id: 's_new', name: 'Yeni', code: '', sync: false, parameters: [], mode: 'SERVER' });
  theirs.scripts = theirs.scripts.filter((s) => s.id !== 's_simumachine_toggle');
  delete theirs.devices[DEV];
  theirs.name = 'yeniad';
  const r = sync.merge({ liveBase: base, mine: live(), diskBase: base, theirs });
  assert.deepEqual(r.conflicts, []);
  assert.ok(script(r.target, 's_new'));
  assert.ok(!script(r.target, 's_simumachine_toggle'));
  assert.ok(!(DEV in r.target.devices));
  assert.equal(r.target.name, 'yeniad');
  assert.equal(model.digest(r.target), model.digest(theirs)); // sonuç disktekiyle aynı
});
