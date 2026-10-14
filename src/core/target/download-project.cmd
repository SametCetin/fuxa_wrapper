@echo off
rem fuxaw Publish: bu klasordeki projeyi hedefte calisan FUXA'ya yukler (once yedekler). Parametreler download-project.ps1'e gecer.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0download-project.ps1" %*
if errorlevel 1 (echo. & echo PROJE YUKLENEMEDI.) else (echo. & echo Tamam.)
pause
