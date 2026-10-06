'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const { NativeBridge } = require('../bridge');

function fakeHelper(onRequest) {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new Writable({ write(chunk, _, done) { onRequest(JSON.parse(chunk.toString()), child); done(); } });
    child.reply = response => child.stdout.write(JSON.stringify(response) + '\n');
    child.kill = () => { child.emit('exit', 0); child.stdout.end(); };
    return child;
}
async function start(child, timeout = 100) {
    const bridge = new NativeBridge({ spawnProcess: () => child, timeout });
    const opening = bridge.open();
    child.reply({ ready: true, localAmsNetId: '1.2.3.4.5.6', localAdsPort: 32000 });
    await opening;
    return bridge;
}

test('queues native requests without losing response ids or ADS errors', async () => {
    const requests = [];
    const child = fakeHelper((request, helper) => {
        requests.push(request);
        if (request.method === 'close') helper.reply({ id: request.id, closed: true });
    });
    const bridge = await start(child);
    const first = bridge.request({ method: 'request', command: 4 });
    const second = bridge.request({ method: 'request', command: 2 });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests.length, 1);
    child.reply({ id: requests[0].id, data: 'AAAAAAUAAAA=' });
    assert.equal((await first).data, 'AAAAAAUAAAA=');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests.length, 2);
    child.reply({ id: requests[1].id, error: 'Symbol not found', errorCode: 1808 });
    await assert.rejects(second, error => error.adsError.errorCode === 1808);
    await bridge.close();
});

test('helper death rejects pending work and prevents queued requests from hanging', async () => {
    const child = fakeHelper(() => {});
    const bridge = await start(child);
    const failures = [];
    bridge.on('failure', error => failures.push(error));
    const first = bridge.request({ method: 'request' });
    const second = bridge.request({ method: 'request' });
    const checking = Promise.all([assert.rejects(first, /exited/), assert.rejects(second, /not connected/)]);
    await new Promise(resolve => setImmediate(resolve));
    child.kill();
    await checking;
    assert.equal(failures.length, 1);
});

test('a timed-out native call terminates the blocked helper', async () => {
    const child = fakeHelper(() => {});
    const bridge = await start(child, 20);
    bridge.on('failure', () => {});
    await assert.rejects(bridge.request({ method: 'request' }), /timed out/);
    assert.equal(bridge.child, null);
});

test('startup failure includes helper stderr and releases its timer', async () => {
    const child = fakeHelper(() => {});
    const bridge = new NativeBridge({ spawnProcess: () => child, timeout: 100 });
    const opening = bridge.open();
    child.stderr.write('Beckhoff x64 TcAdsDll.dll is not installed');
    child.kill();
    await assert.rejects(opening, /TcAdsDll.dll is not installed/);
});
