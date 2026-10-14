# fuxaw target install: Node.js + FUXA + fuxaw patch into one folder (no admin rights needed).
#   <InstallDir>\node\    Node.js (from nodejs.org, SHA256 verified; system PATH is not touched)
#   <InstallDir>\app\     FUXA (from npm, over the internet)
#   <InstallDir>\data\    project, settings, databases, logs (FUXA --userDir); kept on reinstall/uninstall
#   <InstallDir>\start-fuxa.cmd
# Safe to run again: whatever is already installed in the right version is skipped, the patch is always refreshed.
# Usage: install-fuxa.cmd [-InstallDir C:\ProgramData\fuxa] [-Port 1881] [-Stop] [-NoStart]
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

$versions = Get-Content (Join-Path $PSScriptRoot 'version.json') -Raw | ConvertFrom-Json
$NodeVersion = $versions.node
$FuxaVersion = $versions.fuxa[0]
if (-not [Environment]::Is64BitOperatingSystem) { throw 'This installer requires 64-bit Windows.' }

New-Item -ItemType Directory -Force $InstallDir | Out-Null
$InstallDir = (Resolve-Path $InstallDir).Path
$NodeDir = Join-Path $InstallDir 'node'
$Node = Join-Path $NodeDir 'node.exe'
$App = Join-Path $InstallDir 'app'
$Fuxa = Join-Path $App 'node_modules\@frangoteam\fuxa'
$Data = Join-Path $InstallDir 'data'
Write-Host "Install folder: $InstallDir"

# A running FUXA locks its files; stop it first.
$procs = @(Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath.StartsWith($InstallDir + '\', [StringComparison]::OrdinalIgnoreCase) })
if ($procs.Count) {
  if (-not $Stop) { throw "FUXA from this folder is running ($($procs.Count) processes). Close it first or run install-fuxa.cmd -Stop." }
  foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
  Write-Host 'Stopped the running FUXA.'; Start-Sleep -Seconds 2
}

# 1. Node.js
$current = if (Test-Path $Node) { (& $Node -v).Trim() } else { '' }
if ($current -eq $NodeVersion) {
  Write-Host "[1/4] Node.js $NodeVersion already installed."
} else {
  Write-Host "[1/4] Downloading Node.js $NodeVersion..."
  $base = "node-$NodeVersion-win-x64"
  $dist = "https://nodejs.org/dist/$NodeVersion"
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ("fuxaw-install-" + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory $tmp | Out-Null
  try {
    $zip = Join-Path $tmp "$base.zip"
    Invoke-WebRequest "$dist/$base.zip" -OutFile $zip -UseBasicParsing
    $sums = (Invoke-WebRequest "$dist/SHASUMS256.txt" -UseBasicParsing).Content
    $expected = ($sums -split "`n" | Where-Object { $_ -match "\s$([regex]::Escape("$base.zip"))\s*$" } | Select-Object -First 1) -replace '\s.*$', ''
    $actual = (Get-FileHash $zip -Algorithm SHA256).Hash
    if (-not $expected -or $expected -ne $actual) { throw "$base.zip failed verification (SHA256 mismatch)." }
    & (Join-Path $env:SystemRoot 'System32\tar.exe') -xf $zip -C $tmp
    if ($LASTEXITCODE) { throw "Could not extract $base.zip." }
    if (Test-Path $NodeDir) { Remove-Item $NodeDir -Recurse -Force }
    Move-Item (Join-Path $tmp $base) $NodeDir
  } finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
  Write-Host "      Node.js $((& $Node -v).Trim()) installed."
}

# 2. FUXA (npm, over the internet). Package install scripts are not run.
$env:Path = "$NodeDir;$env:Path"
$fcurrent = if (Test-Path (Join-Path $Fuxa 'package.json')) { (Get-Content (Join-Path $Fuxa 'package.json') -Raw | ConvertFrom-Json).version } else { '' }
if ($fcurrent -eq $FuxaVersion) {
  Write-Host "[2/4] FUXA $FuxaVersion already installed."
} else {
  Write-Host "[2/4] Installing FUXA $FuxaVersion from npm (may take a few minutes)..."
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

# 3. Patch
Write-Host '[3/4] Applying the fuxaw patch...'
& (Join-Path $PSScriptRoot 'apply-patch.ps1') -FuxaDir $Fuxa

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
Write-Host "[4/4] Launcher written: $launcher"

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
