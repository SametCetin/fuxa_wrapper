'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { installDimensionCommit } = require('../src/main/editorDimensions');

function editor(input) {
  const events = [];
  const handlers = {};
  const document = {
    activeElement: input,
    addEventListener(name, handler, capture) { handlers[name] = { handler, capture }; },
  };
  const window = {
    __fxw: {},
    jQuery(element) { return { trigger(name) { events.push({ element, name }); } }; },
  };
  vm.runInNewContext(`(${installDimensionCommit.toString()})()`, {
    window, document, setInterval() {}, clearInterval() {},
  });
  return { window, document, events, handlers };
}

test('boyut girdisi çizim alanı seçimi değişmeden önce editöre uygulanır', () => {
  for (const id of ['htmlctrl_width', 'htmlctrl_height']) {
    const input = { id, value: '120.5' };
    const { handlers, events } = editor(input);
    assert.equal(handlers.mousedown.capture, true);
    handlers.mousedown.handler({ target: { id: 'svgcanvas' } });
    assert.deepEqual(events, [{ element: input, name: 'change' }]);
  }
});

test('kaydet odak değişmeden bekleyen boyutu uygular', () => {
  const input = { id: 'htmlctrl_width', value: '200' };
  const { window, events } = editor(input);
  window.__fxw.commitDimensions();
  assert.deepEqual(events, [{ element: input, name: 'change' }]);
});

test('alan içinde tıklama, diğer alanlar ve geçersiz boyutlar uygulanmaz', () => {
  const input = { id: 'htmlctrl_width', value: '200' };
  const { handlers, events } = editor(input);
  handlers.mousedown.handler({ target: input });
  assert.equal(events.length, 0);
  for (const value of ['', ' ', '0', '-2', 'NaN', 'Infinity']) {
    const e = editor({ id: 'htmlctrl_height', value });
    e.window.__fxw.commitDimensions();
    assert.equal(e.events.length, 0);
  }
  for (const input of [null, { id: 'selected_x', value: '20' }, { id: 'tag-name', value: '200' }]) {
    const e = editor(input);
    e.window.__fxw.commitDimensions();
    assert.equal(e.events.length, 0);
  }
});
