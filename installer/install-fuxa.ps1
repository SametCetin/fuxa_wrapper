# fuxaw target install: Node.js + FUXA + fuxaw patch into one folder (no admin rights needed).
#   <InstallDir>\node\    Node.js (from nodejs.org, SHA256 verified; system PATH is not touched)
#   <InstallDir>\app\     FUXA (from npm, over the internet) + fuxaw patch in app\...\fuxa\fuxaw\
#   <InstallDir>\data\    project, settings, databases, logs, backups (FUXA --userDir); kept on reinstall/uninstall
#   <InstallDir>\start-fuxa.cmd   starts FUXA if needed and opens the editor (+ start-fuxa.ps1, fuxa-server.cmd)
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

# 4. Launchers. Project and data live in data\; FUXA opens the same project wherever it is started from.
#    start-fuxa.cmd   what users run (shortcuts): starts FUXA in the background (no window) if it is not running,
#                     then shows the runtime view (/home) in an Edge app window (own profile in browser\, so an
#                     already open window is brought back instead of opening another one).
#                     start-fuxa.cmd -Page editor opens the editor in the default browser instead. Logic in start-fuxa.ps1.
#    stop-fuxa.cmd    stops FUXA (Start menu "Stop FUXA"). Logic in stop-fuxa.ps1.
#    fuxa-server.cmd  runs FUXA with a visible console, for troubleshooting (closing the window stops FUXA).
#    Logs are in data\_logs\ (fuxa.log, api.log) either way.
New-Item -ItemType Directory -Force $Data | Out-Null
$server = Join-Path $InstallDir 'fuxa-server.cmd'
@"
@echo off
rem fuxaw install: FUXA with a visible console, for troubleshooting (closing this window stops FUXA).
rem Normally use start-fuxa.cmd, which runs FUXA in the background. Editor: http://127.0.0.1:$Port/editor
title FUXA server (port $Port)
set "PATH=%~dp0node;%PATH%"
cd /d "%~dp0data"
"%~dp0node\node.exe" "%~dp0app\node_modules\@frangoteam\fuxa\main.js" --port $Port --userDir "%~dp0data"
"@ -replace "`r?`n", "`r`n" | Set-Content $server -Encoding Ascii
@'
# fuxaw install: starts FUXA in the background (no window) if it is not running, then
#   -Page view   (default) shows the runtime view in an Edge app window; if that window is already open it is
#                restored and brought to the front instead of opening another one
#   -Page editor opens the editor in the default browser
param([ValidateSet('view', 'editor')][string]$Page = 'view')
$url = 'http://127.0.0.1:__PORT__'
function Test-Fuxa { try { Invoke-WebRequest "$url/api/settings" -UseBasicParsing -TimeoutSec 2 | Out-Null; $true } catch { $false } }
if (-not (Test-Fuxa)) {
  $env:Path = (Join-Path $PSScriptRoot 'node') + ';' + $env:Path
  $data = Join-Path $PSScriptRoot 'data'
  $main = Join-Path $PSScriptRoot 'app\node_modules\@frangoteam\fuxa\main.js'
  Start-Process -FilePath (Join-Path $PSScriptRoot 'node\node.exe') -WorkingDirectory $data -WindowStyle Hidden `
    -ArgumentList "`"$main`"", '--port', '__PORT__', '--userDir', "`"$data`""
  for ($i = 0; $i -lt 60 -and -not (Test-Fuxa); $i++) { Start-Sleep -Seconds 1 }
}
if ($Page -eq 'editor') { Start-Process "$url/editor"; return }

$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") |
  Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) { Start-Process "$url/home"; return }  # no Edge: default browser
# The app window uses its own Edge profile, so its browser process can be found by command line.
$profileDir = Join-Path $PSScriptRoot 'browser'
$open = Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object {
    $_.CommandLine -and $_.CommandLine.Contains($profileDir) -and -not $_.CommandLine.Contains('--type=') } |
  ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue } |
  Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1
