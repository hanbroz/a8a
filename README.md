# a8a

a8a는 API 호출 흐름을 캔버스에서 시각적으로 만들고 실행하는 Electron 기반 워크플로우 자동화 도구입니다.

워크스페이스, 환경, 프로젝트, 모듈을 관리하고 Data, Select, API, End 노드를 연결해 API 처리 파이프라인을 구성할 수 있습니다. 실행 결과는 노드별 입력/출력과 로그로 확인하고, End 노드에서 HTML 또는 Markdown 리포트로 저장할 수 있습니다.

## 다운로드와 설치

최신 설치 파일은 GitHub Releases에서 받을 수 있습니다.

- 다운로드 페이지: https://github.com/hanbroz/a8a/releases/latest
- Windows 설치 파일: `a8a-Setup-yyyy.MM.dd.HH.mm.exe`
- 버전 형식: `yyyy.MM.dd.HH.mm`

### Windows에서 설치하기

1. 다운로드 페이지를 엽니다.
2. `Assets` 영역에서 `a8a-Setup-yyyy.MM.dd.HH.mm.exe` 파일을 다운로드합니다.
3. 다운로드한 설치 파일을 실행합니다.
4. 설치 위치를 선택하고 설치를 완료합니다.
5. 바탕화면 또는 시작 메뉴의 `a8a` 바로가기로 실행합니다.

Windows에서 "알 수 없는 게시자" 또는 SmartScreen 경고가 보일 수 있습니다. 현재 배포 파일은 코드 서명 인증서가 적용되지 않았을 수 있으므로, 조직 내부에서 받은 파일인지 확인한 뒤 실행합니다.

### macOS에서 사용하기

현재 자동 릴리스는 Windows 설치 파일을 기준으로 구성되어 있습니다. macOS용 설치 파일이 Release에 함께 올라온 경우에는 `.dmg` 또는 `.zip` 파일을 다운로드해 실행하면 됩니다.

macOS용 설치 파일이 없다면 개발자 환경에서 다음 방식으로 실행할 수 있습니다.

```bash
npm install
npm run dev
```

macOS 설치 파일을 직접 만들 때는 macOS 환경에서 다음 명령을 사용합니다.

```bash
npm run build:mac
```

일반 사용자에게 macOS 앱을 배포하려면 Apple 코드 서명과 notarization 구성이 추가로 필요합니다.

## 업데이트

a8a는 앱 안에서 현재 버전을 표시하고 GitHub Release의 최신 버전을 확인합니다.

- 화면 왼쪽 상단에 `a8a`, `ver. yyyy.MM.dd.HH.mm` 형식으로 현재 버전이 표시됩니다.
- 앱 시작 후 최신 Release가 현재 버전보다 새 버전이면 업데이트 알림이 표시됩니다.
- 상단의 업데이트 버튼으로 최신 버전을 수동으로 확인할 수 있습니다.
- 업데이트가 있으면 앱에서 새 설치 파일을 다운로드하고 적용할 수 있습니다.

업데이트 비교는 `yyyy.MM.dd.HH.mm` 날짜 버전 기준으로 동작합니다. 예를 들어 현재 버전이 `2026.06.01.10.11`이고 최신 Release가 `2026.06.01.14.30`이면 새 버전으로 판단합니다.

## 주요 기능

- 워크스페이스, 환경, 프로젝트, 모듈 관리
- 프로젝트 생성 시 Start/End 노드 자동 생성
- Data, Select, API, End 노드 기반 워크플로우 구성
- API 노드의 Pre Request, Post Response 스크립트 실행
- 환경 변수 치환과 실행 중 `setEnv()` 반영
- START 노드부터 연결된 경로를 따라 순차 실행
- 노드별 INPUT, OUTPUT, 실행 로그 확인
- End 노드에서 HTML 또는 Markdown 리포트 저장
- GitHub Release 기반 업데이트 확인과 다운로드

## 처음 사용하는 방법

1. 앱을 실행합니다.
2. 왼쪽 사이드바에서 워크스페이스를 만듭니다.
3. 워크스페이스 안에 프로젝트를 만듭니다.
4. 필요한 모듈을 만들거나 공통 모듈을 사용합니다.
5. 캔버스에 모듈을 배치하고 Start 노드부터 End 노드까지 연결합니다.
6. 각 노드의 설정을 입력합니다.
7. 실행 버튼으로 워크플로우를 실행합니다.
8. 실행 결과와 로그를 확인합니다.
9. End 노드에서 리포트를 저장합니다.

## 개발 환경 실행

필요한 도구는 다음과 같습니다.

- Node.js 22 이상
- npm
- Windows 설치 파일 빌드 시 Windows 환경
- macOS 설치 파일 빌드 시 macOS 환경

