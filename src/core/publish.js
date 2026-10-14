'use strict';
// Publish: hedef makine için klasöre çıkarma. Ağ üzerinden hiçbir yere gönderilmez.
//   <klasör>/<ad>/<ad>.json   tam FUXA projesi (hedefte editör ☰ → Open Project)
//   <klasör>/<ad>/README.md   nereye/nasıl koyulacağı, cihaz/tag özeti
//   <klasör>/<ad>/download-project.cmd   hedefte projeyi çalışan FUXA'ya yükler (önce yedekler); tek dosya
// Lint hatası varsa yazmaz.

const fs = require('node:fs');
const path = require('node:path');
const model = require('./model');
const lintmod = require('./lint');
const { safeName } = require('./fxprj');
const { selfContainedCmd } = require('./target/selfcontained');

const SCRIPT = 'download-project.cmd';
function scriptText() {
  const ps = fs.readFileSync(path.join(__dirname, 'target', 'download-project.ps1'), 'utf8');
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
    files: out ? [path.join(out, `${name}.json`), path.join(out, 'README.md'), path.join(out, SCRIPT)] : [],
  };
}

function publish(doc, fxprjPath, now = new Date()) {
  const p = plan(doc, fxprjPath);
  if (p.errors) return { ok: false, reason: 'lint', ...p };
  if (!p.dir) return { ok: false, reason: 'nodir', ...p };
  fs.mkdirSync(p.dir, { recursive: true });
  const [prjFile, readmeFile] = p.files;
  fs.writeFileSync(prjFile, JSON.stringify(model.cleanProject(doc.project), null, 2) + '\n', 'utf8');
  fs.writeFileSync(readmeFile, readme(doc, fxprjPath, path.basename(prjFile), p.lint, now), 'utf8');
  fs.writeFileSync(path.join(p.dir, SCRIPT), scriptText(), 'ascii');
  fs.rmSync(path.join(p.dir, 'download-project.ps1'), { force: true }); // eski iki dosyalı sürümden kalan
  return { ok: true, ...p };
}

function stamp(d) {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`;
}

function readme(doc, fxprjPath, fname, found, now) {
  const items = model.splitProject(doc.project);
  const names = (kind) => model.itemsOfKind(items, kind).map(([, v]) => v.name || '').sort();
  const devs = model.itemsOfKind(items, 'device').map(([, v]) => v).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const warns = found.filter((f) => f.level !== lintmod.ERROR);
  const lines = [
    `# ${doc.name} – FUXA projesi (hedef makine için)`,
    '',
    `- Üretildi: ${stamp(now)} (fuxaw → Publish)`,
    `- Kaynak: \`${fxprjPath || '-'}\``,
    `- FUXA sürümü: ${doc.fuxaVersion || '?'}`,
    `- Lint: ${found.length ? `${warns.length} uyarı, hata yok` : 'temiz'}`,
    '',
    '## Dosyalar',
    '',
    `- \`${fname}\`: tam proje (cihazlar, tag'ler, ekranlar, script'ler).`,
    '- `download-project.cmd`: projeyi hedefte çalışan FUXA\'ya yükler (tek dosya, yanında başka dosya gerekmez).',
    '',
    '## Hedef makineye yükleme',
    '',
    'Hedefte FUXA, fuxaw kurulum paketindeki `install-fuxa.cmd` ile kurulmuş olmalı (`C:\\ProgramData\\fuxa`).',
    '',
    `1. Bu klasörü hedef makineye kopyala, ör. \`C:\\fuxa_publish\\${safeName(doc.name)}\\\`.`,
    '2. FUXA çalışmıyorsa başlat: `C:\\ProgramData\\fuxa\\start-fuxa.cmd`.',
    '3. `download-project.cmd`\'ye çift tıkla. Önce FUXA\'daki mevcut proje `C:\\ProgramData\\fuxa\\data\\backups\\` altına yedeklenir,',
    `   sonra \`${fname}\` yüklenir. Bağlantılar hemen kurulur; FUXA'yı yeniden başlatmak gerekmez.`,
    '4. Açık runtime sayfalarını (`http://127.0.0.1:1881/home`) yenile.',
    '',
    'Geri almak için: `download-project.cmd -Project <yedek json>` (betik bittiğinde tam komutu yazar).',
    '',
    `Elle yüklemek istersen: FUXA editörü (\`http://127.0.0.1:1881/editor\`) → ☰ → *Save Project As...* (yedek), sonra ☰ → *Open Project* → \`${fname}\`.`,
    '',
    '## Kontrol et',
    '',
    'Cihaz bağlantı ayarları dosyada nasılsa hedefe öyle gider; hedefteki PLC\'ye uyduğunu kontrol et:',
    '',
    '| Cihaz | Tip | Tag sayısı |',
    '| ----- | --- | ---------- |',
    ...devs.map((d) => `| ${d.name || ''} | ${d.type || ''} | ${Object.keys(d.tags || {}).length} |`),
    '',
    `Ekranlar: ${names('view').join(', ') || '-'}`,
    '',
    `Script'ler: ${names('script').join(', ') || '-'}`,
    '',
  ];
  if (warns.length) {
    lines.push('## Lint uyarıları', '', ...warns.map((w) => `- ${w.where}: ${w.message}`), '');
  }
  return lines.join('\n');
}

module.exports = { resolveDir, plan, publish, readme };
