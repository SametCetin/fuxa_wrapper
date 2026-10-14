# fuxaw Publish output (download-<project>.cmd): loads the project embedded in this file into FUXA on this
# machine (installed by install-fuxa). Needs no other file. Starts FUXA in the background if it is not running.
# First backs up the current FUXA project to <InstallDir>\data\backups\ (or to backups\ next to this file).
# Same as editor menu -> Open Project (POST /api/project); connections start right away. Then shows the runtime
# view with the new project (the "Start FUXA" app window is reopened; -NoView skips this).
# Usage: download-<project>.cmd [-Project <project.json>] [-Port 1881] [-InstallDir C:\ProgramData\fuxa] [-Yes] [-NoView]
#   -Project loads that JSON instead of the embedded project, e.g. to roll back to a backup.
#
# TEMPLATE: src/core/publish.js fills in the project name and the project JSON (base64) placeholders below.
# Messages are ASCII only: Windows PowerShell 5.1 consoles garble UTF-8.
param(
  [string]$Project,
  [int]$Port = 1881,
  [string]$InstallDir = (Join-Path $env:ProgramData 'fuxa'),
  [switch]$Yes,
  [switch]$NoView
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Url = "http://127.0.0.1:$Port"
# Folder of this .cmd (the .cmd extracts this script to %TEMP%, so $PSScriptRoot is not it).
$Here = if ($env:FXW_SCRIPT_DIR) { $env:FXW_SCRIPT_DIR.TrimEnd('\') } else { $PSScriptRoot }
$Self = if ($env:FXW_SELF) { Split-Path $env:FXW_SELF -Leaf } else { 'download-project.cmd' }

$ProjectName = '__PROJECT_NAME__'
$EmbeddedProject = @'
__PROJECT_JSON__
'@
if ($Project) {
  $Project = (Resolve-Path $Project).Path
  $source = $Project
  $bytes = [IO.File]::ReadAllBytes($Project)
} else {
  if ($ProjectName.StartsWith('__')) { throw 'This is the source template. Use the download-<project>.cmd written by fuxaw Publish.' }
  $source = "$ProjectName (embedded in $Self)"
  $bytes = [Convert]::FromBase64String(($EmbeddedProject -replace '\s', ''))
}
$prj = [Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json
if (-not $prj.hmi) { throw "$source is not a FUXA project." }

function Test-Fuxa { try { Invoke-WebRequest "$Url/api/settings" -UseBasicParsing -TimeoutSec 2 | Out-Null; $true } catch { $false } }
if (-not (Test-Fuxa)) {
  # Same as "Start FUXA": node in the background, no window.
  $node = Join-Path $InstallDir 'node\node.exe'
  $fuxaMain = Join-Path $InstallDir 'app\node_modules\@frangoteam\fuxa\main.js'
  if (-not ((Test-Path $node) -and (Test-Path $fuxaMain))) { throw "FUXA is not running at $Url and no install was found in $InstallDir. Install it with install-fuxa.cmd first." }
  Write-Host 'Starting FUXA...'
  $env:Path = (Join-Path $InstallDir 'node') + ';' + $env:Path
  $data = Join-Path $InstallDir 'data'
  Start-Process -FilePath $node -WorkingDirectory $data -WindowStyle Hidden `
    -ArgumentList "`"$fuxaMain`"", '--port', "$Port", '--userDir', "`"$data`""
  for ($i = 0; $i -lt 60 -and -not (Test-Fuxa); $i++) { Start-Sleep -Seconds 1 }
  if (-not (Test-Fuxa)) { throw "FUXA did not start at $Url. See $data\_logs\fuxa.log." }
}

$views = @($prj.hmi.views | ForEach-Object { $_.name })
$devices = @($prj.devices.PSObject.Properties | ForEach-Object { $_.Value })
Write-Host "Project:  $source"
Write-Host "Target:   $Url"
Write-Host "Views:    $($views -join ', ')"
Write-Host "Devices:  $(($devices | ForEach-Object { "$($_.name) ($($_.type))" }) -join ', ')"
if ($devices | Where-Object { $_.type -eq 'FuxawADS' }) {
  $main = Join-Path $InstallDir 'app\node_modules\@frangoteam\fuxa\main.js'
  if (-not ((Test-Path $main) -and (Select-String -Path $main -Pattern 'fuxaw-yama' -SimpleMatch -Quiet))) {
    Write-Warning "The project uses ADS (fuxaw) connections but no patched FUXA was found in $InstallDir. These connections only work with FUXA installed by install-fuxa."
  }
}
Write-Host ''
Write-Host 'The current FUXA project will be backed up and replaced with this one.'
if (-not $Yes) {
  $answer = Read-Host 'Continue? (Y/N)'
  if ($answer -notmatch '^[yY]') { throw 'Cancelled.' }
}

$backupDir = if (Test-Path (Join-Path $InstallDir 'data')) { Join-Path $InstallDir 'data\backups' } else { Join-Path $Here 'backups' }
New-Item -ItemType Directory -Force $backupDir | Out-Null
$backup = Join-Path $backupDir ("project-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json')
Invoke-WebRequest "$Url/api/project" -UseBasicParsing -OutFile $backup
Write-Host "Backup:   $backup"

Invoke-WebRequest "$Url/api/project" -Method Post -ContentType 'application/json; charset=utf-8' -Body $bytes -UseBasicParsing | Out-Null

$loaded = Invoke-RestMethod "$Url/api/project" -UseBasicParsing
$loadedViews = @($loaded.hmi.views | ForEach-Object { $_.name })
if (($loadedViews -join '|') -ne ($views -join '|')) { throw "Could not verify the load: the views in FUXA do not match. To roll back: $Self -Project `"$backup`"" }
Write-Host ''
Write-Host 'Project loaded.'
Write-Host "To roll back: $Self -Project `"$backup`""

# Show the runtime view with the new project: close the "Start FUXA" app window (Edge with the browser\ profile)
# and let start-fuxa.cmd open it again. Other browser tabs on the runtime view must be refreshed by hand.
$launcher = Join-Path $InstallDir 'start-fuxa.cmd'
if ($NoView -or -not (Test-Path $launcher)) {
  Write-Host "Refresh any open runtime pages ($Url/home)."
  return
}
$profileDir = Join-Path $InstallDir 'browser'
$view = @(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($profileDir) })
foreach ($p in $view) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
if ($view.Count) { Start-Sleep -Seconds 1 }
Start-Process -FilePath $launcher -WorkingDirectory $InstallDir -WindowStyle Minimized
Write-Host 'Runtime view opened with the new project.'
