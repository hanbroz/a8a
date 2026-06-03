// User scripts run as AsyncFunction so `await` is allowed (Postman/Bruno parity).
// Each phase exposes only the helpers valid for its timing; calling a foreign
// helper throws with a clear message so users don't silently misuse the API.

type AnyValue = unknown
export type ScriptRuntimeLanguage = 'ko' | 'en'
export type ScriptConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug'

export interface ScriptConsoleEntry {
  level: ScriptConsoleLevel
  message: string
  args: string[]
  timestamp: string
}

export class ScriptRuntimeError extends Error {
  logs: ScriptConsoleEntry[]

  constructor(message: string, logs: ScriptConsoleEntry[]) {
    super(message)
    this.name = 'ScriptRuntimeError'
    this.logs = logs
  }
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<void>

export interface PreScriptContext {
  input: AnyValue
  envVars: Record<string, string>
  language?: ScriptRuntimeLanguage
}

export interface PreScriptResult {
  inputVars: Record<string, AnyValue>
  envUpdates: Record<string, string>
  logs: ScriptConsoleEntry[]
}

export interface PostScriptContext {
  input: AnyValue
  output: AnyValue
  envVars: Record<string, string>
  language?: ScriptRuntimeLanguage
}

export interface PostScriptResult {
  outputVars: Record<string, AnyValue>
  outputOverride?: AnyValue
  hasOutputOverride: boolean
  envUpdates: Record<string, string>
  logs: ScriptConsoleEntry[]
}

class OutputObject {
  private values: Record<string, AnyValue> = {}

  constructor(private readonly language: ScriptRuntimeLanguage = 'ko') {}

  add(name: string, value: AnyValue): OutputObject {
    if (typeof name !== 'string' || !name) throw new Error(runtimeMessage(this.language, 'outputAddName'))
    this.values[name] = value
    return this
  }

  set(name: string, value: AnyValue): OutputObject {
    return this.add(name, value)
  }

  toJSON(): Record<string, AnyValue> {
    return { ...this.values }
  }
}

function toEnvString(value: AnyValue): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try { return JSON.stringify(value) } catch { return String(value) }
}

function formatConsoleArg(value: AnyValue): string {
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
  if (value instanceof Error) return value.stack || value.message
  if (typeof value === 'function') return value.toString()
  try { return JSON.stringify(value, null, 2) } catch { return String(value) }
}

function createScriptConsole(logs: ScriptConsoleEntry[]): Console {
  const scriptConsole = Object.create(console) as Console
  const methods: ScriptConsoleLevel[] = ['log', 'info', 'warn', 'error', 'debug']

  methods.forEach(level => {
    scriptConsole[level] = (...args: unknown[]) => {
      const formatted = args.map(formatConsoleArg)
      logs.push({
        level,
        args: formatted,
        message: formatted.join(' '),
        timestamp: new Date().toISOString(),
      })
      ;(console[level] as (...data: unknown[]) => void)(...args)
    }
  })

  return scriptConsole
}

function normalizeOutputOverride(value: AnyValue): AnyValue {
  if (value instanceof OutputObject) return value.toJSON()
  return value
}

export function isScriptRuntimeError(error: unknown): error is ScriptRuntimeError {
  return error instanceof ScriptRuntimeError
}

function runtimeMessage(language: ScriptRuntimeLanguage, key: 'outputAddName' | 'unavailable' | 'setInputName' | 'setEnvName' | 'setOutputName' | 'setOutputCall', vars?: { phase?: string; name?: string }): string {
  const ko = language === 'ko'
  switch (key) {
    case 'outputAddName':
      return ko ? 'Output.add: 이름은 비어있지 않은 문자열이어야 합니다.' : 'Output.add: name must be a non-empty string.'
    case 'unavailable':
      return ko ? `${vars?.phase}에서는 ${vars?.name}() 사용 불가` : `${vars?.name}() cannot be used during ${vars?.phase}.`
    case 'setInputName':
      return ko ? 'setInput: 변수명은 비어있지 않은 문자열이어야 합니다.' : 'setInput: variable name must be a non-empty string.'
    case 'setEnvName':
      return ko ? 'setEnv: 변수명은 비어있지 않은 문자열이어야 합니다.' : 'setEnv: variable name must be a non-empty string.'
    case 'setOutputName':
      return ko ? 'setOutput: 이름은 비어있지 않은 문자열이어야 합니다.' : 'setOutput: name must be a non-empty string.'
    case 'setOutputCall':
      return ko ? 'setOutput: setOutput(value) 또는 setOutput(name, value) 형식으로 호출해야 합니다.' : 'setOutput: call setOutput(value) or setOutput(name, value).'
  }
}

