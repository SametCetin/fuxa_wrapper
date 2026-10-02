# AGENTS.md – fuxaw (FUXA proje wrapper'ı) geliştirme kuralları

Bu dosya, bu klasörde çalışan AI asistanlar (Claude Code vb.) ve geliştiriciler için yazıldı. Kullanım ve genel bakış: [README.md](README.md).

Kullanıcıyla Türkçe konuş.

Bu repo sadece **wrapper kodunu** içerir. Wrapper'ın yönettiği FUXA projeleri ayrı bir repoda:
`C:\sct\syncthing\sc_genel\fuxa_projects` (ör. `fuxa_project1/`, TwinCAT TC294_35 HMI'si). O projeye ait bilgiler (tag/ekran tabloları, PLC referansı, değişiklik geçmişi, açık konular) oradaki `AGENTS.md` ve `README.md`'dedir.

**Çalışma şekli (kullanıcının kararı, 2026-10-02):**
- fuxaw **sadece bu makinedeki FUXA'ya** (127.0.0.1/localhost) publish eder; bu test içindir (`fuxaw designer` ile kurulan yerel FUXA).
- Hedef makineye ağ üzerinden **hiçbir şey gönderilmez**. SSH/tünel desteği tamamen silindi; geri ekleme. `target.py` yerel olmayan adresi ve `ssh` alanını reddeder.
- Hedef makine için `fuxaw export` proje JSON'unu ve nereye/nasıl koyulacağını anlatan README'yi bir klasöre yazar; klasör elle taşınır. Basit tut.

> Geçmiş: wrapper 2026-10-02'de `fuxa_projects/wrapper/` altında yazıldı, aynı gün bu repoya (`C:\sct\syncthing\repohf_sync\fuxa_wrapper`) taşındı.

## 1. Kod yapısı

- Sadece Python standart kütüphanesi (3.12, ek paket yok).
- `fuxaw/model.py`: proje JSON ↔ öğeler (cihaz, ekran, script, layout…), normalize etme.
- `fuxaw/store.py`: proje klasörü: `fuxaw.json` (ayarlar), `src/` (öğe başına dosya), `.fuxaw/` (senkron durumu), export JSON'ları. `find_project` cwd'den yukarı doğru, sonra bir alt klasörde `fuxaw.json` arar.
- `fuxaw/target.py`: yerel test FUXA'sı: REST çağrıları, yedek (proje klasöründe `.fuxaw/backups`). Adres yerel değilse hata.
- `fuxaw/designer.py`: yerel FUXA: Node.js/FUXA kontrolü ve kurulumu, başlatma/durdurma (bkz. §4).
- `fuxaw/sync.py`: yerel / hedef / taban üçlü karşılaştırma, publish planı, pull birleştirme.
- `fuxaw/lint.py`: aşağıdaki "Tuzaklar"ın kural hali + kırık tag/script referansları.
- `fuxaw/ops.py`: CLI ve arayüzün **ortak** işlemleri (status, diff, pull, publish, export, tag tablosu). İlerleme `log` ile verilir, sonuç `{"rc": ...}` sözlüğü. İş mantığı buraya yazılır; cli.py ve web.py sadece sunar.
- `fuxaw/cli.py`: komutlar (`status`, `diff`, `pull`, `publish`, `lint`, `build`, `backup`, `init`, `designer`, `ui`).
- `fuxaw/web.py` + `fuxaw/static/`: web arayüzü (bkz. §4b). Derleme adımı yok; düz HTML/CSS/JS.
- `fuxaw.cmd`: başlatıcı (`PYTHONPATH` = bu klasör). Proje reposundan çağrılır.

## 2. Test

```bash
python -m unittest discover -s tests -v
```

(repo kökünden). Testler `tests/mock_fuxa.py` sahte sunucusunu ve `tests/fixtures/fuxa1_live.json` (gerçek projenin kopyası) dosyasını kullanır; gerçek FUXA gerekmez. Sahte sunucu FUXA'nın bilinen davranışlarını taklit eder (her GET'te tag value/timestamp değişir, aynı adlı ekran sessizce atlanır). FUXA'da yeni bir davranış öğrenirsen sahte sunucuya ve teste de ekle. `test_web.py` arayüz sunucusunu rastgele portta açıp API'yi ve güvenlik kontrollerini dener. Durum: 25 test geçiyor (2026-10-02).

