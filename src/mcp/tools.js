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
    name: 'add_widgets',
    description: 'Ekrana hazır öğeler ekler; bilinen tuzaklardan kaçınır, items ve SVG\'yi birlikte doğru kurar. Elle buton/lamba kurmak yerine bunu tercih et. '
      + 'Şablonlar: momentary (basılıyken 1, bırakınca 0), set (tıklayınca value yazar; Boolean\'a sadece 1/0), '
      + 'toggle (Boolean tag\'i server script ile tersine çevirir; script yoksa oluşturulur), lamp (Boolean\'a göre renk değiştiren yuvarlak), '
      + 'value (sayı göstergesi, fraction_digits), label (sabit metin). Konum/boyut piksel; ekran genelde 1024x768.',
    inputSchema: {
      type: 'object',
      properties: {
        view: ref('Ekran'),
        widgets: {
          type: 'array',
          minItems: 1,
          maxItems: 100,
          items: {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: ['momentary', 'set', 'toggle', 'lamp', 'value', 'label'] },
              tag: { type: 'string', description: 'Tag adı ya da id\'si (label hariç gerekli)' },
              device: { type: 'string', description: 'Tag adı birden çok bağlantıda varsa bağlantı adı' },
              feedback_tag: { type: 'string', description: 'Buton rengi için okunacak tag (varsayılan: tag)' },
              x: { type: 'number' },
              y: { type: 'number' },
              width: { type: 'number' },
              height: { type: 'number' },
              text: { type: 'string', description: 'Buton yazısı / label metni' },
              name: { type: 'string' },
              value: { type: ['string', 'number'], description: 'set için yazılacak değer (varsayılan 1)' },
              fraction_digits: { type: 'integer' },
              font_size: { type: 'number' },
              colors: {
                type: 'object',
                description: 'Renkler (#rrggbb ya da #rrggbbaa): off = 0 iken, on = 1 iken, text = buton yazısı',
                properties: { off: { type: 'string' }, on: { type: 'string' }, text: { type: 'string' } },
                additionalProperties: false,
              },
            },
            required: ['kind', 'x', 'y'],
          },
        },
        show: { type: 'boolean', default: true },
      },
      required: ['view', 'widgets'],
      additionalProperties: false,
    },
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
