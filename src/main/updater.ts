import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { createWriteStream } from 'fs'
import { mkdir, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import { spawn } from 'child_process'
import { once } from 'events'
import { createHash } from 'crypto'
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
  messageKey?: string
  messageVars?: Record<string, string | number | boolean | null | undefined>
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
  checksumUrl: string
  checksumAssetName: string
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

class UpdateError extends Error {
  readonly messageKey: string
  readonly messageVars?: UpdateState['messageVars']

  constructor(messageKey: string, fallbackMessage: string, messageVars?: UpdateState['messageVars']) {
    super(fallbackMessage)
    this.name = 'UpdateError'
    this.messageKey = messageKey
    this.messageVars = messageVars
  }
}

function updateMessage(messageKey: string, fallbackMessage: string, messageVars?: UpdateState['messageVars']): Pick<UpdateState, 'message' | 'messageKey' | 'messageVars'> {
  return { message: fallbackMessage, messageKey, messageVars }
}

function updateError(messageKey: string, fallbackMessage: string, messageVars?: UpdateState['messageVars']): UpdateError {
  return new UpdateError(messageKey, fallbackMessage, messageVars)
}

function updateErrorPayload(error: unknown, fallbackMessageKey = 'topbar.update.message.errorGeneric'): Pick<UpdateState, 'message' | 'messageKey' | 'messageVars'> {
  if (error instanceof UpdateError) {
    return {
      message: error.message,
      messageKey: error.messageKey,
      messageVars: error.messageVars,
    }
  }

  return {
    message: String((error as Error)?.message ?? error),
    messageKey: fallbackMessageKey,
    messageVars: undefined,
  }
}

function sendUpdateState(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('update:status', updateState)
  }
}

