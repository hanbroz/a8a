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
  items: DataItem[]
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

interface ApiNode {
  id: string
  projectId: string
  type: 'start' | 'end' | 'data'
  label: string
  x: number
  y: number
  config: string
  moduleId?: string | null
}

interface ApiEdge {
  id: string
  projectId: string
  sourceNodeId: string
  targetNodeId: string
}

interface AppApi {
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
    create: (projectId: string, sourceNodeId: string, targetNodeId: string) => Promise<ApiEdge>
    delete: (id: string) => Promise<void>
  }
}

declare global {
  interface Window {
    api: AppApi
  }
}

export {}
