!ifndef BUILD_UNINSTALLER
  !include nsDialogs.nsh
  !include LogicLib.nsh
  !include MUI2.nsh
  !include installer-release-notes.nsh

  Var A8AReleaseNotesDialog
  Var A8AReleaseNotesText

  !macro customWelcomePage
    !insertmacro MUI_PAGE_WELCOME
    Page custom A8AShowReleaseNotesPage A8ALeaveReleaseNotesPage
  !macroend

  Function A8AShowReleaseNotesPage
    !insertmacro MUI_HEADER_TEXT "업데이트 안내" "설치 전에 이번 버전의 주요 변경사항을 확인합니다."

    nsDialogs::Create 1018
    Pop $A8AReleaseNotesDialog
    ${If} $A8AReleaseNotesDialog == error
      Abort
    ${EndIf}

    ${NSD_CreateLabel} 0 0 100% 20u "이번 설치 파일에 포함된 주요 업데이트입니다."
    Pop $0

    ${NSD_CreateRichEdit} 0 24u 100% 142u "${A8A_INSTALLER_RELEASE_NOTES}"
    Pop $A8AReleaseNotesText
    SendMessage $A8AReleaseNotesText ${EM_SETREADONLY} 1 0

    nsDialogs::Show
  FunctionEnd

  Function A8ALeaveReleaseNotesPage
  FunctionEnd
!endif
