'use strict';
// Kurulum paketine konacak Node.js'i indirir: vendor/node/ (FUXA bununla çalışır).
// Kullanım: node scripts/fetch-node.js [--platform win32|linux|darwin] [--arch x64|arm64]
// Sürüm sabit; indirilen arşiv nodejs.org'daki SHASUMS256.txt ile doğrulanır.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const NODE_VERSION = 'v24.19.0';
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'vendor', 'node');

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
}

async function download(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

async function main() {
  const platform = arg('platform', process.platform);
  const arch = arg('arch', process.arch);
  const plat = { win32: 'win', linux: 'linux', darwin: 'darwin' }[platform];
  if (!plat) throw new Error(`desteklenmeyen platform: ${platform}`);
  const ext = plat === 'win' ? 'zip' : plat === 'linux' ? 'tar.xz' : 'tar.gz';
  const base = `node-${NODE_VERSION}-${plat}-${arch}`;
  const file = `${base}.${ext}`;

  const marker = path.join(OUT, '.version');
  if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8').trim() === base) {
    console.log(`vendor/node hazır (${base})`);
    return;
  }

  const dist = `https://nodejs.org/dist/${NODE_VERSION}`;
  console.log(`indiriliyor: ${dist}/${file}`);
  const [archive, sums] = await Promise.all([download(`${dist}/${file}`), download(`${dist}/SHASUMS256.txt`)]);
  const expected = sums.toString().split('\n').map((l) => l.trim().split(/\s+/)).find(([, f]) => f === file);
  const actual = crypto.createHash('sha256').update(archive).digest('hex');
  if (!expected || expected[0] !== actual) throw new Error(`${file}: SHA256 tutmadı`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fuxaw-node-'));
  const archivePath = path.join(tmp, file);
  fs.writeFileSync(archivePath, archive);
  // Windows'ta sistemin bsdtar'ı (zip açar); PATH'teki Git Bash tar'ı "C:" yolunu uzak sunucu sanıyor.
  const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  execFileSync(tar, ['-xf', archivePath, '-C', tmp], { stdio: 'inherit' });

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const src = path.join(tmp, base);
  // Sadece çalıştırılabilir dosya ve lisans; npm/corepack gerekmez.
  if (plat === 'win') {
    fs.copyFileSync(path.join(src, 'node.exe'), path.join(OUT, 'node.exe'));
  } else {
    fs.mkdirSync(path.join(OUT, 'bin'));
    fs.copyFileSync(path.join(src, 'bin', 'node'), path.join(OUT, 'bin', 'node'));
    fs.chmodSync(path.join(OUT, 'bin', 'node'), 0o755);
  }
  fs.copyFileSync(path.join(src, 'LICENSE'), path.join(OUT, 'LICENSE'));
  fs.writeFileSync(marker, base + '\n');
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`vendor/node hazır (${base})`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
