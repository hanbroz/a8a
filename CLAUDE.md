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
    ├── hooks/           # 공통 훅 (useEscapeClose 등)
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

### 6. JSON 뷰어 부품은 `JsonInspector`에서 재사용
JSON 트리는 `JsonInspector`(뷰어)와 `SelectionPopup`(선택 창) 두 곳에서 그린다. 검색/복사 UI를 새로 만들지 말고 export된 부품과 CSS 클래스를 가져다 쓴다.

```ts
import { HighlightedText, JsonCopyButton, normalizeSearchQuery } from './JsonInspector'
// CSS: .json-inspector-search / -mark / -active 그대로 재사용
```

- 검색은 **필터링이 아니라 하이라이트 + 이동**. 필터링하면 경로 정보가 사라진다.
- 펼치는 건 **활성 매치 하나의 조상만**. 매치 전체를 펼치면 짧은 검색어로 트리가 통째로 열려 수만 줄이 렌더된다.
- 스크롤 effect는 `expandedIds`에 의존하되 `scrolledMatchRef` 1회 가드를 반드시 둔다. 없으면 무관한 노드를 접을 때마다 화면이 매치로 튕긴다.

### 7. `SelectionPopup`은 렌더마다 도는 계산이 곧 프리징
수십만 노드 응답을 다루는 창이다. 뭘 추가하든 **입력값과 무관한 계산이 리렌더에 딸려 도는지** 먼저 본다. (24만 노드에서 키 입력 1회당 약 450ms였음)

- `flattenJson` / `getVisibleNodes` / 초기 상태 블록 / `readSavedState`는 `useMemo`로 묶는다.
- `paths.filter(p => nodes.some(n => n.id === p))` 금지 — O(경로×노드). `Set` 색인 후 조회.
- **입력 중인 검색어는 state 금지.** state면 한 글자마다 트리 행 전체가 리렌더된다. 비제어 input(`defaultValue` + `ref`) + Enter 시점에만 `appliedQuery`로 반영. 하이라이트도 `appliedQuery` 기준.

### 8. 레이어 팝업 ESC 닫기는 `useEscapeClose` 스택만 사용

팝업마다 `window.addEventListener('keydown')`을 달면 겹쳐 열렸을 때 ESC 한 번에 여러 창이 닫힌다.
ESC 처리 주체는 `hooks/escapeStack.ts` 하나이고, 각 팝업은 훅으로 등록만 한다.

```ts
useEscapeClose(onClose)                                    // 열려 있는 동안 항상
useEscapeClose(onClose, !saving)                           // 조건부
useEscapeClose(() => setFullscreen(false), fullscreen)     // 모달 안의 전체화면 레이어
```

- **스택 최상단(가장 마지막에 등록된) 핸들러만** 실행된다. 등록 순서 = 마운트/활성화 순서이므로, 모달 안에서 열리는 확인창·전체화면·피커가 자동으로 우선한다.
- 훅은 `onClose`를 ref로 들고 있어 인라인 함수를 넘겨도 재등록되지 않는다. **재등록되면 아래 깔린 팝업이 최상단으로 올라가 엉뚱한 창이 닫힌다.**
- 검색창처럼 ESC에 자체 의미가 있는 입력은 `e.stopPropagation()`으로 전파를 끊는다. React는 루트 컨테이너에 리스너를 붙이므로 여기서 끊으면 window까지 가지 않는다.
- 한글 조합 중 ESC(`event.isComposing`)는 무시한다.
- 새 팝업을 만들면 X 버튼 툴팁은 `t('common.closeEsc')`를 쓴다(ESC로 닫을 수 있다는 안내). `aria-label`은 `t('common.close')` 유지.
- 검증: `npm run check:escape-stack`

### 9. 노드 편집 모달을 저장 없이 닫을 때는 `useDirtyClose`

X 버튼·취소·ESC·배경 클릭은 모두 `requestClose`를 지나야 한다. 저장 후 닫기는 `onClose`를 직접 호출해 확인창을 건너뛴다.

```tsx
const { dirtyProps, requestClose, dirtyDialog } = useDirtyClose(onClose)
useEscapeClose(requestClose)
...
<div className="dm-overlay" {...dirtyProps}>   // 루트 하나로 안쪽 입력 변경을 캡처
{dirtyDialog}                                   // ConfirmDialog 재사용
```

변경 감지는 `onInputCapture` / `onChangeCapture` 한 쌍이다. 타이핑·체크박스·셀렉트·파일선택은 잡히지만 **버튼으로만 값이 바뀌는 조작(행 추가 등)은 잡히지 않는다.** 정확도가 필요하면 모달별로 저장용 config를 만드는 함수를 분리해 초기값과 비교해야 한다.

### 10. `pointer-events: none` 오버레이 안에 겹쳐 뜨는 팝업

노드 모달 배경 `.dm-overlay`는 뒤쪽 캔버스를 계속 쓰게 하려고 `pointer-events: none`이고, `.dm-modal`이 `all`로 되살린다.
`pointer-events`는 상속되므로 이 배경의 직접 자식으로 팝업을 렌더하면 **보이지만 클릭이 죽는다.** `.modal-overlay`는 `pointer-events: auto`를 명시해 이 상속을 끊어 둔 상태다.

> 증상 구분: 안 보이면 z-index, 보이는데 안 눌리면 `pointer-events`.

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
