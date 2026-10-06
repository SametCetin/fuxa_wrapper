'use strict';
// fuxaw masaüstü uygulaması: ana süreç.
//
// Akış: .fxprj tek gerçek kaynaktır. Açılan proje gömülü FUXA'ya yüklenir, ekranlar
// pencerenin içindeki FUXA editöründe tasarlanır, Kaydet editördeki hali .fxprj'e yazar.
// Publish kaydedilmiş hali hedef makine için klasöre çıkarır (ağa hiçbir şey gönderilmez).

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, WebContentsView, Menu, dialog, ipcMain, shell } = require('electron');

const { FuxaServer } = require('./fuxa');
const api = require('./fuxaApi');
const fxprj = require('../core/fxprj');
const model = require('../core/model');
const lintmod = require('../core/lint');
const { tagTable, tagTypesFor, isInternal, buildTag, prepareTagRemoval } = require('../core/tags');
const publisher = require('../core/publish');
const { buildAdsDevice } = require('../core/connections');
const { installDimensionCommit } = require('./editorDimensions');
const { readDeviceSelection, openDevicePage } = require('./editorDevices');

const APP_NAME = 'fuxaw';
const POLL_MS = 1500;

let win = null;
let splash = null;
let splashShownAt = 0;
let editorView = null;
let editorBounds = null;
let editorWanted = false;
let fuxa = null;
let fuxaState = { status: 'starting', url: null, error: null };
let pendingOpen = null; // FUXA hazır olmadan istenen dosya
let busy = false;
let lastTagDevice = null;

// Açık proje
const cur = {
  path: null,        // .fxprj yolu; null = kaydedilmemiş (yeni ya da içe aktarılmış)
  doc: null,         // fxprj belgesi (project alanı son kaydedilen/yüklenen hal)
  savedDigest: null, // dosyadaki projenin özeti (FUXA'nın yükledikten sonraki haliyle)
  liveDigest: null,  // FUXA'daki güncel halin özeti
  metaDirty: false,  // publish klasörü gibi proje dışı ayar değişti
  editorEdits: 0,    // editörde yapılıp henüz FUXA sunucusuna gitmemiş düzenleme sayısı
  note: null,        // kullanıcıya gösterilecek kısa bilgi
};

