'use strict';
// Publish: hedef makine için klasöre çıkarma. Ağ üzerinden hiçbir yere gönderilmez.
//   <klasör>/<ad>/<ad>.json   tam FUXA projesi (hedefte editör ☰ → Open Project)
//   <klasör>/<ad>/README.md   nereye/nasıl koyulacağı, cihaz/tag özeti
// Lint hatası varsa yazmaz.

const fs = require('node:fs');
const path = require('node:path');
const model = require('./model');
const lintmod = require('./lint');
const { safeName } = require('./fxprj');

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
    files: out ? [path.join(out, `${name}.json`), path.join(out, 'README.md')] : [],
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
    `- \`${fname}\`: tam proje (cihazlar, tag'ler, ekranlar, script'ler). FUXA editöründe *Open Project* ile açılır.`,
    '',
    '## Hedef makinede nereye koyulur',
    '',
    'FUXA projeyi kendi veritabanında tutar; bu dosya FUXA\'nın kurulum veya `_appdata` klasörüne **kopyalanmaz**,',
    'editörden içeri alınır.',
    '',
    `1. Bu klasörü hedef makineye kopyala, ör. \`C:\\fuxa_publish\\${safeName(doc.name)}\\\`.`,
    '2. Hedef makinede FUXA editörünü aç: `http://127.0.0.1:1881/editor` (port farklıysa onu yaz).',
    '3. **Önce mevcut projeyi yedekle:** sol üst ☰ menü → *Save Project As...* → inen JSON\'u sakla.',
    `4. ☰ menü → *Open Project* (Türkçe arayüzde *Aç*) → \`${fname}\` dosyasını seç. Proje hemen FUXA sunucusuna kaydedilir.`,
    '5. Açık runtime sayfalarını (`/home`) yenile.',
    '',
    'Geri almak için 3. adımdaki yedeği aynı yolla (*Open Project*) aç.',
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
