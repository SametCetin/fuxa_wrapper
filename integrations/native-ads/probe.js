'use strict';
// Read-only probe: no PLC writes, control commands, or project changes.
const fs = require('node:fs');
const path = require('node:path');
const { createNativeClient } = require('./adsclient/native/client');
function arg(name) { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; }
async function probe() {
    const projectFile = arg('--project');
    if (!projectFile) throw new Error('Kullanım: npm run probe:ads -- --project <proje.fxprj>');
    const project = JSON.parse(fs.readFileSync(projectFile, 'utf8'));
    const device = Object.values((project.project || project).devices).find(device => device.type === 'ADSclient');
    if (!device) throw new Error('No ADS device in project.');
    const [netId, port] = device.property.address.split(':');
    const modulePath = arg('--ads-module') || path.join(process.env.APPDATA || '', 'fuxaw', 'fuxa', '_pkg', 'runtime', 'node_modules', 'ads-client');
    const ads = require(path.resolve(modulePath));
    const Client = createNativeClient(ads);
    const client = new Client({ targetAmsNetId: netId, targetAdsPort: Number(port) || device.property.port || 851 });
    client.on('client-error', error => console.error(error.message));
    try {
        console.log('Connection:', await client.connect());
        console.log('PLC state:', await client.readState());
        const failures = [];
        for (const tag of Object.values(device.tags || {})) {
            try {
                const result = await client.readValue(tag.address);
                console.log(`${tag.name} [${tag.address}] = ${String(result.value)}`);
            } catch (error) { failures.push(tag.address); console.error(`${tag.name}: ${error.message}`); }
        }
        const symbols = await client.getSymbols();
        console.log('Symbols:', Object.keys(symbols).length);
        if (failures.length) throw new Error(`${failures.length} tag(s) could not be read.`);
        const samples = [];
        const first = Object.values(device.tags || {})[0];
        if (first) {
            const sub = await client.subscribeValue(first.address, data => samples.push(data), 1000, false);
            await new Promise(resolve => setTimeout(resolve, 2200));
            await sub.unsubscribe();
            if (samples.length < 3) throw new Error('Polling did not produce three samples.');
            console.log('Polling samples:', samples.length);
        }
    } finally { await client.disconnect(); }
}
if (require.main === module) probe().catch(error => { console.error(error); process.exitCode = 1; });