// ---------------------------------------------------------------- yardımcılar
function userFile(name) {
  return path.join(app.getPath('userData'), name);
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function recentList() {
  return readJson(userFile('recent.json'), []).filter((p) => typeof p === 'string');
}

function addRecent(p) {
  const list = [p, ...recentList().filter((x) => x.toLowerCase() !== p.toLowerCase())].slice(0, 10);
  fs.writeFileSync(userFile('recent.json'), JSON.stringify(list, null, 2));
  app.addRecentDocument(p);
  buildMenu();
}

function isDirty() {
  return !!cur.doc && (cur.metaDirty || !cur.path || cur.editorEdits > 0
    || (cur.liveDigest !== null && cur.liveDigest !== cur.savedDigest));
}

function snapshot() {
  return {
    fuxa: fuxaState,
    project: cur.doc && {
      name: cur.doc.name,
      path: cur.path,
      dirty: isDirty(),
      note: cur.note,
      publishDir: publisher.resolveDir(cur.doc, cur.path),
    },
    recent: recentList(),
    busy,
  };
}

function pushState() {
  if (!win || win.isDestroyed()) return;
  const s = snapshot();
  const title = s.project ? `${s.project.dirty ? '● ' : ''}${s.project.name} — ${APP_NAME}` : APP_NAME;
  win.setTitle(title);
  win.setDocumentEdited(!!(s.project && s.project.dirty));
  win.webContents.send('state', s);
  updateEditorVisibility();
}

function message(type, text, detail) {
  return dialog.showMessageBox(win, { type, title: APP_NAME, message: text, detail, buttons: ['Tamam'] });
}

function guard(fn) {
  return async (...args) => {
    if (busy) return undefined;
    busy = true;
    pushState();
    try {
      return await fn(...args);
    } catch (e) {
      await message('error', 'İşlem tamamlanamadı', e.message);
      return undefined;
    } finally {
      busy = false;
      pushState();
    }
  };
}

function requireFuxa() {
  if (fuxaState.status !== 'ready') {
    throw new Error(fuxaState.status === 'error'
      ? `Uygulama bileşenleri çalışmıyor: ${fuxaState.error}`
      : 'Bileşenler henüz yüklenmedi, birkaç saniye sonra tekrar dene.');
  }
  return fuxaState.url;
}

// ---------------------------------------------------------------- gömülü FUXA ve editör
async function startFuxa() {
  fuxaState = { status: 'starting', url: null, error: null };
  pushState();
  fuxa = new FuxaServer({
    packaged: app.isPackaged,
    userDir: userFile('fuxa'),
    logFile: logFile(),
  });
  try {
    const url = await fuxa.start();
    fuxaState = { status: 'ready', url, error: null };
  } catch (e) {
    fuxaState = { status: 'error', url: null, error: e.message };
  }
  pushState();
  // Açılışta istenen dosya ana pencere görünmeden yüklenir; hata mesajı pencere açılınca gösterilir.
  let openError = null;
  if (fuxaState.status === 'ready' && pendingOpen) {
    const p = pendingOpen;
    pendingOpen = null;
    try {
      await openPath(p, { skipConfirm: true });
    } catch (e) {
      openError = e;
    }
    pushState();
  }
  await revealMain();
  if (openError) await message('error', 'Proje açılamadı', openError.message);
}

function logFile() {
  return path.join(app.getPath('logs'), 'engine.log');
}

// ---------------------------------------------------------------- açılış penceresi
// Bileşenler yüklenirken (gömülü sunucu açılırken) gösterilir. Kullanıcıya iç bileşenin adı gösterilmez.
const SPLASH_MIN_MS = 1200; // çok hızlı açılışta yanıp sönmesin

function createSplash() {
  splash = new BrowserWindow({
    width: 440,
    height: 240,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    center: true,
    show: false,
    title: APP_NAME,
    backgroundColor: '#1e1f22',
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  splash.webContents.on('will-navigate', (e) => e.preventDefault());
  splash.loadFile(path.join(__dirname, '..', 'renderer', 'splash.html'));
  splash.once('ready-to-show', () => {
    splashShownAt = Date.now();
    if (splash) splash.show();
  });
  splash.on('closed', () => {
    splash = null;
    // Açılış penceresi (Alt+F4 ile) ana pencereden önce kapatılırsa uygulama gizli kalmasın.
    if (win && !win.isDestroyed() && !win.isVisible()) app.quit();
  });
}

/** Ana pencereyi göster, açılış penceresini kapat (sadece ilk seferde bir şey yapar). */
async function revealMain() {
  if (!win || win.isDestroyed() || win.isVisible()) return;
  const wait = SPLASH_MIN_MS - (Date.now() - (splashShownAt || Date.now()));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  if (!win || win.isDestroyed()) return;
  win.show();
  if (splash) splash.close();
}

// FUXA editörünün kendi proje menüsü (New/Save/Open/Rename) uygulamanın Dosya menüsüyle çakışır: gizli.
const EDITOR_CSS = `
button[title="Save Project"] { display: none !important; }
body.fxw-flush .cdk-overlay-container { opacity: 0 !important; }
`;

// Editör çizim değişikliklerini kendi "Save Project"ine (veya ekran değişimine) kadar sunucuya göndermez.
// Bekleyen düzenlemeleri görmek için svg-edit'in geri alma geçmişine eklenen her komut sayılır.
const EDITOR_JS = `(() => {
  if (window.__fxw) return;
  window.__fxw = { edits: 0 };
  (${installDimensionCommit.toString()})();
  const t = setInterval(() => {
    const c = window.svgEditor && window.svgEditor.canvas;
    if (!c || !c.undoMgr) return;
    clearInterval(t);
    const proto = Object.getPrototypeOf(c.undoMgr);
    const orig = proto.addCommandToHistory;
    proto.addCommandToHistory = function (...a) { window.__fxw.edits++; return orig.apply(this, a); };
  }, 200);
})()`;

function createEditorView() {
  editorView = new WebContentsView({
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  const wc = editorView.webContents;
  wc.on('dom-ready', () => {
    cur.editorEdits = 0;
    wc.insertCSS(EDITOR_CSS).catch(() => {});
    wc.executeJavaScript(EDITOR_JS).catch(() => {});
  });
  // Sadece gömülü FUXA'nın sayfaları bu görünümde açılır; başka adresler sistem tarayıcısına.
  wc.on('will-navigate', (e, url) => {
    if (!fuxaState.url || !url.startsWith(fuxaState.url + '/')) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });
  // Editörün açtığı pencereler (ör. önizleme) sayfanın kendi başlığını değil uygulama adını taşır.
  wc.on('did-create-window', (w) => {
    w.setTitle(APP_NAME);
    w.on('page-title-updated', (e) => e.preventDefault());
  });
  wc.setWindowOpenHandler(({ url }) => {
    if (fuxaState.url && url.startsWith(fuxaState.url + '/')) {
      return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, width: 1280, height: 800 } };
    }
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  editorView.setVisible(false);
  win.contentView.addChildView(editorView);
}

function updateEditorVisibility() {
  if (!editorView) return;
  const show = editorWanted && !!cur.doc && fuxaState.status === 'ready' && !!editorBounds;
  if (show) editorView.setBounds(editorBounds);
  editorView.setVisible(show);
}

async function loadEditor() {
  const url = `${fuxaState.url}/editor`;
  await editorView.webContents.loadURL(url).catch(() => {});
}

/** Editörde kaydedilmemiş değişiklik varsa FUXA sunucusuna aktar (editörün kendi "Save Project"i). */
async function flushEditor() {
  if (!editorView || !cur.doc) return;
  const wc = editorView.webContents;
  if (!wc.getURL().includes('/editor')) return;
  const js = `(async () => {
    window.__fxw && window.__fxw.commitDimensions && window.__fxw.commitDimensions();
    const trigger = document.querySelector('button[title="Save Project"]');
    if (!trigger) return 'no-trigger';
    document.body.classList.add('fxw-flush');
    try {
      trigger.click();
      for (let i = 0; i < 20; i++) {
        const items = [...document.querySelectorAll('.mat-mdc-menu-panel .mat-mdc-menu-item')];
        if (items.length) {
          const save = items.find((b) => b.innerText.trim() === 'Save Project') || items[1];
          save.click();
          return 'saved';
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      return 'no-menu';
    } finally {
      setTimeout(() => document.body.classList.remove('fxw-flush'), 300);
    }
  })()`;
  try {
    if ((await wc.executeJavaScript(js)) === 'saved') {
      await new Promise((r) => setTimeout(r, 400)); // FUXA'nın kaydı sunucuya yazması
      await wc.executeJavaScript('window.__fxw && (window.__fxw.edits = 0)');
      cur.editorEdits = 0;
    }
  } catch { /* editör yüklenmemiş olabilir */ }
}

// ---------------------------------------------------------------- değişiklik takibi
let polling = false;
async function poll() {
  if (polling || busy || !cur.doc || fuxaState.status !== 'ready') return;
  polling = true;
  try {
    const prj = await api.getProject(fuxaState.url);
    const d = model.digest(prj);
    let edits = cur.editorEdits;
    if (editorView && editorView.webContents.getURL().includes('/editor')) {
      edits = Number(await editorView.webContents.executeJavaScript('window.__fxw ? window.__fxw.edits : 0').catch(() => 0)) || 0;
    }
    if (d !== cur.liveDigest || edits !== cur.editorEdits) {
      cur.liveDigest = d;
      cur.editorEdits = edits;
      pushState();
    }
  } catch { /* geçici */ } finally {
    polling = false;
  }
}

// ---------------------------------------------------------------- proje işlemleri
async function loadDoc(doc, filePath, note) {
  lastTagDevice = null;
  const url = requireFuxa();
  await api.setProject(url, doc.project);
  const loaded = await api.getProject(url);
  cur.doc = doc;
  cur.path = filePath;
  cur.savedDigest = filePath ? model.digest(loaded) : null;
  cur.liveDigest = model.digest(loaded);
  cur.metaDirty = false;
  cur.note = note || null;
  editorWanted = true;
  win.webContents.send('show-tab', 'editor');
  await loadEditor();
}

/** Kaydedilmemiş değişiklik varsa sor. true = devam edilebilir. */
async function confirmDiscard(action) {
  if (!isDirty()) return true;
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    title: APP_NAME,
    message: `"${cur.doc.name}" projesinde kaydedilmemiş değişiklikler var.`,
    detail: `${action} önce kaydetmek ister misin?`,
    buttons: ['Kaydet', 'Kaydetme', 'İptal'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  });
  if (response === 2) return false;
  if (response === 1) return true;
  return saveProject(false);
}

async function newProject() {
  requireFuxa();
  if (!(await confirmDiscard('Yeni projeye geçmeden'))) return;
  await loadDoc(fxprj.newDoc('Adsız'), null, 'Yeni proje. Kaydet ile .fxprj dosyası olarak kaydet.');
}

async function openDialog() {
  requireFuxa();
  if (!(await confirmDiscard('Başka proje açmadan'))) return;
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Proje aç',
    properties: ['openFile'],
    filters: [
      { name: 'fuxaw projesi', extensions: ['fxprj'] },
      { name: 'Proje JSON (içe aktar)', extensions: ['json'] },
    ],
  });
  if (canceled || !filePaths.length) return;
  await openPath(filePaths[0], { skipConfirm: true });
}

async function openPath(p, { skipConfirm = false } = {}) {
  if (fuxaState.status !== 'ready') {
    pendingOpen = p;
    return;
  }
  if (!skipConfirm && !(await confirmDiscard('Başka proje açmadan'))) return;
  const { doc, imported } = fxprj.read(p);
  if (imported) {
    await loadDoc(doc, null, `Proje JSON'u içe aktarıldı (${path.basename(p)}). Kaydet ile .fxprj olarak kaydet.`);
  } else {
    await loadDoc(doc, p);
    addRecent(p);
  }
}

/** true = kaydedildi. */
async function saveProject(saveAs) {
  if (!cur.doc) return false;
  const url = requireFuxa();
  let target = cur.path;
  if (saveAs || !target) {
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: saveAs ? 'Farklı kaydet' : 'Projeyi kaydet',
      defaultPath: target || path.join(app.getPath('documents'), fxprj.safeName(cur.doc.name) + fxprj.EXT),
      filters: [{ name: 'fuxaw projesi', extensions: ['fxprj'] }],
    });
    if (canceled || !filePath) return false;
    target = filePath.toLowerCase().endsWith(fxprj.EXT) ? filePath : filePath + fxprj.EXT;
    if (!cur.path || cur.doc.name === 'Adsız') cur.doc.name = path.basename(target, fxprj.EXT);
  }
  await flushEditor();
  const prj = await api.getProject(url);
  cur.doc.project = prj;
  fxprj.write(target, cur.doc);
  cur.path = target;
  cur.savedDigest = model.digest(prj);
  cur.liveDigest = cur.savedDigest;
  cur.metaDirty = false;
  cur.note = null;
  addRecent(target);
  return true;
}

