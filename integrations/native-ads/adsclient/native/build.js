'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function build() {
    if (process.platform !== 'win32' || process.arch !== 'x64') {
        throw new Error('The native ADS bridge requires Windows x64.');
    }
    const compiler = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
    const output = path.join(__dirname, 'bin', 'AdsBridge.exe');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    execFileSync(compiler, ['/nologo', '/target:exe', '/platform:x64', '/optimize+',
        '/r:System.Web.Extensions.dll', `/out:${output}`, path.join(__dirname, 'AdsBridge.cs')], {
        stdio: 'inherit', windowsHide: true,
    });
    return output;
}
if (require.main === module) console.log(build());
module.exports = { build };
