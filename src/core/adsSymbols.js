'use strict';
// TwinCAT ADS sembol listesi (ads-client getSymbols) ile çalışan çevrimdışı yardımcılar:
// tip eşleme, seçim planı ve bağlantı ayarları. Burada ağa/PLC'ye erişilmez; liste ana süreçte okunur.
//
// getSymbols yalnız dışa aktarılan üst düzey sembolleri döndürür; dizi ve yapı (struct) üyeleri
// kendiliğinden gelmez. Bu yüzden dizi/yapı sembolleri sessizce içe aktarılmaz, atlanır (reason).

const ADS_DEVICE_TYPES = new Set(['ADSclient', 'FuxawADS']);

// TwinCAT 3 ilkel tipleri → FUXA ADS tag tipi (editörün tip anahtarları).
const PRIMITIVE_TYPES = new Map([
  ['BOOL', 'Boolean'], ['BIT', 'Boolean'],
  ['BYTE', 'Number'], ['WORD', 'Number'], ['DWORD', 'Number'],
  ['SINT', 'Number'], ['USINT', 'Number'], ['INT', 'Number'], ['UINT', 'Number'],
  ['DINT', 'Number'], ['UDINT', 'Number'],
  ['REAL', 'Number'], ['LREAL', 'Number'], ['OTCID', 'Number'],
  ['TIME', 'Number'], ['TOD', 'Number'], ['TIME_OF_DAY', 'Number'],
  ['STRING', 'String'], ['WSTRING', 'String'],
]);

// ads-client returns 64-bit values as BigInt, dates as Date and enums as objects.
// Those values cannot be imported as scalar Number tags with the existing drivers.
// Do not infer a supported value shape solely from the storage ADS data type.
function symbolAddressKey(value) { return String(value || '').trim().toLowerCase(); }

function isAdsDevice(device) {
  return ADS_DEVICE_TYPES.has(device && device.type);
}

/** 'STRING(80)' → 'STRING'; boyut/aralık parantezi eşlemede yok sayılır. */
function baseType(type) {
  return String(type || '').trim().replace(/\s*\(.*\)$/, '').toUpperCase();
}

function isArraySymbol(symbol) {
  return /^ARRAY\b/i.test(String(symbol && symbol.type || '').trim())
    || Number(symbol && symbol.arrayDimension) > 0
    || (Array.isArray(symbol && symbol.arrayInfo) && symbol.arrayInfo.length > 0);
}

/**
 * Sembolü sınıflandırır: {supported: true, tagType, baseType} ya da
 * {supported: false, reason: 'unsupported-array'|'unsupported-struct'|'unsupported-type'}.
 */
function classifySymbol(symbol) {
  const type = String(symbol && symbol.type || '').trim();
  const adsType = String(symbol && (symbol.adsType || symbol.adsDataTypeStr) || '').trim().toUpperCase();
  if (isArraySymbol(symbol)) return { supported: false, reason: 'unsupported-array', type, adsType };
  let tagType = PRIMITIVE_TYPES.get(baseType(type));
  if (!tagType) {
    return { supported: false, reason: adsType === 'ADST_BIGTYPE' || (type && !adsType) ? 'unsupported-struct' : 'unsupported-type', type, adsType };
  }
  return { supported: true, tagType, type, adsType, baseType: baseType(type) };
}

/** Grup: ilk noktaya kadar önek. '.AlarmAck' gibi baştaki noktalı global değişkenlerin grubu yoktur. */
function symbolGroup(name) {
  const n = String(name || '');
  if (!n || n.startsWith('.')) return '';
  const i = n.indexOf('.');
  return i > 0 ? n.slice(0, i) : '';
}

/** getSymbols() öğesinden arayüzün kullanacağı sade bilgi. */
function symbolInfo(symbol) {
  const info = classifySymbol(symbol);
  return {
    name: String(symbol && symbol.name || ''),
    type: String(symbol && symbol.type || ''),
    adsType: String(symbol && symbol.adsDataTypeStr || ''),
    comment: String(symbol && symbol.comment || '').trim(),
    group: symbolGroup(symbol && symbol.name),
    supported: info.supported,
    tagType: info.supported ? info.tagType : null,
    reason: info.supported ? null : info.reason,
  };
}

/** Sembolden tag adı: ad aynen korunur (FUXA tag adlarında nokta serbest), yalnız @ yasak. */
function symbolTagName(name, used = new Set()) {
  let base = String(name || '').trim().replace(/@/g, '_');
  if (!base) base = 'symbol';
  let out = base;
  let i = 2;
  while (used.has(out.toLowerCase())) out = `${base}_${i++}`;
  used.add(out.toLowerCase());
  return out;
}

