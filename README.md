# a8a

[한국어](README.md) | [English](README.en.md)

a8a는 API 호출 흐름을 캔버스에서 시각적으로 만들고 실행하는 Electron 기반 워크플로우 자동화 도구입니다.

워크스페이스, 환경, 프로젝트를 관리하고 Data, Select, API, Branch, End 노드를 연결해 API 처리 파이프라인을 구성할 수 있습니다. 실행 결과는 노드별 INPUT/OUTPUT과 로그로 확인하고, End 노드에서 HTML 또는 Markdown 리포트로 저장할 수 있습니다.

## 다운로드와 설치

최신 설치 파일은 GitHub Releases에서 받을 수 있습니다.

- 다운로드 페이지: https://github.com/hanbroz/a8a/releases/latest
- Windows 설치 파일: `a8a-Setup-yyyy.MM.dd.HH.mm.exe`
- Windows 포터블 파일: `a8a-Portable-yyyy.MM.dd.HH.mm.exe`
- macOS Apple Silicon 설치 파일: `a8a-Mac-arm64-yyyy.MM.dd.HH.mm.dmg`
- macOS Intel 설치 파일: `a8a-Mac-x64-yyyy.MM.dd.HH.mm.dmg`
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

macOS에서는 사용하는 Mac의 CPU에 맞는 `.dmg` 파일을 다운로드합니다.

- Apple Silicon Mac: `a8a-Mac-arm64-yyyy.MM.dd.HH.mm.dmg`
- Intel Mac: `a8a-Mac-x64-yyyy.MM.dd.HH.mm.dmg`

다운로드한 `.dmg` 파일을 열고 `a8a` 앱을 `Applications` 폴더로 드래그해 설치합니다. `.zip` 파일이 함께 제공되는 경우에는 압축을 풀어 나온 `a8a.app`을 `Applications` 폴더로 옮겨도 됩니다.

현재 macOS 배포 파일은 Apple 코드 서명과 notarization이 적용되지 않을 수 있습니다. macOS에서 "확인되지 않은 개발자" 경고가 표시되면 Finder에서 앱을 오른쪽 클릭한 뒤 `열기`를 선택하고, 다시 표시되는 확인 창에서 `열기`를 선택합니다. 조직 내부에서 받은 파일인지 반드시 확인한 뒤 실행합니다.

macOS용 설치 파일이 없다면 개발자 환경에서 다음 방식으로 실행할 수 있습니다.

```bash
npm install
npm run dev
```

macOS 설치 파일을 직접 만들 때는 macOS 환경에서 다음 명령을 사용합니다.

```bash
npm run build:mac
```

일반 사용자에게 경고 없이 macOS 앱을 배포하려면 Apple Developer 계정의 코드 서명 인증서와 notarization 구성이 추가로 필요합니다.

## 업데이트

a8a는 앱 안에서 현재 버전을 표시하고 GitHub Release의 최신 버전을 확인합니다.

- 화면 왼쪽 상단에 `a8a`, `ver. yyyy.MM.dd.HH.mm` 형식으로 현재 버전이 표시됩니다.
- 앱 시작 후 최신 Release가 현재 버전보다 새 버전이면 업데이트 알림이 표시됩니다.
- 상단의 업데이트 버튼으로 최신 버전을 수동으로 확인할 수 있습니다.
- 업데이트가 있으면 앱에서 새 설치 파일을 다운로드하고 적용할 수 있습니다.

업데이트 비교는 `yyyy.MM.dd.HH.mm` 날짜 버전 기준으로 동작합니다. 예를 들어 현재 버전이 `2026.06.01.10.11`이고 최신 Release가 `2026.06.01.14.30`이면 새 버전으로 판단합니다.

앱 내부 업데이트는 설치 파일을 다운로드한 뒤 Release에 함께 올라간 `.sha256` 파일과 실제 파일의 SHA-256 값을 비교합니다. 체크섬이 없거나 값이 다르면 설치 파일을 실행하지 않습니다.

Windows에서는 업데이트 적용 시 다운로드한 설치 파일을 실행하고 앱을 종료합니다. macOS에서는 현재 Mac의 CPU에 맞는 `.dmg` 또는 `.zip` 파일을 다운로드한 뒤 Finder로 열어 줍니다. macOS 사용자는 열린 설치 파일에서 새 `a8a.app`을 `Applications` 폴더로 교체합니다.

Windows 설치형 파일을 실행하면 설치 과정에서 이번 버전의 주요 업데이트 안내가 표시됩니다. 포터블 파일은 설치 과정이 없으므로 업데이트 안내 화면이 표시되지 않습니다.

`package.json`의 npm 패키지 버전은 프로젝트 메타데이터로 유지하고, 사용자에게 보이는 앱 버전과 Release 파일명은 `src/main/appVersion.ts`에 기록되는 날짜 버전을 사용합니다.

## 주요 기능

