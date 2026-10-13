'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { installEditorTagClear } = require('../src/main/editorTagClear');

const engine = path.resolve(__dirname, '../fuxa-runtime/node_modules/@frangoteam/fuxa');
test('servis edilen tag seçicileri boşaltılınca kimliği kaldırır; paket dosyası korunur',
  { skip: !fs.existsSync(path.join(engine, 'main.js')) }, () => {
    const engineRequire = require('node:module').createRequire(path.join(engine, 'main.js'));
    const express = engineRequire('express');
    const original = express.static;
    const dist = path.join(engine, 'dist');
    const bundle = fs.readdirSync(dist).find(name => /^main\.[\w]+\.js$/.test(name));
    const before = fs.readFileSync(path.join(dist, bundle), 'utf8');
    const restore = installEditorTagClear(engine);
    let patched;
    try {
      const middleware = express.static(dist);
      const response = { type() { return this; }, set() { return this; }, send(text) { patched = text; } };
      middleware({ method: 'GET', path: '/' + bundle }, response, () => assert.fail('bundle was not intercepted'));
    } finally { restore(); }
    assert.equal(express.static, original);
    assert.equal(fs.readFileSync(path.join(dist, bundle), 'utf8'), before);
    const methods = [...patched.matchAll(/onChanged\(\)\{if\(typeof this.tagFilter.value==="string"/g)].map(match => {
      const end = patched.indexOf('onBindTag(){', match.index);
      return patched.slice(match.index, end);
    });
    assert.equal(methods.length, 2);
    for (const method of methods) {
      const onChanged = vm.runInNewContext('(' + method.replace('onChanged()', 'function()') + ')', {
        an: { e4: { id: '@' }, $d: { getTagFromTagId: (_devices, id) => id ? { id, name: 'Tag' } : null } },
      });
      for (const input of ['', '   ', 'Tag arama', { id: 't_old' }, '@placeholder']) {
        const emissions = [];
        const selector = { tagFilter: { value: input }, variableId: 't_old', value: {}, deviceTagValue: {},
          data: { devices: {} }, devices: [], onchange: { emit: value => emissions.push(value) }, valueChange: { emit() {} } };
        onChanged.call(selector);
        assert.equal(emissions.length, 1);
        const expected = typeof input === 'string' && !input.trim() ? null : input === '@placeholder' ? '@placeholder' : 't_old';
        assert.equal(emissions[0].variableId, expected);
        if (expected === null) assert.equal(emissions[0].variableRaw, null);
      }
    }
  });
