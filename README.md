# a8a

a8a는 API 호출 흐름을 캔버스에서 시각적으로 만들고 실행하는 Electron 기반 워크플로우 자동화 도구입니다.

워크스페이스, 환경, 프로젝트를 관리하고 Data, Select, API, Branch, End 노드를 연결해 API 처리 파이프라인을 구성할 수 있습니다. 실행 결과는 노드별 INPUT/OUTPUT과 로그로 확인하고, End 노드에서 HTML 또는 Markdown 리포트로 저장할 수 있습니다.

## 다운로드와 설치

최신 설치 파일은 GitHub Releases에서 받을 수 있습니다.

- 다운로드 페이지: https://github.com/hanbroz/a8a/releases/latest
- Windows 설치 파일: `a8a-Setup-yyyy.MM.dd.HH.mm.exe`
- Windows 포터블 파일: `a8a-Portable-yyyy.MM.dd.HH.mm.exe`
- 버전 형식: `yyyy.MM.dd.HH.mm`

### Windows에서 설치하기

1. 다운로드 페이지를 엽니다.
2. `Assets` 영역에서 `a8a-Setup-yyyy.MM.dd.HH.mm.exe` 파일을 다운로드합니다.
3. 다운로드한 설치 파일을 실행합니다.
4. 설치 위치를 선택하고 설치를 완료합니다.
5. 바탕화면 또는 시작 메뉴의 `a8a` 바로가기로 실행합니다.

Windows에서 "알 수 없는 게시자" 또는 SmartScreen 경고가 보일 수 있습니다. 현재 배포 파일은 코드 서명 인증서가 적용되지 않았을 수 있으므로, 조직 내부에서 받은 파일인지 확인한 뒤 실행합니다.

설치 없이 실행해야 하는 경우에는 `a8a-Portable-yyyy.MM.dd.HH.mm.exe` 파일을 다운로드해 실행합니다. 포터블 파일은 파일 하나만 전달해도 실행할 수 있지만, 조직 내 표준 배포와 자동 업데이트 적용은 설치 파일 사용을 권장합니다.

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
- 같은 워크스페이스 안에서 프로젝트 순서 드래그 변경
- 프로젝트 생성 시 Start/End 노드 자동 생성
- Data, Select, API, Branch, End 노드 기반 워크플로우 구성
- 캔버스에서 여러 모듈 선택, 이동, 복사, 붙여넣기
- 연결선 실행 순서에 따른 API 목록 확인
- API 노드의 Pre Request, Post Response 스크립트 실행
- Post Response에서 다음 OUTPUT 재구성
- Branch 노드의 TRUE/FALSE 경로 분기
- 환경 변수 치환과 실행 중 `setEnv()` 반영
- START 노드부터 연결된 경로를 따라 순차 실행
- 노드별 INPUT, OUTPUT, 실행 로그 확인
- End 노드에서 HTML 또는 Markdown 리포트 저장
- GitHub Release 기반 업데이트 확인과 다운로드

## 프로그램 사용법

### 1. 작업 공간 만들기

1. 앱을 실행합니다.
2. 왼쪽 사이드바에서 워크스페이스를 생성합니다.
3. 워크스페이스 안에 프로젝트를 생성합니다.
4. 프로젝트 이름을 클릭하면 해당 프로젝트의 캔버스가 열립니다.
5. 같은 워크스페이스 안의 프로젝트는 드래그해서 순서를 바꿀 수 있습니다.

워크스페이스는 업무 범위, 고객사, 테스트 목적처럼 서로 분리해야 하는 단위로 사용합니다. 프로젝트는 한 개의 API 흐름 또는 하나의 테스트 시나리오로 구성하는 것을 권장합니다.

### 2. 환경 변수 설정하기

워크스페이스의 환경을 열어 API URL, 인증 토큰, 공통 요청 값 등을 등록합니다.

예시:

```text
baseUrl = https://api.example.com
token = ey...
officeId = ICN
```

API 설정에서는 `{{baseUrl}}/booking/search`처럼 환경 변수를 사용할 수 있습니다. 환경 변수 이름은 대소문자를 구분하므로 프로젝트 안에서 일관된 이름을 사용합니다.

프로젝트의 환경 변수를 클릭하는 것은 환경 설정을 보기 위한 동작입니다. 캔버스의 선택 상태나 실행 환경이 임의로 변경되지 않습니다.

### 3. 캔버스에 모듈 배치하기

공통 모듈 영역에는 `DATA`, `SELECT`, `API`, `BRANCH` 타입이 있습니다. 이 항목을 캔버스로 드래그하면 새 모듈이 생성됩니다.

캔버스에 배치된 모듈은 모두 독립적인 모듈입니다. 같은 타입에서 만들었거나 복사한 모듈이라도 각 모듈의 설정, INPUT, OUTPUT, 실행 로그는 서로 분리됩니다.

기본 구성 순서는 다음과 같습니다.

```text
Start -> Data 또는 API -> Select 또는 Branch -> API -> End
```

모듈의 포트를 드래그해 연결선을 만들고, `Start`에서 출발해 `End`까지 이어지도록 구성합니다. 실행은 `Start`에서 도달 가능한 연결 경로만 대상으로 합니다.

### 4. 모듈별 사용법

#### DATA

직접 JSON을 입력하거나 Excel/CSV 데이터를 불러와 OUTPUT을 만드는 모듈입니다. 다음 모듈은 DATA의 OUTPUT을 INPUT으로 받습니다.

사용 예:

- 테스트용 요청 데이터 준비
- Excel의 여러 행을 API 반복 호출 데이터로 사용
- 고정 JSON 값을 다음 API에 전달

#### SELECT

이전 모듈의 OUTPUT 중 필요한 행이나 JSON 경로만 선택합니다.

