@echo off
rem Removes the install-fuxa install; data\ (project) is kept. Arguments go to uninstall-fuxa.ps1 (e.g. uninstall-fuxa.cmd -Yes).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall-fuxa.ps1" %*
if errorlevel 1 (echo. & echo UNINSTALL FAILED.) else (echo. & echo Done.)
pause
