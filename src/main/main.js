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
const folder = require('../core/folder');
const model = require('../core/model');
const lintmod = require('../core/lint');
const { tagTable, tagTypesFor, isInternal, buildTag, prepareTagRemoval } = require('../core/tags');
const { isAdsDevice, planSymbolImport } = require('../core/adsSymbols');
const { browseDeviceSymbols } = require('./adsBrowse');
const publisher = require('../core/publish');
const { buildAdsDevice } = require('../core/connections');
const sync = require('../core/sync');
const { installDimensionCommit } = require('./editorDimensions');
const { readDeviceSelection, openDevicePage } = require('./editorDevices');
const i18n = require('../core/i18n');

const { t } = i18n;

const APP_NAME = 'fuxaw';
// Dört parçalı sürüm (ör. 27.1.10.26); app.getVersion() sadece semver kısmını (27.1.10) verir. Bkz. scripts/set-version.js.
const APP_VERSION = require('../../package.json').fullVersion || app.getVersion();
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
  note: null,        // kullanıcıya gösterilecek kısa bilgi: metni o anki dilde üreten fonksiyon (dil değişince yenilenir)
  importedFrom: null, // içe aktarılan dosya (ilk kayıtta önerilecek yer için)
  diskHash: null,    // .fxprj içeriğinin son okunduğu/yazıldığı andaki özeti
  ignoredHash: null, // birleştirilmesi ertelenen disk içeriği (aynısı için tekrar sorulmaz)
  diskBase: null,    // dosyadaki proje (son okunan/yazılan, ham): diskte ne değişti
  liveBase: null,    // aynı halin sunucudaki karşılığı: editörde ne değişti
};

// ---------------------------------------------------------------- yardımcılar
function userFile(name) {
  return path.join(app.getPath('userData'), name);
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

// Uygulama ayarları (şimdilik sadece dil). Dil yoksa sistem dilinden: Türkçe değilse İngilizce.
function appSettings() {
  return readJson(userFile('settings.json'), {});
}

function initialLanguage() {
  const saved = appSettings().language;
  return i18n.LANGUAGES.includes(saved) ? saved : i18n.resolve(app.getLocale());
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
      note: cur.note && cur.note(),
      publishDir: publisher.resolveDir(cur.doc, cur.path),
    },
    recent: recentList(),
    busy,
    lang: i18n.getLanguage(),
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
  return dialog.showMessageBox(win, { type, title: APP_NAME, message: text, detail, buttons: [t('common.ok')] });
}

