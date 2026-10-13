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
const sync = require('../core/sync');
const envs = require('../core/envs');
const folder = require('../core/folder');
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
  diskHash: null,    // .fxprj içeriğinin son okunduğu/yazıldığı andaki özeti
  ignoredHash: null, // birleştirilmesi ertelenen disk içeriği (aynısı için tekrar sorulmaz)
  diskBase: null,    // dosyadaki proje (son okunan/yazılan, ham): diskte ne değişti
  env: null,         // etkin bağlantı ortamı (ayrık düzende; null = ayarlar .fxprj'in içinde)
  missing: [],       // etkin ortamda ayarı olmayan bağlantılar
  liveBase: null,    // aynı halin sunucudaki karşılığı: editörde ne değişti
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

// Kişiye özel proje tercihleri (git'e girmez): etkin ortam, son publish ortamı.
function projectPrefs(p) {
  const all = readJson(userFile('projects.json'), {});
  return (p && all[path.resolve(p).toLowerCase()]) || {};
}

function setProjectPrefs(p, patch) {
  const all = readJson(userFile('projects.json'), {});
  const key = path.resolve(p).toLowerCase();
  all[key] = { ...(all[key] || {}), ...patch };
  fs.writeFileSync(userFile('projects.json'), JSON.stringify(all, null, 2));
}

/**
 * Diskteki proje: .fxprj + (ayrık düzende) bağlantı ortamı dosyası birleştirilmiş halde.
 * {doc, imported, hash, env, missing}; hash iki dosyanın içeriğini birlikte özetler.
 */
function readDisk(p, envName = null) {
  const r = fxprj.read(p);
  if (r.imported || !envs.isSplit(r.doc)) return { ...r, env: null, missing: [] };
  const dir = envs.resolveDir(r.doc, p);
  const env = envName || projectPrefs(p).env || r.doc.connections.default || envs.list(dir)[0] || 'dev';
  const { conn, text } = envs.read(dir, env);
  const { project, missing } = envs.compose(r.doc.project, conn || {});
  r.doc.project = project;
  return { ...r, hash: envs.combinedHash(r.hash, text), env, missing };
}

/** Projeyi diske yaz (ayrık düzende bağlantı ayarları etkin ortam dosyasına). Yazılanın özetini döner. */
function writeDisk(target, doc, env) {
  if (!envs.isSplit(doc)) return fxprj.write(target, doc);
  const dir = envs.resolveDir(doc, target);
  // Farklı klasöre kaydedilirse diğer ortam dosyaları da yanına kopyalanır.
  const oldDir = cur.path && cur.doc && envs.isSplit(cur.doc) ? envs.resolveDir(cur.doc, cur.path) : null;
  if (oldDir && !samePath(oldDir, dir)) {
    for (const name of envs.list(oldDir)) {
      const to = envs.envFile(dir, name);
      if (name !== env && !fs.existsSync(to)) {
        fs.mkdirSync(dir, { recursive: true });
        fs.copyFileSync(envs.envFile(oldDir, name), to);
      }
    }
  }
  const { project, conn } = envs.extract(doc.project);
  const text = envs.write(dir, env, conn);
  return envs.combinedHash(fxprj.write(target, { ...doc, project }), text);
}

