'use strict';
// electron-builder afterPack: NSIS kurulum paketinde gömülü FUXA + Node.js (≈14 bin dosya) uygulama klasöründen çıkarılır,
// ayrı bir "runtime" arşivi olur. Kurulum bu arşivi %ProgramData%\fuxaw-runtime\<kimlik>\ altına yalnız o kimlik
// yoksa açar (installer/nsis-runtime.nsh); güncellemede FUXA/Node değişmediyse dokunulmaz, kurulum saniyeler sürer.
// Kimlik içerikten türetilir: aynı FUXA/Node/bağımlılık = aynı klasör, farklı olursa yanına yenisi açılır (eskisi kalır).
//
// Üretilenler (dist/):
//   fuxaw-runtime.7z    resources/fuxa + resources/node (kökte fuxa/, node/)
//   fuxaw-runtime.nsh   !define FXW_RUNTIME_ID / FXW_RUNTIME_7Z (nsis-runtime.nsh bunu okur)
// Uygulama klasörüne: resources/fuxaw-runtime.json {"id": ...} (src/main/runtime.js arar).
// Kurulumsuz paket (--dir, dist:fast) dokunulmadan kalır: runtime resources/ içinde gelir.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const PARTS = ['fuxa', 'node'];

function walk(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out);
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

/** İçerik kimliği: göreli yol + dosya içeriği, sıralı. Aynı girdi her makinede aynı kimliği verir. */
function contentHash(root) {
  const h = crypto.createHash('sha256');
  for (const rel of walk(root).sort()) {
    h.update(rel + '\0');
    h.update(fs.readFileSync(path.join(root, rel)));
    h.update('\0');
  }
  return h.digest('hex').slice(0, 12);
}

function runtimeId(resources) {
  const fuxaPkg = JSON.parse(fs.readFileSync(path.join(resources, 'fuxa', 'node_modules', '@frangoteam', 'fuxa', 'package.json'), 'utf8'));
  const { NODE_VERSION } = require('./fetch-node');
  const h = crypto.createHash('sha256');
  for (const p of PARTS) h.update(`${p}:${contentHash(path.join(resources, p))}\n`);
  return `fuxa-${fuxaPkg.version}_node-${NODE_VERSION.replace(/^v/, '')}_${h.digest('hex').slice(0, 12)}`;
}

async function afterPack(context) {
  const targets = context.targets.map((t) => t.name);
  if (context.electronPlatformName !== 'win32' || !targets.includes('nsis')) return;
  if (targets.some((t) => t !== 'nsis')) throw new Error(`runtime ayırma yalnız nsis hedefiyle: ${targets.join(',')}`);

  const resources = path.join(context.appOutDir, 'resources');
  const outDir = context.outDir;
  const id = runtimeId(resources);
  const archive = path.join(outDir, 'fuxaw-runtime.7z');
  fs.rmSync(archive, { force: true });

  const { getPath7za } = require('app-builder-lib/out/toolsets/7zip');
  const sevenZip = await getPath7za();
  // Arşiv kökünde fuxa/ ve node/; -mx=7 boyut/süre dengesi (app-64.7z ile benzer).
  execFileSync(sevenZip, ['a', '-t7z', '-mx=7', '-bd', archive, ...PARTS], { cwd: resources, stdio: 'inherit' });
  for (const p of PARTS) fs.rmSync(path.join(resources, p), { recursive: true, force: true });

  fs.writeFileSync(path.join(resources, 'fuxaw-runtime.json'), JSON.stringify({ id }, null, 2) + '\n');
  fs.writeFileSync(path.join(outDir, 'fuxaw-runtime.nsh'),
    `!define FXW_RUNTIME_ID "${id}"\n!define FXW_RUNTIME_7Z "${archive}"\n`);
  console.log(`  • fuxaw runtime  id=${id}  ${(fs.statSync(archive).size / 2 ** 20).toFixed(1)} MB`);
}

module.exports = afterPack;
module.exports.default = afterPack;
module.exports.runtimeId = runtimeId;
module.exports.contentHash = contentHash;
