'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { install } = require('../integrations/native-ads');

function engine(version = '1.3.4', fails = false) {
    const calls = [];
    const plugins = {
        async init() { calls.push('defaults'); if (fails) throw new Error('init failed'); return 42; },
        async addPlugin() { calls.push('install-default'); return 'installed'; },
    };
    const devices = { loadPlugin(type, filename) {
        calls.push(type);
        assert.equal(typeof require(filename).create, 'function');
    } };
    return { plugins, calls, requireModule(filename) {
        if (filename === 'ads-client') return { Client: class {} };
        if (filename.endsWith('package.json')) return { version };
        if (filename.endsWith(path.join('runtime', 'plugins'))) return plugins;
        if (filename.endsWith(path.join('devices', 'device'))) return devices;
        return {};
    } };
}

test('offline driver loads after defaults, once per initialization, without npm or file writes', async () => {
    const fake = engine();
    install('/engine', fake);
    install('/engine', fake);
    assert.deepEqual(fake.calls, []);
    assert.equal(await fake.plugins.init(), 42);
    assert.deepEqual(fake.calls, ['defaults', 'ADSclient']);
    await fake.plugins.init();
    assert.deepEqual(fake.calls, ['defaults', 'ADSclient', 'defaults', 'ADSclient']);
});

test('unsupported engine version is rejected before registration', () => {
    const fake = engine('1.3.5');
    const original = fake.plugins.init;
    assert.throws(() => install('/engine', fake), /doğrulanmadı/);
    assert.equal(fake.plugins.init, original);
});

test('installing engine plugins cannot replace the bundled ADS driver', async () => {
    const fake = engine();
    install('/engine', fake);
    await fake.plugins.init();
    assert.equal(await fake.plugins.addPlugin('ads-client'), 'installed');
    assert.deepEqual(fake.calls, ['defaults', 'ADSclient', 'install-default', 'ADSclient']);
});

test('failed engine initialization does not activate the driver', async () => {
    const fake = engine('1.3.4', true);
    install('/engine', fake);
    await assert.rejects(fake.plugins.init(), /init failed/);
    assert.deepEqual(fake.calls, ['defaults']);
});
