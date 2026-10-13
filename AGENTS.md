# AGENTS.md – fuxaw (FUXA projeleri için masaüstü uygulaması) geliştirme kuralları

Bu dosya, bu klasörde çalışan AI asistanlar (Claude Code vb.) ve geliştiriciler için yazıldı. Kullanım ve genel bakış: [README.md](README.md).

Kullanıcıyla Türkçe konuş.

Bu repo sadece **uygulama kodunu** içerir. Yönetilen FUXA projeleri ayrı bir repoda:
`C:\sct\syncthing\sc_genel\fuxa_projects` (ör. `fuxa_project1/`, TwinCAT TC294_35 HMI'si). O projeye ait bilgiler oradaki `AGENTS.md` ve `README.md`'dedir.

**Ürün (kullanıcının kararı, 2026-10-02):** kendi penceresi olan bir masaüstü uygulaması. Electron, tüm işletim sistemleri.
- Menü: **Yeni Proje, Aç, Kaydet, Farklı Kaydet, Son Projeler, Publish (sadece klasöre)**.
- Proje dosyası **`.fxprj`**: tek dosya, girintili JSON (bkz. §3).
- Ekranlar pencerenin içine gömülü FUXA editöründe tasarlanır. FUXA uygulamanın içinde gelir (Node.js dahil); kullanıcı ayrıca bir şey kurmaz.
- **Uygulamanın kendi arayüzünde FUXA adı geçmez** (menü, pencere, mesajlar, hata metinleri, lint mesajları, günlük dosyası adı `engine.log`). İç bileşenden "editör bileşeni" / "bileşenler" diye söz edilir. Açılışta çerçevesiz bir açılış penceresi (uygulama adı + sonsuz kayan bar + "Bileşenler yükleniyor…") gösterilir; ana pencere bileşen hazır olunca açılır. İstisnalar: kod içi yorum/değişken adları, publish README'si (hedef makinedeki FUXA editörünü tarif etmek zorunda) ve gömülü editörün kendi metinleri / proje verisi (ör. "FUXA Server" cihazı). Editörün kendi FUXA yazıları (Yardım, About, logo) **gizlenmez**; kural sadece bizim yazdığımız metinler için (kullanıcı kararı, 2026-10-02).
- Hedef makineye ağ üzerinden **hiçbir şey gönderilmez**. Publish proje JSON'unu ve README'yi bir klasöre yazar, klasör elle taşınır. SSH/uzak FUXA desteği geri eklenmez.

> Geçmiş: 2026-10-02'de önce Python CLI + tarayıcıda web arayüzü olarak yazıldı (`fuxaw/`, `fuxaw.cmd`). Kullanıcı "kendi penceresi olan uygulama" istediği için aynı gün Electron'a geçildi; Python kodu silindi (git geçmişinde: `f9d788c`). Üç hal senkronu (yerel/hedef/taban, pull) yeni modelde gerekmediği için taşınmadı.

## 1. Kod yapısı

Düz JavaScript (CommonJS), derleme adımı yok.

- `src/core/`: Electron'dan bağımsız, testli çekirdek.
  - `model.js`: proje temizleme (tag `value`/`timestamp` atılır, script CRLF→LF), değişiklik özeti (`digest`; SVG öznitelik sırası yok sayılır, bkz. §7), öğelere bölme (`splitProject`).
  - `fxprj.js`: `.fxprj` okuma/yazma (atomik: geçici dosya + rename), düz FUXA JSON'unu içe aktarma, `safeName`.
  - `lint.js`: §7 "Tuzaklar"ın kural hali + kırık tag/script referansları.
  - `tags.js`: tag tablosu + kullanım yerleri; yeni tag (`buildTag`, `tagTypesFor`, `newTagId`).
  - `publish.js`: klasöre çıkarma (proje JSON + README), lint hatasında yazmaz.
  - `sync.js`: dışarıdan değişen projeyi öğe öğe birleştirme (`merge`) ve sunucu komut planı (`planOps`).
  - `folder.js`: klasör biçimi (.fxprj biçim 2): ekran/bağlantı/script dosyalarına ayırma (`explode`), birleştirme (`implode`), sadece değişen dosyaları yazma.
  - `widgets.js`: ekran şablonları (momentary/set/toggle butonu, lamba, değer, metin); tuzaklardan kaçınan öğe + SVG üretir.
  - `agent.js`: yerel ajan kanalının araç işleyicileri (ekran/script/tag, lint, canlı değer); ana süreçten `app` arayüzü alır.
  - `envs.js`: bağlantı ortamları: cihaz bağlantı ayarlarını ayırma/birleştirme (`extract`/`compose`), `connections/<ortam>.json` okuma/yazma.
- `.vscode/`: `launch.json` (Debug, Release, Hızlı EXE) ve `tasks.json` (Release, Hızlı EXE).
- `src/main/`: Electron ana süreci.
  - `main.js`: pencere, menü, IPC, proje işlemleri (yeni/aç/kaydet/publish), değişiklik takibi.
  - `fuxa.js`: gömülü FUXA sunucusu: Node ve FUXA'yı bul, boş portta başlat, hazır olmasını bekle, durdur.
  - `fuxaApi.js`: FUXA REST çağrıları.
  - `agentServer.js`: yerel ajan kanalı (127.0.0.1, rastgele port + anahtar, `<userData>/agent.json`).
- `src/mcp/`: MCP köprüsü (`bridge.js`, stdio JSON-RPC, bağımlılıksız) ve araç tanımları (`tools.js`). Paketlenmişte `resources/mcp/`, uygulamayla gelen Node ile çalışır.
- `src/preload.js`: arayüzün ana süreçle tek kapısı (`window.fxw`).
- `src/renderer/splash.html` + `splash.css`: açılış penceresi (betiksiz). `main.js` → `createSplash` / `revealMain` (en az 1,2 sn görünür; açılışta verilen `.fxprj` ana pencere görünmeden yüklenir).
- `src/renderer/`: pencere arayüzü (Editör/Taglar/Kontrol sekmeleri; komutlar sadece menüde, ayrıca düğme yok; karşılama ekranı, Publish ve Yeni tag pencereleri). Metinler DOM'a hep `textContent` ile basılır (`el()`); `innerHTML` kullanma (proje/tag/dosya adları dışarıdan gelir).
- `fuxa-runtime/package.json`: uygulamayla gelen FUXA sürümü (sabit `1.3.4`) ve özgün ADS sürücüsünün `ads-client` bağımlılığı (sabit `2.1.0`). `npm install` sonrası `postinstall` kurar.
- `integrations/native-ads/`: uygulamayla gelen offline ADS eklentisi; `index.js` başlatıcı adaptörü, `adsclient/` sürücü ve Windows yerel köprüsü. Orijinal editör paketinin dosyaları değiştirilmez. Başlatıcı varsayılan eklentilerin ardından `loadPlugin("FuxawADS", ...)` ile sürücüyü ayrı yuvaya kaydeder; `device-loader.js` cihaz yöneticisini require öncesinde bellekte genişletir ve özgün `ADSclient` sürücüsüne dokunmaz; Eklenti kayıt/listesi ile kurma/kaldırma işlemleri yalnızca süreç belleğinde uyarlanır; Özgün `ads-client` ve uygulamayla gelen `@fuxaw/ads-plugin` ayrı kartlar/türlerdir. Bizim eklentinin çevrimdışı kur/kaldır seçimi userData altındaki `fuxaw-ads-plugin.json` dosyasında tutulur; kaldırma etkin bağlantılarını keser. `editor.js`, servis edilen ana betiğe standart ADS formunda yöntem seçimi ve `adsTransport` alanının kayıtta korunmasını ekler. Bu yükleme noktaları yeni bileşen sürümünde doğrulanmalı. `npm run install:ads` bağımlılıkları kurar, `npm run setup:ads` yerel köprüyü hazırlar. Paket: `resources/plugins/native-ads` (bağımlılıkları dahil).
- `scripts/fetch-node.js`: kurulum paketine konacak Node.js'i `vendor/node/`'a indirir (sabit sürüm, SHA256 doğrulamalı).
- `package.json` → `build`: electron-builder ayarları (NSIS / AppImage+deb / dmg, `.fxprj` dosya ilişkilendirme).

## 2. Çalıştırma, test, paketleme

```bash
npm install          # Electron + electron-builder; postinstall: Electron ikili dosyası + fuxa-runtime
npm start            # geliştirme: PATH'teki (veya vendor/) Node ile FUXA'yı başlatır
npm start -- C:\yol\proje.fxprj
npm test             # node --test: çekirdek modüller (FUXA/Electron gerekmez)
npm run dist:dir     # dist/win-unpacked (kurulumsuz deneme)
npm run dist:fast    # dist/fast/win-unpacked (Windows x64, imzasız; NSIS yok)
npm run dist         # kurulum paketi (Windows'ta NSIS)
```

VS Code: Çalıştır ve Hata Ayıkla listesinde **Debug** (uygulamayı açar; ana süreç + pencere arayüzü, port 9223; alt yapılandırmalar `presentation.hidden`), **Release** (`npm run dist`) ve **Hızlı EXE** (`npm run dist:fast`; debugger kapalı). Hızlı EXE, Windows x64 kurulumsuz paketini `dist/fast/win-unpacked` altına üretir; `win.signExecutable=false` imzalamayı atlar, EXE kaynak/metadata düzenlemesi korunur. `tasks.json`: Ctrl+Shift+B = Release; Hızlı EXE ayrıca seçilebilir. Proje uygulamanın içinden açılır.

Testler `tests/fixtures/fuxa1_live.json` (gerçek projenin kopyası) dosyasını kullanır. Durum: 90 test geçiyor (2026-10-13).

Arayüz değişikliklerini gerçek pencerede dene (bkz. §8, computer-use ile `electron.exe`).

## 3. Tasarım kararları

- **`.fxprj` tek gerçek kaynaktır.** Açılınca proje gömülü FUXA'ya yüklenir (`POST /api/project`), editör pencerede açılır. **Kaydet** önce editörün bekleyen değişikliklerini sunucuya aktarır (§4), sonra `GET /api/project` ile okuyup `.fxprj`'e yazar.
- `.fxprj` biçimi:
  ```json
  {"fxprj": 1, "name": "fuxa1", "fuxaVersion": "1.3.4", "publish": {"dir": "publish"}, "project": {...}}
  ```
  `fxprj` biçim sürümüdür (1 = tek dosya, 2 = klasör biçimi); daha yenisi açılmaz ("uygulamayı güncelle"). `publish.dir` göreliyse `.fxprj` klasörüne göredir. Tag `value`/`timestamp` yazılmaz. Dosyada kayıt zamanı gibi her kayıtta değişen alan **yok** (git farkı temiz kalsın).
- **Klasör biçimi (isteğe bağlı, `fxprj: 2`):** `.fxprj`'de `"parts": {"views": [id…], "devices": [id…], "scripts": [id…]}` (sıra) varsa ekranlar `views/<ad>.json` + `views/<ad>.svg` (svgcontent), bağlantılar `devices/<ad>.json` (tag'leriyle), script'ler `scripts/<ad>.json` + `scripts/<ad>.js` (code) dosyalarındadır; `.fxprj`'in `project` alanında geri kalan (layout, metinler, alarmlar…) durur. Katman `fxprj.read/write/fileHash` içindedir (`folder.js`); uygulamanın geri kalanı birleşik projeyle çalışır. Öğeler dosya adıyla değil içlerindeki `id` ile eşlenir; ad değişince dosya adı değişir (çakışan/büyük-küçük harf farklı adlara `__<id>` eklenir). Sırada olmayan (dışarıda eklenen) dosya sona eklenir, dosyası silinen öğe düşer; aynı id iki dosyada / id yok / bozuk JSON → okuma hatası. Kaydet sadece içeriği değişen dosyaları yazar (önce parçalar, en son `.fxprj`) ve artık olmayan parça dosyalarını siler. Özet `.fxprj` + tüm parça dosyalarını kapsar; parça klasörleri de izlenir. Tek dosya biçimi `fxprj: 1` olarak kalır; klasör biçimine Dosya → *Klasör biçimine dönüştür…* ile geçilir (klasörde başka `.fxprj` ya da dolu `views/devices/scripts` varsa yapılmaz). Bir klasörde tek proje olmalı. Bağlantı ortamlarıyla birlikte kullanılınca cihaz dosyalarında bağlantı alanı olmaz.
- **Bağlantı ortamları (isteğe bağlı, ayrık düzen):** `.fxprj`'de `"connections": {"dir": "connections", "default": "dev"}` varsa harici cihazların `property`, `enabled`, `polling` alanları `.fxprj`'de **yoktur**; `connections/<ortam>.json` dosyasında cihaz kimliğine göre durur (`{"<id>": {"name", "enabled", "polling", "property"}}`, ada göre sıralı). Ekranlar, tag'ler ve sunucu içi cihaz `.fxprj`'de kalır. Açılışta `.fxprj` + etkin ortam birleştirilip yüklenir (`readDisk`); Kaydet ayırıp ikisine yazar (`writeDisk`; Farklı Kaydet başka klasöre diğer ortam dosyalarını da kopyalar). **Etkin ortam kişiye özeldir**: `<userData>/projects.json` (proje yoluna göre; son publish ortamı da orada), git'e girmez; `.fxprj`'de sadece `default`. Ayarlar → Bağlantı ortamı: ortam seçimi (temizse sadece `set-device`, kirliyse Kaydet/Kaydetme/İptal), Yeni ortam (etkin ortamın kaydedilmiş kopyası), eski düzenden geçiş ("Bağlantı ayarlarını ortam dosyasına taşı…" → `dev.json`, proje kaydedilir). Ortamda ayarı olmayan cihaz kapalı ve boş adresle yüklenir; publish'te HATA. Publish penceresinde ortam seçilir, README ortamı yazar. Etkin ortam dosyası da izlenir (dışarıdan değişiklik akışı aynı; özet iki dosyayı birlikte kapsar). `connections` alanı olmayan `.fxprj` eski düzendir ve olduğu gibi çalışır.
- Düz FUXA JSON'u (editörde *Save Project As*, eski `<ad>_live.json`) **Aç** ile içe aktarılır; ilk kayıtta `.fxprj` yolu sorulur.
- **Değişiklik takibi:** her 1,5 sn FUXA'daki projenin özeti dosyadakiyle karşılaştırılır + editördeki bekleyen düzenleme sayısı (§4). Kaydedilmemiş değişiklik varsa başlıkta `●`, Yeni/Aç/Kapat'ta "Kaydet / Kaydetme / İptal" sorulur.
- **Dışarıdan değişiklik (ajan/git/Syncthing):** açık `.fxprj`'in klasörü `fs.watch` ile izlenir (dosya değil klasör: atomik kayıtlar rename ile gelir; 700 ms bekleyip art arda yazmaları toplar). Dosya değişimi içerik özetiyle anlaşılır (`fxprj.fileHash`, `read().hash`, `write()` dönüşü); kendi kaydımız `cur.diskHash`'i güncellediği için tetiklemez. Değişiklik **sormadan, öğe öğe** uygulanır (`src/core/sync.js`): `diskBase→dosya` ile `liveBase→sunucu` farkları öğe düzeyinde (ekran, cihaz, script, …) üç yönlü birleştirilir; sonuç `/api/projectData` komutlarıyla (silmeler önce, cihaz/script ekrandan önce) gönderilir, sonra GET ile doğrulanır; tutmazsa (ör. `set-view` aynı adı atlar) ya da öğe dışı alan değiştiyse tüm proje gönderilir. Ekran/script değişikliği bağlantıları koparmaz; `set-device` sadece o cihazı yeniden başlatır. Editör kendi proje kopyasını tutup Kaydet'te tümünü geri yazdığı için sunucu değişince editör sayfası yeniden yüklenir (açık ekran localStorage'dan aynı açılır). Editördeki kaydedilmemiş başka öğeler korunur ve proje kirli kalır; sadece aynı öğe iki tarafta farklı değiştiyse "Diskteki hali al / Bendekini koru / Şimdilik hiçbirini alma" sorulur. Okunamayan (yarım yazılmış) dosya atlanır. Dosya → Diskten yeniden yükle tam yükleme yapar. Kaydet ve publish klasörü seçimi, alınmamış disk değişikliği varsa üzerine yazmadan önce sorar / durur.
- **Publish** kaydedilmiş hali yazar; kaydedilmemiş değişiklik varsa önce kaydettirir. Önce plan (klasör, dosyalar, lint) gösterilir; lint HATA varsa yazmaz. Çıktı: `<publish.dir>/<ad>/<ad>.json` + `README.md` (hedef makinede ☰ → *Open Project*, önce *Save Project As* ile yedek, cihaz/tag özeti).
- **Tag ekleme/düzenleme/silme** özgün Taglar ekranından yapılır; `.fxprj` dosyasına yazmak için Kaydet gerekir. Çekirdek `buildTag`, `tag:add` ve `tag:delete` API'leri korunur; ayrı düzenleme tablosu kullanılmaz.
- **Çekirdek tag silme API'si:** flush → GET → `prepareTagRemoval` → kullanım uyarılı onay → set-device → editörü yeniden yükleme. Özgün editörün silme işlemi kendi akışını kullanır; bu çekirdek API uyarısıyla aynı davranışı sağladığı varsayılmamalı.
- Yeni proje "Adsız" açılır; ilk kayıtta dosya adı proje adı olur.
- Tek örnek (single instance): ikinci açılış (ör. `.fxprj`'e çift tıklama) mevcut pencerede açar.
- Son projeler: `<userData>/recent.json` (en fazla 10).

## 4. Gömülü FUXA ve editör

- Node: paketlenmişte `resources/node/`, geliştirmede `vendor/node/` → PATH → `Program Files\nodejs`. FUXA: paketlenmişte `resources/fuxa/node_modules/@frangoteam/fuxa`, geliştirmede `fuxa-runtime/node_modules/...`.
- Electron'un kendi Node'u (`ELECTRON_RUN_AS_NODE`) kullanılmadı: FUXA'nın `sqlite3` gibi yerel modülleri Node ABI'siyle derli geliyor, Electron ABI'si için yeniden derlemek gerekirdi.
- FUXA `--userDir <userData>/fuxa` ile, **boş bir portta** başlar. `_appdata/settings.js` her açılışta yazılır: varsayılanlar + `uiHost: '127.0.0.1'` (ağa açılmaz) + `hideEditorOnboarding`. Günlük: `<logs>/engine.log` (Yardım → Günlük dosyasını aç).
- FUXA `<userData>/fuxa/fuxaw-boot.js` üzerinden çalışır: ana süreci (`FUXAW_PARENT_PID`) izler, o kapanınca (çökse bile) kendini kapatır. Normal çıkışta `will-quit` süreci ağacıyla kapatır.
- Editör `WebContentsView` içinde `/editor`. Sadece gömülü FUXA adresleri bu görünümde açılır; dış bağlantılar sistem tarayıcısına, FUXA'nın açtığı pencereler (ör. runtime) ayrı pencereye.
- Editörün kendi proje menüsü (☰ New/Save/Save As/Open/Rename, `button[title="Save Project"]`) CSS ile gizlidir; uygulamanın Dosya menüsüyle çakışır.
- **Editör çizim değişikliklerini sunucuya kendiliğinden göndermez**, kendi "Save Project"ine veya ekran değişimine kadar tutar. Bu yüzden:
  - Bekleyen düzenlemeler, svg-edit'in `undoMgr.addCommandToHistory`'sine bağlanan sayaçla (`window.__fxw.edits`) izlenir.
  - Kaydet'ten önce gizli menüdeki "Save Project" programla tıklanır (`flushEditor`; menü katmanı o an `opacity: 0`).
  - HTML kontrolünün width/height alanında yazılan değer, çizim alanının `mousedown` işlemi odağın değişmesini engellediği için seçim değişirken kaybolabilir. `editorDimensions.js` bu alanları seçim değişmeden önce editörün kendi `change` işlemiyle uygular; `flushEditor` de Kaydet öncesinde bekleyen boyutu uygular. Boyut alanları en fazla iki ondalık basamak gösterir (`80.00006` → `80`); bu gösterim düzeltmesi SVG geometrisini değiştirmez. Enter/Tab, geri alma ve kaydedip yeniden yükleme akışları korunur.
  - FUXA sürümü değişirse bu seçiciler (`button[title="Save Project"]`, `.mat-mdc-menu-item`, `svgEditor.canvas.undoMgr`) kontrol edilmeli.
  - Tag seçicisindeki metni boşaltmak eski tag kimliğini tutuyordu. `editorTagClear.js` başlatıcıda yalnız servis edilen ana betiği bellekte düzeltir; iki seçicide boş alan `variableId`'yi kaldırır. Orijinal paket dosyaları değişmez, arama metni yazmak mevcut bağlantıyı bozmaz. Düzeltme 1.3.4 ve beklenen iki kod noktasıyla sınırlıdır; sürüm değişiminde doğrulanmalıdır.
- **Sekmeler:** Editör çizimi, Taglar doğrudan özgün `/device` tag tablosunu, Bağlantılar özgün cihaz şemasını açar. Ctrl+1/2/4 aynı akışları kullanır. `editorDevices.js` (1.3.4 DOM kontrolleri) şema/tag tablosu arasında geçer; ilk girişte ilk harici cihazı, yoksa sunucu içi cihazı seçer. Son cihaz adı aynı proje açıkken hatırlanır, yeni/açılan projede sıfırlanır. Hedef cihazın DOM’a yüklenmesi beklenir. Kontrol → Proje kontrolü lint, Kontrol → Tag kullanımları arama/cihaz/kullanılmayan filtresi ve kullanım yerlerini gösterir. ADS ayarları özgün bağlantı ekleme/düzenleme penceresindedir: Type → ADS (fuxaw), Bağlantı yöntemi → Yerel TwinCAT / ADS-TCP. Type → ADSclient (orijinal) özgün sürücü/formu kullanır. Ayrı ADS formu ve menü girişi yoktur. `/editor`'dan ayrılmadan `flushEditor` çalışır. `show-tab` bildirimi yeniden navigasyon başlatmaz. Ctrl+5 `/plugins` sayfasını açar. Kontrol yanındaki Scriptler sekmesi ve Proje → Scriptler (Ctrl+6) özgün `/scripts` sayfasını açar; aynı gömülü görünüm `scriptsHost` sınırlarına yerleşir.
- **Özellik koruma:** uygulamanın ek arayüzü, özgün editördeki cihaz/tag yönetiminin yerini eksik bir uygulamayla almamalı. Yeni özellikler tam yönetimin üzerine eklenir; ADS yöntem seçimi özgün forma eklenir; `ADSclient` özgün sürücü için korunur, bizim eklenti `FuxawADS` türündedir. Eski `.fxprj` veya JSON açılırken yalnız `ADSclient` + açık `adsTransport` (native/tcp) cihazları `FuxawADS` türüne geçirilir; cihaz kimliği/tag/veri alanları korunur.
- Proje adı FUXA'nın `name` alanı değil, `.fxprj`'in `name` alanıdır.
- Proje açılınca FUXA cihazlara bağlanır (ADS vb.): açık proje bu makineden PLC'ye bağlanmaya çalışır. Test FUXA'sı olarak bu beklenen davranış.

### Yerel ajan kanalı (MCP)

- AI ajanı (ör. Claude Code) `src/mcp/bridge.js`'i MCP sunucusu olarak başlatır (`claude mcp add --scope user fuxaw -- "<node>" "<bridge.js>" --agent-file "<userData>/agent.json"`; komut Ayarlar → *AI ajan kurulumu…*'nda, kopyalanabilir). Köprü araç çağrılarını uygulamanın `127.0.0.1` kanalına (`agentServer.js`) iletir; port ve rastgele anahtar `agent.json`'dadır (her açılışta yenilenir, kapanınca silinir; zorla kapatmada kalırsa köprü `pid` ile anlar).
- Kanal **isteğe bağlıdır**: Ayarlar → *AI ajan bağlantısı (yerel)* (`<userData>/settings.json` → `agent`). Ağa açılmaz.
- Araçlar (`tools.js`): `get_project_info`, `get_view`, `put_view`, `delete_view`, `add_widgets`, `show_view`, `list_tags`, `add_tag`, `read_tag_values`, `get_script`, `put_script`, `delete_script`, `lint`. Kaydet/publish **yok**: ajan değişiklikleri canlı uygular, proje "kaydedilmedi" olur, dosyaya yazmak tasarımcının kararıdır.
- Uygulama: `app.live()` (bekleyen çizimleri aktarır + GET) → işleyici hedef projeyi kurar → `pushProject` (öğe öğe, §3 dışarıdan değişiklikle aynı yol) → editör yeniden yüklenir; `put_view` ekranı editörde açar (localStorage `@frango.webeditor.currentview`). Durum satırında "AI ajanı (saat): …".
- `add_widgets` şablonları (`widgets.js`): `momentary` (mousedown 1 / mouseup, mouseout 0), `set` (Boolean'a sadece 1/0), `toggle` (server script, tag adıyla; aynı tag için script tekrar oluşturulmaz), `lamp` (`svg-ext-shapes-rect`, aralık 0/1), `value` (fractionDigits), `label`. SVG/öğe biçimi editörün kaydettiği haldir; 2026-10-13'te gerçek editörde açılıp buton özellik/olay pencereleriyle doğrulandı. Yeni editör sürümünde kontrol edilmeli.
- Ajan çağrıları sıraya alınır ve uygulama boşa çıkınca (açık soru penceresi, kayıt) çalışır; en fazla ~60 sn bekler.
- Araç açıklamaları ve sunucu talimatları ajana yöneliktir; FUXA proje yapısını anlatmak için FUXA adı geçer (arayüz kuralının istisnası).

## 5. FUXA REST API (1.3.4, kimlik doğrulama yok, `secureEnabled: false`)

| İş                   | Çağrı                                                             |
| -------------------- | ----------------------------------------------------------------- |
| Tüm projeyi oku      | `GET /api/project`                                                |
| Tüm projeyi yaz      | `POST /api/project` (body = proje; editörde *Open Project* ile aynı) |
| Tag değerlerini oku  | `GET /api/getTagValue?ids=["t_...","t_..."]` (URL-encode)         |
| Proje parçası kaydet | `POST /api/projectData`, body `{"cmd": "<komut>", "data": {...}}` |
| Ayarlar (hazır mı)   | `GET /api/settings`                                               |
| Canlı tag değerleri  | `GET /api/getTagValue?ids=[...]` → `[{id, value, timestamp}]`     |

`/api/projectData` komutları: `set-view`, `set-device` (**sürücüyü yeniden başlatır**), `set-script`, `del-*`, `layout`, … `set-view` **aynı adlı başka ekran varsa sessizce atlar**. Kaynak: FUXA v1.3.4 `server/runtime/project/index.js` → `setProjectData`. FUXA komut satırı: `main.js --port N --userDir DİZİN`; `uiHost` sadece ayar dosyasından.

## 6. FUXA proje JSON yapısı (lint ve model için)

- Tag id `t_xxxxxxxx-xxxxxxxx`; ekran öğesi id önekleri: `HXB_` (html_button), `HXT_` (html_switch), `VAL_` (value), `HXI_` (html_input), `svg_` (şekil).
- Renk (`property.ranges`): button için `type: 2`, `color` = arka plan, `stroke` = yazı. Değer `Number(value)` ile karşılaştırılır (true→1). Yeni öğenin varsayılan aralığı `min 20 – max 80`, renk boş; Boolean'da hiç eşleşmez. Boolean için `{min:0,max:0}` / `{min:1,max:1}`.
- Ondalık: `ranges[0].fractionDigits = N`.
- HTML Button tag'e kendiliğinden yazmaz; `variableId` sadece okuma/renk. Yazma `property.events` ile:
  `{"type": "click"|"mousedown"|"mouseup"|"mouseout"|..., "action": "onSetValue"|"onRunScript"|..., "actparam": "...", "actoptions": {...}}`
  - Değer yaz: `onSetValue`, `actparam: "1"`, `actoptions: {"variable": {"variableId": "t_..."}}`
  - Script: `onRunScript`, `actparam: "<script id>"`, `actoptions: {"params": []}`
  - Momentary buton: `mousedown → "1"`, `mouseup → "0"`, `mouseout → "0"`.
- Event `actoptions.variable.variableRaw`: FUXA tag'in o anki kopyasını (value/timestamp dahil) buraya yazar. Proje verisidir, temizlenmez; sadece event düzenlenince değişir.
- Script objesi: `{"id","name","code","sync":false,"parameters":[],"mode":"SERVER"}`. Server script'te `$getTag(id)`, `await $setTag(id, v)`, `$getTagId('<tag adı>', '<cihaz adı>')`. Kullanıcı tercihi: script'lerde tag id değil **tag adı** (`$getTagId`) kullanılır; lint bu adların var olduğunu kontrol eder.
- Editör bir cihaz eklenince FUXA Server cihazına `<cihaz> Connection Status` tag'i ekler.

## 7. Tuzaklar (lint kuralları bunlardan türetildi)

1. **Boolean ADS tag'inde "Toggle value" kullanma** (FUXA 1.3.4 hatası): client `"false"` metnini gönderir, ADS sürücüsü `_toValue`'da `'boolean'` ile karşılaştırır ama tip `"Boolean"` olduğundan dönüşüm atlanır, `ads-client` `value ? 1 : 0` ile yazdığı için `"false"` TRUE olur. Aynı hata *Set value*'da `True`/`False` yazınca da var. Boolean ADS tag'ine yazılan değer **her zaman `1`/`0`** olmalı ya da server script gerçek boolean yazmalı.
2. Switch (`html_switch`) `"0"`/`"1"` gönderdiği için sorunsuz.
3. Olmayan tag'e bağlı öğe, olmayan script'e bağlı event, aynı adlı iki ekran (`set-view` atlar) → lint hatası.
4. Editör bir ekranı açınca `svgcontent`'i yeniden yazar, öznitelik sırası değişir (`id x y` → `y x id`). Değişiklik takibi bunu `normalizeSvg` ile yok sayar; yoksa her açılışta "kaydedilmedi" görünür.

Yeni bir FUXA tuzağı öğrenildiğinde mümkünse `lint.js`'ye kural ve `tests/core.test.js`'ye örnek ekle.

## 8. Bilinen ortam kısıtları

- **Claude'un komutları sandbox'ta çalışır:** araçla başlatılan süreçler araç bitince kapanabilir; uzun süre açık kalacak uygulamayı `run_in_background` ile başlat. Pencereyi görmek için computer-use'ta uygulama adı `electron.exe` (geliştirme) veya `fuxaw.exe` (paket).
- Paketleyici Electron'u ayrıca zip olarak indirmesin diye `build.electronDist` = `node_modules/electron/dist` (`npm install`'ın indirdiği kopya). Bu sadece aynı platform için paket üretir; başka işletim sistemi için paketlerken bu ayar kaldırılmalı/üzerine yazılmalı.
- Git Bash'teki `tar`, `C:\...` yolunu uzak sunucu sanar; `fetch-node.js` Windows'ta `System32\tar.exe` kullanır.
- npm 11 bağımlılıkların kurulum betiklerini ("allow-scripts") çalıştırmıyor: Electron ikili dosyası bu yüzden `postinstall`'da `node node_modules/electron/install.js` ile iner. FUXA'nın `sqlite3`'ü hazır derlenmiş `node_sqlite3.node` ile geliyor, sorun yok.
- Eski Python sürümünün `%LOCALAPPDATA%\fuxaw\fuxa` altına kurduğu FUXA (port 1881) bu uygulamayla ilgisiz; isteyen silebilir.

