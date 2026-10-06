# fuxaw – FUXA projeleri için masaüstü uygulaması

FUXA HMI projelerini kendi penceresi olan bir uygulamada açar, düzenler ve kaydeder. Windows, Linux ve macOS'ta çalışır (Electron).

- **Proje = tek `.fxprj` dosyası** (girintili JSON; git'te farkı okunur).
- Ekranlar pencerenin içindeki **FUXA editöründe** tasarlanır. FUXA 1.3.4 ve Node.js uygulamanın içinde gelir; ayrıca bir şey kurmak gerekmez.
- **Publish** projeyi hedef makine için bir **klasöre** yazar (proje JSON + ne yapılacağını anlatan README). Ağ üzerinden hiçbir yere bir şey gönderilmez; klasör elle taşınır.

## Kullanım

| Menü / kısayol | Ne yapar |
| -------------- | -------- |
| Dosya → Yeni Proje (Ctrl+N) | Boş proje ("Adsız"); ilk kayıtta dosya adı sorulur |
| Dosya → Proje Aç… (Ctrl+O) | `.fxprj` açar. Düz FUXA JSON'u (editörde *Save Project As*, eski `<ad>_live.json`) içe aktarılır |
| Dosya → Son Projeler | Son açılan 10 proje |
| Dosya → Kaydet (Ctrl+S) / Farklı Kaydet (Ctrl+Shift+S) | Editördeki hali `.fxprj`'e yazar |
| Dosya → Publish (klasöre)… (Ctrl+Shift+P) | Kaydedilmiş projeyi `<publish klasörü>/<ad>/` altına yazar |
| Proje → Editör / Taglar / Kontrol (Ctrl+1/2/3) | Sekmeler |
| Proje → Runtime'ı aç (F5) | Projenin çalışan halini ayrı pencerede açar |
| Ayarlar → Bağlantılar ve tag yönetimi… (Ctrl+4) | Tam bağlantı/tag yönetimi: düzenleme, canlı değerler, bağlantı içe/dışa aktarma |
| Ayarlar → ADS bağlantı ayarları… | Yerel TwinCAT / ADS-TCP bağlantı yöntemi ve ayarları |
| Ayarlar → Sunucu eklentileri… (Ctrl+5) | Editörün sunucu eklentileri sayfası (ör. `ads-client`); Ctrl+1 çizim editörüne döner |

Açılışta "Bileşenler yükleniyor…" yazan küçük bir açılış penceresi görünür; ana pencere hazır olunca açılır. Komutlar Dosya/Proje/Ayarlar menülerindedir (pencerede ayrıca düğme yok).

`.fxprj` dosyasına çift tıklamak da projeyi açar (kurulum paketi dosya ilişkilendirmesini yapar). Kaydedilmemiş değişiklik varsa başlıkta `●` görünür ve kapatırken sorulur.

**Sekmeler:**

- **Editör:** FUXA editörü (ekranlar, cihazlar, tag'ler, script'ler). Editörün kendi ☰ proje menüsü gizlidir; kaydetme/açma uygulamanın Dosya menüsünden yapılır.
- **Taglar:** tüm tag'ler; arama, cihaz filtresi, "kullanılmayanlar". Kullanım sayısına tıklayınca tag'in hangi ekran öğesinde, hangi event'te ya da script'te kullanıldığı görünür. **Yeni tag**: cihaz, ad, tip, adres (sunucu içi cihazda başlangıç değeri) ve açıklama ile tag ekler; tag hemen eklenir (cihaz bağlantısı bir an kopar), dosyaya yazmak için kaydet. Satırdaki **Sil** onay isteyerek tag'i kaldırır; tespit edilen kullanımlar varsa referansların bozulacağını gösterir. Silme sonrası dosyaya yazmak için kaydet. **Kopyala** görünen satırları Excel'e yapıştırılabilir biçimde kopyalar.
- **Kontrol:** bilinen FUXA tuzakları (ör. Boolean ADS tag'ine *Toggle value*) ve kırık tag/script referansları. HATA varsa publish yapılmaz.
- **Bağlantılar:** gömülü editörün tam cihaz/tag yönetimi; tag düzenleme, canlı değer ve zaman damgası, bağlantı içe/dışa aktarma ve diğer cihaz işlemleri. Taglar sekmesindeki **Tagları düzenle…** de bu ekranı açar. Editör sekmesine tıklamak çizim ekranına döner. Değişiklikleri `.fxprj` dosyasına yazmak için Dosya → Kaydet kullan.
- **ADS ayarları:** Yerel TwinCAT / ADS-TCP desteği için ek ayarlar.

### ADS okuma aralığı

ADS ayarları → ADS cihazı → Düzenle → **Okuma aralığı (ms)** alanını örneğin `100` yapıp Uygula'ya bas. Bu değer hem ADS / TCP aboneliğinin örnekleme süresini hem Yerel TwinCAT okuma süresini belirler; arayüze aktarım döngüsü de aynı cihaz ayarını kullanır. Uygula cihazı yeniden bağlar; Dosya → Kaydet ayarı `.fxprj`'e yazar.

Editördeki **FUXA Server → Polling** yalnızca sunucu içi tag'lerin döngüsünü ayarlar; ADS cihazının süresini değiştirmez. Yerel TwinCAT okumalarında işlem süresi seçilen aralığa eklenir; 100 ms kesin zaman garantisi değildir. Bu düzeltme uygulamayla gelen ADS eklentisindedir; Publish ile JSON aktarılan bağımsız sunucunun sürücüsünü değiştirmez.

### Publish çıktısı

```
<publish klasörü>/<ad>/
├─ <ad>.json   tam proje; hedef makinede FUXA editörü ☰ → Open Project ile açılır
└─ README.md   hedef makinede nereye/nasıl koyulacağı, önce yedek alma, cihaz/tag özeti
```

Publish klasörü varsayılan olarak `.fxprj`'in yanındaki `publish/`; Publish penceresinden değiştirilir ve `.fxprj`'e kaydedilir.

## `.fxprj` biçimi

```json
{
  "fxprj": 1,
  "name": "fuxa1",
  "fuxaVersion": "1.3.4",
  "publish": { "dir": "publish" },
  "project": { "...": "FUXA projesi (tag value/timestamp olmadan)" }
}
```

## Geliştirme

```bash
npm install        # Electron + paketleyici; FUXA'yı fuxa-runtime/ altına kurar
npm start          # uygulamayı geliştirme modunda açar
npm test           # çekirdek testler
npm run dist:dir   # kurulumsuz paket: dist/win-unpacked/fuxaw.exe
npm run dist       # kurulum paketi
```

VS Code: Çalıştır ve Hata Ayıkla listesinde **Debug** (uygulamayı açar, ana süreç ve pencere arayüzü birlikte ayıklanır; proje uygulamadan açılır) ve **Release** (kurulum paketi, `dist/`). Ctrl+Shift+B = Release.

Geliştirmede Node.js 22+ gerekir (FUXA'yı da o çalıştırır). Paket için `scripts/fetch-node.js` sabit sürüm Node.js'i `vendor/node/`'a indirir.

Kod yapısı, tasarım kararları, FUXA API notları ve tuzaklar: **[AGENTS.md](AGENTS.md)**.

Yönetilen projeler ayrı repoda: `C:\sct\syncthing\sc_genel\fuxa_projects` (ör. `fuxa_project1`, TwinCAT TC294_35 HMI'si).

## Klasör yapısı

```
fuxa_wrapper/
├─ README.md / AGENTS.md / CLAUDE.md
├─ package.json             ← Electron uygulaması + electron-builder ayarları
├─ .vscode/                 ← Debug ve Release (launch.json, tasks.json)
├─ src/
│  ├─ core/                 ← model, fxprj, lint, tags, publish (Electron'dan bağımsız, testli)
│  ├─ main/                 ← ana süreç: main.js, fuxa.js (gömülü FUXA), fuxaApi.js
│  ├─ preload.js
│  └─ renderer/             ← pencere arayüzü (index.html, app.css, app.js) + açılış penceresi (splash.html/css)
├─ fuxa-runtime/package.json ← uygulamayla gelen FUXA sürümü (1.3.4)
├─ scripts/fetch-node.js    ← paket için Node.js indirme
└─ tests/
   ├─ core.test.js
   └─ fixtures/fuxa1_live.json ← gerçek projenin kopyası (test verisi)
```

## Durum ve geçmiş

- **2026-10-02:** İlk sürüm Python CLI + tarayıcıda web arayüzü olarak yazıldı.
- **2026-10-02:** Kullanıcı kararıyla Electron masaüstü uygulamasına geçildi: kendi penceresi, Dosya menüsü (Yeni/Aç/Kaydet/Publish), `.fxprj` tek dosya, gömülü FUXA + editör. Python kodu silindi. Windows'ta geliştirme ve paketlenmiş halde denendi: aç → düzenle → `●` → Ctrl+S → dosyada değişiklik; Yeni → Kaydet; Publish; Taglar; kapatırken soru.
- **2026-10-02:** Pencereden komut düğmeleri kaldırıldı (sadece menü); açılış penceresi; uygulamanın kendi metinlerinden FUXA adı çıkarıldı (editörün kendi metinleri olduğu gibi); Taglar'a "Yeni tag"; VS Code Debug/Release.
- Sonraki aşamalar: AGENTS.md §9.

## TwinCAT 4026 UM bağlantısı

Windows yerel ADS köprüsü bu reponun `integrations/native-ads/` klasöründe bağımsız bir eklentidir. Orijinal editör paketinin dosyaları değiştirilmez; eklenti uygulamayla birlikte gelir ve başlangıçta çevrimdışı yüklenir. Kullanım ve test komutları: [Yerel ADS bağlantısı](docs/native-ads.md).
