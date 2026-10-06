# Windows yerel ADS bağlantısı

TwinCAT 4026 UM kurulumunda aynı hosttaki PLC'ye erişmek için Windows x64 yerel ADS köprüsü kullanılır. Bu çözümün kaynakları, testleri ve paketleme adımları bu wrapper reposuna aittir.

## Yapı

- `integrations/native-ads/adsclient/index.js`: gömülü editörün ADS sürücüsünün uyarlanmış kopyası.
- `integrations/native-ads/adsclient/native/AdsBridge.cs`: kurulu Beckhoff x64 `TcAdsDll.dll` kütüphanesini kullanan yardımcı süreç.
- `integrations/native-ads/adsclient/native/client.js`: sembol ve tip dönüşümleri için ads-client 2.1.0 kullanan yerel bağlantı adaptörü.
- `integrations/native-ads/adsclient/native/test/`: köprü, adaptör ve sürücü testleri.
- `integrations/native-ads/apply.js`: köprüyü derler ve gömülü editör paketine uygular.
- `integrations/native-ads/probe.js`: PLC'ye değer yazmadan proje tag'lerini ve sembolleri okur.

Editör bileşeni sürümü 1.3.4 olarak sabittir. Uygulama adımı sürüm ve sürücü hash'ini denetler; beklenmeyen bir sürücünün üzerine yazmaz. Kaynak değişiklikleri `integrations/` altında yapılır. Kurulu `node_modules/` kopyaları üretilen dosyalardır.

## Çalıştırma

Hazırlanan `Simu_294_35-native.fxprj` dosyasındaki ADS cihazında `property.adsTransport = "native"` seçilidir. Orijinal proje korunmuştur.

```powershell
npm run setup:ads
npm start -- "C:\sct\syncthing\repohf_sync\fuxa_projects\fuxaw_test_1\Simu_294_35-native.fxprj"
```

Diğer projelerde ADS cihazının `property` nesnesine `"adsTransport": "native"` eklenir. Hedef AMS Net ID ve ADS portu korunur. Bu yöntemde Local/Router TCP alanları kullanılmaz. Uzak PLC'ler için yerel TwinCAT router'da uygun ADS rotası gerekir.

`npm run setup:fuxa` bağımlılık kurulumundan sonra köprüyü uygular. `npm run dist:dir` ve `npm run dist` paketlemeden önce köprüyü yeniden derleyip uygular. Eski kurulu uygulama bu değişikliği ancak yeni paketle alır.

Derleme Windows ile gelen .NET Framework 4.x C# derleyicisini kullanır; ayrı SDK/NuGet bağımlılığı yoktur. Hostta Beckhoff x64 ADS API'si bulunmalıdır. Yardımcı süreç şu DLL konumlarını arar:

- `%ProgramFiles(x86)%\Beckhoff\TwinCAT\Common64\TcAdsDll.dll`
- `C:\TwinCAT\Common64\TcAdsDll.dll`

Diğer platformlarda varsayılan TCP bağlantısı kullanılabilir; yerel ADS seçimi Windows x64 gerektirir.

## Test

```powershell
npm test
npm run test:ads
npm run probe:ads -- --project "C:\sct\syncthing\repohf_sync\fuxa_projects\fuxaw_test_1\Simu_294_35-native.fxprj"
```

Probe, varsayılan olarak `%APPDATA%\fuxaw\fuxa\_pkg\runtime\node_modules\ads-client` paketini kullanır. Gerektiğinde `--ads-module <dizin>` verilebilir. Probe PLC'ye değer yazmaz ve durum kontrol komutu göndermez.

2026-10-06 tarihinde gerçek host PLC'sinde RUN durumu, dokuz proje tag'i, 831 sembol ve periyodik güncellemeler okundu. Kurulmuş editör sürücüsü `connect-ok` döndürdü ve dokuz değeri sundu. 14 ADS testi ve 19 mevcut çekirdek testi geçti.

## Mevcut sınırlar

Tag güncellemeleri yaklaşık saniyede bir okuma ile alınır; native ADS bildirimleri kullanılmaz. Kısa darbeler ve hızlı trendler için bu aralık uygun değildir. İstekler sıralı işlenir ve 16 MiB ile sınırlıdır. Bir saniyelik sağlık kontrolü bağlantı kaybını ve sembol sürümü değişimini izler; yeniden bağlantıyı editörün cihaz yöneticisi yapar.

Tag yazma kodu ve Boolean dönüşüm testleri vardır; gerçek PLC'ye yazma testi yapılmadı. PLC başlatma/durdurma komutları bu adaptörde sağlanmaz. Paketlenmiş uygulamada ayrıca doğrulama yapılmalıdır.

ads-client 2.1.0'ın paket ayrıştırması kullanıldığından bu bağımlılık değiştirildiğinde entegrasyon yeniden sınanmalıdır.

## Geri alma

Uygulamayı kapatın. `.native-ads-backup/package.json` dosyasını repo kökündeki `package.json` üzerine, `.native-ads-backup/adsclient-index.js` dosyasını gömülü editörün `runtime/devices/adsclient/index.js` dosyası üzerine geri kopyalayın. Ardından orijinal proje dosyasını açın. Yedekler Git'e eklenmez.
