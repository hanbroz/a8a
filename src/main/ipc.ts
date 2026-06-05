import { ipcMain, app, dialog, BrowserWindow, shell } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'path'
import * as db from './db'
import type { EnvRow } from './db'

const allowedWriteDirs = new Set<string>()
const httpFetchControllersByRunId = new Map<string, Set<AbortController>>()
let httpFetchExclusiveQueue: Promise<void> = Promise.resolve()

async function runExclusiveHttpFetch<T>(task: () => Promise<T>): Promise<T> {
  const previous = httpFetchExclusiveQueue
  let release!: () => void
  httpFetchExclusiveQueue = new Promise<void>(resolve => {
    release = resolve
  })
  await previous
  try {
    return await task()
  } finally {
    release()
  }
}

function registerHttpFetchController(runId: string | undefined, controller: AbortController): void {
  if (!runId) return
  const controllers = httpFetchControllersByRunId.get(runId) ?? new Set<AbortController>()
  controllers.add(controller)
  httpFetchControllersByRunId.set(runId, controllers)
}

function unregisterHttpFetchController(runId: string | undefined, controller: AbortController): void {
  if (!runId) return
  const controllers = httpFetchControllersByRunId.get(runId)
  if (!controllers) return
  controllers.delete(controller)
  if (controllers.size === 0) httpFetchControllersByRunId.delete(runId)
}

function normalizePath(path: string): string {
  return resolve(path)
}

function isInsideDir(filePath: string, dirPath: string): boolean {
  const rel = relative(normalizePath(dirPath), normalizePath(filePath))
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel))
}

function rememberWriteDir(path: string): void {
  allowedWriteDirs.add(normalizePath(path))
}

function safeExportFilePart(value: string): string {
  const cleaned = value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
  return cleaned || 'a8a'
}

function isKoreanLanguage(language?: string): boolean {
  if (language === 'ko') return true
  if (language === 'en') return false
  return app.getLocale().toLowerCase().startsWith('ko')
}

function transferDialogTitle(kind: 'export' | 'import', language?: string): string {
  if (kind === 'export') return isKoreanLanguage(language) ? 'a8a 내보내기' : 'Export a8a'
  return isKoreanLanguage(language) ? 'a8a 가져오기' : 'Import a8a'
}

type IpcTextKey =
  | 'reportExtension'
  | 'writePathDenied'
  | 'xlsxFileName'
  | 'xlsxExtension'
  | 'xlsxParse'
  | 'xlsxSize'
  | 'downloadsOnly'
  | 'openReportExtension'
  | 'openPathDenied'

function ipcText(language: string | undefined, key: IpcTextKey): string {
  const ko = isKoreanLanguage(language)
  switch (key) {
    case 'reportExtension':
      return ko ? '리포트 파일은 .html 또는 .md 확장자만 저장할 수 있습니다.' : 'Report files can only be saved with .html or .md extensions.'
    case 'writePathDenied':
      return ko ? '선택한 저장 경로 또는 다운로드 폴더 안에만 저장할 수 있습니다.' : 'Files can only be saved inside the selected save path or downloads folder.'
    case 'xlsxFileName':
      return ko ? 'Excel 파일명만 지정할 수 있습니다.' : 'Only an Excel file name can be specified.'
    case 'xlsxExtension':
      return ko ? 'Excel 파일은 .xlsx 확장자만 저장할 수 있습니다.' : 'Excel files can only be saved with the .xlsx extension.'
    case 'xlsxParse':
      return ko ? 'Excel 파일 내용을 해석할 수 없습니다.' : 'The Excel file content could not be parsed.'
    case 'xlsxSize':
      return ko ? 'Excel 파일 크기가 허용 범위를 벗어났습니다.' : 'The Excel file size is outside the allowed range.'
    case 'downloadsOnly':
      return ko ? '다운로드 폴더 안에만 저장할 수 있습니다.' : 'Files can only be saved inside the downloads folder.'
    case 'openReportExtension':
      return ko ? '리포트 파일은 .html 또는 .md 확장자만 열 수 있습니다.' : 'Only .html or .md report files can be opened.'
    case 'openPathDenied':
      return ko ? '저장이 허용된 경로의 리포트만 열 수 있습니다.' : 'Only reports in an allowed save path can be opened.'
  }
}