async function analyze() {
  if (!cur.doc) return null;
  const url = requireFuxa();
  await flushEditor();
  const items = model.splitProject(await api.getProject(url));
  const devices = model.itemsOfKind(items, 'device').map(([, d]) => ({
    id: d.id, name: d.name, type: d.type, internal: isInternal(d.type), types: tagTypesFor(d),
  })).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return { lint: lintmod.lint(items), tags: tagTable(items), devices };
}

/**
 * Cihaza yeni tag ekler: editördeki bekleyen değişiklikler önce sunucuya aktarılır, tag set-device ile yazılır,
 * sonra editör yeniden yüklenir (bellekteki eski cihaz kopyasıyla yeni tag'in üzerine yazmasın).
 * Doğrulama hatasında {errors}, başarıda {ok, tag, analysis}.
 */
async function addTag(spec) {
  if (!cur.doc || !spec || typeof spec !== 'object') return null;
  const url = requireFuxa();
  await flushEditor();
  const prj = await api.getProject(url);
  const device = (prj.devices || {})[spec.deviceId];
  if (!device) return { errors: ['Cihaz bulunamadı; listeyi yenile.'] };
  const res = buildTag(device, spec);
  if (res.errors) return res;
  device.tags = { ...(device.tags || {}), [res.tag.id]: res.tag };
  await api.projectData(url, 'set-device', device);
  await loadEditor(); // değişiklik takibi sonraki yoklamada tag'i "kaydedilmedi" olarak görür
  return { ok: true, tag: res.tag, analysis: await analyze() };
}

