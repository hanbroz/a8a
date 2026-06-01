# 기술부채

이 문서는 현재 구현에서 남아 있는 위험과 후속 개선 항목을 정리합니다. 코드 검토에서 즉시 수정한 항목은 별도로 표시했습니다.

## 즉시 수정 완료

### DB 파일 저장 원자성

- 대상: `src/main/db.ts`
- 조치: DB 파일을 직접 덮어쓰지 않고 `a8a.db.tmp`에 쓴 뒤 rename합니다.

### 워크스페이스 삭제 시 고아 데이터 정리

- 대상: `src/main/db.ts`
- 조치: 워크스페이스 삭제 시 환경 변수, 환경, 프로젝트, 노드, 엣지, 워크스페이스 전용 모듈을 트랜잭션 안에서 정리합니다.

### 모듈 삭제 시 연결선 정리

- 대상: `src/main/db.ts`
- 조치: 모듈을 참조하는 노드 삭제 전에 해당 노드와 연결된 엣지를 먼저 삭제합니다.

### 모듈 배치와 엣지 생성 검증

- 대상: `src/main/db.ts`, `src/renderer/src/App.tsx`
- 조치: 모듈은 공통 모듈이거나 같은 워크스페이스 소속이어야 프로젝트에 배치할 수 있습니다. 엣지는 같은 프로젝트의 노드끼리만 만들 수 있고, 중복 입력, 순환 연결, 자기 연결, Start 입력, End 출력은 차단합니다.

### Preload fallback 제거

- 대상: `src/preload/index.ts`
- 조치: `contextIsolation`이 꺼진 상태에서 `window.api`를 직접 붙이는 fallback을 제거했습니다.

### 실행 환경 기준 수정

- 대상: `src/renderer/src/App.tsx`
- 조치: API 실행, 미리보기, 리포트 생성은 사이드바 선택 워크스페이스가 아니라 현재 열린 프로젝트의 워크스페이스/환경을 기준으로 합니다.

### 타입 검증 보강

- 대상: `src/renderer/src/globals.d.ts`, `src/types/ambient.d.ts`, `tsconfig.*.json`
- 조치: 전역 타입, CSS/worker/sql.js 선언을 보강해 `npx tsc -b --noEmit` 검증이 통과하도록 했습니다.

## 높음

### IPC 입력 검증 스키마 부재

- 대상: `src/main/ipc.ts`
- 위험: Renderer에서 들어오는 문자열, ID, 설정 JSON이 구조 검증 없이 DB 함수로 전달됩니다.
- 권장 조치: `zod` 같은 스키마 검증을 IPC 경계에 추가합니다. 특히 `env:upsert`, `mod:create`, `node:create`, `edge:create`, `file:write` 입력을 검증해야 합니다.

### DB 스키마 수준 외래 키와 UNIQUE 제약 부재

- 대상: `src/main/db.ts`
- 위험: 코드 레벨 삭제/검증은 보강했지만, 기존 DB 호환성 때문에 스키마 수준 `FOREIGN KEY`, `UNIQUE` 제약은 아직 없습니다.
- 권장 조치: 마이그레이션 버전 테이블을 추가한 뒤 안전하게 `ON DELETE CASCADE`, `UNIQUE(project_id, source_node_id, target_node_id)` 등을 적용합니다.

### 사용자 스크립트 격리 부재

- 대상: `src/renderer/src/utils/scriptRuntime.ts`
- 위험: Pre Request, Post Response 스크립트는 `AsyncFunction`으로 실행됩니다. 현재는 사용자를 신뢰하는 로컬 앱 모델입니다.
- 권장 조치: Worker 또는 별도 제한 런타임으로 격리하고, 사용할 수 있는 API를 명시적으로 제한합니다.

## 중간

### End 리포트 실패 표시 개선

- 대상: `src/renderer/src/App.tsx`
- 현재 조치: 파일 저장 실패 시 End 노드를 error 상태로 표시합니다.
- 남은 작업: End 노드 자체도 실행 로그에 별도 항목으로 남기고, 실패 원인을 UI에서 바로 확인할 수 있게 합니다.

### API 실패 후 실행 정책

- 대상: `src/renderer/src/App.tsx`
- 현재 조치: API 실패 시 이후 업무 노드는 중단하고 End 노드로 이동해 실패 리포트를 생성할 수 있게 했습니다.
- 남은 작업: “실패 시 즉시 중단”, “실패 후 다음 브랜치 계속”, “항상 End 실행” 같은 실행 정책을 프로젝트 또는 Start 노드 설정으로 분리할지 결정해야 합니다.

### 문서와 계획서 상태 관리

- 대상: `docs/*.html`
- 위험: `script-feature-plan.html`, `end-node-report-plan.html`은 구현 전 계획서 성격이 강해 실제 구현 완료 상태와 섞여 보입니다.
- 권장 조치: 완료된 계획서는 `docs/archive/`로 옮기거나, 각 문서 상단에 완료/보류/변경 사항을 명시합니다.

### 개발 스크립트의 프로세스 종료 범위

- 대상: `dev.bat`, `run.bat`, `dev.sh`, `run.sh`
- 위험: 현재 스크립트 일부는 다른 Electron 또는 electron-vite 프로세스까지 종료할 수 있습니다.
- 권장 조치: 프로젝트별 PID 파일 기반 종료로 좁힙니다.

## 낮음

### React 19 JSX 반환 타입 정리

- 대상: 여러 `*.tsx`
- 현황: `JSX.Element` 호환 선언을 추가해 타입 검사는 통과합니다.
- 권장 조치: 새 코드에서는 명시 반환 타입을 생략하거나 `React.ReactElement`/`React.ReactNode`로 점진 변경합니다.

### 패키징 설정 상세화

- 대상: `package.json`
- 현재 조치: `electron-builder`의 `appId`, `productName`, `files`, `directories.output` 기본 설정을 추가했습니다.
- 남은 작업: 아이콘, 코드 서명, 플랫폼별 artifact 이름, extraResources 정책을 배포 시점에 추가합니다.
