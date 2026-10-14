# Removes an install-fuxa install: stops FUXA, deletes node\, app\, the launchers and the shortcuts
# (Start menu FUXA folder, desktop "Start FUXA"; names as in install-fuxa.ps1, plus those of earlier versions).
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
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcuts = @((Join-Path ([Environment]::GetFolderPath('Programs')) 'FUXA')) +
  @('Start FUXA.lnk', 'FUXA Editor.lnk', 'FUXA Editor.url' | ForEach-Object { Join-Path $desktop $_ })
$files = 'node', 'app', 'browser', 'start-fuxa.cmd', 'start-fuxa.ps1', 'stop-fuxa.cmd', 'stop-fuxa.ps1', 'fuxa-server.cmd', 'open-editor.ps1'
$remove = @($files | ForEach-Object { Join-Path $InstallDir $_ }) + $shortcuts | Where-Object { Test-Path $_ }
if (-not $remove) { Write-Host "Nothing to remove: $InstallDir"; return }

Write-Host "Will remove: $($remove -join ', ')"
Write-Host "Will keep:   $(Join-Path $InstallDir 'data')"
if (-not $Yes) {
  $answer = Read-Host 'Continue? (Y/N)'
  if ($answer -notmatch '^[yY]') { throw 'Cancelled.' }
}

# FUXA (node.exe under the install folder) and the runtime view window (Edge using the browser\ profile, which it locks).
$profileDir = Join-Path $InstallDir 'browser'
$procs = @(Get-CimInstance Win32_Process | Where-Object {
    ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($InstallDir + '\', [StringComparison]::OrdinalIgnoreCase)) -or
    ($_.Name -eq 'msedge.exe' -and $_.CommandLine -and $_.CommandLine.Contains($profileDir)) })
foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
if ($procs.Count) { Write-Host 'Stopped the running FUXA.'; Start-Sleep -Seconds 2 }

foreach ($r in $remove) { Remove-Item -LiteralPath $r -Recurse -Force }
Write-Host 'FUXA removed.'
Write-Host "Project and data kept: $(Join-Path $InstallDir 'data')"
