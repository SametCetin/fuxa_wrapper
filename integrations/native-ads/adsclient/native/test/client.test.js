'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createNativeClient } = require('../client');

class BaseClient extends EventEmitter {
    constructor(settings) { super(); this.settings = settings; this.connection = { connected: false }; this.metaData = {}; }
    async readState() { return { adsState: this.state ?? 5, adsStateStr: this.state === 6 ? 'Stop' : 'Run' }; }
    async readPlcUploadInfo() {}
    async readPlcSymbolVersion() { this.onPlcSymbolVersionChanged(Buffer.from([1])); return 1; }
    async getSymbol(name) { return { name }; }
    async readValueBySymbol() { return { value: this.value ?? false }; }
    parseAdsResponse(packet, payload) { return { payload, command: packet.ams.adsCommand }; }
}
class Bridge extends EventEmitter {
    async open() { return { localAmsNetId: '1.2.3.4.5.6', localAdsPort: 32768 }; }
    async close() { this.closed = true; }
    async request(command) { this.last = command; return { data: Buffer.from('sample').toString('base64') }; }
}
const Client = createNativeClient({ Client: BaseClient }, { Bridge, platform: 'win32', arch: 'x64' });
const options = { targetAmsNetId: '6.5.4.3.2.1', targetAdsPort: 851 };

test('connect validates PLC RUN and uses the native router identity', async () => {
    const client = new Client(options);
    try {
        const connection = await client.connect();
        assert.equal(connection.localAdsPort, 32768);
        assert.equal(connection.targetAdsPort, 851);
        assert.equal(connection.connected, true);
        const response = await client.sendAdsCommand({ adsCommand: 2, payload: Buffer.from('read') });
        assert.equal(client.bridge.last.payload, Buffer.from('read').toString('base64'));
        assert.equal(response.ams.sourceAmsAddress.amsNetId, options.targetAmsNetId);
    } finally { await client.disconnect(); }
    assert.equal(client.bridge.closed, true);
});

test('a STOP PLC cannot be reported as connected', async () => {
    const client = new Client(options);
    client.state = 6;
    await assert.rejects(client.connect(), /not RUN/);
    assert.equal(client.connection.connected, false);
    assert.equal(client.bridge.closed, true);
});

test('polling sends initial false, applies change-only mode and stops after unsubscribe', async () => {
    const client = new Client(options);
    const received = [];
    try {
        await client.connect();
        const sub = await client.subscribeValue('MAIN.Bool', (data, subscription) => {
            assert.equal(subscription.symbol.name, 'MAIN.Bool');
            assert.ok(data.timestamp instanceof Date);
            received.push(data.value);
        }, 50, true);
        assert.deepEqual(received, [false]);
        await new Promise(resolve => setTimeout(resolve, 65));
        assert.deepEqual(received, [false]);
        client.value = true;
        await new Promise(resolve => setTimeout(resolve, 65));
        assert.deepEqual(received, [false, true]);
        await sub.unsubscribe();
        client.value = false;
        await new Promise(resolve => setTimeout(resolve, 65));
        assert.deepEqual(received, [false, true]);
    } finally { await client.disconnect(); }
});

test('helper failure clears connection and stops polling callbacks', async () => {
    const client = new Client(options);
    client.on('client-error', () => {});
    let lost;
    client.on('disconnect', value => { lost = value; });
    await client.connect();
    await client.subscribeValue('MAIN.Bool', () => {}, 50, false);
    client.bridge.emit('failure', new Error('helper died'));
    assert.equal(client.connection.connected, false);
    assert.equal(lost, true);
    assert.ok([...client.nativeSubscriptions].every(sub => !sub.active));
    await client.disconnect();
});

test('native selection on an unsupported platform fails before launching anything', async () => {
    const LinuxClient = createNativeClient({ Client: BaseClient }, { Bridge, platform: 'linux', arch: 'x64' });
    await assert.rejects(new LinuxClient(options).connect(), /Windows x64/);
});