- 워크스페이스, 환경, 프로젝트, 모듈 관리
- 같은 워크스페이스 안에서 프로젝트 순서 드래그 변경
- 기존 프로젝트의 캔버스와 연결선을 새 프로젝트로 복제
- 프로젝트 생성 시 Start/End 노드 자동 생성
- Data, Select, API, Branch, End 노드 기반 워크플로우 구성
- 캔버스에서 여러 모듈 선택, 이동, 복사, 붙여넣기, 삭제, Undo/Redo
- 연결선 실행 순서에 따른 API 목록 확인
- Start 노드의 반복 횟수 또는 데이터 파일 기반 반복 실행
- API 노드의 Pre Request, Post Response 스크립트 실행
- Post Response에서 다음 OUTPUT 재구성
- Branch 노드의 TRUE/FALSE 경로 분기
- 환경 변수 치환과 실행 중 `setEnv()` 반영
- 반복 데이터의 `<<no>>`, `<<컬럼명>>` 템플릿 참조
- START 노드부터 연결된 경로를 따라 순차 실행
- 노드별 INPUT, OUTPUT, 실행 로그 확인
- End 노드에서 HTML 또는 Markdown 리포트 저장
- End 노드 내부에 선택한 환경 변수 값 표시와 복사
- 워크스페이스와 프로젝트 단위 내보내기/가져오기
- 운영환경 언어 기준 한국어/영어 자동 선택과 수동 언어 설정
- 선택한 라이트/다크 테마 기억
- GitHub Release 기반 업데이트 확인과 다운로드

## 프로그램 사용법

### 1. 작업 공간 만들기

1. 앱을 실행합니다.
2. 왼쪽 사이드바에서 워크스페이스를 생성합니다.
3. 워크스페이스 안에 프로젝트를 생성합니다.
4. 프로젝트 이름을 클릭하면 해당 프로젝트의 캔버스가 열립니다.
5. 프로젝트 행의 복제 아이콘을 누르고 새 프로젝트 이름을 입력하면 원본 프로젝트 바로 아래에 복제본이 생성됩니다.
6. 같은 워크스페이스 안의 프로젝트는 드래그해서 순서를 바꿀 수 있습니다.

워크스페이스는 업무 범위, 고객사, 테스트 목적처럼 서로 분리해야 하는 단위로 사용합니다. 프로젝트는 한 개의 API 흐름 또는 하나의 테스트 시나리오로 구성하는 것을 권장합니다.

왼쪽 사이드바를 접으면 프로젝트 이름에서 숫자 접두어와 구분자를 제외한 1~3글자 배지가 표시됩니다. 예를 들어 `010_여정생성`은 `여정`처럼 표시되어 접힌 상태에서도 프로젝트를 구분할 수 있습니다. 마우스를 올리면 전체 워크스페이스와 프로젝트 이름을 툴팁으로 확인할 수 있습니다.

### 2. 내보내기와 가져오기

상단의 `가져오기/내보내기` 메뉴는 Postman의 Export/Import와 같은 용도로 사용합니다. 일반 저장 버튼이 아니라 다른 개발자에게 워크스페이스나 프로젝트 데이터를 전달하기 위한 기능입니다.

- `현재 워크스페이스 내보내기`: 현재 열린 프로젝트가 속한 워크스페이스의 환경, 프로젝트, 캔버스, 연결선, 참조 중인 공용 DATA를 `.json` 파일로 저장합니다.
- `현재 프로젝트 내보내기`: 현재 프로젝트의 캔버스, 연결선, 참조 중인 공용 DATA를 `.json` 파일로 저장합니다.
- `워크스페이스 가져오기`: 내보낸 워크스페이스 파일을 새 워크스페이스로 추가합니다.
- `프로젝트 가져오기`: 내보낸 프로젝트 파일을 현재 워크스페이스 아래 새 프로젝트로 추가합니다.

가져오기는 기존 데이터와 충돌하지 않도록 새 ID를 만들어 복사합니다. 같은 이름이 이미 있으면 이름 뒤에 `(가져오기)`가 붙습니다.

가져오기 파일은 `a8a.export` v1 형식이어야 하며, 프로젝트의 노드 ID, 타입, 좌표, 크기, 연결선 endpoint가 모두 올바르게 포함되어 있어야 합니다. 손상된 파일이나 연결선이 깨진 파일은 일부만 가져오지 않고 오류를 표시한 뒤 가져오기를 중단합니다.

상단의 라이트/다크 테마 버튼으로 선택한 테마는 앱을 종료해도 기억됩니다.

### 3. 언어 설정하기

왼쪽 사이드바 하단의 `설정` 메뉴를 클릭하면 앱 설정 화면이 열립니다.

언어 설정은 다음 세 가지 중 하나를 선택할 수 있습니다.

- `시스템 기본값`: 운영환경 언어가 한국어이면 한국어 UI를 사용하고, 그 외 언어 환경에서는 영어 UI를 사용합니다.
- `한국어`: 운영환경과 관계없이 한국어 UI를 사용합니다.
- `English`: 운영환경과 관계없이 영어 UI를 사용합니다.

언어 변경은 즉시 적용되며 앱을 종료한 뒤 다시 실행해도 선택한 값이 유지됩니다. 처음 실행하거나 언어 설정을 바꾸지 않은 상태에서는 `시스템 기본값`이 적용됩니다.

다국어 전환은 앱 셸, 사이드바, 설정 화면, 상단 메뉴, 업데이트 안내, 가져오기/내보내기 다이얼로그, 실행 로그, 워크스페이스/프로젝트/환경 관리 모달, 캔버스 플로팅 메뉴, 주요 삭제 확인창, START/DATA/SELECT/API/BRANCH/END 모듈 설정 화면, 스크립트 실행 오류, 반복 데이터 첨부 오류, HTML/Markdown 리포트 문구에 적용됩니다.

### 4. 환경 변수 설정하기

워크스페이스의 환경을 열어 API URL, 인증 토큰, 공통 요청 값 등을 등록합니다.

예시:

```text
baseUrl = https://api.example.com
token = ey...
officeId = ICN
```

