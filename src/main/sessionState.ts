import { app, ipcMain, safeStorage } from 'electron'
import { readFileSync, writeFileSync, renameSync } from 'fs'
import { join } from 'path'

// 렌더러의 실행 로그/결과/화면 상태를 종료 후에도 유지하기 위한 파일 저장소.
// window-state.json 과 동일하게 userData 아래에 보관하되, 응답 본문에 승객 PII/인증 토큰이
// 담길 수 있어 OS 키체인(Windows DPAPI)으로 암호화한다. 데이터가 커질 수 있어 localStorage
// 대신 파일을 사용한다.
const STATE_FILE = 'session-state.json'

function statePath(): string {
  return join(app.getPath('userData'), STATE_FILE)
}

function loadSessionState(): unknown {
  try {
    const raw = readFileSync(statePath()) // Buffer (암호문 또는 평문 폴백)
    let json: string
    if (safeStorage.isEncryptionAvailable()) {
      try {
        json = safeStorage.decryptString(raw)
      } catch {
        // 암호화 불가 환경에서 평문 폴백으로 저장된 파일과의 호환.
        json = raw.toString('utf-8')
      }
    } else {
      json = raw.toString('utf-8')
    }
    return JSON.parse(json) as unknown
  } catch {
    // 파일이 없거나 복호화/파싱 실패: 저장된 세션이 없는 것으로 취급한다.
    return null
  }
}

function saveSessionState(data: unknown): void {
  try {
    const target = statePath()
    const tmp = `${target}.tmp`
    const json = JSON.stringify(data)
    // 저장 시 암호화. 키체인이 없는 환경(예: 데스크톱 키링 없는 Linux)에서는
    // 기능 유지를 위해 평문으로 폴백한다.
    const payload = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(json)
      : Buffer.from(json, 'utf-8')
    // temp 파일에 쓰고 원자적으로 교체 — 쓰기 도중 크래시/전원차단에도
    // 기존 파일이 깨지지 않아 마지막 세션이 유실되지 않는다.
    writeFileSync(tmp, payload)
    renameSync(tmp, target)
  } catch {
    // 세션 저장 실패가 앱을 중단시켜서는 안 된다(비치명적).
  }
}

export function registerSessionStateIpc(): void {
  ipcMain.handle('session:get', () => loadSessionState())
  ipcMain.handle('session:save', (_event, data: unknown) => {
    saveSessionState(data)
  })
}