## 9. Yol haritası

1. Masaüstü uygulaması iskeleti ✅ (2026-10-02): pencere + menü, Yeni/Aç/Kaydet/Farklı Kaydet/Son Projeler, `.fxprj`, gömülü FUXA + editör, değişiklik takibi, Publish (klasöre), Taglar, Kontrol (lint), runtime önizleme, Windows paketi (`dist:dir`) denendi.
2. Paket: uygulama simgesi, NSIS kurulum paketini dene, Linux/macOS'ta derle ve dene, paket boyutunu küçült (FUXA'nın kullanılmayan bağımlılıkları; şu an açık hali ~675 MB).
3. Tag düzenleme (ekleme ✅ 2026-10-02, silme ✅ 2026-10-06; yeniden adlandır, adres değiştir; ad değişince script'lerdeki `$getTagId` adlarını da güncelle), script editörü, buton sihirbazları (toggle/momentary/lamba).
4. Çökme sonrası kurtarma (FUXA veri klasöründe kalan kaydedilmemiş hali önerme).
5. TwinCAT değişken seçici (GVL'den), ek lint kuralları.
6. Dışarıdan düzenleme ✅ (2026-10-13): canlı öğe öğe birleştirme, bağlantı ortamları, klasör biçimi. Yerel ajan kanalı (MCP) ✅ (2026-10-13). Ekran şablonları (ajan için) ✅ (2026-10-13). Sırada: şablonları kullanıcı arayüzüne de ekleme, ajan için bağlantı/ortam araçları.