의존성을 설치합니다.

```bash
npm install
```

개발 서버를 실행합니다.

```bash
npm run dev
```

프로덕션 빌드를 확인합니다.

```bash
npm run build
```

Windows에서는 편의 스크립트도 사용할 수 있습니다.

```bat
dev.bat
run.bat
```

Unix 계열 셸에서는 다음 스크립트를 사용할 수 있습니다.

```bash
./dev.sh
./run.sh
```

## 로컬 설치 파일 빌드

Windows 설치 파일을 만들 때는 다음 명령을 사용합니다.

```powershell
$version = Get-Date -Format 'yyyy.MM.dd.HH.mm'
$env:A8A_UPDATE_GITHUB_REPO = "hanbroz/a8a"
$env:A8A_APP_VERSION = $version

npm run version:stamp -- $version
npm run build:win
```

빌드가 끝나면 `dist/` 폴더에 다음 파일이 생성됩니다.

```text
dist/a8a-Setup-yyyy.MM.dd.HH.mm.exe
dist/a8a-Setup-yyyy.MM.dd.HH.mm.exe.blockmap
```

macOS 설치 파일은 macOS 환경에서 다음 명령으로 만듭니다.

```bash
npm run build:mac
```

Linux 패키지는 Linux 환경에서 다음 명령으로 만듭니다.

```bash
npm run build:linux
```

## 배포 방식

`main` 또는 `master` 브랜치에 push하면 GitHub Actions가 Windows 설치 파일을 만들고 GitHub Release를 생성하도록 구성되어 있습니다.

자동 배포 흐름은 다음과 같습니다.

1. push 시점의 시간을 `yyyy.MM.dd.HH.mm` 형식으로 계산합니다.
2. 앱 내부 표시 버전을 해당 날짜 버전으로 기록합니다.
3. Windows 설치 파일을 빌드합니다.
4. `vyyyy.MM.dd.HH.mm` 태그로 GitHub Release를 생성합니다.
5. 설치 파일과 blockmap 파일을 Release asset으로 업로드합니다.

GitHub Actions가 결제 또는 지출 한도 문제로 시작되지 않으면 Release가 생성되지 않습니다. 이 경우 저장소 소유자는 GitHub의 `Settings > Billing & plans`에서 결제 수단, Actions 예산, spending limit을 확인한 뒤 workflow를 다시 실행해야 합니다.

수동으로 Release를 만들 때는 로컬에서 빌드한 뒤 다음 명령을 사용할 수 있습니다.

```powershell
$version = Get-Date -Format 'yyyy.MM.dd.HH.mm'
$env:A8A_UPDATE_GITHUB_REPO = "hanbroz/a8a"
$env:A8A_APP_VERSION = $version

npm run version:stamp -- $version
npm run build:win

gh release create "v$version" `
  "dist/a8a-Setup-$version.exe" `
  "dist/a8a-Setup-$version.exe.blockmap" `
  --repo hanbroz/a8a `
  --latest `
  --title "$version" `
  --notes "a8a $version"
```

## 프로젝트 구조

```text
src/
  main/                 Electron 메인 프로세스, DB, IPC, 업데이트 처리
  preload/              Renderer에 노출되는 window.api 브리지
  renderer/src/         React UI와 워크플로우 실행 상태
  renderer/src/components/
                          캔버스, 사이드바, 환경 변수 UI
  renderer/src/utils/   템플릿 치환, 스크립트 실행, 리포트 생성
docs/                   아키텍처, 기술부채, 배포 문서
scripts/                버전 스탬프 등 빌드 보조 스크립트
```

## 기술 스택

- Electron
- electron-vite
- React
- TypeScript
- sql.js
- Monaco Editor
- ExcelJS

## 문제 해결

### 다운로드 페이지에 설치 파일이 없습니다

GitHub Actions가 실패했거나 아직 Release가 생성되지 않은 상태일 수 있습니다. 개발자는 Actions 실행 결과와 Billing 설정을 확인한 뒤 다시 배포해야 합니다.

### 앱에서 업데이트를 찾지 못합니다

Release 태그 또는 이름에 `yyyy.MM.dd.HH.mm` 형식의 버전이 포함되어 있어야 합니다. 또한 앱 빌드 시 `A8A_UPDATE_GITHUB_REPO` 값이 `hanbroz/a8a` 형식으로 기록되어야 합니다.

### Windows에서 설치 경고가 표시됩니다

코드 서명 인증서가 없는 설치 파일은 Windows 보안 경고가 표시될 수 있습니다. 파일 출처가 조직 내부 GitHub Release인지 확인한 뒤 실행합니다.
