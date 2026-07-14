# a8a 업데이트 안내

이번 버전은 **스크립트 오류 처리 개선** Windows 릴리즈입니다.

- Pre Request / Post Response 스크립트가 실패해도 **워크플로우 실행이 중단되지 않고 계속 진행**됩니다.
- 스크립트 오류는 더 이상 **Request/Response(OUTPUT) 창에 노출되지 않습니다.** 해당 창에는 실제 API 응답만 표시됩니다.
- 스크립트 실패 사유는 해당 노드의 **POST RESPONSE / PRE REQUEST 로그 콘솔에 오류 항목으로 기록**되어 원인을 확인할 수 있습니다.