function setUpdateState(next: Partial<UpdateState>): UpdateState {
  Object.assign(updateState, next)
  if ('message' in next && next.message === undefined) {
    updateState.messageKey = undefined
    updateState.messageVars = undefined
  }
  if ('messageKey' in next && next.messageKey === undefined) {
    updateState.messageVars = undefined
  }
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

function platformAssetDescription(): string {
  if (process.platform === 'win32') return 'Windows 설치 파일(.exe)'
  if (process.platform === 'darwin') return 'macOS 설치 파일(.dmg 또는 .zip)'
  return '현재 운영체제용 설치 파일'
}

function macAssetScore(name: string): number {
  const normalized = name.toLowerCase()
  const currentArch = process.arch === 'arm64' ? 'arm64' : 'x64'
  const isDmg = normalized.endsWith('.dmg')
  const isZip = normalized.endsWith('.zip')
  const isCurrentArch = normalized.includes(currentArch)
  const isUniversal = normalized.includes('universal')
  const hasAnyArch = normalized.includes('arm64') || normalized.includes('x64')

  if (!isDmg && !isZip) return 0
  if (isCurrentArch && isDmg) return 60
  if (isUniversal && isDmg) return 50
  if (!hasAnyArch && isDmg) return 40
  if (isCurrentArch && isZip) return 30
  if (isUniversal && isZip) return 20
  if (!hasAnyArch && isZip) return 10
  return 0
}

function releaseAsset(release: GitHubRelease): GitHubReleaseAsset | null {
  const assets = release.assets.filter(asset => !asset.name.toLowerCase().endsWith('.blockmap'))

  if (process.platform === 'darwin') {
    return assets
      .map(asset => ({ asset, score: macAssetScore(asset.name) }))
      .filter(candidate => candidate.score > 0)
      .sort((a, b) => b.score - a.score)[0]?.asset ?? null
  }

  if (process.platform !== 'win32') {
    return null
  }

  return assets.find(asset => {
    const name = asset.name.toLowerCase()
    return name.endsWith('.exe') && name.includes('setup')
  }) ?? assets.find(asset => {
    const name = asset.name.toLowerCase()
    return name.endsWith('.exe')
  }) ?? null
}

function releaseChecksumAsset(release: GitHubRelease, assetName: string): GitHubReleaseAsset | null {
  const normalizedAssetName = assetName.toLowerCase()
  const exactNames = new Set([
    `${normalizedAssetName}.sha256`,
    `${normalizedAssetName}.sha256.txt`,
    `${normalizedAssetName}.sha256sum`,
  ])
  const checksumAssets = release.assets.filter(asset => {
    const name = asset.name.toLowerCase()
    return name.endsWith('.sha256') || name.endsWith('.sha256.txt') || name.endsWith('.sha256sum')
  })

  return checksumAssets.find(asset => exactNames.has(asset.name.toLowerCase())) ?? null
}

function parseSha256Checksum(content: string, assetName: string): string {
  const lines = content.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const matchingLine = lines.find(line => line.includes(assetName)) ?? lines[0] ?? ''
  const checksum = matchingLine.match(/\b[a-fA-F0-9]{64}\b/)?.[0]?.toLowerCase()
  if (!checksum) throw updateError('topbar.update.error.invalidChecksum', '업데이트 체크섬 파일이 올바르지 않습니다.')
  return checksum
}

async function fetchExpectedSha256(update: AvailableUpdate): Promise<string> {
  const response = await fetch(update.checksumUrl, {
    headers: {
      'User-Agent': `a8a/${APP_VERSION}`,
    },
  })
  if (!response.ok) {
    throw updateError('topbar.update.error.checksumDownloadFailed', `업데이트 체크섬 다운로드 실패: ${response.status} ${response.statusText}`, {
      status: response.status,
      statusText: response.statusText,
    })
  }
  return parseSha256Checksum(await response.text(), update.assetName)
}

async function fetchLatestRelease(): Promise<AvailableUpdate | null> {
  const repository = configuredRepository()
  if (!repository) {
    setUpdateState({
      status: 'disabled',
      ...updateMessage('topbar.update.message.disabledRepo', '업데이트를 확인할 GitHub 저장소가 설정되지 않았습니다.'),
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
      ...updateMessage('topbar.update.message.notFound', '배포된 GitHub 릴리스를 찾지 못했습니다.'),
    })
    return null
  }

  if (!response.ok) {
    throw updateError('topbar.update.error.checkFailed', `GitHub 업데이트 확인 실패: ${response.status} ${response.statusText}`, {
      status: response.status,
      statusText: response.statusText,
    })
  }

  const release = await response.json() as GitHubRelease
  if (release.draft || release.prerelease) return null

  const version = extractDateVersion(release.tag_name) ?? extractDateVersion(release.name)
  if (!version || !isNewerVersion(version, APP_VERSION)) return null

  const asset = releaseAsset(release)
  if (!asset) {
    throw updateError('topbar.update.error.missingAsset', `새 릴리스에 ${platformAssetDescription()}이 없습니다.`)
  }
  const checksumAsset = releaseChecksumAsset(release, asset.name)
  if (!checksumAsset) {
    throw updateError('topbar.update.error.missingChecksum', `새 릴리스에 ${asset.name} 체크섬 파일(.sha256)이 없습니다.`, {
      assetName: asset.name,
    })
  }

  return {
    version,
    downloadUrl: asset.browser_download_url,
    assetName: asset.name,
    checksumUrl: checksumAsset.browser_download_url,
    checksumAssetName: checksumAsset.name,
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
      ...updateMessage('topbar.update.message.downloading', 'GitHub에서 업데이트 설치 파일을 다운로드하고 있습니다.'),
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
      throw updateError('topbar.update.error.downloadFailed', `업데이트 다운로드 실패: ${response.status} ${response.statusText}`, {
        status: response.status,
        statusText: response.statusText,
      })
    }

    const total = Number(response.headers.get('content-length') ?? update.size)
    let received = 0
    const expectedSha256 = await fetchExpectedSha256(update)
    const hash = createHash('sha256')
    const writer = createWriteStream(installerPath)
    const reader = response.body.getReader()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        received += value.length
        hash.update(value)
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

    const actualSha256 = hash.digest('hex').toLowerCase()
    if (actualSha256 !== expectedSha256) {
      await unlink(installerPath).catch(() => {})
      throw updateError('topbar.update.error.checksumMismatch', '업데이트 파일 체크섬이 일치하지 않습니다. 다운로드한 파일을 삭제했습니다.')
    }

    downloadedInstallerPath = installerPath
    setUpdateState({
      status: 'downloaded',
      availableVersion: update.version,
      progress: 100,
      ...(process.platform === 'darwin'
        ? updateMessage('topbar.update.message.downloadedMac', '업데이트 다운로드가 완료되었습니다. 적용하면 macOS 설치 파일을 엽니다.')
        : updateMessage('topbar.update.message.downloadedWin', '업데이트 다운로드가 완료되었습니다. 재시작하면 설치를 진행합니다.')),
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
      ...updateMessage('topbar.update.message.disabledDev', '개발 모드에서는 자동 업데이트 확인을 건너뜁니다.'),
    })
  }

  setUpdateState({ status: 'checking', progress: undefined, message: undefined, messageKey: undefined, messageVars: undefined })
  availableUpdate = await fetchLatestRelease()

  if (!availableUpdate) {
    return setUpdateState({
      status: 'not-available',
      availableVersion: undefined,
      progress: undefined,
      ...updateMessage('topbar.update.message.latest', '최신 버전을 사용 중입니다.'),
    })
  }

  setUpdateState({
    status: 'available',
    availableVersion: availableUpdate.version,
    progress: undefined,
    ...updateMessage('topbar.update.message.available', '새 버전이 GitHub에 배포되었습니다.'),
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
        ...updateErrorPayload(error),
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
        ...updateErrorPayload(error),
      })
    }
  })

  ipcMain.handle('update:install', async () => {
    if (!downloadedInstallerPath) return { ...updateState }
    if (process.platform === 'darwin') {
      const errorMessage = await shell.openPath(downloadedInstallerPath)
      if (errorMessage) throw new Error(errorMessage)
      return setUpdateState({
        status: 'downloaded',
        ...updateMessage('topbar.update.message.macInstallerOpened', 'macOS 설치 파일을 열었습니다. a8a를 종료한 뒤 새 앱으로 교체하세요.'),
      })
    }

    if (process.platform !== 'win32') {
      const errorMessage = await shell.openPath(downloadedInstallerPath)
      if (errorMessage) throw new Error(errorMessage)
      return setUpdateState({
        status: 'downloaded',
        ...updateMessage('topbar.update.message.installerOpened', '설치 파일을 열었습니다.'),
      })
    }

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
      ...updateMessage('topbar.update.message.disabledDev', '개발 모드에서는 자동 업데이트 확인을 건너뜁니다.'),
    })
    return
  }

  setTimeout(() => {
    checkForUpdates(true).catch((error: Error) => {
      setUpdateState({
        status: 'error',
        progress: undefined,
        ...updateErrorPayload(error),
      })
    })
  }, 5_000)
}
