@echo off
rem fuxaw yamasi: geri al. Parametreler geri-al.ps1'e gecer (or. geri-al.cmd -Durdur).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0geri-al.ps1" %*
if errorlevel 1 (echo. & echo GERI ALINAMADI.) else (echo. & echo Tamam.)
pause