if ($open) {
  Add-Type -Namespace Fuxaw -Name Win -MemberDefinition @"
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
"@
  $h = $open.MainWindowHandle
  if ([Fuxaw.Win]::IsIconic($h)) { [void][Fuxaw.Win]::ShowWindow($h, 9) }  # 9 = SW_RESTORE
  [void][Fuxaw.Win]::SetForegroundWindow($h)
  return
}
Start-Process -FilePath $edge -ArgumentList "--app=$url/home", "--user-data-dir=`"$profileDir`"", '--no-first-run', '--no-default-browser-check'
'@.Replace('__PORT__', "$Port") -replace "`r?`n", "`r`n" | Set-Content (Join-Path $InstallDir 'start-fuxa.ps1') -Encoding Ascii
@'
# fuxaw install: stops FUXA started from this folder (node.exe under this folder).
$procs = @(Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath.StartsWith($PSScriptRoot + '\', [StringComparison]::OrdinalIgnoreCase) })
foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
'@ -replace "`r?`n", "`r`n" | Set-Content (Join-Path $InstallDir 'stop-fuxa.ps1') -Encoding Ascii
$launcher = Join-Path $InstallDir 'start-fuxa.cmd'
$stopper = Join-Path $InstallDir 'stop-fuxa.cmd'
foreach ($pair in @(@($launcher, 'start-fuxa.ps1', 'starts FUXA in the background if needed and shows the runtime view (-Page editor: the editor).'),
                    @($stopper, 'stop-fuxa.ps1', 'stops FUXA.'))) {
  @"
@echo off
rem fuxaw install: $($pair[2])
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0$($pair[1])" %*
"@ -replace "`r?`n", "`r`n" | Set-Content $pair[0] -Encoding Ascii
}
Remove-Item (Join-Path $InstallDir 'open-editor.ps1') -ErrorAction SilentlyContinue  # earlier version
Write-Host "[4/5] Launchers written: $launcher, $stopper"

# 5. Shortcuts (current user, no admin): "Start FUXA" (runtime view) in the Start menu and on the desktop;
#    "FUXA Editor", "Stop FUXA" and "FUXA Project Folder" in the Start menu only. uninstall-fuxa.ps1 removes the same names.
$shell = New-Object -ComObject WScript.Shell
$menuDir = Join-Path ([Environment]::GetFolderPath('Programs')) 'FUXA'
New-Item -ItemType Directory -Force $menuDir | Out-Null
# FUXA's own icon (only 32x32 and 16x16 inside, so it looks a little soft at the 48px desktop size).
$icon = Join-Path $Fuxa 'dist\favicon.ico'
$desktop = [Environment]::GetFolderPath('Desktop')
foreach ($old in 'FUXA Editor.url', 'FUXA Editor.lnk') { Remove-Item (Join-Path $desktop $old) -ErrorAction SilentlyContinue }  # earlier versions
Remove-Item (Join-Path $menuDir 'FUXA Editor.url') -ErrorAction SilentlyContinue
foreach ($s in @(@($menuDir, 'Start FUXA', '', "Start FUXA and show the runtime view (http://127.0.0.1:$Port/home)"),
                 @($desktop, 'Start FUXA', '', "Start FUXA and show the runtime view (http://127.0.0.1:$Port/home)"),
                 @($menuDir, 'FUXA Editor', '-Page editor', "Start FUXA if needed and open the editor (http://127.0.0.1:$Port/editor)"))) {
  $lnk = $shell.CreateShortcut((Join-Path $s[0] ($s[1] + '.lnk')))
  $lnk.TargetPath = $launcher
  $lnk.Arguments = $s[2]
  $lnk.WorkingDirectory = $InstallDir
  $lnk.WindowStyle = 7
  if (Test-Path $icon) { $lnk.IconLocation = "$icon,0" }
  $lnk.Description = $s[3]
  $lnk.Save()
}
$lnk = $shell.CreateShortcut((Join-Path $menuDir 'Stop FUXA.lnk'))
$lnk.TargetPath = $stopper
$lnk.WorkingDirectory = $InstallDir
$lnk.WindowStyle = 7
$lnk.Description = 'Stop FUXA (it runs in the background without a window)'
$lnk.Save()
$lnk = $shell.CreateShortcut((Join-Path $menuDir 'FUXA Project Folder.lnk'))
$lnk.TargetPath = $InstallDir
$lnk.Description = 'FUXA install folder (data\ = project, settings, logs, backups)'
$lnk.Save()
Write-Host "[5/5] Shortcuts: Start FUXA (Start menu, desktop); FUXA Editor, Stop FUXA, FUXA Project Folder (Start menu)"

Write-Host ''
if ($NoStart) {
  Write-Host "Install complete. To start FUXA use the 'Start FUXA' shortcut or $launcher"
  return
}
# Right after install the project is empty, so open the editor rather than the runtime view.
Start-Process -FilePath $launcher -ArgumentList '-Page', 'editor' -WorkingDirectory $InstallDir
$url = "http://127.0.0.1:$Port"
$ready = $false
for ($i = 0; $i -lt 60 -and -not $ready; $i++) {
  Start-Sleep -Seconds 1
  try { Invoke-WebRequest "$url/api/settings" -UseBasicParsing -TimeoutSec 2 | Out-Null; $ready = $true } catch {}
}
if (-not $ready) { throw "FUXA was started but $url does not respond. See $Data\_logs\fuxa.log, or run $server to see its console." }
Write-Host "Install complete. FUXA is running in the background: $url/editor"
Write-Host "Start it with the 'Start FUXA' shortcut (desktop, Start menu), stop it with 'Stop FUXA' (Start menu)."
