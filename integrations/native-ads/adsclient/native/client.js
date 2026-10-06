'use strict';
const { isDeepStrictEqual } = require('node:util');
const { NativeBridge } = require('./bridge');

// Keep ads-client's symbol/type parsing and value conversion. Replace only its
// transport and subscriptions. Native subscriptions are polled (no PLC notifications).
function createNativeClient(ads, { Bridge = NativeBridge, platform = process.platform, arch = process.arch } = {}) {
    return class NativeAdsClient extends ads.Client {
        constructor(options) {
            super({ ...options, rawClient: true, autoReconnect: false });
            this.bridge = new Bridge();
            this.nativeSubscriptions = new Set();
            this.healthTimer = null;
            this.nativeClosing = false;
            this.bridge.on('failure', error => this.connectionLost(error));
        }

        async connect() {
            if (platform !== 'win32' || arch !== 'x64') throw new Error('Native ADS requires Windows x64.');
            if (this.connection.connected) throw new Error('Native ADS client is already connected.');
            this.nativeClosing = false;
            try {
                const local = await this.bridge.open();
                this.connection = { connected: true, isLocal: true, localAmsNetId: local.localAmsNetId,
                    localAdsPort: local.localAdsPort, targetAmsNetId: this.settings.targetAmsNetId,
                    targetAdsPort: this.settings.targetAdsPort };
                const state = await this.readState();
                if (state.adsState !== 5) throw new Error(`PLC is not RUN (ADS state: ${state.adsStateStr}).`);
                await this.readPlcUploadInfo();
                await this.readPlcSymbolVersion();
                this.emit('connect', this.connection);
                this.scheduleHealthCheck();
                return this.connection;
            } catch (error) {
                this.connection.connected = false;
                await this.bridge.close().catch(() => {});
                throw error;
            }
        }

        async sendAdsCommand(command) {
            if (!this.connection.connected) throw new Error('Native ADS client is not connected.');
            let response;
            try {
                response = await this.bridge.request({ method: 'request', command: command.adsCommand,
                    netId: command.targetAmsNetId ?? this.settings.targetAmsNetId,
                    port: command.targetAdsPort ?? this.settings.targetAdsPort,
                    payload: (command.payload || Buffer.alloc(0)).toString('base64') });
            } catch (error) {
                // Preserve native error codes through ads-client's ClientError wrapping
                // so its symbol/upload fallback paths continue to work.
                if (error.adsError && ads.ClientError) throw new ads.ClientError(error.message, error.adsError);
                throw error;
            }
            const ams = { adsCommand: command.adsCommand, error: false, errorCode: 0,
                sourceAmsAddress: { amsNetId: command.targetAmsNetId ?? this.settings.targetAmsNetId,
                    adsPort: command.targetAdsPort ?? this.settings.targetAdsPort },
                targetAmsAddress: { amsNetId: this.connection.localAmsNetId, adsPort: this.connection.localAdsPort } };
            return { ams, ads: this.parseAdsResponse({ ams }, Buffer.from(response.data, 'base64')) };
        }

        onPlcSymbolVersionChanged(data) {
            // The TCP implementation asynchronously restores PLC notifications. This
            // adapter owns polling subscriptions and refreshes their symbols itself.
            const previous = this.metaData.plcSymbolVersion;
            this.metaData.plcSymbolVersion = data.readUInt8(0);
            this.emit('plcSymbolVersionChange', this.metaData.plcSymbolVersion, previous);
        }

        scheduleHealthCheck() {
            this.healthTimer = setTimeout(async () => {
                try {
                    const state = await this.readState();
                    if (state.adsState !== 5) throw new Error(`PLC left RUN (ADS state: ${state.adsStateStr}).`);
                    const previous = this.metaData.plcSymbolVersion;
                    const version = await this.readPlcSymbolVersion();
                    if (previous !== undefined && previous !== version) {
                        this.metaData.plcSymbols = {};
                        this.metaData.plcDataTypes = {};
                        this.metaData.allPlcSymbolsCached = false;
                        this.metaData.allPlcDataTypesCached = false;
                        await this.readPlcUploadInfo();
                        for (const sub of this.nativeSubscriptions) sub.symbol = null;
                    }
                    if (this.connection.connected && !this.nativeClosing) this.scheduleHealthCheck();
                } catch (error) { this.connectionLost(error); }
            }, 1000);
        }

        connectionLost(error) {
            if (!this.connection.connected || this.nativeClosing) return;
            this.connection.connected = false;
            clearTimeout(this.healthTimer);
            for (const sub of this.nativeSubscriptions) { sub.active = false; clearTimeout(sub.timer); }
            this.emit('client-error', error);
            this.emit('disconnect', true);
            this.bridge.close().catch(() => {});
        }

        async subscribeValue(path, callback, cycleTime = 1000, sendOnChange = true) {
            const sub = { active: true, symbol: null, timer: null, last: undefined, hasValue: false };
            const sample = async () => {
                if (!sub.active || !this.connection.connected) return;
                sub.symbol = sub.symbol || await this.getSymbol(path);
                const result = await this.readValueBySymbol(sub.symbol);
                if (!sub.active || !this.connection.connected) return;
                if (!sendOnChange || !sub.hasValue || !isDeepStrictEqual(sub.last, result.value)) {
                    sub.last = result.value;
                    sub.hasValue = true;
                    callback({ value: result.value, timestamp: new Date() }, sub);
                }
            };
            const schedule = () => {
                if (!sub.active || !this.connection.connected) return;
                sub.timer = setTimeout(async () => {
                    try { await sample(); }
                    catch (error) { this.emit('client-error', error); }
                    schedule();
                }, Math.max(50, Number(cycleTime) || 1000));
            };
            sub.unsubscribe = async () => { sub.active = false; clearTimeout(sub.timer); this.nativeSubscriptions.delete(sub); };
            this.nativeSubscriptions.add(sub);
            try { await sample(); schedule(); return sub; }
            catch (error) { await sub.unsubscribe(); throw error; }
        }

        async unsubscribeAll() {
            for (const sub of [...this.nativeSubscriptions]) await sub.unsubscribe();
        }

        async disconnect() {
            this.nativeClosing = true;
            clearTimeout(this.healthTimer);
            await this.unsubscribeAll();
            const wasConnected = this.connection.connected;
            this.connection.connected = false;
            await this.bridge.close();
            this.metaData.plcSymbols = {};
            this.metaData.plcDataTypes = {};
            this.metaData.allPlcSymbolsCached = false;
            this.metaData.allPlcDataTypesCached = false;
            if (wasConnected) this.emit('disconnect', false);
        }
    };
}
module.exports = { createNativeClient };
