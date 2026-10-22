'use strict';
// fuxaw pencere arayüzü. Metinler DOM'a hep textContent ile basılır (el()); innerHTML kullanma:
// proje/tag/dosya adları dışarıdan gelir.

const $ = (id) => document.getElementById(id);
const { t } = window.I18N;

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

// ---------------------------------------------------------------- dil
// Dil ana süreçte seçilir (Ayarlar → Dil) ve durumla gelir; HTML'deki sabit metinler data-i18n* ile basılır.
function applyStaticText() {
  document.documentElement.lang = window.I18N.getLanguage();
  document.querySelectorAll('[data-i18n]').forEach((e) => { e.textContent = t(e.dataset.i18n); });
  document.querySelectorAll('[data-i18n-title]').forEach((e) => { e.title = t(e.dataset.i18nTitle); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((e) => { e.placeholder = t(e.dataset.i18nPlaceholder); });
}

function setLanguage(lang) {
  if (!lang || lang === document.documentElement.dataset.lang) return false;
  document.documentElement.dataset.lang = lang;
  window.I18N.setLanguage(lang);
  applyStaticText();
  return true;
}

// ---------------------------------------------------------------- durum
function render(s) {
  const langChanged = setLanguage(s.lang);
  state = s;
  const p = s.project;

  const info = $('projectInfo');
  info.replaceChildren();
  if (p) {
    info.append(el('b', { text: p.name }));
    if (p.dirty) info.append(el('span', { class: 'dirty', text: t('ui.unsavedMark') }));
  }

  // Bileşen durumu sadece sorun olunca gösterilir (açılışı açılış penceresi bekler).
  const chip = $('engineChip');
  const f = s.fuxa;
  chip.hidden = f.status === 'ready';
  chip.className = `chip ${f.status}`;
  chip.textContent = f.status === 'starting' ? t('engine.loading') : t('engine.error');
  chip.title = f.status === 'error' ? f.error : '';

  $('welcome').hidden = !!p;
  $('tabs').style.visibility = p ? 'visible' : 'hidden';
  renderRecent(s.recent);
  $('welcomeStatus').textContent = f.status === 'error' ? t('engine.failed', { error: f.error })
    : f.status === 'starting' ? t('engine.loading') : '';
  $('btnRetry').hidden = f.status !== 'error';
  $('wNew').disabled = s.busy || f.status !== 'ready';
  $('wOpen').disabled = s.busy || f.status !== 'ready';

  $('statusText').textContent = s.busy ? t('ui.busy') : (p && p.note) || (p && !p.dirty ? t('ui.saved') : '');
  $('statusPath').textContent = p ? (p.path || t('ui.unsavedProject')) : '';
  $('editorPlaceholder').textContent = f.status === 'ready' ? t('ui.loadingEditor') : t('engine.loading');
  syncEditor();
  // Kontrol sonuçları (lint mesajları, kullanım yerleri) ana süreçte üretilir: yeni dilde yeniden iste.
  if (langChanged && analysis && p) refreshAnalysis();
}

function renderRecent(list) {
  const ul = $('recentList');
  ul.replaceChildren();
  if (!list.length) {
    ul.append(el('li', { class: 'muted', text: t('ui.recentNone') }));
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
  const visible = !!state.project && ['editor', 'connections', 'tags', 'scripts'].includes(activeTab) && !modalOpen;
  window.fxw.editorVisible(visible);
  if (visible) sendBounds();
}

function sendBounds() {
  const r = $(activeTab === 'scripts' ? 'scriptsHost' : activeTab === 'tags' ? 'tagsHost' : activeTab === 'connections' ? 'connectionsHost' : 'editorHost').getBoundingClientRect();
  window.fxw.editorBounds({ x: r.left, y: r.top, width: r.width, height: r.height });
}

const hostObserver = new ResizeObserver(() => { if (['editor', 'connections', 'tags', 'scripts'].includes(activeTab)) sendBounds(); });
hostObserver.observe($('editorHost'));
hostObserver.observe($('connectionsHost'));
hostObserver.observe($('tagsHost'));
hostObserver.observe($('scriptsHost'));
window.addEventListener('resize', () => { if (['editor', 'connections', 'tags', 'scripts'].includes(activeTab)) sendBounds(); });

// ---------------------------------------------------------------- sekmeler
function showTab(tab, navigate = true) {
  if (navigate && state.project && ['editor', 'connections', 'tags', 'scripts'].includes(tab)) {
    window.fxw.editorPage(tab === 'connections' ? 'device' : tab);
    return;
  }
  activeTab = tab;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('active', p.id === `pane-${tab}`));
  syncEditor();
  if (tab === 'lint' && state.project) refreshAnalysis();
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
  const errors = found.filter((f) => f.level === 'HATA').length; // seviye kodları: HATA / UYARI
  const badge = $('lintBadge');
  badge.hidden = !found.length;
  badge.textContent = String(errors || found.length);
  badge.classList.toggle('warn', !errors);
  if (!found.length) {
    body.append(el('tr', {}, el('td', { colspan: '3', class: 'empty', text: t('ui.lintNone') })));
    return;
  }
  for (const f of found) {
    body.append(el('tr', {},
      el('td', { class: `level-${f.level}`, text: t(`lint.level.${f.level}`) }),
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
  sel.replaceChildren(el('option', { value: '', text: t('ui.allDevices') }), ...devs.map((d) => el('option', { value: d, text: d })));
  sel.value = devs.includes(prev) ? prev : '';

  const shown = visibleTags();
  $('tagCount').textContent = t('ui.tagCount', { shown: shown.length, total: rows.length });
  const body = $('tagBody');
  body.replaceChildren();
  $('tagUses').hidden = true;
  if (!shown.length) {
    body.append(el('tr', {}, el('td', { colspan: '5', class: 'empty', text: rows.length ? t('ui.tagsNoMatch') : t('ui.tagsNone') })));
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
  box.replaceChildren(el('h3', { text: t('ui.tagUsesTitle', { name: r.name, device: r.device }) }),
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
  const lines = [['ui.colName', 'ui.colType', 'ui.colAddress', 'ui.colDevice', 'ui.colUses'].map((k) => t(k)).join('\t'),
    ...rows.map((r) => [r.name, r.type, r.address, r.device, r.uses.length].join('\t'))];
  await navigator.clipboard.writeText(lines.join('\n'));
  $('statusText').textContent = t('ui.tagsCopied', { count: rows.length });
});

// ---------------------------------------------------------------- ADS sembolleri
// PLC sembolleri yalnız kullanıcı "Sembolleri oku" dediğinde okunur (ana süreç, ayrı kısa bağlantı).
// Desteklenmeyen dizi/yapı sembolleri listelenir ama seçilemez; mevcut tag'ler korunur.
async function openAdsSymbols() {
  if (!state.project || modalOpen) return;
  let list = null;
  try { list = await window.fxw.adsDevices(); } catch { /* aşağıda gösterilir */ }
  if (!list) {
    openModal(t('ads.title'), [el('p', { class: 'err', text: t('op.failed') })],
      [{ label: t('common.ok'), primary: true, onclick: closeModal }]);
    return;
  }
  if (!list.devices.length) {
    openModal(t('ads.title'), [el('p', { text: t('ads.noDevice') })],
      [{ label: t('common.ok'), primary: true, onclick: closeModal }]);
    return;
  }

  const ui = { devices: list.devices, deviceId: list.devices[0].id, symbols: null, loading: false };
  const current = () => ui.devices.find((d) => d.id === ui.deviceId) || ui.devices[0];
  const existing = () => new Set((current().addresses || []).map(a => a.toLowerCase()));
  const selected = new Set();
  let query = '';
  let group = '';
  let supportedOnly = true;
  let failed = false;
  let visible = [];

  const deviceSelect = el('select', {},
    ...ui.devices.map((d) => el('option', { value: d.id, text: `${d.name} (${d.address || d.type})` })));
  deviceSelect.value = ui.deviceId;
  const search = el('input', { type: 'search', placeholder: t('ads.search') });
  const groupSelect = el('select', {});
  const supported = el('input', { type: 'checkbox' });
  supported.checked = true;
  const selectAll = el('input', { type: 'checkbox' });
  const tbody = el('tbody');
  const status = el('p', { class: 'muted small' });
  const summary = el('span', { class: 'muted' });
  const table = el('table', { class: 'grid' },
    el('thead', {}, el('tr', {},
      el('th', {}, selectAll), el('th', { text: t('ads.colSymbol') }), el('th', { text: t('ads.colAdsType') }),
      el('th', { text: t('ads.colTagType') }), el('th', { text: t('ads.colStatus') }))),
    tbody);
  const body = el('div', { class: 'ads-picker' },
    el('div', { class: 'pane-bar' },
      el('label', {}, el('span', { class: 'muted', text: `${t('ads.device')}: ` }), deviceSelect),
      el('label', { class: 'check' }, supported, el('span', { text: t('ads.supportedOnly') })),
      el('div', { class: 'spacer' }), summary),
    el('div', { class: 'pane-bar' }, search, groupSelect),
    el('div', { class: 'table-wrap' }, table),
    status);

  function canSelect(s) { return s.supported && !existing().has(s.name.toLowerCase()); }

  function updateSummary() {
    summary.textContent = t('ads.selected', { count: selected.size });
    addBtn.disabled = ui.loading || selected.size === 0;
    readBtn.disabled = ui.loading;
    deviceSelect.disabled = ui.loading;
  }

  function updateSelectAll() {
    const rows = visible.filter(canSelect);
    const picked = rows.filter((s) => selected.has(s.name)).length;
    selectAll.checked = rows.length > 0 && picked === rows.length;
    selectAll.indeterminate = picked > 0 && picked < rows.length;
    selectAll.disabled = rows.length === 0;
  }

  function refreshGroups() {
    const all = ui.symbols || [];
    const names = [...new Set(all.map((s) => s.group).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const options = [el('option', { value: '', text: t('ads.groupAll') })];
    if (all.some((s) => s.group === '')) options.push(el('option', { value: '__global__', text: t('ads.groupGlobal') }));
    for (const name of names) options.push(el('option', { value: name, text: name }));
    groupSelect.replaceChildren(...options);
    group = '';
    groupSelect.value = '';
  }

  function renderRows() {
    const used = existing();
    const q = query.trim().toLowerCase();
    visible = (ui.symbols || []).filter((s) => {
      if (group === '__global__' ? s.group !== '' : group && s.group !== group) return false;
      if (supportedOnly && !s.supported) return false;
      return !q || `${s.name} ${s.type} ${s.tagType || ''}`.toLowerCase().includes(q);
    });
    tbody.replaceChildren(...visible.map((s) => {
      const added = used.has(s.name.toLowerCase());
      const disabled = !s.supported || added;
      const box = el('input', { type: 'checkbox', ...(disabled ? { disabled: '' } : {}) });
      box.checked = !disabled && selected.has(s.name);
      box.addEventListener('change', () => {
        if (box.checked) selected.add(s.name); else selected.delete(s.name);
        updateSummary();
        updateSelectAll();
      });
      const state = added ? t('ads.alreadyAdded') : !s.supported ? t(`ads.reason.${s.reason}`) : '';
      return el('tr', { class: disabled ? 'muted' : '' },
        el('td', {}, box), el('td', { title: s.name, text: s.name }), el('td', { text: s.type }),
        el('td', { text: s.tagType || '—' }), el('td', { text: state }));
    }));
    if (!visible.length && !failed) {
      tbody.append(el('tr', {}, el('td', { colspan: '5', class: 'empty', text: ui.symbols ? t('ads.noMatch') : t('ads.scanHint') })));
    }
    updateSummary();
    updateSelectAll();
  }

  async function scan() {
    if (ui.loading) return;
    ui.loading = true;
    ui.symbols = null;
    selected.clear();
    failed = false;
    status.className = 'muted small';
    status.textContent = t('ads.scanning');
    renderRows();
    let res = null;
    try { res = await window.fxw.adsBrowse({ deviceId: ui.deviceId }); } catch (e) { res = { ok: false, message: e.message }; }
    ui.loading = false;
    if (res && res.ok) {
      ui.symbols = res.symbols || [];
      refreshGroups();
      renderRows();
      status.className = 'muted small';
      if (!ui.symbols.length) { status.textContent = t('ads.noSymbols'); return; }
      const supportedCount = ui.symbols.filter((s) => s.supported).length;
      status.textContent = t('ads.count', { supported: supportedCount, total: ui.symbols.length });
    } else {
      ui.symbols = [];
      failed = true;
      refreshGroups();
      renderRows();
      status.className = 'err small';
      status.textContent = res && res.reason === 'config'
        ? (res.message || t('ads.configFailed', { error: '' }))
        : t('ads.connectFailed', { error: (res && res.message) || '' });
    }
  }

  async function doImport() {
    if (ui.loading || !selected.size) return;
    const byName = new Map((ui.symbols || []).map((s) => [s.name, s]));
    const symbols = [...selected].map((name) => byName.get(name)).filter((s) => s && s.supported)
      .map((s) => ({ name: s.name, type: s.type, adsType: s.adsType, comment: s.comment }));
    ui.loading = true;
    updateSummary();
    let res = null;
    try { res = await window.fxw.adsImport({ deviceId: ui.deviceId, symbols }); } catch (e) { res = { ok: false, error: e.message }; }
    ui.loading = false;
    if (!res || !res.ok) {
      status.className = 'err small';
      status.textContent = (res && res.error) || t('ads.importFailed');
      updateSummary();
      return;
    }
    current().addresses = res.addresses || current().addresses;
    selected.clear();
    status.className = 'ok small';
    status.textContent = t('ads.importResult', { added: res.added.length, skipped: res.skipped.length });
    renderRows();
    await refreshAnalysis();
  }

  search.addEventListener('input', () => { query = search.value; renderRows(); });
  groupSelect.addEventListener('change', () => { group = groupSelect.value; renderRows(); });
  supported.addEventListener('change', () => { supportedOnly = supported.checked; renderRows(); });
  selectAll.addEventListener('change', () => {
    for (const s of visible.filter(canSelect)) {
      if (selectAll.checked) selected.add(s.name); else selected.delete(s.name);
    }
    renderRows();
  });
  deviceSelect.addEventListener('change', () => {
    ui.deviceId = deviceSelect.value;
    ui.symbols = null;
    selected.clear();
    failed = false;
    status.className = 'muted small';
    status.textContent = '';
    refreshGroups();
    renderRows();
  });

  openModal(t('ads.title'), [body], [
    { label: t('common.cancel'), onclick: closeModal },
    { label: t('ads.read'), onclick: scan },
    { label: t('ads.add'), primary: true, disabled: true, onclick: doImport },
  ], { wide: true });
  const buttons = $('modalButtons').querySelectorAll('button');
  const readBtn = buttons[1];
  const addBtn = buttons[2];
  renderRows();
}

// ---------------------------------------------------------------- kontrol alt görünümleri
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
function openModal(title, bodyNodes, buttons, { wide = false } = {}) {
  modalOpen = true;
  syncEditor();
  $('modalTitle').textContent = title;
  $('modalBody').replaceChildren(...bodyNodes);
  $('modalButtons').replaceChildren(...buttons.map((b) => el('button', {
    class: b.primary ? 'primary' : '', text: b.label, onclick: b.onclick,
    ...(b.disabled ? { disabled: '' } : {}),
  })));
  $('modalBody').parentElement.classList.toggle('wide', wide);
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
  if (!found.length) return el('p', { class: 'ok', text: t('publish.noIssues') });
  return el('ul', { class: 'findings' }, ...found.map((f) => el('li', {},
    el('span', { class: `level-${f.level}`, text: t(`lint.level.${f.level}`) }), ` ${f.where}: ${f.message}`)));
}

function showPublishPlan(plan) {
  const blocked = plan.errors > 0;
  openModal(t('publish.title'), [
    el('p', { class: 'muted', text: t('publish.intro') }),
    el('dl', { class: 'kv' },
      el('dt', { text: t('publish.folder') }), el('dd', { text: plan.dir || '-' }),
      el('dt', { text: t('publish.files') }), el('dd', { text: plan.files.map((f) => f.split(/[\\/]/).pop()).join(', ') })),
    blocked ? el('p', { class: 'err', text: t('publish.blocked', { count: plan.errors }) }) : null,
    findingsList(plan.lint),
  ].filter(Boolean), [
    { label: t('publish.changeDir'), onclick: async () => { const p = await window.fxw.publishChooseDir(); if (p) showPublishPlan(p); } },
    { label: t('common.cancel'), onclick: closeModal },
    { label: t('publish.run'), primary: true, disabled: blocked, onclick: runPublish },
  ]);
}

async function runPublish() {
  const res = await window.fxw.publishRun();
  if (!res) return;
  if (!res.ok) {
    showPublishPlan(res);
    return;
  }
  const base = (f) => f.split(/[\\/]/).pop();
  openModal(t('publish.doneTitle'), [
    el('p', { class: 'ok', text: t('publish.ready') }),
    el('dl', { class: 'kv' }, el('dt', { text: t('publish.folder') }), el('dd', { text: res.dir })),
    el('p', { class: 'muted', text: t('publish.doneHint', { cmd: base(res.files[0]), json: base(res.files[1]) }) }),
  ], [
    { label: t('publish.openDir'), onclick: () => window.fxw.reveal(res.dir) },
    { label: t('common.ok'), primary: true, onclick: closeModal },
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
  else if (cmd === 'ads-symbols') openAdsSymbols();
  else if (cmd.startsWith('tab:') && state.project) showTab(cmd.slice(4));
});
window.fxw.onShowTab((tab) => {
  if (modalOpen) closeModal();
  showTab(tab, false);
});
window.fxw.onState(render);
window.fxw.state().then(render);
