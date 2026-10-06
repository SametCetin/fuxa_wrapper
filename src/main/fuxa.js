'use strict';
// Uygulamanın içinde gelen FUXA sunucusu: bul, başlat (boş portta, sadece 127.0.0.1), bekle, durdur.
//
// Paketlenmiş uygulamada:  resources/node/node(.exe) + resources/fuxa/node_modules/@frangoteam/fuxa
// Geliştirmede:            vendor/node (varsa) veya PATH'teki node + fuxa-runtime/node_modules/...
// FUXA verisi:             <userData>/fuxa/_appdata (sadece bu uygulamanın; kullanıcı projesi .fxprj'dedir)

const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { installEditorTagClear } = require('./editorTagClear');

const ROOT = path.resolve(__dirname, '..', '..');
const IS_WIN = process.platform === 'win32';
const NODE_EXE = IS_WIN ? 'node.exe' : path.join('bin', 'node');

class FuxaError extends Error {}

function resourcesDir(packaged) {
  return packaged ? process.resourcesPath : null;
}

function findFuxaMain(packaged) {
  const base = packaged
    ? path.join(resourcesDir(true), 'fuxa', 'node_modules')
    : path.join(ROOT, 'fuxa-runtime', 'node_modules');
  const main = path.join(base, '@frangoteam', 'fuxa', 'main.js');
  if (!fs.existsSync(main)) {
    throw new FuxaError(packaged
      ? `Editör bileşeni uygulama paketinde yok: ${main}`
      : `Editör bileşeni kurulu değil (${main}). Repo kökünde: npm run setup:fuxa`);
  }
  return main;
}

function onPath(exe) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const p = path.join(dir, exe);
    if (dir && fs.existsSync(p)) return p;
  }
  return null;
}

function findNode(packaged) {
  if (packaged) {
    const p = path.join(resourcesDir(true), 'node', NODE_EXE);
    if (fs.existsSync(p)) return p;
    throw new FuxaError(`Node.js uygulama paketinde yok: ${p}`);
  }
  const vendored = path.join(ROOT, 'vendor', 'node', NODE_EXE);
  if (fs.existsSync(vendored)) return vendored;
  const found = onPath(IS_WIN ? 'node.exe' : 'node');
  if (found) return found;
  if (IS_WIN) {
    const pf = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe');
    if (fs.existsSync(pf)) return pf;
  }
  throw new FuxaError('Node.js bulunamadı. Geliştirme için Node.js kur veya: npm run fetch:node');
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** FUXA'nın ayar dosyası: varsayılanlar + sadece 127.0.0.1'de dinle, ilk açılış rehberini gösterme. */
function writeSettings(userDir, fuxaMain) {
  const appdata = path.join(userDir, '_appdata');
  fs.mkdirSync(appdata, { recursive: true });
  const defaults = path.join(path.dirname(fuxaMain), 'settings.default.js');
  const text = [
    '// fuxaw tarafından her açılışta yazılır; elle değiştirme.',
    `module.exports = Object.assign({}, require(${JSON.stringify(defaults)}), {`,
    "  uiHost: '127.0.0.1',",
    '  hideEditorOnboarding: true,',
    "  logs: { retention: 'none' },",
    '});',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(appdata, 'settings.js'), text, 'utf8');
}

/**
 * FUXA'yı çalıştıran küçük başlatıcı: uygulama çökse bile FUXA açık kalmasın diye ana süreci izler,
 * o kapanınca kendini kapatır. (asar içindeki dosyayı node okuyamadığı için veri klasörüne yazılır.)
 */
function writeBoot(userDir, pluginPath) {
  const text = [
    '// fuxaw tarafından her açılışta yazılır; elle değiştirme.',
    "'use strict';",
    'const parent = Number(process.env.FUXAW_PARENT_PID);',
    'if (parent) {',
    '  setInterval(() => { try { process.kill(parent, 0); } catch { process.exit(0); } }, 2000).unref();',
    '}',
    'const main = process.argv[2];',
    `const restoreStatic = (${installEditorTagClear.toString()})(require('node:path').dirname(main));`,
    `require(${JSON.stringify(pluginPath)}).install(require('node:path').dirname(main));`,
    'process.argv.splice(1, 1); // FUXA argümanları argv[2]\'den okur: [node, main.js, --port, ...]',
    'require(main);',
    'restoreStatic();',
    '',
  ].join('\n');
  const file = path.join(userDir, 'fuxaw-boot.js');
  fs.writeFileSync(file, text, 'utf8');
  return file;
}

class FuxaServer {
  constructor({ packaged, userDir, logFile }) {
    this.packaged = packaged;
    this.userDir = userDir;
    this.logFile = logFile;
    this.proc = null;
    this.port = null;
    this.exited = null;
  }

  get url() {
    return this.port ? `http://127.0.0.1:${this.port}` : null;
  }

  async start({ timeoutMs = 90000 } = {}) {
    const node = findNode(this.packaged);
    const main = findFuxaMain(this.packaged);
    fs.mkdirSync(this.userDir, { recursive: true });
    fs.mkdirSync(path.dirname(this.logFile), { recursive: true });
    writeSettings(this.userDir, main);
    const pluginPath = this.packaged
      ? path.join(resourcesDir(true), 'plugins', 'native-ads')
      : path.join(ROOT, 'integrations', 'native-ads');
    const boot = writeBoot(this.userDir, pluginPath);
    this.port = await freePort();
    const log = fs.openSync(this.logFile, 'w');
    this.exited = null;
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    env.FUXAW_PARENT_PID = String(process.pid);
    this.proc = spawn(node, [boot, main, '--port', String(this.port), '--userDir', this.userDir], {
      cwd: this.userDir,
      stdio: ['ignore', log, log],
      windowsHide: true,
      env,
    });
    fs.closeSync(log);
    this.proc.on('exit', (code) => { this.exited = code ?? -1; this.proc = null; });
    this.proc.on('error', (e) => { this.exited = -1; this.startError = e; });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.exited !== null) {
        throw new FuxaError(`Editör bileşeni başlarken kapandı (kod ${this.exited}). Günlük: ${this.logFile}`);
      }
      try {
        const r = await fetch(`${this.url}/api/settings`, { signal: AbortSignal.timeout(2000) });
        if (r.ok) return this.url;
      } catch { /* henüz hazır değil */ }
      await new Promise((res) => setTimeout(res, 300));
    }
    this.stop();
    throw new FuxaError(`Editör bileşeni ${timeoutMs / 1000} sn içinde hazır olmadı. Günlük: ${this.logFile}`);
  }

  stop() {
    const p = this.proc;
    if (!p) return;
    this.proc = null;
    try {
      if (IS_WIN) execFileSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      else p.kill('SIGTERM');
    } catch { /* zaten kapanmış */ }
  }
}

module.exports = { FuxaServer, FuxaError, findNode, findFuxaMain };
