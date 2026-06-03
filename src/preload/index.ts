import { contextBridge, ipcRenderer } from 'electron'

const api = {
  dialog: {
    openDirectory: (defaultPath?: string): Promise<string | null> => ipcRenderer.invoke('dialog:open-directory', defaultPath)
  },
  file: {
    write: (path: string, content: string): Promise<{ ok: true; path: string } | { ok: false; error: string }> =>
      ipcRenderer.invoke('file:write', path, content),
    writeXlsxDownload: (fileName: string, base64Content: string): Promise<{ ok: true; path: string } | { ok: false; error: string }> =>
      ipcRenderer.invoke('file:write-xlsx-download', fileName, base64Content),
    open: (path: string): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke('file:open', path),
    downloadsDir: (): Promise<string> => ipcRenderer.invoke('file:downloads-dir')
  },
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
    delete: (id: string): Promise<void> => ipcRenderer.invoke('proj:delete', id),
    duplicate: (id: string, name: string): Promise<unknown> => ipcRenderer.invoke('proj:duplicate', id, name),
    reorder: (workspaceId: string, orderedIds: string[]): Promise<void> => ipcRenderer.invoke('proj:reorder', workspaceId, orderedIds),
    replaceCanvas: (id: string, nodes: ApiNode[], edges: ApiEdge[]): Promise<void> => ipcRenderer.invoke('proj:replace-canvas', id, nodes, edges)
  },
  module: {
    list: (workspaceId: string): Promise<ApiModule[]> => ipcRenderer.invoke('mod:list', workspaceId),
    listAll: (): Promise<ApiModule[]> => ipcRenderer.invoke('mod:list-all'),
    createCommon: (type: string, label: string, config: string): Promise<ApiModule> => ipcRenderer.invoke('mod:create-common', type, label, config),
    create: (workspaceId: string, type: string, label: string, config: string): Promise<ApiModule> => ipcRenderer.invoke('mod:create', workspaceId, type, label, config),
    update: (id: string, label: string, config: string): Promise<void> => ipcRenderer.invoke('mod:update', id, label, config),
    setCommon: (id: string, isCommon: boolean, workspaceId: string): Promise<void> => ipcRenderer.invoke('mod:set-common', id, isCommon, workspaceId),
    reorderCommon: (type: string, orderedIds: string[]): Promise<void> => ipcRenderer.invoke('mod:reorder-common', type, orderedIds),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('mod:delete', id)
  },
  node: {
    list: (projectId: string): Promise<ApiNode[]> => ipcRenderer.invoke('node:list', projectId),
    create: (projectId: string, type: string, label: string, x: number, y: number): Promise<ApiNode> => ipcRenderer.invoke('node:create', projectId, type, label, x, y),
    createFromModule: (projectId: string, moduleId: string, x: number, y: number): Promise<ApiNode> => ipcRenderer.invoke('node:create-from-module', projectId, moduleId, x, y),
    updatePosition: (id: string, x: number, y: number): Promise<void> => ipcRenderer.invoke('node:update-position', id, x, y),
    updateSize: (id: string, width: number, height: number): Promise<void> => ipcRenderer.invoke('node:update-size', id, width, height),
    updateLabel: (id: string, label: string): Promise<void> => ipcRenderer.invoke('node:update-label', id, label),
    updateConfig: (id: string, config: string): Promise<void> => ipcRenderer.invoke('node:update-config', id, config),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('node:delete', id)
  },
  edge: {
    list: (projectId: string): Promise<{ id: string; projectId: string; sourceNodeId: string; targetNodeId: string }[]> => ipcRenderer.invoke('edge:list', projectId),
    create: (projectId: string, sourceNodeId: string, targetNodeId: string, sourcePort?: string | null): Promise<ApiEdge> => ipcRenderer.invoke('edge:create', projectId, sourceNodeId, targetNodeId, sourcePort),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('edge:delete', id)
  },
  transfer: {
    exportWorkspace: (workspaceId: string): Promise<A8aTransferFileResult> => ipcRenderer.invoke('transfer:export-workspace', workspaceId),
    exportProject: (projectId: string): Promise<A8aTransferFileResult> => ipcRenderer.invoke('transfer:export-project', projectId),
    importWorkspace: (): Promise<A8aTransferImportResult> => ipcRenderer.invoke('transfer:import-workspace'),
    importProject: (workspaceId: string): Promise<A8aTransferImportResult> => ipcRenderer.invoke('transfer:import-project', workspaceId)
  },
  http: {
    fetch: (url: string, options: { method: string; headers: Record<string, string>; body?: string }): Promise<{ status: number; statusText: string; text: string; ok: boolean }> =>
      ipcRenderer.invoke('http:fetch', url, options)
  },
  update: {
    getState: (): Promise<AppUpdateState> => ipcRenderer.invoke('update:get-state'),
    check: (): Promise<AppUpdateState> => ipcRenderer.invoke('update:check'),
    download: (): Promise<AppUpdateState> => ipcRenderer.invoke('update:download'),
    install: (): Promise<AppUpdateState> => ipcRenderer.invoke('update:install'),
    onStatus: (listener: (state: AppUpdateState) => void): (() => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, state: AppUpdateState): void => listener(state)
      ipcRenderer.on('update:status', wrapped)
      return () => ipcRenderer.removeListener('update:status', wrapped)
    }
  }
}

if (!process.contextIsolated) {
  throw new Error('BrowserWindow contextIsolation must be enabled.')
}

contextBridge.exposeInMainWorld('api', api)
