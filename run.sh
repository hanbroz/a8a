#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

LOG_DIR="$SCRIPT_DIR/logs"
mkdir -p "$LOG_DIR"

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
LOG_FILE="$LOG_DIR/app-$TIMESTAMP.log"
LATEST_LOG="$LOG_DIR/latest.log"
PID_FILE="$LOG_DIR/app.pid"

# ── 기존 프로세스 종료 ──────────────────────────────────
if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "[a8a] 기존 프로세스(PID $OLD_PID) 종료 중..."
    kill "$OLD_PID" 2>/dev/null || true
    sleep 1
  fi
  rm -f "$PID_FILE"
fi
pkill -f "Electron.*a8a" 2>/dev/null || true
# Kill any lingering Electron processes from this project
pkill -f "electron/dist/Electron.app.*Contents/MacOS/Electron \." 2>/dev/null || true
sleep 0.5

# ── 빌드 ───────────────────────────────────────────────
echo "[a8a] 빌드 중..."
if ! ./node_modules/.bin/electron-vite build >> "$LOG_FILE" 2>&1; then
  echo "[a8a] [오류] 빌드 실패. 로그 확인: $LOG_FILE"
  tail -30 "$LOG_FILE"
  exit 1
fi
echo "[a8a] 빌드 완료"

# ── 백그라운드 실행 ────────────────────────────────────
echo "[a8a] 앱 시작 중..."
nohup ./node_modules/.bin/electron-vite preview >> "$LOG_FILE" 2>&1 &
APP_PID=$!
echo "$APP_PID" > "$PID_FILE"

# latest.log 심볼릭 링크 갱신
ln -sf "$LOG_FILE" "$LATEST_LOG"

# 앱이 즉시 크래시하는지 1초 확인
sleep 1
if ! kill -0 "$APP_PID" 2>/dev/null; then
  echo "[a8a] [오류] 앱이 즉시 종료되었습니다. 로그:"
  tail -40 "$LOG_FILE"
  exit 1
fi

echo "[a8a] 앱 실행 중 (PID: $APP_PID)"
echo "[a8a] 로그 파일: $LOG_FILE"
echo "[a8a] 최신 로그: $LATEST_LOG"
echo ""
echo "  로그 실시간 확인: tail -f $LATEST_LOG"
echo "  앱 종료:          kill \$(cat $PID_FILE)"
