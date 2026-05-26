@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo [a8a] 기존 프로세스 종료 중...
taskkill /F /IM electron.exe /T 2>nul || echo 실행 중인 electron 없음

timeout /t 1 /nobreak >nul

echo [a8a] 개발 서버 시작 중...
call npm run dev