async function deleteTag(spec) {
  if (!cur.doc || !spec || typeof spec.deviceId !== 'string' || typeof spec.tagId !== 'string') return null;
  const url = requireFuxa();
  await flushEditor();
  const project = await api.getProject(url);
  const plan = prepareTagRemoval(project, spec);
  if (plan.errors) return plan;
  const usage = plan.uses.length
    ? `Tag kullanılıyor. Silersen bu referanslar bozulur:\n${plan.uses.map(u => `${u.where} — ${u.how}`).join('\n')}\n\n`
    : '';
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning', title: APP_NAME, message: `"${plan.tag.name}" tag'i silinsin mi?`,
    detail: `${plan.device.name}\n\n${usage}Değişikliği dosyaya yazmak için Kaydet gerekir.`,
    buttons: ['İptal', 'Sil'], defaultId: 0, cancelId: 0, noLink: true,
  });
  if (response !== 1) return { canceled: true };
  await api.projectData(url, 'set-device', plan.device);
  await loadEditor();
  cur.liveDigest = model.digest(await api.getProject(url));
  return { ok: true, tag: plan.tag, analysis: await analyze() };
}

async function connections() {
  if (!cur.doc) return null;
  await flushEditor();
  const project = await api.getProject(requireFuxa());
  return { devices: Object.values(project.devices || {}), nativeAvailable: process.platform === 'win32' && process.arch === 'x64' };
}

async function saveConnection(spec) {
  if (!cur.doc || !spec || typeof spec !== 'object') return null;
  const url = requireFuxa();
  await flushEditor();
  const project = await api.getProject(url);
  const result = buildAdsDevice(project.devices || {}, spec);
  if (result.errors) return result;
  await api.projectData(url, 'set-device', result.device);
  await loadEditor();
  await poll();
  return { ok: true };
}

// Publish: kaydedilmiş hali yazar. Kaydedilmemiş değişiklik varsa önce kaydetmek gerekir.
async function publishPrepare() {
  if (!cur.doc) return null;
  requireFuxa();
  await flushEditor();
  await poll();
  if (isDirty()) {
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      title: APP_NAME,
      message: 'Publish kaydedilmiş projeyi yazar.',
      detail: 'Kaydedilmemiş değişiklikler var. Önce kaydedilsin mi?',
      buttons: ['Kaydet ve devam et', 'İptal'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (response !== 0 || !(await saveProject(false))) return null;
  }
  return publisher.plan(cur.doc, cur.path);
}

async function publishChooseDir() {
  if (!cur.doc || !cur.path) return null;
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Publish klasörü',
    defaultPath: publisher.resolveDir(cur.doc, cur.path),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (canceled || !filePaths.length) return null;
  const rel = path.relative(path.dirname(cur.path), filePaths[0]);
  const dir = rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(path.sep).join('/') : filePaths[0];
  cur.doc.publish = { ...(cur.doc.publish || {}), dir };
  // Klasör seçimi .fxprj'e yazılır; publish kaydedilmiş hali yazdığından burada hemen kaydet.
  fxprj.write(cur.path, cur.doc);
  return publisher.plan(cur.doc, cur.path);
}

async function publishRun() {
  if (!cur.doc || !cur.path) return null;
  if (isDirty()) throw new Error('Kaydedilmemiş değişiklik var; önce kaydet.');
  return publisher.publish(fxprj.read(cur.path).doc, cur.path);
}

/** Gömülü sayfayı aç; cihaz yönetimi kendi Bağlantılar sekmesinde gösterilir. */
async function showEditorPage(page) {
  if (!cur.doc || fuxaState.status !== 'ready' || !editorView) return;
  const wc = editorView.webContents;
  const url = wc.getURL();
  if (url.startsWith(`${fuxaState.url}/device`)) {
    lastTagDevice = await wc.executeJavaScript(`(${readDeviceSelection.toString()})()`) || lastTagDevice;
  }
  const route = page === 'tags' ? 'device' : page;
  win.webContents.send('show-tab', page === 'tags' ? 'tags' : page === 'device' ? 'connections' : 'editor');
  if (url.includes('/editor')) await flushEditor(); // ayrılmadan bekleyen çizimleri sunucuya aktar
  if (!url.startsWith(`${fuxaState.url}/${route}`)) await wc.loadURL(`${fuxaState.url}/${route}`);
  if (route === 'device') {
    if (page === 'tags') {
      const project = await api.getProject(requireFuxa());
      const devices = [...Object.values(project.devices || {}), ...(project.server ? [project.server] : [])];
      if (!devices.some(d => d.name === lastTagDevice)) {
        lastTagDevice = (devices.find(d => !isInternal(d.type)) || devices[0])?.name || null;
      }
    }
    await wc.executeJavaScript(`(${openDevicePage.toString()})(${page === 'tags'}, ${JSON.stringify(lastTagDevice)})`);
  }
}

function openRuntime() {
  if (!cur.doc || fuxaState.status !== 'ready') return;
  const w = new BrowserWindow({
    width: 1280, height: 800, autoHideMenuBar: true, title: `${cur.doc.name} — runtime`,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  w.on('page-title-updated', (e) => e.preventDefault()); // sayfanın kendi başlığı görünmesin
  w.loadURL(`${fuxaState.url}/home`);
}

// ---------------------------------------------------------------- menü
function send(cmd) {
  return () => win && win.webContents.send('command', cmd);
}

function buildMenu() {
  const recent = recentList();
  const run = (fn) => () => guard(fn)();
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    {
      label: 'Dosya',
      submenu: [
        { label: 'Yeni Proje', accelerator: 'CmdOrCtrl+N', click: run(newProject) },
        { label: 'Proje Aç…', accelerator: 'CmdOrCtrl+O', click: run(openDialog) },
        {
          label: 'Son Projeler',
          submenu: recent.length
            ? recent.map((p) => ({ label: p, click: run(() => openPath(p)) }))
            : [{ label: '(boş)', enabled: false }],
        },
        { type: 'separator' },
        { label: 'Kaydet', accelerator: 'CmdOrCtrl+S', click: run(() => saveProject(false)) },
        { label: 'Farklı Kaydet…', accelerator: 'CmdOrCtrl+Shift+S', click: run(() => saveProject(true)) },
        { type: 'separator' },
        { label: 'Publish (klasöre)…', accelerator: 'CmdOrCtrl+Shift+P', click: send('publish') },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close', label: 'Kapat' } : { role: 'quit', label: 'Çıkış' },
      ],
    },
    {
      label: 'Proje',
      submenu: [
        { label: 'Editör', accelerator: 'CmdOrCtrl+1', click: run(() => showEditorPage('editor')) },
        { label: 'Taglar', accelerator: 'CmdOrCtrl+2', click: run(() => showEditorPage('tags')) },
        { label: 'Kontrol (lint)', accelerator: 'CmdOrCtrl+3', click: send('tab:lint') },
        { type: 'separator' },
        { label: 'Runtime\'ı aç (önizleme)', accelerator: 'F5', click: openRuntime },
        { label: 'Editörü yenile', click: () => cur.doc && loadEditor() },
      ],
    },
    {
      label: 'Ayarlar',
      submenu: [
        { label: 'Bağlantılar ve tag yönetimi…', accelerator: 'CmdOrCtrl+4', click: run(() => showEditorPage('device')) },
        { label: 'Sunucu eklentileri…', accelerator: 'CmdOrCtrl+5', click: run(() => showEditorPage('plugins')) },
      ],
    },
    {
      label: 'Görünüm',
      submenu: [
        { role: 'zoomIn', label: 'Yakınlaştır' },
        { role: 'zoomOut', label: 'Uzaklaştır' },
        { role: 'resetZoom', label: 'Gerçek boyut' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Tam ekran' },
        { label: 'Geliştirici araçları (editör)', accelerator: 'F12', click: () => editorView && editorView.webContents.toggleDevTools() },
        { label: 'Geliştirici araçları (uygulama)', accelerator: 'CmdOrCtrl+Shift+I', click: () => win && win.webContents.toggleDevTools() },
      ],
    },
    {
      label: 'Yardım',
      submenu: [
        { label: 'Günlük dosyasını aç', click: () => shell.openPath(logFile()) },
        { label: 'Uygulama veri klasörü', click: () => shell.openPath(app.getPath('userData')) },
        { type: 'separator' },
        {
          label: `${APP_NAME} hakkında`,
          click: () => message('info', `${APP_NAME} ${app.getVersion()}`,
            'HMI proje tasarımı için masaüstü uygulaması.'),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------- IPC (arayüz → ana süreç)
function handle(channel, fn) {
  ipcMain.handle(channel, async (e, ...args) => {
    if (!win || e.sender !== win.webContents) throw new Error('izin yok');
    return fn(...args);
  });
}

function registerIpc() {
  handle('state', () => snapshot());
  handle('new', guard(newProject));
  handle('open', guard(openDialog));
  handle('open-recent', guard((p) => (recentList().includes(p) ? openPath(p) : null)));
  handle('save', guard(() => saveProject(false)));
  handle('save-as', guard(() => saveProject(true)));
  handle('analyze', guard(analyze));
  handle('tag:add', guard(addTag));
  handle('tag:delete', guard(deleteTag));
  handle('connections:list', guard(connections));
  handle('connections:save', guard(saveConnection));
  handle('connections:other', guard(() => showEditorPage('device')));
  handle('editor:page', guard((page) => ['editor', 'device', 'tags'].includes(page) && showEditorPage(page)));
  handle('publish:prepare', guard(publishPrepare));
  handle('publish:choose-dir', guard(publishChooseDir));
  handle('publish:run', guard(publishRun));
  handle('reveal', (p) => {
    const dir = publisher.resolveDir(cur.doc || {}, cur.path);
    if (dir && typeof p === 'string' && path.resolve(p).startsWith(dir)) shell.openPath(p);
  });
  handle('runtime', () => openRuntime());
  handle('retry-fuxa', () => fuxaState.status === 'error' && startFuxa());
  handle('editor:bounds', (b) => {
    editorBounds = b && {
      x: Math.round(b.x), y: Math.round(b.y), width: Math.max(0, Math.round(b.width)), height: Math.max(0, Math.round(b.height)),
    };
    updateEditorVisibility();
  });
  handle('editor:visible', (v) => {
    editorWanted = !!v;
    updateEditorVisibility();
  });
}

// ---------------------------------------------------------------- uygulama
function fileArg(argv) {
  return argv.slice(1).find((a) => !a.startsWith('-') && /\.(fxprj|json)$/i.test(a) && fs.existsSync(a)) || null;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: APP_NAME,
    backgroundColor: '#1e1f22',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  createEditorView();

  let closing = false;
  win.on('close', async (e) => {
    if (closing || !isDirty()) return;
    e.preventDefault();
    if (busy) return;
    if (await confirmDiscard('Çıkmadan')) {
      closing = true;
      win.close();
    }
  });
  win.on('closed', () => { win = null; editorView = null; });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    const f = fileArg(argv);
    if (f) guard(() => openPath(f))();
  });
  app.on('open-file', (e, p) => { // macOS
    e.preventDefault();
    if (win) guard(() => openPath(p))();
    else pendingOpen = p;
  });

  app.whenReady().then(() => {
    app.setName(APP_NAME);
    pendingOpen = pendingOpen || fileArg(process.argv);
    registerIpc();
    buildMenu();
    createSplash();
    createWindow();
    startFuxa();
    setInterval(poll, POLL_MS);
  });

  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => fuxa && fuxa.stop());
}
