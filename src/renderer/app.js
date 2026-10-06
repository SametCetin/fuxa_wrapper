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
  ['btnConnectionAdd', 'btnConnectionOther', 'btnConnectionRefresh', 'btnAdsSettings'].forEach(id => { $(id).disabled = s.busy || !p; });

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
  const visible = !!state.project && ['editor', 'connections', 'tags'].includes(activeTab) && !modalOpen;
  window.fxw.editorVisible(visible);
  if (visible) sendBounds();
}

function sendBounds() {
  const r = $(activeTab === 'tags' ? 'tagsHost' : activeTab === 'connections' ? 'connectionsHost' : 'editorHost').getBoundingClientRect();
  window.fxw.editorBounds({ x: r.left, y: r.top, width: r.width, height: r.height });
}

const hostObserver = new ResizeObserver(() => { if (['editor', 'connections', 'tags'].includes(activeTab)) sendBounds(); });
hostObserver.observe($('editorHost'));
hostObserver.observe($('connectionsHost'));
hostObserver.observe($('tagsHost'));
window.addEventListener('resize', () => { if (['editor', 'connections', 'tags'].includes(activeTab)) sendBounds(); });

// ---------------------------------------------------------------- sekmeler
function showTab(tab, navigate = true) {
  if (navigate && state.project && ['editor', 'connections', 'tags'].includes(tab)) {
    window.fxw.editorPage(tab === 'connections' ? 'device' : tab);
    return;
  }
  activeTab = tab;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === (tab === 'ads' ? 'connections' : tab)));
  document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('active', p.id === `pane-${tab}`));
  syncEditor();
  if (tab === 'lint' && state.project) refreshAnalysis();
  if (tab === 'ads' && state.project) refreshConnections();
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

// ---------------------------------------------------------------- bağlantılar
let connectionData = null;
let connectionRequest = null;
function refreshConnections() {
  if (!connectionRequest) connectionRequest = loadConnections().finally(() => { connectionRequest = null; });
  return connectionRequest;
}
async function loadConnections() {
  connectionData = await window.fxw.connections();
  const body = $('connectionBody');
  body.replaceChildren();
  if (!connectionData) return;
  const devices = connectionData.devices.filter(d => d.type === 'ADSclient');
  if (!devices.length) body.append(el('tr', {}, el('td', { colspan: '5', class: 'empty', text: 'Henüz bağlantı yok. Yeni ADS bağlantısı ile bağlantı yöntemini seçerek başla.' })));
  for (const device of devices) {
    const mode = device.property?.adsTransport || 'tcp';
    const label = device.type === 'ADSclient'
      ? (mode === 'native' ? 'ADS — Yerel TwinCAT' : mode === 'tcp' ? 'ADS / TCP' : 'ADS — Bilinmeyen yöntem') : device.type;
    body.append(el('tr', {}, el('td', { text: device.name }), el('td', { text: label }),
      el('td', { text: device.property?.address || '—' }),
      el('td', { text: device.enabled ? 'Etkin' : 'Devre dışı' }),
      el('td', {}, el('button', { text: 'Düzenle', onclick: () => device.type === 'ADSclient' ? showConnection(device) : window.fxw.otherConnections() }))));
  }
}

