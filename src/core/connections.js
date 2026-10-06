'use strict';
const { randomUUID } = require('node:crypto');

function validNetId(value) {
  return /^\d{1,3}(\.\d{1,3}){5}$/.test(value) && value.split('.').every(part => Number(part) <= 255);
}
function validPort(value) { return Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 65535; }

function buildAdsDevice(devices, spec, { nativeAvailable = process.platform === 'win32' && process.arch === 'x64' } = {}) {
  const errors = [];
  const existing = spec.id ? devices[spec.id] : null;
  if (spec.id && (!existing || existing.type !== 'ADSclient')) return { errors: ['ADS cihazı bulunamadı; listeyi yenile.'] };
  const name = String(spec.name || '').trim();
  const netId = String(spec.netId || '').trim();
  const transport = spec.transport;
  if (!name) errors.push('Bağlantı adı gerekli.');
  if (existing && name !== existing.name) errors.push('Mevcut bağlantının adı bu ekranda değiştirilemez.');
  if (Object.values(devices).some(device => device.id !== existing?.id && device.name === name)) errors.push('Bu adda bir cihaz zaten var.');
  if (!validNetId(netId)) errors.push('Hedef AMS Net ID altı sayıdan oluşmalı (ör. 192.168.1.10.1.1).');
  if (!validPort(spec.port)) errors.push('ADS portu 1–65535 arasında tam sayı olmalı.');
  if (!['native', 'tcp'].includes(transport)) errors.push('Bağlantı yöntemini seç.');
  if (transport === 'native' && !nativeAvailable) errors.push('Yerel TwinCAT bağlantısı Windows x64 gerektirir.');
  const polling = Number(spec.polling);
  if (!Number.isInteger(polling) || polling < 50 || polling > 3600000) errors.push('Okuma aralığı 50–3600000 ms arasında tam sayı olmalı.');
  const local = String(spec.local || '').trim();
  const router = String(spec.router || '').trim();
  if (transport === 'tcp') {
    const [localId, localPort, ...extra] = local.split(':');
    if (local && (!validNetId(localId) || (localPort !== undefined && !validPort(localPort)) || extra.length)) errors.push('Yerel AMS adresi geçersiz (ör. 192.168.1.20.1.1:32750).');
    if (router && !/^[a-zA-Z0-9._-]+(?::\d+)?$/.test(router)) errors.push('Router adresi geçersiz (ör. 192.168.1.10:48898).');
    if (router.includes(':') && !validPort(router.split(':')[1])) errors.push('Router TCP portu 1–65535 arasında olmalı.');
  }
  if (errors.length) return { errors };
  return { device: {
    ...(existing || {}), id: existing?.id || `d_${randomUUID()}`, name, type: 'ADSclient',
    enabled: spec.enabled === true, polling, tags: existing?.tags || {},
    property: { ...(existing?.property || {}), address: `${netId}:${Number(spec.port)}`, port: Number(spec.port),
      adsTransport: transport, ...(transport === 'tcp' ? { local, router } : {}) },
  } };
}

module.exports = { buildAdsDevice };
