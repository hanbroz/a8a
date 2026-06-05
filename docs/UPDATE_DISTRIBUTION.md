# GitHub 업데이트 배포 절차

a8a는 앱 내부 표시 버전과 업데이트 비교 버전을 `yyyy.MM.dd.HH.mm` 형식의 날짜 버전으로 사용합니다. `package.json`의 `version`은 npm과 `electron-builder` 호환을 위한 SemVer 값으로 유지합니다.

## 공식 배포 경로

현재 공식 배포 경로는 로컬 Windows 빌드 후 GitHub Release를 직접 공개하는 방식입니다. GitHub Actions Release 워크플로우는 보조 자동화이며, 결제 또는 spending limit 문제로 실행되지 않을 수 있습니다.

릴리즈 전에는 다음 파일을 함께 갱신합니다.

- `build/installer-release-notes.nsh`: Windows 설치 과정에서 표시되는 업데이트 안내입니다.
- `build/release-notes.md`: GitHub Release 본문에 표시되는 업데이트 안내입니다.
- `README.md`, `README.en.md`: 새 기능과 배포 규칙이 사용자 문서에 반영되어야 합니다.

## 수동 Windows 릴리즈

기능, 문서, 릴리즈 노트를 먼저 커밋한 뒤 다음 명령을 실행합니다.

```powershell
npm run release:manual
```

특정 버전 번호로 배포해야 하는 경우에는 다음처럼 실행합니다.

```powershell
npm run release:manual -- -Version 2026.06.05.18.30
```

다른 GitHub 저장소로 배포해야 하는 경우에는 `owner/repo` 형식으로 `-Repo` 값을 지정합니다.

```powershell
npm run release:manual -- -Repo owner/repo
```

수동 릴리즈 스크립트는 다음 작업을 수행합니다.

1. `npm run version:stamp -- <version>`으로 `src/main/appVersion.ts`에 앱 표시 버전을 기록합니다.
2. `npm run build:win`으로 Windows 설치 파일과 포터블 파일을 빌드합니다.
3. 설치 파일, blockmap, 포터블 파일의 SHA-256 체크섬을 생성합니다.
4. `src/main/appVersion.ts` 변경만 별도 릴리즈 버전 커밋으로 기록합니다.
5. 현재 브랜치를 원격 저장소에 push합니다.
6. `build/release-notes.md`를 본문으로 사용해 `vyyyy.MM.dd.HH.mm` GitHub Release를 공개합니다.
7. Windows 설치 파일, blockmap, 포터블 파일, 각 `.sha256` 파일을 Release asset으로 업로드합니다.

## Release asset

Windows 릴리즈에는 다음 파일이 필요합니다.

```text
dist/a8a-Setup-yyyy.MM.dd.HH.mm.exe
dist/a8a-Setup-yyyy.MM.dd.HH.mm.exe.sha256
dist/a8a-Setup-yyyy.MM.dd.HH.mm.exe.blockmap
dist/a8a-Setup-yyyy.MM.dd.HH.mm.exe.blockmap.sha256
dist/a8a-Portable-yyyy.MM.dd.HH.mm.exe
dist/a8a-Portable-yyyy.MM.dd.HH.mm.exe.sha256
```

사용자에게 직접 전달할 파일은 사용 방식에 따라 다릅니다.

- 설치형으로 배포하려면 `a8a-Setup-yyyy.MM.dd.HH.mm.exe`를 전달합니다.
- 설치 없이 실행하게 하려면 `a8a-Portable-yyyy.MM.dd.HH.mm.exe`를 전달합니다.
- `.blockmap` 파일은 자동 업데이트용 Release asset입니다.
- `.sha256` 파일은 앱 내부 업데이트 파일 검증용 asset입니다.

## 앱 업데이트 확인

앱은 시작 후 최신 GitHub Release를 확인합니다.

- 최신 Release 태그나 이름에서 `yyyy.MM.dd.HH.mm` 값을 추출합니다.
- 현재 앱에 포함된 날짜 버전보다 크면 업데이트가 있다고 판단합니다.
- Windows에서는 Release asset에서 설치 파일과 같은 이름의 `.sha256` 파일을 함께 찾습니다.
- 다운로드한 설치 파일의 SHA-256 값이 Release의 `.sha256` 값과 일치해야 업데이트 적용 버튼을 표시합니다.
- 사용자가 업데이트를 적용하면 설치 파일을 실행하고 앱을 종료합니다.

## 설치 화면 업데이트 안내

Windows 설치 과정의 업데이트 안내 화면은 `build/installer.nsh`와 `build/installer-release-notes.nsh`로 구성합니다. 새 버전을 만들 때는 `build/installer-release-notes.nsh`의 `A8A_INSTALLER_RELEASE_NOTES` 문구를 이번 버전의 주요 변경사항으로 교체한 뒤 빌드합니다.

NSIS 문자열 줄바꿈은 `$\r$\n` 형식을 사용합니다.

## GitHub Actions 참고

GitHub Actions가 정상 동작하면 `main` 또는 `master` 브랜치 push로 Windows와 macOS 산출물을 만들고 Release를 공개할 수 있습니다. 다만 현재 프로젝트의 공식 배포 절차는 로컬 빌드와 수동 Release 공개입니다.

Actions가 결제 또는 spending limit 문제로 시작하지 않으면 Release가 생성되지 않습니다. 이 경우 저장소 소유자는 GitHub의 `Settings > Billing & plans`에서 결제 수단, Actions 예산, spending limit을 확인해야 합니다.
