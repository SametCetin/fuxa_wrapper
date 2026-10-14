'use strict';
// Gömülü FUXA'nın REST API'si (1.3.4, kimlik doğrulama yok). Bkz. AGENTS.md §5.

const { t } = require('../core/i18n');

class FuxaApiError extends Error {}

async function request(base, path, body) {
  const opts = { signal: AbortSignal.timeout(30000) };
  if (body !== undefined) {
    opts.method = 'POST';
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  let r;
  try {
    r = await fetch(base + path, opts);
  } catch (e) {
    throw new FuxaApiError(t('engine.unreachable', { path, error: e.message }));
  }
  const text = await r.text();
  if (!r.ok) throw new FuxaApiError(`${path}: HTTP ${r.status} ${text.slice(0, 300)}`);
  return text;
}

async function getProject(base) {
  const prj = JSON.parse(await request(base, '/api/project'));
  if (!prj || typeof prj !== 'object' || !prj.hmi) throw new FuxaApiError(t('engine.badResponse', { path: '/api/project' }));
  return prj;
}

/** Tüm projeyi değiştirir (editörde ☰ → Open Project ile aynı çağrı). */
async function setProject(base, prj) {
  await request(base, '/api/project', prj);
}

/** Proje parçası kaydet (set-device, set-view, …). set-device cihazın sürücüsünü yeniden başlatır. */
async function projectData(base, cmd, data) {
  await request(base, '/api/projectData', { cmd, data });
}

/**
 * Editör dili. FUXA'nın kendi ayar penceresiyle aynı çağrı: ayarların tamamı geri yazılır (POST mysettings.json'u
 * baştan yazar; gizli alanları sunucu kendisi tamamlar) ve sunucu çalışma zamanını yeniden başlatır.
 */
async function setLanguage(base, language) {
  const settings = JSON.parse(await request(base, '/api/settings'));
  if (settings.language === language) return;
  await request(base, '/api/settings', { ...settings, language });
}

module.exports = { FuxaApiError, getProject, setProject, projectData, setLanguage };