API 설정에서는 `{{baseUrl}}/booking/search`처럼 환경 변수를 사용할 수 있습니다. 환경 변수 이름은 대소문자를 구분하므로 프로젝트 안에서 일관된 이름을 사용합니다.

프로젝트의 환경 변수를 클릭하는 것은 환경 설정을 보기 위한 동작입니다. 캔버스의 선택 상태나 실행 환경이 임의로 변경되지 않습니다.

### 5. 캔버스에 모듈 배치하기

모듈 영역에는 `DATA`, `SELECT`, `API`, `BRANCH` 타입이 있습니다. 이 항목을 캔버스로 드래그하면 새 모듈이 생성됩니다.

캔버스에 배치된 모듈은 모두 독립적인 모듈입니다. 같은 타입에서 만들었거나 복사한 모듈이라도 각 모듈의 설정, INPUT, OUTPUT, 실행 로그는 서로 분리됩니다.

모듈을 복사해 붙여넣으면 복사한 모듈 그룹의 상대 위치는 유지하고, 새 모듈 그룹은 현재 보고 있는 캔버스 화면의 중앙에 배치됩니다. 복사한 모듈끼리 내부에서 참조하던 INPUT 경로는 새로 생성된 모듈 ID 기준으로 자동 치환되어 원본 모듈의 실행 값과 섞이지 않습니다.

캔버스에서 드래그로 여러 모듈을 선택한 뒤 `Delete` 키를 누르면 삭제 확인창이 표시됩니다. `삭제`를 누르면 선택한 일반 모듈과 해당 연결선만 삭제되며, `Start`와 `End` 모듈은 삭제 대상에서 제외됩니다.

캔버스 플로팅 메뉴의 되돌리기/다시 실행 버튼으로 모듈 추가, 삭제, 위치 변경, 크기 변경, 설정 저장, 붙여넣기, 연결선 변경을 되돌리거나 다시 적용할 수 있습니다. 단축키는 `Ctrl+Z`가 되돌리기, `Ctrl+Y` 또는 `Ctrl+Shift+Z`가 다시 실행입니다. 히스토리는 프로젝트 캔버스별로 분리되며 최대 10단계까지만 기억합니다.

캔버스의 위치와 확대 배율은 프로젝트별로 따로 저장됩니다. A 프로젝트에서 이동하거나 확대해도 B 프로젝트의 캔버스 위치와 배율에는 영향을 주지 않으며, 다시 A 프로젝트를 열면 A 프로젝트의 마지막 캔버스 상태가 복원됩니다.

기본 구성 순서는 다음과 같습니다.

```text
Start -> Data 또는 API -> Select 또는 Branch -> API -> End
```

모듈의 포트를 드래그해 연결선을 만들고, `Start`에서 출발해 `End`까지 이어지도록 구성합니다. 실행은 `Start`에서 도달 가능한 연결 경로만 대상으로 합니다.

### 6. 모듈별 사용법

#### START

워크플로우 시작 모듈입니다. 수동 실행, 스케줄 실행, 반복 실행을 설정할 수 있습니다.

반복 실행을 켜면 다음 두 가지 방식 중 하나를 선택합니다.

- `반복 횟수`: 입력한 숫자만큼 `Start`부터 실행 가능한 흐름을 반복합니다.
- `데이터`: `.xlsx`, `.csv`, `.json` 파일을 첨부하고 데이터 행 수만큼 반복합니다.

데이터 파일은 테이블 형태여야 합니다. Excel과 CSV는 첫 행을 헤더로 사용하고, JSON은 객체 배열이어야 합니다.

```json
[
  { "origin": "ICN", "destination": "NRT" },
  { "origin": "NRT", "destination": "ICN" }
]
```

데이터를 첨부하면 START 설정 화면에서 파일명, 데이터 수량, 미리보기 테이블을 확인할 수 있습니다. 데이터 목록은 스크롤할 수 있고, 전체 화면으로 열어 확인하거나 컬럼명과 값으로 검색할 수 있습니다.

문제가 있는 파일을 첨부했거나 다른 데이터로 바꿔야 한다면 다시 첨부합니다. 다시 첨부하면 기존 데이터와 행별 성공/실패 상태가 리셋되고 새 데이터가 반영됩니다.

반복 데이터에는 `no` 가상 컬럼이 자동으로 추가됩니다. 첫 번째 행은 `1`, 두 번째 행은 `2`처럼 순서가 부여됩니다. 첨부 데이터에 `no` 컬럼이 있더라도 앱이 만든 가상 `no` 값이 우선합니다.

반복 실행 중 모든 모듈에서는 현재 행의 값을 다음 형식으로 참조할 수 있습니다.

```text
<<no>>
<<origin>>
<<destination>>
```

예를 들어 API URL, Header, Query, Body, SELECT/API 스크립트, BRANCH 조건에서 현재 반복 행의 값을 사용할 수 있습니다.

반복 실행이 진행 중이면 캔버스의 START 모듈에 `1/10`처럼 현재 회차와 전체 회차가 표시됩니다. 이 표시는 지금 몇 번째 반복을 실행 중인지 확인할 때 사용합니다. 반복 실행이 끝나도 마지막 실행 카운트는 다음 실행 전까지 START 모듈에 유지됩니다.

START 설정의 데이터 목록에는 각 행의 실행 상태가 함께 표시됩니다.

