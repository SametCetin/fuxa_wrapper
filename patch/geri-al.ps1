# fuxaw yamasını geri alır: main.js'teki satırı siler, <FUXA>\fuxaw klasörünü kaldırır.
# Kullanım: geri-al.cmd [-FuxaDir C:\...\node_modules\@frangoteam\fuxa] [-Durdur]
param(
  [string]$FuxaDir,
  [switch]$Durdur
)
$ErrorActionPreference = 'Stop'

if (-not $FuxaDir) {
  $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $npm) { throw "npm bulunamadı. FUXA klasörünü -FuxaDir ile ver." }
  $FuxaDir = Join-Path (& $npm.Source root -g).Trim() '@frangoteam\fuxa'
}
$Fuxa = (Resolve-Path $FuxaDir).Path
$main = Join-Path $Fuxa 'main.js'
if (-not (Test-Path $main)) { throw "FUXA bulunamadı: $Fuxa" }

$procs = @(Get-CimInstance Win32_Process | Where-Object {
    ($_.Name -eq 'node.exe' -and $_.CommandLine -and $_.CommandLine.IndexOf($Fuxa, [StringComparison]::OrdinalIgnoreCase) -ge 0) -or
    ($_.ExecutablePath -and $_.ExecutablePath.StartsWith((Join-Path $Fuxa 'fuxaw'), [StringComparison]::OrdinalIgnoreCase)) })
if ($procs.Count) {
  if (-not $Durdur) { throw "FUXA çalışıyor ($($procs.Count) süreç). Önce durdur ya da geri-al.cmd -Durdur ile çalıştır." }
  foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
  Write-Host 'Çalışan FUXA durduruldu.'; Start-Sleep -Seconds 2
}

$metin = [IO.File]::ReadAllText($main)
$yeni = [regex]::Replace($metin, '(?m)^[^\r\n]*// fuxaw-yama\r?\n', '')
if ($yeni -ne $metin) {
  [IO.File]::WriteAllText($main, $yeni, (New-Object Text.UTF8Encoding $false))
  Write-Host 'main.js eski haline döndü.'
} else {
  Write-Host 'main.js zaten yamasız.'
}
Remove-Item -LiteralPath (Join-Path $Fuxa 'fuxaw') -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "$main.fuxaw-yedek" -Force -ErrorAction SilentlyContinue
Write-Host 'Yama kaldırıldı. ADS (fuxaw) tipindeki bağlantılar artık çalışmaz; FUXA''yı yeniden başlat.'
