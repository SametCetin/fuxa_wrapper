'use strict';
// Paketlenmiş uygulamada gömülü FUXA + Node.js'in ("runtime") yeri.
//   Kurulumsuz paket / eski kurulum:  resources/fuxa + resources/node
//   NSIS kurulumu:                    %ProgramData%\fuxaw-runtime\<kimlik>\{fuxa,node}  (kimlik: resources/fuxaw-runtime.json)
// Kurulum runtime'ı yalnız o kimlik yoksa açar ve en son .complete yazar (installer/nsis-runtime.nsh,
// scripts/after-pack.js). .complete olmayan klasör yarım kalmış sayılır.

const fs = require('node:fs');
const path = require('node:path');

/**
 * @returns {{dir: string}|{missing: string}} dir: fuxa/ ve node/ klasörlerini içeren kök
 */
function locateRuntime({ resourcesPath, programData = process.env.PROGRAMDATA || 'C:\\ProgramData', exists = fs.existsSync, readFile = fs.readFileSync } = {}) {
  if (exists(path.join(resourcesPath, 'fuxa'))) return { dir: resourcesPath };
  let id;
  try {
    ({ id } = JSON.parse(readFile(path.join(resourcesPath, 'fuxaw-runtime.json'), 'utf8')));
  } catch {
    return { missing: path.join(resourcesPath, 'fuxa') };
  }
  if (typeof id !== 'string' || !/^[\w.-]+$/.test(id)) return { missing: path.join(resourcesPath, 'fuxaw-runtime.json') };
  const dir = path.join(programData, 'fuxaw-runtime', id);
  return exists(path.join(dir, '.complete')) ? { dir } : { missing: dir };
}

module.exports = { locateRuntime };
