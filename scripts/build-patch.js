'use strict';
// Hedef makine kurulumu: kur.cmd Node.js + FUXA 1.3.4'ü internetten kurar, sonra yamayı uygular
// (ADS (fuxaw) eklentisi + editör formu). Pakette sadece yama ve betikler var; Node/FUXA yok.
//   dist/patch/<ad>/      hedef makinede kur.cmd ile kurulur
//   dist/patch/<ad>.zip   aynı klasör, taşımak için
// Önce: npm run setup:ads (npm run dist:patch yapar). Yerel köprü için Windows x64'te üretilir.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { NODE_VERSION } = require('./fetch-node');

const ROOT = path.resolve(__dirname, '..');
const OUT_BASE = path.join(ROOT, 'dist', 'patch');

function need(file, hint) {
  if (!fs.existsSync(file)) throw new Error(`${path.relative(ROOT, file)} yok. ${hint}`);
  return file;
}

function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Yama Windows x64 üzerinde üretilir (yerel ADS köprüsü).');
  const app = require(path.join(ROOT, 'package.json'));
  const pluginDir = path.join(ROOT, 'integrations', 'native-ads');
  const plugin = require(path.join(pluginDir, 'package.json'));
  need(path.join(pluginDir, 'node_modules', 'ads-client', 'package.json'), 'Repo kökünde: npm run install:ads');
  need(path.join(pluginDir, 'adsclient', 'native', 'bin', 'AdsBridge.exe'), 'Repo kökünde: npm run setup:ads');
  const engines = plugin.fuxawPlugin.engineVersions;

  const name = `fuxaw-install-${engines.join('_')}-v${app.version}`;
  const out = path.join(OUT_BASE, name);
  fs.rmSync(out, { recursive: true, force: true });
  const lib = path.join(out, 'fuxaw');
  fs.mkdirSync(lib, { recursive: true });

  // Eklentinin kendi testleri/araçları girmez; bağımlılıkları (ads-client) olduğu gibi kopyalanır.
  fs.cpSync(pluginDir, path.join(lib, 'native-ads'), {
    recursive: true,
    filter: (src) => {
      const parts = path.relative(pluginDir, src).split(path.sep);
      return parts[0] === 'node_modules' || !(parts.includes('test') || ['probe.js', 'prepare.js'].includes(parts[0]));
    },
  });
  fs.copyFileSync(path.join(ROOT, 'src', 'main', 'editorTagClear.js'), path.join(lib, 'editorTagClear.js'));
  fs.copyFileSync(path.join(ROOT, 'patch', 'hook.js'), path.join(lib, 'hook.js'));
  for (const f of fs.readdirSync(path.join(ROOT, 'patch'))) {
    if (f === 'hook.js') continue;
    const text = fs.readFileSync(path.join(ROOT, 'patch', f), 'utf8').replace(/\r?\n/g, '\r\n');
    // Betikler ASCII; BOM yine de eklenir: Windows PowerShell 5.1 BOM'suz UTF-8'i ANSI okur.
    fs.writeFileSync(path.join(out, f), (f.endsWith('.ps1') ? '\ufeff' : '') + text, 'utf8');
  }
  fs.writeFileSync(path.join(out, 'version.json'), JSON.stringify({ package: name, fuxa: engines, node: NODE_VERSION, adsPlugin: plugin.version }, null, 2) + '\n');

  const zip = `${out}.zip`;
  fs.rmSync(zip, { force: true });
  // Git Bash'teki tar C:\ yolunu uzak sunucu sanar; Windows'un kendi tar'ı (bsdtar) zip de yazar.
  execFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'),
    ['-a', '-c', '-f', zip, '-C', OUT_BASE, name], { stdio: 'inherit' });
  console.log(`Hazır: ${path.relative(ROOT, out)}\n       ${path.relative(ROOT, zip)} (${(fs.statSync(zip).size / 1048576).toFixed(1)} MB)`);
}

try { main(); } catch (e) { console.error(`HATA: ${e.message}`); process.exit(1); }