- `대기`: 아직 실행하지 않은 행입니다.
- `실행중`: 현재 실행 중인 행입니다.
- `성공`: 해당 행이 End까지 정상 완료된 상태입니다.
- `실패`: 해당 행의 실행 중 오류가 발생한 상태입니다.

반복 실행 옵션의 `실패하면 중지`를 체크하면 한 행에서 오류가 발생하는 즉시 전체 반복 실행을 중단합니다. 체크를 해제하면 오류가 난 행은 `실패`로 표시하고 남은 모듈 실행을 건너뛴 뒤 다음 행으로 계속 진행합니다.

반복 실행이 끝난 뒤 실패한 행이 있으면 START 설정 화면에서 `실패 Export` 버튼으로 실패 행만 Excel 파일로 저장할 수 있습니다. 저장된 `.xlsx` 파일에는 원본 데이터 컬럼과 함께 `실패상태`, `실패모듈`, `실패사유` 컬럼이 추가됩니다. 이 파일을 수정해 다시 첨부하면 실패한 건만 재실행하는 용도로 사용할 수 있습니다.

반복 실행 중 End 모듈에서 리포트 생성이 켜져 있으면 각 반복 행마다 리포트 파일이 생성됩니다. 반복 리포트 파일명은 기존 `{ENV} {WS} {PROJECT} {TS}` 형식 끝에 ` - <<no>>` 값이 추가됩니다. 반복 실행 중에는 파일 생성 완료 팝업을 반복해서 표시하지 않습니다.

#### DATA

직접 JSON을 입력하거나 Excel/CSV 데이터를 불러와 OUTPUT을 만드는 모듈입니다. 다음 모듈은 DATA의 OUTPUT을 INPUT으로 받습니다.

DATA 모듈은 기본적으로 캔버스에 배치된 노드마다 독립적으로 동작합니다. 여러 프로젝트에서 같은 고객정보, 기준정보, 코드 목록처럼 동일한 DATA를 함께 사용해야 한다면 DATA 설정 화면에서 `공용 DATA로 공유`를 체크하고 저장합니다.

공용 DATA로 저장한 모듈은 왼쪽 `모듈` 영역의 `DATA` 아래에 항목으로 표시됩니다. 이 항목을 다른 프로젝트 캔버스로 드래그하면 새 DATA 노드가 생성되지만, 실제 OUTPUT 데이터는 공용 DATA 원본을 참조합니다. 따라서 공용 DATA를 사용하는 어느 노드에서든 데이터를 수정하고 저장하면 같은 공용 DATA를 참조하는 모든 프로젝트의 DATA 노드가 같은 데이터를 사용합니다.

공용 DATA가 필요 없어지면 DATA 설정 화면에서 `공용 DATA로 공유` 체크를 해제하고 저장합니다. 이 경우 해당 캔버스의 DATA 노드만 현재 데이터를 복사해 독립 DATA로 분리되고, 기존 공용 DATA 원본은 유지됩니다.

사용 예:

- 테스트용 요청 데이터 준비
- Excel의 여러 행을 API 반복 호출 데이터로 사용
- 고정 JSON 값을 다음 API에 전달

#### SELECT

이전 모듈의 OUTPUT 중 필요한 행이나 JSON 경로만 선택합니다.

SELECT INPUT은 세 가지 방식으로 확인할 수 있습니다.

- 기본 보기 탭은 `TREE`입니다.
- `JSON`: 원본 JSON을 그대로 확인하고 편집합니다.
- `TREE`: JSON 구조를 트리로 펼쳐 필요한 경로를 선택합니다.
- `표`: 객체 배열 입력을 테이블로 표시하고 필요한 행을 선택합니다.

사용 예:

- API 응답 배열에서 특정 행만 선택
- JSON 객체 중 필요한 필드만 추출
- 사용자가 실행 중 팝업에서 값을 선택하도록 구성

`묻지 않고 선택` 옵션을 사용하면 저장된 선택 기준으로 자동 선택합니다.

JSON 선택 창은 전체화면으로 확대할 수 있으며, 같은 SELECT 모듈을 다시 열면 이전 선택 값과 JSON 트리 펼침/접힘 상태를 유지합니다. 복잡한 JSON을 반복 테스트할 때 매번 같은 경로를 다시 펼치지 않아도 됩니다.

#### API

HTTP API를 호출하는 모듈입니다. URL, Method, Header, Query Parameter, Body, 인증, Pre Request, Post Response를 설정할 수 있습니다.

새 API 모듈을 만들면 `Content-Type: application/json` 헤더가 기본으로 추가됩니다. Header와 Query 입력 행은 Key보다 Value 입력 영역을 더 넓게 사용하도록 배치되어 긴 값도 확인하기 쉽습니다.

Body가 긴 JSON인 경우 Body 영역의 전체화면 확대 아이콘을 눌러 넓은 화면에서 편집할 수 있습니다. 전체화면 편집기에서 수정한 내용은 API 모듈의 Body 값에 바로 반영되며, `JSON 정렬` 버튼으로 내용을 보기 좋게 정리할 수 있습니다.

JSON, INPUT/OUTPUT, Pre Request, Post Response에서 사용하는 Monaco 편집기는 앱의 다크/라이트 테마를 따라 자동으로 변경됩니다.

API URL은 보통 환경 변수로 시작합니다.

```text
{{baseUrl}}/v1/bookings
```

