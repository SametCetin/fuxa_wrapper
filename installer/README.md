# fuxaw hedef kurulumu (FUXA 1.3.4 + fuxaw yaması)

| Betik | Ne yapar |
| ----- | -------- |
| `install-fuxa.cmd` | Node.js + FUXA 1.3.4'ü internetten kurar, fuxaw yamasını uygular, FUXA'yı başlatır |
| `uninstall-fuxa.cmd` | FUXA'yı durdurup kaldırır; proje ve veriler (`data\`) korunur |
| `download-<proje>.cmd` | **Publish** üretir (proje içine gömülü): projeyi FUXA'ya yükler (önce yedekler) |

**Her betik tek dosyadır, yanında başka dosya gerekmez.** `install-fuxa.cmd` tek başına bir USB'ye ya da e-postaya konup verilebilir: sürüm bilgisi ve ADS (fuxaw) eklentisi dosyanın içine gömülüdür (~0,6 MB). Çalışınca kendi PowerShell kısmını `%TEMP%`'e çıkarıp çalıştırır, bitince siler.

> Bu klasör (`installer\` repoda) **kaynaktır**, buradan kurulum yapılmaz. Betikler `npm run dist:installer` ile `dist\installer\fuxaw-install-<sürüm>\` altına üretilir; hedefe o dosyalar götürülür. Kaynaklar: `install-fuxa.ps1` (şablon; sürümler ve eklenti paketlemede yazılır), `uninstall-fuxa.ps1`, `hook.js` (eklentinin FUXA'ya bağlandığı nokta). `download-project`'in kaynağı `src/core/target/download-project.ps1`'dir, Publish yazar.

`install-fuxa.cmd` hedef makineye tek seferde şunları kurar:

1. **Node.js** (sabit sürüm, nodejs.org'dan indirilir, SHA256 ile doğrulanır)
2. **FUXA 1.3.4** (npm'den, internetten)
3. **fuxaw yaması:**
   - **ADS (fuxaw) sürücüsü:** Beckhoff TwinCAT'e **Yerel TwinCAT (Windows)** köprüsüyle (aynı makinedeki PLC / UM, ya da TwinCAT rotası olan uzak PLC) veya **ADS-TCP** ile bağlanır. Okuma aralığı cihazın **Polling** değeridir (ör. 100 ms).
   - Editörün bağlantı penceresinde **Type → ADS (fuxaw)** ve **Bağlantı yöntemi** alanı.

Kurulum sırasında internet gerekir (nodejs.org, npm, github.com). Dosyanın içinde sadece yama var, Node.js ve FUXA yok. Yönetici yetkisi gerekmez. Sistemdeki Node.js'e ve PATH'e dokunulmaz.

## Kurulum

1. `install-fuxa.cmd`'yi hedef makineye kopyala (herhangi bir klasöre).
2. Çift tıkla.

Bittiğinde FUXA başlar: `http://127.0.0.1:1881/editor`.

```
C:\ProgramData\fuxa\
├─ node\           Node.js
├─ app\            FUXA (app\node_modules\@frangoteam\fuxa)
├─ data\           proje, ayarlar, veritabanları, günlükler (data\_logs\fuxa.log), proje yedekleri (data\backups\)
├─ browser\        runtime penceresinin Edge profili
├─ start-fuxa.cmd  FUXA'yı arka planda (pencere açmadan) başlatır, runtime view'i açar (-Page editor: editörü)
├─ stop-fuxa.cmd   FUXA'yı durdurur
└─ fuxa-server.cmd FUXA'yı görünür konsolla çalıştırır (arıza ararken; pencere kapanırsa FUXA durur)
```

Kısayollar (kurulumu yapan kullanıcı için):

| Kısayol | Nerede | Açar |
| --- | --- | --- |
| `Start FUXA` | Başlat menüsü → FUXA, masaüstü | FUXA çalışmıyorsa arka planda (pencere açmadan) başlatır; runtime view'i (`http://127.0.0.1:1881/home`) Edge **uygulama penceresinde** (adres çubuğu/sekme yok) açar. Pencere zaten açıksa yenisini açmaz, mevcut pencereyi geri getirip öne alır. Edge yoksa varsayılan tarayıcıda açar |
| `FUXA Editor` | Başlat menüsü → FUXA | FUXA çalışmıyorsa başlatır, editörü (`/editor`) varsayılan tarayıcıda açar |
| `Stop FUXA` | Başlat menüsü → FUXA | `stop-fuxa.cmd`: FUXA'yı durdurur |
| `FUXA Project Folder` | Başlat menüsü → FUXA | `C:\ProgramData\fuxa` (kurulum klasörü; proje `data\` altında) |

Sonraki açılışlarda **Start FUXA** kısayolu (ya da `start-fuxa.cmd`) kullanılır. FUXA penceresiz çalışır; günlükler `data\_logs\fuxa.log` ve `api.log`'da. Durdurmak için **Stop FUXA**. FUXA her zaman `data\` klasörünü kullanır, nereden başlatıldığı fark etmez.

Seçenekler: `install-fuxa.cmd -InstallDir D:\fuxa` (başka klasör), `-Port 1882`, `-NoStart` (kurup başlatmaz), `-Stop` (çalışan FUXA'yı kapatıp devam eder; yoksa kurulum durur).

**Güncellemek / onarmak:** yeni `install-fuxa.cmd -Stop`. Doğru sürümde kurulu olanlar atlanır, yama her seferinde yeniden yazılır, `data\` silinmez.

## Projeyi yükle

fuxaw'da **Dosya → Publish** ile üretilen `download-<proje>.cmd`'yi (ör. `download-Simu_294_35.cmd`; proje içine gömülü, tek dosya) hedefe kopyala ve çift tıkla. FUXA çalışmıyorsa arka planda başlatılır, mevcut proje `data\backups\` altına yedeklenir, sonra yeni proje yüklenir; bağlantılar hemen kurulur, FUXA'yı yeniden başlatmak gerekmez. Son olarak runtime ekranı (Start FUXA penceresi) yeni projeyle yeniden açılır (`-NoView` ile atlanır). Publish edilen projede runtime'daki editör düğmesi (sol alt) gizlidir; proje fuxaw'da düzenlenir. Geri almak için betiğin sonunda yazdığı komutu çalıştır: `download-<proje>.cmd -Project <yedek json>`.

## Kaldırma

`uninstall-fuxa.cmd`: FUXA'yı durdurur; `node\`, `app\`, başlatıcıları (`start-fuxa`, `stop-fuxa`, `fuxa-server`), `browser\` profilini ve kısayolları siler (runtime penceresi açıksa kapatır). `data\` (proje, yedekler) kalır; `install-fuxa.cmd` tekrar çalışınca aynı proje açılır. Tamamen silmek için bundan sonra `C:\ProgramData\fuxa` klasörünü elle sil.

## Notlar

- Betiklerin ekrana yazdıkları İngilizce ve yalnız ASCII: Windows PowerShell 5.1 konsolu Türkçe karakterleri bozuk gösteriyor. Onay soruları `(Y/N)`.

- FUXA'nın kendi dosyalarından sadece `main.js` değişir: başına tek satır eklenir (yedek: `main.js.fuxaw-backup`). Özgün **ADSclient** sürücüsüne dokunulmaz.
- Kurulum, npm paketlerinin kurulum betiklerini çalıştırmaz. Tek istisna `sqlite3`'ün derlenmiş dosyası: bu dosya ayrıca GitHub'dan indirilir.
- Yerel TwinCAT yöntemi Beckhoff ADS kütüphanesini (`TcAdsDll.dll`) kullanır; bu kütüphane TwinCAT kurulumuyla gelir.
- Yamanın yüklendiğini `data\_logs\fuxa.log` içindeki "ADS eklentisi çevrimdışı yüklendi." satırından anlarsın. Yükleme hata verirse FUXA yine açılır; hata "fuxaw patch failed to load" diye konsola yazılır.