async function saveTransferPayload(
  sender: Electron.WebContents,
  payload: db.TransferPayload,
  defaultName: string,
  language?: string,
): Promise<{ ok: true; path: string } | { ok: false; canceled?: boolean; error?: string }> {
  try {
    const win = BrowserWindow.fromWebContents(sender)
    const defaultPath = join(app.getPath('downloads'), `${safeExportFilePart(defaultName)}.json`)
    const opts: Electron.SaveDialogOptions = {
      title: transferDialogTitle('export', language),
      defaultPath,
      filters: [{ name: 'a8a Export JSON', extensions: ['json'] }],
    }
    const result = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (result.canceled || !result.filePath) return { ok: false, canceled: true }
    const targetPath = normalizePath(result.filePath)
    await writeFile(targetPath, JSON.stringify(payload, null, 2), 'utf-8')
    rememberWriteDir(dirname(targetPath))
    return { ok: true, path: targetPath }
  } catch (err) {
    return { ok: false, error: String((err as Error)?.message ?? err) }
  }
}

async function openTransferPayload(
  sender: Electron.WebContents,
  language?: string,
): Promise<{ ok: true; payload: unknown } | { ok: false; canceled?: boolean; error?: string }> {
  try {
    const win = BrowserWindow.fromWebContents(sender)
    const opts: Electron.OpenDialogOptions = {
      title: transferDialogTitle('import', language),
      properties: ['openFile'],
      filters: [{ name: 'a8a Export JSON', extensions: ['json'] }],
    }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true }
    const sourcePath = normalizePath(result.filePaths[0])
    const content = await readFile(sourcePath, 'utf-8')
    return { ok: true, payload: JSON.parse(content) as unknown }
  } catch (err) {
    return { ok: false, error: String((err as Error)?.message ?? err) }
  }
}

