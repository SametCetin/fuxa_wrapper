# fuxaw hedef kurulumu: Node.js + FUXA + fuxaw yaması, tek klasöre (yönetici gerekmez).
#   <Hedef>\node\    Node.js (nodejs.org'dan, SHA256 doğrulamalı; sistem PATH'ine dokunulmaz)
#   <Hedef>\app\     FUXA (npm'den, internetten)
#   <Hedef>\data\    proje, ayarlar, veritabanları, günlükler (FUXA --userDir); yeniden kurulumda silinmez
#   <Hedef>\start-fuxa.cmd
# Tekrar çalıştırılabilir: doğru sürümde kurulu olan atlanır, yama her seferinde güncellenir.
# Kullanım: install-fuxa.cmd [-Hedef C:\ProgramData\fuxa] [-Port 1881] [-Durdur] [-Baslatma]
param(
  [string]$Hedef = (Join-Path $env:ProgramData 'fuxa'),
  [int]$Port = 1881,
  [switch]$Durdur,
  [switch]$Baslatma
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$surum = Get-Content (Join-Path $PSScriptRoot 'surum.json') -Raw | ConvertFrom-Json
$NodeSurum = $surum.node
$FuxaSurum = $surum.fuxa[0]
if (-not [Environment]::Is64BitOperatingSystem) { throw 'Kurulum 64 bit Windows içindir.' }

New-Item -ItemType Directory -Force $Hedef | Out-Null
$Hedef = (Resolve-Path $Hedef).Path
$NodeDir = Join-Path $Hedef 'node'
$Node = Join-Path $NodeDir 'node.exe'
$App = Join-Path $Hedef 'app'
$Fuxa = Join-Path $App 'node_modules\@frangoteam\fuxa'
$Data = Join-Path $Hedef 'data'
Write-Host "Kurulum klasörü: $Hedef"

# Çalışan FUXA dosyaları kilitler; önce durdur.
$procs = @(Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath.StartsWith($Hedef + '\', [StringComparison]::OrdinalIgnoreCase) })
if ($procs.Count) {
  if (-not $Durdur) { throw "Bu klasördeki FUXA çalışıyor ($($procs.Count) süreç). Önce kapat ya da install-fuxa.cmd -Durdur ile çalıştır." }
  foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
  Write-Host 'Çalışan FUXA durduruldu.'; Start-Sleep -Seconds 2
}

# 1. Node.js
$var = if (Test-Path $Node) { (& $Node -v).Trim() } else { '' }
if ($var -eq $NodeSurum) {
  Write-Host "[1/4] Node.js $NodeSurum kurulu."
} else {
  Write-Host "[1/4] Node.js $NodeSurum indiriliyor..."
  $base = "node-$NodeSurum-win-x64"
  $dist = "https://nodejs.org/dist/$NodeSurum"
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ("fuxaw-kur-" + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory $tmp | Out-Null
  try {
    $zip = Join-Path $tmp "$base.zip"
    Invoke-WebRequest "$dist/$base.zip" -OutFile $zip -UseBasicParsing
    $sums = (Invoke-WebRequest "$dist/SHASUMS256.txt" -UseBasicParsing).Content
    $beklenen = ($sums -split "`n" | Where-Object { $_ -match "\s$([regex]::Escape("$base.zip"))\s*$" } | Select-Object -First 1) -replace '\s.*$', ''
    $gercek = (Get-FileHash $zip -Algorithm SHA256).Hash
    if (-not $beklenen -or $beklenen -ne $gercek) { throw "$base.zip doğrulanamadı (SHA256 tutmadı)." }
    & (Join-Path $env:SystemRoot 'System32\tar.exe') -xf $zip -C $tmp
    if ($LASTEXITCODE) { throw "$base.zip açılamadı." }
    if (Test-Path $NodeDir) { Remove-Item $NodeDir -Recurse -Force }
    Move-Item (Join-Path $tmp $base) $NodeDir
  } finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
  Write-Host "      Node.js $((& $Node -v).Trim()) kuruldu."
}

# 2. FUXA (npm, internetten). Kurulum betikleri çalıştırılmaz: sqlite3 vb. hazır derlenmiş gelir.
$env:Path = "$NodeDir;$env:Path"
$fvar = if (Test-Path (Join-Path $Fuxa 'package.json')) { (Get-Content (Join-Path $Fuxa 'package.json') -Raw | ConvertFrom-Json).version } else { '' }
if ($fvar -eq $FuxaSurum) {
  Write-Host "[2/4] FUXA $FuxaSurum kurulu."
} else {
  Write-Host "[2/4] FUXA $FuxaSurum npm'den kuruluyor (birkaç dakika sürebilir)..."
  New-Item -ItemType Directory -Force $App | Out-Null
  & $Node (Join-Path $NodeDir 'node_modules\npm\bin\npm-cli.js') install "@frangoteam/fuxa@$FuxaSurum" `
    --prefix $App --ignore-scripts --no-audit --no-fund --loglevel=error
  if ($LASTEXITCODE) { throw "FUXA kurulamadı (npm çıkış kodu $LASTEXITCODE). İnternet bağlantısını kontrol et." }
  Write-Host "      FUXA $FuxaSurum kuruldu."
}
# sqlite3'ün derlenmiş dosyası npm paketinde yok; kendi kurulum adımı (prebuild-install) GitHub'dan indirir.
# Diğer kurulum betikleri (ör. telemetri) bilerek çalıştırılmaz.
$sqlite = Join-Path $App 'node_modules\sqlite3'
if (-not (Test-Path (Join-Path $sqlite 'build\Release\node_sqlite3.node'))) {
  Write-Host '      sqlite3 derlenmiş dosyası indiriliyor...'
  Push-Location $sqlite
  # Node'un stderr'e yazdığı uyarılar PowerShell 5.1'de 'Stop' altında hataya dönüşmesin.
  $ErrorActionPreference = 'Continue'
  try { & $Node --no-deprecation (Join-Path $App 'node_modules\prebuild-install\bin.js') -r napi }
  finally { Pop-Location; $ErrorActionPreference = 'Stop' }
  if (-not (Test-Path (Join-Path $sqlite 'build\Release\node_sqlite3.node'))) { throw 'sqlite3 derlenmiş dosyası indirilemedi (github.com erişimini kontrol et).' }
}

# 3. Yama
Write-Host '[3/4] fuxaw yaması uygulanıyor...'
& (Join-Path $PSScriptRoot 'apply-patch.ps1') -FuxaDir $Fuxa

# 4. Başlatıcı. Proje ve veriler data\ altında; FUXA nereden başlatılırsa başlatılsın aynı projeyi açar.
New-Item -ItemType Directory -Force $Data | Out-Null
$baslat = Join-Path $Hedef 'start-fuxa.cmd'
Remove-Item (Join-Path $Hedef 'baslat.cmd') -ErrorAction SilentlyContinue  # eski ad
@"
@echo off
rem fuxaw kurulumu: FUXA'yi baslatir. Editor: http://127.0.0.1:$Port/editor
set "PATH=%~dp0node;%PATH%"
cd /d "%~dp0data"
"%~dp0node\node.exe" "%~dp0app\node_modules\@frangoteam\fuxa\main.js" --port $Port --userDir "%~dp0data"
"@ -replace "`r?`n", "`r`n" | Set-Content $baslat -Encoding Ascii
Write-Host "[4/4] Başlatıcı yazıldı: $baslat"

Write-Host ''
if ($Baslatma) {
  Write-Host "Kurulum tamam. FUXA'yı başlatmak için: $baslat"
  return
}
Start-Process -FilePath $baslat -WorkingDirectory $Hedef
$url = "http://127.0.0.1:$Port"
$hazir = $false
for ($i = 0; $i -lt 60 -and -not $hazir; $i++) {
  Start-Sleep -Seconds 1
  try { Invoke-WebRequest "$url/api/settings" -UseBasicParsing -TimeoutSec 2 | Out-Null; $hazir = $true } catch {}
}
if (-not $hazir) { throw "FUXA başlatıldı ama $url yanıt vermiyor. Açılan pencerede hatayı kontrol et." }
Write-Host "Kurulum tamam. FUXA çalışıyor: $url/editor"
Write-Host "Sonraki açılışlarda: $baslat"
