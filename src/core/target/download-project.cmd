@echo off
rem fuxaw Publish: loads the project in this folder into the FUXA running on this machine (backs it up first). Arguments go to download-project.ps1.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0download-project.ps1" %*
if errorlevel 1 (echo. & echo PROJECT LOAD FAILED.) else (echo. & echo Done.)
pause
