'use strict';

// FUXA 1.3.4: aynı /device sayfasındaki şema ve tag listesi arasında geçiş.
// Yalnız DOM kontrollerini kullanır; paket dosyaları ve Angular servisleri değişmez.
function readDeviceSelection() {
  const select = [...document.querySelectorAll('mat-select')].find(e => e.getClientRects().length);
  return select ? select.textContent.trim() : null;
}

async function openDevicePage(tags, preferredName) {
  const visible = e => e && e.getClientRects().length;
  for (let i = 0; i < 80; i++) {
    const select = [...document.querySelectorAll('mat-select')].find(visible);
    if (select) {
      if (tags && select.textContent.trim()) return;
      const back = [...document.querySelectorAll('button')].find(b => visible(b) && b.textContent.trim() === 'arrow_back');
      if (back) { back.click(); if (!tags) return; }
    } else {
      const devices = [...document.querySelectorAll('.node-device, .main-device')].filter(visible);
      if (devices.length) {
        if (!tags) return;
        const device = preferredName
          ? devices.find(d => d.querySelector('.device-header')?.textContent.trim() === preferredName)
          : devices[0];
        const list = device?.querySelector('.device-list');
        if (list) { list.click(); return; }
      }
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Bağlantı/tag ekranı açılamadı. Editörü yenileyip tekrar dene.');
}

module.exports = { readDeviceSelection, openDevicePage };
