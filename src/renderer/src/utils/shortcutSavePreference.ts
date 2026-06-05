export type ShortcutSaveClosePreference = 'ask' | 'close' | 'keep-open'

const STORAGE_KEY = 'module-shortcut-save-close-preference'

export function getShortcutSaveKeyLabel(): string {
  const platform = typeof navigator !== 'undefined'
    ? `${navigator.platform} ${navigator.userAgent}`.toLowerCase()
    : ''
  return /mac|iphone|ipad|ipod/.test(platform) ? 'Cmd + S' : 'Ctrl + S'
}

export function loadShortcutSaveClosePreference(): ShortcutSaveClosePreference {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'close' || saved === 'keep-open' || saved === 'ask') return saved
  } catch {
    // localStorage를 사용할 수 없으면 매번 묻는 기본값을 사용한다.
  }
  return 'ask'
}

export function saveShortcutSaveClosePreference(preference: ShortcutSaveClosePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, preference)
  } catch {
    // 설정 저장 실패는 현재 저장 동작을 막지 않는다.
  }
}
