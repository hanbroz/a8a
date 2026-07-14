# a8a 프로젝트 에이전트 지침

이 문서는 Codex 및 기타 코딩 에이전트가 이 저장소에서 작업할 때 따라야 할 프로젝트 지침입니다. 모든 문서는 한국어로 작성하고, 한글이 깨지지 않도록 UTF-8 인코딩을 사용합니다.

## 프로젝트 개요

a8a는 Electron 기반 API 워크플로우 자동화 도구입니다. 사용자는 워크스페이스, 환경, 프로젝트, 모듈을 관리하고 캔버스에서 노드를 연결해 API 처리 파이프라인을 구성합니다.

핵심 목적은 다음과 같습니다.

- API 호출 흐름을 시각적으로 구성한다.
- 이전 API 응답이나 데이터 노드의 값을 다음 API 요청에 전달한다.
- 실행 과정의 요청, 응답, 중간 데이터를 추적 가능하게 만든다.
- End 노드에서 선택한 모듈의 실행 결과를 HTML 또는 Markdown 리포트로 저장한다.

## 개발 명령

```bash
npm run dev
npm run build
```

Windows에서는 필요에 따라 다음 스크립트를 사용할 수 있습니다.

```bat
dev.bat
run.bat
```

Unix 계열 셸에서는 다음 스크립트를 사용할 수 있습니다.

```bash
./dev.sh
./run.sh
```

현재 `package.json`에는 테스트와 린트 스크립트가 없습니다. 변경 후 기본 검증은 `npm run build`로 수행합니다.

## 주요 구조

```text
src/
  main/                 Electron 메인 프로세스
    index.ts            앱 초기화, 창 생성, 창 상태 저장
    ipc.ts              IPC 핸들러 등록
    db.ts               sql.js 데이터베이스 스키마와 쿼리
    windowState.ts      창 크기와 위치 저장/복원
  preload/
    index.ts            contextBridge를 통한 window.api 노출
  renderer/src/
    App.tsx             루트 컴포넌트와 전역 상태 관리
    globals.d.ts        window.api 및 주요 타입 선언
    components/
      canvas/           워크플로우 캔버스와 노드 설정 모달
      sidebar/          워크스페이스, 프로젝트, 모듈 사이드바
      env/              환경 변수 UI
    utils/              템플릿 치환, 스크립트 실행, 리포트 생성
    styles/             전역 CSS
```

## 데이터 모델

```text
Workspace
  Environment           BASE 환경을 포함한 여러 실행 환경
  Project
    Node                start, end, data, select, api
    Edge                노드 간 연결
Module                  캔버스에 배치 가능한 재사용 단위
```

모듈은 `workspaceId`와 `isCommon`으로 범위가 결정됩니다.

- `workspaceId === null`: 모든 워크스페이스에서 사용할 수 있는 공통 모듈
- `workspaceId !== null`: 해당 워크스페이스 프로젝트에서만 사용할 수 있는 모듈
- 캔버스에 배치된 노드는 모듈 자체가 아니라 모듈의 인스턴스입니다.

## 모듈 실행과 상태 분리 규칙

- 모듈 정의는 재사용 가능한 기능과 기본 설정을 의미하고, 캔버스에 배치된 노드는 해당 모듈의 독립 인스턴스입니다.
- 같은 모듈 타입이거나 같은 공통 모듈에서 생성된 노드라도 INPUT, OUTPUT, 실행 로그, 실행 상태는 반드시 노드 ID 기준으로 분리해야 합니다.
- 한 SELECT 모듈 인스턴스에서 선택하거나 실행한 INPUT/OUTPUT이 다른 SELECT 모듈 인스턴스에 표시되면 안 됩니다.
- 캔버스 실행은 START 노드에서 시작해 유효한 연결선을 따라 도달 가능한 노드만 순차 실행합니다.
- START와 연결되지 않은 모듈, 연결선이 끊어진 모듈, 유효하지 않은 연결의 대상 노드는 실행하지 않습니다.
- 실행 중 어떤 모듈에서든 오류가 발생하면 즉시 전체 실행을 중단하고, 이후 모듈이나 End 모듈로 진행하지 않습니다.
- 모듈 설정창의 실행 버튼은 현재 설정창이 열린 캔버스 노드 인스턴스를 기준으로 START부터 해당 노드까지의 연결 경로만 실행하고, 그 결과를 해당 노드의 INPUT/OUTPUT에 표시해야 합니다.
- 사이드바의 모듈 정의 편집 화면은 특정 캔버스 인스턴스의 INPUT/OUTPUT을 임의로 가져오면 안 됩니다.

## 중요한 구현 규칙

### 1. Topbar 기준은 현재 열린 프로젝트입니다

상단 브레드크럼의 `환경 | 워크스페이스 > 프로젝트` 표시는 사이드바에서 선택된 워크스페이스가 아니라 현재 열린 프로젝트가 속한 워크스페이스와 환경을 기준으로 해야 합니다.

```ts
const activeProjectWs = workspaces.find(w => w.projects.some(p => p.id === activeProjectId))
const activeProjectEnv = activeProjectWs?.environments.find(e => e.id === activeProjectWs.activeEnvId)
```

