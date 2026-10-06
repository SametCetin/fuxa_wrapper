'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAdsDevice } = require('../src/core/connections');
const fixture = { name: 'PLC', transport: 'native', netId: '192.168.1.10.1.1', port: 851, polling: 1000, enabled: false };

test('ADS method is explicit and new devices remain disabled until requested', () => {
  const result = buildAdsDevice({}, fixture, { nativeAvailable: true });
  assert.equal(result.device.property.adsTransport, 'native');
  assert.equal(result.device.property.address, '192.168.1.10.1.1:851');
  assert.equal(result.device.enabled, false);
  assert.ok(buildAdsDevice({}, { ...fixture, transport: '' }).errors);
  assert.ok(buildAdsDevice({}, fixture, { nativeAvailable: false }).errors);
});

test('changing ADS transport preserves tags and unknown device properties without mutating the source', () => {
  const device = { id: 'd_old', name: 'PLC', type: 'ADSclient', tags: { t_old: { name: 'Motor' } },
    extra: { value: 'keep' }, property: { address: '192.168.1.10.1.1:851', adsTransport: 'native', custom: 42 } };
  const before = JSON.stringify(device);
  const result = buildAdsDevice({ d_old: device }, { ...fixture, id: 'd_old', transport: 'tcp',
    local: '192.168.1.20.1.1:32750', router: '192.168.1.10:48898', enabled: true });
  assert.equal(result.device.id, 'd_old');
  assert.deepEqual(result.device.tags, device.tags);
  assert.equal(result.device.property.custom, 42);
  assert.equal(result.device.property.router, '192.168.1.10:48898');
  assert.equal(JSON.stringify(device), before);
});

test('invalid addresses, duplicate names and accidental device rename are rejected', () => {
  assert.ok(buildAdsDevice({}, { ...fixture, netId: '999.1.1.1.1.1' }).errors);
  assert.ok(buildAdsDevice({}, { ...fixture, port: 0 }).errors);
  assert.ok(buildAdsDevice({}, { ...fixture, transport: 'tcp', router: '192.168.1.10:99999' }).errors);
  const devices = { d: { id: 'd', name: 'PLC', type: 'ADSclient' } };
  assert.ok(buildAdsDevice(devices, fixture).errors);
  assert.ok(buildAdsDevice(devices, { ...fixture, id: 'd', name: 'Renamed' }).errors);
});
