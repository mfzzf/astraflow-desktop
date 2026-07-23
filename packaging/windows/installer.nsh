; Chromium sandboxed processes use these two named capabilities to read and
; execute installation files. Keep the SIDs aligned with Chromium's
; chrome/installer/setup/configure_app_container_sandbox.cc.
; Source for the Chromium 148 version bundled by Electron 42:
; https://chromium.googlesource.com/chromium/src/+/refs/tags/148.0.7778.271/chrome/installer/setup/configure_app_container_sandbox.cc
!define CHROMIUM_INSTALL_FILES_CAPABILITY_SID "S-1-15-3-1024-3424233489-972189580-2057154623-747635277-1604371224-316187997-3786583170-1043257646"
!define CHROMIUM_LPAC_INSTALL_FILES_CAPABILITY_SID "S-1-15-3-1024-2302894289-466761758-1166120688-1039016420-2430351297-4240214049-4028510897-3317428798"

!macro customInstall
  Push $0
  DetailPrint "Configuring Chromium sandbox access to AstraFlow files..."

  ; customInstall runs after extraction for both fresh installs and updates.
  ; Apply the inheritable ACEs recursively because an existing destination can
  ; contain children with ACL inheritance disabled. This grants read/execute
  ; only to Chromium's install-file capabilities; it does not disable a sandbox
  ; or expose the directory to every AppContainer.
  nsExec::Exec `"$SYSDIR\icacls.exe" "$INSTDIR" /grant:r "*${CHROMIUM_INSTALL_FILES_CAPABILITY_SID}:(OI)(CI)(RX)" "*${CHROMIUM_LPAC_INSTALL_FILES_CAPABILITY_SID}:(OI)(CI)(RX)" /T /C /Q`
  Pop $0

  ; Match Chromium's best-effort installer behavior. Existing inherited ACLs
  ; can already satisfy the sandbox even when endpoint policy blocks icacls, so
  ; an ACL-tool failure must not leave a half-installed application behind.
  ${If} $0 != 0
    DetailPrint "Warning: Chromium sandbox ACL setup exited with code $0."
  ${EndIf}

  Pop $0
!macroend
