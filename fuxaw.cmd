@echo off
rem fuxaw - FUXA proje wrapperi. Kullanim: fuxaw status ^| diff ^| pull ^| publish ^| lint ^| build ^| backup ^| init
rem Proje klasorunde (fuxaw.json) veya ust klasorunde calistir; ya da -p ^<klasor^> ver.
set "PYTHONPATH=%~dp0;%PYTHONPATH%"
python -m fuxaw %*