### 2. 모듈 드롭은 워크스페이스 범위를 지켜야 합니다

워크스페이스 소속 모듈은 같은 워크스페이스의 프로젝트 캔버스에만 드롭할 수 있습니다. 공통 모듈은 모든 워크스페이스에서 사용할 수 있습니다.

드래그 시작 시 모듈의 워크스페이스 ID를 함께 전달합니다.

```ts
onDragStart={e => {
  e.dataTransfer.setData('moduleId', mod.id)
  e.dataTransfer.setData('moduleWsId', mod.workspaceId ?? '')
}}
```

캔버스 드롭 처리와 최종 모듈 생성 처리 양쪽에서 워크스페이스 범위를 검증해야 합니다.

### 3. 캔버스 노드 삭제는 인스턴스만 삭제합니다

프로젝트 캔버스에서 노드를 삭제할 때는 캔버스의 노드 인스턴스만 삭제해야 합니다. 연결된 모듈 원본은 삭제하지 않습니다.

```ts
await window.api.node.delete(editingNode.id)
setActiveNodes(prev => prev.filter(n => n.id !== editingNode.id))
setActiveEdges(prev => prev.filter(
  e => e.sourceNodeId !== editingNode.id && e.targetNodeId !== editingNode.id
))
```

사이드바 모듈 목록에서 모듈을 삭제하는 동작은 별도 기능입니다. 이 경우 모듈 원본과 해당 모듈을 참조하는 노드 처리 정책을 함께 고려해야 합니다.

### 4. Select 요소는 화살표와 텍스트가 겹치면 안 됩니다

모든 `<select>` 요소는 드롭다운 화살표가 텍스트와 겹치지 않도록 충분한 오른쪽 패딩을 가져야 합니다.

```css
select {
  padding-right: 32px;
}
```

### 5. 사용자 작성 스크립트는 신뢰 실행입니다

API 노드의 Pre Request, Post Response 스크립트는 현재 격리된 샌드박스가 아니라 앱 런타임에서 신뢰 실행됩니다. 스크립트 격리, Worker 실행, 권한 제한은 후속 보안 과제로 다룹니다.

### 6. 스크립트 실패는 프로세스를 중단하지 않습니다

Pre Request / Post Response 스크립트가 예외를 던져도 워크플로우 실행은 계속됩니다. 오류는 Request/Response(OUTPUT) 창에 노출하지 않고, 해당 노드의 스크립트 로그 콘솔에 `error` 레벨 항목으로만 기록합니다.

- 구현 위치는 `src/renderer/src/utils/scriptRuntime.ts`의 `runPreRequest` / `runPostResponse` 한 곳뿐입니다. 두 함수는 스크립트 예외를 다시 던지지 않고 `pushScriptError`로 로그에 남긴 뒤 부분 결과를 정상 반환합니다.
- 따라서 실패 시 Post Response는 `outputOverride` 없이 실제 응답을, Pre Request는 빈 `inputVars`로 요청을 계속 진행합니다.
- `App.tsx` 각 호출 지점의 `catch(isScriptRuntimeError...)` 블록은 이제 스크립트 오류에 대해선 도달하지 않는 안전망입니다. 스크립트 실패를 다시 치명적으로 만들려면 런타임에서 되돌려야 하며, 호출 지점만 고쳐선 안 됩니다.

## 노드 색상 체계

| 타입 | 색상 | 의미 |
| --- | --- | --- |
| `data` | 파란색 | 수동 입력 또는 Excel 기반 데이터 소스 |
| `select` | 보라색 | 입력 데이터 선택과 필터링 |
| `api` | 초록색 | HTTP API 호출 |
| `start` | 초록 테두리 | 워크플로우 시작점 |
| `end` | 회색 | 워크플로우 종료점과 리포트 생성 |

## window.api 요약

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

## 문서 작성 규칙

- 모든 문서와 주석성 설명은 한국어로 작성합니다.
- Markdown 문서는 UTF-8로 저장합니다.
- 한글이 깨져 보이는 문서를 발견하면 새 변경에서 그대로 복사하지 말고 의미를 복원해 정상 한국어로 다시 작성합니다.
- 명령어, 경로, 타입명, API 이름은 원문 그대로 코드 표기로 작성합니다.
- 사용자-facing 문구는 한국어를 기본으로 하되, HTTP, API, JSON 같은 기술 약어는 그대로 사용할 수 있습니다.
- 사람에게 보여주는 보고서나 의사결정 사항은 HTML 형태로 최대한 시각적으로 보여 주도록 합니다.

## 알려진 주의사항

- `docs/TECH_DEBT.md`에 IPC 입력 검증, DB atomic write, 외래 키와 UNIQUE 제약, preload 보안 fallback 등 미해결 기술부채가 정리되어 있습니다.
- `App.tsx`에 상태와 실행 흐름이 많이 모여 있으므로, 큰 기능을 추가할 때는 기존 상태 구조와 모달 라우팅을 먼저 확인합니다.
- 기존 문서 일부는 인코딩이 깨져 보일 수 있습니다. 작업 시 깨진 문자열을 새 문서나 코드 주석에 재사용하지 않습니다.
