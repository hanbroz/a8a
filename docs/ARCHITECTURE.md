# 아키텍처 개요

## 스택

- Electron 42.2.0
- electron-vite 5
- React 19.2.6
- TypeScript 6.0.3
- sql.js 1.14.1
- Monaco Editor
- ExcelJS

## 프로세스 구조

```text
Main Process
  - sql.js 데이터베이스 초기화와 저장
  - IPC 핸들러 등록
  - HTTP fetch, 파일 저장, 폴더 선택
  - BrowserWindow 생성과 창 상태 저장

Preload
  - contextBridge로 window.api만 노출
  - Renderer가 직접 Node.js API에 접근하지 않도록 분리

Renderer
  - React UI
  - 캔버스 노드/엣지 상태
  - 워크플로우 실행과 로그 표시
```

`BrowserWindow`는 `contextIsolation: true`, `nodeIntegration: false`를 명시합니다. 현재 `sandbox: false`는 sql.js WASM과 기존 preload 구조를 고려한 상태이며, 장기적으로는 샌드박스 전환을 검토해야 합니다.

## 데이터 저장

DB 파일은 `{userData}/a8a.db`에 저장됩니다. 앱 실행 시 sql.js가 메모리 DB를 열고, 변경 후 SQLite 바이너리를 파일로 저장합니다. 저장은 임시 파일을 쓴 뒤 rename하는 방식으로 처리합니다.

## 주요 테이블

```text
workspaces
  id, name, description, sort

environments
  id, workspace_id, name, is_base, color, initial, sort

env_vars
  id, environment_id, key, value, enabled, sort

projects
  id, workspace_id, name, description, sort

modules
  id, workspace_id, type, label, config, is_common, sort

nodes
  id, project_id, type, label, x, y, config, module_id

edges
  id, project_id, source_node_id, target_node_id
```

현재 스키마는 기존 DB 호환성을 위해 명시적 외래 키 마이그레이션을 적용하지 않습니다. 대신 삭제 함수와 생성 함수에서 소유권, 연결 가능성, 고아 데이터 정리를 코드 레벨에서 보강합니다.

## 데이터 계층 규칙

- 워크스페이스 삭제 시 환경 변수, 환경, 프로젝트, 노드, 엣지, 워크스페이스 전용 모듈을 함께 정리합니다.
- 모듈 삭제 시 해당 모듈을 참조하는 노드와 연결 엣지를 함께 정리합니다.
- 모듈을 프로젝트에 배치할 때 공통 모듈이거나 같은 워크스페이스 소속 모듈이어야 합니다.
- 엣지는 같은 프로젝트의 노드끼리만 생성할 수 있습니다.
- 한 노드는 하나의 입력 연결만 받을 수 있습니다.
- 순환 연결, 자기 자신 연결, End에서 시작하는 연결, Start로 들어가는 연결은 허용하지 않습니다.

## IPC API

```ts
window.api.workspace.{ list, create, update, delete }
window.api.environment.{ list, upsert, delete }
window.api.project.{ list, create, update, delete }
window.api.module.{ list, listAll, create, createCommon, update, setCommon, delete }
window.api.node.{ list, create, createFromModule, updatePosition, updateLabel, updateConfig, delete }
window.api.edge.{ list, create, delete }
window.api.http.fetch(url, { method, headers, body? })
window.api.dialog.openDirectory(defaultPath?)
window.api.file.{ write, downloadsDir }
```

`file.write`는 리포트 저장 용도로 제한합니다. `.html`, `.md` 확장자만 허용하고, 사용자가 선택한 디렉터리 또는 다운로드 폴더 하위에만 저장합니다.

## 렌더러 상태 구조

루트 상태는 `src/renderer/src/App.tsx`가 관리합니다. 별도 상태 관리 라이브러리는 사용하지 않습니다.

주요 상태:

- `workspaces`: 워크스페이스, 환경, 프로젝트 목록
- `activeWsId`: 사이드바에서 선택한 워크스페이스
- `activeProjectId`: 현재 열린 프로젝트
- `activeNodes`, `activeEdges`: 현재 프로젝트 캔버스 상태
- `allModules`: 공통/워크스페이스 모듈 목록
- `nodeStatuses`: 실행 중 노드 상태
- `execLogs`: 실행 로그
- 모달 상태: 환경, 프로젝트, 워크스페이스, 노드, 모듈, 삭제 확인

## 실행 흐름

1. Start 노드부터 연결된 노드 목록을 계산합니다.
2. Data 노드는 JSON 출력을 반환합니다.
3. Select 노드는 입력 배열에서 선택한 행을 반환합니다.
4. API 노드는 템플릿 치환 후 main process를 통해 HTTP 요청을 실행합니다.
5. Pre/Post 스크립트는 입력/출력 변수와 환경 변수 업데이트를 반환할 수 있습니다.
6. End 노드는 선택한 모듈의 실행 결과를 HTML 또는 Markdown 리포트로 저장합니다.

실행 환경은 사이드바 선택 상태가 아니라 현재 열린 프로젝트가 속한 워크스페이스의 활성 환경을 기준으로 합니다.

## 문서 정책

모든 문서는 한국어와 UTF-8 인코딩을 기본으로 합니다. 기술 식별자, API 이름, 코드 경로는 원문 그대로 유지할 수 있습니다.