캔버스의 API 카드와 API 목록에서는 `{{환경변수}}`, `[[INPUT값]]`, `<<DATA값>>`을 현재 확인 가능한 값으로 치환해 URL을 보여줍니다. 다만 URL에 있는 첫 번째 `{{환경변수}}`는 표시하지 않습니다. 보통 `{{baseUrl}}`처럼 `http`로 시작하는 공통 주소가 반복되기 때문에 endpoint 확인에 필요한 나머지 URL만 보여주기 위한 규칙입니다. 해당 모듈의 실행 INPUT, START 반복 데이터의 현재 행 또는 미리보기 행에서 값을 찾을 수 있으면 나머지 변수는 실제 값으로 표시됩니다.

API INPUT 매핑에서 JSON 값을 선택하면 기본 경로는 입력 모듈 ID에 묶이지 않는 `output[0]` 형태로 저장됩니다. 조건에 따라 앞단 SELECT 모듈이 바뀌는 흐름에서도 같은 필드명을 계속 사용할 수 있고, 선택 후에는 경로 입력란에서 `[[amount * -1]]`, `$get("금액")` 같은 표현식을 직접 수정할 수 있습니다.

모듈 이름을 길게 지정하면 저장 시 캔버스 카드의 초기 가로 폭이 이름 길이에 맞춰 자동으로 확장됩니다. 이미 더 넓게 조절한 모듈은 줄어들지 않습니다.

#### BRANCH

TRUE/FALSE를 판단해 실행 경로를 나누는 모듈입니다.

BRANCH는 데이터를 새로 만들지 않습니다. 조건 판단만 수행하고, 다음 모듈에는 이전 모듈에서 받은 OUTPUT DATA를 그대로 전달합니다.

실행 후 선택된 TRUE/FALSE 경로는 BRANCH 모듈과 같은 색상으로 포트와 라벨에 표시됩니다. 라이트 테마에서도 선택 경로가 흰색으로 사라지지 않도록 구분됩니다.

BRANCH 값이 조건식이나 사용자 선택이 아니라 이미 TRUE 또는 FALSE로 고정된 상태라면, 캔버스 카드의 해당 TRUE/FALSE 포트가 실행 전에도 강조되어 고정 경로를 바로 확인할 수 있습니다.

사용 예:

- 응답 값이 있으면 TRUE 경로, 없으면 FALSE 경로
- 금액이 특정 값보다 크면 별도 API 호출
- 실행 중 사용자가 TRUE/FALSE를 직접 선택

#### END

워크플로우 종료 모듈입니다. 선택한 모듈의 실행 결과를 HTML 또는 Markdown 리포트로 저장할 수 있습니다.

END 모듈은 여러 실행 경로가 합류하는 종착점으로 사용할 수 있습니다. 여러 모듈이나 BRANCH의 TRUE/FALSE 경로를 하나의 END 모듈에 연결할 수 있으며, 같은 BRANCH의 TRUE와 FALSE를 모두 같은 END로 연결할 수도 있습니다.

END 설정에서 모듈 내부에 표시할 환경 변수 key를 선택할 수 있습니다. 선택 가능한 key는 BASE 환경과 현재 실행 환경에 등록된 변수에서 가져옵니다. 실행이 완료되면 선택한 값들이 End 모듈 내부에 표시되고, 각 값을 복사할 수 있습니다.

이 기능은 특정 변수 이름을 하드코딩하지 않습니다. 예를 들어 항공 예약 업무에서는 `PNR` 또는 `recordLocator`를 선택할 수 있고, 다른 업무에서는 `orderId`, `bookingId`, `token`처럼 확인해야 하는 값을 선택하면 됩니다. 선택한 값이 많으면 End 모듈의 높이가 늘어나 모든 값이 표시됩니다.

END 리포트의 출력 대상은 START에서 END까지 연결된 실행 경로 안의 모듈만 선택할 수 있습니다. END 설정을 저장한 뒤 중간에 새 모듈을 추가하고 연결선으로 실행 경로에 포함하면, 새 모듈은 리포트 대상에 기본 포함됩니다. 기존에 사용자가 체크를 해제한 모듈은 계속 제외됩니다.

### 7. API 목록으로 실행 흐름 확인하기

캔버스 플로팅 메뉴의 `API 목록` 버튼을 누르면 연결선 기준 실행 순서에 따라 API 목록이 펼쳐집니다.

목록에는 다음 정보가 표 형태로 표시됩니다.

```text
# | 모듈 | Method | URL
```

URL은 치환 가능한 변수 값을 반영한 전체 주소를 줄이지 않고 표시합니다. API 목록은 내부 스크롤 없이 전체 항목을 펼쳐 보여줍니다. API 목록 행을 클릭하면 캔버스가 해당 API 모듈 위치로 이동하고, 해당 모듈이 선택되어 포커싱됩니다. 이 기능은 전체 API 흐름이 올바른 endpoint 순서로 구성되었는지 확인할 때 사용합니다.

캔버스에서 마우스 휠을 사용하면 `30%`부터 `200%` 사이에서 자유롭게 확대비율을 조정할 수 있습니다. 현재 확대비율은 플로팅 메뉴의 `%` 버튼에 표시됩니다.

플로팅 메뉴의 확대비율(`100%`)을 클릭하면 `전체화면`, `200%`, `100%`, `50%`, `30%`를 선택할 수 있습니다. 이 배율 항목들은 빠르게 이동하기 위한 프리셋입니다. `전체화면`을 선택하면 캔버스만 남기고 사이드바, 상단바, 실행 로그를 숨깁니다. 전체화면 상태에서는 같은 메뉴의 첫 항목이 `닫기`로 표시되며, 이를 선택하면 일반 화면으로 돌아옵니다.

