# fuxaw target install: Node.js + FUXA + fuxaw patch into one folder (no admin rights needed).
#   <InstallDir>\node\    Node.js (from nodejs.org, SHA256 verified; system PATH is not touched)
#   <InstallDir>\app\     FUXA (from npm, over the internet) + fuxaw patch in app\...\fuxa\fuxaw\
#   <InstallDir>\data\    project, settings, databases, logs, backups (FUXA --userDir); kept on reinstall/uninstall
#   <InstallDir>\start-fuxa.cmd
# Safe to run again: whatever is already installed in the right version is skipped, the patch is always refreshed.
# Usage: install-fuxa.cmd [-InstallDir C:\ProgramData\fuxa] [-Port 1881] [-Stop] [-NoStart]
#
# TEMPLATE: scripts/build-installer.js fills in the __...__ values (versions, embedded ADS plugin) and wraps
# this into a single self-contained install-fuxa.cmd. Do not run this file directly.
# Messages are ASCII only: Windows PowerShell 5.1 consoles garble UTF-8.
param(
  [string]$InstallDir = (Join-Path $env:ProgramData 'fuxa'),
  [int]$Port = 1881,
  [switch]$Stop,
  [switch]$NoStart
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$PackageName = '__PACKAGE__'
$NodeVersion = '__NODE_VERSION__'
$FuxaVersion = '__FUXA_VERSION__'
# ADS (fuxaw) plugin: zip of the fuxaw\ folder, base64. It is not published anywhere, so it ships inside this file.
$PluginZip = @'
__PLUGIN_ZIP__
'@
if ($PackageName.StartsWith('__')) { throw 'This is the source template. Build the installer with "npm run dist:installer" and run dist\installer\...\install-fuxa.cmd.' }
if (-not [Environment]::Is64BitOperatingSystem) { throw 'This installer requires 64-bit Windows.' }
$Tar = Join-Path $env:SystemRoot 'System32\tar.exe'

New-Item -ItemType Directory -Force $InstallDir | Out-Null
$InstallDir = (Resolve-Path $InstallDir).Path
$NodeDir = Join-Path $InstallDir 'node'
$Node = Join-Path $NodeDir 'node.exe'
$App = Join-Path $InstallDir 'app'
$Fuxa = Join-Path $App 'node_modules\@frangoteam\fuxa'
$Data = Join-Path $InstallDir 'data'
Write-Host "$PackageName"
Write-Host "Install folder: $InstallDir"

# A running FUXA locks its files; stop it first.
$procs = @(Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath.StartsWith($InstallDir + '\', [StringComparison]::OrdinalIgnoreCase) })
if ($procs.Count) {
  if (-not $Stop) { throw "FUXA from this folder is running ($($procs.Count) processes). Close it first or run install-fuxa.cmd -Stop." }
  foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
  Write-Host 'Stopped the running FUXA.'; Start-Sleep -Seconds 2
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('fuxaw-install-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $tmp | Out-Null
try {
  # 1. Node.js
  $current = if (Test-Path $Node) { (& $Node -v).Trim() } else { '' }
  if ($current -eq $NodeVersion) {
    Write-Host "[1/5] Node.js $NodeVersion already installed."
  } else {
    Write-Host "[1/5] Downloading Node.js $NodeVersion..."
    $base = "node-$NodeVersion-win-x64"
    $dist = "https://nodejs.org/dist/$NodeVersion"
    $zip = Join-Path $tmp "$base.zip"
    Invoke-WebRequest "$dist/$base.zip" -OutFile $zip -UseBasicParsing
    $sums = (Invoke-WebRequest "$dist/SHASUMS256.txt" -UseBasicParsing).Content
    $expected = ($sums -split "`n" | Where-Object { $_ -match "\s$([regex]::Escape("$base.zip"))\s*$" } | Select-Object -First 1) -replace '\s.*$', ''
    $actual = (Get-FileHash $zip -Algorithm SHA256).Hash
    if (-not $expected -or $expected -ne $actual) { throw "$base.zip failed verification (SHA256 mismatch)." }
    & $Tar -xf $zip -C $tmp
    if ($LASTEXITCODE) { throw "Could not extract $base.zip." }
    if (Test-Path $NodeDir) { Remove-Item $NodeDir -Recurse -Force }
    Move-Item (Join-Path $tmp $base) $NodeDir
    Write-Host "      Node.js $((& $Node -v).Trim()) installed."
  }

  # 2. FUXA (npm, over the internet). Package install scripts are not run.
  $env:Path = "$NodeDir;$env:Path"
  $fcurrent = if (Test-Path (Join-Path $Fuxa 'package.json')) { (Get-Content (Join-Path $Fuxa 'package.json') -Raw | ConvertFrom-Json).version } else { '' }
  if ($fcurrent -eq $FuxaVersion) {
    Write-Host "[2/5] FUXA $FuxaVersion already installed."
  } else {
    Write-Host "[2/5] Installing FUXA $FuxaVersion from npm (may take a few minutes)..."
    New-Item -ItemType Directory -Force $App | Out-Null
    & $Node (Join-Path $NodeDir 'node_modules\npm\bin\npm-cli.js') install "@frangoteam/fuxa@$FuxaVersion" `
      --prefix $App --ignore-scripts --no-audit --no-fund --loglevel=error
    if ($LASTEXITCODE) { throw "FUXA install failed (npm exit code $LASTEXITCODE). Check the internet connection." }
    Write-Host "      FUXA $FuxaVersion installed."
  }
  # sqlite3's compiled binary is not in the npm package; its own install step (prebuild-install) downloads it from GitHub.
  # Other install scripts (e.g. telemetry) are deliberately not run.
  $sqlite = Join-Path $App 'node_modules\sqlite3'
  if (-not (Test-Path (Join-Path $sqlite 'build\Release\node_sqlite3.node'))) {
    Write-Host '      Downloading the sqlite3 binary...'
    Push-Location $sqlite
    # Warnings Node writes to stderr must not become errors under 'Stop' in PowerShell 5.1.
    $ErrorActionPreference = 'Continue'
    try { & $Node --no-deprecation (Join-Path $App 'node_modules\prebuild-install\bin.js') -r napi }
    finally { Pop-Location; $ErrorActionPreference = 'Stop' }
    if (-not (Test-Path (Join-Path $sqlite 'build\Release\node_sqlite3.node'))) { throw 'Could not download the sqlite3 binary (check access to github.com).' }
  }

  # 3. fuxaw patch: plugin into <FUXA>\fuxaw\, one line at the top of <FUXA>\main.js (backup: main.js.fuxaw-backup).
  Write-Host '[3/5] Applying the fuxaw patch...'
  $pkg = Get-Content (Join-Path $Fuxa 'package.json') -Raw | ConvertFrom-Json
  if ($pkg.version -ne $FuxaVersion) { throw "The patch is for FUXA $FuxaVersion; installed version is $($pkg.version)." }
  $pluginZipFile = Join-Path $tmp 'fuxaw-plugin.zip'
  [IO.File]::WriteAllBytes($pluginZipFile, [Convert]::FromBase64String(($PluginZip -replace '\s', '')))
  $pluginDir = Join-Path $tmp 'fuxaw'
  New-Item -ItemType Directory $pluginDir | Out-Null
  & $Tar -xf $pluginZipFile -C $pluginDir
  if ($LASTEXITCODE) { throw 'Could not extract the embedded fuxaw plugin.' }
  robocopy $pluginDir (Join-Path $Fuxa 'fuxaw') /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Could not copy the patch files (robocopy code $LASTEXITCODE)." }
  $main = Join-Path $Fuxa 'main.js'
  # '// fuxaw-yama' is the marker installs are recognised by; do not change it.
  $line = "try { require('./fuxaw/hook')(__dirname); } catch (e) { console.error('fuxaw patch failed to load: ' + e.message); } // fuxaw-yama"
  $text = [IO.File]::ReadAllText($main)
  if ($text.Contains('// fuxaw-yama')) {
    Write-Host "      main.js already patched; plugin files refreshed."
  } else {
    Copy-Item $main "$main.fuxaw-backup" -Force
    $eol = if ($text.Contains("`r`n")) { "`r`n" } else { "`n" }
    # '#!/usr/bin/env node' must stay on the first line.
    $i = if ($text.StartsWith('#!')) { $text.IndexOf("`n") + 1 } else { 0 }
    [IO.File]::WriteAllText($main, $text.Insert($i, $line + $eol), (New-Object Text.UTF8Encoding $false))
    Write-Host '      Patch applied.'
  }
} finally {
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

# 4. Launcher. Project and data live in data\; FUXA opens the same project wherever it is started from.
New-Item -ItemType Directory -Force $Data | Out-Null
$launcher = Join-Path $InstallDir 'start-fuxa.cmd'
@"
@echo off
rem fuxaw install: starts FUXA. Editor: http://127.0.0.1:$Port/editor
set "PATH=%~dp0node;%PATH%"
cd /d "%~dp0data"
"%~dp0node\node.exe" "%~dp0app\node_modules\@frangoteam\fuxa\main.js" --port $Port --userDir "%~dp0data"
"@ -replace "`r?`n", "`r`n" | Set-Content $launcher -Encoding Ascii
# open-editor.ps1: what the "FUXA Editor" shortcut runs. Starts FUXA (minimized) if it is not running, then opens the editor.
$openEditor = Join-Path $InstallDir 'open-editor.ps1'
@'
# fuxaw install: opens the FUXA editor; starts FUXA (start-fuxa.cmd, minimized window) first if it is not running.
$url = 'http://127.0.0.1:__PORT__'
function Test-Fuxa { try { Invoke-WebRequest "$url/api/settings" -UseBasicParsing -TimeoutSec 2 | Out-Null; $true } catch { $false } }
if (-not (Test-Fuxa)) {
  Start-Process -FilePath (Join-Path $PSScriptRoot 'start-fuxa.cmd') -WorkingDirectory $PSScriptRoot -WindowStyle Minimized
  for ($i = 0; $i -lt 60 -and -not (Test-Fuxa); $i++) { Start-Sleep -Seconds 1 }
}
Start-Process "$url/editor"
'@.Replace('__PORT__', "$Port") -replace "`r?`n", "`r`n" | Set-Content $openEditor -Encoding Ascii
Write-Host "[4/5] Launchers written: $launcher, $openEditor"

# 5. Shortcuts (current user, no admin): editor in the Start menu and on the desktop, install folder in the Start menu.
#    uninstall-fuxa.ps1 removes the same names.
$shell = New-Object -ComObject WScript.Shell
$menuDir = Join-Path ([Environment]::GetFolderPath('Programs')) 'FUXA'
New-Item -ItemType Directory -Force $menuDir | Out-Null
foreach ($dir in $menuDir, [Environment]::GetFolderPath('Desktop')) {
  Remove-Item (Join-Path $dir 'FUXA Editor.url') -ErrorAction SilentlyContinue  # earlier version of this shortcut
  $lnk = $shell.CreateShortcut((Join-Path $dir 'FUXA Editor.lnk'))
  $lnk.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $lnk.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$openEditor`""
  $lnk.WorkingDirectory = $InstallDir
  $lnk.WindowStyle = 7
  $lnk.Description = "FUXA editor (http://127.0.0.1:$Port/editor); starts FUXA if needed"
  $lnk.Save()
}
$lnk = $shell.CreateShortcut((Join-Path $menuDir 'FUXA Project Folder.lnk'))
$lnk.TargetPath = $InstallDir
$lnk.Description = 'FUXA install folder (data\ = project, settings, logs, backups)'
$lnk.Save()
Write-Host "[5/5] Shortcuts: FUXA Editor (Start menu, desktop), FUXA Project Folder (Start menu)"

Write-Host ''
if ($NoStart) {
  Write-Host "Install complete. To start FUXA: $launcher"
  return
}
Start-Process -FilePath $launcher -WorkingDirectory $InstallDir
$url = "http://127.0.0.1:$Port"
$ready = $false
for ($i = 0; $i -lt 60 -and -not $ready; $i++) {
  Start-Sleep -Seconds 1
  try { Invoke-WebRequest "$url/api/settings" -UseBasicParsing -TimeoutSec 2 | Out-Null; $ready = $true } catch {}
}
if (-not $ready) { throw "FUXA was started but $url does not respond. Check the FUXA window for errors." }
Write-Host "Install complete. FUXA is running: $url/editor"
Write-Host "Next time start it with: $launcher"
