@echo off
setlocal
rem fuxaw - FUXA proje wrapperi
rem   Cift tiklama / komutsuz: Python, Node.js ve FUXA kontrol edilir (eksikse winget ile kurulur),
rem   yerel test FUXA'si baslatilir ve arayuz tarayicida acilir.
rem   Komutla: fuxaw status ^| diff ^| pull ^| publish ^| export ^| lint ^| build ^| backup ^| init ^| designer ^| ui
set "PYTHONPATH=%~dp0;%PYTHONPATH%"

call :findpy
if defined PY goto run
echo Python 3.10+ bulunamadi.
where winget >nul 2>nul
if errorlevel 1 (
  echo winget de yok. Python'u https://www.python.org/downloads/ adresinden kurup tekrar calistir.
  goto fail
)
echo Python 3.12 winget ile kuruluyor...
winget install --id Python.Python.3.12 -e --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
call :findpy
if not defined PY (
  echo Python kurulamadi.
  goto fail
)

:run
"%PY%" -m fuxaw %*
set "RC=%ERRORLEVEL%"
rem Cift tiklamada hata olursa pencere kapanmasin, mesaj okunabilsin
if not "%RC%"=="0" if "%~1"=="" pause
exit /b %RC%

:fail
if "%~1"=="" pause
exit /b 1

:findpy
set "PY="
for %%C in ("python" "%LOCALAPPDATA%\Programs\Python\Python313\python.exe" "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" "%ProgramFiles%\Python313\python.exe" "%ProgramFiles%\Python312\python.exe" "C:\Python313\python.exe" "C:\Python312\python.exe") do (
  if not defined PY (
    "%%~C" -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>nul && set "PY=%%~C"
  )
)
exit /b 0
