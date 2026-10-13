'use strict';
// Ekran şablonları: bilinen tuzaklardan (AGENTS.md §7) kaçınan hazır öğeler.
//
//   momentary  basılıyken 1, bırakınca/dışarı çıkınca 0 (mousedown/mouseup/mouseout)
//   set        tıklayınca sabit değer yazar (varsayılan 1)
//   toggle     tıklayınca Boolean tag'i tersine çevirir: server script ile (Toggle value
//              aksiyonu Boolean ADS tag'inde TRUE→FALSE yazamaz, §7.1)
//   lamp       Boolean tag'e göre renk değiştiren yuvarlak gösterge (aralıklar 0/1, §6)
//   value      sayısal değer göstergesi (ondalık basamak)
//   label      sabit metin
//
// Üretilen SVG/öğe yapısı editörün kendi kaydettiği biçimle aynıdır (1.3.4, bkz.
// tests/fixtures/fuxa1_live.json). Ekranın çizimine son katmanın sonuna eklenir.

const crypto = require('node:crypto');
const model = require('./model');

class WidgetError extends Error {}

const KINDS = ['momentary', 'set', 'toggle', 'lamp', 'value', 'label'];
const hex = (n) => crypto.randomBytes(Math.ceil(n / 2)).toString('hex').slice(0, n);
const uid = () => `${hex(8)}-${hex(8)}`;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

const DEFAULT_SIZE = {
  momentary: [100, 40], set: [100, 40], toggle: [100, 40], lamp: [30, 30], value: [100, 30], label: [120, 24],
};
const COLORS = {
  off: '#7f7f7fff', on: '#00b050ff', text: '#ffffffff',
};

/** Tag'i adı (isteğe bağlı bağlantı adıyla) ya da id'siyle bul. */
function resolveTag(prj, key, deviceKey) {
  const all = [];
  for (const d of Object.values(prj.devices || {})) {
    if (!d) continue;
    if (deviceKey && d.id !== deviceKey && d.name !== deviceKey) continue;
    for (const t of Object.values(d.tags || {})) all.push({ ...t, device: d.name, deviceType: d.type });
  }
  const hits = all.filter((t) => t.id === key);
  const byName = hits.length ? hits : all.filter((t) => t.name === key);
  if (!byName.length) throw new WidgetError(`"${key}" adlı/id'li tag yok${deviceKey ? ` ("${deviceKey}" bağlantısında)` : ''}.`);
  if (byName.length > 1) {
    throw new WidgetError(`"${key}" adlı tag birden çok bağlantıda var (${byName.map((t) => t.device).join(', ')}); device ver.`);
  }
  return byName[0];
}

function button(spec, events, variableId, colors) {
  const id = `HXB_${uid()}`;
  const inner = uid();
  const [w, h] = [num(spec.width, DEFAULT_SIZE[spec.kind][0]), num(spec.height, DEFAULT_SIZE[spec.kind][1])];
  const [x, y] = [num(spec.x, 0), num(spec.y, 0)];
  const text = String(spec.text ?? '');
  const svg = `<g id="${id}" stroke="rgba(0,0,0,0)" fill="rgba(0,0,0,0)" type="svg-ext-html_button">\n`
    + `   <rect id="svg_${uid()}" height="${h}" width="${w}" y="${y}" x="${x}" stroke-width="0"/>\n`
    + `   <foreignObject id="H-HXB_${inner}" width="${w}" height="${h}" y="${y}" x="${x}">\n`
    + `    <BUTTON id="B-HXB_${inner}" style="width:calc(100% - 6px);height:calc(100% - 6px);text-align:center;`
    + `background-color:#FFFFFF;color:#000000;font-size:14px;font-family:sans-serif;" class="md-btn  md-btn-raised">${esc(text)}</BUTTON>\n`
    + '   </foreignObject>\n  </g>';
  const item = {
    id,
    type: 'svg-ext-html_button',
    name: String(spec.name || text || id),
    property: {
      ranges: [
        { min: 0, max: 0, color: colors.off, type: 2, stroke: colors.text },
        { min: 1, max: 1, color: colors.on, type: 2, stroke: colors.text },
      ],
      events,
      actions: [],
      text,
      ...(variableId ? { variableId } : {}),
    },
    label: 'HtmlButton',
    hide: false,
    lock: false,
  };
  return { id, svg, item };
}

