'use strict';
// fuxaw pencere arayüzü. Metinler DOM'a hep textContent ile basılır (el()); innerHTML kullanma:
// proje/tag/dosya adları dışarıdan gelir.

const $ = (id) => document.getElementById(id);

function el(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) if (c !== null && c !== undefined) e.append(c instanceof Node ? c : String(c));
  return e;
}

let state = { fuxa: { status: 'starting' }, project: null, recent: [], busy: false };
let activeTab = 'editor';
let modalOpen = false;
let analysis = null; // {lint, tags}

// ---------------------------------------------------------------- durum
function render(s) {
  state = s;
  const p = s.project;

  const info = $('projectInfo');
  info.replaceChildren();
  if (p) {
    info.append(el('b', { text: p.name }));
    if (p.dirty) info.append(el('span', { class: 'dirty', text: ' ● kaydedilmedi' }));
  }

  // Bileşen durumu sadece sorun olunca gösterilir (açılışı açılış penceresi bekler).
  const chip = $('engineChip');
  const f = s.fuxa;
  chip.hidden = f.status === 'ready';
  chip.className = `chip ${f.status}`;
  chip.textContent = f.status === 'starting' ? 'Bileşenler yükleniyor…' : 'Bileşen hatası';
  chip.title = f.status === 'error' ? f.error : '';

  $('welcome').hidden = !!p;
  $('tabs').style.visibility = p ? 'visible' : 'hidden';
  renderRecent(s.recent);
  $('welcomeStatus').textContent = f.status === 'error' ? `Uygulama bileşenleri başlatılamadı: ${f.error}`
    : f.status === 'starting' ? 'Bileşenler yükleniyor…' : '';
  $('btnRetry').hidden = f.status !== 'error';
  $('wNew').disabled = s.busy || f.status !== 'ready';
  $('wOpen').disabled = s.busy || f.status !== 'ready';

  $('statusText').textContent = s.busy ? 'Çalışıyor…' : (p && p.note) || (p && !p.dirty ? 'Kaydedildi' : '');
  $('statusPath').textContent = p ? (p.path || 'kaydedilmemiş proje') : '';
  $('editorPlaceholder').textContent = f.status === 'ready' ? 'Editör yükleniyor…' : 'Bileşenler yükleniyor…';
  syncEditor();
}

function renderRecent(list) {
  const ul = $('recentList');
  ul.replaceChildren();
  if (!list.length) {
    ul.append(el('li', { class: 'muted', text: 'Henüz yok.' }));
    return;
  }
  for (const p of list) {
    const parts = p.split(/[\\/]/);
    const name = parts.pop();
    ul.append(el('li', { title: p, onclick: () => window.fxw.openRecent(p) },
      el('span', { class: 'name', text: name }), el('span', { class: 'dir', text: parts.join('/') })));
  }
}

// ---------------------------------------------------------------- gömülü editör (ana süreçte ayrı görünüm)
function syncEditor() {
  const visible = !!state.project && activeTab === 'editor' && !modalOpen;
  window.fxw.editorVisible(visible);
  if (visible) sendBounds();
}

function sendBounds() {
  const r = $('editorHost').getBoundingClientRect();
  window.fxw.editorBounds({ x: r.left, y: r.top, width: r.width, height: r.height });
}

new ResizeObserver(() => { if (activeTab === 'editor') sendBounds(); }).observe($('editorHost'));
window.addEventListener('resize', () => { if (activeTab === 'editor') sendBounds(); });

// ---------------------------------------------------------------- sekmeler
function showTab(tab) {
  activeTab = tab;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('active', p.id === `pane-${tab}`));
  syncEditor();
  if ((tab === 'tags' || tab === 'lint') && state.project) refreshAnalysis();
}

document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

async function refreshAnalysis() {
  const res = await window.fxw.analyze();
  if (!res) return;
  analysis = res;
  renderLint();
  renderTags();
}

// ---------------------------------------------------------------- kontrol (lint)
function renderLint() {
  const body = $('lintBody');
  body.replaceChildren();
  const found = (analysis && analysis.lint) || [];
  const errors = found.filter((f) => f.level === 'HATA').length;
  const badge = $('lintBadge');
  badge.hidden = !found.length;
  badge.textContent = String(errors || found.length);
  badge.classList.toggle('warn', !errors);
  if (!found.length) {
    body.append(el('tr', {}, el('td', { colspan: '3', class: 'empty', text: 'Sorun bulunmadı.' })));
    return;
  }
  for (const f of found) {
    body.append(el('tr', {},
      el('td', { class: `level-${f.level}`, text: f.level }),
      el('td', { text: f.where }),
      el('td', { text: f.message })));
  }
}

// ---------------------------------------------------------------- taglar
function visibleTags() {
  const rows = (analysis && analysis.tags) || [];
  const q = $('tagFilter').value.trim().toLowerCase();
  const dev = $('tagDevice').value;
  const unused = $('tagUnused').checked;
  return rows.filter((r) => (!dev || r.device === dev)
    && (!unused || !r.uses.length)
    && (!q || [r.name, r.address, r.device, r.type].some((x) => String(x).toLowerCase().includes(q))));
}

