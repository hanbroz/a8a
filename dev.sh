#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "[a8a] 기존 프로세스 종료 중..."
pkill -f "Electron.*a8a" 2>/dev/null || true
pkill -f "electron-vite" 2>/dev/null || true
sleep 1

echo "[a8a] 개발 서버 시작 중 (HMR 활성)..."
./node_modules/.bin/electron-vite dev
