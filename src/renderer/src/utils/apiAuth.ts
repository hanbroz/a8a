import { resolveTemplate } from './interpolate'

export const API_AUTH_TYPES: Array<{ type: ApiAuthType; label: string }> = [
  { type: 'noAuth', label: 'No Auth' },
  { type: 'bearer', label: 'Bearer Token' },
  { type: 'basic', label: 'Basic Auth' },
  { type: 'oauth2', label: 'OAuth 2.0' },
  { type: 'apiKey', label: 'API Key' },
]

export const DEFAULT_API_AUTH: ApiAuthConfig = { type: 'noAuth', addTo: 'header' }

export interface ApiRequestParts {
  url: string
  headers: Record<string, string>
}

export function normalizeApiAuth(raw: unknown): ApiAuthConfig {
  if (!raw || typeof raw !== 'object') return DEFAULT_API_AUTH
  const auth = raw as Partial<ApiAuthConfig>
  const type = API_AUTH_TYPES.some(item => item.type === auth.type) ? auth.type! : 'noAuth'
  return {
    type,
    token: typeof auth.token === 'string' ? auth.token : '',
    username: typeof auth.username === 'string' ? auth.username : '',
    password: typeof auth.password === 'string' ? auth.password : '',
    key: typeof auth.key === 'string' ? auth.key : '',
    value: typeof auth.value === 'string' ? auth.value : '',
    addTo: auth.addTo === 'query' ? 'query' : 'header',
    accessToken: typeof auth.accessToken === 'string' ? auth.accessToken : '',
  }
}

export function getApiAuthTemplateValues(auth: ApiAuthConfig): string[] {
  return [
    auth.token,
    auth.username,
    auth.password,
    auth.key,
    auth.value,
    auth.accessToken,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0)
}

function encodeBase64(value: string): string {
  const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null
  if (!encoder) return btoa(value)
  const bytes = encoder.encode(value)
  let binary = ''
  bytes.forEach(byte => { binary += String.fromCharCode(byte) })
  return btoa(binary)
}

function withQueryParam(url: string, key: string, value: string): string {
  if (!key) return url
  const hashIndex = url.indexOf('#')
  const base = hashIndex >= 0 ? url.slice(0, hashIndex) : url
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : ''
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}${encodeURIComponent(key)}=${encodeURIComponent(value)}${hash}`
}

function resolveAuthValue(value: string | undefined, envVars: Record<string, string>, inputData: Record<string, unknown>): string {
  return resolveTemplate(value ?? '', envVars, inputData).trim()
}

export function applyApiAuth(
  request: ApiRequestParts,
  rawAuth: ApiAuthConfig | undefined,
  envVars: Record<string, string>,
  inputData: Record<string, unknown>,
): ApiRequestParts {
  const auth = normalizeApiAuth(rawAuth)
  const headers = { ...request.headers }
  let url = request.url

  switch (auth.type) {
    case 'bearer': {
      const token = resolveAuthValue(auth.token, envVars, inputData)
      if (token) headers.Authorization = withBearerPrefix(token)
      break
    }
    case 'basic': {
      const username = resolveAuthValue(auth.username, envVars, inputData)
      const password = resolveAuthValue(auth.password, envVars, inputData)
      if (username || password) headers.Authorization = `Basic ${encodeBase64(`${username}:${password}`)}`
      break
    }
    case 'apiKey': {
      const key = resolveAuthValue(auth.key, envVars, inputData)
      const value = resolveAuthValue(auth.value, envVars, inputData)
      if (key) {
        if (auth.addTo === 'query') url = withQueryParam(url, key, value)
        else headers[key] = value
      }
      break
    }
    case 'oauth2': {
      const token = resolveAuthValue(auth.accessToken || auth.token, envVars, inputData)
      if (token) headers.Authorization = withBearerPrefix(token)
      break
    }
    case 'noAuth':
    default:
      break
  }

  return { url, headers }
}

function withBearerPrefix(value: string): string {
  return value.toLowerCase().startsWith('bearer ') ? value : `Bearer ${value}`
}
