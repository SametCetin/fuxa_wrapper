'use strict';
// Güncelleme: GitHub Releases'teki son sürümü (latest.yml) denetler, kullanıcı onaylarsa indirir,
// kurulumu sessiz NSIS ile yapıp uygulamayı yeniden açar (electron-updater).
//
// - Sadece Windows'ta NSIS ile kurulu pakette çalışır (resources/app-update.yml + kaldırıcı). Kurulumsuz zip'te ve
//   geliştirmede kapalıdır (menü bunu söyler).
// - Açılışta bir kez sessizce denetlenir (ağ yoksa sessiz geçer); Yardım → Güncellemeleri denetle elle.
// - "Sonra" denirse indirilen sürüm uygulama kapanırken kurulur (autoInstallOnAppQuit).
// - FUXAW_UPDATE_URL: test için GitHub yerine bir klasör adresi (latest.yml + setup exe), generic sağlayıcı.

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const { fromSemver } = require('../core/version');
const { t } = require('../core/i18n');

const STARTUP_DELAY_MS = 8000;

/**
 * @param {object} o
 * @param {() => Electron.BrowserWindow|null} o.window
 * @param {(opts: Electron.MessageBoxOptions) => Promise<number>} o.ask  seçilen düğmenin sırası
 * @param {(questionKey: string) => Promise<boolean>} o.confirmDiscard  kaydedilmemiş değişikliği sor
 * @param {() => void} o.beforeInstall  pencere kapatma sorusunu atla
 * @param {string} o.logPath
 */
function createUpdater(o) {
  const log = (...a) => {
    try { fs.appendFileSync(o.logPath, `${new Date().toISOString()} ${a.join(' ')}\n`); } catch { /* günlük yazılamazsa önemsiz */ }
  };
  const feedUrl = process.env.FUXAW_UPDATE_URL;
  // NSIS kurulumu kaldırıcıyı uygulamanın yanına koyar; kurulumsuz zip'te yoktur (orada app-update.yml olsa da güncellenmez).
  const installed = app.isPackaged && process.platform === 'win32'
    && fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'))
    && fs.readdirSync(path.dirname(process.execPath)).some((f) => /^Uninstall .*\.exe$/i.test(f));
  const enabled = !!feedUrl || installed;
  const current = () => fromSemver(app.getVersion());

  let updater = null;
  let state = 'idle'; // idle | checking | downloading | downloaded
  let manual = false;
  let downloaded = null; // indirilen sürüm (dört parçalı)

  function get() {
    if (updater) return updater;
    ({ autoUpdater: updater } = require('electron-updater'));
    updater.logger = { info: (m) => log('info', m), warn: (m) => log('warn', m), error: (m) => log('error', m), debug: () => {} };
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = true;
    if (feedUrl) updater.setFeedURL({ provider: 'generic', url: feedUrl });

    updater.on('update-available', async (info) => {
      const version = fromSemver(info.version);
      const choice = await o.ask({
        type: 'info',
        message: t('update.available', { version }),
        detail: t('update.availableDetail', { current: current() }),
        buttons: [t('update.download'), t('update.later')],
        defaultId: 0, cancelId: 1,
      });
      if (choice !== 0) { state = 'idle'; return; }
      state = 'downloading';
      updater.downloadUpdate().catch(failed);
    });
    updater.on('update-not-available', () => {
      state = 'idle';
      if (manual) o.ask({ type: 'info', message: t('update.none'), detail: t('update.current', { current: current() }), buttons: [t('common.ok')] });
    });
    updater.on('download-progress', (p) => {
      const w = o.window();
      if (w && !w.isDestroyed()) w.setProgressBar(p.percent / 100);
    });
    updater.on('update-downloaded', async (info) => {
      state = 'downloaded';
      downloaded = fromSemver(info.version);
      const w = o.window();
      if (w && !w.isDestroyed()) w.setProgressBar(-1);
      const choice = await o.ask({
        type: 'info',
        message: t('update.ready', { version: downloaded }),
        detail: t('update.readyDetail'),
        buttons: [t('update.restart'), t('update.onQuit')],
        defaultId: 0, cancelId: 1,
      });
      if (choice === 0) await install();
    });
    // Hatalar checkForUpdates/downloadUpdate sözünden de gelir (failed); burada yalnız günlük (dinleyicisiz 'error' süreci düşürür).
    updater.on('error', (e) => log('error', e && (e.message || e)));
    return updater;
  }

  function failed(e) {
    const wasDownloading = state === 'downloading';
    state = 'idle';
    log('error', e && (e.stack || e.message || e));
    const w = o.window();
    if (w && !w.isDestroyed()) w.setProgressBar(-1);
    if (manual || wasDownloading) {
      o.ask({ type: 'warning', message: t('update.failed'), detail: String((e && e.message) || e).slice(0, 600), buttons: [t('common.ok')] });
    }
  }

  async function install() {
    if (!(await o.confirmDiscard('discard.beforeUpdate'))) return;
    o.beforeInstall();
    // Sessiz kurulum, bitince uygulamayı açar. Bileşenler will-quit'te kapanır.
    setImmediate(() => get().quitAndInstall(true, true));
  }

  /** userInitiated: menüden; sonuç ne olursa olsun kullanıcıya söylenir. */
  async function check(userInitiated) {
    if (!enabled) {
      if (userInitiated) o.ask({ type: 'info', message: t('update.unavailable'), detail: t('update.current', { current: current() }), buttons: [t('common.ok')] });
      return;
    }
    if (state === 'downloaded') {
      if (userInitiated) {
        const choice = await o.ask({
          type: 'info', message: t('update.ready', { version: downloaded }), detail: t('update.readyDetail'),
          buttons: [t('update.restart'), t('update.onQuit')], defaultId: 0, cancelId: 1,
        });
        if (choice === 0) await install();
      }
      return;
    }
    if (state !== 'idle') {
      if (userInitiated) o.ask({ type: 'info', message: t('update.busy'), buttons: [t('common.ok')] });
      return;
    }
    manual = !!userInitiated;
    state = 'checking';
    try {
      await get().checkForUpdates();
    } catch (e) {
      failed(e);
    }
  }

  function scheduleStartupCheck() {
    if (enabled) setTimeout(() => check(false), STARTUP_DELAY_MS);
  }

  return { check, scheduleStartupCheck, enabled };
}

module.exports = { createUpdater };
