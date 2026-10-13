'use strict';
// Yerel ajan kanalı: araç işleyicileri (src/core/agent.js), yerel HTTP kanalı
// (src/main/agentServer.js) ve MCP köprüsü (src/mcp/bridge.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const model = require('../src/core/model');
const { createHandlers } = require('../src/core/agent');
const { startAgentServer } = require('../src/main/agentServer');
const { TOOLS } = require('../src/mcp/tools');

const LIVE_TEXT = fs.readFileSync(path.join(__dirname, 'fixtures', 'fuxa1_live.json'), 'utf8');
const DEV = 'd_31db3b81-3ebe4777';

/** Bellekte proje tutan sahte uygulama arayüzü. */
function fakeApp() {
  const state = { prj: JSON.parse(LIVE_TEXT), applied: [], shown: [] };
  const app = {
    info: () => ({ name: 'fuxa1', path: 'x.fxprj', env: null, dirty: state.applied.length > 0 }),
    live: async () => model.clone(state.prj),
    apply: async (target, summary, opts = {}) => {
      state.prj = model.clone(target);
      state.applied.push(summary);
      if (opts.show) state.shown.push(opts.show);
    },
    showView: async (name) => { state.shown.push(name); },
    tagValues: async (ids) => ids.map((id) => ({ id, value: 1, timestamp: 5 })),
  };
  return { state, h: createHandlers(app) };
}

test('her tanımlı aracın işleyicisi var', () => {
  const { h } = fakeApp();
  assert.deepEqual(TOOLS.map((t) => t.name).sort(), Object.keys(h).sort());
});

test('get_project_info ve get_view (svg isteğe bağlı)', async () => {
  const { h } = fakeApp();
  const info = await h.get_project_info({});
  assert.equal(info.views[0].name, 'MainView');
  assert.equal(info.devices.find((d) => d.id === DEV).tags, 10);
  assert.equal(typeof info.lint.errors, 'number');
  const v = await h.get_view({ view: 'mainview' }); // büyük/küçük harf duyarsız
  assert.ok(!('svgcontent' in v) && v.svgcontentLength > 0);
  assert.ok((await h.get_view({ view: 'MainView', include_svg: true })).svgcontent.startsWith('<svg'));
  await assert.rejects(h.get_view({ view: 'Yok' }), /Mevcut: MainView/);
});

test('put_view: yeni ekran boş çizimle eklenir ve gösterilir; ad ile güncellenir; aynı ad reddedilir', async () => {
  const { h, state } = fakeApp();
  const r = await h.put_view({ view: { name: 'Pompa' } });
  assert.equal(r.created, true);
  const v = state.prj.hmi.views.find((x) => x.name === 'Pompa');
  assert.ok(v.id.startsWith('v_') && v.svgcontent.includes('<title>Layer 1</title>') && v.profile.width === 1024);
  assert.deepEqual(state.shown, ['Pompa']);
  const u = await h.put_view({ view: { name: 'Pompa', profile: { width: 800, height: 600 } }, show: false });
  assert.equal(u.created, false);
  assert.equal(state.prj.hmi.views.filter((x) => x.name === 'Pompa').length, 1);
  assert.equal(state.prj.hmi.views.find((x) => x.name === 'Pompa').svgcontent, v.svgcontent); // korunur
  await assert.rejects(h.put_view({ view: { id: v.id, name: 'mainview' } }), /başka bir ekran/);
  const w = await h.put_view({ view: { name: 'X', items: { HXB_1: { id: 'HXB_1', type: 'svg-ext-html_button' } } }, show: false });
  assert.match(w.warning, /HXB_1/);
});

test('add_tag, list_tags, read_tag_values', async () => {
  const { h, state } = fakeApp();
  const r = await h.add_tag({ device: 'tc3_ads', name: 'bYeni', type: 'Boolean', address: 'MAIN.bYeni' });
  assert.equal(r.tag.name, 'bYeni');
  assert.ok(Object.values(state.prj.devices[DEV].tags).some((t) => t.name === 'bYeni'));
  await assert.rejects(h.add_tag({ device: 'tc3_ads', name: 'bYeni', type: 'Boolean', address: 'x' }), /zaten var/);
  const unused = await h.list_tags({ unused_only: true, search: 'byeni' });
  assert.deepEqual(unused.tags.map((t) => t.name), ['bYeni']);
  const vals = await h.read_tag_values({ tags: ['bYeni'] });
  assert.equal(vals[0].value, 1);
  await assert.rejects(h.read_tag_values({ tags: ['yok'] }), /tag yok/);
});

test('put_script / get_script / delete_script ve lint', async () => {
  const { h, state } = fakeApp();
  const r = await h.put_script({ script: { name: 'Hesapla', code: "return $getTag($getTagId('yok', 'tc3_ads'));" } });
  assert.equal(r.created, true);
  assert.ok(r.lint.errors > 0); // olmayan tag adı lint'te yakalanır
  assert.equal((await h.get_script({ script: 'Hesapla' })).mode, 'SERVER');
  await h.put_script({ script: { name: 'Hesapla', code: 'return 1;' } });
  assert.equal(state.prj.scripts.filter((s) => s.name === 'Hesapla').length, 1);
  await h.delete_script({ script: 'Hesapla' });
  assert.ok(!state.prj.scripts.some((s) => s.name === 'Hesapla'));
  assert.deepEqual(state.applied.length, 3);
});

// ---------------------------------------------------------------- köprü + yerel kanal
function bridge(agentFile, lines) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'mcp', 'bridge.js'), '--agent-file', agentFile]);
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('error', reject);
    p.on('close', () => resolve(out.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))));
    for (const l of lines) p.stdin.write(JSON.stringify(l) + '\n');
    setTimeout(() => p.stdin.end(), 1500);
  });
}

test('MCP köprüsü: initialize, tools/list, uygulama kapalıyken araç hatası', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fuxaw-agent-')), 'agent.json');
  const res = await bridge(file, [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'lint', arguments: {} } },
    { jsonrpc: '2.0', id: 4, method: 'yok' },
  ]);
  const byId = Object.fromEntries(res.map((r) => [r.id, r]));
  assert.equal(res.length, 4); // bildirime cevap yok
  assert.equal(byId[1].result.serverInfo.name, 'fuxaw');
  assert.equal(byId[1].result.protocolVersion, '2025-06-18');
  assert.equal(byId[2].result.tools.length, TOOLS.length);
  assert.equal(byId[3].result.isError, true);
  assert.match(byId[3].result.content[0].text, /açık değil/);
  assert.equal(byId[4].error.code, -32601);
});

test('MCP köprüsü -> yerel kanal -> işleyici; yanlış anahtar reddedilir', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fuxaw-agent-')), 'agent.json');
  const { h } = fakeApp();
  const srv = await startAgentServer({ file, run: (name, args) => h[name](args) });
  try {
    const res = await bridge(file, [
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_view', arguments: { view: 'MainView' } } },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_view', arguments: { view: 'Yok' } } },
    ]);
    const byId = Object.fromEntries(res.map((r) => [r.id, r]));
    assert.equal(JSON.parse(byId[1].result.content[0].text).name, 'MainView');
    assert.equal(byId[2].result.isError, true);
    const info = JSON.parse(fs.readFileSync(file, 'utf8'));
    const r = await fetch(`http://127.0.0.1:${info.port}/tool`, { method: 'POST', headers: { 'X-Fuxaw-Token': 'yanlis' }, body: '{}' });
    assert.equal(r.status, 403);
  } finally {
    srv.stop();
  }
  assert.ok(!fs.existsSync(file)); // kapanınca keşif dosyası silinir
});
