'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse } = require('../src/core/fxprj');
const { tagTypesFor } = require('../src/core/tags');

test('legacy plugin connections migrate by explicit method without changing original ADS or tag IDs', () => {
    const devices = {
        original: { id: 'original', type: 'ADSclient', property: { address: '1.2.3.4.5.6:851' }, tags: {} },
        local: { id: 'local', type: 'ADSclient', property: { adsTransport: 'native', extra: true }, tags: { t1: { id: 't1', name: 'Test' } } },
        tcp: { id: 'tcp', type: 'ADSclient', property: { adsTransport: 'tcp', local: 'local' }, tags: {} },
    };
    const project = { hmi: {}, devices };
    for (const input of [project, { fxprj: 1, project }]) {
        const migrated = parse(JSON.stringify(input)).doc.project.devices;
        assert.deepEqual(migrated.original, devices.original);
        assert.deepEqual(migrated.local, { ...devices.local, type: 'FuxawADS' });
        assert.deepEqual(migrated.tcp, { ...devices.tcp, type: 'FuxawADS' });
    }
    assert.deepEqual(tagTypesFor({ type: 'FuxawADS', tags: {} }), ['Boolean', 'Number', 'String']);
});
