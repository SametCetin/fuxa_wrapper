'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { install } = require('../integrations/native-ads');

function engine(version = '1.3.4', fails = false) {
    const calls = [];
    const plugins = {
        async init() { calls.push('defaults'); if (fails) throw new Error('init failed'); return 42; },
        async addPlugin() { calls.push('install-default'); return 'installed'; },
        async removePlugin() { calls.push('remove-default'); },
        async getPlugins() { return [{ name: 'ads-client', type: 'ADSclient', current: '2.1.0' },
            { name: 'other', type: 'Other', current: '1' }]; },
        getPlugin(type) { return { type, name: type === 'ADSclient' ? 'ads-client' : 'other' }; },
    };
    const devices = { loadPlugin(type, filename) {
        calls.push(type);
        if (filename) assert.equal(typeof require(filename).create, 'function');
    } };
    return { plugins, calls, loadDevices: () => devices, requireModule(filename) {
        if (filename === 'ads-client') return { Client: class {} };
        if (filename === 'ads-client/package.json') return { version: '2.1.0' };
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
    assert.deepEqual(fake.calls, ['defaults', 'FuxawADS']);
    await fake.plugins.init();
    assert.deepEqual(fake.calls, ['defaults', 'FuxawADS', 'defaults', 'FuxawADS']);
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
    assert.deepEqual(fake.calls, ['defaults', 'FuxawADS', 'install-default', 'FuxawADS']);
});

test('plugin registry preserves original ADS and manages the separate bundled plugin offline', async () => {
    const fake = engine();
    install('/engine', fake);
    const list = await fake.plugins.getPlugins();
    const ads = list.filter(p => p.type === 'FuxawADS');
    assert.equal(list.find(p=>p.type === 'ADSclient').name, 'ads-client');
    assert.equal(ads.length, 1);
    assert.equal(ads[0].name, '@fuxaw/ads-plugin');
    assert.equal(ads[0].current, '1.0.0');
    assert.equal(ads[0].dinamic, true);
    assert.equal(ads[0].canRemove, true);
    assert.equal(fake.plugins.getPlugin('FuxawADS').name, ads[0].name);
    assert.equal(fake.plugins.getPlugin('ADSclient').name, 'ads-client');
    assert.equal(fake.plugins.getPlugin('Other').name, 'other');
    await fake.plugins.removePlugin(JSON.stringify({ name: '@fuxaw/ads-plugin' }));
    assert.equal((await fake.plugins.getPlugins()).find(p=>p.type === 'FuxawADS').current, '');
    await fake.plugins.addPlugin({ name: '@fuxaw/ads-plugin' });
    assert.equal((await fake.plugins.getPlugins()).find(p=>p.type === 'FuxawADS').current, '1.0.0');
    await fake.plugins.removePlugin('ads-client');
    assert.deepEqual(fake.calls, ['FuxawADS', 'FuxawADS', 'remove-default']);
});

test('plugin removal survives engine restart while original registration stays available', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ads-plugin-state-'));
    try {
        const settings = { settingsFile: path.join(dir, 'settings.js') };
        const first = engine(); install('/engine', first); await first.plugins.init(settings);
        await first.plugins.removePlugin('@fuxaw/ads-plugin');
        const restarted = engine(); install('/engine', restarted); await restarted.plugins.init(settings);
        const list = await restarted.plugins.getPlugins();
        assert.equal(list.find(p => p.type === 'FuxawADS').current, '');
        assert.equal(list.find(p => p.type === 'ADSclient').current, '2.1.0');
        await restarted.plugins.addPlugin('@fuxaw/ads-plugin');
        assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'fuxaw-ads-plugin.json'))).enabled, true);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('failed engine initialization does not activate the driver', async () => {
    const fake = engine('1.3.4', true);
    install('/engine', fake);
    await assert.rejects(fake.plugins.init(), /init failed/);
    assert.deepEqual(fake.calls, ['defaults']);
});
