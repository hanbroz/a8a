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
  ipcMain.handle('mod:list', (_, workspaceId: string) => db.listModules(workspaceId))
  ipcMain.handle('mod:list-all', () => db.listAllModules())
  ipcMain.handle('mod:create-common', (_, type: string, label: string, config: string) => db.createCommonModule(type, label, config))
  ipcMain.handle('mod:create', (_, workspaceId: string, type: string, label: string, config: string) => db.createModule(workspaceId, type, label, config))
  ipcMain.handle('mod:update', (_, id: string, label: string, config: string) => db.updateModule(id, label, config))
  ipcMain.handle('mod:set-common', (_, id: string, isCommon: boolean, workspaceId: string) => db.setModuleCommon(id, isCommon, workspaceId))
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
  ipcMain.handle('edge:create', (_, projectId: string, sourceNodeId: string, targetNodeId: string) => db.createEdge(projectId, sourceNodeId, targetNodeId))
  ipcMain.handle('edge:delete', (_, id: string) => db.deleteEdge(id))
}
