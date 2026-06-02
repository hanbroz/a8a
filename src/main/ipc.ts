import { ipcMain, app, dialog, BrowserWindow, shell } from 'electron'
import { writeFile } from 'fs/promises'
import { dirname, extname, isAbsolute, relative, resolve } from 'path'
import * as db from './db'
import type { EnvRow } from './db'

const allowedWriteDirs = new Set<string>()

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
  ipcMain.handle('proj:reorder', (_, workspaceId: string, orderedIds: string[]) => db.reorderProjects(workspaceId, orderedIds))

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
  ipcMain.handle('node:update-label', (_, id: string, label: string) => db.updateNodeLabel(id, label))
  ipcMain.handle('node:update-config', (_, id: string, config: string) => db.updateNodeConfig(id, config))
  ipcMain.handle('node:delete', (_, id: string) => db.deleteNode(id))

  // ── Edge ──
  ipcMain.handle('edge:list', (_, projectId: string) => db.listEdges(projectId))
  ipcMain.handle('edge:create', (_, projectId: string, sourceNodeId: string, targetNodeId: string, sourcePort?: string | null) => db.createEdge(projectId, sourceNodeId, targetNodeId, sourcePort))
  ipcMain.handle('edge:delete', (_, id: string) => db.deleteEdge(id))

  // ── HTTP Fetch (CORS-free via main process) ──
  ipcMain.handle('http:fetch', async (_, url: string, options: { method: string; headers: Record<string, string>; body?: string }) => {
    // 타임아웃(30초)으로 무한 대기를 막고, 실패는 throw 대신 ok:false로 돌려준다.
    // (IPC 경계 밖으로 throw하면 렌더러에 불투명한 "remote method" 에러로 전달됨)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30_000)
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
    }
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
  ipcMain.handle('file:write', async (_, path: string, content: string) => {
    try {
      const targetPath = normalizePath(path)
      const ext = extname(targetPath).toLowerCase()
      if (ext !== '.html' && ext !== '.md') {
        return { ok: false as const, error: '리포트 파일은 .html 또는 .md 확장자만 저장할 수 있습니다.' }
      }
      const targetDir = dirname(targetPath)
      const allowed = Array.from(allowedWriteDirs).some(dir => isInsideDir(targetDir, dir))
      if (!allowed) {
        return { ok: false as const, error: '선택한 저장 경로 또는 다운로드 폴더 안에만 저장할 수 있습니다.' }
      }
      await writeFile(targetPath, content, 'utf-8')
      return { ok: true as const, path: targetPath }
    } catch (err) {
      return { ok: false as const, error: String((err as Error)?.message ?? err) }
    }
  })

  ipcMain.handle('file:open', async (_, path: string) => {
    try {
      const targetPath = normalizePath(path)
      const ext = extname(targetPath).toLowerCase()
      if (ext !== '.html' && ext !== '.md') {
        return { ok: false as const, error: '리포트 파일은 .html 또는 .md 확장자만 열 수 있습니다.' }
      }
      const allowed = Array.from(allowedWriteDirs).some(dir => isInsideDir(targetPath, dir))
      if (!allowed) {
        return { ok: false as const, error: '저장이 허용된 경로의 리포트만 열 수 있습니다.' }
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
