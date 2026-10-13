'use strict';
// Yerel ajan kanalının araç işleyicileri (tanımlar: src/mcp/tools.js). Electron'dan bağımsız.
//
// İşleyiciler ana süreçten bir "app" arayüzü alır:
//   app.info()                    {name, path, env, dirty}
//   app.live()                    editördeki güncel proje (bekleyen çizimler aktarılmış)
//   app.apply(target, summary, {show})  projeyi target'a getir (öğe öğe), editörü yenile
//   app.showView(name)            ekranı tasarımcının editöründe aç
//   app.tagValues(ids)            canlı tag değerleri
// Değişiklikler dosyaya yazılmaz; kaydetmek tasarımcının işidir.

const crypto = require('node:crypto');
const model = require('./model');
const lintmod = require('./lint');
const { tagTable, buildTag } = require('./tags');

class AgentError extends Error {}

const hex = (n) => crypto.randomBytes(Math.ceil(n / 2)).toString('hex').slice(0, n);

const DEFAULT_PROFILE = {
  width: 1024, height: 768, bkcolor: '#ffffffff', margin: 10, align: 'topCenter', gridType: 'fixed', viewRenderDelay: 0,
};

function blankSvg(profile) {
  return `<svg width="${Number(profile.width) || 1024}" height="${Number(profile.height) || 768}" `
    + 'xmlns="http://www.w3.org/2000/svg" xmlns:svg="http://www.w3.org/2000/svg" xmlns:html="http://www.w3.org/1999/xhtml">\n'
    + ' <filter id="blur-filter" x="-3" y="-3" width="200" height="200">\n  <feGaussianBlur stdDeviation="3"/>\n </filter>\n'
    + ' <g>\n  <title>Layer 1</title>\n </g>\n</svg>';
}

function views(prj) { return (prj.hmi && prj.hmi.views) || []; }
function devices(prj) { return Object.values(prj.devices || {}).filter(Boolean); }
function scripts(prj) { return prj.scripts || []; }

/** id, sonra ad (önce birebir, sonra büyük/küçük harf duyarsız) ile bul. */
function find(list, key, what) {
  const k = String(key ?? '');
  const hit = list.find((o) => String(o.id) === k) || list.find((o) => o.name === k)
    || list.find((o) => String(o.name || '').toLowerCase() === k.toLowerCase());
  if (!hit) {
    const names = list.map((o) => o.name).filter(Boolean).join(', ') || '-';
    throw new AgentError(`"${k}" adlı/id'li ${what} yok. Mevcut: ${names}`);
  }
  return hit;
}

function lintSummary(prj) {
  const found = lintmod.lint(model.splitProject(prj));
  const errors = found.filter((f) => f.level === lintmod.ERROR);
  return {
    errors: errors.length,
    warnings: found.length - errors.length,
    findings: found.slice(0, 50).map((f) => `${f.level} ${f.where}: ${f.message}`),
  };
}

/** svgcontent'te karşılığı olmayan item'lar (editör bunları çizemez). */
function orphanItems(view) {
  const svg = typeof view.svgcontent === 'string' ? view.svgcontent : '';
  return Object.keys(view.items || {}).filter((id) => !svg.includes(`id="${id}"`));
}

