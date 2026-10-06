'use strict';
// Arayüzün ana süreçle konuştuğu tek kapı (contextIsolation + sandbox).
const { contextBridge, ipcRenderer } = require('electron');

const call = (ch) => (...args) => ipcRenderer.invoke(ch, ...args);

contextBridge.exposeInMainWorld('fxw', {
  state: call('state'),
  newProject: call('new'),
  open: call('open'),
  openRecent: call('open-recent'),
  save: call('save'),
  saveAs: call('save-as'),
  analyze: call('analyze'),
  addTag: call('tag:add'),
  connections: call('connections:list'),
  saveConnection: call('connections:save'),
  otherConnections: call('connections:other'),
  publishPrepare: call('publish:prepare'),
  publishChooseDir: call('publish:choose-dir'),
  publishRun: call('publish:run'),
  reveal: call('reveal'),
  runtime: call('runtime'),
  retryFuxa: call('retry-fuxa'),
  editorBounds: call('editor:bounds'),
  editorVisible: call('editor:visible'),
  onState: (fn) => ipcRenderer.on('state', (_e, s) => fn(s)),
  onCommand: (fn) => ipcRenderer.on('command', (_e, c) => fn(c)),
  onShowTab: (fn) => ipcRenderer.on('show-tab', (_e, t) => fn(t)),
});
