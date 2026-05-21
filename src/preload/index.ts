import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  workspace: {
    list: (): Promise<{ id: string; name: string }[]> => ipcRenderer.invoke('ws:list'),
    create: (name: string): Promise<{ id: string; name: string }> => ipcRenderer.invoke('ws:create', name),
    rename: (id: string, name: string): Promise<void> => ipcRenderer.invoke('ws:rename', id, name),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('ws:delete', id)
  },
  environment: {
    list: (workspaceId: string): Promise<unknown[]> => ipcRenderer.invoke('env:list', workspaceId),
    upsert: (workspaceId: string, env: unknown): Promise<void> => ipcRenderer.invoke('env:upsert', workspaceId, env),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('env:delete', id)
  },
  module: {
    list: (): Promise<{ id: string; name: string }[]> => ipcRenderer.invoke('mod:list'),
    create: (name: string): Promise<{ id: string; name: string }> => ipcRenderer.invoke('mod:create', name),
    rename: (id: string, name: string): Promise<void> => ipcRenderer.invoke('mod:rename', id, name),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('mod:delete', id)
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
