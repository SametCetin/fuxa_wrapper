@echo off
rem fuxaw target install: Node.js + FUXA (from the internet) + fuxaw patch. Arguments go to install-fuxa.ps1 (e.g. install-fuxa.cmd -InstallDir D:\fuxa).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-fuxa.ps1" %*
if errorlevel 1 (echo. & echo INSTALL FAILED.) else (echo. & echo Done.)
pause
