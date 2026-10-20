!macro customCheckAppRunning
  InitPluginsDir
  File /oname=$PLUGINSDIR\stop-installed-app.ps1 "${PROJECT_DIR}/scripts/stop-installed-app.ps1"
  nsExec::ExecToStack /TIMEOUT=30000 '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\stop-installed-app.ps1" -InstallDirectory "$INSTDIR"'
  Pop $R0
  Pop $R9
  ${if} $R0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "无法关闭这个安装目录的 Lume Dock（代码 $R0）。请关闭该程序后重试；无需删除注册表。"
    SetErrorLevel 2
    Quit
  ${endif}
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\lnkfile\shell\LumeDock"
  DeleteRegKey HKCU "Software\Classes\InternetShortcut\shell\LumeDock"
!macroend
