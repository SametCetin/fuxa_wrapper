# fuxaw Publish output: loads the project JSON in this folder into the FUXA running on this machine.
# First backs up the current FUXA project to <InstallDir>\data\backups\ (or to backups\ next to this script).
# Same as editor menu -> Open Project (POST /api/project). Connections start right away.
# Usage: download-project.cmd [-Project <project.json>] [-Port 1881] [-InstallDir C:\ProgramData\fuxa] [-Yes]
#   To roll back: download-project.cmd -Project <backup json>
# Messages are ASCII only: Windows PowerShell 5.1 consoles garble UTF-8.
param(
  [string]$Project,
  [int]$Port = 1881,
  [string]$InstallDir = (Join-Path $env:ProgramData 'fuxa'),
  [switch]$Yes
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Url = "http://127.0.0.1:$Port"
# Folder of download-project.cmd (the .cmd extracts this script to %TEMP%, so $PSScriptRoot is not it).
$Here = if ($env:FXW_SCRIPT_DIR) { $env:FXW_SCRIPT_DIR.TrimEnd('\') } else { $PSScriptRoot }

if (-not $Project) {
  $candidates = @(Get-ChildItem $Here -Filter *.json -File)
  if ($candidates.Count -ne 1) { throw "Expected exactly one project JSON in this folder (found $($candidates.Count)). Pass it with -Project." }
  $Project = $candidates[0].FullName
}
$Project = (Resolve-Path $Project).Path
$bytes = [IO.File]::ReadAllBytes($Project)
$prj = [Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json
if (-not $prj.hmi) { throw "$Project is not a FUXA project." }

try { Invoke-WebRequest "$Url/api/settings" -UseBasicParsing -TimeoutSec 5 | Out-Null }
catch { throw "Cannot reach FUXA at $Url. Start it first ($(Join-Path $InstallDir 'start-fuxa.cmd'))." }

$views = @($prj.hmi.views | ForEach-Object { $_.name })
$devices = @($prj.devices.PSObject.Properties | ForEach-Object { $_.Value })
Write-Host "Project:  $Project"
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
if (($loadedViews -join '|') -ne ($views -join '|')) { throw "Could not verify the load: the views in FUXA do not match. To roll back: download-project.cmd -Project `"$backup`"" }
Write-Host ''
Write-Host "Project loaded. Refresh any open runtime pages ($Url/home)."
Write-Host "To roll back: download-project.cmd -Project `"$backup`""
