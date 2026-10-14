# Applies or refreshes the fuxaw patch on FUXA 1.3.4 (no internet needed). Called by install-fuxa.ps1 as its last step.
#   <FUXA>\fuxaw\        ADS (fuxaw) plugin + editor form (rewritten on every run)
#   <FUXA>\main.js       one line is added at the top (backup: main.js.fuxaw-backup)
# Usage: apply-patch.ps1 [-FuxaDir C:\ProgramData\fuxa\app\node_modules\@frangoteam\fuxa] [-Stop]
# Messages are ASCII only: Windows PowerShell 5.1 consoles garble UTF-8.
param(
  [string]$FuxaDir = 'C:\ProgramData\fuxa\app\node_modules\@frangoteam\fuxa',
  [switch]$Stop
)
$ErrorActionPreference = 'Stop'
$Source = $PSScriptRoot
# '// fuxaw-yama' is the marker existing installs are recognised by; do not change it.
$Line = "try { require('./fuxaw/hook')(__dirname); } catch (e) { console.error('fuxaw patch failed to load: ' + e.message); } // fuxaw-yama"

function Find-Fuxa {
  if (-not (Test-Path (Join-Path $FuxaDir 'main.js'))) { throw "FUXA not found: $FuxaDir. Install it with install-fuxa.cmd or pass -FuxaDir." }
  return (Resolve-Path $FuxaDir).Path
}

function Get-FuxaProcesses($dir) {
  @(Get-CimInstance Win32_Process | Where-Object {
      ($_.Name -eq 'node.exe' -and $_.CommandLine -and $_.CommandLine.IndexOf($dir, [StringComparison]::OrdinalIgnoreCase) -ge 0) -or
      ($_.ExecutablePath -and $_.ExecutablePath.StartsWith((Join-Path $dir 'fuxaw'), [StringComparison]::OrdinalIgnoreCase)) })
}

$versions = Get-Content (Join-Path $Source 'version.json') -Raw | ConvertFrom-Json
$Fuxa = Find-Fuxa
$pkg = Get-Content (Join-Path $Fuxa 'package.json') -Raw | ConvertFrom-Json
if ($pkg.name -ne '@frangoteam/fuxa') { throw "$Fuxa is not a FUXA folder." }
if ($versions.fuxa -notcontains $pkg.version) { throw "This patch is for FUXA $($versions.fuxa -join ', '); installed version is $($pkg.version)." }
Write-Host "FUXA $($pkg.version): $Fuxa"

$procs = Get-FuxaProcesses $Fuxa
if ($procs.Count) {
  if (-not $Stop) { throw "FUXA is running ($($procs.Count) processes). Stop it first or run with -Stop." }
  foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
  Write-Host 'Stopped the running FUXA.'; Start-Sleep -Seconds 2
}

$target = Join-Path $Fuxa 'fuxaw'
robocopy (Join-Path $Source 'fuxaw') $target /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Could not copy the patch files (robocopy code $LASTEXITCODE)." }
Copy-Item (Join-Path $Source 'version.json') (Join-Path $target 'version.json') -Force

$main = Join-Path $Fuxa 'main.js'
# The text stays as it is (line endings included); only one line is added.
$text = [IO.File]::ReadAllText($main)
if ($text.Contains('// fuxaw-yama')) {
  Write-Host "main.js is already patched; plugin files refreshed ($($versions.package))."
} else {
  Copy-Item $main "$main.fuxaw-backup" -Force
  $eol = if ($text.Contains("`r`n")) { "`r`n" } else { "`n" }
  # '#!/usr/bin/env node' must stay on the first line.
  $i = if ($text.StartsWith('#!')) { $text.IndexOf("`n") + 1 } else { 0 }
  [IO.File]::WriteAllText($main, $text.Insert($i, $Line + $eol), (New-Object Text.UTF8Encoding $false))
  Write-Host "Patch applied ($($versions.package)). main.js backup: main.js.fuxaw-backup"
}
