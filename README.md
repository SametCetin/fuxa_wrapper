# fuxaw – FUXA proje wrapper'ı

FUXA editöründe zor olan işleri (tag listesi, kaydetme, "sunucuda mı projede mi" belirsizliği) proje bazlı, git'e uygun bir akışa çevirir. **Proje** = `fuxaw.json` içeren bir klasör (git'te). **Hedef** = çalışan FUXA (yerelde `fuxaw designer` ile kurulan, ya da uzak bir makinede). Hedefe sadece `publish` ile yazılır. Uzak hedefte SSH tünelini kendisi açıp kapatır.

## Hızlı başlangıç: web arayüzü

```bash
fuxaw ui --root C:\sct\syncthing\sc_genel\fuxa_projects
```

Tarayıcıda `http://127.0.0.1:8765` açılır (sadece bu makineden erişilir, kapatmak için Ctrl+C). Sekmeler:

- **Değişiklikler:** yerel / hedef karşılaştırması, öğeye tıklayınca fark (script kodu satır satır). Üst bardan Pull / Publish: önce plan ve lint gösterilir, onaylayınca gönderilir. Çakışmada ne yapılacağı sorulur.
- **Taglar:** tüm tag'ler; arama, cihaz/tip filtresi, "kullanılmayanlar". Kullanım sayısına tıklayınca tag'in hangi ekran öğesinde, hangi event'te ya da script'te kullanıldığı görünür. Seçilenler Excel'e yapıştırılabilir şekilde kopyalanır.
- **Lint:** bilinen FUXA tuzakları ve kırık referanslar.
- **Designer:** yerel FUXA'yı kur/başlat/durdur, editörü aç, seçili projeyi yerel FUXA'ya yükle (projenin hedefine dokunmaz).
- **Projeler:** proje arama kökleri (eklenen kökler `%LOCALAPPDATA%\fuxaw\ui.json`'da saklanır).

`--root` verilmezse bulunulan klasör (proje klasöründeysen onun üstü) aranır. `--port`, `--no-browser` da var.

## Hızlı başlangıç: yerel designer

```bash
fuxaw designer
```

Açılışta Node.js ve FUXA'yı kontrol eder. Eksik olanı onay alarak kurar: Node.js winget ile (winget yoksa nodejs.org'dan taşınabilir zip), FUXA npm ile `%LOCALAPPDATA%\fuxaw` altına. Sonra FUXA'yı arka planda başlatır ve tarayıcıda editörü açar (`http://127.0.0.1:1881/editor`).

```
fuxaw designer status   bileşenler ve çalışma durumu
fuxaw designer stop     fuxaw'ın başlattığı FUXA'yı durdur
fuxaw designer -y --port 1882 --no-browser --fuxa-version 1.3.4
```

AI asistanlar ve geliştiriciler için kod yapısı, tasarım kararları, FUXA API notları ve tuzaklar: **[AGENTS.md](AGENTS.md)**.