function envNote(env, missing) {
  return missing.length
    ? `"${env}" ortamında ayarı olmayan bağlantı: ${missing.join(', ')} (kapalı yüklendi).`
    : null;
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
      env: cur.env,
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
  const title = s.project
    ? `${s.project.dirty ? '● ' : ''}${s.project.name}${s.project.env ? ` [${s.project.env}]` : ''} — ${APP_NAME}`
    : APP_NAME;
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
async function loadDoc(doc, filePath, note, hash = null, env = null, missing = []) {
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
  cur.diskHash = filePath ? hash : null;
  cur.ignoredHash = null;
  cur.diskBase = doc.project;
  cur.liveBase = loaded;
  cur.env = env;
  cur.missing = missing;
  if (!cur.note && env) cur.note = envNote(env, missing);
  watchProjectFile(filePath);
  buildMenu();
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
  const { doc, imported, hash, env, missing } = readDisk(p);
  if (imported) {
    await loadDoc(doc, null, `Proje JSON'u içe aktarıldı (${path.basename(p)}). Kaydet ile .fxprj olarak kaydet.`);
  } else {
    await loadDoc(doc, p, null, hash, env, missing);
    addRecent(p);
  }
}

/**
 * Açık dosya açıldıktan/kaydedildikten sonra diskte değiştiyse üzerine yazmadan önce sor.
 * true = yazılabilir. offerSaveAs: "Farklı kaydet…" seçeneği (seçilirse kaydı o yapar, false döner).
 */
async function confirmOverwrite(target, { offerSaveAs = false } = {}) {
  if (!samePath(target, cur.path) || !externallyChanged()) return true;
  const buttons = offerSaveAs ? ['Üzerine yaz', 'Farklı kaydet…', 'İptal'] : ['Üzerine yaz', 'İptal'];
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    title: APP_NAME,
    message: `"${path.basename(target)}" açıldıktan sonra diskte değişti.`,
    detail: 'Üzerine yazarsan dışarıda yapılan değişiklikler (ör. git, Syncthing, başka bir düzenleyici) kaybolur.',
    buttons,
    defaultId: buttons.length - 1,
    cancelId: buttons.length - 1,
    noLink: true,
  });
  if (response === 0) return true;
  if (offerSaveAs && response === 1) await saveProject(true);
  return false;
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
    if (samePath(target, cur.path) && !(await confirmOverwrite(target))) return false;
    if (!cur.path || cur.doc.name === 'Adsız') cur.doc.name = path.basename(target, fxprj.EXT);
  } else if (!(await confirmOverwrite(target, { offerSaveAs: true }))) {
    return false;
  }
  await flushEditor();
  const prj = await api.getProject(url);
  cur.doc.project = prj;
  cur.diskHash = writeDisk(target, cur.doc, cur.env);
  cur.missing = [];
  cur.ignoredHash = null;
  cur.diskBase = prj;
  cur.liveBase = prj;
  const moved = !samePath(target, cur.path);
  cur.path = target;
  if (moved) {
    if (cur.env) setProjectPrefs(target, { env: cur.env });
    watchProjectFile(target);
  }
  cur.savedDigest = model.digest(prj);
  cur.liveDigest = cur.savedDigest;
  cur.metaDirty = false;
  cur.note = null;
  addRecent(target);
  return true;
}

// ---------------------------------------------------------------- dışarıdan değişiklik
// Açık .fxprj başka bir yerde (git, Syncthing, AI ajanı, metin düzenleyici) değişebilir.
// Dosya değişimi içerik özetiyle anlaşılır: kendi kaydımız diskHash'i güncellediği için tetiklemez.
// Değişiklik sormadan, öğe öğe uygulanır (sync.js): diskte değişen ekran/script/bağlantı
// sunucuya tek tek gönderilir, editörde kaydedilmemiş başka öğeler korunur. Sadece aynı öğe
// iki tarafta da değiştiyse sorulur.
let fileWatchers = [];
let watchTimer = null;
let diskPrompting = false;

function samePath(a, b) {
  if (!a || !b) return false;
  const [x, y] = [path.resolve(a), path.resolve(b)];
  return process.platform === 'linux' ? x === y : x.toLowerCase() === y.toLowerCase();
}

function envDir() {
  return cur.env && cur.path ? envs.resolveDir(cur.doc, cur.path) : null;
}

/** Diskteki .fxprj (+ etkin ortam dosyası) içeriğinin özeti; .fxprj yoksa null. */
function diskHashNow() {
  const h = fxprj.fileHash(cur.path);
  if (!h || !cur.env) return h;
  let text = '';
  try { text = fs.readFileSync(envs.envFile(envDir(), cur.env), 'utf8'); } catch { /* yok */ }
  return envs.combinedHash(h, text);
}

/** Dosya son okunuş/yazılıştan beri değişti mi? Silinmişse false (yeniden kaydetmek zararsız). */
function externallyChanged() {
  if (!cur.path || !cur.diskHash) return false;
  const h = diskHashNow();
  return h !== null && h !== cur.diskHash;
}

