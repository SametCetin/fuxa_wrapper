# fuxaw yaması (npm ile kurulmuş FUXA 1.3.4 için)

Standart FUXA'ya iki ek getirir:

1. **ADS (fuxaw) sürücüsü:** Beckhoff TwinCAT'e **Yerel TwinCAT (Windows)** köprüsüyle (aynı makinedeki PLC / UM, ya da TwinCAT rotası olan uzak PLC) veya **ADS-TCP** ile bağlanır. Okuma aralığı cihazın **Polling** değeridir (ör. 100 ms).
2. Editörün bağlantı penceresinde **Type → ADS (fuxaw)** ve **Bağlantı yöntemi** alanı.

FUXA'nın kendi dosyalarından sadece `main.js` değişir: başına tek satır eklenir. Yamanın dosyaları FUXA klasörünün içindeki `fuxaw\` alt klasörüne kopyalanır. Özgün **ADSclient** sürücüsüne dokunulmaz. İnternet gerekmez.

## 1. FUXA'yı kur (bir kez)

Node.js 18+ kurulu olmalı. Sonra:

```
npm install -g @frangoteam/fuxa@1.3.4
```

Yama yalnız **1.3.4** sürümünde çalışır; başka sürümde uygulanmaz.

## 2. Yamayı uygula

1. Bu klasörü hedef makineye kopyala.
2. `uygula.cmd`'ye çift tıkla.

FUXA `npm root -g` altında aranır. Başka yerdeyse: `uygula.cmd -FuxaDir "C:\...\node_modules\@frangoteam\fuxa"`.

FUXA çalışıyorsa yama durur. Önce FUXA'yı kapat ya da `uygula.cmd -Durdur` ile çalıştır. Yama bittikten sonra FUXA'yı her zamanki gibi başlat (`fuxa` komutuyla ya da nasıl başlatıyorsan öyle).

**Yamayı güncellemek:** yeni yama klasöründen `uygula.cmd -Durdur` çalıştır, sonra FUXA'yı yeniden başlat.

**FUXA'yı npm ile güncellersen ya da yeniden kurarsan** yama silinir; `uygula.cmd`'yi tekrar çalıştır.

## 3. Projeyi yükle

fuxaw'da **Dosya → Publish** ile üretilen `<ad>.json` dosyasını yükle:

1. FUXA editörü (`http://127.0.0.1:1881/editor`) → ☰ → *Save Project As...* (yedek).
2. ☰ → *Open Project* → `<ad>.json`. Bağlantılar hemen kurulur; yeniden başlatmak gerekmez.

## Geri alma

`geri-al.cmd` (gerekirse `-Durdur`): `main.js`'teki satırı siler ve `fuxaw\` klasörünü kaldırır. Bundan sonra ADS (fuxaw) tipindeki bağlantılar çalışmaz.

## Notlar

- Yerel TwinCAT yöntemi Beckhoff ADS kütüphanesini (`TcAdsDll.dll`) kullanır; bu kütüphane TwinCAT kurulumuyla gelir.
- Yamanın yüklendiğini FUXA günlüğündeki "ADS eklentisi çevrimdışı yüklendi." satırından anlarsın. Yükleme hata verirse FUXA yine açılır; hata "fuxaw yamasi yuklenemedi" diye konsola yazılır.
