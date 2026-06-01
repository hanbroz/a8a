declare global {
  namespace JSX {
    type Element = import('react').ReactElement
  }

  interface ApiEnvVar {
    id: string
    key: string
    value: string
    enabled: boolean
  }

  interface ApiEnv {
    id: string
    name: string
    isBase: boolean
    color: string
    initial: string
    vars: ApiEnvVar[]
  }

  interface ApiWorkspace {
    id: string
    name: string
    description: string
  }

  interface ApiProject {
    id: string
    name: string
    description: string
  }

  interface ApiModule {
    id: string
    workspaceId: string | null
    type: string
    label: string
    config: string
    isCommon: boolean
  }

  interface DataItem {
    id: string
    value: string
  }

  interface ExcelData {
    fileName: string
    columns: string[]
    rows: Record<string, unknown>[]
  }

  interface DataConfig {
    output: string
  }

  interface LegacyDataConfig {
    items?: DataItem[]
    excelData?: ExcelData | null
  }

  interface StartSchedule {
    type: 'daily' | 'weekly' | 'monthly' | 'cron'
    time: string
    weekdays: number[]
    monthDay: number
    cron: string
  }

  interface StartConfig {
    mode: 'manual' | 'schedule'
    schedule: StartSchedule
  }

  interface SelectConfig {
    selectedRowIndices: number[]
    selectedJsonPaths?: string[]
    selectMode?: 'table' | 'json'
    selectionType?: 'multiple' | 'single'
    autoSelect?: boolean
    lastInput?: Record<string, unknown>[]
  }

  interface BranchConfig {
    mode?: 'condition' | 'manual'
    expression: string
    trueLabel?: string
    falseLabel?: string
    defaultRoute?: 'true' | 'false'
    selectedRoute?: 'true' | 'false'
    manualSource?: 'saved' | 'runtime'
  }

  interface ApiKvItem {
    id: string
    key: string
    value: string
    enabled: boolean
  }

  type ApiAuthType =
    | 'noAuth'
    | 'bearer'
    | 'basic'
    | 'oauth2'
    | 'apiKey'

  interface ApiAuthConfig {
    type: ApiAuthType
    token?: string
    username?: string
    password?: string
    key?: string
    value?: string
    addTo?: 'header' | 'query'
    accessToken?: string
  }

  interface ApiConfig {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
    url: string
    headers: ApiKvItem[]
    params: ApiKvItem[]
    body: string
    bodyType: 'none' | 'json' | 'raw'
    auth?: ApiAuthConfig
    preScript?: string
    postScript?: string
    inputMappings?: Record<string, string>
  }

  interface ApiNode {
    id: string
    projectId: string
    type: 'start' | 'end' | 'data' | 'select' | 'api' | 'branch'
    label: string
    displayLabel?: string
    moduleLabel?: string | null
    x: number
    y: number
    config: string
    moduleId?: string | null
  }

  interface EndNodeConfig {
    reportFormat: 'none' | 'html' | 'markdown'
    savePath: string
    filenameTemplate: string
    selectedModuleIds: string[]
  }

  interface ApiEdge {
    id: string
    projectId: string
    sourceNodeId: string
    targetNodeId: string
    sourcePort?: string | null
  }

  type AppUpdateStatus =
    | 'idle'
    | 'checking'
    | 'available'
    | 'not-available'
    | 'downloading'
    | 'downloaded'
    | 'error'
    | 'disabled'

  interface AppUpdateState {
    status: AppUpdateStatus
    currentVersion: string
    availableVersion?: string
    progress?: number
    message?: string
  }

  interface AppApi {
    dialog: {
      openDirectory: (defaultPath?: string) => Promise<string | null>
    }
    file: {
      write: (path: string, content: string) => Promise<{ ok: true; path: string } | { ok: false; error: string }>
      open: (path: string) => Promise<{ ok: true } | { ok: false; error: string }>
      downloadsDir: () => Promise<string>
    }
    workspace: {
      list: () => Promise<ApiWorkspace[]>
      create: (name: string, description: string) => Promise<ApiWorkspace>
      update: (id: string, name: string, description: string) => Promise<void>
      delete: (id: string) => Promise<void>
    }
    environment: {
      list: (workspaceId: string) => Promise<ApiEnv[]>
      upsert: (workspaceId: string, env: ApiEnv) => Promise<void>
      delete: (id: string) => Promise<void>
    }
    project: {
      list: (workspaceId: string) => Promise<ApiProject[]>
      create: (workspaceId: string, name: string, description: string) => Promise<ApiProject>
      update: (id: string, name: string, description: string) => Promise<void>
      delete: (id: string) => Promise<void>
    }
    module: {
      list: (workspaceId: string) => Promise<ApiModule[]>
      listAll: () => Promise<ApiModule[]>
      createCommon: (type: string, label: string, config: string) => Promise<ApiModule>
      create: (workspaceId: string, type: string, label: string, config: string) => Promise<ApiModule>
      update: (id: string, label: string, config: string) => Promise<void>
      setCommon: (id: string, isCommon: boolean, workspaceId: string) => Promise<void>
      reorderCommon: (type: string, orderedIds: string[]) => Promise<void>
      delete: (id: string) => Promise<void>
    }
    node: {
      list: (projectId: string) => Promise<ApiNode[]>
      create: (projectId: string, type: string, label: string, x: number, y: number) => Promise<ApiNode>
      createFromModule: (projectId: string, moduleId: string, x: number, y: number) => Promise<ApiNode>
      updatePosition: (id: string, x: number, y: number) => Promise<void>
      updateLabel: (id: string, label: string) => Promise<void>
      updateConfig: (id: string, config: string) => Promise<void>
      delete: (id: string) => Promise<void>
    }
    edge: {
      list: (projectId: string) => Promise<ApiEdge[]>
      create: (projectId: string, sourceNodeId: string, targetNodeId: string, sourcePort?: string | null) => Promise<ApiEdge>
      delete: (id: string) => Promise<void>
    }
    http: {
      fetch: (url: string, options: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; statusText: string; text: string; ok: boolean }>
    }
    update: {
      getState: () => Promise<AppUpdateState>
      check: () => Promise<AppUpdateState>
      download: () => Promise<AppUpdateState>
      install: () => Promise<AppUpdateState>
      onStatus: (listener: (state: AppUpdateState) => void) => () => void
    }
  }

  interface Window {
    api: AppApi
  }
}

export {}
