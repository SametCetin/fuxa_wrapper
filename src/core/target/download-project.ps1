# fuxaw Publish çıktısı: bu klasördeki proje JSON'unu hedef makinede çalışan FUXA'ya yükler.
# Önce FUXA'daki mevcut projeyi <Hedef>\data\yedek\ altına yedekler (yoksa bu klasörün yedek\ alt klasörüne).
# Editörde ☰ → Open Project ile aynı işlem (POST /api/project). Bağlantılar hemen kurulur.
# Kullanım: download-project.cmd [-Dosya <proje.json>] [-Port 1881] [-Hedef C:\ProgramData\fuxa] [-Evet]
#   Geri almak için: download-project.cmd -Dosya <yedek json>
param(
  [string]$Dosya,
  [int]$Port = 1881,
  [string]$Hedef = (Join-Path $env:ProgramData 'fuxa'),
  [switch]$Evet
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Url = "http://127.0.0.1:$Port"

if (-not $Dosya) {
  $adaylar = @(Get-ChildItem $PSScriptRoot -Filter *.json -File)
  if ($adaylar.Count -ne 1) { throw "Bu klasörde tek bir proje JSON'u olmalı ($($adaylar.Count) bulundu). -Dosya ile ver." }
  $Dosya = $adaylar[0].FullName
}
$Dosya = (Resolve-Path $Dosya).Path
$bytes = [IO.File]::ReadAllBytes($Dosya)
$prj = [Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json
if (-not $prj.hmi) { throw "$Dosya bir FUXA projesi değil." }

try { Invoke-WebRequest "$Url/api/settings" -UseBasicParsing -TimeoutSec 5 | Out-Null }
catch { throw "FUXA'ya ulaşılamadı: $Url. Önce FUXA'yı başlat ($(Join-Path $Hedef 'start-fuxa.cmd'))." }

$ekranlar = @($prj.hmi.views | ForEach-Object { $_.name })
$cihazlar = @($prj.devices.PSObject.Properties | ForEach-Object { $_.Value })
Write-Host "Proje:     $Dosya"
Write-Host "Hedef:     $Url"
Write-Host "Ekranlar:  $($ekranlar -join ', ')"
Write-Host "Cihazlar:  $(($cihazlar | ForEach-Object { "$($_.name) ($($_.type))" }) -join ', ')"
if ($cihazlar | Where-Object { $_.type -eq 'FuxawADS' }) {
  $main = Join-Path $Hedef 'app\node_modules\@frangoteam\fuxa\main.js'
  if (-not ((Test-Path $main) -and (Select-String -Path $main -Pattern 'fuxaw-yama' -SimpleMatch -Quiet))) {
    Write-Warning "Proje ADS (fuxaw) bağlantısı kullanıyor ama $Hedef altında yamalı FUXA bulunamadı. Bu bağlantılar install-fuxa ile kurulmuş FUXA'da çalışır."
  }
}
Write-Host ''
Write-Host "FUXA'daki mevcut proje yedeklenip bununla değiştirilecek."
if (-not $Evet) {
  $cevap = Read-Host 'Devam edilsin mi? (E/H)'
  if ($cevap -notmatch '^[eEyY]') { throw 'Vazgeçildi.' }
}

$yedekDir = if (Test-Path (Join-Path $Hedef 'data')) { Join-Path $Hedef 'data\yedek' } else { Join-Path $PSScriptRoot 'yedek' }
New-Item -ItemType Directory -Force $yedekDir | Out-Null
$yedek = Join-Path $yedekDir ("proje-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json')
Invoke-WebRequest "$Url/api/project" -UseBasicParsing -OutFile $yedek
Write-Host "Yedek:     $yedek"

Invoke-WebRequest "$Url/api/project" -Method Post -ContentType 'application/json; charset=utf-8' -Body $bytes -UseBasicParsing | Out-Null

$yeni = Invoke-RestMethod "$Url/api/project" -UseBasicParsing
$yeniEkranlar = @($yeni.hmi.views | ForEach-Object { $_.name })
if (($yeniEkranlar -join '|') -ne ($ekranlar -join '|')) { throw "Yükleme doğrulanamadı: FUXA'daki ekranlar beklenenle aynı değil. Geri almak için: download-project.cmd -Dosya `"$yedek`"" }
Write-Host ''
Write-Host "Proje yüklendi. Açık runtime sayfalarını ($Url/home) yenile."
Write-Host "Geri almak için: download-project.cmd -Dosya `"$yedek`""