function renderTags() {
  const rows = (analysis && analysis.tags) || [];
  const sel = $('tagDevice');
  const devs = [...new Set(rows.map((r) => r.device))].sort();
  const prev = sel.value;
  sel.replaceChildren(el('option', { value: '', text: 'Tüm cihazlar' }), ...devs.map((d) => el('option', { value: d, text: d })));
  sel.value = devs.includes(prev) ? prev : '';

  const shown = visibleTags();
  $('tagCount').textContent = `${shown.length} / ${rows.length} tag`;
  const body = $('tagBody');
  body.replaceChildren();
  $('tagUses').hidden = true;
  if (!shown.length) {
    body.append(el('tr', {}, el('td', { colspan: '5', class: 'empty', text: rows.length ? 'Filtreye uyan tag yok.' : 'Projede tag yok.' })));
    return;
  }
  for (const r of shown) {
    const tr = el('tr', {},
      el('td', { text: r.name }),
      el('td', { text: r.type }),
      el('td', { text: r.address }),
      el('td', { text: r.device }),
      el('td', { class: 'num' }, r.uses.length
        ? el('span', { class: 'link', text: String(r.uses.length), onclick: () => showUses(r, tr) })
        : el('span', { class: 'muted', text: '0' })));
    body.append(tr);
  }
}

function showUses(r, tr) {
  document.querySelectorAll('#tagBody tr.selected').forEach((x) => x.classList.remove('selected'));
  tr.classList.add('selected');
  const box = $('tagUses');
  box.replaceChildren(el('h3', { text: `${r.name} (${r.device}) kullanıldığı yerler` }),
    el('ul', {}, ...r.uses.map((u) => el('li', { text: `${u.where} — ${u.how}` }))));
  box.hidden = false;
}

['input', 'change'].forEach((ev) => {
  $('tagFilter').addEventListener(ev, renderTags);
  $('tagDevice').addEventListener(ev, renderTags);
  $('tagUnused').addEventListener(ev, renderTags);
});
$('btnTagRefresh').addEventListener('click', refreshAnalysis);
$('btnLintRefresh').addEventListener('click', refreshAnalysis);
$('btnTagCopy').addEventListener('click', async () => {
  const rows = visibleTags();
  const lines = [['Ad', 'Tip', 'Adres', 'Cihaz', 'Kullanım'].join('\t'),
    ...rows.map((r) => [r.name, r.type, r.address, r.device, r.uses.length].join('\t'))];
  await navigator.clipboard.writeText(lines.join('\n'));
  $('statusText').textContent = `${rows.length} tag panoya kopyalandı`;
});

// ---------------------------------------------------------------- yeni tag
function deviceLabel(d) {
  return d.internal ? `${d.name} (sunucu içi)` : `${d.name} (${d.type})`;
}

async function showAddTag(prefill = {}) {
  if (!analysis) await refreshAnalysis();
  const devices = (analysis && analysis.devices) || [];
  if (!devices.length) {
    openModal('Yeni tag', [el('p', { text: 'Projede cihaz yok. Önce Editör sekmesinde bir bağlantı (cihaz) ekle.' })],
      [{ label: 'Tamam', primary: true, onclick: closeModal }]);
    return;
  }
  const filtered = devices.find((d) => d.name === $('tagDevice').value);
  const initial = devices.find((d) => d.id === prefill.deviceId) || filtered
    || devices.find((d) => !d.internal) || devices[0];

  const device = el('select', { id: 'ntDevice' }, ...devices.map((d) => el('option', { value: d.id, text: deviceLabel(d) })));
  const name = el('input', { id: 'ntName', type: 'text', autocomplete: 'off' });
  const type = el('select', { id: 'ntType' });
  const address = el('input', { id: 'ntAddress', type: 'text', autocomplete: 'off', placeholder: 'ör. GVL.Motor1.Start' });
  const init = el('input', { id: 'ntInit', type: 'text', autocomplete: 'off' });
  const desc = el('input', { id: 'ntDesc', type: 'text', autocomplete: 'off' });
  const errBox = el('ul', { class: 'form-errors' });
  const addrRow = [el('label', { for: 'ntAddress', text: 'Adres' }), address];
  const initRow = [el('label', { for: 'ntInit', text: 'Başlangıç değeri' }), init];

  function syncDevice() {
    const d = devices.find((x) => x.id === device.value);
    const prev = type.value;
    type.replaceChildren(...d.types.map((t) => el('option', { value: t, text: t })));
    if (d.types.includes(prev)) type.value = prev;
    addrRow.forEach((e) => { e.hidden = d.internal; });
    initRow.forEach((e) => { e.hidden = !d.internal; });
  }
  device.value = initial.id;
  name.value = prefill.name || '';
  address.value = prefill.address || '';
  desc.value = prefill.description || '';
  syncDevice();
  if (prefill.type) type.value = prefill.type;
  device.addEventListener('change', syncDevice);

  async function save() {
    const res = await window.fxw.addTag({
      deviceId: device.value, name: name.value, type: type.value,
      address: address.value, init: init.value, description: desc.value,
    });
    if (!res) return;
    if (res.errors) {
      errBox.replaceChildren(...res.errors.map((m) => el('li', { text: m })));
      name.focus();
      return;
    }
    analysis = res.analysis || analysis;
    renderLint();
    renderTags();
    closeModal();
    $('statusText').textContent = `"${res.tag.name}" eklendi (kaydetmeyi unutma)`;
  }

  const form = el('div', { class: 'form' },
    el('label', { for: 'ntDevice', text: 'Cihaz' }), device,
    el('label', { for: 'ntName', text: 'Ad' }), name,
    el('label', { for: 'ntType', text: 'Tip' }), type,
    ...addrRow, ...initRow,
    el('label', { for: 'ntDesc', text: 'Açıklama' }), desc);
  form.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });

  openModal('Yeni tag', [
    form,
    errBox,
    el('p', { class: 'muted small', text: 'Tag cihaza hemen eklenir; cihazın bağlantısı bir an kopup yeniden kurulur. Dosyaya yazmak için kaydet.' }),
  ], [
    { label: 'İptal', onclick: closeModal },
    { label: 'Ekle', primary: true, onclick: save },
  ]);
  name.focus();
}

