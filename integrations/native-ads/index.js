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
    if (['init', 'getPlugins', 'getPlugin', 'addPlugin', 'removePlugin'].some(key => typeof plugins[key] !== 'function') ||
        typeof devices.loadPlugin !== 'function') {
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
    const descriptor = () => ({ name: manifest.name, module: driverPath,
        type: manifest.fuxawPlugin.type, version: manifest.version, current: manifest.version,
        group: 'connection-device', dinamic: false, canRemove: false, bundled: true,
        description: 'Uygulamayla gelen ADS sürücüsü · Yerel TwinCAT / ADS-TCP' });
    const isBundled = plugin => [manifest.name, 'ads-client'].includes(
        typeof plugin === 'string' ? plugin : plugin?.name) || plugin?.type === manifest.fuxawPlugin.type;
    const list = plugins.getPlugins;
    if (typeof list === 'function') plugins.getPlugins = async function (...args) {
        const result = await list.apply(this, args);
        return [...result.filter(p => p.type !== manifest.fuxawPlugin.type), descriptor()];
    };
    const get = plugins.getPlugin;
    if (typeof get === 'function') plugins.getPlugin = function (type) {
        return type === manifest.fuxawPlugin.type ? descriptor() : get.call(this, type);
    };
    plugins.init = async function (...args) {
        const result = await initialize.apply(this, args);
        await register();
        args[1]?.info('ADS eklentisi çevrimdışı yüklendi.');
        return result;
    };
    // Other plugin installs may reload defaults; always restore our ADS driver.
    // The bundled package/dependency itself is managed by application updates.
    if (typeof plugins.addPlugin === 'function') {
        const add = plugins.addPlugin;
        plugins.addPlugin = async function (...args) {
            if (isBundled(args[0])) return descriptor();
            const result = await add.apply(this, args);
            await register();
            return result;
        };
    }
    const remove = plugins.removePlugin;
    if (typeof remove === 'function') plugins.removePlugin = function (...args) {
        if (isBundled(args[0])) return Promise.reject(new Error('Uygulamayla gelen ADS sürücüsü kaldırılamaz.'));
        return remove.apply(this, args);
    };
    installed.add(plugins);
}

module.exports = { install };