### 8. 워크플로우 실행하기

캔버스 플로팅 메뉴 맨 오른쪽의 `실행` 버튼으로 전체 캔버스를 실행합니다. 실행 결과가 표시된 상태에서는 같은 위치에 `초기화` 버튼이 표시되어 실행 상태와 로그를 지울 수 있습니다.

실행 중에는 같은 버튼이 `실행중` 상태와 로딩 인디케이터를 표시합니다. 실행 중 버튼을 누르면 중지 확인창이 열리고, 확인하면 현재 상태에서 실행을 중지한 뒤 버튼이 `초기화`로 바뀝니다. `Ctrl+Enter`는 Windows/Linux, `Cmd+Enter`는 macOS에서 실행 단축키로 동작하며, 이미 실행 결과가 있는 상태에서는 먼저 초기화한 뒤 다시 실행합니다.

실행 규칙은 다음과 같습니다.

- `Start`에서 연결된 모듈만 실행합니다.
- 연결되지 않은 모듈은 실행하지 않습니다.
- 실행 중 오류가 발생하면 즉시 전체 실행을 중단합니다.
- 노드별 INPUT, OUTPUT, 상태, 실행 로그를 확인할 수 있습니다.
- API 모듈 실행 로그에서는 실제 요청을 cURL 명령어로 확인할 수 있습니다.
- 모듈 설정창의 실행 버튼은 `Start`부터 해당 모듈까지의 경로만 실행해 INPUT/OUTPUT 미리보기를 갱신합니다.

## API 스크립트 사용법

API 모듈에는 `Pre Request`와 `Post Response` 스크립트가 있습니다.

API 모듈의 새 스크립트는 기본적으로 `Pre Request`는 `const input = getInput();`, `Post Response`는 `const output = getOutput();`으로 시작합니다. 이 기본 코드는 INPUT/OUTPUT을 바로 참조할 수 있게 하기 위한 시작 템플릿이며, 직접 수정하거나 삭제할 수 있습니다.

각 스크립트 영역의 도움말 아이콘을 누르면 사용 가능한 함수와 예제 코드를 볼 수 있습니다. 예제 코드의 `복사` 버튼을 누르면 해당 샘플을 바로 클립보드에 복사할 수 있습니다.

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

START 반복 데이터의 현재 행 값은 `<<컬럼명>>` 형식으로 참조할 수 있습니다.

템플릿 안의 `{{ }}`, `[[ ]]`, `<< >>` 값은 단순 참조뿐 아니라 간단한 표현식도 지원합니다. 예를 들어 숫자는 `[[passengerCount * 1]]`, 문자열은 `[[passengerName.replace(/\s+/g, '')]]`, 환경변수는 `{{baseUrl.replace(/\/$/, '')}}`, 반복 데이터는 `<<no * 1>>`처럼 사용할 수 있습니다. 공백이나 특수문자가 있는 키는 기존처럼 단순 참조로 사용하고, 표현식에서는 `$get("컬럼명")`으로 값을 가져올 수 있습니다.

```javascript
const input = getInput();

console.log(input.no);
console.log(input.origin);
```

`<<컬럼명>>`은 START 반복 DATA 표현식입니다. `[[변수명]]`처럼 이전 모듈의 INPUT JSON에서 선택하는 표현식이 아니며, START가 만든 현재 반복 행 데이터에서 값을 찾습니다. 따라서 `<<no>>`는 반복 실행 중 항상 존재하고, START에 연결된 모든 하위 모듈의 URL, Header, Query, Body, API/SELECT 스크립트, BRANCH 조건에서 사용할 수 있습니다.

설정 화면처럼 실제 반복 회차가 아직 정해지지 않은 경우에는 START 반복 데이터의 첫 번째 행을 미리보기 값으로 사용합니다. 데이터 반복이면 첫 번째 행의 값, 횟수 반복이면 `<<no>>`가 `1`로 표시됩니다. INPUT JSON에서 선택해야 하는 값은 `[[변수명]]`, START 반복 데이터 행의 값은 `<<컬럼명>>`으로 구분해 사용합니다.

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

`getOutput()`은 현재 API 응답을 반환합니다. API 응답에서 사용할 결과가 1개이면 단일 객체/값으로, 여러 개이면 배열로 전달됩니다. 응답 자체가 객체인 단일 호출은 OUTPUT에서도 배열로 감싸지지 않고 객체로 표시됩니다.

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

기능, 설정, 사용법, 배포 방식이 변경되면 같은 변경 작업 안에서 `README.md`와 `README.en.md`를 함께 업데이트합니다.

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
export A8A_UPDATE_GITHUB_REPO="hanbroz/a8a"
export A8A_APP_VERSION="$(date '+%Y.%m.%d.%H.%M')"