function watchProjectFile(filePath) {
  for (const w of fileWatchers) w.close();
  fileWatchers = [];
  clearTimeout(watchTimer);
  if (!filePath) return;
  const changed = () => {
    clearTimeout(watchTimer);
    watchTimer = setTimeout(checkDisk, 700); // art arda yazmalar tek seferde
  };
  // Dosya değil klasör izlenir: atomik kayıtlar (bizimki, git, Syncthing) dosyayı rename ile değiştirir.
  const watch = (dir, onName) => {
    try {
      const w = fs.watch(dir, (_ev, name) => onName(name ? String(name).toLowerCase() : null));
      w.on('error', () => {});
      fileWatchers.push(w);
    } catch { /* izlenemiyor (ör. klasör yok): Kaydet öncesi kontrol yine çalışır */ }
  };
  const base = path.basename(filePath).toLowerCase();
  watch(path.dirname(filePath), (name) => { if (!name || name === base) changed(); });
  // Klasör biçiminde ekran/bağlantı/script dosyaları (views/, devices/, scripts/)
  if (cur.doc && cur.doc.parts) {
    for (const kind of Object.keys(folder.KINDS)) watch(path.join(path.dirname(filePath), kind), () => changed());
  }
  const dir = cur.env && cur.doc && envs.isSplit(cur.doc) ? envs.resolveDir(cur.doc, filePath) : null;
  if (dir && !samePath(dir, path.dirname(filePath))) {
    watch(dir, (name) => {
      if (name && name.endsWith('.json')) buildMenu(); // ortam listesi
      if (!name || name === `${cur.env}.json`.toLowerCase()) changed();
    });
  }
}

async function checkDisk() {
  if (!cur.path || !cur.diskHash || diskPrompting || !win) return;
  if (busy || polling) { watchTimer = setTimeout(checkDisk, 500); return; }
  const h = diskHashNow();
  if (h === null || h === cur.diskHash || h === cur.ignoredHash) return;
  let read;
  try {
    read = readDisk(cur.path, cur.env);
  } catch (e) {
    // Yazan taraf işini bitirmemiş olabilir; bir sonraki değişiklikte tekrar denenir.
    cur.note = `Diskteki dosya okunamadı: ${e.message}`;
    pushState();
    return;
  }
  if (read.imported || read.hash !== h) return;
  diskPrompting = true;
  try {
    await guard(() => applyDiskChange(read))();
  } finally {
    diskPrompting = false;
  }
}

/** Sunucudaki projeyi from -> to yap: önce öğe komutları, tutmazsa tüm proje. true = sunucu değişti. */
async function pushProject(url, from, to) {
  const ops = sync.planOps(from, to);
  if (ops && !ops.length) return false;
  if (ops) {
    for (const o of ops) await api.projectData(url, o.cmd, o.data);
    const d = sync.diff(to, await api.getProject(url));
    if (!d.changed.length && !d.removed.length) return true;
    // ör. set-view aynı adlı ekranı sessizce atlar (AGENTS.md §5): tüm projeyle düzelt
  }
  await api.setProject(url, to);
  return true;
}

