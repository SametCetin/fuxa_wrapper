'use strict';
const path = require('node:path');
const { createDriver } = require('./adsclient');
const manifest = require('./package.json');
const installed = new WeakSet();
const fs = require('node:fs');

/** Register a bundled driver through the engine's loader after its own plugins initialize. */
function install(engineRoot, { requireModule = require, loadDevices = require('./device-loader').loadDevices } = {}) {
    const engine = requireModule(path.join(engineRoot, 'package.json'));
    if (!manifest.fuxawPlugin.engineVersions.includes(engine.version)) {
        throw new Error(`ADS eklentisi editör bileşeni ${engine.version} için doğrulanmadı.`);
    }
    const pluginFile = path.join(engineRoot, 'runtime/plugins');
    // install() is idempotent, including the in-memory dispatcher extension.
    const cached = require.cache[requireModule === require ? require.resolve(pluginFile) : ''];
    if (cached && installed.has(cached.exports)) return;
    const devices = loadDevices(engineRoot);
    const plugins = requireModule(pluginFile);
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
    // The scoped engine's catalog scans its own node_modules, whereas npm may
    // hoist this dependency. Report the package the original driver resolves.
    const engineRequire = requireModule === require
        ? require('node:module').createRequire(path.join(engineRoot, 'main.js')) : requireModule;
    let originalAdsVersion = '';
    try { originalAdsVersion = engineRequire('ads-client/package.json').version; } catch { }
    const originalDescriptor = plugin => plugin?.name === 'ads-client' && !plugin.current && originalAdsVersion
        ? { ...plugin, current: originalAdsVersion, canRemove: false } : plugin;
    let enabled = true;
    let stateFile;
    const register = () => devices.loadPlugin(manifest.fuxawPlugin.type, enabled ? driverPath : null);
    const descriptor = () => ({ name: manifest.name, module: driverPath,
        type: manifest.fuxawPlugin.type, version: manifest.version, current: enabled ? manifest.version : '',
        group: 'connection-device', dinamic: true, canRemove: enabled, bundled: true,
        description: 'Uygulamayla gelen ADS sürücüsü · Yerel TwinCAT / ADS-TCP' });
    const isBundled = plugin => {
        if (typeof plugin === 'string' && plugin.startsWith('{')) {
            try { plugin = JSON.parse(plugin); } catch { return false; }
        }
        return (typeof plugin === 'string' ? plugin : plugin?.name) === manifest.name || plugin?.type === manifest.fuxawPlugin.type;
    };
    const setEnabled = async value => {
        if (stateFile) fs.writeFileSync(stateFile, JSON.stringify({ enabled: value }) + '\n');
        enabled = value;
        await require('./driver-entry').setEnabled(value);
        await register();
        return descriptor();
    };
    const list = plugins.getPlugins;
    if (typeof list === 'function') plugins.getPlugins = async function (...args) {
        const result = await list.apply(this, args);
        return [...result.filter(p => p.type !== manifest.fuxawPlugin.type).map(originalDescriptor), descriptor()];
    };
    const get = plugins.getPlugin;
    if (typeof get === 'function') plugins.getPlugin = function (type) {
        return type === manifest.fuxawPlugin.type ? descriptor() : originalDescriptor(get.call(this, type));
    };
    plugins.init = async function (...args) {
        if (args[0]?.settingsFile) {
            stateFile = path.join(path.dirname(args[0].settingsFile), 'fuxaw-ads-plugin.json');
            if (fs.existsSync(stateFile)) enabled = JSON.parse(fs.readFileSync(stateFile, 'utf8')).enabled !== false;
        }
        const result = await initialize.apply(this, args);
        await require('./driver-entry').setEnabled(enabled);
        await register();
        args[1]?.info('ADS eklentisi çevrimdışı yüklendi.');
        return result;
    };
    // Other plugin installs may reload defaults; always restore our ADS driver.
    // The bundled package/dependency itself is managed by application updates.
    if (typeof plugins.addPlugin === 'function') {
        const add = plugins.addPlugin;
        plugins.addPlugin = async function (...args) {
            if (isBundled(args[0])) return setEnabled(true);
            const result = await add.apply(this, args);
            await register();
            return result;
        };
    }
    const remove = plugins.removePlugin;
    if (typeof remove === 'function') plugins.removePlugin = function (...args) {
        if (isBundled(args[0])) return setEnabled(false);
        return remove.apply(this, args);
    };
    installed.add(plugins);
}

module.exports = { install };
