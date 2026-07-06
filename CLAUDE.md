# a8a — API Workflow 프로젝트 가이드

> 공통 에이전트 지침은 `AGENTS.md`로 이전했습니다. Claude Code에서 작업하더라도 최신 작업 규칙은 `AGENTS.md`를 우선 확인합니다. 모든 문서는 한국어로 작성하고 UTF-8 인코딩을 유지합니다.

## 프로젝트 개요

Electron 기반 API 워크플로우 자동화 도구. 사이드바에서 워크스페이스/프로젝트/모듈을 관리하고, 캔버스에서 노드를 연결하여 데이터 처리 파이프라인을 구성한다.

## 개발 환경

```bash
npm run dev      # 개발 서버 실행
npm run build    # 빌드
./run.sh         # 백그라운드 실행 (변경사항 확인 시 사용)
```

> 코드 수정 후에는 기존 앱을 종료하고 `./run.sh`로 재시작하여 변경사항을 확인한다.

## 아키텍처

```
src/
├── main/               # Electron 메인 프로세스
│   └── ipc.ts          # IPC 핸들러 (DB 연동)
├── preload/
│   └── index.ts        # window.api 브리지
└── renderer/src/
    ├── App.tsx          # 루트 컴포넌트 (전역 상태 관리)
    ├── globals.d.ts     # 전역 타입 정의 (ApiNode, ApiModule 등)
    ├── components/
    │   ├── canvas/      # 워크플로우 캔버스 컴포넌트
    │   └── sidebar/     # 사이드바 컴포넌트
    └── styles/          # CSS 스타일
```

## 핵심 데이터 모델

### 워크스페이스 계층 구조
```
Workspace
├── Environment (BASE 포함 여러 환경)
└── Project
    └── Node (start / end / data / select / api)
        └── Edge (노드 간 연결)
```

### 모듈 (Module)
- `workspaceId: string | null` — null이면 공통 모듈, 아니면 워크스페이스 소속
- `isCommon: boolean` — 공통 모듈 여부
- 모듈은 재사용 가능한 기능 단위. 프로젝트 캔버스에 인스턴스(노드)로 배치된다.

### 노드 (ApiNode)
- `moduleId?: string | null` — 모듈 연결 노드면 moduleId 존재, 독립 노드면 null/undefined

## 중요 설계 규칙

### 1. Topbar 브레드크럼은 열린 프로젝트 기준
캔버스 상단 `환경 | 워크스페이스 > 프로젝트`는 **사이드바에서 현재 선택된 워크스페이스가 아닌**, 현재 열려있는 프로젝트가 속한 워크스페이스/환경을 표시해야 한다.

```ts
// App.tsx — 사이드바 선택(activeWsId)과 분리된 파생값
const activeProjectWs = workspaces.find(w => w.projects.some(p => p.id === activeProjectId))
const activeProjectEnv = activeProjectWs?.environments.find(e => e.id === activeProjectWs.activeEnvId)
```

### 2. 모듈 드롭 제한 — 워크스페이스 단위 격리
워크스페이스 소속 모듈은 **해당 워크스페이스의 프로젝트 캔버스에만** 드롭 가능하다. 공통 모듈(`workspaceId === null`)은 모든 워크스페이스에서 사용 가능.

두 단계 가드를 통해 강제한다:

**1단계 — ModuleSection (드래그 시작):**
```ts
onDragStart={e => {
  e.dataTransfer.setData('moduleId', mod.id)
  e.dataTransfer.setData('moduleWsId', mod.workspaceId ?? '') // 공통이면 ''
}}
```

**2단계 — WorkflowCanvas (드롭 시):**
```ts
const moduleWsId = e.dataTransfer.getData('moduleWsId')
if (moduleWsId && activeProjectWsId && moduleWsId !== activeProjectWsId) return
```

**3단계 — App.tsx handleModuleDrop (서버 호출 전 최종 가드):**
```ts
if (mod.workspaceId !== null) {
  const projectWsId = workspaces.find(w => w.projects.some(p => p.id === activeProject.id))?.id
  if (mod.workspaceId !== projectWsId) return
}
```