/**
 * Seçilen sembolleri cihaza ekler. Mevcut tag'ler, id'leri ve diğer alanlar korunur;
 * kaynak cihaz değiştirilmez. Aynı adres zaten varsa o sembol atlanır.
 * symbols: [{name, type, adsType?, comment?}], idFor: test için sabit üretici.
 */
function planSymbolImport(device, symbols, { idFor } = {}) {
  if (!isAdsDevice(device)) return { errors: ['device-type'] };
  // lint → adsSymbols → tags → lint döngüsünü yükleme anında kapatmamak için tembel require.
  const { newTagId } = require('./tags');
  const updated = JSON.parse(JSON.stringify(device));
  updated.tags = updated.tags || {};
  const usedNames = new Set(Object.values(updated.tags).map((tag) => String(tag.name || '').toLowerCase()));
  const addresses = new Set(Object.values(updated.tags).map((tag) => symbolAddressKey(tag.address)));
  const added = [];
  const skipped = [];
  for (const symbol of Array.isArray(symbols) ? symbols : []) {
    const name = String(symbol && symbol.name || '').trim();
    if (!name) { skipped.push({ name, reason: 'invalid-name' }); continue; }
    const info = classifySymbol(symbol);
    if (!info.supported) { skipped.push({ name, reason: info.reason }); continue; }
    if (addresses.has(symbolAddressKey(name))) { skipped.push({ name, reason: 'duplicate-address' }); continue; }
    const id = newTagId(updated.tags, idFor);
    const tag = {
      id, name: symbolTagName(name, usedNames), type: info.tagType, address: name,
      daq: { enabled: false, interval: 60, changed: false, restored: false },
      description: String(symbol.comment || '').trim() || null,
    };
    updated.tags[id] = tag;
    addresses.add(symbolAddressKey(name));
    added.push({ id: tag.id, name: tag.name, address: tag.address, type: tag.type });
  }
  return { device: updated, added, skipped };
}

/** '192.168.1.136.1.1:851' → {netId, port} (port yoksa null). Geçersizse null. */
function validNetId(value) {
  return /^\d{1,3}(?:\.\d{1,3}){5}$/.test(String(value || '')) && String(value).split('.').every((part) => Number(part) <= 255);
}
function validPort(value) {
  return /^\d{1,5}$/.test(String(value || '')) && Number(value) >= 1 && Number(value) <= 65535;
}
function parseAdsAddress(value) {
  const text = String(value || '').trim();
  const m = /^(\d{1,3}(?:\.\d{1,3}){5})(?::(\d{1,5}))?$/.exec(text);
  if (!m || !validNetId(m[1])) return null;
  const port = m[2] === undefined ? null : Number(m[2]);
  if (port !== null && !validPort(port)) return null;
  return { netId: m[1], port };
}

/**
 * FUXA cihaz property'sinden ADS istemci seçenekleri. Sürücünün connect() mantığıyla aynıdır,
 * ancak bağlantı kurmaz. Dönüş: {transport, address, options} ya da {error}.
 */
function adsConnectOptions(property) {
  const prop = property || {};
  const parsed = parseAdsAddress(prop.address);
  if (!parsed) return { error: 'address' };
  const transport = prop.adsTransport === undefined || prop.adsTransport === '' ? 'tcp' : prop.adsTransport;
  if (transport !== 'tcp' && transport !== 'native') return { error: 'transport' };
  if (parsed.port === null && prop.port !== undefined && prop.port !== '' && !validPort(prop.port)) return { error: 'port' };
  const options = {
    targetAmsNetId: parsed.netId,
    targetAdsPort: parsed.port || Number(prop.port) || 30012,
  };
  if (prop.local) {
    const [netId, port, ...extra] = String(prop.local).split(':');
    if (extra.length || !validNetId(netId) || (port !== undefined && !validPort(port))) return { error: 'local' };
    options.localAmsNetId = netId;
    options.localAdsPort = port ? Number(port) : 32750;
  }
  if (prop.router) {
    const [host, port, ...extra] = String(prop.router).split(':');
    if (!/^[a-zA-Z0-9._-]+$/.test(host || '') || extra.length || (port !== undefined && !validPort(port))) return { error: 'router' };
    options.routerAddress = host;
    options.routerTcpPort = port ? Number(port) : 48898;
  }
  return { transport, address: `${parsed.netId}:${options.targetAdsPort}`, options };
}

module.exports = {
  ADS_DEVICE_TYPES, PRIMITIVE_TYPES, symbolAddressKey, isAdsDevice, baseType, isArraySymbol,
  classifySymbol, symbolGroup, symbolInfo, symbolTagName, planSymbolImport, parseAdsAddress, adsConnectOptions,
};
