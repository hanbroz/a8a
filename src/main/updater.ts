import { app, BrowserWindow, ipcMain } from 'electron'
import { createWriteStream } from 'fs'
import { mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import { spawn } from 'child_process'
import { once } from 'events'
import { APP_VERSION, UPDATE_REPOSITORY } from './appVersion'

type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'disabled'

interface UpdateState {
  status: UpdateStatus
  currentVersion: string
  availableVersion?: string
  progress?: number
  message?: string
}

interface GitHubReleaseAsset {
  name: string
  browser_download_url: string
  size: number
}

interface GitHubRelease {
  tag_name: string
  name: string | null
  html_url: string
  prerelease: boolean
  draft: boolean
  assets: GitHubReleaseAsset[]
}

interface AvailableUpdate {
  version: string
  downloadUrl: string
  assetName: string
  releaseUrl: string
  size: number
}

const updateState: UpdateState = {
  status: 'idle',
  currentVersion: APP_VERSION,
}

const VERSION_PATTERN = /\d{4}\.\d{2}\.\d{2}\.\d{2}\.\d{2}/

let initialized = false
let availableUpdate: AvailableUpdate | null = null
let downloadedInstallerPath: string | null = null
let downloadPromise: Promise<void> | null = null

function sendUpdateState(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('update:status', updateState)
  }
}

function setUpdateState(next: Partial<UpdateState>): UpdateState {
  Object.assign(updateState, next)
  sendUpdateState()
  return { ...updateState }
}

function configuredRepository(): string {
  return (process.env.A8A_UPDATE_GITHUB_REPO || UPDATE_REPOSITORY).trim()
}

function isUpdaterEnabled(): boolean {
  return app.isPackaged || process.env.A8A_ENABLE_DEV_UPDATER === 'true'
}

function versionToNumber(version: string): number {
  if (!VERSION_PATTERN.test(version)) return 0
  return Number(version.replace(/\./g, ''))
}

function extractDateVersion(value: string | null | undefined): string | null {
  return value?.match(VERSION_PATTERN)?.[0] ?? null
}

function isNewerVersion(candidate: string, current: string): boolean {
  return versionToNumber(candidate) > versionToNumber(current)
}

function releaseAsset(release: GitHubRelease): GitHubReleaseAsset | null {
  return release.assets.find(asset => {
    const name = asset.name.toLowerCase()
    return name.endsWith('.exe') && !name.endsWith('.blockmap') && name.includes('setup')
  }) ?? release.assets.find(asset => {
    const name = asset.name.toLowerCase()
    return name.endsWith('.exe') && !name.endsWith('.blockmap')
  }) ?? null
}

async function fetchLatestRelease(): Promise<AvailableUpdate | null> {
  const repository = configuredRepository()
  if (!repository) {
    setUpdateState({
      status: 'disabled',
      message: '업데이트를 확인할 GitHub 저장소가 설정되지 않았습니다.',
    })
    return null
  }

  const response = await fetch(`https://api.github.com/repos/${repository}/releases/latest`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': `a8a/${APP_VERSION}`,
    },
  })

  if (response.status === 404) {
    setUpdateState({
      status: 'not-available',
      progress: undefined,
      message: '배포된 GitHub 릴리스를 찾지 못했습니다.',
    })
    return null
  }

  if (!response.ok) {
    throw new Error(`GitHub 업데이트 확인 실패: ${response.status} ${response.statusText}`)
  }

  const release = await response.json() as GitHubRelease
  if (release.draft || release.prerelease) return null

  const version = extractDateVersion(release.tag_name) ?? extractDateVersion(release.name)
  if (!version || !isNewerVersion(version, APP_VERSION)) return null

  const asset = releaseAsset(release)
  if (!asset) {
    throw new Error('새 릴리스에 Windows 설치 파일(.exe)이 없습니다.')
  }

  return {
    version,
    downloadUrl: asset.browser_download_url,
    assetName: asset.name,
    releaseUrl: release.html_url,
    size: asset.size,
  }
}

