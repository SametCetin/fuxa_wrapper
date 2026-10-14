@echo off
rem install-fuxa kurulumunu kaldirir; data\ (proje) korunur. Parametreler uninstall-fuxa.ps1'e gecer (or. uninstall-fuxa.cmd -Evet).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall-fuxa.ps1" %*
if errorlevel 1 (echo. & echo KALDIRILAMADI.) else (echo. & echo Tamam.)
pause