const setEvent = (type, value, tagId) => ({
  type, action: 'onSetValue', actparam: String(value), actoptions: { function: 'set', variable: { variableId: tagId } },
});

function toggleScriptCode(tag) {
  return '// Boolean tag toggle (şablon). Tag adıyla bulunur; Toggle value aksiyonu Boolean ADS tag\'inde TRUE->FALSE yazamaz.\n'
    + `const id = $getTagId(${JSON.stringify(tag.name)}, ${JSON.stringify(tag.device)});\n`
    + 'const v = $getTag(id);\n'
    + "await $setTag(id, !(v === true || v === 1 || v === '1' || v === 'true'));\n";
}

/**
 * Tek öğe üret: {id, svg, item?, script?}. prj: tag/script çözmek için güncel proje.
 * spec: {kind, tag?, device?, feedback_tag?, x, y, width?, height?, text?, name?, value?,
 *        colors?: {off, on, text}, fraction_digits?, font_size?}
 */
function buildWidget(prj, spec) {
  if (!KINDS.includes(spec.kind)) throw new WidgetError(`Bilinmeyen şablon "${spec.kind}". Seçenekler: ${KINDS.join(', ')}`);
  const colors = { ...COLORS, ...(spec.colors || {}) };
  const tag = spec.tag !== undefined && spec.tag !== null && spec.tag !== '' ? resolveTag(prj, spec.tag, spec.device) : null;
  const feedback = spec.feedback_tag ? resolveTag(prj, spec.feedback_tag, spec.device) : tag;
  const needTag = (what) => { if (!tag) throw new WidgetError(`${spec.kind} şablonu için tag gerekli (${what}).`); };
  const [x, y] = [num(spec.x, 0), num(spec.y, 0)];

  switch (spec.kind) {
    case 'momentary': {
      needTag('basılıyken 1 yazılacak tag');
      return button(spec, ['mousedown', 'mouseup', 'mouseout'].map((t, i) => setEvent(t, i === 0 ? 1 : 0, tag.id)), feedback.id, colors);
    }
    case 'set': {
      needTag('yazılacak tag');
      const value = spec.value ?? 1;
      if (tag.type === 'Boolean' && !['0', '1'].includes(String(value))) {
        throw new WidgetError(`Boolean tag'e sadece 1 ya da 0 yaz ("${value}" ADS'de yanlış yazılır).`);
      }
      return button(spec, [setEvent('click', value, tag.id)], feedback.id, colors);
    }
    case 'toggle': {
      needTag('tersine çevrilecek Boolean tag');
      const existing = (prj.scripts || []).find((s) => s.code === toggleScriptCode(tag));
      const script = existing || {
        id: `s_${uid()}`, name: `Toggle_${String(tag.name).replace(/[^\w]+/g, '_')}`, sync: false, parameters: [], mode: 'SERVER', code: toggleScriptCode(tag),
      };
      const w = button(spec, [{ type: 'click', action: 'onRunScript', actparam: script.id, actoptions: { params: [] } }], feedback.id, colors);
      return { ...w, script: existing ? null : script };
    }
    case 'lamp': {
      needTag('gösterilecek Boolean tag');
      const id = `svg_${uid()}`;
      const [w, h] = [num(spec.width, DEFAULT_SIZE.lamp[0]), num(spec.height, DEFAULT_SIZE.lamp[1])];
      const svg = `<rect id="${id}" height="${h}" width="${w}" y="${y}" x="${x}" rx="${w / 2}" ry="${h / 2}" `
        + `fill="${colors.off}" stroke="#000000" stroke-width="1"/>`;
      const item = {
        id,
        type: 'svg-ext-shapes-rect',
        name: String(spec.name || `lamp_${tag.name}`),
        property: {
          variableId: tag.id,
          ranges: [
            { min: 0, max: 0, color: colors.off, stroke: '#000000' },
            { min: 1, max: 1, color: colors.on, stroke: '#000000' },
          ],
          actions: [],
        },
        label: 'Shapes',
        hide: false,
        lock: false,
      };
      return { id, svg, item };
    }
    case 'value': {
      needTag('gösterilecek tag');
      const id = `VAL_${uid()}`;
      const size = num(spec.font_size, 14);
      const svg = `<g id="${id}" type="svg-ext-value" data-name="${esc(spec.name || `value_${tag.name}`)}" text-anchor="start" `
        + `font-family="sans-serif" font-size="${size}" fill="#000000" stroke="#000000" stroke-width="0">\n`
        + `   <text id="VAL_${uid()}" x="${x}" y="${y + size}" xml:space="preserve" text-anchor="start" font-family="sans-serif" `
        + `font-size="${size}" fill="#000000" stroke-width="0" stroke="#000000">##.##</text>\n  </g>`;
      const item = {
        id,
        type: 'svg-ext-value',
        name: String(spec.name || `value_${tag.name}`),
        property: {
          variableId: tag.id,
          ranges: [{
            min: 20, max: 80, textId: null, color: '', type: 1, stroke: '', fractionDigitsId: null,
            fractionDigits: Math.max(0, Math.min(10, Math.trunc(num(spec.fraction_digits, 2)))),
          }],
          events: [],
          actions: [],
        },
        label: 'Value',
        hide: false,
        lock: false,
      };
      return { id, svg, item };
    }
    case 'label': {
      const id = `svg_${uid()}`;
      const size = num(spec.font_size, 14);
      const svg = `<text id="${id}" x="${x}" y="${y + size}" xml:space="preserve" text-anchor="start" font-family="sans-serif" `
        + `font-size="${size}" fill="#000000" stroke-width="0">${esc(spec.text ?? '')}</text>`;
      return { id, svg };
    }
    default:
      throw new WidgetError(`Bilinmeyen şablon "${spec.kind}"`);
  }
}

