'use strict';
// ADS sembol seçici: tip eşleme, içe aktarma planı, bağlantı ayarları ve çevrimdışı lint.
// Temsilî canlı TwinCAT sembol metadata örneği tests/fixtures altında tutulur.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ads = require('../src/core/adsSymbols');
const model = require('../src/core/model');
const i18n = require('../src/core/i18n');
const { lint, ERROR, WARN } = require('../src/core/lint');

const live = require(path.join(__dirname, 'fixtures', 'ads-symbols-live.json'));

const withLanguage = (lang, fn) => {
  const prev = i18n.getLanguage();
  i18n.setLanguage(lang);
  try { return fn(); } finally { i18n.setLanguage(prev); }
};

test('TwinCAT ilkel tipleri FUXA tag tiplerine eşlenir', () => {
  const map = (type, adsType) => ads.classifySymbol({ type, adsDataTypeStr: adsType });
  assert.deepEqual([map('BOOL', 'ADST_BIT').tagType, map('BIT', 'ADST_BIT').tagType], ['Boolean', 'Boolean']);
  assert.equal(map('UINT', 'ADST_UINT16').tagType, 'Number');
  assert.equal(map('UDINT', 'ADST_UINT32').tagType, 'Number');
  assert.equal(map('LREAL', 'ADST_REAL64').tagType, 'Number');
  assert.equal(map('TIME', 'ADST_UINT32').tagType, 'Number');
  assert.equal(map('OTCID', 'ADST_UINT32').tagType, 'Number');
  assert.equal(map('STRING(80)', 'ADST_STRING').tagType, 'String');
  assert.equal(map('WSTRING(80)', 'ADST_WSTRING').tagType, 'String');
  // Enum values are objects in the current driver, not plain numbers.
  assert.equal(map('Tc2_System.E_WATCHDOG_TIME_CONFIG', 'ADST_INT16').supported, false);
});

test('dizi ve yapılar sessizce içe aktarılmaz', () => {
  const array = ads.classifySymbol({ type: 'ARRAY [0..10000] OF BOOL', adsDataTypeStr: 'ADST_BIT' });
  assert.deepEqual([array.supported, array.reason], [false, 'unsupported-array']);
  assert.equal(ads.classifySymbol({ type: 'ARRAY [0..2] OF LREAL', adsDataTypeStr: 'ADST_REAL64' }).reason, 'unsupported-array');
  assert.equal(ads.classifySymbol({ type: 'Tc2_Standard.TON', adsDataTypeStr: 'ADST_BIGTYPE' }).reason, 'unsupported-struct');
  assert.equal(ads.classifySymbol({ type: 'T_Unknown' }).reason, 'unsupported-struct');
  assert.equal(ads.classifySymbol({ type: '', adsDataTypeStr: 'ADST_BIGTYPE' }).reason, 'unsupported-struct');
});

test('baştaki noktalı global adlar grup varsaymaz, ad aynen korunur', () => {
  assert.equal(ads.symbolGroup('.AlarmAck'), '');
  assert.equal(ads.symbolGroup('Global_Variables.P_0_IDN'), 'Global_Variables');
  assert.equal(ads.symbolGroup('PRG_TC294.Step'), 'PRG_TC294');
  assert.equal(ads.symbolTagName('.AlarmAck'), '.AlarmAck');
  const used = new Set(['motor']);
  assert.equal(ads.symbolTagName('Motor', used), 'Motor_2');
});

