// User scripts run as AsyncFunction so `await` is allowed (Postman/Bruno parity).
// Each phase exposes only the helpers valid for its timing; calling a foreign
// helper throws with a clear message so users don't silently misuse the API.

type AnyValue = unknown
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
}

export interface PostScriptResult {
  outputVars: Record<string, AnyValue>
  envUpdates: Record<string, string>
  logs: ScriptConsoleEntry[]
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

export function isScriptRuntimeError(error: unknown): error is ScriptRuntimeError {
  return error instanceof ScriptRuntimeError
}

function blockedSetter(phase: 'Pre Request' | 'Post Response', name: string): (...args: unknown[]) => never {
  return () => {
    throw new Error(`${phase}에서는 ${name}() 사용 불가`)
  }
}

function blockedGetter(phase: 'Pre Request' | 'Post Response', name: string): (...args: unknown[]) => never {
  return () => {
    throw new Error(`${phase}에서는 ${name}() 사용 불가`)
  }
}

export async function runPreRequest(code: string, ctx: PreScriptContext): Promise<PreScriptResult> {
  const inputVars: Record<string, AnyValue> = {}
  const envUpdates: Record<string, string> = {}
  const logs: ScriptConsoleEntry[] = []
  const scriptConsole = createScriptConsole(logs)

  const getInput = (): AnyValue => ctx.input
  const setInput = (name: string, value: AnyValue): void => {
    if (typeof name !== 'string' || !name) throw new Error('setInput: 변수명은 비어있지 않은 문자열이어야 합니다.')
    inputVars[name] = value
  }
  const setEnv = (name: string, value: AnyValue): void => {
    if (typeof name !== 'string' || !name) throw new Error('setEnv: 변수명은 비어있지 않은 문자열이어야 합니다.')
    const envValue = toEnvString(value)
    envUpdates[name] = envValue
    ctx.envVars[name] = envValue
  }
  const getOutput = blockedGetter('Pre Request', 'getOutput')
  const setOutput = blockedSetter('Pre Request', 'setOutput')

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
  const outputVars: Record<string, AnyValue> = {}
  const envUpdates: Record<string, string> = {}
  const logs: ScriptConsoleEntry[] = []
  const scriptConsole = createScriptConsole(logs)

  const getInput = (): AnyValue => ctx.input
  const getOutput = (): AnyValue => ctx.output
  const setOutput = (name: string, value: AnyValue): void => {
    if (typeof name !== 'string' || !name) throw new Error('setOutput: 변수명은 비어있지 않은 문자열이어야 합니다.')
    outputVars[name] = value
  }
  const setEnv = (name: string, value: AnyValue): void => {
    if (typeof name !== 'string' || !name) throw new Error('setEnv: 변수명은 비어있지 않은 문자열이어야 합니다.')
    const envValue = toEnvString(value)
    envUpdates[name] = envValue
    ctx.envVars[name] = envValue
  }
  const setInput = blockedSetter('Post Response', 'setInput')

  const fn = new AsyncFunction(
    'getInput', 'getOutput', 'setEnv', 'setInput', 'setOutput', 'console', 'env',
    code,
  )
  try {
    await fn(getInput, getOutput, setEnv, setInput, setOutput, scriptConsole, ctx.envVars)
  } catch (err) {
    throw new ScriptRuntimeError(String((err as Error)?.message ?? err), logs)
  }

  return { outputVars, envUpdates, logs }
}

export function templateValue(value: AnyValue): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try { return JSON.stringify(value) } catch { return String(value) }
}