async function applyDiskChange({ doc, hash, missing }) {
  const url = requireFuxa();
  // Editörde sunucuya gitmemiş çizim düzenlemesi varsa önce aktar (sayaç anlık okunur).
  if (editorView && editorView.webContents.getURL().includes('/editor')) {
    const edits = Number(await editorView.webContents.executeJavaScript('window.__fxw ? window.__fxw.edits : 0').catch(() => 0)) || 0;
    if (edits > 0) await flushEditor();
  }
  const mine = await api.getProject(url);
  const bases = { liveBase: cur.liveBase, mine, diskBase: cur.diskBase, theirs: doc.project };
  let r = sync.merge(bases);
  let tookTheirs = false;
  if (r.conflicts.length) {
    const names = sync.describe(r.conflicts, doc.project, mine);
    const others = r.theirs.length - r.conflicts.length;
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      title: APP_NAME,
      message: `"${path.basename(cur.path)}" diskte değişti; aynı öğeler burada da değiştirilmiş.`,
      detail: `Çakışan: ${names.join(', ')}.\n`
        + (others > 0 ? `Diskteki diğer ${others} değişiklik her durumda alınır.\n` : '')
        + 'Çakışan öğelerde hangi hal kalsın?',
      buttons: ['Diskteki hali al', 'Bendekini koru', 'Şimdilik hiçbirini alma'],
      defaultId: 1,
      cancelId: 2,
      noLink: true,
    });
    if (response === 2) {
      cur.ignoredHash = hash;
      cur.note = 'Diskteki değişiklikler alınmadı; Kaydet dosyanın üzerine yazmadan önce soracak.';
      return;
    }
    if (response === 0) {
      r = sync.merge(bases, true);
      tookTheirs = true;
    }
  }
  const changed = await pushProject(url, mine, r.target);
  const after = changed ? await api.getProject(url) : mine;
  const kept = r.mine.filter((k) => !(tookTheirs && r.conflicts.includes(k)));
  cur.doc = doc;
  cur.diskHash = hash;
  cur.ignoredHash = null;
  cur.diskBase = doc.project;
  cur.missing = missing || [];
  cur.liveDigest = model.digest(after);
  if (kept.length || cur.metaDirty) {
    // Editördeki kaydedilmemiş öğeler korundu: proje kirli kalır.
    cur.liveBase = doc.project;
    cur.savedDigest = model.digest(doc.project);
  } else {
    cur.liveBase = after;
    cur.savedDigest = cur.liveDigest;
  }
  const time = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const got = sync.describe(r.theirs.filter((k) => tookTheirs || !r.conflicts.includes(k)), doc.project, mine);
  cur.note = got.length
    ? `Diskten alındı (${time}): ${got.join(', ')}${kept.length ? '. Kaydedilmemiş değişikliklerin korundu.' : ''}`
    : cur.note;
  // Editör kendi proje kopyasını tutar ve Kaydet'te tümünü geri yazar: sunucu değiştiyse yeniden yüklenmeli.
  // Açık ekran editörde adıyla hatırlandığından aynı ekran açılır.
  if (changed && editorView && fuxaState.url && editorView.webContents.getURL().startsWith(fuxaState.url)) {
    editorView.webContents.reload();
  }
}

