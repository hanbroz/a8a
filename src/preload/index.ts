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
    list: (): Promise<{ id: string; name: string }[]> => ipcRenderer.invoke('mod:list'),
    create: (name: string): Promise<{ id: string; name: string }> => ipcRenderer.invoke('mod:create', name),
    rename: (id: string, name: string): Promise<void> => ipcRenderer.invoke('mod:rename', id, name),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('mod:delete', id)
  },
  node: {
    list: (projectId: string): Promise<{ id: string; projectId: string; type: string; label: string; x: number; y: number }[]> => ipcRenderer.invoke('node:list', projectId),
    updatePosition: (id: string, x: number, y: number): Promise<void> => ipcRenderer.invoke('node:update-position', id, x, y),
    updateConfig: (id: string, config: string): Promise<void> => ipcRenderer.invoke('node:update-config', id, config)
  },
  edge: {
    list: (projectId: string): Promise<{ id: string; projectId: string; sourceNodeId: string; targetNodeId: string }[]> => ipcRenderer.invoke('edge:list', projectId),
    create: (projectId: string, sourceNodeId: string, targetNodeId: string): Promise<{ id: string; projectId: string; sourceNodeId: string; targetNodeId: string }> => ipcRenderer.invoke('edge:create', projectId, sourceNodeId, targetNodeId),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('edge:delete', id)
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
