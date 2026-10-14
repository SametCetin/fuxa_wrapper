# install-fuxa ile yapılan kurulumu kaldırır: FUXA'yı durdurur, node\, app\ ve start-fuxa.cmd'yi siler.
# data\ (proje, ayarlar, veritabanları, günlükler, yedekler) korunur; install-fuxa tekrar çalışınca aynı proje açılır.
# Tamamen silmek için bundan sonra kurulum klasörünü elle sil.
# Kullanım: uninstall-fuxa.cmd [-Hedef C:\ProgramData\fuxa] [-Evet]
param(
  [string]$Hedef = (Join-Path $env:ProgramData 'fuxa'),
  [switch]$Evet
)
$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Hedef)) { Write-Host "Kurulum yok: $Hedef"; return }
$Hedef = (Resolve-Path $Hedef).Path
$silinecek = @('node', 'app', 'start-fuxa.cmd', 'baslat.cmd') | ForEach-Object { Join-Path $Hedef $_ } | Where-Object { Test-Path $_ }
if (-not $silinecek) { Write-Host "Kaldırılacak bir şey yok: $Hedef"; return }

Write-Host "Kaldırılacak: $($silinecek -join ', ')"
Write-Host "Korunacak:    $(Join-Path $Hedef 'data')"
if (-not $Evet) {
  $cevap = Read-Host 'Devam edilsin mi? (E/H)'
  if ($cevap -notmatch '^[eEyY]') { throw 'Vazgeçildi.' }
}

$procs = @(Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath.StartsWith($Hedef + '\', [StringComparison]::OrdinalIgnoreCase) })
foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
if ($procs.Count) { Write-Host 'Çalışan FUXA durduruldu.'; Start-Sleep -Seconds 2 }

foreach ($s in $silinecek) { Remove-Item -LiteralPath $s -Recurse -Force }
Write-Host 'FUXA kaldırıldı.'
Write-Host "Proje ve veriler korundu: $(Join-Path $Hedef 'data')"