async function downloadUpdate(update: AvailableUpdate): Promise<void> {
  if (downloadedInstallerPath) return
  if (downloadPromise) return downloadPromise

  downloadPromise = (async () => {
    setUpdateState({
      status: 'downloading',
      availableVersion: update.version,
      progress: 0,
      message: 'GitHub에서 업데이트 설치 파일을 다운로드하고 있습니다.',
    })

    const dir = join(tmpdir(), 'a8a-updater')
    await mkdir(dir, { recursive: true })
    const installerPath = join(dir, basename(update.assetName))
    const response = await fetch(update.downloadUrl, {
      headers: {
        'User-Agent': `a8a/${APP_VERSION}`,
      },
    })
    if (!response.ok || !response.body) {
      throw new Error(`업데이트 다운로드 실패: ${response.status} ${response.statusText}`)
    }

    const total = Number(response.headers.get('content-length') ?? update.size)
    let received = 0
    const writer = createWriteStream(installerPath)
    const reader = response.body.getReader()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        received += value.length
        if (!writer.write(value)) await once(writer, 'drain')
        if (total > 0) {
          setUpdateState({
            status: 'downloading',
            progress: Math.max(0, Math.min(100, (received / total) * 100)),
          })
        }
      }
      await new Promise<void>((resolve, reject) => {
        writer.once('finish', resolve)
        writer.once('error', reject)
        writer.end()
      })
    } finally {
      if (!writer.closed) writer.destroy()
    }

    downloadedInstallerPath = installerPath
    setUpdateState({
      status: 'downloaded',
      availableVersion: update.version,
      progress: 100,
      message: '업데이트 다운로드가 완료되었습니다. 재시작하면 설치를 진행합니다.',
    })
  })().finally(() => {
    downloadPromise = null
  })

  return downloadPromise
}

async function checkForUpdates(autoDownload: boolean): Promise<UpdateState> {
  if (!isUpdaterEnabled()) {
    return setUpdateState({
      status: 'disabled',
      message: '개발 모드에서는 자동 업데이트 확인을 건너뜁니다.',
    })
  }

  setUpdateState({ status: 'checking', progress: undefined, message: undefined })
  availableUpdate = await fetchLatestRelease()

  if (!availableUpdate) {
    return setUpdateState({
      status: 'not-available',
      availableVersion: undefined,
      progress: undefined,
      message: '최신 버전을 사용 중입니다.',
    })
  }

  setUpdateState({
    status: 'available',
    availableVersion: availableUpdate.version,
    progress: undefined,
    message: '새 버전이 GitHub에 배포되었습니다.',
  })

  if (autoDownload) {
    await downloadUpdate(availableUpdate)
  }

  return { ...updateState }
}

export function registerUpdaterIpcHandlers(): void {
  ipcMain.handle('update:get-state', () => ({ ...updateState }))

  ipcMain.handle('update:check', async () => {
    try {
      return await checkForUpdates(false)
    } catch (error) {
      return setUpdateState({
        status: 'error',
        progress: undefined,
        message: String((error as Error)?.message ?? error),
      })
    }
  })

  ipcMain.handle('update:download', async () => {
    try {
      if (!availableUpdate) await checkForUpdates(false)
      if (!availableUpdate) return { ...updateState }
      await downloadUpdate(availableUpdate)
      return { ...updateState }
    } catch (error) {
      return setUpdateState({
        status: 'error',
        progress: undefined,
        message: String((error as Error)?.message ?? error),
      })
    }
  })

  ipcMain.handle('update:install', () => {
    if (!downloadedInstallerPath) return { ...updateState }
    const child = spawn(downloadedInstallerPath, [], {
      detached: true,
      stdio: 'ignore',
    })
    child.unref()
    app.quit()
    return { ...updateState }
  })
}

export function initializeAutoUpdater(): void {
  if (initialized) return
  initialized = true

  if (!isUpdaterEnabled()) {
    setUpdateState({
      status: 'disabled',
      message: '개발 모드에서는 자동 업데이트 확인을 건너뜁니다.',
    })
    return
  }

  setTimeout(() => {
    checkForUpdates(true).catch((error: Error) => {
      setUpdateState({
        status: 'error',
        progress: undefined,
        message: error.message || '업데이트 확인 중 오류가 발생했습니다.',
      })
    })
  }, 5_000)
}