function guard(fn) {
  return async (...args) => {
    if (busy) return undefined;
    busy = true;
    pushState();
    try {
      return await fn(...args);
    } catch (e) {
      await message('error', t('op.failed'), e.message);
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
      ? t('engine.notRunning', { error: fuxaState.error })
      : t('engine.notReady'));
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
    language: i18n.getLanguage(),
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
  if (openError) await message('error', t('open.failed'), openError.message);
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
  splash.loadFile(path.join(__dirname, '..', 'renderer', 'splash.html'), { hash: i18n.getLanguage() });
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
// Düğmenin title'ı editör diline göre çevrilir (tr: "Kaydet"); simgesinin aria-label'ı her dilde sabittir.
const SAVE_TRIGGER = 'button:has(> mat-icon[aria-label="Save Project"])';
const EDITOR_CSS = `
${SAVE_TRIGGER} { display: none !important; }
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
    const trigger = document.querySelector(${JSON.stringify(SAVE_TRIGGER)});
    if (!trigger) return 'no-trigger';
    document.body.classList.add('fxw-flush');
    try {
      trigger.click();
      for (let i = 0; i < 20; i++) {
        const items = [...document.querySelectorAll('.mat-mdc-menu-panel .mat-mdc-menu-item')];
        if (items.length) {
          const save = items[1]; // New, Save, Save As, Open, Rename (metin editör diline göre değişir)
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
async function loadDoc(doc, filePath, note, hash = null) {
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
  cur.importedFrom = null;
  cur.diskHash = filePath ? hash : null;
  cur.ignoredHash = null;
  cur.diskBase = doc.project;
  cur.liveBase = loaded;
  watchProjectFile(filePath);
  editorWanted = true;
  win.webContents.send('show-tab', 'editor');
  await loadEditor();
}

/** Kaydedilmemiş değişiklik varsa sor. true = devam edilebilir. */
async function confirmDiscard(questionKey) {
  if (!isDirty()) return true;
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    title: APP_NAME,
    message: t('discard.message', { name: cur.doc.name }),
    detail: t(questionKey),
    buttons: [t('common.save'), t('common.dontSave'), t('common.cancel')],
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
  if (!(await confirmDiscard('discard.beforeNew'))) return;
  await loadDoc(fxprj.newDoc(t('project.untitled')), null, () => t('note.newProject'));
}

async function openDialog() {
  requireFuxa();
  if (!(await confirmDiscard('discard.beforeOpen'))) return;
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: t('open.title'),
    properties: ['openFile'],
    filters: [
      { name: t('filter.fxprj'), extensions: ['fxprj'] },
      { name: t('filter.json'), extensions: ['json'] },
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
  if (!skipConfirm && !(await confirmDiscard('discard.beforeOpen'))) return;
  const { doc, imported, hash } = fxprj.read(p);
  if (imported) {
    await loadDoc(doc, null, () => t('note.imported', { file: path.basename(p) }));
    cur.importedFrom = p;
  } else {
    await loadDoc(doc, p, null, hash);
    addRecent(p);
  }
}

/**
 * Açık dosya açıldıktan/kaydedildikten sonra diskte değiştiyse üzerine yazmadan önce sor.
 * true = yazılabilir. offerSaveAs: "Farklı kaydet…" seçeneği (seçilirse kaydı o yapar, false döner).
 */
async function confirmOverwrite(target, { offerSaveAs = false } = {}) {
  if (!samePath(target, cur.path) || !externallyChanged()) return true;
  const buttons = offerSaveAs
    ? [t('overwrite.overwrite'), t('overwrite.saveAs'), t('common.cancel')]
    : [t('overwrite.overwrite'), t('common.cancel')];
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    title: APP_NAME,
    message: t('overwrite.message', { file: path.basename(target) }),
    detail: t('overwrite.detail'),
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
    const name = fxprj.safeName(cur.doc.name);
    const base = cur.importedFrom ? path.dirname(cur.importedFrom) : app.getPath('documents');
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: saveAs ? t('save.titleAs') : t('save.title'),
      defaultPath: target || path.join(base, name, name + fxprj.EXT),
      filters: [{ name: t('filter.fxprj'), extensions: ['fxprj'] }],
    });
    if (canceled || !filePath) return false;
    target = filePath.toLowerCase().endsWith(fxprj.EXT) ? filePath : filePath + fxprj.EXT;
    if (samePath(target, cur.path) && !(await confirmOverwrite(target))) return false;
    if (!cur.path || i18n.all('project.untitled').includes(cur.doc.name)) cur.doc.name = path.basename(target, fxprj.EXT);
    // Proje bir klasördür: seçilen klasörde başka proje varsa kendi alt klasörüne yazılır.
    if (!samePath(target, cur.path) && fxprj.folderConflict(target)) {
      const sub = path.join(path.dirname(target), path.basename(target, fxprj.EXT), path.basename(target));
      const why = fxprj.folderConflict(sub);
      if (why) throw new Error(t('save.noFolder', { dir: path.dirname(target), why: fxprj.folderConflict(target), sub: path.dirname(sub), why2: why }));
      target = sub;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
  } else if (!(await confirmOverwrite(target, { offerSaveAs: true }))) {
    return false;
  }
  await flushEditor();
  const prj = await api.getProject(url);
  cur.doc.project = prj;
  cur.diskHash = fxprj.write(target, cur.doc);
  cur.ignoredHash = null;
  cur.diskBase = prj;
  cur.liveBase = prj;
  const moved = !samePath(target, cur.path);
  cur.path = target;
  cur.importedFrom = null;
  if (moved) watchProjectFile(target);
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

/** Dosya son okunuş/yazılıştan beri değişti mi? Silinmişse false (yeniden kaydetmek zararsız). */
function externallyChanged() {
  if (!cur.path || !cur.diskHash) return false;
  const h = fxprj.fileHash(cur.path);
  return h !== null && h !== cur.diskHash;
}

function watchProjectFile(filePath) {
  for (const w of fileWatchers) w.close();
  fileWatchers = [];
  clearTimeout(watchTimer);
  if (!filePath) return;
  const changed = () => {
    clearTimeout(watchTimer);
    watchTimer = setTimeout(checkDisk, 700); // art arda yazmalar (ör. ajanın birkaç dosyası) tek seferde
  };
  const watch = (dir, filter) => {
    try {
      const w = fs.watch(dir, (_ev, name) => { if (!name || filter(String(name).toLowerCase())) changed(); });
      w.on('error', () => {});
      fileWatchers.push(w);
    } catch { /* klasör yok / izlenemiyor: Kaydet öncesi kontrol yine çalışır */ }
  };
  // Dosya değil klasör izlenir: atomik kayıtlar (bizimki, git, Syncthing) dosyayı rename ile değiştirir.
  const root = path.dirname(filePath);
  const base = path.basename(filePath).toLowerCase();
  const kinds = Object.keys(folder.KINDS);
  watch(root, (name) => name === base || kinds.includes(name)); // .fxprj; parça klasörü oluşturulursa/silinirse
  for (const kind of kinds) watch(path.join(root, kind), () => true);
}

async function checkDisk() {
  if (!cur.path || !cur.diskHash || diskPrompting || !win) return;
  if (busy || polling) { watchTimer = setTimeout(checkDisk, 500); return; }
  const h = fxprj.fileHash(cur.path);
  if (h === null || h === cur.diskHash || h === cur.ignoredHash) return;
  let read;
  try {
    read = fxprj.read(cur.path);
  } catch (e) {
    // Yazan taraf işini bitirmemiş olabilir; bir sonraki değişiklikte tekrar denenir.
    cur.note = () => t('note.diskUnreadable', { error: e.message });
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

async function applyDiskChange({ doc, hash }) {
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
      message: t('conflict.message', { file: path.basename(cur.path) }),
      detail: `${t('conflict.items', { names: names.join(', ') })}\n`
        + (others > 0 ? `${t('conflict.others', { count: others })}\n` : '')
        + t('conflict.question'),
      buttons: [t('conflict.theirs'), t('conflict.mine'), t('conflict.none')],
      defaultId: 1,
      cancelId: 2,
      noLink: true,
    });
    if (response === 2) {
      cur.ignoredHash = hash;
      cur.note = () => t('note.diskSkipped');
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
  cur.liveDigest = model.digest(after);
  if (kept.length || cur.metaDirty) {
    // Editördeki kaydedilmemiş öğeler korundu: proje kirli kalır.
    cur.liveBase = doc.project;
    cur.savedDigest = model.digest(doc.project);
  } else {
    cur.liveBase = after;
    cur.savedDigest = cur.liveDigest;
  }
  const time = new Date().toLocaleTimeString(i18n.locale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const got = r.theirs.filter((k) => tookTheirs || !r.conflicts.includes(k));
  cur.note = got.length
    ? () => t('note.diskApplied', { time, items: sync.describe(got, doc.project, mine).join(', ') }) + (kept.length ? t('note.keptMine') : '')
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
    await message('info', t('reload.notSaved'));
    return;
  }
  requireFuxa();
  if (confirm && isDirty()) {
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      title: APP_NAME,
      message: t('discard.message', { name: cur.doc.name }),
      detail: t('reload.detail'),
      buttons: [t('menu.reload'), t('common.cancel')],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (response !== 0) return;
  }
  const p = cur.path;
  const { doc, hash } = fxprj.read(p);
  await loadDoc(doc, p, () => t('note.reloaded'), hash);
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
  if (!device) return { errors: [t('tag.deviceMissing')] };
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
    ? `${t('tagDelete.uses', { uses: plan.uses.map(u => `${u.where} — ${u.how}`).join('\n') })}\n\n`
    : '';
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning', title: APP_NAME, message: t('tagDelete.message', { name: plan.tag.name }),
    detail: `${plan.device.name}\n\n${usage}${t('tagDelete.saveNeeded')}`,
    buttons: [t('common.cancel'), t('common.delete')], defaultId: 0, cancelId: 0, noLink: true,
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

// ---------------------------------------------------------------- ADS sembolleri
function adsPluginDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'plugins', 'native-ads')
    : path.join(__dirname, '..', '..', 'integrations', 'native-ads');
}

/** Projedeki ADS cihazları ve tag adresleri. PLC'ye bağlanmaz. */
async function adsDevices() {
  if (!cur.doc) return null;
  await flushEditor();
  const project = await api.getProject(requireFuxa());
  const devices = Object.values(project.devices || {}).filter(isAdsDevice).map((d) => ({
    id: d.id, name: d.name, type: d.type, address: String(d.property && d.property.address || ''),
    transport: String(d.property && d.property.adsTransport || ''),
    addresses: Object.values(d.tags || {}).map((tag) => String(tag.address || '').trim()).filter(Boolean),
  }));
  return { devices };
}

/** Yalnız kullanıcı istediğinde PLC'den sembol listesini okur; sonuç önbelleğe alınmaz. */
async function adsBrowse(spec) {
  if (!cur.doc || !spec || typeof spec.deviceId !== 'string') return null;
  await flushEditor();
  const project = await api.getProject(requireFuxa());
  const device = (project.devices || {})[spec.deviceId];
  if (!device || !isAdsDevice(device)) return { ok: false, reason: 'config', message: t('ads.reason.device-type') };
  try {
    const result = await browseDeviceSymbols(device, { pluginDir: adsPluginDir() });
    return { ok: true, ...result };
  } catch (error) {
    return { ok: false, reason: error.reason || 'connect', message: error.message || String(error) };
  }
}

/** Seçilen sembolleri cihaza tag olarak ekler; mevcut tag'ler korunur. */
async function adsImport(spec) {
  if (!cur.doc || !spec || typeof spec.deviceId !== 'string' || !Array.isArray(spec.symbols)) return null;
  const url = requireFuxa();
  await flushEditor();
  const project = await api.getProject(url);
  const device = (project.devices || {})[spec.deviceId];
  if (!device || !isAdsDevice(device)) return { ok: false, error: t('ads.reason.device-type') };
  const plan = planSymbolImport(device, spec.symbols);
  if (plan.errors) return { ok: false, error: plan.errors.map((reason) => t(`ads.reason.${reason}`)).join(', ') };
  if (plan.added.length) {
    await api.projectData(url, 'set-device', plan.device);
    await loadEditor(); // editörün eski cihaz kopyası yeni tag'lerin üzerine yazmasın
  }
  return {
    ok: true, added: plan.added, skipped: plan.skipped,
    addresses: Object.values(plan.device.tags || {}).map((tag) => String(tag.address || '').trim()).filter(Boolean),
  };
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
      message: t('publish.savedOnly'),
      detail: t('publish.unsavedQuestion'),
      buttons: [t('publish.saveContinue'), t('common.cancel')],
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
    title: t('publish.dirTitle'),
    defaultPath: publisher.resolveDir(cur.doc, cur.path),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (canceled || !filePaths.length) return null;
  const rel = path.relative(path.dirname(cur.path), filePaths[0]);
  const dir = rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(path.sep).join('/') : filePaths[0];
  if (externallyChanged()) {
    throw new Error(t('publish.diskChanged'));
  }
  cur.doc.publish = { ...(cur.doc.publish || {}), dir };
  // Klasör seçimi .fxprj'e yazılır; publish kaydedilmiş hali yazdığından burada hemen kaydet.
  cur.diskHash = fxprj.write(cur.path, cur.doc);
  return publisher.plan(cur.doc, cur.path);
}

async function publishRun() {
  if (!cur.doc || !cur.path) return null;
  if (isDirty()) throw new Error(t('publish.unsaved'));
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
    await wc.executeJavaScript(`(${openDevicePage.toString()})(${page === 'tags'}, ${JSON.stringify(lastTagDevice)}, ${JSON.stringify(t('editor.devicePageFailed'))})`);
  }
}

/** Ayarlar → Dil: uygulamanın ve gömülü editörün dili birlikte değişir. */
async function changeLanguage(lang) {
  if (lang === i18n.getLanguage()) return;
  i18n.setLanguage(lang);
  fs.writeFileSync(userFile('settings.json'), JSON.stringify({ ...appSettings(), language: lang }, null, 2));
  buildMenu();
  pushState();
  if (fuxa) fuxa.language = lang; // bileşenler yeniden başlatılırsa settings.js'e yazılır
  if (fuxaState.status !== 'ready') return;
  await flushEditor(); // editör yeniden yüklenecek: bekleyen çizimler kaybolmasın
  try {
    await api.setLanguage(fuxaState.url, lang);
  } catch (e) {
    await message('warning', t('engine.languageFailed'), e.message);
    return;
  }
  // Editör dili açılışta /api/settings'ten okur: yeniden yüklenmeli.
  if (editorView && editorView.webContents.getURL().startsWith(fuxaState.url)) editorView.webContents.reload();
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
  const lang = i18n.getLanguage();
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    {
      label: t('menu.file'),
      submenu: [
        { label: t('menu.new'), accelerator: 'CmdOrCtrl+N', click: run(newProject) },
        { label: t('menu.open'), accelerator: 'CmdOrCtrl+O', click: run(openDialog) },
        {
          label: t('menu.recent'),
          submenu: recent.length
            ? recent.map((p) => ({ label: p, click: run(() => openPath(p)) }))
            : [{ label: t('menu.empty'), enabled: false }],
        },
        { type: 'separator' },
        { label: t('menu.save'), accelerator: 'CmdOrCtrl+S', click: run(() => saveProject(false)) },
        { label: t('menu.saveAs'), accelerator: 'CmdOrCtrl+Shift+S', click: run(() => saveProject(true)) },
        { label: t('menu.reload'), click: run(() => reloadFromDisk()) },
        { type: 'separator' },
        { label: t('menu.publish'), accelerator: 'CmdOrCtrl+Shift+P', click: send('publish') },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close', label: t('menu.close') } : { role: 'quit', label: t('menu.quit') },
      ],
    },
    {
      label: t('menu.project'),
      submenu: [
        { label: t('menu.editor'), accelerator: 'CmdOrCtrl+1', click: run(() => showEditorPage('editor')) },
        { label: t('menu.tags'), accelerator: 'CmdOrCtrl+2', click: run(() => showEditorPage('tags')) },
        { label: t('menu.lint'), accelerator: 'CmdOrCtrl+3', click: send('tab:lint') },
        { label: t('menu.scripts'), accelerator: 'CmdOrCtrl+6', click: run(() => showEditorPage('scripts')) },
        { label: t('menu.adsSymbols'), accelerator: 'CmdOrCtrl+7', click: send('ads-symbols') },
        { type: 'separator' },
        { label: t('menu.runtime'), accelerator: 'F5', click: openRuntime },
        { label: t('menu.reloadEditor'), click: () => cur.doc && loadEditor() },
      ],
    },
    {
      label: t('menu.settings'),
      submenu: [
        { label: t('menu.connections'), accelerator: 'CmdOrCtrl+4', click: run(() => showEditorPage('device')) },
        { label: t('menu.plugins'), accelerator: 'CmdOrCtrl+5', click: run(() => showEditorPage('plugins')) },
        { type: 'separator' },
        {
          label: t('menu.language'),
          submenu: i18n.LANGUAGES.map((l) => ({
            label: i18n.NATIVE_NAMES[l], type: 'radio', checked: l === lang, click: run(() => changeLanguage(l)),
          })),
        },
      ],
    },
    {
      label: t('menu.view'),
      submenu: [
        { role: 'zoomIn', label: t('menu.zoomIn') },
        { role: 'zoomOut', label: t('menu.zoomOut') },
        { role: 'resetZoom', label: t('menu.resetZoom') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: t('menu.fullscreen') },
        { label: t('menu.devEditor'), accelerator: 'F12', click: () => editorView && editorView.webContents.toggleDevTools() },
        { label: t('menu.devApp'), accelerator: 'CmdOrCtrl+Shift+I', click: () => win && win.webContents.toggleDevTools() },
      ],
    },
    {
      label: t('menu.help'),
      submenu: [
        { label: t('menu.log'), click: () => shell.openPath(logFile()) },
        { label: t('menu.dataDir'), click: () => shell.openPath(app.getPath('userData')) },
        { type: 'separator' },
        {
          label: t('menu.about', { app: APP_NAME }),
          click: () => message('info', `${APP_NAME} ${APP_VERSION}`, t('about.detail')),
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
  handle('ads:devices', guard(adsDevices));
  handle('ads:browse', guard(adsBrowse));
  handle('ads:import', guard(adsImport));
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
    if (await confirmDiscard('discard.beforeQuit')) {
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
    i18n.setLanguage(initialLanguage());
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
