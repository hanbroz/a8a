!ifndef A8A_INSTALLER_RELEASE_NOTES_INCLUDED
!define A8A_INSTALLER_RELEASE_NOTES_INCLUDED

!define A8A_INSTALLER_RELEASE_NOTES "a8a 업데이트 안내$\r$\n$\r$\n- API 모듈이 INPUT 형태에 따라 같은 HTTP 요청을 중복 실행할 수 있던 중대 문제를 수정했습니다.$\r$\n- API 모듈은 INPUT이 여러 노드에서 합쳐지거나 배열 값을 포함하더라도 노드 실행당 HTTP 요청을 한 번만 보냅니다.$\r$\n- SELECT가 반환한 배열 값을 반복 실행 row로 오인하지 않도록 API 입력 조립 로직을 고정했습니다.$\r$\n- 실행 로그에는 API 요청 URL, 요청 헤더, 요청 바디, 응답 바디, cURL 명령어를 실제 호출 단위로 기록합니다.$\r$\n- END 모듈 HTML/Markdown 리포트도 API 요청/응답 상세를 INPUT 또는 OUTPUT 제외 설정과 관계없이 유지합니다."

!endif
