'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadDevices } = require('../integrations/native-ads/device-loader');
const engine = path.resolve(__dirname, '../fuxa-runtime/node_modules/@frangoteam/fuxa');

test('engine dispatches original ADS and plugin independently without changing engine files',
    { skip: !fs.existsSync(path.join(engine, 'main.js')) }, async () => {
        const file = path.join(engine, 'runtime/devices/device.js');
        const before = fs.readFileSync(file, 'utf8');
        const devices = loadDevices(engine);
        const original = require(path.join(engine, 'runtime/devices/adsclient'));
        const create = original.create;
        const plugin = require('../integrations/native-ads/driver-entry');
        let originalCalls = 0, pluginCalls = 0, disconnects = 0;
        original.create = () => { originalCalls++; return { load() {} }; };
        plugin.configure({ create() {
            pluginCalls++;
            return { load() {}, connect: async () => true, disconnect: async () => { disconnects++; } };
        } });
        const runtime = { logger: {}, events: {}, plugins: {}, project: {} };
        try {
            devices.loadPlugin('FuxawADS', require.resolve('../integrations/native-ads/driver-entry'));
            assert.equal(typeof devices.create({ type: 'ADSclient' }, runtime).start, 'function');
            assert.equal(typeof devices.create({ type: 'FuxawADS' }, runtime).start, 'function');
            assert.equal(originalCalls, 1);
            assert.equal(pluginCalls, 1);
            const comm = plugin.create();
            await comm.connect();
            await plugin.setEnabled(false);
            assert.equal(disconnects, 1);
            await assert.rejects(comm.connect(), /kurulu değil/);
            devices.loadPlugin('FuxawADS', null);
            assert.equal(devices.create({ type: 'FuxawADS' }, runtime).start, undefined);
            assert.equal(typeof devices.create({ type: 'ADSclient' }, runtime).start, 'function');
            assert.equal(originalCalls, 2);
            assert.equal(fs.readFileSync(file, 'utf8'), before);
        } finally { original.create = create; await plugin.setEnabled(true); }
    });