/** Ekran çizimine öğeleri son katmanın sonuna ekle. */
function insertSvg(svgcontent, fragments) {
  const end = svgcontent.lastIndexOf('</svg>');
  if (end < 0) throw new WidgetError('Ekran çizimi geçerli bir SVG değil.');
  const layerEnd = svgcontent.lastIndexOf('</g>', end);
  const add = fragments.map((f) => `  ${f}\n`).join('');
  if (layerEnd < 0) return `${svgcontent.slice(0, end)} <g>\n  <title>Layer 1</title>\n${add} </g>\n${svgcontent.slice(end)}`;
  return `${svgcontent.slice(0, layerEnd).replace(/\s*$/, '\n')}${add} ${svgcontent.slice(layerEnd)}`;
}

/**
 * Projedeki ekrana şablonları ekle. Dönüş: {target, added: [{kind, id, name}], scripts: [ad]}.
 * Proje yerinde değiştirilmez.
 */
function addWidgets(prj, viewId, specs) {
  if (!Array.isArray(specs) || !specs.length) throw new WidgetError('En az bir şablon ver.');
  const target = model.clone(prj);
  const view = ((target.hmi && target.hmi.views) || []).find((v) => v.id === viewId);
  if (!view) throw new WidgetError(`Ekran bulunamadı (${viewId}).`);
  const fragments = [];
  const added = [];
  const scripts = [];
  view.items = view.items || {};
  for (const spec of specs) {
    const w = buildWidget(target, spec);
    fragments.push(w.svg);
    if (w.item) view.items[w.id] = w.item;
    if (w.script) {
      target.scripts = [...(target.scripts || []), w.script];
      scripts.push(w.script.name);
    }
    added.push({ kind: spec.kind, id: w.id, name: w.item ? w.item.name : spec.text });
  }
  view.svgcontent = insertSvg(typeof view.svgcontent === 'string' ? view.svgcontent : '<svg xmlns="http://www.w3.org/2000/svg"></svg>', fragments);
  return { target, added, scripts };
}

module.exports = { KINDS, WidgetError, resolveTag, buildWidget, insertSvg, addWidgets, toggleScriptCode };
