; fuxaw kurulum paketi (NSIS, electron-builder nsis.include): gömülü FUXA + Node.js "runtime"ı uygulamadan ayrı kurar.
; scripts/after-pack.js runtime'ı uygulama klasöründen çıkarıp dist/fuxaw-runtime.7z yapar ve kimliğini
; dist/fuxaw-runtime.nsh'e yazar. Kurulum:
;   %ProgramData%\fuxaw-runtime\<kimlik>\.complete varsa hiçbir şey yapmaz (güncellemelerin çoğu: saniyeler),
;   yoksa arşivi <kimlik>.partial'a açar, doğrular, <kimlik> olarak yeniden adlandırır, .complete yazar.
; VC runtime gibi: kaldırma silmez, eski kimlikler yerinde kalır (başka kurulum/sürüm kullanıyor olabilir).
; Uygulama tarafı: src/main/runtime.js.

!include "${PROJECT_DIR}\dist\fuxaw-runtime.nsh"

!macro customInstall
  ReadEnvStr $R9 PROGRAMDATA
  ${if} $R9 == ""
    StrCpy $R9 "C:\ProgramData"
  ${endif}
  StrCpy $R8 "$R9\fuxaw-runtime\${FXW_RUNTIME_ID}"

  ${ifNot} ${FileExists} "$R8\.complete"
    DetailPrint "fuxaw runtime: ${FXW_RUNTIME_ID}"
    CreateDirectory "$R9\fuxaw-runtime"
    RMDir /r "$R8.partial"
    RMDir /r "$R8"
    SetOutPath "$R8.partial"
    ; Arşiv zaten sıkıştırılmış (yeniden sıkıştırma yok); runtime varken bu blok atlanır, arşiv açılmaz.
    SetCompress off
    File "/oname=$PLUGINSDIR\fuxaw-runtime.7z" "${FXW_RUNTIME_7Z}"
    SetCompress auto
    Nsis7z::ExtractWithDetails "$PLUGINSDIR\fuxaw-runtime.7z" "%s"
    Delete "$PLUGINSDIR\fuxaw-runtime.7z"
    SetOutPath "$INSTDIR"

    ${ifNot} ${FileExists} "$R8.partial\node\node.exe"
    ${orIfNot} ${FileExists} "$R8.partial\fuxa\node_modules\@frangoteam\fuxa\main.js"
      RMDir /r "$R8.partial"
      MessageBox MB_OK|MB_ICONSTOP "fuxaw runtime could not be installed to $R8" /SD IDOK
      SetErrorLevel 3
      Quit
    ${endif}

    ClearErrors
    Rename "$R8.partial" "$R8"
    ${if} ${Errors}
      RMDir /r "$R8.partial"
      MessageBox MB_OK|MB_ICONSTOP "fuxaw runtime could not be moved to $R8" /SD IDOK
      SetErrorLevel 3
      Quit
    ${endif}
    FileOpen $R7 "$R8\.complete" w
    FileWrite $R7 "${FXW_RUNTIME_ID}"
    FileClose $R7
  ${endif}
!macroend
