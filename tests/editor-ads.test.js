'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { patchEditor } = require('../integrations/native-ads/editor');
const dist = path.resolve(__dirname, '../fuxa-runtime/node_modules/@frangoteam/fuxa/dist');

test('ADS editor adaptation preserves legacy transport and refuses unknown bundles',
    { skip: !fs.existsSync(dist) }, () => {
        const file = path.join(dist, fs.readdirSync(dist).find(n => /^main\.[\w]+\.js$/.test(n)));
        const original = fs.readFileSync(file, 'utf8');
        const patched = patchEditor(original);
        new vm.Script(patched);
        assert.equal(fs.readFileSync(file, 'utf8'), original);
        assert.throws(() => patchEditor(original.replace('function l1e(r,a){', 'function changed(r,a){')), /bulunamadı/);
        const start = patched.indexOf('onDeviceTypeChanged(){');
        const end = patched.indexOf('isValid(t){', start);
        const change = vm.runInNewContext('(' + patched.slice(start, end).replace('onDeviceTypeChanged()', 'function()') + ')', {
            an: { bq: { WebAPI: 'WebAPI', WebCam: 'WebCam' } },
        });
        for (const transport of [undefined, 'native', 'tcp']) {
            const device = { type: 'ADSclient', property: { address: '1.2.3.4.5.6:851', adsTransport: transport } };
            change.call({ data: { device } });
            assert.equal(device.property.adsTransport, transport || 'tcp');
            assert.equal(device.polling, 1000);
        }
        const device = { type: 'ADSclient', polling: 100, property: { adsTransport: 'native' } };
        change.call({ data: { device } });
        assert.equal(device.polling, 100);
    });