test('sembol seçimi mevcut tagleri, id ve diğer cihaz alanlarını korur', () => {
  const device = {
    id: 'd1', name: 'PLC', type: 'FuxawADS', polling: 100, property: { address: '192.168.1.136.1.1:851' },
    tags: {
      t_old: { id: 't_old', name: 'Motor', type: 'Boolean', address: 'GENERAL.Motor', daq: { enabled: false } },
      t_same: { id: 't_same', name: '.AktifParca', type: 'Number', address: 'OLD.Address' },
    },
  };
  const before = JSON.stringify(device);
  let n = 0;
  const idFor = () => String(++n).padStart(16, '0');
  const symbols = [
    { name: '.AlarmAck', type: 'BOOL', adsDataTypeStr: 'ADST_BIT', comment: ' Ack ' },
    { name: '.AktifParca', type: 'UINT', adsDataTypeStr: 'ADST_UINT16' },
    { name: 'GENERAL.Motor', type: 'BOOL', adsDataTypeStr: 'ADST_BIT' }, // adres zaten var
    { name: '.Alarm', type: 'ARRAY [0..10000] OF BOOL', adsDataTypeStr: 'ADST_BIT' },
    { name: 'General_PRG._tonAlmAck', type: 'Tc2_Standard.TON', adsDataTypeStr: 'ADST_BIGTYPE' },
    { name: '.AlarmAck', type: 'BOOL', adsDataTypeStr: 'ADST_BIT' }, // aynı seçim iki kez
  ];
  const plan = ads.planSymbolImport(device, symbols, { idFor });
  assert.equal(JSON.stringify(device), before, 'kaynak cihaz değişmez');
  assert.equal(plan.device.tags.t_old.id, 't_old');
  assert.equal(plan.device.tags.t_old.daq.enabled, false);
  assert.equal(plan.device.property.address, '192.168.1.136.1.1:851');
  assert.deepEqual(plan.added.map((a) => a.name), ['.AlarmAck', '.AktifParca_2']);
  assert.deepEqual(plan.added.map((a) => a.address), ['.AlarmAck', '.AktifParca']);
  assert.deepEqual(plan.added.map((a) => a.type), ['Boolean', 'Number']);
  assert.equal(plan.device.tags[plan.added[0].id].description, 'Ack');
  assert.deepEqual(plan.skipped.map((s) => s.reason),
    ['duplicate-address', 'unsupported-array', 'unsupported-struct', 'duplicate-address']);
});

test('ADS cihazı olmayan hedefe sembol aktarılmaz', () => {
  assert.ok(ads.planSymbolImport({ type: 'FuxaServer', tags: {} }, []).errors);
});

test('canlı örnek (küçültülmüş): desteklenen/desteklenmeyen sayıları', () => {
  const infos = live.map(ads.symbolInfo);
  const supported = infos.filter((s) => s.supported);
  assert.equal(infos.length, 15);
  assert.equal(supported.length, 11);
  assert.deepEqual(infos.filter((s) => s.reason === 'unsupported-array').map((s) => s.name),
    ['.Alarm', 'GV_Parameters.PerData', 'HMI.CalibrationPos']);
  assert.deepEqual(infos.filter((s) => s.reason === 'unsupported-struct').map((s) => s.name),
    ['General_PRG._tonAlmAck']);
  assert.equal(infos.find((s) => s.name === '.AlarmAck').tagType, 'Boolean');
  assert.equal(infos.find((s) => s.name === '.C_DEFAULT_PERSISTENT_PATH').tagType, 'String');
  assert.equal(infos.find((s) => s.name === 'TwinCAT_SystemInfoVarList._TaskOid_FastTask').tagType, 'Number');
  assert.equal(infos.find((s) => s.name === 'CUTSTA_PRG.UNLSTA1').group, 'CUTSTA_PRG');
  assert.equal(infos.find((s) => s.name === '.AlarmAck').group, '');
});

test('sembol okuma ayar hatası ile bağlantı hatasını ayırır (PLC gerekmez)', async () => {
  const { browseDeviceSymbols } = require('../src/main/adsBrowse');
  await assert.rejects(
    browseDeviceSymbols({ property: { address: '' } }, { modules: {} }),
    (error) => error.reason === 'config');
  class FailingClient {
    async connect() { throw new Error('no PLC'); }
    async disconnect() {}
  }
  await assert.rejects(
    browseDeviceSymbols({ property: { address: '192.168.1.136.1.1:851', adsTransport: 'tcp' } },
      { modules: { ads: { Client: FailingClient }, createNativeClient: () => FailingClient } }),
    (error) => error.reason === 'connect' && error.message.includes('no PLC'));
  class OkClient extends FailingClient {
    async connect() {}
    async getSymbols() {
      return [{ name: '.AlarmAck', type: 'BOOL', adsDataTypeStr: 'ADST_BIT' },
        { name: '.Alarm', type: 'ARRAY [0..10] OF BOOL', adsDataTypeStr: 'ADST_BIT' }];
    }
  }
  // Özgün ADSclient her zaman TCP kullanır; kalan adsTransport=native yok sayılır.
  class NeverNative { constructor() { throw new Error('native transport used'); } }
  const result = await browseDeviceSymbols(
    { type: 'ADSclient', property: { address: '192.168.1.136.1.1:851', adsTransport: 'native' } },
    { modules: { ads: { Client: OkClient }, createNativeClient: () => NeverNative } });
  assert.equal(result.transport, 'tcp');
  assert.equal(result.address, '192.168.1.136.1.1:851');
  assert.deepEqual(result.symbols.map((s) => [s.name, s.supported, s.tagType]),
    [['.AlarmAck', true, 'Boolean'], ['.Alarm', false, null]]);
});

