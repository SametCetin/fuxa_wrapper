'use strict';
// Yerel ajan kanalının araç tanımları (MCP tools/list). Bağımlılıksız: köprü (bridge.js)
// paketlenmiş halde uygulama dışında, uygulamayla gelen Node ile çalışır.
// İşleyiciler ana süreçte: src/main/agentTools.js.
//
// Ajanın yaptığı değişiklikler açık projeye canlı uygulanır ve tasarımcının penceresinde
// hemen görünür; dosyaya yazılmaz (proje "kaydedilmedi" olur, Kaydet tasarımcının işidir).

const INSTRUCTIONS = [
  'fuxaw masaüstü uygulamasında açık olan HMI projesini (FUXA 1.3.4 proje yapısı) canlı düzenler.',
  'Değişiklikler tasarımcının penceresinde hemen görünür ama dosyaya yazılmaz; kaydetmek tasarımcının işidir.',
  'Önce get_project_info ile projeye bak; bir ekranı değiştirmeden önce get_view (include_svg: true) ile mevcut yapısını oku.',
  'Ekran: items nesnesindeki her anahtar svgcontent içindeki bir SVG öğesinin id\'sidir (önekler: HXB_ buton, HXT_ switch, VAL_ değer, HXI_ input, svg_ şekil).',
  'Butonun tag\'e yazması property.events ile olur (onSetValue, actparam "1"/"0", actoptions.variable.variableId). Boolean ADS tag\'ine "toggle" ya da True/False yazma; 1/0 yaz.',
  'Script\'lerde tag id yerine adla eriş: $getTag($getTagId(\'<tag>\', \'<bağlantı>\')), await $setTag(...).',
  'Her değişiklikten sonra lint ile kontrol et.',
].join('\n');

const ref = (what) => ({ type: 'string', description: `${what} id'si ya da adı` });

const TOOLS = [
  {
    name: 'get_project_info',
    description: 'Açık projenin özeti: ad, dosya, bağlantı ortamı, kaydedilmemiş değişiklik var mı, ekranlar, bağlantılar (tag sayısıyla), script\'ler ve kontrol (lint) özeti.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_view',
    description: 'Bir ekranın tam tanımı (items, variables, profile). include_svg ile çizim (svgcontent) de gelir.',
    inputSchema: {
      type: 'object',
      properties: { view: ref('Ekran'), include_svg: { type: 'boolean', default: false } },
      required: ['view'],
      additionalProperties: false,
    },
  },
  {
    name: 'put_view',
    description: 'Ekran ekler ya da günceller: id verilirse id ile, verilmezse ad ile eşlenir; eşleşme yoksa yeni ekran. Verilmeyen svgcontent/items/profile mevcut ekrandan korunur; yeni ekranda boş çizim kullanılır. Ad başka bir ekranla aynı olamaz.',
    inputSchema: {
      type: 'object',
      properties: {
        view: {
          type: 'object',
          description: 'FUXA ekran nesnesi: {id?, name, profile?, items?, variables?, svgcontent?}',
          properties: { id: { type: 'string' }, name: { type: 'string' } },
          required: ['name'],
        },
        show: { type: 'boolean', default: true, description: 'Değişiklikten sonra ekranı tasarımcının editöründe aç' },
      },
      required: ['view'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_view',
    description: 'Ekranı siler.',
    inputSchema: { type: 'object', properties: { view: ref('Ekran') }, required: ['view'], additionalProperties: false },
  },
  {
    name: 'show_view',
    description: 'Ekranı tasarımcının editöründe açar (ne yaptığını göstermek için).',
    inputSchema: { type: 'object', properties: { view: ref('Ekran') }, required: ['view'], additionalProperties: false },
  },
  {
    name: 'list_tags',
    description: 'Tag tablosu: bağlantı, ad, id, tip, adres ve kullanıldığı yerler. Filtreler isteğe bağlı.',
    inputSchema: {
      type: 'object',
      properties: {
        device: ref('Bağlantı'),
        search: { type: 'string', description: 'Ad/adres içinde aranacak metin' },
        unused_only: { type: 'boolean', default: false },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'add_tag',
    description: 'Bağlantıya yeni tag ekler. ADS için address PLC değişken yolu (ör. MAIN.bStart), type ör. Boolean/Number/String. Bağlantının sürücüsü yeniden başlar.',
    inputSchema: {
      type: 'object',
      properties: {
        device: ref('Bağlantı'),
        name: { type: 'string' },
        type: { type: 'string' },
        address: { type: 'string' },
        description: { type: 'string' },
        init: { type: 'string', description: 'Sunucu içi tag için başlangıç değeri' },
      },
      required: ['device', 'name', 'type'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_tag_values',
    description: 'Tag\'lerin canlı değerleri (PLC bağlıysa). Tag adı ya da id verilebilir.',
    inputSchema: {
      type: 'object',
      properties: { tags: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 200 } },
      required: ['tags'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_script',
    description: 'Script\'in kodu ve ayarları.',
    inputSchema: { type: 'object', properties: { script: ref('Script') }, required: ['script'], additionalProperties: false },
  },
  {
    name: 'put_script',
    description: 'Script ekler ya da günceller: id verilirse id ile, verilmezse ad ile eşlenir; eşleşme yoksa yeni. Varsayılan mode SERVER. Verilmeyen alanlar mevcut script\'ten korunur.',
    inputSchema: {
      type: 'object',
      properties: {
        script: {
          type: 'object',
          description: '{id?, name, code, parameters?, mode?: "SERVER"|"CLIENT", sync?}',
          properties: { id: { type: 'string' }, name: { type: 'string' }, code: { type: 'string' } },
          required: ['name'],
        },
      },
      required: ['script'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_script',
    description: 'Script\'i siler.',
    inputSchema: { type: 'object', properties: { script: ref('Script') }, required: ['script'], additionalProperties: false },
  },
  {
    name: 'lint',
    description: 'Proje kontrolü: bilinen tuzaklar ve kırık tag/script referansları (HATA varsa publish yapılmaz).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

module.exports = { INSTRUCTIONS, TOOLS };
