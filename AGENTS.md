# AGENTS.md – fuxaw (FUXA proje wrapper'ı) geliştirme kuralları

Bu dosya, bu klasörde çalışan AI asistanlar (Claude Code vb.) ve geliştiriciler için yazıldı. Kullanım ve genel bakış: [README.md](README.md).

Kullanıcıyla Türkçe konuş.

Bu repo sadece **wrapper kodunu** içerir. Wrapper'ın yönettiği FUXA projeleri ayrı bir repoda:
`C:\sct\syncthing\sc_genel\fuxa_projects` (ör. `fuxa_project1/`, TwinCAT TC294_35 HMI'si). O projeye ait bilgiler (tag/ekran tabloları, PLC referansı, değişiklik geçmişi, açık konular) oradaki `AGENTS.md` ve `README.md`'dedir. Canlı FUXA'ya dokunan işlerde önce o dosyaları oku.

> Geçmiş: wrapper 2026-10-02'de `fuxa_projects/wrapper/` altında yazıldı, aynı gün bu repoya (`C:\sct\syncthing\repohf_sync\fuxa_wrapper`) taşındı.

## 1. Kod yapısı

- Sadece Python standart kütüphanesi (3.12, ek paket yok).
- `fuxaw/model.py`: proje JSON ↔ öğeler (cihaz, ekran, script, layout…), normalize etme.
- `fuxaw/store.py`: proje klasörü: `fuxaw.json` (ayarlar), `src/` (öğe başına dosya), `.fuxaw/` (senkron durumu), export JSON'ları. `find_project` cwd'den yukarı doğru, sonra bir alt klasörde `fuxaw.json` arar.
- `fuxaw/target.py`: hedef FUXA: SSH tüneli, REST çağrıları, hedefte yedek.
- `fuxaw/sync.py`: yerel / hedef / taban üçlü karşılaştırma, publish planı, pull birleştirme.
- `fuxaw/lint.py`: aşağıdaki "Tuzaklar"ın kural hali + kırık tag/script referansları.
- `fuxaw/cli.py`: komutlar (`status`, `diff`, `pull`, `publish`, `lint`, `build`, `backup`, `init`).
- `fuxaw.cmd`: başlatıcı (`PYTHONPATH` = bu klasör). Proje reposundan çağrılır.

## 2. Test

```bash
python -m unittest discover -s tests -v
```

(repo kökünden). Testler `tests/mock_fuxa.py` sahte sunucusunu ve `tests/fixtures/fuxa1_live.json` (gerçek projenin kopyası) dosyasını kullanır; hypervm gerekmez. Sahte sunucu FUXA'nın bilinen davranışlarını taklit eder (her GET'te tag value/timestamp değişir, aynı adlı ekran sessizce atlanır). FUXA'da yeni bir davranış öğrenirsen sahte sunucuya ve teste de ekle. Durum: 11 test geçiyor (2026-10-02).

## 3. Tasarım kararları

- **Üç hal:** her öğe yerel (`src/`), hedef (canlı FUXA) ve taban (son pull/publish, `.fuxaw/base.json`) olarak karşılaştırılır. Sadece yerelde değişen → publish; sadece hedefte → pull (publish dokunmaz); ikisinde → çakışma, durur.
- Tag `value`/`timestamp` karşılaştırmada yok sayılır ve `src/`'ye yazılmaz; publish'te hedefteki değerler cihaz objesine geri konur.
- Publish: hedefte `backup_before_fuxaw_<tarih_saat>.json` yedeği → sadece değişen öğeler → tekrar okuyup doğrulama → export JSON'larını (`<ad>_live.json`, `<ad>-devices_live.json`) güncelleme. Lint hatası veya çakışmada durur; `--force`/`--no-lint` sadece kullanıcı isterse.
- Çıkış kodları: 0 tamam, 1 hata/ulaşılamadı/lint hatası, 2 durduruldu (çakışma, lint, onay yok), 3 gönderim yarıda kaldı veya doğrulama tutmadı.
- `.fuxaw/base.json` silinirse "taban yok" denir ve her fark çakışma sayılır; `pull --force` (hedef doğru) veya `publish --force` (yerel doğru) ile yeniden kurulur.
- **SSH tüneli:** `local_port`'ta (varsayılan 11881) zaten tünel varsa onu kullanır, yoksa kendi `ssh -N` sürecini açar ve iş bitince **sadece onu** kapatır. Uzak tarafta `127.0.0.1` kullanılır (`localhost` ::1'e gidiyor, FUXA orada dinlemiyor).
- `src/` dosyaları LF ve girintili JSON yazılır (`.gitattributes` bununla uyumlu olmalı).

## 4. FUXA REST API (1.3.4, kimlik doğrulama yok, `secureEnabled: false`)

| İş                   | Çağrı                                                             |
| -------------------- | ----------------------------------------------------------------- |
| Tüm projeyi oku      | `GET /api/project`                                                |
| Tag değerlerini oku  | `GET /api/getTagValue?ids=["t_...","t_..."]` (URL-encode)         |
| Proje parçası kaydet | `POST /api/projectData`, body `{"cmd": "<komut>", "data": {...}}` |
| Ayarlar              | `GET /api/settings`                                               |