Yönetilen projeler ayrı repoda: `C:\sct\syncthing\sc_genel\fuxa_projects` (ör. `fuxa_project1`, TwinCAT TC294_35 HMI'si).

## Klasör yapısı

```
fuxa_wrapper/
├─ README.md / AGENTS.md / CLAUDE.md
├─ fuxaw.cmd                    ← başlatıcı (PYTHONPATH = bu klasör)
├─ fuxaw/                       ← Python paketi (sadece standart kütüphane, 3.12)
│  ├─ cli.py  ops.py  model.py  store.py  sync.py  target.py  lint.py  designer.py  web.py
│  └─ static/                   ← web arayüzü (index.html, app.css, app.js; derleme yok)
└─ tests/
   ├─ test_fuxaw.py             ← uçtan uca testler (CLI)
   ├─ test_web.py               ← web API ve güvenlik kontrolleri
   ├─ test_designer.py          ← yerel FUXA bileşen bulma
   ├─ mock_fuxa.py              ← sahte FUXA sunucusu
   └─ fixtures/fuxa1_live.json  ← gerçek projenin kopyası (test verisi)
```

## Kullanım

Proje klasöründe veya onun bir üstünde (proje reposunun kökü) çalıştırılır; birden fazla proje varsa `-p <klasör>`:

```
fuxaw status          yerel / hedef karşılaştırması ([publish] [pull] [ÇAKIŞMA]); -a: aynıları da göster
fuxaw diff [MainView] değişen öğelerin JSON farkı (--base: hedefe bağlanmadan, son senkrona göre)
fuxaw pull            hedefteki değişiklikleri (ör. editörde kaydedilenleri) src/'ye al
fuxaw lint            bilinen FUXA tuzakları + kırık tag/script referansları
fuxaw publish -n      ne gönderileceğini göster (dry-run)
fuxaw publish         yedek al → sadece değişenleri gönder → tekrar okuyup doğrula
fuxaw build           src/'den <ad>_live.json üret (editörde Import project için)
fuxaw backup          hedefte elle yedek al
fuxaw init <klasör> --url http://127.0.0.1:1881    yeni proje (--ssh <alias> --backup-dir, --from-file, --no-pull)
fuxaw designer        yerel FUXA editörü (proje gerektirmez, bkz. Hızlı başlangıç)
fuxaw ui              web arayüzü (bkz. Hızlı başlangıç)
```

Başlatma örnekleri (proje reposunun kökünden):

```bash
C:\sct\syncthing\repohf_sync\fuxa_wrapper\fuxaw.cmd status
```

Kısa yol için bu klasörü `PATH`'e ekle, sonra her yerden `fuxaw status`.

## Proje klasörü

```
<proje>/
├─ fuxaw.json                ← {"name": "fuxa1", "target": {"url": "http://127.0.0.1:1881"}}
├─ src/                      ← DÜZENLENEN KAYNAK (öğe başına dosya)
│  ├─ project.json           ← name/version/server (API ile yazılamaz, sadece bilgi)
│  ├─ layout.json
│  ├─ devices/<cihaz>.json   ← cihaz + tag'ler
│  ├─ views/<ekran>.json
│  └─ scripts/<ad>.json+.js  ← script ayarları + kodu
├─ .fuxaw/                   ← son senkron tabanı (git'e girmez)
├─ <ad>_live.json            ← üretilen tam proje
└─ <ad>-devices_live.json    ← üretilen cihaz listesi (editör "devices export" formatı)
```

Uzak makinedeki bir FUXA için `target.url` yerine `{"ssh": "<alias>", "port": 1881, "local_port": 11881, "backup_dir": "..."}` verilir (SSH tüneli, yedek hedef makinede).

## Nasıl karar veriyor

Her öğe üç halde karşılaştırılır: **yerel** (`src/`), **hedef** (canlı FUXA), **taban** (son pull/publish, `.fuxaw/base.json`).

- Sadece yerelde değişen → `[publish]`
- Sadece hedefte değişen (editörde kaydedilmiş) → `[pull]`; publish bunlara dokunmaz.
- İkisinde de değişen → `[ÇAKIŞMA]`; pull ve publish durur, `fuxaw diff` ile bakılır, `--force` ile bir taraf seçilir.

Tag `value`/`timestamp` yok sayılır. Publish lint hatası varsa (ör. Boolean ADS tag'ine *Set value* `False`, olmayan tag'e bağlı öğe, aynı adlı iki ekran) göndermez. Ekran tasarımı hâlâ FUXA editöründe yapılır; kaydettikten sonra `fuxaw pull`.

## Test

```bash
python -m unittest discover -s tests -v
```

## Durum ve geçmiş

- **2026-10-02:** 1. aşama (çekirdek CLI) `fuxa_projects/wrapper/` altında yazıldı; sahte sunucuyla 11 test geçti. Aynı gün bu repoya taşındı: testler artık `tests/fixtures/fuxa1_live.json` kullanıyor, `fuxaw.cmd` bu klasörde.
- **2026-10-02:** `fuxaw designer`: Node.js (winget) + FUXA 1.3.4 (npm) bu makinede kuruldu, yerel FUXA çalıştı, editör açıldı.
- **2026-10-02:** Web arayüzü ilk sürüm (`fuxaw ui`): durum/fark, pull/publish, tag tablosu, lint, designer kontrolü, projeyi designer'a yükleme. Publish planında ekran silmeleri artık ekran kayıtlarından önce (aynı adlı ekran yeniden oluşturulunca FUXA yenisini atlıyordu).
- Sonraki aşamalar: AGENTS.md §9.
