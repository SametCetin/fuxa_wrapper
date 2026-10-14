# Removes an install-fuxa install: stops FUXA, deletes node\, app\ and start-fuxa.cmd.
# data\ (project, settings, databases, logs, backups) is kept; running install-fuxa again opens the same project.
# To remove everything, delete the install folder by hand afterwards.
# Usage: uninstall-fuxa.cmd [-InstallDir C:\ProgramData\fuxa] [-Yes]
# Messages are ASCII only: Windows PowerShell 5.1 consoles garble UTF-8.
param(
  [string]$InstallDir = (Join-Path $env:ProgramData 'fuxa'),
  [switch]$Yes
)
$ErrorActionPreference = 'Stop'

if (-not (Test-Path $InstallDir)) { Write-Host "Nothing installed: $InstallDir"; return }
$InstallDir = (Resolve-Path $InstallDir).Path
$remove = @('node', 'app', 'start-fuxa.cmd') | ForEach-Object { Join-Path $InstallDir $_ } | Where-Object { Test-Path $_ }
if (-not $remove) { Write-Host "Nothing to remove: $InstallDir"; return }

Write-Host "Will remove: $($remove -join ', ')"
Write-Host "Will keep:   $(Join-Path $InstallDir 'data')"
if (-not $Yes) {
  $answer = Read-Host 'Continue? (Y/N)'
  if ($answer -notmatch '^[yY]') { throw 'Cancelled.' }
}

$procs = @(Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath.StartsWith($InstallDir + '\', [StringComparison]::OrdinalIgnoreCase) })
foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
if ($procs.Count) { Write-Host 'Stopped the running FUXA.'; Start-Sleep -Seconds 2 }

foreach ($r in $remove) { Remove-Item -LiteralPath $r -Recurse -Force }
Write-Host 'FUXA removed.'
Write-Host "Project and data kept: $(Join-Path $InstallDir 'data')"
