import { ipcMain } from 'electron'
import * as db from './db'
import type { EnvRow } from './db'

export function registerIpcHandlers(): void {
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

  // ── Module ──
  ipcMain.handle('mod:list', () => db.listModules())
  ipcMain.handle('mod:create', (_, name: string) => db.createModule(name))
  ipcMain.handle('mod:rename', (_, id: string, name: string) => db.renameModule(id, name))
  ipcMain.handle('mod:delete', (_, id: string) => db.deleteModule(id))

  // ── Node ──
  ipcMain.handle('node:list', (_, projectId: string) => db.listNodes(projectId))
  ipcMain.handle('node:update-position', (_, id: string, x: number, y: number) => db.updateNodePosition(id, x, y))
  ipcMain.handle('node:update-config', (_, id: string, config: string) => db.updateNodeConfig(id, config))

  // ── Edge ──
  ipcMain.handle('edge:list', (_, projectId: string) => db.listEdges(projectId))
  ipcMain.handle('edge:create', (_, projectId: string, sourceNodeId: string, targetNodeId: string) => db.createEdge(projectId, sourceNodeId, targetNodeId))
  ipcMain.handle('edge:delete', (_, id: string) => db.deleteEdge(id))
}
