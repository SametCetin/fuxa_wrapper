'use strict';
// Publish: hedef makine için klasöre çıkarma. Ağ üzerinden hiçbir yere gönderilmez.
//   <klasör>/<ad>/download-<ad>.cmd   müşteriye giden tek dosya: proje içine gömülü; hedefte çalışan FUXA'ya yükler
//                                     (FUXA kapalıysa başlatır, önce yedekler, runtime ekranını yeniden açar)
//   <klasör>/<ad>/<ad>.json           tam FUXA projesi (kayıt, git farkı, elle Open Project); göndermek gerekmez
// Lint hatası varsa yazmaz.

const fs = require('node:fs');
const path = require('node:path');
const model = require('./model');
const lintmod = require('./lint');
const { safeName } = require('./fxprj');
const { selfContainedCmd } = require('./target/selfcontained');

// Önceki sürümlerin yazdığı, artık üretilmeyen dosyalar; Publish bunları temizler.
const STALE = ['README.md', 'download-project.cmd', 'download-project.ps1'];

/** PowerShell betiğine tek tırnaklı metin olarak gömülecek ad: ASCII (5.1 konsolu), ' kaçışlı. */
function psName(name) {
  const tr = { ç: 'c', Ç: 'C', ğ: 'g', Ğ: 'G', ı: 'i', İ: 'I', ö: 'o', Ö: 'O', ş: 's', Ş: 'S', ü: 'u', Ü: 'U' };
  return String(name).replace(/[^\x20-\x7e]/g, (c) => tr[c] || '?').replace(/'/g, "''");
}

/** download-<ad>.cmd içeriği: src/core/target/download-project.ps1 şablonu + gömülü proje (JSON, base64). */
function downloadCmd(name, json) {
  const tpl = fs.readFileSync(path.join(__dirname, 'target', 'download-project.ps1'), 'utf8');
  for (const k of ['__PROJECT_NAME__', '__PROJECT_JSON__']) {
    if (tpl.split(k).length !== 2) throw new Error(`download-project.ps1: ${k} tam bir kez geçmeli`);
  }
  const ps = tpl
    .split('__PROJECT_NAME__').join(psName(name))
    .split('__PROJECT_JSON__').join(Buffer.from(json, 'utf8').toString('base64').match(/.{1,76}/g).join('\n'));
  return selfContainedCmd(ps, 'PROJECT LOAD FAILED.');
}

/** .fxprj'deki publish.dir'i mutlak yola çevirir (göreliyse .fxprj klasörüne göre). */
function resolveDir(doc, fxprjPath) {
  const dir = (doc.publish && doc.publish.dir) || 'publish';
  if (path.isAbsolute(dir)) return dir;
  if (!fxprjPath) return null;
  return path.resolve(path.dirname(fxprjPath), dir);
}

function plan(doc, fxprjPath) {
  const items = model.splitProject(doc.project);
  const found = lintmod.lint(items);
  const base = resolveDir(doc, fxprjPath);
  const name = safeName(doc.name);
  const out = base && path.join(base, name);
  return {
    lint: found,
    errors: found.filter((f) => f.level === lintmod.ERROR).length,
    dir: out,
    files: out ? [path.join(out, `download-${name}.cmd`), path.join(out, `${name}.json`)] : [],
  };
}

function publish(doc, fxprjPath) {
  const p = plan(doc, fxprjPath);
  if (p.errors) return { ok: false, reason: 'lint', ...p };
  if (!p.dir) return { ok: false, reason: 'nodir', ...p };
  fs.mkdirSync(p.dir, { recursive: true });
  const [cmdFile, prjFile] = p.files;
  const json = JSON.stringify(model.cleanProject(doc.project), null, 2) + '\n';
  fs.writeFileSync(cmdFile, downloadCmd(doc.name, json), 'ascii');
  fs.writeFileSync(prjFile, json, 'utf8');
  for (const f of STALE) fs.rmSync(path.join(p.dir, f), { force: true });
  return { ok: true, ...p };
}

module.exports = { resolveDir, plan, publish, psName };
