# a8a Workflow Editor

Electron 기반 API 워크플로우 편집기입니다. React, TypeScript, sql.js를 사용하며, API 호출 흐름을 캔버스에서 노드로 연결해 실행하고 결과를 추적합니다.

## 주요 기능

- 워크스페이스, 환경, 프로젝트, 모듈 관리
- 프로젝트 생성 시 Start/End 노드 자동 생성
- Data, Select, API, End 노드를 캔버스에 배치하고 연결
- API 노드의 Pre Request, Post Response 스크립트 실행
- 환경 변수 치환과 실행 중 `setEnv()` 반영
- 실행 로그와 노드별 입력/출력 확인
- End 노드에서 HTML 또는 Markdown 리포트 저장

## 기술 스택

- Electron
- electron-vite
- React
- TypeScript
- sql.js
- Monaco Editor
- ExcelJS

## 실행 방법

```bash
npm install
npm run dev
```

빌드는 다음 명령으로 확인합니다.

```bash
npm run build
```

Windows에서는 `dev.bat`, `run.bat`을 사용할 수 있고, Unix 계열 셸에서는 `./dev.sh`, `./run.sh`를 사용할 수 있습니다.

## 프로젝트 구조

```text
src/main/                 Electron 메인 프로세스, DB, IPC
src/preload/              Renderer에 노출되는 window.api 브리지
src/renderer/src/App.tsx  앱 루트 상태와 워크플로우 실행 흐름
src/renderer/src/components/canvas/
                           캔버스와 노드 설정 모달
src/renderer/src/utils/   템플릿 치환, 스크립트 런타임, 리포트 생성
docs/                     아키텍처, 기술부채, 기능 계획 문서
```
