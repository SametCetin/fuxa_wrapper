'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

function prepare() {
    const localRequire = createRequire(path.join(__dirname, 'package.json'));
    const ads = localRequire('ads-client/package.json');
    if (ads.version !== '2.1.0') throw new Error('ADS eklentisinin bağımlılık sürümü uyumlu değil.');
    if (process.platform === 'win32' && process.arch === 'x64') {
        require('./adsclient/native/build').build();
        if (!fs.existsSync(path.join(__dirname, 'adsclient/native/bin/AdsBridge.exe'))) {
            throw new Error('ADS eklentisinin yerel bileşeni hazırlanamadı.');
        }
    }
    console.log('ADS eklentisi çevrimdışı paketleme için hazır.');
}
if (require.main === module) prepare();
module.exports = { prepare };
