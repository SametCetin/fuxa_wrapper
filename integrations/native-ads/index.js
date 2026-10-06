'use strict';
const path = require('node:path');
const { createDriver } = require('./adsclient');
const manifest = require('./package.json');
const installed = new WeakSet();

/** Register a bundled driver through the engine's loader after its own plugins initialize. */
function install(engineRoot, { requireModule = require } = {}) {
    const engine = requireModule(path.join(engineRoot, 'package.json'));
    if (!manifest.fuxawPlugin.engineVersions.includes(engine.version)) {
        throw new Error(`ADS eklentisi editör bileşeni ${engine.version} için doğrulanmadı.`);
    }
    const plugins = requireModule(path.join(engineRoot, 'runtime/plugins'));
    const devices = requireModule(path.join(engineRoot, 'runtime/devices/device'));
    if (typeof plugins.init !== 'function' || typeof devices.loadPlugin !== 'function') {
        throw new Error('Editör bileşeninin ADS eklenti yükleyicisi uyumlu değil.');
    }
    if (installed.has(plugins)) return;
    const driver = createDriver({
        utils: requireModule(path.join(engineRoot, 'runtime/utils')),
        deviceUtils: requireModule(path.join(engineRoot, 'runtime/devices/device-utils')),
        ads: requireModule('ads-client'),
    });
    // A module filename works with the engine's public loadPlugin(type, module) API.
    // Configure this instance only within the engine process; no engine files are written.
    const driverPath = require.resolve('./driver-entry');
    require('./driver-entry').configure(driver);
    const initialize = plugins.init;
    const register = () => devices.loadPlugin(manifest.fuxawPlugin.type, driverPath);
    plugins.init = async function (...args) {
        const result = await initialize.apply(this, args);
        await register();
        args[1]?.info('ADS eklentisi çevrimdışı yüklendi.');
        return result;
    };
    // Installing a built-in ADS dependency from the settings page can reload its
    // default driver. Keep the bundled driver selected after that operation too.
    if (typeof plugins.addPlugin === 'function') {
        const add = plugins.addPlugin;
        plugins.addPlugin = async function (...args) {
            const result = await add.apply(this, args);
            await register();
            return result;
        };
    }
    installed.add(plugins);
}

module.exports = { install };
