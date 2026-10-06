'use strict';
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const readline = require('node:readline');
const path = require('node:path');

class NativeBridge extends EventEmitter {
    constructor({ spawnProcess = spawn, executable = path.join(__dirname, 'bin', 'AdsBridge.exe'), timeout = 10000 } = {}) {
        super();
        this.spawnProcess = spawnProcess;
        this.executable = executable;
        this.timeout = timeout;
        this.pending = new Map();
        this.nextId = 1;
        this.queue = Promise.resolve();
        this.child = null;
        this.closing = false;
    }

    async open() {
        if (this.child) throw new Error('Native ADS bridge is already open.');
        this.closing = false;
        return new Promise((resolve, reject) => {
            let ready = false;
            let stderr = '';
            let child;
            const fail = error => {
                clearTimeout(timer);
                if (!ready) reject(error);
                for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
                this.pending.clear();
                if (this.child === child) this.child = null;
                if (ready && !this.closing) this.emit('failure', error);
            };
            const timer = setTimeout(() => {
                fail(new Error('Native ADS helper did not start within the timeout.'));
                child?.kill();
            }, this.timeout);
            try {
                child = this.spawnProcess(this.executable, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
                this.child = child;
            } catch (error) { fail(error); return; }
            child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
            child.on('error', fail);
            child.stdin.on('error', fail);
            child.on('exit', (code, signal) => fail(new Error(`Native ADS helper exited (${code ?? signal}): ${stderr.trim()}`)));
            const lines = readline.createInterface({ input: child.stdout });
            child.on('exit', () => lines.close());
            lines.on('line', line => {
                let message;
                try { message = JSON.parse(line); }
                catch { fail(new Error('Invalid response from native ADS helper.')); child.kill(); return; }
                if (!ready && message.ready) {
                    ready = true;
                    clearTimeout(timer);
                    resolve(message);
                    return;
                }
                const entry = this.pending.get(message.id);
                if (!entry) return;
                clearTimeout(entry.timer);
                this.pending.delete(message.id);
                if (message.error) {
                    const error = new Error(message.error);
                    error.adsError = { errorCode: message.errorCode, errorStr: message.error };
                    entry.reject(error);
                } else entry.resolve(message);
            });
        });
    }

    request(message) {
        // The native router port handles one synchronous call at a time. Queue before
        // starting each timeout so a symbol upload cannot expire following requests.
        const execute = () => new Promise((resolve, reject) => {
            if (!this.child || this.closing) return reject(new Error('Native ADS helper is not connected.'));
            const id = this.nextId++;
            const child = this.child;
            const timer = setTimeout(() => {
                const error = new Error('Native ADS request timed out.');
                this.pending.delete(id);
                reject(error);
                child.kill();
            }, this.timeout);
            this.pending.set(id, { resolve, reject, timer });
            child.stdin.write(JSON.stringify({ ...message, id }) + '\n');
        });
        const result = this.queue.then(execute);
        this.queue = result.catch(() => {});
        return result;
    }

    async close() {
        if (!this.child) return;
        const child = this.child;
        try { await this.request({ method: 'close' }); }
        finally { this.closing = true; child.stdin.end(); child.kill(); if (this.child === child) this.child = null; }
    }
}
module.exports = { NativeBridge };
