'use strict';
// Ekran şablonları (src/core/widgets.js) ve ajan aracı add_widgets.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const model = require('../src/core/model');
const { lint, ERROR } = require('../src/core/lint');
const widgets = require('../src/core/widgets');
const { createHandlers } = require('../src/core/agent');

const LIVE_TEXT = fs.readFileSync(path.join(__dirname, 'fixtures', 'fuxa1_live.json'), 'utf8');
const VIEW = 'v_147143a11-5510';
const live = () => JSON.parse(LIVE_TEXT);
const view = (p) => p.hmi.views.find((v) => v.id === VIEW);
const errors = (p) => lint(model.splitProject(p)).filter((f) => f.level === ERROR);

test('tüm şablonlar: öğe ve çizim birlikte, lint temiz, eski öğeler korunur', () => {
  const before = live();
  const { target, added, scripts } = widgets.addWidgets(before, VIEW, [
    { kind: 'momentary', tag: 'Start_button', feedback_tag: 'StartButton_lamp', x: 200, y: 20, text: 'START' },
    { kind: 'set', tag: 'Reset_Btn', value: 1, x: 200, y: 70, text: 'RESET' },
    { kind: 'toggle', tag: 'SimuHmi', x: 200, y: 120, text: 'SIMU' },
    { kind: 'lamp', tag: 'ResetLamp', x: 320, y: 20 },
    { kind: 'value', tag: 'AxisX_ActPos', x: 320, y: 70, fraction_digits: 3 },
    { kind: 'label', text: 'Eksen X <mm>', x: 320, y: 120 },
  ]);
  assert.deepEqual(added.map((a) => a.kind), ['momentary', 'set', 'toggle', 'lamp', 'value', 'label']);
  const v = view(target);
  for (const a of added.filter((x) => x.kind !== 'label')) {
    assert.ok(v.items[a.id], a.kind);
    assert.ok(v.svgcontent.includes(`id="${a.id}"`), a.kind);
  }
  assert.ok(v.svgcontent.includes('Eksen X &lt;mm&gt;'));
  assert.ok(v.svgcontent.trimEnd().endsWith('</svg>'));
  assert.ok(v.svgcontent.indexOf(added[0].id) < v.svgcontent.lastIndexOf('</g>')); // katmanın içinde
  for (const [id, it] of Object.entries(view(before).items)) assert.deepEqual(v.items[id], it);
  assert.deepEqual(errors(target), []);
  assert.equal(scripts.length, 1);
  assert.deepEqual(view(before).items, view(live()).items); // girdi değişmedi
});

test('momentary: mousedown 1, mouseup/mouseout 0; renk geri bildirim tag\'inden', () => {
  const { target, added } = widgets.addWidgets(live(), VIEW, [
    { kind: 'momentary', tag: 'Start_button', feedback_tag: 'StartButton_lamp', x: 0, y: 0 },
  ]);
  const it = view(target).items[added[0].id];
  assert.deepEqual(it.property.events.map((e) => [e.type, e.action, e.actparam, e.actoptions.variable.variableId]), [
    ['mousedown', 'onSetValue', '1', 't_e7db6a54-3831424d'],
    ['mouseup', 'onSetValue', '0', 't_e7db6a54-3831424d'],
    ['mouseout', 'onSetValue', '0', 't_e7db6a54-3831424d'],
  ]);
  assert.equal(it.property.variableId, 't_2a047ffc-762a4192');
  assert.deepEqual(it.property.ranges.map((r) => [r.min, r.max, r.type]), [[0, 0, 2], [1, 1, 2]]);
});

test('toggle: script tag adıyla yazılır ve ikinci kez oluşturulmaz', () => {
  const r1 = widgets.addWidgets(live(), VIEW, [{ kind: 'toggle', tag: 'ResetLamp', x: 0, y: 0 }]);
  const sc = r1.target.scripts.find((s) => s.name === 'Toggle_ResetLamp');
  assert.match(sc.code, /\$getTagId\("ResetLamp", "tc3_ads"\)/);
  assert.equal(sc.mode, 'SERVER');
  const ev = view(r1.target).items[r1.added[0].id].property.events[0];
  assert.deepEqual([ev.action, ev.actparam], ['onRunScript', sc.id]);
  const r2 = widgets.addWidgets(r1.target, VIEW, [{ kind: 'toggle', tag: 'ResetLamp', x: 0, y: 50 }]);
  assert.deepEqual(r2.scripts, []);
  assert.equal(r2.target.scripts.filter((s) => s.name === 'Toggle_ResetLamp').length, 1);
});

test('lamp, value ve hatalı girdiler', () => {
  const { target, added } = widgets.addWidgets(live(), VIEW, [
    { kind: 'lamp', tag: 'ResetLamp', x: 0, y: 0, colors: { on: '#ff0000' } },
    { kind: 'value', tag: 'AxisX_ActPos', x: 0, y: 40, fraction_digits: 1 },
  ]);
  const lamp = view(target).items[added[0].id];
  assert.equal(lamp.type, 'svg-ext-shapes-rect');
  assert.deepEqual(lamp.property.ranges.map((r) => [r.min, r.max, r.color]), [[0, 0, '#7f7f7fff'], [1, 1, '#ff0000']]);
  assert.equal(view(target).items[added[1].id].property.ranges[0].fractionDigits, 1);
  assert.throws(() => widgets.addWidgets(live(), VIEW, [{ kind: 'set', tag: 'Reset_Btn', value: 'true', x: 0, y: 0 }]), /sadece 1 ya da 0/);
  assert.throws(() => widgets.addWidgets(live(), VIEW, [{ kind: 'lamp', x: 0, y: 0 }]), /tag gerekli/);
  assert.throws(() => widgets.addWidgets(live(), VIEW, [{ kind: 'lamp', tag: 'Yok', x: 0, y: 0 }]), /tag yok/);
  assert.throws(() => widgets.addWidgets(live(), VIEW, [{ kind: 'gauge', x: 0, y: 0 }]), /Bilinmeyen şablon/);
  const p = live();
  p.devices['0'].tags.t_x = { id: 't_x', name: 'ResetLamp', type: 'boolean' };
  assert.throws(() => widgets.addWidgets(p, VIEW, [{ kind: 'lamp', tag: 'ResetLamp', x: 0, y: 0 }]), /birden çok bağlantıda/);
  assert.ok(widgets.addWidgets(p, VIEW, [{ kind: 'lamp', tag: 'ResetLamp', device: 'tc3_ads', x: 0, y: 0 }]));
});

test('ajan aracı add_widgets: tek uygulama, ekran gösterilir', async () => {
  const state = { prj: live(), applied: [], shown: [] };
  const h = createHandlers({
    info: () => ({}),
    live: async () => model.clone(state.prj),
    apply: async (t, s, o = {}) => { state.prj = t; state.applied.push(s); if (o.show) state.shown.push(o.show); },
    showView: async () => {},
    tagValues: async () => [],
  });
  const r = await h.add_widgets({ view: 'MainView', widgets: [{ kind: 'lamp', tag: 'ResetLamp', x: 1, y: 2 }, { kind: 'label', text: 'A', x: 1, y: 40 }] });
  assert.equal(r.added.length, 2);
  assert.equal(r.lint.errors, 0);
  assert.equal(state.applied.length, 1);
  assert.deepEqual(state.shown, ['MainView']);
  await assert.rejects(h.add_widgets({ view: 'MainView', widgets: [{ kind: 'lamp', tag: 'Yok', x: 0, y: 0 }] }), /tag yok/);
});
