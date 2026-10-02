# fuxaw – FUXA proje wrapper'ı

FUXA editöründe zor olan işleri (tag listesi, kaydetme, "sunucuda mı projede mi" belirsizliği) proje bazlı, git'e uygun bir akışa çevirir. **Proje** = `fuxaw.json` içeren bir klasör (git'te). **Hedef** = bu makinedeki test FUXA'sı (`fuxaw designer` ile kurulur, `127.0.0.1`). `publish` sadece ona yazar; test içindir.

**Hedef makine** (gerçek HMI bilgisayarı) için ağdan hiçbir şey gönderilmez: `fuxaw export` proje dosyasını ve nereye/nasıl koyulacağını anlatan bir README'yi klasöre yazar, klasör elle taşınır.

## Çalıştırma: `fuxaw.cmd`'ye çift tıkla

Uygulama tek giriş noktasıdır. `fuxaw.cmd`'ye çift tıklayınca (veya komutsuz `fuxaw`):

1. **Python** 3.10+ aranır; yoksa winget ile Python 3.12 kurulur (`fuxaw.cmd` içinde).
2. **Node.js** aranır; yoksa winget ile kurulur (winget yoksa nodejs.org'dan zip, yönetici izni gerekmez).
3. **FUXA 1.3.4** aranır; yoksa npm ile `%LOCALAPPDATA%\fuxaw\fuxa` altına kurulur.
4. Yerel test FUXA'sı başlatılır (`http://127.0.0.1:1881`, zaten çalışıyorsa dokunulmaz).
5. Arayüz açılır: `http://127.0.0.1:8765`. Arayüz zaten çalışıyorsa sadece tarayıcı açılır.

Pencere arayüz çalıştığı sürece açık kalır; kapatınca arayüz kapanır (yerel FUXA çalışmaya devam eder, Designer sekmesinden durdurulur). Bir adım başarısız olursa pencere mesajla birlikte bekler.

Projeler arayüzün **Projeler** sekmesinden eklenen klasörlerde aranır (bir kez eklemek yeterli). Proje reposunun içinden çalıştırılırsa (ör. `fuxa_projects\fuxaw.cmd`) o repo da otomatik eklenir.

## Web arayüzü

Komut satırından sadece arayüzü açmak için: `fuxaw ui [--root KLASÖR] [--port 8765] [--no-browser]`. Sekmeler:

- **Değişiklikler:** yerel / hedef karşılaştırması, öğeye tıklayınca fark (script kodu satır satır). Üst bardan Pull / Publish (test): önce plan ve lint gösterilir, onaylayınca yerel FUXA'ya gönderilir. Çakışmada ne yapılacağı sorulur. **Export:** hedef makine için klasöre çıkarır.
- **Taglar:** tüm tag'ler; arama, cihaz/tip filtresi, "kullanılmayanlar". Kullanım sayısına tıklayınca tag'in hangi ekran öğesinde, hangi event'te ya da script'te kullanıldığı görünür. Seçilenler Excel'e yapıştırılabilir şekilde kopyalanır.
- **Lint:** bilinen FUXA tuzakları ve kırık referanslar.
- **Designer:** yerel FUXA'yı kur/başlat/durdur, editörü aç.
- **Projeler:** proje arama kökleri (eklenen kökler `%LOCALAPPDATA%\fuxaw\ui.json`'da saklanır).

`--root` verilmezse bulunulan proje reposu (proje yoksa sadece kayıtlı kökler) aranır.

## Yerel designer (komut satırı)

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
fuxaw status          yerel / yerel FUXA karşılaştırması ([publish] [pull] [ÇAKIŞMA]); -a: aynıları da göster
fuxaw diff [MainView] değişen öğelerin JSON farkı (--base: hedefe bağlanmadan, son senkrona göre)
fuxaw pull            yerel FUXA editöründe kaydedilenleri src/'ye al
fuxaw lint            bilinen FUXA tuzakları + kırık tag/script referansları
fuxaw publish -n      ne gönderileceğini göster (dry-run)
fuxaw publish         yedek al → sadece değişenleri gönder → tekrar okuyup doğrula
fuxaw build           src/'den <ad>_live.json üret (editörde Import project için)
fuxaw backup          yerel FUXA'daki projenin yedeğini al (.fuxaw/backups)
fuxaw export          hedef makine için klasöre çıkar: <proje>/publish/<ad>/ (proje JSON + README); -o ile başka klasör
fuxaw init <klasör>   yeni proje (--url yerel FUXA, varsayılan http://127.0.0.1:1881; --from-file, --no-pull)
fuxaw                 (komutsuz) = fuxaw app: kontrol + kurulum + yerel FUXA + arayüz (bkz. Çalıştırma)
fuxaw designer        yerel FUXA editörü (proje gerektirmez)
fuxaw ui              sadece web arayüzü
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

`target` sadece yerel adres olabilir (`127.0.0.1` / `localhost`); verilmezse `http://127.0.0.1:1881`. Uzak adres veya `ssh` alanı hata verir.

`fuxaw export` çıktısı (`<proje>/publish/<ad>/`):

```
<ad>.json     tam proje; hedef makinede FUXA editörü ☰ → Open Project ile açılır
README.md     hedef makinede nereye/nasıl koyulacağı, önce yedek alma, cihaz/tag özeti
```

## Nasıl karar veriyor

Her öğe üç halde karşılaştırılır: **yerel** (`src/`), **hedef** (yerel test FUXA'sı), **taban** (son pull/publish, `.fuxaw/base.json`).

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
- **2026-10-02:** Kullanıcı kararıyla model sadeleşti: publish sadece yerel test FUXA'sına; SSH/tünel desteği silindi; hedef makine için `fuxaw export` (klasör + README). Designer'a yükleme kalktı (publish zaten yerel FUXA'ya gidiyor).
- **2026-10-02:** Tek giriş noktası: `fuxaw.cmd`'ye çift tıklama (komutsuz `fuxaw` = `fuxaw app`) Python/Node.js/FUXA'yı kontrol eder, eksikse kurar, yerel FUXA'yı başlatır ve arayüzü açar.
- Sonraki aşamalar: AGENTS.md §9.
