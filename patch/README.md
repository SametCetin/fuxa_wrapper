# fuxaw hedef kurulumu (FUXA 1.3.4 + fuxaw yaması)

| Betik | Ne yapar |
| ----- | -------- |
| `install-fuxa.cmd` | Node.js + FUXA 1.3.4'ü internetten kurar, fuxaw yamasını uygular, FUXA'yı başlatır |
| `uninstall-fuxa.cmd` | FUXA'yı durdurup kaldırır; proje ve veriler (`data\`) korunur |
| `download-project.cmd` | **Publish çıktısında** gelir: projeyi çalışan FUXA'ya yükler (önce yedekler) |

`install-fuxa.cmd` hedef makineye tek seferde şunları kurar:

1. **Node.js** (sabit sürüm, nodejs.org'dan indirilir, SHA256 ile doğrulanır)
2. **FUXA 1.3.4** (npm'den, internetten)
3. **fuxaw yaması:**
   - **ADS (fuxaw) sürücüsü:** Beckhoff TwinCAT'e **Yerel TwinCAT (Windows)** köprüsüyle (aynı makinedeki PLC / UM, ya da TwinCAT rotası olan uzak PLC) veya **ADS-TCP** ile bağlanır. Okuma aralığı cihazın **Polling** değeridir (ör. 100 ms).
   - Editörün bağlantı penceresinde **Type → ADS (fuxaw)** ve **Bağlantı yöntemi** alanı.

Kurulum sırasında internet gerekir (nodejs.org, npm, github.com). Paketin içinde sadece yama ve betikler var, Node.js ve FUXA yok. Yönetici yetkisi gerekmez. Sistemdeki Node.js'e ve PATH'e dokunulmaz.

## Kurulum

1. Bu klasörü hedef makineye kopyala.
2. `install-fuxa.cmd`'ye çift tıkla.

Bittiğinde FUXA başlar: `http://127.0.0.1:1881/editor`.

```
C:\ProgramData\fuxa\
├─ node\           Node.js
├─ app\            FUXA (app\node_modules\@frangoteam\fuxa)
├─ data\           proje, ayarlar, veritabanları, günlükler (data\_logs\fuxa.log), proje yedekleri (data\yedek\)
└─ start-fuxa.cmd  FUXA'yı başlatır
```

Sonraki açılışlarda `start-fuxa.cmd` kullanılır. FUXA her zaman `data\` klasörünü kullanır, nereden başlatıldığı fark etmez.

Seçenekler: `install-fuxa.cmd -Hedef D:\fuxa` (başka klasör), `-Port 1882`, `-Baslatma` (kurup başlatmaz), `-Durdur` (çalışan FUXA'yı kapatıp devam eder; yoksa kurulum durur).

**Güncellemek / onarmak:** yeni paketten `install-fuxa.cmd -Durdur`. Doğru sürümde kurulu olanlar atlanır, yama her seferinde yeniden yazılır, `data\` silinmez.

## Projeyi yükle

fuxaw'da **Dosya → Publish** ile üretilen klasörü hedefe kopyala ve içindeki `download-project.cmd`'ye çift tıkla. FUXA'daki mevcut proje `data\yedek\` altına yedeklenir, sonra yeni proje yüklenir. Bağlantılar hemen kurulur; FUXA'yı yeniden başlatmak gerekmez. Geri almak için betiğin sonunda yazdığı komutu çalıştır: `download-project.cmd -Dosya <yedek json>`.

## Kaldırma

`uninstall-fuxa.cmd`: FUXA'yı durdurur; `node\`, `app\` ve `start-fuxa.cmd`'yi siler. `data\` (proje, yedekler) kalır; `install-fuxa.cmd` tekrar çalışınca aynı proje açılır. Tamamen silmek için bundan sonra `C:\ProgramData\fuxa` klasörünü elle sil.

## Notlar

- FUXA'nın kendi dosyalarından sadece `main.js` değişir: başına tek satır eklenir (yedek: `main.js.fuxaw-yedek`). Özgün **ADSclient** sürücüsüne dokunulmaz.
- Kurulum, npm paketlerinin kurulum betiklerini çalıştırmaz. Tek istisna `sqlite3`'ün derlenmiş dosyası: bu dosya ayrıca GitHub'dan indirilir.
- Yerel TwinCAT yöntemi Beckhoff ADS kütüphanesini (`TcAdsDll.dll`) kullanır; bu kütüphane TwinCAT kurulumuyla gelir.
- Yamanın yüklendiğini `data\_logs\fuxa.log` içindeki "ADS eklentisi çevrimdışı yüklendi." satırından anlarsın. Yükleme hata verirse FUXA yine açılır; hata "fuxaw yamasi yuklenemedi" diye konsola yazılır.