## 3. Tasarım kararları

- **Üç hal:** her öğe yerel (`src/`), hedef (yerel test FUXA'sı) ve taban (son pull/publish, `.fuxaw/base.json`) olarak karşılaştırılır. Sadece yerelde değişen → publish; sadece hedefte → pull (publish dokunmaz); ikisinde → çakışma, durur.
- Tag `value`/`timestamp` karşılaştırmada yok sayılır ve `src/`'ye yazılmaz; publish'te hedefteki değerler cihaz objesine geri konur.
- Publish: `.fuxaw/backups/backup_before_fuxaw_<tarih_saat>.json` yedeği → sadece değişen öğeler → tekrar okuyup doğrulama → export JSON'larını (`<ad>_live.json`, `<ad>-devices_live.json`) güncelleme. Lint hatası veya çakışmada durur; `--force`/`--no-lint` sadece kullanıcı isterse.
- Çıkış kodları: 0 tamam, 1 hata/ulaşılamadı/lint hatası, 2 durduruldu (çakışma, lint, onay yok), 3 gönderim yarıda kaldı veya doğrulama tutmadı.
- `.fuxaw/base.json` silinirse "taban yok" denir ve her fark çakışma sayılır; `pull --force` (hedef doğru) veya `publish --force` (yerel doğru) ile yeniden kurulur.
- `src/` dosyaları LF ve girintili JSON yazılır (`.gitattributes` bununla uyumlu olmalı).
- **Publish sırası:** ekran silmeleri → set'ler (cihaz, script, …, ekran, layout) → diğer silmeler. Ekran silmeleri önce, çünkü FUXA `set-view`'ı aynı adlı başka ekran varken sessizce atlar (ör. hedefteki "MainView" yerelde farklı id ile yeniden oluşturulmuşsa). Bu hata 2026-10-02'de görüldü.
- **Export** (`ops.export`): lint (hata varsa durur) → `<proje>/publish/<ad>/<ad>.json` (`model.join_project`, FUXA editöründe ☰ → *Open Project* ile açılır; editör bunu `POST /api/project` ile kaydeder, yerel FUXA'da birebir aynı yüklendiği doğrulandı) + `README.md` (hedef makinede nereye/nasıl: klasörü kopyala, önce *Save Project As...* ile yedek, sonra *Open Project*; cihaz/tag özeti). Çıktı klasörü `-o` ile değişir.

## 4. Yerel designer (`fuxaw designer`)

- `fuxaw designer [start|stop|status] [--port 1881] [--fuxa-version 1.3.4] [-y] [--no-browser]`. Proje gerektirmez.
- Açılışta kontrol: Node.js (önce uygulama klasörü, sonra PATH, `Program Files\nodejs`). Yoksa **winget** ile `OpenJS.NodeJS.LTS` kurulur (MSI, UAC onayı ister). winget yoksa veya başarısızsa nodejs.org'dan en yeni LTS win-x64 zip'i uygulama klasörüne açılır (yönetici izni gerekmez). winget'i uygulamaya gömmek yerine bu yol seçildi: winget'in MSIX paketi VCLibs/UI.Xaml bağımlılıkları ve App Installer kaydı ister, LTSC/Server sürümlerinde sorun çıkarır.
- FUXA npm ile `%LOCALAPPDATA%\fuxaw\fuxa` altına kurulur (global değil). Sürüm farklıysa yeniden kurulur. Kurulumlar onay ister; `-y` onayı atlar.
- FUXA `node main.js --port N` ile, cwd = `%LOCALAPPDATA%\fuxaw\data` (proje verisi `data\_appdata`), ayrık süreç olarak başlar; çıktı `logs\fuxa.log`, pid `designer.json`. `/api/settings` cevap verince hazır sayılır, tarayıcıda `/editor` açılır. `stop` sadece fuxaw'ın başlattığı süreci kapatır.
- Uygulama klasörü `FUXAW_DATA` ortam değişkeniyle değiştirilebilir.
- 2026-10-02 bu makinede denendi: winget → Node.js v24.19.0, FUXA 1.3.4 npm ile kuruldu ve çalıştı. npm 11, `sqlite3` kurulum betiğini "allow-scripts" yüzünden çalıştırmadı ama paket hazır derlenmiş `node_sqlite3.node` ile geliyor; proje kaydetme/okuma API ile doğrulandı.

## 4b. Web arayüzü (`fuxaw ui`)

- `fuxaw ui [--root DIR]... [--port 8765] [--no-browser]`. `ThreadingHTTPServer`, sadece `127.0.0.1`. Uçlar ve açıklamaları `web.py` başındaki docstring'de.
- **Güvenlik:** Host başlığı `127.0.0.1:<port>`/`localhost:<port>` değilse 403 (DNS rebinding). POST'lar `X-Fuxaw: 1` başlığı ister; başka bir sitenin tarayıcı üzerinden publish/pull tetiklemesini engeller (özel başlık CORS ön kontrolü gerektirir, sunucu CORS'a izin vermez). `path` parametresi sadece bulunan projelerden biri olabilir. Bu kontrolleri gevşetme; yerel FUXA da PLC'ye bağlı olabilir.
- Yazan işlemler (`pull`, `publish`, `export`, designer start) tek kilitle sırayla çalışır.
- Arayüzde onay her zaman önce dry-run planı gösterilerek alınır; `--no-lint` arayüzde yok. Çakışmada "Zorla gönder" / "Hedefteki hali al" seçenekleri uyarıyla sunulur.
- Proje arama kökleri: komut satırı `--root` + `%LOCALAPPDATA%\fuxaw\ui.json` (arayüzden eklenenler). Kök ve 2 alt seviye taranır (`.git`, `node_modules`, `src`, `.fuxaw` atlanır).
- Metinler DOM'a hep `textContent` ile basılır (`el()` yardımcısı); `innerHTML` kullanma (proje/tag adları dışarıdan gelir).

## 5. FUXA REST API (1.3.4, kimlik doğrulama yok, `secureEnabled: false`)

| İş                   | Çağrı                                                             |
| -------------------- | ----------------------------------------------------------------- |
| Tüm projeyi oku      | `GET /api/project`                                                |
| Tag değerlerini oku  | `GET /api/getTagValue?ids=["t_...","t_..."]` (URL-encode)         |
| Proje parçası kaydet | `POST /api/projectData`, body `{"cmd": "<komut>", "data": {...}}` |
| Ayarlar              | `GET /api/settings`                                               |

`/api/projectData` komutları: `set-view` (tam view objesi), `set-device` (tam device objesi; **sürücüyü yeniden başlatır**, ADS bağlantısı ~1 sn kopar), `set-script`, `del-script`, `del-view`, `del-device`, `layout`. Ayrıca `set-/del-text`, `-alarm` (anahtar `name`), `-notification`, `-report`, `-maps-location`, `-ar-marker` ve tekil `charts`, `graphs`, `languages`, `client-access`. Silme komutları `data.id`'ye bakar. `set-view` **aynı adlı başka ekran varsa sessizce atlar** (hata dönmez). `name`, `version`, `server` ve `ar.enabled` bu API ile yazılamaz. Kayıt anında canlıya yansır; açık runtime sayfasının yenilenmesi gerekir. Kaynak: FUXA v1.3.4 `server/runtime/project/index.js` → `setProjectData`.

Kullanıcı FUXA editörünü açık tutup eski haliyle kaydederse API ile yazılanlar ezilir (fuxaw bunu bir sonraki `status`'ta `[pull]`/`[ÇAKIŞMA]` olarak görür).

## 6. FUXA proje JSON yapısı (lint ve model için)

- Tag id `t_xxxxxxxx-xxxxxxxx`; ekran öğesi id önekleri: `HXB_` (html_button), `HXT_` (html_switch), `VAL_` (value), `HXI_` (html_input), `svg_` (şekil).
- Renk (`property.ranges`): button için `type: 2`, `color` = arka plan, `stroke` = yazı. Değer `Number(value)` ile karşılaştırılır (true→1). Yeni öğenin varsayılan aralığı `min 20 – max 80`, renk boş; Boolean'da hiç eşleşmez. Boolean için `{min:0,max:0}` / `{min:1,max:1}`.
- Ondalık: `ranges[0].fractionDigits = N`.
- HTML Button tag'e kendiliğinden yazmaz; `variableId` sadece okuma/renk. Yazma `property.events` ile:
  `{"type": "click"|"mousedown"|"mouseup"|"mouseout"|..., "action": "onSetValue"|"onRunScript"|..., "actparam": "...", "actoptions": {...}}`
  - Değer yaz: `onSetValue`, `actparam: "1"`, `actoptions: {"variable": {"variableId": "t_..."}}`
  - Script: `onRunScript`, `actparam: "<script id>"`, `actoptions: {"params": []}`
  - Momentary buton: `mousedown → "1"`, `mouseup → "0"`, `mouseout → "0"`.
- Script objesi: `{"id","name","code","sync":false,"parameters":[],"mode":"SERVER"}`. Server script'te `$getTag(id)`, `await $setTag(id, v)`, `$getTagId('<tag adı>', '<cihaz adı>')`. Kullanıcı tercihi: script'lerde tag id değil **tag adı** (`$getTagId`) kullanılır; lint bu adların var olduğunu kontrol eder.

## 7. Tuzaklar (lint kuralları bunlardan türetildi)

1. **Boolean ADS tag'inde "Toggle value" kullanma** (FUXA 1.3.4 hatası): client `"false"` metnini gönderir, ADS sürücüsü `_toValue`'da `'boolean'` ile karşılaştırır ama tip `"Boolean"` olduğundan dönüşüm atlanır, `ads-client` `value ? 1 : 0` ile yazdığı için `"false"` TRUE olur. Aynı hata *Set value*'da `True`/`False` yazınca da var. Boolean ADS tag'ine yazılan değer **her zaman `1`/`0`** olmalı ya da server script gerçek boolean yazmalı.
2. Switch (`html_switch`) `"0"`/`"1"` gönderdiği için sorunsuz.
3. Olmayan tag'e bağlı öğe, olmayan script'e bağlı event, aynı adlı iki ekran (`set-view` atlar) → lint hatası.

Yeni bir FUXA tuzağı öğrenildiğinde mümkünse `lint.py`'ye kural, `mock_fuxa.py`'ye davranış ve teste örnek olarak ekle.

## 8. Bilinen ortam kısıtları

- Claude'un FUXA kurulum dosyalarına (`node_modules\@frangoteam\fuxa\...`) yazması izin sisteminde engelli olabilir; yama gerekiyorsa satırı ve değişikliği kullanıcıya ver, kullanıcı yapsın, sonra okuyarak doğrula.
- FUXA veriyi çalışma klasöründeki `_appdata`'ya yazar; başka klasörden başlatılırsa boş proje açılır (veri silinmez). `designer.py` bu yüzden FUXA'yı hep `data\` klasöründen başlatır.

## 9. Yol haritası

1. Çekirdek CLI ✅ (2026-10-02, sahte sunucuyla test edildi)
2. Yerel designer ✅ (2026-10-02): `fuxaw designer` bileşenleri kurar, FUXA'yı başlatır, editörü açar.
3. Web arayüzü 1. sürüm ✅ (2026-10-02): proje seçimi, durum/fark, pull/publish (plan + onay), export, tag tablosu (filtre, çoklu seçim, kullanım yerleri), lint, designer kontrolü. Tarayıcıda yerel FUXA'ya karşı denendi.
   Sadece yerel publish + klasöre export modeline geçildi ✅ (2026-10-02; SSH silindi).
4. Web arayüzü 2. sürüm: tag düzenleme (ekle/yeniden adlandır, adresi değiştir; ad değişince script'lerdeki `$getTagId` adlarını da güncelle), script editörü, buton sihirbazları (toggle/momentary/lamba), arayüzden yeni proje (`init`).
5. TwinCAT değişken seçici (GVL'den), ek lint kuralları.