async function reloadFromDisk({ confirm = true } = {}) {
  if (!cur.doc) return;
  if (!cur.path) {
    await message('info', 'Proje henüz bir .fxprj dosyasına kaydedilmedi.');
    return;
  }
  requireFuxa();
  if (confirm && isDirty()) {
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      title: APP_NAME,
      message: `"${cur.doc.name}" projesinde kaydedilmemiş değişiklikler var.`,
      detail: 'Diskten yeniden yüklersen bu değişiklikler kaybolur.',
      buttons: ['Diskten yeniden yükle', 'İptal'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (response !== 0) return;
  }
  const p = cur.path;
  const { doc, hash, env, missing } = readDisk(p, cur.env);
  await loadDoc(doc, p, envNote(env, missing) || 'Proje diskten yeniden yüklendi.', hash, env, missing);
}

// ---------------------------------------------------------------- klasör biçimi
/** Tek dosyadan klasör biçimine (fxprj 2): ekran/bağlantı/script ayrı dosyalara, proje kaydedilir. */
async function convertToFolder() {
  if (!cur.doc || cur.doc.parts) return;
  if (!cur.path) {
    await message('info', 'Önce projeyi bir .fxprj dosyasına kaydet.');
    return;
  }
  const root = path.dirname(cur.path);
  const others = fs.readdirSync(root).filter((f) => f.toLowerCase().endsWith(fxprj.EXT) && !samePath(path.join(root, f), cur.path));
  if (others.length) {
    throw new Error(`Bu klasörde başka proje dosyası var (${others.join(', ')}). `
      + 'Klasör biçimi için projeyi Farklı Kaydet ile kendi klasörüne taşı.');
  }
  const used = Object.keys(folder.KINDS).filter((k) => {
    try { return fs.readdirSync(path.join(root, k)).length > 0; } catch { return false; }
  });
  if (used.length) throw new Error(`${used.map((k) => `${k}/`).join(', ')} klasörü zaten var ve boş değil; üzerine yazılmadı.`);
  const { response } = await dialog.showMessageBox(win, {
    type: 'question',
    title: APP_NAME,
    message: 'Proje klasör biçimine dönüştürülsün mü?',
    detail: `Ekranlar views/, bağlantılar devices/, script'ler scripts/ klasörüne ayrı dosyalar olarak yazılır `
      + '(ekran çizimi .svg, script kodu .js). Git farkları öğe başına olur, AI ajanı tek bir ekranı düzenleyebilir.\n\n'
      + 'Klasör biçimindeki proje bu uygulamanın eski sürümleriyle açılmaz. Proje kaydedilir (kaydedilmemiş değişiklikler dahil).',
    buttons: ['Dönüştür ve kaydet', 'İptal'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (response !== 0) return;
  cur.doc = { ...cur.doc, parts: {} };
  if (await saveProject(false)) {
    watchProjectFile(cur.path);
    cur.note = 'Proje klasör biçimine dönüştürüldü (views/, devices/, scripts/).';
  } else {
    delete cur.doc.parts;
  }
  buildMenu();
}

// ---------------------------------------------------------------- bağlantı ortamları
// Ayrık düzende (bkz. core/envs.js) bağlantı ayarları connections/<ortam>.json'dadır.
// Ortam değiştirmek sadece cihazları değiştirir (set-device); ekranlar yeniden yüklenmez.

async function switchEnv(name) {
  if (!cur.doc || !cur.env || !cur.path || name === cur.env) return;
  if (!(await confirmDiscard(`"${name}" ortamına geçmeden`))) return;
  const discard = isDirty(); // "Kaydetme" seçildi
  setProjectPrefs(cur.path, { env: name });
  const disk = readDisk(cur.path, name);
  const note = envNote(name, disk.missing) || `Bağlantı ortamı: ${name}`;
  if (discard) {
    await loadDoc(disk.doc, cur.path, note, disk.hash, disk.env, disk.missing);
    return;
  }
  const url = requireFuxa();
  const mine = await api.getProject(url);
  const changed = await pushProject(url, mine, disk.doc.project);
  const after = changed ? await api.getProject(url) : mine;
  Object.assign(cur, {
    doc: disk.doc, env: disk.env, missing: disk.missing, diskHash: disk.hash, ignoredHash: null,
    diskBase: disk.doc.project, liveBase: after, note,
  });
  cur.savedDigest = cur.liveDigest = model.digest(after);
  watchProjectFile(cur.path);
  buildMenu();
  if (changed && editorView && fuxaState.url && editorView.webContents.getURL().startsWith(fuxaState.url)) {
    editorView.webContents.reload();
  }
}

/** Eski düzenden geçiş: bağlantı ayarları connections/dev.json'a taşınır, proje kaydedilir. */
async function separateConnections() {
  if (!cur.doc || envs.isSplit(cur.doc)) return;
  if (!cur.path) {
    await message('info', 'Önce projeyi bir .fxprj dosyasına kaydet.');
    return;
  }
  const name = 'dev';
  const doc = { ...cur.doc, connections: { dir: envs.DEFAULT_DIR, default: name } };
  const file = envs.envFile(envs.resolveDir(doc, cur.path), name);
  if (fs.existsSync(file)) throw new Error(`${file} zaten var; üzerine yazılmadı.`);
  const { response } = await dialog.showMessageBox(win, {
    type: 'question',
    title: APP_NAME,
    message: 'Bağlantı ayarları ortam dosyasına taşınsın mı?',
    detail: `Bağlantıların adres, port, açık/kapalı ve okuma aralığı ayarları ${path.relative(path.dirname(cur.path), file)} `
      + 'dosyasına taşınır ve .fxprj\'den çıkarılır; ekranlar ve tag\'ler .fxprj\'de kalır. '
      + 'Sonra Ayarlar → Bağlantı ortamı → Yeni ortam ile örneğin saha ortamını ekleyebilirsin.\n\n'
      + 'Proje kaydedilir (kaydedilmemiş değişiklikler dahil).',
    buttons: ['Taşı ve kaydet', 'İptal'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (response !== 0) return;
  cur.doc = doc;
  cur.env = name;
  setProjectPrefs(cur.path, { env: name });
  if (await saveProject(false)) {
    watchProjectFile(cur.path);
    cur.note = `Bağlantı ayarları ${name}.json dosyasına taşındı.`;
  }
  buildMenu();
}

/** Etkin ortamın kaydedilmiş ayarlarından yeni ortam dosyası, sonra ona geç. */
async function newEnv() {
  if (!cur.doc || !cur.env || !cur.path) return;
  const dir = envDir();
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: `Yeni bağlantı ortamı ("${cur.env}" ayarlarının kopyası)`,
    defaultPath: path.join(dir, 'saha.json'),
    buttonLabel: 'Oluştur',
    filters: [{ name: 'Bağlantı ortamı', extensions: ['json'] }],
  });
  if (canceled || !filePath) return;
  const name = path.basename(filePath).replace(/\.json$/i, '');
  if (!samePath(path.dirname(filePath), dir)) throw new Error(`Ortam dosyası ${dir} klasöründe olmalı.`);
  const file = envs.envFile(dir, name); // adı doğrular
  if (fs.existsSync(file)) throw new Error(`"${name}" ortamı zaten var.`);
  const { conn } = envs.read(dir, cur.env);
  envs.write(dir, name, conn || envs.extract(cur.doc.project).conn);
  await switchEnv(name);
}

function envMenu() {
  if (!cur.doc || !cur.path) return [{ label: '(proje kaydedilmedi)', enabled: false }];
  if (!cur.env) {
    return [{ label: 'Bağlantı ayarlarını ortam dosyasına taşı…', click: () => guard(separateConnections)() }];
  }
  const dir = envDir();
  const names = [...new Set([...envs.list(dir), cur.env])].sort((a, b) => a.localeCompare(b));
  return [
    ...names.map((n) => ({ label: n, type: 'radio', checked: n === cur.env, click: () => guard(() => switchEnv(n))() })),
    { type: 'separator' },
    { label: 'Yeni ortam…', click: () => guard(newEnv)() },
    { label: 'Ortam klasörünü aç', click: () => shell.openPath(dir) },
  ];
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
/** Publish planı: ayrık düzende seçilen ortamın kaydedilmiş ayarlarıyla. */
function publishPlan(env) {
  if (!cur.env) return publisher.plan(cur.doc, cur.path);
  const name = env || projectPrefs(cur.path).publishEnv || cur.env;
  const disk = readDisk(cur.path, name);
  return {
    ...publisher.plan(disk.doc, cur.path, { env: name, missing: disk.missing }),
    envs: [...new Set([...envs.list(envDir()), cur.env])].sort((a, b) => a.localeCompare(b)),
  };
}

async function publishPrepare(env) {
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
  return publishPlan(env);
}

async function publishChooseDir(env) {
  if (!cur.doc || !cur.path) return null;
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Publish klasörü',
    defaultPath: publisher.resolveDir(cur.doc, cur.path),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (canceled || !filePaths.length) return null;
  const rel = path.relative(path.dirname(cur.path), filePaths[0]);
  const dir = rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(path.sep).join('/') : filePaths[0];
  if (externallyChanged()) {
    throw new Error('Proje dosyası diskte değişti. Önce Dosya → Diskten yeniden yükle ya da Kaydet ile durumu netleştir.');
  }
  cur.doc.publish = { ...(cur.doc.publish || {}), dir };
  // Klasör seçimi .fxprj'e yazılır; publish kaydedilmiş hali yazdığından burada hemen kaydet.
  cur.diskHash = writeDisk(cur.path, cur.doc, cur.env);
  return publishPlan(env);
}

async function publishRun(env) {
  if (!cur.doc || !cur.path) return null;
  if (isDirty()) throw new Error('Kaydedilmemiş değişiklik var; önce kaydet.');
  if (!cur.env) return publisher.publish(fxprj.read(cur.path).doc, cur.path);
  const name = env || cur.env;
  const disk = readDisk(cur.path, name);
  setProjectPrefs(cur.path, { publishEnv: name });
  return { ...publisher.publish(disk.doc, cur.path, new Date(), { env: name, missing: disk.missing }), envs: publishPlan(name).envs };
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
  win.webContents.send('show-tab', page === 'tags' ? 'tags' : page === 'device' ? 'connections' : page === 'scripts' ? 'scripts' : 'editor');
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
        { label: 'Diskten yeniden yükle', click: run(() => reloadFromDisk()) },
        { label: 'Klasör biçimine dönüştür…', visible: !!(cur.doc && cur.path && !cur.doc.parts), click: run(convertToFolder) },
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
        { label: 'Scriptler', accelerator: 'CmdOrCtrl+6', click: run(() => showEditorPage('scripts')) },
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
        { type: 'separator' },
        { label: 'Bağlantı ortamı', submenu: envMenu() },
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
  handle('editor:page', guard((page) => ['editor', 'device', 'tags', 'scripts'].includes(page) && showEditorPage(page)));
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
