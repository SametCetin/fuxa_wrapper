@echo off
rem fuxaw hedef kurulumu: Node.js + FUXA (internetten) + fuxaw yamasi. Parametreler install-fuxa.ps1'e gecer (or. install-fuxa.cmd -Hedef D:\fuxa).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-fuxa.ps1" %*
if errorlevel 1 (echo. & echo KURULUM TAMAMLANAMADI.) else (echo. & echo Tamam.)
pause