$('btnTagAdd').addEventListener('click', () => showAddTag());

// ---------------------------------------------------------------- modal
function openModal(title, bodyNodes, buttons) {
  modalOpen = true;
  syncEditor();
  $('modalTitle').textContent = title;
  $('modalBody').replaceChildren(...bodyNodes);
  $('modalButtons').replaceChildren(...buttons.map((b) => el('button', {
    class: b.primary ? 'primary' : '', text: b.label, onclick: b.onclick,
    ...(b.disabled ? { disabled: '' } : {}),
  })));
  $('modal').hidden = false;
  const first = $('modalButtons').querySelector('button.primary:not(:disabled)') || $('modalButtons').querySelector('button');
  if (first) first.focus();
}

function closeModal() {
  $('modal').hidden = true;
  modalOpen = false;
  syncEditor();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalOpen) closeModal();
});

// ---------------------------------------------------------------- publish
function findingsList(found) {
  if (!found.length) return el('p', { class: 'ok', text: 'Kontrol: sorun yok.' });
  return el('ul', { class: 'findings' }, ...found.map((f) => el('li', {},
    el('span', { class: `level-${f.level}`, text: f.level }), ` ${f.where}: ${f.message}`)));
}

function showPublishPlan(plan) {
  const blocked = plan.errors > 0;
  openModal('Publish (klasöre)', [
    el('p', { class: 'muted', text: 'Kaydedilmiş proje hedef makine için klasöre yazılır. Ağ üzerinden hiçbir yere gönderilmez; klasörü hedef makineye elle taşı.' }),
    el('dl', { class: 'kv' },
      el('dt', { text: 'Klasör' }), el('dd', { text: plan.dir || '-' }),
      el('dt', { text: 'Dosyalar' }), el('dd', { text: plan.files.map((f) => f.split(/[\\/]/).pop()).join(', ') })),
    blocked ? el('p', { class: 'err', text: `${plan.errors} hata var; publish yapılmaz. Editörde düzeltip kaydet.` }) : null,
    findingsList(plan.lint),
  ].filter(Boolean), [
    { label: 'Klasörü değiştir…', onclick: async () => { const p = await window.fxw.publishChooseDir(); if (p) showPublishPlan(p); } },
    { label: 'İptal', onclick: closeModal },
    { label: 'Publish', primary: true, disabled: blocked, onclick: runPublish },
  ]);
}

async function runPublish() {
  const res = await window.fxw.publishRun();
  if (!res) return;
  if (!res.ok) {
    showPublishPlan(res);
    return;
  }
  openModal('Publish tamamlandı', [
    el('p', { class: 'ok', text: 'Hedef makine için klasör hazır.' }),
    el('dl', { class: 'kv' }, el('dt', { text: 'Klasör' }), el('dd', { text: res.dir })),
    el('p', { class: 'muted', text: 'Hedef makinede ne yapılacağı klasördeki README.md\'de yazıyor.' }),
  ], [
    { label: 'Klasörü aç', onclick: () => window.fxw.reveal(res.dir) },
    { label: 'Tamam', primary: true, onclick: closeModal },
  ]);
}

async function publish() {
  if (!state.project || modalOpen) return;
  const plan = await window.fxw.publishPrepare();
  if (plan) showPublishPlan(plan);
}

// ---------------------------------------------------------------- karşılama ekranı ve menü komutları
$('wNew').addEventListener('click', () => window.fxw.newProject());
$('wOpen').addEventListener('click', () => window.fxw.open());
$('btnRetry').addEventListener('click', () => window.fxw.retryFuxa());

window.fxw.onCommand((cmd) => {
  if (cmd === 'publish') publish();
  else if (cmd.startsWith('tab:') && state.project) showTab(cmd.slice(4));
});
window.fxw.onShowTab((tab) => {
  if (modalOpen) closeModal();
  showTab(tab);
});
window.fxw.onState(render);
window.fxw.state().then(render);