`/api/projectData` komutları: `set-view` (tam view objesi), `set-device` (tam device objesi; **sürücüyü yeniden başlatır**, ADS bağlantısı ~1 sn kopar), `set-script`, `del-script`, `del-view`, `del-device`, `layout`. Ayrıca `set-/del-text`, `-alarm` (anahtar `name`), `-notification`, `-report`, `-maps-location`, `-ar-marker` ve tekil `charts`, `graphs`, `languages`, `client-access`. Silme komutları `data.id`'ye bakar. `set-view` **aynı adlı başka ekran varsa sessizce atlar** (hata dönmez). `name`, `version`, `server` ve `ar.enabled` bu API ile yazılamaz. Kayıt anında canlıya yansır; açık runtime sayfasının yenilenmesi gerekir. Kaynak: FUXA v1.3.4 `server/runtime/project/index.js` → `setProjectData`.

Kullanıcı FUXA editörünü açık tutup eski haliyle kaydederse API ile yazılanlar ezilir (fuxaw bunu bir sonraki `status`'ta `[pull]`/`[ÇAKIŞMA]` olarak görür).

## 5. FUXA proje JSON yapısı (lint ve model için)

- Tag id `t_xxxxxxxx-xxxxxxxx`; ekran öğesi id önekleri: `HXB_` (html_button), `HXT_` (html_switch), `VAL_` (value), `HXI_` (html_input), `svg_` (şekil).
- Renk (`property.ranges`): button için `type: 2`, `color` = arka plan, `stroke` = yazı. Değer `Number(value)` ile karşılaştırılır (true→1). Yeni öğenin varsayılan aralığı `min 20 – max 80`, renk boş; Boolean'da hiç eşleşmez. Boolean için `{min:0,max:0}` / `{min:1,max:1}`.
- Ondalık: `ranges[0].fractionDigits = N`.
- HTML Button tag'e kendiliğinden yazmaz; `variableId` sadece okuma/renk. Yazma `property.events` ile:
  `{"type": "click"|"mousedown"|"mouseup"|"mouseout"|..., "action": "onSetValue"|"onRunScript"|..., "actparam": "...", "actoptions": {...}}`
  - Değer yaz: `onSetValue`, `actparam: "1"`, `actoptions: {"variable": {"variableId": "t_..."}}`
  - Script: `onRunScript`, `actparam: "<script id>"`, `actoptions: {"params": []}`
  - Momentary buton: `mousedown → "1"`, `mouseup → "0"`, `mouseout → "0"`.
- Script objesi: `{"id","name","code","sync":false,"parameters":[],"mode":"SERVER"}`. Server script'te `$getTag(id)`, `await $setTag(id, v)`, `$getTagId('<tag adı>', '<cihaz adı>')`. Kullanıcı tercihi: script'lerde tag id değil **tag adı** (`$getTagId`) kullanılır; lint bu adların var olduğunu kontrol eder.

## 6. Tuzaklar (lint kuralları bunlardan türetildi)

1. **Boolean ADS tag'inde "Toggle value" kullanma** (FUXA 1.3.4 hatası): client `"false"` metnini gönderir, ADS sürücüsü `_toValue`'da `'boolean'` ile karşılaştırır ama tip `"Boolean"` olduğundan dönüşüm atlanır, `ads-client` `value ? 1 : 0` ile yazdığı için `"false"` TRUE olur. Aynı hata *Set value*'da `True`/`False` yazınca da var. Boolean ADS tag'ine yazılan değer **her zaman `1`/`0`** olmalı ya da server script gerçek boolean yazmalı.
2. Switch (`html_switch`) `"0"`/`"1"` gönderdiği için sorunsuz.
3. Olmayan tag'e bağlı öğe, olmayan script'e bağlı event, aynı adlı iki ekran (`set-view` atlar) → lint hatası.

Yeni bir FUXA tuzağı öğrenildiğinde mümkünse `lint.py`'ye kural, `mock_fuxa.py`'ye davranış ve teste örnek olarak ekle.

## 7. Hedef ortam (bilgi)

- Varsayılan hedef: `ssh hypervm` (Windows, uzak shell cmd.exe), FUXA 1.3.4 port 1881, dışarıdan sadece SSH tüneliyle. Ayrıntılar proje reposunun README'sinde.
- FUXA kurulum dosyalarına (hypervm, `node_modules\@frangoteam\fuxa\...`) Claude'un yazması izin sisteminde engelli; yama gerekiyorsa kullanıcıya ver.

## 8. Yol haritası

1. Çekirdek CLI ✅ (2026-10-02, sahte sunucuyla test edildi)
2. **Gerçek hedefle doğrulama** (açık): hypervm 2026-10-02'de SSH'a cevap vermiyordu; proje `init --from-file` ile kuruldu. hypervm açılınca proje reposunda `fuxaw status` → gerekirse `fuxaw pull` → zararsız bir değişiklikle `publish -n` / `publish`.
3. Web arayüzü: tag tablosu (çoklu seçim, kullanım yerleri), script editörü, buton sihirbazları (toggle/momentary/lamba), üst barda proje/hedef durumu.
4. Staging FUXA (hypervm'de ikinci örnek, ayrı port ve `_appdata`) ile tasarım/önizleme.
5. TwinCAT değişken seçici (GVL'den), ek lint kuralları.
