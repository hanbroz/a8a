import { ipcMain } from 'electron'
import * as db from './db'
import type { EnvRow } from './db'

export function registerIpcHandlers(): void {
  // ── Workspace ──
  ipcMain.handle('ws:list', () => db.listWorkspaces())
  ipcMain.handle('ws:create', (_, name: string) => db.createWorkspace(name))
  ipcMain.handle('ws:rename', (_, id: string, name: string) => db.renameWorkspace(id, name))
  ipcMain.handle('ws:delete', (_, id: string) => db.deleteWorkspace(id))

  // ── Environment ──
  ipcMain.handle('env:list', (_, workspaceId: string) => db.listEnvironments(workspaceId))
  ipcMain.handle('env:upsert', (_, workspaceId: string, env: EnvRow) => db.upsertEnvironment(workspaceId, env))
  ipcMain.handle('env:delete', (_, id: string) => db.deleteEnvironment(id))

  // ── Module ──
  ipcMain.handle('mod:list', () => db.listModules())
  ipcMain.handle('mod:create', (_, name: string) => db.createModule(name))
  ipcMain.handle('mod:rename', (_, id: string, name: string) => db.renameModule(id, name))
  ipcMain.handle('mod:delete', (_, id: string) => db.deleteModule(id))
}
