import { app, shell, BrowserWindow } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { initDb } from './db'
import { registerIpcHandlers } from './ipc'
import { initializeAutoUpdater, registerUpdaterIpcHandlers } from './updater'
import { resolveInitialWindowState, saveWindowState } from './windowState'
import { registerSessionStateIpc } from './sessionState'

function resolveAppIconPath(): string | undefined {
  const iconPath = is.dev ? join(__dirname, '../../build/icon.png') : join(process.resourcesPath, 'icon.png')
  return existsSync(iconPath) ? iconPath : undefined
}

function createWindow(): void {
  const init = resolveInitialWindowState()
  const mainWindow = new BrowserWindow({
    ...init.bounds,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'default',
    icon: resolveAppIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  if (init.isMaximized) mainWindow.maximize()

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('close', () => {
    saveWindowState(mainWindow)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    try {
      const url = new URL(details.url)
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        shell.openExternal(details.url)
      }
    } catch {
      // 잘못된 URL은 외부 브라우저로 전달하지 않습니다.
    }
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.eastarjet.a8a')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  await initDb()
  registerIpcHandlers()
  registerUpdaterIpcHandlers()
  registerSessionStateIpc()

  createWindow()
  initializeAutoUpdater()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
