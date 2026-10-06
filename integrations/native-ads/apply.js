'use strict';
// FUXAW_NATIVE_ADS_OVERLAY_V1 - wrapper-owned adaptation of the bundled engine.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const source = path.join(root, 'integrations', 'native-ads', 'adsclient');
const engine = path.join(root, 'fuxa-runtime', 'node_modules', '@frangoteam', 'fuxa');
const target = path.join(engine, 'runtime', 'devices', 'adsclient');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const original = '6e0423d5451172192515d6fbfd7db22361af1b2579a1b52810acf6355bd161c3';

function apply() {
    const pkg = JSON.parse(fs.readFileSync(path.join(engine, 'package.json'), 'utf8'));
    if (pkg.version !== '1.3.4') throw new Error('Yerel ADS entegrasyonu yalnızca editör bileşeni 1.3.4 için doğrulandı.');
    const current = hash(path.join(target, 'index.js'));
    if (current !== original && current !== hash(path.join(source, 'index.js'))) {
        throw new Error('ADS sürücüsünde başka değişiklikler var; üzerine yazılmadı.');
    }
    if (process.platform === 'win32' && process.arch === 'x64') require(path.join(source, 'native', 'build')).build();
    fs.cpSync(path.join(source, 'native'), path.join(target, 'native'), { recursive: true, filter: file => path.basename(file) !== 'test' });
    fs.copyFileSync(path.join(source, 'index.js'), path.join(target, 'index.js'));
    console.log('Yerel ADS köprüsü editör bileşenine uygulandı.');
}
if (require.main === module) apply();
module.exports = { apply };
