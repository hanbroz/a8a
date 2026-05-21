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
  vars: ApiEnvVar[]
}

interface ApiWorkspace {
  id: string
  name: string
}

interface ApiModule {
  id: string
  name: string
}

interface AppApi {
  workspace: {
    list: () => Promise<ApiWorkspace[]>
    create: (name: string) => Promise<ApiWorkspace>
    rename: (id: string, name: string) => Promise<void>
    delete: (id: string) => Promise<void>
  }
  environment: {
    list: (workspaceId: string) => Promise<ApiEnv[]>
    upsert: (workspaceId: string, env: ApiEnv) => Promise<void>
    delete: (id: string) => Promise<void>
  }
  module: {
    list: () => Promise<ApiModule[]>
    create: (name: string) => Promise<ApiModule>
    rename: (id: string, name: string) => Promise<void>
    delete: (id: string) => Promise<void>
  }
}

declare global {
  interface Window {
    api: AppApi
  }
}

export {}
