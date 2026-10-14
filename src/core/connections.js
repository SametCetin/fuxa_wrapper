'use strict';
const { randomUUID } = require('node:crypto');
const { t } = require('./i18n');

function validNetId(value) {
  return /^\d{1,3}(\.\d{1,3}){5}$/.test(value) && value.split('.').every(part => Number(part) <= 255);
}
function validPort(value) { return Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 65535; }

function buildAdsDevice(devices, spec, { nativeAvailable = process.platform === 'win32' && process.arch === 'x64' } = {}) {
  const errors = [];
  const existing = spec.id ? devices[spec.id] : null;
  if (spec.id && (!existing || existing.type !== 'FuxawADS')) return { errors: [t('conn.deviceMissing')] };
  const name = String(spec.name || '').trim();
  const netId = String(spec.netId || '').trim();
  const transport = spec.transport;
  if (!name) errors.push(t('conn.nameEmpty'));
  if (existing && name !== existing.name) errors.push(t('conn.nameLocked'));
  if (Object.values(devices).some(device => device.id !== existing?.id && device.name === name)) errors.push(t('conn.nameTaken'));
  if (!validNetId(netId)) errors.push(t('conn.netId'));
  if (!validPort(spec.port)) errors.push(t('conn.port'));
  if (!['native', 'tcp'].includes(transport)) errors.push(t('conn.transport'));
  if (transport === 'native' && !nativeAvailable) errors.push(t('conn.nativeUnavailable'));
  const polling = Number(spec.polling);
  if (!Number.isInteger(polling) || polling < 50 || polling > 3600000) errors.push(t('conn.polling'));
  const local = String(spec.local || '').trim();
  const router = String(spec.router || '').trim();
  if (transport === 'tcp') {
    const [localId, localPort, ...extra] = local.split(':');
    if (local && (!validNetId(localId) || (localPort !== undefined && !validPort(localPort)) || extra.length)) errors.push(t('conn.local'));
    if (router && !/^[a-zA-Z0-9._-]+(?::\d+)?$/.test(router)) errors.push(t('conn.router'));
    if (router.includes(':') && !validPort(router.split(':')[1])) errors.push(t('conn.routerPort'));
  }
  if (errors.length) return { errors };
  return { device: {
    ...(existing || {}), id: existing?.id || `d_${randomUUID()}`, name, type: 'FuxawADS',
    enabled: spec.enabled === true, polling, tags: existing?.tags || {},
    property: { ...(existing?.property || {}), address: `${netId}:${Number(spec.port)}`, port: Number(spec.port),
      adsTransport: transport, ...(transport === 'tcp' ? { local, router } : {}) },
  } };
}

module.exports = { buildAdsDevice };
