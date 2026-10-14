# fuxaw yamasını npm ile kurulmuş FUXA 1.3.4'e uygular ya da günceller (internet gerekmez).
#   <FUXA>\fuxaw\        ADS (fuxaw) eklentisi + editör formu (her uygulamada baştan yazılır)
#   <FUXA>\main.js       başına tek satır eklenir (yedek: main.js.fuxaw-yedek)
# FUXA klasörü verilmezse 'npm root -g' altında @frangoteam\fuxa aranır.
# Kullanım: uygula.cmd [-FuxaDir C:\...\node_modules\@frangoteam\fuxa] [-Durdur]
param(
  [string]$FuxaDir,
  [switch]$Durdur
)
$ErrorActionPreference = 'Stop'
$Kaynak = $PSScriptRoot
$Satir = "try { require('./fuxaw/hook')(__dirname); } catch (e) { console.error('fuxaw yamasi yuklenemedi: ' + e.message); } // fuxaw-yama"

function FuxaBul {
  if ($FuxaDir) { return (Resolve-Path $FuxaDir).Path }
  $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $npm) { throw "npm bulunamadı. FUXA klasörünü -FuxaDir ile ver." }
  $root = (& $npm.Source root -g).Trim()
  $dir = Join-Path $root '@frangoteam\fuxa'
  if (-not (Test-Path (Join-Path $dir 'main.js'))) { throw "FUXA bulunamadı: $dir. npm install -g @frangoteam/fuxa@1.3.4 ile kur ya da -FuxaDir ver." }
  return $dir
}

function FuxaSurecleri($dir) {
  @(Get-CimInstance Win32_Process | Where-Object {
      ($_.Name -eq 'node.exe' -and $_.CommandLine -and $_.CommandLine.IndexOf($dir, [StringComparison]::OrdinalIgnoreCase) -ge 0) -or
      ($_.ExecutablePath -and $_.ExecutablePath.StartsWith((Join-Path $dir 'fuxaw'), [StringComparison]::OrdinalIgnoreCase)) })
}

$surum = Get-Content (Join-Path $Kaynak 'surum.json') -Raw | ConvertFrom-Json
$Fuxa = FuxaBul
$pkg = Get-Content (Join-Path $Fuxa 'package.json') -Raw | ConvertFrom-Json
if ($pkg.name -ne '@frangoteam/fuxa') { throw "$Fuxa bir FUXA klasörü değil." }
if ($surum.fuxa -notcontains $pkg.version) { throw "Yama FUXA $($surum.fuxa -join ', ') için; kurulu sürüm $($pkg.version). npm install -g @frangoteam/fuxa@$($surum.fuxa[0])" }
Write-Host "FUXA $($pkg.version): $Fuxa"

$procs = FuxaSurecleri $Fuxa
if ($procs.Count) {
  if (-not $Durdur) { throw "FUXA çalışıyor ($($procs.Count) süreç). Önce durdur ya da uygula.cmd -Durdur ile çalıştır." }
  foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
  Write-Host 'Çalışan FUXA durduruldu.'; Start-Sleep -Seconds 2
}

$hedef = Join-Path $Fuxa 'fuxaw'
robocopy (Join-Path $Kaynak 'fuxaw') $hedef /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Yama dosyaları kopyalanamadı (robocopy kodu $LASTEXITCODE)." }
Copy-Item (Join-Path $Kaynak 'surum.json') (Join-Path $hedef 'surum.json') -Force

$main = Join-Path $Fuxa 'main.js'
# Metin olduğu gibi kalır (satır sonları dahil); sadece tek satır eklenir, geri-al aynen çıkarır.
$metin = [IO.File]::ReadAllText($main)
if ($metin.Contains('// fuxaw-yama')) {
  Write-Host "main.js zaten yamalı; eklenti dosyaları güncellendi ($($surum.paket))."
} else {
  Copy-Item $main "$main.fuxaw-yedek" -Force
  $eol = if ($metin.Contains("`r`n")) { "`r`n" } else { "`n" }
  # '#!/usr/bin/env node' ilk satırda kalmalı.
  $i = if ($metin.StartsWith('#!')) { $metin.IndexOf("`n") + 1 } else { 0 }
  [IO.File]::WriteAllText($main, $metin.Insert($i, $Satir + $eol), (New-Object Text.UTF8Encoding $false))
  Write-Host "Yama uygulandı ($($surum.paket)). main.js yedeği: main.js.fuxaw-yedek"
}
Write-Host ''
Write-Host 'FUXA''yı (yeniden) başlat. Editörde bağlantı eklerken: Type → ADS (fuxaw) → Bağlantı yöntemi.'
Write-Host 'Not: FUXA npm ile güncellenir/yeniden kurulursa yama silinir; uygula.cmd''yi tekrar çalıştır.'
