# GitHub 자동 업데이트 배포 절차

a8a는 앱 내부 표시 버전과 업데이트 비교 버전을 `yyyy.MM.dd.HH.mm` 형식의 날짜 버전으로 사용합니다. `package.json`의 `version`은 npm과 `electron-builder` 호환을 위한 SemVer 값으로 유지합니다.

## push 시 버전 지정

`main` 또는 `master` 브랜치에 push하면 GitHub Actions가 다음 작업을 수행합니다.

1. 현재 시각을 `yyyy.MM.dd.HH.mm` 형식으로 계산합니다.
2. `src/main/appVersion.ts`에 앱 표시 버전과 GitHub 저장소를 기록합니다.
3. Windows 설치 파일을 빌드합니다.
4. `vyyyy.MM.dd.HH.mm` 태그의 GitHub Release를 생성합니다.
5. `a8a-Setup-yyyy.MM.dd.HH.mm.exe`와 blockmap 파일을 Release asset으로 업로드합니다.

## 앱 업데이트 확인

설치된 앱은 시작 후 약 5초 뒤 GitHub 최신 Release를 확인합니다.

- 최신 Release 태그나 이름에서 `yyyy.MM.dd.HH.mm` 값을 추출합니다.
- 현재 앱에 포함된 날짜 버전보다 크면 업데이트가 있다고 판단합니다.
- GitHub Release asset의 Windows 설치 파일을 다운로드합니다.
- 다운로드가 끝나면 사용자에게 재시작 후 적용 버튼을 표시합니다.
- 사용자가 적용하면 설치 파일을 실행하고 앱을 종료합니다.

## 수동 빌드

로컬에서 날짜 버전을 직접 지정하려면 다음 명령을 사용합니다.

```powershell
$env:A8A_UPDATE_GITHUB_REPO = "owner/repo"
npm run version:stamp -- 2026.06.01.10.30
$env:A8A_APP_VERSION = "2026.06.01.10.30"
npm run build:win
```

`A8A_UPDATE_GITHUB_REPO`는 앱이 업데이트를 확인할 GitHub 저장소이며 `owner/repo` 형식입니다.

## 주의사항

- GitHub 최신 Release는 public 또는 앱에서 접근 가능한 저장소여야 합니다.
- Release 태그나 이름에는 반드시 `yyyy.MM.dd.HH.mm` 값이 포함되어야 합니다.
- 현재 자동 설치는 Windows NSIS 설치 파일 실행 방식입니다.
- macOS 업데이트를 추가하려면 코드 서명과 플랫폼별 설치 흐름을 별도로 구성해야 합니다.
