@echo off
rem fuxaw yamasi: uygula / guncelle. Parametreler uygula.ps1'e gecer (or. uygula.cmd -Durdur).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uygula.ps1" %*
if errorlevel 1 (echo. & echo YAMA UYGULANAMADI.) else (echo. & echo Tamam.)
pause
