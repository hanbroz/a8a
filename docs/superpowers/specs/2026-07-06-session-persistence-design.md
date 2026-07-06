# 세션 상태 유지 (Session Persistence) 설계

- 작성일: 2026-07-06
- 상태: 승인됨 → 구현 완료 → 리뷰/릴리즈 진행

## 문제

앱을 종료하면 마지막 워크플로우 실행 결과(로그·노드 출력·상태)와 화면 위치가 모두
사라진다. 사용자는 재실행 후 값을 다시 조회하거나 API를 다시 호출해야 한다.

원인: 실행 결과와 내비게이션 상태가 전부 `App.tsx`의 React `useState`(메모리)에만
존재한다. 워크스페이스/프로젝트/노드/엣지는 SQLite에 저장돼 유지되지만, **실행 시점의
결과는 영속화되지 않는다.**

## 목표

앱을 닫았다 켜도 **마지막 세션의 실행 결과 + 화면 위치를 조용히 그대로 복원**한다.
'이전 세션' 배지 없이 자연스럽게 이어서 보여준다(사용자 결정).

## 저장 대상

한 개의 스냅샷 객체(`SessionSnapshot`)로 묶는다.

- **nav**: `activeWsId`, `activeProjectId`, `activeView`, `logState`
- **run** (열린 프로젝트의 이번 실행 상태 — 프로젝트 전환 시 초기화되는 값): `execLogs`,
  `nodeStatuses`, `activeBranchRoutes`, `endNodeDisplayValues`, `startRepeatRowStates`,
  `lastStartNodeLoopProgress`, `activeLogNodeId`
- **nodes** (nodeId 키 — 프로젝트 전환에도 유지): `runInputs`, `runOutputs`, `scriptLogs`

**제외**: `canvasExecution`(라이브 실행 컨트롤러), 모달/드롭다운/confirm 등 휘발성 UI.
테마·사이드바 폭·언어는 기존 localStorage 유지 로직을 그대로 둔다.

## 저장 위치 / 메커니즘

`windowState.ts`와 동일한 패턴. 저장 데이터(API 응답)가 커질 수 있어 localStorage(5MB
한계)가 아닌 파일을 사용한다.

- `src/main/sessionState.ts`(신규): `userData/session-state.json` 읽기/쓰기,
  IPC `session:get` / `session:save` 등록. 실패는 비치명적(try/catch).
- `src/preload/index.ts`: `window.api.session.{ get, save }`.
- `src/renderer/src/globals.d.ts`: 타입 선언.
- `src/renderer/src/App.tsx`:
  - **저장**: 대상 슬라이스 감시 → 400ms 디바운스 → `session.save(snapshot)` push.
    복원 완료(`sessionReadyRef`) 전에는 저장하지 않아 빈 상태가 파일을 덮어쓰지 않는다.
  - **복원**: 마운트 시 `session.get()`. 저장된 프로젝트가 아직 존재하면 그 프로젝트/뷰로
    복원, 없으면 기본값(`all[0]`) 폴백.
  - **종료 직전**: `beforeunload` best-effort flush.

## 핵심 제약과 해법

`App.tsx`의 **프로젝트 전환 효과**(`activeProject?.id` 의존)는 프로젝트가 바뀔 때
run 계열 상태를 전부 초기화한다. 복원 시 `activeProjectId`를 세팅하면 이 효과가 방금
복원한 값을 지워버린다.

→ `sessionRestoringRef` 플래그를 init()에서 켜고, 프로젝트 전환 효과가 이 플래그가 켜진
경우 **초기화를 딱 1회 건너뛰게** 한다(그 후 플래그를 끔). 이후 정상적인 프로젝트 전환은
평소대로 초기화된다.

## 엣지 케이스

- 복원↔저장 레이스: `sessionReadyRef`/`loading` 가드로 초기 빈 상태 저장 방지.
- 삭제된 프로젝트: 저장된 `activeProjectId`가 없으면 기본값 폴백. 죽은 nodeId 키는 무해.
- '진행 중(running)' 상태: `normalizeRestoredRun`이 로드 시 running 배지/로그를 제거
  (멈춘 실행이 도는 것처럼 보이지 않게).
- 파일 손상/쓰기 실패: try/catch → 저장 없음으로 취급.
- 종료 직전 ~400ms 변경 유실 가능(ponytail 상한): 실사용(결과 확인 후 종료)에선 이미 flush됨.

## 검증

- `npm run build` 통과, `tsc --noEmit`(web/node) 에러 0.
- `normalizeRestoredRun` assert 셀프체크 통과.
- Agent Team 리뷰(정확성/React 생명주기 · 보안 · 적대적 엣지케이스).
- 권장: 사용자 수동 e2e(실행 → 종료 → 재실행 시 결과·화면 복원 확인).