### 3. 캔버스에서 노드 삭제 = 인스턴스만 제거
프로젝트 캔버스에서 모듈 연결 노드를 삭제할 때 **모듈 자체는 삭제하지 않는다**. 사이드바 모듈 목록에서 계속 재사용 가능해야 한다.

```ts
// 항상 노드 인스턴스만 삭제 (moduleId 유무 무관)
await window.api.node.delete(editingNode.id)
setActiveNodes(prev => prev.filter(n => n.id !== editingNode.id))
setActiveEdges(prev => prev.filter(e => e.sourceNodeId !== editingNode.id && e.targetNodeId !== editingNode.id))
```

모달의 삭제 경고 문구도 이를 반영:
```tsx
⚠ {node.moduleId ? '캔버스에서 노드만 제거됩니다. 모듈은 유지됩니다.' : '이 노드가 삭제됩니다.'}
```

**사이드바 모듈 삭제 버튼**(`handleDeleteModule`)은 별도 동작 — 모듈과 연결된 모든 노드를 일괄 삭제한다.

### 4. Select 요소 패딩 규칙
모든 `<select>` 요소는 `padding-right: 32px` 이상 확보한다 (드롭다운 화살표가 텍스트와 겹치지 않도록).

### 5. 세션 상태 유지 (종료 후 복원)
실행 로그·노드 결과·화면 위치는 전부 `App.tsx`의 React state(메모리)라 종료 시 사라진다.
이를 `userData/session-state.json`(암호화)에 저장해 재실행 시 복원한다.

- 저장은 `src/main/sessionState.ts`(IPC `session:get`/`session:save`) — `windowState.ts`와 동일 패턴. Electron `safeStorage`로 암호화(응답에 PII/토큰 포함 가능), temp+rename 원자적 쓰기.
- 렌더러(`App.tsx`)는 대상 슬라이스를 400ms 디바운스로 저장하되, **복원 완료 전(`sessionReadyRef`)·실행 중(`canvasExecution`)에는 저장하지 않는다.**
- 복원 시 `activeProjectId`를 세팅하면 **프로젝트 전환 효과가 실행 상태를 초기화**하므로, `sessionRestoringRef`로 그 초기화를 딱 1회 건너뛴다. 이 순서 의존성은 건드릴 때 주의.
- `canvasExecution`(라이브 실행)은 저장/복원하지 않으며, `normalizeRestoredRun`이 로드 시 진행 중(running/pending) 잔여 상태를 정리한다.

## 노드 타입별 색상 체계

| 타입 | 색상 | 용도 |
|------|------|------|
| data | `#1f6feb` (파랑) | 데이터 소스 (수동 입력 / Excel) |
| select | `#8957e5` (보라) | 행 선택 필터 |
| api | `#3fb950` (초록) | HTTP API 호출 |
| start | 초록 테두리 | 워크플로우 시작점 |
| end | 회색 | 워크플로우 끝점 |

## window.api 인터페이스 요약

```ts
window.api.workspace.{ list, create, update, delete }
window.api.environment.{ list, upsert, delete }
window.api.project.{ list, create, update, delete }
window.api.module.{ list, listAll, create, createCommon, update, setCommon, delete }
window.api.node.{ list, create, createFromModule, updatePosition, updateLabel, updateConfig, delete }
window.api.edge.{ list, create, delete }
window.api.http.fetch(url, { method, headers, body? })
window.api.session.{ get, save }   // 세션 상태 저장/복원 (암호화)
```

## 알려진 주의사항

- 기존에 전역 타입(`ApiNode`, `JSX` 등)을 ambient declaration으로 사용 중 — tsc 구성 이슈는 코드 변경과 무관한 사전 존재 문제
- `handleModuleDrop`의 `mod.workspaceId !== null` 체크는 strict equality. 백엔드가 `undefined`를 반환하는 경우는 현재 없으나, 필요 시 `!= null`로 변경 가능
- 모듈 드롭 거부 시 사용자에게 시각적 피드백 없음 (추후 개선 권고)
