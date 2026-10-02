# fuxaw – FUXA proje wrapper'ı

FUXA editöründe zor olan işleri (tag listesi, kaydetme, "sunucuda mı projede mi" belirsizliği) proje bazlı, git'e uygun bir akışa çevirir. **Proje** = `fuxaw.json` içeren bir klasör (git'te). **Hedef** = çalışan FUXA (ör. hypervm). Hedefe sadece `publish` ile yazılır. SSH tünelini kendisi açıp kapatır.

AI asistanlar ve geliştiriciler için kod yapısı, tasarım kararları, FUXA API notları ve tuzaklar: **[AGENTS.md](AGENTS.md)**.

Yönetilen projeler ayrı repoda: `C:\sct\syncthing\sc_genel\fuxa_projects` (ör. `fuxa_project1`, TwinCAT TC294_35 HMI'si).

## Klasör yapısı

```
fuxa_wrapper/
├─ README.md / AGENTS.md / CLAUDE.md
├─ fuxaw.cmd                    ← başlatıcı (PYTHONPATH = bu klasör)
├─ fuxaw/                       ← Python paketi (sadece standart kütüphane, 3.12)
│  ├─ cli.py  model.py  store.py  sync.py  target.py  lint.py
└─ tests/
   ├─ test_fuxaw.py             ← uçtan uca testler
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
fuxaw init <klasör> --ssh hypervm --backup-dir C:\sct\<klasör>    yeni proje (--url, --from-file, --no-pull)
```

Başlatma örnekleri (proje reposunun kökünden):

```bash
C:\sct\syncthing\repohf_sync\fuxa_wrapper\fuxaw.cmd status
```

Kısa yol için bu klasörü `PATH`'e ekle, sonra her yerden `fuxaw status`.

## Proje klasörü

```
<proje>/
├─ fuxaw.json                ← {"name": "fuxa1", "target": {"ssh": "hypervm", "port": 1881, "local_port": 11881, "backup_dir": "C:\\sct\\fuxa1_prj"}}
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

Hedef `target.ssh` yerine `target.url` (ör. `http://127.0.0.1:1881`) ile de verilebilir.

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
- Açık: gerçek hedefle (hypervm) doğrulama; sonraki aşamalar için bkz. AGENTS.md §8.