test('ADS bağlantı seçenekleri sürücüyle aynı adres kurallarını kullanır', () => {
  const native = ads.adsConnectOptions({ address: '192.168.1.136.1.1:851', adsTransport: 'native' });
  assert.equal(native.transport, 'native');
  assert.deepEqual(native.options, { targetAmsNetId: '192.168.1.136.1.1', targetAdsPort: 851 });
  const tcp = ads.adsConnectOptions({ address: '192.168.1.136.1.1', port: 851 });
  assert.equal(tcp.transport, 'tcp');
  assert.equal(tcp.options.targetAdsPort, 851);
  const local = ads.adsConnectOptions({ address: '192.168.1.136.1.1:851', adsTransport: 'native',
    local: '192.168.1.20.1.1:32750', router: '192.168.1.10:48898' });
  assert.equal(local.options.localAmsNetId, '192.168.1.20.1.1');
  assert.equal(local.options.localAdsPort, 32750);
  assert.equal(local.options.routerAddress, '192.168.1.10');
  assert.equal(local.options.routerTcpPort, 48898);
  assert.equal(ads.adsConnectOptions({ address: '' }).error, 'address');
  assert.equal(ads.adsConnectOptions({ address: '999.1.1.1.1.1:851' }).error, 'address');
  assert.equal(ads.adsConnectOptions({ address: '1.2.3.4.5.6:0' }).error, 'address');
  assert.equal(ads.adsConnectOptions({ address: '1.2.3.4.5.6:851', adsTransport: 'udp' }).error, 'transport');
  assert.equal(ads.adsConnectOptions({ address: '1.2.3.4.5.6:851', local: 'bad' }).error, 'local');
  assert.equal(ads.adsConnectOptions({ address: '1.2.3.4.5.6:851', router: 'host:99999' }).error, 'router');
});

function project(devices, views = []) {
  return { devices: Object.fromEntries(devices.map((d) => [d.id, d])), hmi: { views } };
}

test('lint: ADS bağlantı ayarı, tag tipi ve yinelenen sembol adresi', () => {
  const devices = [
    { id: 'd1', name: 'PLC', type: 'FuxawADS', property: { address: '192.168.1.136.1.1:851', adsTransport: 'native' },
      tags: {
        t1: { id: 't1', name: 'A', type: 'Boolean', address: 'GENERAL.A' },
        t2: { id: 't2', name: 'B', type: 'Number', address: 'GENERAL.A' },
        t3: { id: 't3', name: 'C', type: 'Weird', address: '' },
      } },
    { id: 'd2', name: 'Bad', type: 'ADSclient', property: { address: '999.1.1.1.1.1:851' }, tags: {} },
    { id: 'd3', name: 'NoPort', type: 'FuxawADS', property: { address: '192.168.1.10.1.1' }, tags: {} },
    { id: 'd4', name: 'NoTransport', type: 'FuxawADS', property: { address: '192.168.1.10.1.1:851' }, tags: {} },
  ];
  const found = lint(model.splitProject(project(devices)));
  const has = (level, needle) => found.some((f) => f.level === level && f.message.includes(needle));
  assert.ok(has(ERROR, '999.1.1.1.1.1'), 'geçersiz adres');
  assert.ok(has(WARN, '30012'), 'port yok uyarısı');
  assert.ok(has(WARN, 'ADS-TCP'), 'yöntem seçilmemiş uyarısı');
  assert.ok(has(ERROR, 'Weird'), 'desteklenmeyen tag tipi');
  assert.ok(has(ERROR, 'boş'), 'boş tag adresi');
  assert.ok(has(WARN, 'GENERAL.A'), 'yinelenen sembol adresi');
  assert.ok(!found.some((f) => f.where.includes('PLC / A') && f.level === ERROR), 'geçerli tag hata vermez');
});