function createHandlers(app) {
  return {
    async get_project_info() {
      const prj = await app.live();
      return {
        ...app.info(),
        views: views(prj).map((v) => ({ id: v.id, name: v.name, items: Object.keys(v.items || {}).length })),
        devices: devices(prj).map((d) => ({ id: d.id, name: d.name, type: d.type, enabled: d.enabled, tags: Object.keys(d.tags || {}).length })),
        scripts: scripts(prj).map((s) => ({ id: s.id, name: s.name, mode: s.mode })),
        lint: lintSummary(prj),
      };
    },

    async get_view({ view, include_svg = false }) {
      const v = model.clone(find(views(await app.live()), view, 'ekran'));
      if (!include_svg) {
        v.svgcontentLength = typeof v.svgcontent === 'string' ? v.svgcontent.length : 0;
        delete v.svgcontent;
      }
      return v;
    },

    async put_view({ view, show = true }) {
      if (!view || typeof view !== 'object' || !String(view.name || '').trim()) throw new AgentError('view.name gerekli.');
      const prj = await app.live();
      const list = views(prj);
      const name = String(view.name).trim();
      let existing = null;
      if (view.id) existing = list.find((v) => String(v.id) === String(view.id)) || null;
      else existing = list.find((v) => v.name === name) || null;
      const id = existing ? existing.id : String(view.id || `v_${hex(9)}-${hex(4)}`);
      const clash = list.find((v) => v.id !== id && String(v.name).toLowerCase() === name.toLowerCase());
      if (clash) throw new AgentError(`"${clash.name}" adlı başka bir ekran var (${clash.id}); ekran adları benzersiz olmalı.`);
      const base = existing || { type: 'svg', profile: { ...DEFAULT_PROFILE }, items: {}, variables: {} };
      const merged = { ...model.clone(base), ...model.clone(view), id, name };
      if (typeof merged.svgcontent !== 'string') merged.svgcontent = blankSvg(merged.profile || DEFAULT_PROFILE);
      const target = model.clone(prj);
      target.hmi = target.hmi || {};
      target.hmi.views = views(target).filter((v) => v.id !== id);
      const pos = list.findIndex((v) => v.id === id);
      target.hmi.views.splice(pos >= 0 ? pos : target.hmi.views.length, 0, merged);
      await app.apply(target, `ekran "${name}" ${existing ? 'güncellendi' : 'eklendi'}`, { show: show ? name : null });
      const orphans = orphanItems(merged);
      return {
        id, name, created: !existing,
        ...(orphans.length ? { warning: `svgcontent'te karşılığı olmayan item'lar: ${orphans.join(', ')}` } : {}),
        lint: lintSummary(target),
      };
    },

    async delete_view({ view }) {
      const prj = await app.live();
      const v = find(views(prj), view, 'ekran');
      const target = model.clone(prj);
      target.hmi.views = views(target).filter((x) => x.id !== v.id);
      await app.apply(target, `ekran "${v.name}" silindi`);
      return { deleted: v.id, name: v.name, lint: lintSummary(target) };
    },

    async show_view({ view }) {
      const v = find(views(await app.live()), view, 'ekran');
      await app.showView(v.name);
      return { shown: v.name };
    },

    async list_tags({ device, search, unused_only = false } = {}) {
      const prj = await app.live();
      let rows = tagTable(model.splitProject(prj));
      if (device) {
        const d = find(devices(prj), device, 'bağlantı');
        rows = rows.filter((r) => r.deviceId === d.id);
      }
      if (search) {
        const s = String(search).toLowerCase();
        rows = rows.filter((r) => r.name.toLowerCase().includes(s) || r.address.toLowerCase().includes(s));
      }
      if (unused_only) rows = rows.filter((r) => !r.uses.length);
      return { count: rows.length, tags: rows.slice(0, 500) };
    },

    async add_tag({ device, ...spec }) {
      const prj = await app.live();
      const d = find(devices(prj), device, 'bağlantı');
      const res = buildTag(d, spec);
      if (res.errors) throw new AgentError(res.errors.join(' '));
      const target = model.clone(prj);
      const td = Object.values(target.devices).find((x) => x.id === d.id);
      td.tags = { ...(td.tags || {}), [res.tag.id]: res.tag };
      await app.apply(target, `"${d.name}" bağlantısına tag "${res.tag.name}" eklendi`);
      return { device: d.name, tag: res.tag };
    },

    async read_tag_values({ tags }) {
      const prj = await app.live();
      const all = devices(prj).flatMap((d) => Object.values(d.tags || {}).map((t) => ({ ...t, device: d.name })));
      const wanted = [];
      for (const key of tags || []) {
        const hits = all.filter((t) => t.id === key || t.name === key);
        if (!hits.length) throw new AgentError(`"${key}" adlı/id'li tag yok.`);
        wanted.push(...hits);
      }
      const values = await app.tagValues(wanted.map((t) => t.id));
      const byId = new Map((values || []).map((v) => [v.id, v]));
      return wanted.map((t) => ({
        id: t.id, name: t.name, device: t.device, value: byId.get(t.id)?.value ?? null, timestamp: byId.get(t.id)?.timestamp ?? null,
      }));
    },

    async get_script({ script }) {
      return model.clone(find(scripts(await app.live()), script, 'script'));
    },

    async put_script({ script }) {
      if (!script || typeof script !== 'object' || !String(script.name || '').trim()) throw new AgentError('script.name gerekli.');
      const prj = await app.live();
      const list = scripts(prj);
      const name = String(script.name).trim();
      const existing = (script.id ? list.find((s) => String(s.id) === String(script.id)) : list.find((s) => s.name === name)) || null;
      const id = existing ? existing.id : String(script.id || `s_${hex(8)}-${hex(8)}`);
      const clash = list.find((s) => s.id !== id && String(s.name).toLowerCase() === name.toLowerCase());
      if (clash) throw new AgentError(`"${clash.name}" adlı başka bir script var (${clash.id}).`);
      const base = existing || { sync: false, parameters: [], mode: 'SERVER', code: '' };
      const merged = { ...model.clone(base), ...model.clone(script), id, name };
      const target = model.clone(prj);
      target.scripts = list.map((s) => (s.id === id ? merged : s));
      if (!existing) target.scripts.push(merged);
      await app.apply(target, `script "${name}" ${existing ? 'güncellendi' : 'eklendi'}`);
      return { id, name, created: !existing, lint: lintSummary(target) };
    },

    async delete_script({ script }) {
      const prj = await app.live();
      const s = find(scripts(prj), script, 'script');
      const target = model.clone(prj);
      target.scripts = scripts(target).filter((x) => x.id !== s.id);
      await app.apply(target, `script "${s.name}" silindi`);
      return { deleted: s.id, name: s.name, lint: lintSummary(target) };
    },

    async lint() {
      return lintSummary(await app.live());
    },
  };
}

module.exports = { AgentError, createHandlers, blankSvg };
