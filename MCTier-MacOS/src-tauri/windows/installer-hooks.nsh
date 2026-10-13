; An update keeps the same encrypted state and scheduled executable path.
; Only an actual uninstall removes this installation's Quark tasks.
!macro NSIS_HOOK_PREUNINSTALL
  ${If} $UpdateMode <> 1
    IfFileExists "$INSTDIR\mctier.exe" 0 +2
      ExecWait '"$INSTDIR\mctier.exe" --quark-background-uninstall'
  ${EndIf}
!macroend
