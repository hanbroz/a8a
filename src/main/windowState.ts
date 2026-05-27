import { app, BrowserWindow, screen } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const FHD = { w: 1920, h: 1080 }
const RATIO = 0.9
const STATE_FILE = 'window-state.json'

interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  isMaximized: boolean
}

function statePath(): string {
  return join(app.getPath('userData'), STATE_FILE)
}

function loadWindowState(): WindowState | null {
  try {
    const raw = readFileSync(statePath(), 'utf-8')
    const p = JSON.parse(raw) as Partial<WindowState>
    if (typeof p.width !== 'number' || typeof p.height !== 'number') return null
    if (p.width < 600 || p.height < 400) return null
    return {
      x: typeof p.x === 'number' ? p.x : undefined,
      y: typeof p.y === 'number' ? p.y : undefined,
      width: p.width,
      height: p.height,
      isMaximized: p.isMaximized === true,
    }
  } catch {
    return null
  }
}

export function saveWindowState(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  try {
    const isMaximized = win.isMaximized()
    const bounds = isMaximized ? win.getNormalBounds() : win.getBounds()
    const state: WindowState = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      isMaximized,
    }
    writeFileSync(statePath(), JSON.stringify(state, null, 2), 'utf-8')
  } catch {
    // non-fatal — failing to persist UI state should not crash the app
  }
}

function defaultBounds(): { x: number; y: number; width: number; height: number } {
  const workArea = screen.getPrimaryDisplay().workArea
  const width = Math.min(Math.round(FHD.w * RATIO), workArea.width)
  const height = Math.min(Math.round(FHD.h * RATIO), workArea.height)
  const x = workArea.x + Math.round((workArea.width - width) / 2)
  const y = workArea.y + Math.round((workArea.height - height) / 2)
  return { x, y, width, height }
}

function isPositionVisible(s: WindowState): boolean {
  if (s.x === undefined || s.y === undefined) return false
  return screen.getAllDisplays().some(d => {
    const b = d.workArea
    return s.x! < b.x + b.width - 100 &&
           s.y! < b.y + b.height - 50 &&
           s.x! + s.width > b.x + 100 &&
           s.y! + s.height > b.y + 50
  })
}

export interface InitialWindowState {
  bounds: { x?: number; y?: number; width: number; height: number }
  isMaximized: boolean
}

export function resolveInitialWindowState(): InitialWindowState {
  const saved = loadWindowState()
  if (saved && isPositionVisible(saved)) {
    return {
      bounds: { x: saved.x, y: saved.y, width: saved.width, height: saved.height },
      isMaximized: saved.isMaximized,
    }
  }
  return { bounds: defaultBounds(), isMaximized: false }
}