사용 예:

- API 응답 배열에서 특정 행만 선택
- JSON 객체 중 필요한 필드만 추출
- 사용자가 실행 중 팝업에서 값을 선택하도록 구성

`묻지 않고 선택` 옵션을 사용하면 저장된 선택 기준으로 자동 선택합니다.

#### API

HTTP API를 호출하는 모듈입니다. URL, Method, Header, Query Parameter, Body, 인증, Pre Request, Post Response를 설정할 수 있습니다.

API URL은 보통 환경 변수로 시작합니다.

```text
{{baseUrl}}/v1/bookings
```

캔버스의 API 카드와 API 목록에서는 URL이 환경 변수로 시작하는 경우 환경 변수 부분을 생략해서 endpoint를 쉽게 볼 수 있습니다.

#### BRANCH

TRUE/FALSE를 판단해 실행 경로를 나누는 모듈입니다.

BRANCH는 데이터를 새로 만들지 않습니다. 조건 판단만 수행하고, 다음 모듈에는 이전 모듈에서 받은 OUTPUT DATA를 그대로 전달합니다.

사용 예:

- 응답 값이 있으면 TRUE 경로, 없으면 FALSE 경로
- 금액이 특정 값보다 크면 별도 API 호출
- 실행 중 사용자가 TRUE/FALSE를 직접 선택

#### END

워크플로우 종료 모듈입니다. 선택한 모듈의 실행 결과를 HTML 또는 Markdown 리포트로 저장할 수 있습니다.

API 실행 중 환경 변수에 `PNR`, `recordLocator`, `record_locator` 값이 저장되면 End 모듈 내부에 PNR이 표시되고 복사할 수 있습니다. 이름 비교는 대소문자를 구분하지 않습니다.

### 5. API 목록으로 실행 흐름 확인하기

캔버스 플로팅 메뉴의 `API 목록` 버튼을 누르면 연결선 기준 실행 순서에 따라 API 목록이 펼쳐집니다.

목록에는 다음 정보가 표 형태로 표시됩니다.

```text
# | 모듈 | Method | URL
```

URL은 줄이지 않고 전체를 표시합니다. API 목록 행을 클릭하면 캔버스의 해당 API 모듈이 선택됩니다. 이 기능은 전체 API 흐름이 올바른 endpoint 순서로 구성되었는지 확인할 때 사용합니다.

### 6. 워크플로우 실행하기

상단의 실행 버튼으로 전체 캔버스를 실행합니다.

실행 규칙은 다음과 같습니다.

- `Start`에서 연결된 모듈만 실행합니다.
- 연결되지 않은 모듈은 실행하지 않습니다.
- 실행 중 오류가 발생하면 즉시 전체 실행을 중단합니다.
- 노드별 INPUT, OUTPUT, 상태, 실행 로그를 확인할 수 있습니다.
- 모듈 설정창의 실행 버튼은 `Start`부터 해당 모듈까지의 경로만 실행해 INPUT/OUTPUT 미리보기를 갱신합니다.

## API 스크립트 사용법

API 모듈에는 `Pre Request`와 `Post Response` 스크립트가 있습니다.

### Pre Request

API 호출 전에 실행됩니다. 요청 템플릿에서 사용할 값을 만들거나 환경 변수를 설정할 때 사용합니다.

사용 가능한 주요 함수:

```javascript
const input = getInput();

setInput("passengerCount", 2);
setEnv("token", "new-token");
console.log(input);
```

`setInput(name, value)`로 설정한 값은 URL, Header, Query, Body 템플릿에서 `[[passengerCount]]`처럼 사용할 수 있습니다.

### Post Response

API 응답을 받은 뒤 실행됩니다. 복잡한 응답을 단순한 OUTPUT으로 바꾸거나, 다음 API에서 사용할 값을 추출할 때 사용합니다.

사용 가능한 주요 함수:

```javascript
const output = getOutput();

setOutput({
  id: output.id,
  name: output.name,
});

setEnv("recordLocator", output.recordLocator);
```

`getOutput()`은 현재 API 응답을 반환합니다. API 응답 결과가 1개이면 단일 객체로, 여러 개이면 배열로 전달됩니다.

`setOutput(value)`는 현재 API 모듈의 최종 OUTPUT 전체를 교체합니다.

```javascript
const output = getOutput();

setOutput({
  from: Object.values(output.results[0].trips[0].journeysAvailableByMarket)[0],
  to: Object.values(output.results[1].trips[0].journeysAvailableByMarket)[0],
});
```

`setOutput(name, value)`는 OUTPUT 객체에 값을 추가합니다. 여러 번 호출하면 하나의 객체로 누적됩니다.

```javascript
const output = getOutput();

setOutput("from", Object.values(output.results[0].trips[0].journeysAvailableByMarket)[0]);
setOutput("to", Object.values(output.results[1].trips[0].journeysAvailableByMarket)[0]);
```

위 스크립트의 최종 OUTPUT은 다음 형태가 됩니다.

```json
{
  "from": [],
  "to": []
}
```

복잡한 OUTPUT을 단계적으로 만들고 싶다면 `Output` 보조 객체를 사용할 수 있습니다.

```javascript
const output = getOutput();
const next = new Output();

next.add("from", Object.values(output.results[0].trips[0].journeysAvailableByMarket)[0]);
next.add("to", Object.values(output.results[1].trips[0].journeysAvailableByMarket)[0]);

setOutput(next);
```

`setOutput(value)`로 만든 OUTPUT은 다음 모듈의 INPUT으로 전달되고, 실행 로그와 리포트에도 해당 OUTPUT으로 표시됩니다.

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
dist/a8a-Portable-yyyy.MM.dd.HH.mm.exe
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
  "dist/a8a-Portable-$version.exe" `
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