test('lint: Boolean yazma hatası yalnız özgün ADS sürücüsünü engeller', () => {
  const devices = [{ id: 'd1', name: 'PLC', type: 'FuxawADS', property: { address: '192.168.1.136.1.1:851', adsTransport: 'native' },
    tags: { t1: { id: 't1', name: 'Lamp', type: 'Boolean', address: 'GENERAL.Lamp' } } }];
  const views = [{ id: 'v1', name: 'Main', items: { g1: { id: 'g1', name: 'Btn',
    property: { events: [{ type: 'click', action: 'onToggleValue', actoptions: { variable: { variableId: 't1' } } }] } } } }];
  const found = withLanguage('en', () => lint(model.splitProject(project(devices, views))));
  assert.ok(!found.some((f) => f.message.includes('Boolean ADS tag')));
  devices[0].type = 'ADSclient';
  const original = withLanguage('en', () => lint(model.splitProject(project(devices, views))));
  assert.ok(original.some(f => f.message.includes('Boolean ADS tag') && f.message.includes('toggle')));
});


test('BigInt, Date ve enum değerleri Number olarak içe aktarılmaz', () => {
  for (const type of ['LINT', 'ULINT', 'LWORD', 'LTIME', 'DATE', 'DT', 'DATE_AND_TIME', 'LDT']) {
    assert.equal(ads.classifySymbol({ type, adsDataTypeStr: 'ADST_UINT64' }).supported, false, type);
  }
  assert.equal(ads.classifySymbol({ type: 'MyEnum', adsDataTypeStr: 'ADST_INT16' }).supported, false);
});

test('ADS adresleri büyük küçük harf farkıyla yinelenmez', () => {
  const device = { id: 'd1', name: 'PLC', type: 'FuxawADS', property: { address: '1.2.3.4.5.6:851', adsTransport: 'native' },
    tags: { t1: { id: 't1', name: 'Old', type: 'Boolean', address: '.alarmack' } } };
  const plan = ads.planSymbolImport(device, [{ name: '.AlarmAck', type: 'BOOL' }]);
  assert.equal(plan.added.length, 0);
  assert.equal(plan.skipped[0].reason, 'duplicate-address');
  device.tags.t2 = { id: 't2', name: 'Alias', type: 'Boolean', address: '.AlarmAck' };
  assert.ok(lint(model.splitProject(project([device]))).some(f => f.level === WARN && f.message.includes('.AlarmAck')));
});

test('ayrı port alanı geçersiz olduğunda listeleme ve lint ayar hatası döndürür', () => {
  for (const port of [-1, 65536, 1.5, 'wrong']) {
    const property = { address: '1.2.3.4.5.6', port, adsTransport: 'tcp' };
    assert.equal(ads.adsConnectOptions(property).error, 'port');
    assert.ok(lint(model.splitProject(project([{ id: 'd', type: 'FuxawADS', name: 'PLC', property, tags: {} }]))).some(f => f.level === ERROR));
  }
});

test('bağlantı zaman aşımından sonra açılan geç bağlantı da kapatılır', async () => {
  const { browseDeviceSymbols } = require('../src/main/adsBrowse');
  let closes = 0;
  class LateClient {
    constructor(options) { assert.equal(options.autoReconnect, false); }
    async connect() { await new Promise(resolve => setTimeout(resolve, 30)); }
    async disconnect() { closes++; }
  }
  await assert.rejects(browseDeviceSymbols({ property: { address: '1.2.3.4.5.6:851' } },
    { timeoutMs: 5, modules: { ads: { Client: LateClient } } }), e => e.reason === 'connect');
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(closes, 2);
});
