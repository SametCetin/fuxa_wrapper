[English](README.md) | **Türkçe**

# fuxaw – FUXA projeleri için masaüstü uygulaması

[FUXA](https://github.com/frangoteam/FUXA) HMI projelerini kendi penceresi olan bir uygulamada açar, düzenler ve kaydeder; projeyi hedef makineye tek dosyayla taşır. Windows, Linux ve macOS'ta çalışır (Electron).

- **Proje = bir klasör:** `.fxprj` + ekran, bağlantı ve script başına ayrı dosyalar. Ekran çizimi `.svg`, script kodu `.js`; git farkı satır satır okunur, bir AI ajanı tek bir ekranı ya da script'i doğrudan düzenleyebilir.
- Ekranlar pencerenin içindeki **FUXA editöründe** tasarlanır. FUXA 1.3.4 ve Node.js uygulamanın içinde gelir; ayrıca bir şey kurmak gerekmez.
- **Publish**, hedef makineye gidecek tek dosyayı üretir: `download-<proje>.cmd` (proje içine gömülü). Ağ üzerinden hiçbir yere bir şey gönderilmez; dosya elle taşınır.
- **Hedef makine** için tek dosyalık kurulum: `install-fuxa.cmd` FUXA'yı, Node.js'i ve ADS (fuxaw) sürücüsünü kurar.

İndirmeler: [Releases](https://github.com/SametCetin/fuxa_wrapper/releases). Kurulum paketiyle (`fuxaw-setup-<sürüm>.exe`) kurulan uygulama kendini günceller: açılışta yeni sürümü denetler, onay verirsen indirir, yeniden başlatıp kurar (**Yardım → Güncellemeleri denetle…** ile elle de). Kurulumsuz zip güncellenmez.

## Kullanım

| Menü / kısayol | Ne yapar |
| -------------- | -------- |
| Dosya → Yeni Proje (Ctrl+N) | Boş proje ("Adsız"); ilk kayıtta dosya adı sorulur |
| Dosya → Proje Aç… (Ctrl+O) | `.fxprj` açar. Eski tek dosya `.fxprj` ve düz FUXA JSON'u (editörde *Save Project As*, eski `<ad>_live.json`) içe aktarılır; ilk kayıtta proje klasörüne yazılır |
| Dosya → Son Projeler | Son açılan 10 proje |
| Dosya → Kaydet (Ctrl+S) / Farklı Kaydet (Ctrl+Shift+S) | Editördeki hali proje klasörüne yazar (sadece değişen dosyalar). Dosya açıldıktan sonra diskte değiştiyse (git, Syncthing…) üzerine yazmadan önce sorar |
| Dosya → Diskten yeniden yükle | `.fxprj`'i diskten baştan yükler (normalde gerekmez, aşağıya bkz.) |
| Dosya → Publish (klasöre)… (Ctrl+Shift+P) | Kaydedilmiş projeden `<publish klasörü>/<ad>/download-<ad>.cmd` üretir |
| Proje → Editör / Taglar / Kontrol (Ctrl+1/2/3) | Sekmeler |
| Proje → Scriptler (Ctrl+6) | Gömülü script yönetimini doğrudan açar |
| Proje → ADS sembolleri… (Ctrl+7) | Seçilen ADS bağlantısındaki dışa aktarılmış sembolleri okur, seçilen ilkel sembolleri tag olarak ekler. Sembol/tip araması ve grup filtresi; dizi ve yapılar listelenir ama içe aktarılamaz |
| Proje → Runtime'ı aç (F5) | Projenin çalışan halini ayrı pencerede açar |
| Ayarlar → Bağlantılar ve tag yönetimi… (Ctrl+4) | Tam bağlantı/tag yönetimi: düzenleme, canlı değerler, bağlantı içe/dışa aktarma |
| Ayarlar → Sunucu eklentileri… (Ctrl+5) | Sunucu eklentileri; uygulamayla gelen `@fuxaw/ads-plugin` burada görünür; Ctrl+1 çizim editörüne döner |
| Ayarlar → Dil | Türkçe / English: uygulamanın ve gömülü FUXA editörünün dilini birlikte değiştirir. İlk açılışta sistem dili belirler (sistem Türkçeyse Türkçe, değilse İngilizce). FUXA'nın kendi Türkçe çevirisi eksik olduğu için editörde bazı metinler İngilizce kalır |

Açılışta "Bileşenler yükleniyor…" yazan küçük bir açılış penceresi görünür; ana pencere hazır olunca açılır. Komutlar Dosya/Proje/Ayarlar menülerindedir (pencerede ayrıca düğme yok).

**Dosya dışarıdan değişirse** (AI ajanı, git, Syncthing) değişiklik sormadan, sadece değişen ekran/script/bağlantı olarak editöre gelir; PLC bağlantıları gereksiz yere kopmaz. Editörde kaydedilmemiş başka değişiklikler korunur. Yalnız aynı öğe iki tarafta da değiştiyse hangisinin kalacağı sorulur.

`.fxprj` dosyasına çift tıklamak da projeyi açar (kurulum paketi dosya ilişkilendirmesini yapar). Kaydedilmemiş değişiklik varsa başlıkta `●` görünür ve kapatırken sorulur.

**Sekmeler:**

- **Editör:** FUXA editörü (ekranlar, cihazlar, tag'ler, script'ler). Editörün kendi ☰ proje menüsü gizlidir; kaydetme/açma uygulamanın Dosya menüsünden yapılır.
- **Taglar:** doğrudan gömülü editörün tag tablosu; ekleme, düzenleme, silme, arama, canlı değer ve zaman damgası. İlk girişte ilk PLC/harici cihaz, yoksa sunucu içi cihaz açılır. Son seçilen bağlantı aynı proje açıkken hatırlanır; yeni/açılan projede sıfırlanır. Değişiklikleri `.fxprj` dosyasına yazmak için Dosya → Kaydet kullan.
- **Scriptler:** Kontrol sekmesinin yanından veya Ctrl+6 ile doğrudan script yönetimine geç.
- **Kontrol → Proje kontrolü:** bilinen FUXA tuzakları (ör. Boolean ADS tag'ine *Toggle value*) ve kırık tag/script referansları. Ayrıca PLC'ye bağlanmadan ADS bağlantı ayarlarını, yinelenen ADS sembol adreslerini ve desteklenmeyen ADS tag tiplerini kontrol eder. HATA varsa publish yapılmaz.
- **Kontrol → Tag kullanımları:** tüm tag'lerde arama, cihaz ve kullanılmayanlar filtresi. Kullanım sayısı ekran öğesi, event ve script referanslarını gösterir. **Kopyala** görünen satırları Excel'e yapıştırılabilir biçimde kopyalar.
- **Bağlantılar:** özgün cihaz şeması, bağlantı düzenleme ve içe/dışa aktarma. Yeni bağlantıda **Type → ADS (fuxaw)** seç; aynı penceredeki **Bağlantı yöntemi** alanında **Yerel TwinCAT (Windows)** veya **ADS-TCP** kullan. **ADSclient (orijinal)** özgün `ads-client` sürücüsünü, **ADS (fuxaw)** ayrı `@fuxaw/ads-plugin` sürücüsünü kullanır. İki eklenti Sunucu eklentileri sayfasında ayrı görünür. Bizim eklenti bu sayfadan çevrimdışı kaldırılıp yeniden kurulabilir; seçim uygulama yeniden başlatılınca korunur. Editör sekmesi çizim ekranına döner.

### ADS okuma aralığı

Bağlantılar → ADS cihazının kalem simgesi → **Polling** alanını örneğin `100 ms` yapıp **OK**'e bas. Bu değer hem ADS / TCP aboneliğinin örnekleme süresini hem Yerel TwinCAT okuma süresini belirler; arayüze aktarım döngüsü de aynı cihaz ayarını kullanır. **OK** cihazı yeniden bağlar; Dosya → Kaydet ayarı `.fxprj`'e yazar.

Editördeki **FUXA Server → Polling** yalnızca sunucu içi tag'lerin döngüsünü ayarlar; ADS cihazının süresini değiştirmez. Yerel TwinCAT okumalarında işlem süresi seçilen aralığa eklenir; 100 ms kesin zaman garantisi değildir.

### ADS sembol seçici

**Proje → ADS sembolleri…** (Ctrl+7) seçilen ADS bağlantısındaki (Yerel TwinCAT veya ADS-TCP) dışa aktarılmış sembol listesini yalnızca **Sembolleri oku** düğmesine basınca okur; proje açmak ya da publish etmek PLC gerektirmez. Sembol/tip araması, grup filtresi ve eklenecek ilkel sembollerin seçimi vardır. İlkel tipler **Boolean** (BOOL/BIT), **Number** (32 bite kadar tam sayılar, REAL/LREAL, TIME/TOD ve OTCID) ve **String** (STRING/WSTRING) olarak eşlenir. 64 bit tam sayılar, tarih nesneleri, enum/alias tipleri, diziler ve yapılar desteklenmiyor olarak listelenir, sessizce içe aktarılmaz; üyeleri gerekiyorsa normal tag düzenleyicisinde adresle eklenir. Mevcut tag'ler korunur; aynı adres ikinci kez eklenmez. Tag adı sembol adının aynısıdır (baştaki nokta dahil); ad zaten varsa sonuna `_2`, `_3`… eklenir.

### Publish çıktısı

```
<publish klasörü>/<ad>/
├─ download-<ad>.cmd   hedefe gönderilen tek dosya (proje içine gömülü): çift tıklanınca FUXA'daki projeyi yedekler, bunu yükler
└─ <ad>.json           tam proje (kayıt, git farkı, elle Open Project); göndermek gerekmez
```

Müşteriye giden projede runtime'daki editör düğmesi (sol alt) gizlidir; proje fuxaw'da düzenlenir. Publish klasörü varsayılan olarak `.fxprj`'in yanındaki `publish/`; Publish penceresinden değiştirilir ve `.fxprj`'e kaydedilir.

## Hedef makineye dağıtım

İki tek dosyalık betik, ikisi de yanında başka dosya gerektirmez:

| Ne zaman | Dosya | Nereden | Ne yapar |
| --- | --- | --- | --- |
| Bir kez, yeni makinede | `install-fuxa.cmd` | [Releases](https://github.com/SametCetin/fuxa_wrapper/releases) ya da `npm run dist:installer` | Node.js + FUXA 1.3.4'ü internetten `C:\ProgramData\fuxa`'ya kurar, ADS (fuxaw) sürücüsünü ekler, kısayolları oluşturur (**Start FUXA**, **FUXA Editor**, **Stop FUXA**) |
| Her proje güncellemesinde | `download-<proje>.cmd` | fuxaw → Dosya → Publish | FUXA'yı gerekirse başlatır, mevcut projeyi yedekler, yeni projeyi yükler, runtime ekranını yeniden açar |

`uninstall-fuxa.cmd` FUXA'yı kaldırır, projeyi (`data\`) korur. Gerekenler: 64 bit Windows 10 1803+ / Server 2019+, kurulum sırasında internet (nodejs.org, npm, github.com). Ayrıntı: [installer/README.md](installer/README.md).

**TwinCAT:** Windows yerel ADS köprüsü bu reponun `integrations/native-ads/` klasöründe bağımsız bir eklentidir; orijinal FUXA paketinin dosyaları değiştirilmez. **Yerel TwinCAT** yöntemi makinede kurulu Beckhoff ADS kütüphanesini (`TcAdsDll.dll`, TwinCAT ile gelir) kullanır; bu kütüphane bu projeyle dağıtılmaz. Ayrıntı: [Yerel ADS bağlantısı](docs/native-ads.md).

## Proje klasörü

```
fuxa1/
├─ fuxa1.fxprj             ad, publish klasörü, öğe sırası, layout ve geri kalan ayarlar
├─ views/Ana Ekran.json    ekran öğeleri
├─ views/Ana Ekran.svg     çizim
├─ devices/PLC1.json       bağlantı + tag'leri
├─ scripts/Hesapla.json    script ayarları
├─ scripts/Hesapla.js      script kodu
└─ publish/                Publish çıktısı
```

- Dosyalar içlerindeki `id` ile eşlenir; ekranın adı değişince dosya adı da değişir. Yeni dosya eklemek yeni öğe, dosyayı silmek öğeyi silmek demektir.
- Uygulama açıkken bu dosyalardan biri dışarıda değişirse (AI ajanı, git, Syncthing) değişiklik editöre kendiliğinden gelir.
- Bir klasörde tek proje olur. Başka bir projenin bulunduğu klasöre kaydedersen proje kendi alt klasörüne yazılır.

## Geliştirme

```bash
npm install            # Electron + paketleyici; FUXA'yı fuxa-runtime/ altına kurar
npm start              # uygulamayı geliştirme modunda açar
npm test               # çekirdek testler
npm run dist:fast      # imzalamadan hızlı Windows paketi: dist/fast/win-unpacked/fuxaw.exe
npm run dist:installer # hedef makine kurulumu: dist/installer/fuxaw-install-*/install-fuxa.cmd
npm run dist           # kurulum paketi (NSIS)
```

Geliştirmede Node.js 22+ gerekir (FUXA'yı da o çalıştırır). Paket için `scripts/fetch-node.js` sabit sürüm Node.js'i `vendor/node/`'a indirir.

**Sürüm ve release:** sürüm dört parçalıdır (ör. `27.1.10.26`). `main` dalında `npm run version:set -- 27.1.10.27`, commit, `git tag V27.1.10.27`, `git push origin main V<sürüm>`. Etiket gönderilince GitHub Actions test eder, derler ve [Releases](https://github.com/SametCetin/fuxa_wrapper/releases) sayfasına `fuxaw-setup-<sürüm>.exe`, `fuxaw-win-x64-<sürüm>.zip`, `install-fuxa.cmd`, `uninstall-fuxa.cmd` ve güncelleyicinin okuduğu `latest.yml` + `.blockmap` koyar (`.github/workflows/release.yml`). npm sürümü `26.1.10.22` → `26.1.10022` biçimindedir (aynı ayın sürümleri sıralansın, `src/core/version.js`). EXE'ler imzasız (SmartScreen uyarısı).

VS Code: Çalıştır ve Hata Ayıkla listesinde **Debug** (uygulamayı açar, ana süreç ve pencere arayüzü birlikte ayıklanır), **Release** (kurulum paketi, `dist/`) ve **Hızlı EXE** (imzasız, kurulumsuz Windows x64 paketi, `dist/fast/win-unpacked/fuxaw.exe`). Ctrl+Shift+B = Release. Hızlı EXE'yi çalıştırmak/taşımak için tüm `win-unpacked` klasörü gerekir.

Kod yapısı, tasarım kararları, FUXA API notları ve tuzaklar: **[AGENTS.md](AGENTS.md)** (Türkçe).

## Klasör yapısı

```
fuxa_wrapper/
├─ README.md / README.tr.md / AGENTS.md / CLAUDE.md
├─ package.json             ← Electron uygulaması + electron-builder ayarları
├─ .github/workflows/       ← release (V<sürüm> etiketiyle)
├─ .vscode/                 ← Debug, Release ve Hızlı EXE (launch.json, tasks.json)
├─ src/
│  ├─ core/                 ← model, fxprj, folder, sync, lint, tags, publish (Electron'dan bağımsız, testli)
│  │  └─ target/            ← hedefte çalışan betikler (download-project şablonu, tek dosyalık .cmd sarıcı)
│  ├─ main/                 ← ana süreç: main.js, fuxa.js (gömülü FUXA), fuxaApi.js
│  ├─ preload.js
│  └─ renderer/             ← pencere arayüzü + açılış penceresi
├─ integrations/native-ads/ ← ADS (fuxaw) sürücüsü ve Windows yerel köprüsü
├─ installer/               ← hedef kurulum betikleri (install-fuxa/uninstall-fuxa şablonları)
├─ fuxa-runtime/package.json ← uygulamayla gelen FUXA sürümü (1.3.4)
├─ scripts/                 ← fetch-node.js, build-installer.js, set-version.js
└─ tests/                   ← node --test; fixtures/fuxa1_live.json test verisi
```

## Lisans

[MIT](LICENSE) © 2026 Samet Çetin. fuxaw ile gelen ya da onun kurduğu üçüncü taraf bileşenler (FUXA, Electron, Node.js, ads-client ve FUXA'nın bağımlılıkları) kendi lisanslarıyla gelir; bkz. [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Beckhoff'un `TcAdsDll.dll` kütüphanesi dağıtılmaz.

FUXA, TwinCAT ve Beckhoff sahiplerinin ticari markalarıdır. fuxaw bağımsız bir projedir; frangoteam ya da Beckhoff Automation ile bağlantılı değildir, onlar tarafından onaylanmamış ya da desteklenmemiştir.
