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
  name: string
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
  type: 'start' | 'end'
  label: string
  x: number
  y: number
  config: string
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
    list: () => Promise<ApiModule[]>
    create: (name: string) => Promise<ApiModule>
    rename: (id: string, name: string) => Promise<void>
    delete: (id: string) => Promise<void>
  }
  node: {
    list: (projectId: string) => Promise<ApiNode[]>
    updatePosition: (id: string, x: number, y: number) => Promise<void>
    updateConfig: (id: string, config: string) => Promise<void>
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
