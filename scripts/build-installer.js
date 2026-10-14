'use strict';
// Hedef makine kurulumu: tek dosyalık betikler, yanlarında başka dosya gerekmez.
//   dist/installer/<ad>/install-fuxa.cmd     Node.js + FUXA 1.3.4'ü internetten kurar, gömülü ADS (fuxaw) eklentisini uygular
//   dist/installer/<ad>/uninstall-fuxa.cmd   kaldırır, data\ (proje) kalır
//   dist/installer/<ad>/README.md            kullanım (bilgi için; betikler onsuz çalışır)
//   dist/installer/<ad>.zip                  aynı klasör, taşımak için
// Şablonlar: installer/install-fuxa.ps1, installer/uninstall-fuxa.ps1. Sürümler ve eklenti (zip, base64) şablona yazılır,
// sonra src/core/target/selfcontained.js ile .cmd'ye sarılır.
// Önce: npm run setup:ads (npm run dist:installer yapar). Yerel köprü için Windows x64'te üretilir.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { NODE_VERSION } = require('./fetch-node');
const { selfContainedCmd } = require('../src/core/target/selfcontained');

const ROOT = path.resolve(__dirname, '..');
const OUT_BASE = path.join(ROOT, 'dist', 'installer');
// Git Bash'teki tar C:\ yolunu uzak sunucu sanar; Windows'un kendi tar'ı (bsdtar) zip de yazar.
const TAR = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');

function need(file, hint) {
  if (!fs.existsSync(file)) throw new Error(`${path.relative(ROOT, file)} yok. ${hint}`);
  return file;
}

/** Şablondaki __AD__ yer tutucularını doldurur; hepsinin dolduğunu kontrol eder. */
function fill(template, values) {
  let s = template;
  for (const [k, v] of Object.entries(values)) {
    const key = `__${k}__`;
    if (!s.includes(key)) throw new Error(`şablonda ${key} yok`);
    s = s.split(key).join(v);
  }
  return s;
}

/** Eklenti klasörünü (<FUXA>/fuxaw/ içeriği) geçici yere kurar, zip'ler, base64 (76 karakterlik satırlar) döner. */
function pluginBase64(pluginDir, versionInfo) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fuxaw-plugin-'));
  try {
    const lib = path.join(tmp, 'fuxaw');
    // Eklentinin kendi testleri/araçları girmez; bağımlılıkları (ads-client) olduğu gibi kopyalanır.
    fs.cpSync(pluginDir, path.join(lib, 'native-ads'), {
      recursive: true,
      filter: (src) => {
        const parts = path.relative(pluginDir, src).split(path.sep);
        return parts[0] === 'node_modules' || !(parts.includes('test') || ['probe.js', 'prepare.js'].includes(parts[0]));
      },
    });
    fs.copyFileSync(path.join(ROOT, 'src', 'main', 'editorTagClear.js'), path.join(lib, 'editorTagClear.js'));
    fs.copyFileSync(path.join(ROOT, 'installer', 'hook.js'), path.join(lib, 'hook.js'));
    fs.writeFileSync(path.join(lib, 'version.json'), JSON.stringify(versionInfo, null, 2) + '\n');
    const zip = path.join(tmp, 'fuxaw.zip');
    execFileSync(TAR, ['-a', '-c', '-f', zip, '-C', lib, '.'], { stdio: 'inherit' });
    return fs.readFileSync(zip).toString('base64').match(/.{1,76}/g).join('\n');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Kurulum Windows x64 üzerinde üretilir (yerel ADS köprüsü).');
  const app = require(path.join(ROOT, 'package.json'));
  const pluginDir = path.join(ROOT, 'integrations', 'native-ads');
  const plugin = require(path.join(pluginDir, 'package.json'));
  need(path.join(pluginDir, 'node_modules', 'ads-client', 'package.json'), 'Repo kökünde: npm run install:ads');
  need(path.join(pluginDir, 'adsclient', 'native', 'bin', 'AdsBridge.exe'), 'Repo kökünde: npm run setup:ads');
  const engines = plugin.fuxawPlugin.engineVersions;
  if (engines.length !== 1) throw new Error(`Tek FUXA sürümü bekleniyordu: ${engines.join(', ')}`);

  const name = `fuxaw-install-${engines[0]}-v${app.version}`;
  const out = path.join(OUT_BASE, name);
  // Klasör silinmez, dosyaların üzerine yazılır: klasör Gezgin'de ya da bir konsolda açıkken de üretilebilsin.
  fs.mkdirSync(out, { recursive: true });
  for (const f of fs.readdirSync(out)) {
    if (!['install-fuxa.cmd', 'uninstall-fuxa.cmd', 'README.md'].includes(f)) fs.rmSync(path.join(out, f), { recursive: true, force: true });
  }

  const info = { package: name, fuxa: engines[0], node: NODE_VERSION, adsPlugin: plugin.version };
  const install = fill(fs.readFileSync(path.join(ROOT, 'installer', 'install-fuxa.ps1'), 'utf8'), {
    PACKAGE: name,
    NODE_VERSION,
    FUXA_VERSION: engines[0],
    PLUGIN_ZIP: pluginBase64(pluginDir, info),
  });
  fs.writeFileSync(path.join(out, 'install-fuxa.cmd'), selfContainedCmd(install, 'INSTALL FAILED.'), 'ascii');
  const uninstall = fs.readFileSync(path.join(ROOT, 'installer', 'uninstall-fuxa.ps1'), 'utf8');
  fs.writeFileSync(path.join(out, 'uninstall-fuxa.cmd'), selfContainedCmd(uninstall, 'UNINSTALL FAILED.'), 'ascii');
  fs.copyFileSync(path.join(ROOT, 'installer', 'README.md'), path.join(out, 'README.md'));

  const zip = `${out}.zip`;
  fs.rmSync(zip, { force: true });
  execFileSync(TAR, ['-a', '-c', '-f', zip, '-C', OUT_BASE, name], { stdio: 'inherit' });
  const mb = (f) => (fs.statSync(f).size / 1048576).toFixed(1);
  console.log(`Hazır: ${path.relative(ROOT, out)}  (install-fuxa.cmd ${mb(path.join(out, 'install-fuxa.cmd'))} MB)\n       ${path.relative(ROOT, zip)} (${mb(zip)} MB)`);
}

try { main(); } catch (e) { console.error(`HATA: ${e.message}`); process.exit(1); }