npm run version:stamp -- "$A8A_APP_VERSION"
npm run build:mac
```

`npm run build:mac`은 `build/icon.png`에서 macOS용 `build/icon.icns`를 생성한 뒤 Apple Silicon(`arm64`)과 Intel(`x64`)용 `.dmg`와 `.zip` 파일을 만듭니다. 한쪽 CPU용 파일만 만들려면 다음 명령을 사용합니다.

```bash
npm run build:mac:arm64
npm run build:mac:x64
```

빌드가 끝나면 `dist/` 폴더에 다음 파일이 생성됩니다.

```text
dist/a8a-Mac-arm64-yyyy.MM.dd.HH.mm.dmg
dist/a8a-Mac-arm64-yyyy.MM.dd.HH.mm.zip
dist/a8a-Mac-x64-yyyy.MM.dd.HH.mm.dmg
dist/a8a-Mac-x64-yyyy.MM.dd.HH.mm.zip
```

macOS 설치 파일은 Windows에서 안정적으로 만들 수 없습니다. `.dmg`와 `.zip`을 배포하려면 macOS 환경 또는 GitHub Actions의 macOS runner에서 빌드해야 합니다.

Linux 패키지는 Linux 환경에서 다음 명령으로 만듭니다.

```bash
npm run build:linux
```

## 배포 방식

중요 배포 지침: 새 릴리스는 항상 로컬에서 빌드한 산출물을 GitHub Release에 직접 업로드해 공개합니다. GitHub Actions는 보조 자동화 또는 검증 수단일 뿐이며, 실제 배포 기준은 로컬 빌드 산출물입니다.

현재 GitHub Actions Release workflow는 계정 결제 또는 지출 한도 문제로 실패할 수 있습니다. 따라서 새 버전을 배포할 때는 로컬에서 Windows 빌드를 만들고 GitHub Release를 직접 생성하는 방식을 표준으로 사용합니다. macOS 배포 파일까지 함께 제공하려면 같은 버전 번호로 macOS 환경에서 `npm run build:mac`을 실행한 뒤 생성된 `.dmg`와 `.zip` 파일을 같은 Release에 업로드합니다.

새 버전 배포 절차는 매번 동일합니다.

1. 새 기능과 문서 변경을 먼저 commit/push 합니다.
2. `build/installer-release-notes.nsh`와 `build/release-notes.md`의 업데이트 안내 문구를 이번 릴리스 내용으로 수정합니다.
3. 아래 수동 배포 명령을 실행합니다.
4. 명령이 실행 시점의 시간을 `yyyy.MM.dd.HH.mm` 형식으로 계산합니다.
5. 앱 내부 표시 버전을 해당 날짜 버전으로 기록합니다.
6. Windows 설치 파일과 포터블 실행 파일을 빌드합니다.
7. macOS 파일을 제공해야 한다면 같은 버전 번호로 macOS 환경에서 `.dmg`와 `.zip` 파일을 빌드합니다.
8. 버전 변경 파일을 commit/push 합니다.
9. `vyyyy.MM.dd.HH.mm` 태그로 GitHub Release를 생성합니다.
10. `build/release-notes.md` 본문과 함께 설치 파일, blockmap 파일, 포터블 실행 파일, macOS 파일을 Release asset으로 업로드합니다.

```powershell
npm run release:manual
```

특정 버전 번호로 배포해야 하는 경우에는 다음처럼 실행합니다.

```powershell
npm run release:manual -- -Version 2026.06.02.12.54
```

기본 저장소는 `hanbroz/a8a`입니다. 다른 저장소로 배포해야 할 때는 `-Repo` 값을 지정합니다.

```powershell
npm run release:manual -- -Repo owner/repo
```

수동 배포 명령은 다음 작업을 자동으로 수행합니다. 이 명령은 Windows 설치 파일과 포터블 파일을 대상으로 하며, macOS 파일은 macOS 환경에서 별도로 빌드해 같은 Release에 추가해야 합니다.

1. `npm run version:stamp -- <version>`으로 앱 버전을 기록합니다.
2. `npm run build:win`으로 설치형과 포터블 버전을 빌드합니다.
3. `src/main/appVersion.ts` 버전 변경만 commit 합니다.
4. 현재 브랜치를 원격 저장소에 push 합니다.
5. `gh release create`로 최신 Release를 만들고 `build/release-notes.md` 본문과 asset을 업로드합니다.

Release에 올라가는 파일은 다음과 같습니다.

```text
dist/a8a-Setup-yyyy.MM.dd.HH.mm.exe
dist/a8a-Setup-yyyy.MM.dd.HH.mm.exe.sha256
dist/a8a-Setup-yyyy.MM.dd.HH.mm.exe.blockmap
dist/a8a-Setup-yyyy.MM.dd.HH.mm.exe.blockmap.sha256
dist/a8a-Portable-yyyy.MM.dd.HH.mm.exe
dist/a8a-Portable-yyyy.MM.dd.HH.mm.exe.sha256
dist/a8a-Mac-arm64-yyyy.MM.dd.HH.mm.dmg
dist/a8a-Mac-arm64-yyyy.MM.dd.HH.mm.dmg.sha256
dist/a8a-Mac-arm64-yyyy.MM.dd.HH.mm.zip
dist/a8a-Mac-arm64-yyyy.MM.dd.HH.mm.zip.sha256
dist/a8a-Mac-x64-yyyy.MM.dd.HH.mm.dmg
dist/a8a-Mac-x64-yyyy.MM.dd.HH.mm.dmg.sha256
dist/a8a-Mac-x64-yyyy.MM.dd.HH.mm.zip
dist/a8a-Mac-x64-yyyy.MM.dd.HH.mm.zip.sha256
```

개발자에게 직접 전달할 파일은 사용 방식에 따라 다릅니다.

- 설치해서 사용하게 하려면 `a8a-Setup-yyyy.MM.dd.HH.mm.exe`를 전달합니다.
- 설치 없이 실행하게 하려면 `a8a-Portable-yyyy.MM.dd.HH.mm.exe`를 전달합니다.
- Apple Silicon Mac 사용자에게는 `a8a-Mac-arm64-yyyy.MM.dd.HH.mm.dmg`를 전달합니다.
- Intel Mac 사용자에게는 `a8a-Mac-x64-yyyy.MM.dd.HH.mm.dmg`를 전달합니다.
- `.blockmap` 파일은 자동 업데이트용 Release asset이고, `.sha256` 파일은 업데이트 파일 검증용 asset이므로 직접 전달할 필요가 없습니다.

Windows 설치형 파일의 업데이트 안내 화면은 `build/installer.nsh`와 `build/installer-release-notes.nsh`로 구성합니다. 새 버전을 만들 때는 `build/installer-release-notes.nsh`의 `A8A_INSTALLER_RELEASE_NOTES` 문구를 이번 버전의 변경사항으로 교체한 뒤 빌드합니다. GitHub Release 본문은 `build/release-notes.md`를 사용하므로 두 파일의 변경사항 목록을 같은 내용으로 유지합니다. NSIS 줄바꿈은 `$\r$\n`을 사용합니다.

GitHub Actions가 정상화되면 `main` 또는 `master` 브랜치에 push할 때 자동으로 Windows와 macOS 설치 파일을 만들고 GitHub Release를 생성할 수 있습니다. 다만 이 프로젝트의 공식 배포 절차는 로컬 빌드 후 수동 Release 공개입니다. 자동 배포 흐름은 참고용으로만 사용합니다.

1. push 시점의 시간을 `yyyy.MM.dd.HH.mm` 형식으로 계산합니다.
2. 앱 내부 표시 버전을 해당 날짜 버전으로 기록합니다.
3. Windows 설치 파일과 포터블 파일을 빌드합니다.
4. macOS Apple Silicon/Intel `.dmg`와 `.zip` 파일을 빌드합니다.
5. `vyyyy.MM.dd.HH.mm` 태그로 GitHub Release를 생성합니다.
6. Windows와 macOS 산출물 및 각 파일의 `.sha256` 체크섬을 Release asset으로 업로드합니다.

GitHub Actions가 결제 또는 지출 한도 문제로 시작되지 않으면 Release가 생성되지 않습니다. 이 경우 저장소 소유자는 GitHub의 `Settings > Billing & plans`에서 결제 수단, Actions 예산, spending limit을 확인한 뒤 workflow를 다시 실행해야 합니다.

## 라이선스와 사용 조건

a8a 저장소는 GitHub에 공개되어 있지만, 상업적 사용을 허용하는 오픈소스 라이선스가 아닙니다. 누구나 코드를 확인하고 비상업적 목적으로 사용할 수 있도록 공개한 source-available 프로젝트입니다.

이 프로젝트는 `PolyForm Noncommercial License 1.0.0` 조건으로 제공됩니다. 자세한 내용은 [LICENSE.md](LICENSE.md)와 [NOTICE](NOTICE)를 확인합니다.

허용되는 사용:

- 개인 학습, 연구, 검토, 테스트 목적의 사용
- 조직 내부에서 비상업적 검토나 파일럿 목적으로 사용하는 것
- 비상업적 목적으로 복사, 수정, 배포하는 것

반드시 지켜야 할 조건:

- 원저작자 표시를 제거하면 안 됩니다.
- 배포, fork, 수정본, 파생 작업에는 `NOTICE`의 `Required Notice` 문구를 포함해야 합니다.
- 라이선스 문서 또는 라이선스 URL을 함께 제공해야 합니다.

금지되는 사용:

- 별도 서면 허가 없이 상업적 목적으로 사용하는 것
- a8a 또는 a8a를 포함한 파생물을 판매하거나 유료 서비스에 포함하는 것
- 회사, 고객, 프로젝트의 수익 창출을 목적으로 운영 환경에서 사용하는 것

상업적 사용, 유료 기능 사용, 재배포 계약이 필요한 경우에는 원저작자에게 별도 허가를 받아야 합니다. 향후 기능이 충분히 검증되면 일부 기능에 대한 유료 라이선스, 후원, 또는 "개발자에게 커피 한 잔" 형태의 도네이션 옵션이 추가될 수 있습니다.

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

Windows 앱은 Release asset에서 `.exe` 설치 파일을 찾고, macOS 앱은 현재 CPU에 맞는 `.dmg` 또는 `.zip` 파일을 찾습니다. macOS 사용자에게 업데이트를 제공하려면 Release에 `a8a-Mac-arm64-yyyy.MM.dd.HH.mm.dmg` 또는 `a8a-Mac-x64-yyyy.MM.dd.HH.mm.dmg` 파일이 올라가 있어야 합니다. 또한 각 설치 파일과 같은 이름의 `.sha256` 파일이 없으면 앱은 보안을 위해 업데이트를 적용하지 않습니다.

### Windows에서 설치 경고가 표시됩니다

코드 서명 인증서가 없는 설치 파일은 Windows 보안 경고가 표시될 수 있습니다. 파일 출처가 조직 내부 GitHub Release인지 확인한 뒤 실행합니다.

### macOS에서 확인되지 않은 개발자 경고가 표시됩니다

Apple 코드 서명과 notarization이 적용되지 않은 `.dmg` 또는 `.app`은 macOS Gatekeeper 경고가 표시될 수 있습니다. 조직 내부 GitHub Release에서 받은 파일인지 확인한 뒤 Finder에서 앱을 오른쪽 클릭하고 `열기`를 선택합니다. 일반 사용자에게 경고 없이 배포하려면 Apple Developer 계정으로 서명하고 notarization을 완료해야 합니다.
