'use strict';
// Tek dosyalık .cmd: başta kısa bir cmd bölümü, sonunda PowerShell betiği.
// Çift tıklanınca cmd, dosyanın işaretten sonraki kısmını %TEMP%'e .ps1 olarak çıkarır ve çalıştırır;
// böylece hedefte .cmd'nin yanında başka dosya gerekmez. cmd 'exit /b' satırından sonrasını hiç okumaz.
// Betik, .cmd'nin klasörünü FXW_SCRIPT_DIR ortam değişkeninden alır ($PSScriptRoot geçici klasördür).
// Her şey ASCII: Windows PowerShell 5.1 konsolu UTF-8'i bozuk gösterir.

const MARK = '##FUXAW-PS';

function selfContainedCmd(ps, failText) {
  if (/[^\x00-\x7f]/.test(ps)) throw new Error('PowerShell bölümü ASCII olmalı');
  if (ps.includes(MARK)) throw new Error(`PowerShell bölümü ${MARK} içeremez`);
  const lines = [
    '@echo off',
    'setlocal',
    'rem fuxaw: self-contained script. The PowerShell part at the end is extracted to %TEMP% and run.',
    'set "FXW_SCRIPT_DIR=%~dp0"',
    'set "FXW_SELF=%~f0"',
    'set "FXW_PS=%TEMP%\\fuxaw-%RANDOM%%RANDOM%.ps1"',
    // '#'+'#FUXAW-PS': işaret bu satırda bitişik geçmesin, LastIndexOf gerçek işareti bulsun.
    'powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=[IO.File]::ReadAllText($env:FXW_SELF); $m=\'#\'+\'#FUXAW-PS\'; [IO.File]::WriteAllText($env:FXW_PS, $s.Substring($s.LastIndexOf($m)))"',
    'powershell -NoProfile -ExecutionPolicy Bypass -File "%FXW_PS%" %*',
    'set "FXW_RC=%ERRORLEVEL%"',
    'del "%FXW_PS%" >nul 2>&1',
    `if not "%FXW_RC%"=="0" (echo. & echo ${failText}) else (echo. & echo Done.)`,
    'pause',
    'exit /b %FXW_RC%',
    MARK,
  ];
  return (lines.join('\n') + '\n' + ps).replace(/\r?\n/g, '\r\n');
}

/** .cmd'den PowerShell bölümünü çıkarır (testler için; cmd'deki tek satırın yaptığının aynısı). */
function extractPs(cmd) {
  return cmd.slice(cmd.lastIndexOf(MARK));
}

module.exports = { MARK, selfContainedCmd, extractPs };