function blockedSetter(phase: 'Pre Request' | 'Post Response', name: string, language: ScriptRuntimeLanguage): (...args: unknown[]) => never {
  return () => {
    throw new Error(runtimeMessage(language, 'unavailable', { phase, name }))
  }
}

function blockedGetter(phase: 'Pre Request' | 'Post Response', name: string, language: ScriptRuntimeLanguage): (...args: unknown[]) => never {
  return () => {
    throw new Error(runtimeMessage(language, 'unavailable', { phase, name }))
  }
}

export async function runPreRequest(code: string, ctx: PreScriptContext): Promise<PreScriptResult> {
  const language = ctx.language ?? 'ko'
  const inputVars: Record<string, AnyValue> = {}
  const envUpdates: Record<string, string> = {}
  const logs: ScriptConsoleEntry[] = []
  const scriptConsole = createScriptConsole(logs)

  const getInput = (): AnyValue => ctx.input
  const setInput = (name: string, value: AnyValue): void => {
    if (typeof name !== 'string' || !name) throw new Error(runtimeMessage(language, 'setInputName'))
    inputVars[name] = value
  }
  const setEnv = (name: string, value: AnyValue): void => {
    if (typeof name !== 'string' || !name) throw new Error(runtimeMessage(language, 'setEnvName'))
    const envValue = toEnvString(value)
    envUpdates[name] = envValue
    ctx.envVars[name] = envValue
  }
  const getOutput = blockedGetter('Pre Request', 'getOutput', language)
  const setOutput = blockedSetter('Pre Request', 'setOutput', language)

  const fn = new AsyncFunction(
    'getInput', 'getOutput', 'setEnv', 'setInput', 'setOutput', 'console', 'env',
    code,
  )
  try {
    await fn(getInput, getOutput, setEnv, setInput, setOutput, scriptConsole, ctx.envVars)
  } catch (err) {
    throw new ScriptRuntimeError(String((err as Error)?.message ?? err), logs)
  }

  return { inputVars, envUpdates, logs }
}

export async function runPostResponse(code: string, ctx: PostScriptContext): Promise<PostScriptResult> {
  const language = ctx.language ?? 'ko'
  const outputVars: Record<string, AnyValue> = {}
  let outputOverride: AnyValue
  let hasOutputOverride = false
  const envUpdates: Record<string, string> = {}
  const logs: ScriptConsoleEntry[] = []
  const scriptConsole = createScriptConsole(logs)

  const getInput = (): AnyValue => ctx.input
  const getOutput = (): AnyValue => ctx.output
  const setOutput = (...args: AnyValue[]): void => {
    if (args.length === 1) {
      outputOverride = normalizeOutputOverride(args[0])
      hasOutputOverride = true
      return
    }
    if (args.length === 2) {
      const [name, value] = args
      if (typeof name !== 'string' || !name) throw new Error(runtimeMessage(language, 'setOutputName'))
      outputVars[name] = value
      const current = outputOverride && typeof outputOverride === 'object' && !Array.isArray(outputOverride)
        ? outputOverride as Record<string, AnyValue>
        : {}
      outputOverride = { ...current, [name]: value }
      hasOutputOverride = true
      return
    }
    throw new Error(runtimeMessage(language, 'setOutputCall'))
  }
  const setEnv = (name: string, value: AnyValue): void => {
    if (typeof name !== 'string' || !name) throw new Error(runtimeMessage(language, 'setEnvName'))
    const envValue = toEnvString(value)
    envUpdates[name] = envValue
    ctx.envVars[name] = envValue
  }
  const setInput = blockedSetter('Post Response', 'setInput', language)
  const RuntimeOutputObject = class extends OutputObject {
    constructor() {
      super(language)
    }
  }

  const fn = new AsyncFunction(
    'getInput', 'getOutput', 'setEnv', 'setInput', 'setOutput', 'Output', 'console', 'env',
    code,
  )
  try {
    await fn(getInput, getOutput, setEnv, setInput, setOutput, RuntimeOutputObject, scriptConsole, ctx.envVars)
  } catch (err) {
    throw new ScriptRuntimeError(String((err as Error)?.message ?? err), logs)
  }

  return { outputVars, outputOverride, hasOutputOverride, envUpdates, logs }
}

export function templateValue(value: AnyValue): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try { return JSON.stringify(value) } catch { return String(value) }
}
