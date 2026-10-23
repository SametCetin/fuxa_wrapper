'use strict';
// Sürümü ayarlar: node scripts/set-version.js 27.1.10.26   (npm run version:set -- 27.1.10.26; başta V/v olabilir)
// fuxaw sürümü dört parçalıdır (ör. 27.1.10.26), etiketi V<sürüm>. npm, Electron ve güncelleyici üç parçalı
// semver istediği için package.json'da (eşleme: src/core/version.js):
//   fullVersion          27.1.10.26   uygulamanın gösterdiği sürüm, dosya adları, release etiketi (V27.1.10.26)
//   version              27.1.10026   semver: 3. parça × 1000 + 4. parça (güncelleyici aynı ayın sürümlerini ayırsın)
//   build.buildVersion   27.1.10.26   Windows dosya sürümü
// package-lock.json'daki kök sürüm de güncellenir. Sonra: commit, git tag V<sürüm>, git push origin main V<sürüm>.

const fs = require('node:fs');
const path = require('node:path');
const { toSemver } = require('../src/core/version');

const ROOT = path.resolve(__dirname, '..');
const arg = (process.argv[2] || '').replace(/^[vV]/, '');
if (!/^\d+\.\d+\.\d+\.\d+$/.test(arg)) {
  console.error('Kullanım: node scripts/set-version.js 27.1.10.26   (dört sayısal parça)');
  process.exit(1);
}
const semver = toSemver(arg);

// Sadece ilgili satırlar değiştirilir; dosyanın geri kalan biçimi korunur.
function edit(file, fn, allowUnchanged = false) {
  const p = path.join(ROOT, file);
  const before = fs.readFileSync(p, 'utf8');
  const after = fn(before);
  if (after === before && !allowUnchanged) throw new Error(`${file}: değişiklik yapılamadı`);
  fs.writeFileSync(p, after);
}

edit('package.json', (s) => {
  s = s.replace(/^(  "version": )"[^"]*"/m, `$1"${semver}"`);
  s = /^  "fullVersion": /m.test(s)
    ? s.replace(/^(  "fullVersion": )"[^"]*"/m, `$1"${arg}"`)
    : s.replace(/^(  "version": "[^"]*",\r?\n)/m, `$1  "fullVersion": "${arg}",\n`);
  s = /^    "buildVersion": /m.test(s)
    ? s.replace(/^(    "buildVersion": )"[^"]*"/m, `$1"${arg}"`)
    : s.replace(/^(  "build": \{\r?\n)/m, `$1    "buildVersion": "${arg}",\n`);
  return s;
});
// package-lock: kök paketin iki sürüm alanı (en üstteki ve packages[""]).
edit('package-lock.json', (s) => s
  .replace(/^(  "version": )"[^"]*"/m, `$1"${semver}"`)
  .replace(/^(  "packages": \{\r?\n    "": \{\r?\n      "name": "[^"]*",\r?\n      "version": )"[^"]*"/m, `$1"${semver}"`), true);

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
if (pkg.version !== semver || pkg.fullVersion !== arg || pkg.build.buildVersion !== arg) throw new Error('package.json doğrulanamadı');
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
if (lock.version !== semver || lock.packages[''].version !== semver) throw new Error('package-lock.json doğrulanamadı');
console.log(`Sürüm ${arg} (npm ${semver}). Etiket: V${arg}`);
