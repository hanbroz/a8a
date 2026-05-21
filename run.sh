#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "[a8a] 기존 프로세스 종료 중..."
pkill -f "Electron.*a8a" 2>/dev/null || true
pkill -f "electron-vite" 2>/dev/null || true
sleep 1

echo "[a8a] 빌드 중..."
./node_modules/.bin/electron-vite build

echo "[a8a] 실행 중..."
./node_modules/.bin/electron-vite preview