export function registerIpcHandlers(): void {
  rememberWriteDir(app.getPath('downloads'))

  // ── Workspace ──
  ipcMain.handle('ws:list', () => db.listWorkspaces())
  ipcMain.handle('ws:create', (_, name: string, description: string) => db.createWorkspace(name, description))
  ipcMain.handle('ws:update', (_, id: string, name: string, description: string) => db.updateWorkspace(id, name, description))
  ipcMain.handle('ws:delete', (_, id: string) => db.deleteWorkspace(id))

  // ── Environment ──
  ipcMain.handle('env:list', (_, workspaceId: string) => db.listEnvironments(workspaceId))
  ipcMain.handle('env:upsert', (_, workspaceId: string, env: EnvRow) => db.upsertEnvironment(workspaceId, env))
  ipcMain.handle('env:delete', (_, id: string) => db.deleteEnvironment(id))

  // ── Project ──
  ipcMain.handle('proj:list', (_, workspaceId: string) => db.listProjects(workspaceId))
  ipcMain.handle('proj:create', (_, workspaceId: string, name: string, description: string) => db.createProject(workspaceId, name, description))
  ipcMain.handle('proj:update', (_, id: string, name: string, description: string) => db.updateProject(id, name, description))
  ipcMain.handle('proj:delete', (_, id: string) => db.deleteProject(id))
  ipcMain.handle('proj:duplicate', (_, id: string, name: string) => db.duplicateProject(id, name))
  ipcMain.handle('proj:reorder', (_, workspaceId: string, orderedIds: string[]) => db.reorderProjects(workspaceId, orderedIds))
  ipcMain.handle('proj:replace-canvas', (_, id: string, nodes: db.NodeRow[], edges: db.EdgeRow[]) => db.replaceProjectCanvas(id, nodes, edges))

  // ── Module ──
  ipcMain.handle('mod:list', (_, workspaceId: string) => db.listModules(workspaceId))
  ipcMain.handle('mod:list-all', () => db.listAllModules())
  ipcMain.handle('mod:create-common', (_, type: string, label: string, config: string) => db.createCommonModule(type, label, config))
  ipcMain.handle('mod:create', (_, workspaceId: string, type: string, label: string, config: string) => db.createModule(workspaceId, type, label, config))
  ipcMain.handle('mod:update', (_, id: string, label: string, config: string) => db.updateModule(id, label, config))
  ipcMain.handle('mod:set-common', (_, id: string, isCommon: boolean, workspaceId: string) => db.setModuleCommon(id, isCommon, workspaceId))
  ipcMain.handle('mod:reorder-common', (_, type: string, orderedIds: string[]) => db.reorderCommonModules(type, orderedIds))
  ipcMain.handle('mod:delete', (_, id: string) => db.deleteModule(id))

  // ── Node ──
  ipcMain.handle('node:list', (_, projectId: string) => db.listNodes(projectId))
  ipcMain.handle('node:create', (_, projectId: string, type: string, label: string, x: number, y: number) => db.createNode(projectId, type, label, x, y))
  ipcMain.handle('node:create-from-module', (_, projectId: string, moduleId: string, x: number, y: number) => db.createNodeFromModule(projectId, moduleId, x, y))
  ipcMain.handle('node:update-position', (_, id: string, x: number, y: number) => db.updateNodePosition(id, x, y))
  ipcMain.handle('node:update-size', (_, id: string, width: number, height: number) => db.updateNodeSize(id, width, height))
  ipcMain.handle('node:update-label', (_, id: string, label: string) => db.updateNodeLabel(id, label))
  ipcMain.handle('node:update-config', (_, id: string, config: string) => db.updateNodeConfig(id, config))
  ipcMain.handle('node:delete', (_, id: string) => db.deleteNode(id))

  // ── Edge ──
  ipcMain.handle('edge:list', (_, projectId: string) => db.listEdges(projectId))
  ipcMain.handle('edge:create', (_, projectId: string, sourceNodeId: string, targetNodeId: string, sourcePort?: string | null) => db.createEdge(projectId, sourceNodeId, targetNodeId, sourcePort))
  ipcMain.handle('edge:delete', (_, id: string) => db.deleteEdge(id))

  // ── Import / Export ──
  ipcMain.handle('transfer:export-workspace', async (e, workspaceId: string, language?: string) => {
    const payload = db.exportWorkspaceData(workspaceId)
    const workspaceName = payload.workspace?.name ?? 'workspace'
    return saveTransferPayload(e.sender, payload, `a8a_workspace_${workspaceName}`, language)
  })
  ipcMain.handle('transfer:export-project', async (e, projectId: string, language?: string) => {
    const payload = db.exportProjectData(projectId)
    const projectName = payload.project?.name ?? 'project'
    return saveTransferPayload(e.sender, payload, `a8a_project_${projectName}`, language)
  })
  ipcMain.handle('transfer:import-workspace', async (e, language?: string) => {
    const opened = await openTransferPayload(e.sender, language)
    if (!opened.ok) return opened
    try {
      return { ok: true as const, result: db.importWorkspaceData(opened.payload) }
    } catch (err) {
      return { ok: false as const, error: String((err as Error)?.message ?? err) }
    }
  })
  ipcMain.handle('transfer:import-project', async (e, workspaceId: string, language?: string) => {
    const opened = await openTransferPayload(e.sender, language)
    if (!opened.ok) return opened
    try {
      return { ok: true as const, result: db.importProjectData(workspaceId, opened.payload) }
    } catch (err) {
      return { ok: false as const, error: String((err as Error)?.message ?? err) }
    }
  })

  // ── HTTP Fetch (CORS-free via main process) ──
  ipcMain.handle('http:fetch', async (_, url: string, options: { method: string; headers: Record<string, string>; body?: string; runId?: string }) => {
    // 타임아웃(30초)으로 무한 대기를 막고, 실패는 throw 대신 ok:false로 돌려준다.
    // (IPC 경계 밖으로 throw하면 렌더러에 불투명한 "remote method" 에러로 전달됨)
    const controller = new AbortController()
    registerHttpFetchController(options.runId, controller)
    return runExclusiveHttpFetch(async () => {
      const timeout = setTimeout(() => {
        controller.abort()
      }, 30_000)
      try {
        const res = await fetch(url, {
          method: options.method,
          headers: options.headers,
          body: options.body,
          signal: controller.signal,
        })
        const text = await res.text()
        return { status: res.status, statusText: res.statusText, text, ok: res.ok }
      } catch (err) {
        const message = (err as Error)?.name === 'AbortError'
          ? '요청 시간 초과 (30초)'
          : String((err as Error)?.message ?? err)
        return { status: 0, statusText: message, text: '', ok: false }
      } finally {
        clearTimeout(timeout)
        unregisterHttpFetchController(options.runId, controller)
      }
    })
  })

  ipcMain.handle('http:cancel-run', (_, runId: string) => {
    const controllers = httpFetchControllersByRunId.get(runId)
    if (!controllers) return
    controllers.forEach(controller => controller.abort())
    httpFetchControllersByRunId.delete(runId)
  })

  // ── Dialog (folder picker) ──
  ipcMain.handle('dialog:open-directory', async (e, defaultPath?: string): Promise<string | null> => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts: Electron.OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'] }
    if (defaultPath) opts.defaultPath = defaultPath
    const r = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts)
    if (r.canceled || r.filePaths.length === 0) return null
    rememberWriteDir(r.filePaths[0])
    return r.filePaths[0]
  })

  // ── File write ──
  ipcMain.handle('file:write', async (_, path: string, content: string, language?: string) => {
    try {
      const targetPath = normalizePath(path)
      const ext = extname(targetPath).toLowerCase()
      if (ext !== '.html' && ext !== '.md') {
        return { ok: false as const, error: ipcText(language, 'reportExtension') }
      }
      const targetDir = dirname(targetPath)
      const allowed = Array.from(allowedWriteDirs).some(dir => isInsideDir(targetDir, dir))
      if (!allowed) {
        return { ok: false as const, error: ipcText(language, 'writePathDenied') }
      }
      await writeFile(targetPath, content, 'utf-8')
      return { ok: true as const, path: targetPath }
    } catch (err) {
      return { ok: false as const, error: String((err as Error)?.message ?? err) }
    }
  })

  ipcMain.handle('file:write-xlsx-download', async (_, fileName: string, base64Content: string, language?: string) => {
    try {
      const requestedName = String(fileName ?? '')
      const safeName = basename(requestedName)
      if (!safeName || safeName !== requestedName || requestedName.includes('\0')) {
        return { ok: false as const, error: ipcText(language, 'xlsxFileName') }
      }
      const ext = extname(safeName).toLowerCase()
      if (ext !== '.xlsx') {
        return { ok: false as const, error: ipcText(language, 'xlsxExtension') }
      }
      if (typeof base64Content !== 'string' || !/^[A-Za-z0-9+/=\s]+$/.test(base64Content)) {
        return { ok: false as const, error: ipcText(language, 'xlsxParse') }
      }
      const buffer = Buffer.from(base64Content, 'base64')
      if (buffer.length === 0 || buffer.length > 100 * 1024 * 1024) {
        return { ok: false as const, error: ipcText(language, 'xlsxSize') }
      }
      const targetPath = normalizePath(join(app.getPath('downloads'), safeName))
      if (!isInsideDir(targetPath, app.getPath('downloads'))) {
        return { ok: false as const, error: ipcText(language, 'downloadsOnly') }
      }
      await writeFile(targetPath, buffer, { flag: 'wx' })
      return { ok: true as const, path: targetPath }
    } catch (err) {
      return { ok: false as const, error: String((err as Error)?.message ?? err) }
    }
  })

  ipcMain.handle('file:open', async (_, path: string, language?: string) => {
    try {
      const targetPath = normalizePath(path)
      const ext = extname(targetPath).toLowerCase()
      if (ext !== '.html' && ext !== '.md') {
        return { ok: false as const, error: ipcText(language, 'openReportExtension') }
      }
      const allowed = Array.from(allowedWriteDirs).some(dir => isInsideDir(targetPath, dir))
      if (!allowed) {
        return { ok: false as const, error: ipcText(language, 'openPathDenied') }
      }
      const error = await shell.openPath(targetPath)
      if (error) return { ok: false as const, error }
      return { ok: true as const }
    } catch (err) {
      return { ok: false as const, error: String((err as Error)?.message ?? err) }
    }
  })

  ipcMain.handle('file:downloads-dir', (): string => app.getPath('downloads'))
}
