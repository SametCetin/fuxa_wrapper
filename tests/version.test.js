'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { toSemver, fromSemver } = require('../src/core/version');

test('four-part release version supports another release in the same month', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fuxaw-version-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.mkdirSync(path.join(root, 'src/core'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, '../scripts/set-version.js'), path.join(root, 'scripts/set-version.js'));
  fs.copyFileSync(path.join(__dirname, '../src/core/version.js'), path.join(root, 'src/core/version.js'));
  const pkg = { name: 'fuxaw', version: '26.1.10', fullVersion: '26.1.10.14', build: { buildVersion: '26.1.10.14' } };
  const lock = { name: 'fuxaw', version: '26.1.10', packages: { '': { name: 'fuxaw', version: '26.1.10' } } };
  const put = (name, value) => fs.writeFileSync(path.join(root, name), JSON.stringify(value, null, 2) + '\n');
  const get = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
  put('package.json', pkg); put('package-lock.json', lock);
  for (const [full, semver] of [['26.1.10.22', '26.1.10022'], ['26.1.10.23', '26.1.10023'], ['26.1.11.1', '26.1.11001']]) {
    const result = spawnSync(process.execPath, [path.join(root, 'scripts/set-version.js'), full], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(get('package.json').fullVersion, full);
    assert.equal(get('package.json').build.buildVersion, full);
    assert.equal(get('package.json').version, semver);
    assert.equal(get('package-lock.json').version, semver);
    assert.equal(get('package-lock.json').packages[''].version, semver);
  }
});

test('semver eşlemesi sürüm sırasını korur ve geri çevrilir', () => {
  const order = ['26.1.10.14', '26.1.10.22', '26.1.10.100', '26.1.11.1', '26.2.1.1', '27.1.1.1'];
  const sem = order.map(toSemver);
  const key = s => s.split('.').map(Number);
  for (let i = 1; i < sem.length; i++) {
    const [a, b] = [key(sem[i - 1]), key(sem[i])];
    assert.ok(a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2]))), `${sem[i - 1]} < ${sem[i]}`);
  }
  // Eşlemeden önceki kurulumlar (26.1.10) yeni sürümden küçük kalmalı.
  assert.ok(key(toSemver('26.1.10.23'))[2] > 10);
  order.forEach(v => assert.equal(fromSemver(toSemver(v)), v));
  assert.equal(fromSemver('26.1.10'), '26.1.10');
  assert.equal(toSemver('V26.1.10.22'), '26.1.10022');
  assert.throws(() => toSemver('26.1.10'));
  assert.throws(() => toSemver('26.1.10.1000'));
});
