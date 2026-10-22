'use strict';
// ADS sembol listesini okur (yalnız kullanıcı "Sembolleri oku" dediğinde). Motor sürecindeki
// sürücüye dokunmaz; aynı sabitlenmiş ads-client ve yerel köprüyle ayrı, kısa ömürlü bir bağlantı açar.
// Bağlantı hatası ile doğrulama/ayar hatası ayrı kodlarla döner (reason: 'connect' | 'config').

const path = require('node:path');
const { adsConnectOptions, symbolInfo } = require('../core/adsSymbols');
const { t } = require('../core/i18n');

const CONFIG_MESSAGES = {
  address: 'ads.configAddress', port: 'conn.port', transport: 'ads.configTransport', local: 'conn.local', router: 'conn.router',
};

class AdsBrowseError extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); }),
  ]);
}

/** ads-client'ı eklenti klasöründen yükler: paketlenmiş uygulamada resources/plugins/native-ads. */
function loadModules(pluginDir) {
  const ads = require(require.resolve('ads-client', { paths: [pluginDir] }));
  const { createNativeClient } = require(path.join(pluginDir, 'adsclient', 'native', 'client'));
  return { ads, createNativeClient };
}

/**
 * Cihaz yapılandırmasıyla sembolleri okur ve bağlantıyı kapatır.
 * Dönüş: {symbols: [symbolInfo], address}. Hata: AdsBrowseError (reason 'config' ya da 'connect').
 */
async function browseDeviceSymbols(device, { pluginDir, timeoutMs = 30000, modules } = {}) {
  // Özgün ADSclient sürücüsü her zaman TCP kullanır; adsTransport yalnız FuxawADS içindir.
  const property = device && device.type === 'ADSclient'
    ? { ...(device.property || {}), adsTransport: 'tcp' } : device && device.property;
  const cfg = adsConnectOptions(property);
  if (cfg.error) {
    throw new AdsBrowseError('config', t('ads.configFailed', { error: t(CONFIG_MESSAGES[cfg.error] || 'ads.configAddress') }));
  }
  let loaded = modules;
  if (!loaded) {
    try { loaded = loadModules(pluginDir); }
    catch (error) { throw new AdsBrowseError('config', error.message || String(error)); }
  }
  const { ads, createNativeClient } = loaded;
  const Client = cfg.transport === 'native' ? createNativeClient(ads) : ads.Client;
  let client = null;
  try {
    client = new Client({ ...cfg.options, autoReconnect: false });
    // Native health checks may emit this while a symbol upload is in progress.
    if (typeof client.on === 'function') client.on('client-error', () => {});
    const connecting = client.connect();
    try {
      await withTimeout(connecting, timeoutMs, t('ads.connectFailed', { error: 'timeout' }));
    } catch (error) {
      // A late connect must not leave a second socket/router port running.
      connecting.then(() => client.disconnect()).catch(() => {});
      throw error;
    }
    const result = await withTimeout(client.getSymbols(), timeoutMs, t('ads.connectFailed', { error: 'timeout' }));
    const list = Array.isArray(result) ? result : Object.values(result || {});
    return { address: cfg.address, transport: cfg.transport, symbols: list.map(symbolInfo) };
  } catch (error) {
    if (error instanceof AdsBrowseError) throw error;
    throw new AdsBrowseError('connect', error && error.message ? error.message : String(error));
  } finally {
    // Bağlantı zaman aşımına düşse bile kapatma IPC'yi kilitlemesin.
    if (client) await withTimeout(Promise.resolve().then(() => client.disconnect()), 5000, 'disconnect timeout').catch(() => {});
  }
}

module.exports = { AdsBrowseError, browseDeviceSymbols, withTimeout };