async function showConnection(device = null) {
  if (!state.project || modalOpen) return;
  await refreshConnections();
  if (!connectionData) return;
  if (device) device = connectionData.devices.find(d => d.id === device.id);
  const property = device?.property || {};
  const parts = String(property.address || '').split(':');
  const name = el('input', { id: 'acName', type: 'text', ...(device ? { readonly: '' } : {}) });
  name.value = device?.name || '';
  const method = el('select', { id: 'acMethod' },
    el('option', { value: '', text: 'Bağlantı yöntemini seç…' }),
    el('option', { value: 'native', text: 'Yerel TwinCAT (Windows x64)', ...(!connectionData.nativeAvailable ? { disabled: '' } : {}) }),
    el('option', { value: 'tcp', text: 'ADS / TCP' }));
  method.value = device ? property.adsTransport || 'tcp' : '';
  const netId = el('input', { id: 'acNetId', type: 'text', placeholder: 'ör. 192.168.1.10.1.1' });
  netId.value = parts[0] || '';
  const port = el('input', { id: 'acPort', type: 'number', min: '1', max: '65535' });
  port.value = parts[1] || property.port || 851;
  const polling = el('input', { id: 'acPolling', type: 'number', min: '50', max: '3600000' });
  polling.value = device?.polling || 1000;
  const local = el('input', { id: 'acLocal', type: 'text', placeholder: 'ör. 192.168.1.20.1.1:32750 (isteğe bağlı)' });
  local.value = property.local || '';
  const router = el('input', { id: 'acRouter', type: 'text', placeholder: 'ör. 192.168.1.10:48898 (isteğe bağlı)' });
  router.value = property.router || '';
  const enabled = el('input', { id: 'acEnabled', type: 'checkbox' });
  enabled.checked = device?.enabled === true;
  const help = el('p', { id: 'acHelp', class: 'transport-help', 'aria-live': 'polite' });
  const errors = el('ul', { class: 'form-errors', role: 'alert' });
  const tcpFields = [el('label', { for: 'acLocal', text: 'Yerel AMS adresi' }), local,
    el('label', { for: 'acRouter', text: 'Router adresi / TCP portu' }), router];
  function syncMethod() {
    errors.replaceChildren();
    tcpFields.forEach(field => { field.hidden = method.value !== 'tcp'; });
    help.textContent = method.value === 'native'
      ? "Bu bilgisayarda TwinCAT ve Beckhoff ADS API'si kuruluysa seç. Yerel TwinCAT router'ı kullanılır; uzak PLC için router'da ADS rotası bulunmalı. Tag değerleri seçilen okuma aralığıyla okunur."
      : method.value === 'tcp'
        ? "TCP üzerinden ADS bağlantısı için seç. Router adresi hedef PLC'nin IP adresidir; varsayılan TCP portu 48898'dir. Yerel AMS adresi ve hedefte uygun ADS rotası gerekebilir."
        : 'Bu bilgisayarın kurulu TwinCAT router’ını kullanmak için Yerel TwinCAT; TCP router’a bağlanmak için ADS / TCP seç.';
  }
  method.addEventListener('change', syncMethod);
  syncMethod();
  async function apply() {
    const buttons = [...$('modalButtons').querySelectorAll('button')];
    buttons.forEach(button => { button.disabled = true; });
    errors.replaceChildren();
    try {
      const result = await window.fxw.saveConnection({ id: device?.id, name: name.value, transport: method.value,
        netId: netId.value, port: port.value, polling: polling.value, local: local.value, router: router.value, enabled: enabled.checked });
      if (!result) { errors.append(el('li', { text: 'Bağlantı uygulanamadı.' })); return; }
      if (result.errors) { errors.replaceChildren(...result.errors.map(text => el('li', { text }))); return; }
      closeModal();
      await refreshConnections();
    } catch (error) { errors.append(el('li', { text: error.message })); }
    finally { buttons.forEach(button => { button.disabled = false; }); }
  }
  openModal(device ? 'ADS bağlantısını düzenle' : 'Yeni ADS bağlantısı', [
    el('div', { class: 'form' }, el('label', { for: 'acName', text: 'Bağlantı adı' }), name,
      el('label', { for: 'acMethod', text: 'Bağlantı yöntemi' }), method,
      el('label', { for: 'acNetId', text: 'Hedef AMS Net ID' }), netId,
      el('label', { for: 'acPort', text: 'Hedef ADS portu' }), port,
      el('label', { for: 'acPolling', text: 'Okuma aralığı (ms)' }), polling,
      ...tcpFields, el('label', { for: 'acEnabled', text: 'Bağlantıyı etkinleştir' }), enabled),
    help, errors, el('p', { class: 'muted small', text: 'Uygula cihaz ayarını değiştirir; etkin cihaz yeniden bağlanır. Proje dosyasına yazmak için Dosya → Kaydet kullan.' }),
  ], [{ label: 'İptal', onclick: closeModal }, { label: 'Uygula', primary: true, onclick: apply }]);
  name.focus();
}
$('btnConnectionAdd').addEventListener('click', () => showConnection());
$('btnConnectionRefresh').addEventListener('click', refreshConnections);
$('btnConnectionOther').addEventListener('click', () => window.fxw.otherConnections());
$('btnAdsSettings').addEventListener('click', () => showTab('ads'));
document.querySelectorAll('[data-control]').forEach(button => button.addEventListener('click', () => {
  const tags = button.dataset.control === 'tags';
  $('control-tags').hidden = !tags;
  $('control-lint').hidden = tags;
  document.querySelectorAll('[data-control]').forEach(b => {
    b.classList.toggle('primary', b === button);
    b.setAttribute('aria-pressed', String(b === button));
  });
}));

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
  showTab(tab, false);
});
window.fxw.onState(render);
window.fxw.state().then(render);
