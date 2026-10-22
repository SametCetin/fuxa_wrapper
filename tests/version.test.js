'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('four-part release version supports another release in the same month', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fuxaw-version-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.copyFileSync(path.join(__dirname, '../scripts/set-version.js'), path.join(root, 'scripts/set-version.js'));
  const pkg = { name: 'fuxaw', version: '26.1.10', fullVersion: '26.1.10.14', build: { buildVersion: '26.1.10.14' } };
  const lock = { name: 'fuxaw', version: '26.1.10', packages: { '': { name: 'fuxaw', version: '26.1.10' } } };
  const put = (name, value) => fs.writeFileSync(path.join(root, name), JSON.stringify(value, null, 2) + '\n');
  const get = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
  put('package.json', pkg); put('package-lock.json', lock);
  for (const [full, semver] of [['26.1.10.22', '26.1.10'], ['26.1.11.1', '26.1.11']]) {
    const result = spawnSync(process.execPath, [path.join(root, 'scripts/set-version.js'), full], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(get('package.json').fullVersion, full);
    assert.equal(get('package.json').build.buildVersion, full);
    assert.equal(get('package.json').version, semver);
    assert.equal(get('package-lock.json').version, semver);
    assert.equal(get('package-lock.json').packages[''].version, semver);
  }
});
