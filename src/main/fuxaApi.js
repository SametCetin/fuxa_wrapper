'use strict';
// Gömülü FUXA'nın REST API'si (1.3.4, kimlik doğrulama yok). Bkz. AGENTS.md §5.

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
    throw new FuxaApiError(`Editör bileşenine ulaşılamadı (${path}): ${e.message}`);
  }
  const text = await r.text();
  if (!r.ok) throw new FuxaApiError(`${path}: HTTP ${r.status} ${text.slice(0, 300)}`);
  return text;
}

async function getProject(base) {
  const prj = JSON.parse(await request(base, '/api/project'));
  if (!prj || typeof prj !== 'object' || !prj.hmi) throw new FuxaApiError('Editör bileşeni beklenmeyen cevap döndürdü (/api/project)');
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

module.exports = { FuxaApiError, getProject, setProject, projectData };
