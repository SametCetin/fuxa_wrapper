# Windows yerel ADS bağlantısı

TwinCAT 4026 UM kurulumunda aynı hosttaki PLC'ye erişmek için Windows x64 yerel ADS köprüsü kullanılır. Bu çözümün kaynakları, testleri ve paketleme adımları bu wrapper reposuna aittir.

## Yapı

- `integrations/native-ads/adsclient/index.js`: gömülü editörün ADS sürücüsünün uyarlanmış kopyası.
- `integrations/native-ads/adsclient/native/AdsBridge.cs`: kurulu Beckhoff x64 `TcAdsDll.dll` kütüphanesini kullanan yardımcı süreç.
- `integrations/native-ads/adsclient/native/client.js`: sembol ve tip dönüşümleri için ads-client 2.1.0 kullanan yerel bağlantı adaptörü.
- `integrations/native-ads/adsclient/native/test/`: köprü, adaptör ve sürücü testleri.
- `integrations/native-ads/index.js`: bağımsız ADS eklentisi ve başlatıcı adaptörü.
- `integrations/native-ads/prepare.js`: köprüyü derler; editör paketine yazmaz.
- `integrations/native-ads/probe.js`: PLC'ye değer yazmadan proje tag'lerini ve sembolleri okur.

Editör bileşeni sürümü 1.3.4 olarak sabittir ve orijinal npm paketinden çalışır. Başlatıcı, eklentiyi ayrı klasörden yükler. Bileşenin varsayılan eklentileri hazır olduğunda mevcut `loadPlugin('ADSclient', modulePath)` noktası üzerinden sürücüyü kaydeder. Bunun için yalnızca çalışan süreçte `plugins.init` çevresine bir adaptör eklenir; disk üzerindeki bileşen dosyaları değiştirilmez. Bu adaptör sürüme bağımlıdır ve doğrulanmamış sürümde başlangıcı reddeder.

`ads-client` 2.1.0 ve tüm bağımlılıkları eklentinin kendi `node_modules` klasöründedir. Kurulum paketinde `resources/plugins/native-ads` altında bulunur. Kullanıcının eklentiyi indirmesi veya npm çalıştırması gerekmez. Bu eklenti masaüstü uygulamasının başlatıcısı tarafından yönetilir; bileşenin Plugins ekranındaki indirilebilir paket kataloğuna eklenmez. Yeni bir eklenti güncellemesi için uygulama yeniden paketlenir.

## Çalıştırma

Hazırlanan `Simu_294_35-native.fxprj` dosyasındaki ADS cihazında `property.adsTransport = "native"` seçilidir. Orijinal proje korunmuştur.

```powershell
npm run setup:ads
npm start -- "C:\sct\syncthing\repohf_sync\fuxa_projects\fuxaw_test_1\Simu_294_35-native.fxprj"
```

Bağlantı yöntemi uygulamanın **Bağlantılar** sekmesinden veya **Ayarlar → Bağlantılar (Ctrl+4)** menüsünden seçilir. **Yeni ADS bağlantısı** ile ad, yöntem, hedef AMS Net ID ve ADS portu girilir. **Yerel TwinCAT** Windows x64 üzerindeki kurulu TwinCAT router'ını kullanır; **ADS / TCP** TCP router üzerinden bağlanır ve yerel AMS/router alanlarını gösterir. Yeni bağlantıda yöntem açıkça seçilmeli; etkinleştirme kutusu işaretlenene kadar cihaz devre dışıdır. **Uygula** sonrasında `.fxprj` dosyasına yazmak için **Dosya → Kaydet** kullanılır.

Mevcut ADS cihazlarında **Düzenle** yöntemi değiştirir; tag'ler, cihaz kimliği ve ek özellikler korunur. `adsTransport` alanı olmayan eski cihazlar **ADS / TCP** olarak gösterilir. Yerel yöntemde Local/Router TCP alanları kullanılmaz. Uzak PLC'ler için yerel TwinCAT router'da uygun ADS rotası gerekir. Diğer protokoller **Diğer bağlantı türleri…** ile gömülü cihaz ekranında yönetilir.

`npm run install:ads` geliştirme bağımlılıklarını kurar ve köprüyü hazırlar. `npm run setup:fuxa` bunu otomatik çağırır. `npm run setup:ads`, `npm run dist:dir` ve `npm run dist` yalnızca mevcut yerel bağımlılıkları kullanarak köprüyü hazırlar; editör paketine kopyalama yapmaz. Node dağıtımını ilk kez indirmek (`fetch:node`) ayrıca internet gerektirebilir.

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

Probe, varsayılan olarak eklentinin yerel `ads-client` paketini kullanır. Gerektiğinde `--ads-module <dizin>` verilebilir. Probe PLC'ye değer yazmaz ve durum kontrol komutu göndermez.

2026-10-06 tarihinde gerçek host PLC'sinde RUN durumu, dokuz proje tag'i, 831 sembol ve periyodik güncellemeler okundu. Kurulmuş editör sürücüsü `connect-ok` döndürdü ve dokuz değeri sundu. 14 ADS testi ve 19 mevcut çekirdek testi geçti.

## Mevcut sınırlar

Tag güncellemeleri yaklaşık saniyede bir okuma ile alınır; native ADS bildirimleri kullanılmaz. Kısa darbeler ve hızlı trendler için bu aralık uygun değildir. İstekler sıralı işlenir ve 16 MiB ile sınırlıdır. Bir saniyelik sağlık kontrolü bağlantı kaybını ve sembol sürümü değişimini izler; yeniden bağlantıyı editörün cihaz yöneticisi yapar.

Tag yazma kodu ve Boolean dönüşüm testleri vardır; gerçek PLC'ye yazma testi yapılmadı. PLC başlatma/durdurma komutları bu adaptörde sağlanmaz. Paketlenmiş uygulamada ayrıca doğrulama yapılmalıdır.

ads-client 2.1.0'ın paket ayrıştırması kullanıldığından bu bağımlılık değiştirildiğinde entegrasyon yeniden sınanmalıdır.

## Eklenti dönüşümünün doğrulaması (2026-10-06)

37 otomatik test geçti. Orijinal 1.3.4 npm arşivi kilit dosyasındaki SHA512 ile doğrulandı; kurulu bileşenin 490 paket dosyası karşılaştırıldı ve eski ADS yaması kaldırıldı. Geliştirme ortamında ve `dist/win-unpacked` Windows paketinde bağımsız ADS eklentisi yüklendi; ayarlar, editör ve proje HTTP uçları doğrulandı. Eklenti bağımlılıkları ve hazır Windows köprüsü paket içinde bulunur. Bu dönüşüm sırasında gerçek PLC'ye yazma veya masaüstü penceresinde etkileşim testi yapılmadı.

## Bağlantı arayüzünün doğrulaması

Bağlantı yöntemi arayüzü için 40 otomatik test geçti. Gerçek Electron penceresindeki DOM ve IPC akışında yöntem seçimi zorunluluğu, devre dışı bir Yerel TwinCAT cihazı oluşturma ve aynı cihazı ADS / TCP'ye geçirme doğrulandı; ekran görüntüleri incelendi. Deneme Windows paketi yeniden üretildi. Bu arayüz testleri PLC'ye bağlanmadı veya değer yazmadı.

## Geri alma

Uygulamayı kapatın ve önceki Git dalına dönün. Yeni yapıda editör dosyaları değiştirilmediği için dosya yamasını geri almak gerekmez. `adsTransport` seçimi proje içinde korunur; mevcut `.fxprj` dosyaları yeniden oluşturulmaz.
