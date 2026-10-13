'use strict';
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

// Engine 1.3.4 has a fixed dispatcher. Extend its module in memory with an
// independent slot; leave the original ADS variable, loader and files intact.
function loadDevices(engineRoot) {
    const filename = path.join(engineRoot, 'runtime/devices/device.js');
    if (require.cache[filename]) throw new Error('ADS eklentisi cihaz yöneticisinden önce yüklenmeli.');
    let source = fs.readFileSync(filename, 'utf8');
    const replace = (before, after) => {
        if (source.split(before).length !== 2) throw new Error('ADS eklenti yükleme noktası değişmiş.');
        source = source.replace(before, after);
    };
    replace("var ADSclient = require('./adsclient');", "var ADSclient = require('./adsclient');\nvar FuxawADS;");
    replace('} else if (data.type === DeviceEnum.GPIO) {',
        '} else if (data.type === DeviceEnum.FuxawADS) {\nif (!FuxawADS) return null;\ncomm = FuxawADS.create(data, logger, events, manager, runtime);\n} else if (data.type === DeviceEnum.GPIO) {');
    replace('} else if (type === DeviceEnum.GPIO) {',
        '} else if (type === DeviceEnum.FuxawADS) {\nFuxawADS = module ? require(module) : null;\n} else if (type === DeviceEnum.GPIO) {');
    replace("ADSclient: 'ADSclient',", "ADSclient: 'ADSclient',\nFuxawADS: 'FuxawADS',");
    const adapted = new Module(filename, module);
    adapted.filename = filename;
    adapted.paths = Module._nodeModulePaths(path.dirname(filename));
    require.cache[filename] = adapted;
    try { adapted._compile(source, filename); adapted.loaded = true; }
    catch (error) { delete require.cache[filename]; throw error; }
    return adapted.exports;
}
module.exports = { loadDevices };
