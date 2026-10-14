'use strict';
// fuxaw yaması: npm ile kurulmuş FUXA 1.3.4'ün main.js'ine eklenen tek satır bunu çağırır
//   try { require('./fuxaw/hook')(__dirname); } catch (e) { ... } // fuxaw-yama
// FUXA'nın başka dosyası değişmez; iki ek çalışan süreçte, bellekte yüklenir:
//   1. ADS (fuxaw) sürücüsü: Yerel TwinCAT köprüsü / ADS-TCP, okuma aralığı cihazın Polling değeri.
//   2. Editörün bağlantı penceresinde ADS (fuxaw) tipi ve Bağlantı yöntemi alanı.

const path = require('node:path');

module.exports = function install(engineDir) {
  const pluginDir = path.join(__dirname, 'native-ads');
  const { installEditorTagClear } = require('./editorTagClear');
  installEditorTagClear(engineDir, require(path.join(pluginDir, 'editor.js')).patchEditor, { tagClear: false });
  require(pluginDir).install(engineDir);
};
