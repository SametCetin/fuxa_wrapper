'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

function driver({ blocked, invalid = [] } = {}) {
    let client;
    class Client extends EventEmitter {
        constructor() { super(); client = this; this.connection = { connected: false }; this.topics = []; this.writes = []; }
        async connect() { this.connection.connected = true; this.emit('connect', { targetAmsNetId: '1.2.3.4.5.6' }); return { targetAmsNetId: '1.2.3.4.5.6' }; }
        async subscribeValue(topic, callback) {
            this.topics.push(topic);
            if (blocked) await blocked;
            if (invalid.includes(topic)) throw new Error('Symbol not found');
            callback({ value: topic === 'MAIN.Number' ? 42 : false, timestamp: new Date() }, { symbol: { name: topic } });
        }
        async unsubscribeAll() {}
        async disconnect() { this.connection.connected = false; this.emit('disconnect', false); }
        async writeValue(address, value) { this.writes.push({ address, value }); }
    }
    const data = { name: 'PLC', type: 'ADSclient', property: { address: '1.2.3.4.5.6:851' }, tags: {
        bool: { id: 'bool', address: 'MAIN.Bool', type: 'Boolean' },
        number: { id: 'number', address: 'MAIN.Number', type: 'Number' },
        duplicate: { id: 'duplicate', address: 'MAIN.Bool', type: 'Boolean' },
    } };
    const events = new EventEmitter();
    const statuses = [];
    const errors = [];
    events.on('device-status:changed', event => statuses.push(event.status));
    const sandbox = { module: { exports: {} }, console, require: name => {
        if (name === 'ads-client') return { Client };
        if (name === './native/client') return { createNativeClient: () => Client };
        if (name === '../../utils') return { isNullOrUndefined: value => value === undefined || value === null };
        if (name === '../device-utils') return {
            tagValueCompose: async (value, oldValue, tag) => { assert.ok(tag?.type, 'tag must be the third argument'); return value; },
            tagRawCalculator: async value => value,
        };
        throw new Error('Unexpected import: ' + name);
    } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../index.js'), 'utf8'), sandbox);
    const comm = sandbox.module.exports.create(data, { info() {}, warn() {}, error: error => errors.push(error) }, events);
    return { comm, statuses, errors, get client() { return client; } };
}

test('connection waits for subscriptions, deduplicates addresses and stays connected', async () => {
    let release;
    const setup = driver({ blocked: new Promise(resolve => { release = resolve; }) });
    let done = false;
    const connecting = setup.comm.connect().then(() => { done = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(done, false);
    assert.ok(!setup.statuses.includes('connect-ok'));
    release();
    await connecting;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(setup.comm.isConnected(), true);
    assert.equal(setup.comm.getStatus(), 'connect-ok');
    assert.deepEqual(setup.client.topics, ['MAIN.Bool', 'MAIN.Number']);
    await setup.comm.polling();
    assert.equal(setup.comm.getValue('number').value, 42);
    assert.equal(setup.comm.getValue('bool').value, false);
    await setup.comm.disconnect();
});

test('an invalid symbol keeps other valid tags working', async () => {
    const setup = driver({ invalid: ['MAIN.Number'] });
    await setup.comm.connect();
    await setup.comm.polling();
    assert.equal(setup.comm.getStatus(), 'connect-ok');
    assert.equal(setup.comm.getValue('bool').value, false);
    assert.equal(setup.comm.getValue('number').value, null);
    assert.equal(setup.errors.length, 1);
    await setup.comm.disconnect();
});

test('a device with no valid subscriptions reports connection failure', async () => {
    const setup = driver({ invalid: ['MAIN.Bool', 'MAIN.Number'] });
    await assert.rejects(setup.comm.connect(), /Symbol not found/);
    assert.equal(setup.comm.isConnected(), false);
    assert.equal(setup.comm.getStatus(), 'connect-error');
});

test('Boolean conversions preserve false and zero for uppercase project tag types', async () => {
    const setup = driver();
    await setup.comm.connect();
    for (const value of [false, 'false', '0', 0]) await setup.comm.setValue('bool', value);
    for (const value of [true, 'true', '1', 1]) await setup.comm.setValue('bool', value);
    assert.deepEqual(setup.client.writes.map(write => write.value), [false, false, false, false, true, true, true, true]);
    const count = setup.client.writes.length;
    await setup.comm.setValue('bool', 'maybe');
    assert.equal(setup.client.writes.length, count);
    assert.ok(setup.errors.some(error => String(error).includes('Invalid ADS Boolean')));
    await setup.comm.disconnect();
});

test('connection loss clears raw values so later polls cannot publish stale data', async () => {
    const setup = driver();
    await setup.comm.connect();
    await setup.comm.polling();
    assert.equal(setup.comm.getValue('number').value, 42);
    setup.client.connection.connected = false;
    setup.client.emit('disconnect', true);
    await setup.comm.polling();
    assert.equal(setup.comm.getValue('number').value, null);
    assert.equal(setup.comm.getStatus(), 'connect-error');
});
