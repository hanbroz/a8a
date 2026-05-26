import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  workspace: {
    list: (): Promise<{ id: string; name: string; description: string }[]> => ipcRenderer.invoke('ws:list'),
    create: (name: string, description: string): Promise<{ id: string; name: string; description: string }> => ipcRenderer.invoke('ws:create', name, description),
    update: (id: string, name: string, description: string): Promise<void> => ipcRenderer.invoke('ws:update', id, name, description),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('ws:delete', id)
  },
  environment: {
    list: (workspaceId: string): Promise<unknown[]> => ipcRenderer.invoke('env:list', workspaceId),
    upsert: (workspaceId: string, env: unknown): Promise<void> => ipcRenderer.invoke('env:upsert', workspaceId, env),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('env:delete', id)
  },
  project: {
    list: (workspaceId: string): Promise<unknown[]> => ipcRenderer.invoke('proj:list', workspaceId),
    create: (workspaceId: string, name: string, description: string): Promise<unknown> => ipcRenderer.invoke('proj:create', workspaceId, name, description),
    update: (id: string, name: string, description: string): Promise<void> => ipcRenderer.invoke('proj:update', id, name, description),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('proj:delete', id)
  },
  module: {
    list: (workspaceId: string): Promise<ApiModule[]> => ipcRenderer.invoke('mod:list', workspaceId),
    listAll: (): Promise<ApiModule[]> => ipcRenderer.invoke('mod:list-all'),
    createCommon: (type: string, label: string, config: string): Promise<ApiModule> => ipcRenderer.invoke('mod:create-common', type, label, config),
    create: (workspaceId: string, type: string, label: string, config: string): Promise<ApiModule> => ipcRenderer.invoke('mod:create', workspaceId, type, label, config),
    update: (id: string, label: string, config: string): Promise<void> => ipcRenderer.invoke('mod:update', id, label, config),
    setCommon: (id: string, isCommon: boolean, workspaceId: string): Promise<void> => ipcRenderer.invoke('mod:set-common', id, isCommon, workspaceId),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('mod:delete', id)
  },
  node: {
    list: (projectId: string): Promise<ApiNode[]> => ipcRenderer.invoke('node:list', projectId),
    create: (projectId: string, type: string, label: string, x: number, y: number): Promise<ApiNode> => ipcRenderer.invoke('node:create', projectId, type, label, x, y),
    createFromModule: (projectId: string, moduleId: string, x: number, y: number): Promise<ApiNode> => ipcRenderer.invoke('node:create-from-module', projectId, moduleId, x, y),
    updatePosition: (id: string, x: number, y: number): Promise<void> => ipcRenderer.invoke('node:update-position', id, x, y),
    updateLabel: (id: string, label: string): Promise<void> => ipcRenderer.invoke('node:update-label', id, label),
    updateConfig: (id: string, config: string): Promise<void> => ipcRenderer.invoke('node:update-config', id, config),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('node:delete', id)
  },
  edge: {
    list: (projectId: string): Promise<{ id: string; projectId: string; sourceNodeId: string; targetNodeId: string }[]> => ipcRenderer.invoke('edge:list', projectId),
    create: (projectId: string, sourceNodeId: string, targetNodeId: string): Promise<{ id: string; projectId: string; sourceNodeId: string; targetNodeId: string }> => ipcRenderer.invoke('edge:create', projectId, sourceNodeId, targetNodeId),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('edge:delete', id)
  },
  http: {
    fetch: (url: string, options: { method: string; headers: Record<string, string>; body?: string }): Promise<{ status: number; statusText: string; text: string; ok: boolean }> =>
      ipcRenderer.invoke('http:fetch', url, options)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.electron = electronAPI
  // @ts-ignore
  window.api = api
}
