// User scripts run as AsyncFunction so `await` is allowed (Postman/Bruno parity).
// Each phase exposes only the helpers valid for its timing; calling a foreign
// helper throws with a clear message so users don't silently misuse the API.

type AnyValue = unknown

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
}

export interface PostScriptContext {
  input: AnyValue
  output: AnyValue
  envVars: Record<string, string>
}

export interface PostScriptResult {
  outputVars: Record<string, AnyValue>
  envUpdates: Record<string, string>
}

function toEnvString(value: AnyValue): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try { return JSON.stringify(value) } catch { return String(value) }
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

  const getInput = (): AnyValue => ctx.input
  const setInput = (name: string, value: AnyValue): void => {
    if (typeof name !== 'string' || !name) throw new Error('setInput: 변수명은 비어있지 않은 문자열이어야 합니다.')
    inputVars[name] = value
  }
  const setEnv = (name: string, value: AnyValue): void => {
    if (typeof name !== 'string' || !name) throw new Error('setEnv: 변수명은 비어있지 않은 문자열이어야 합니다.')
    envUpdates[name] = toEnvString(value)
  }
  const getOutput = blockedGetter('Pre Request', 'getOutput')
  const setOutput = blockedSetter('Pre Request', 'setOutput')

  const fn = new AsyncFunction(
    'getInput', 'getOutput', 'setEnv', 'setInput', 'setOutput', 'console', 'env',
    code,
  )
  await fn(getInput, getOutput, setEnv, setInput, setOutput, console, ctx.envVars)

  return { inputVars, envUpdates }
}

export async function runPostResponse(code: string, ctx: PostScriptContext): Promise<PostScriptResult> {
  const outputVars: Record<string, AnyValue> = {}
  const envUpdates: Record<string, string> = {}

  const getInput = (): AnyValue => ctx.input
  const getOutput = (): AnyValue => ctx.output
  const setOutput = (name: string, value: AnyValue): void => {
    if (typeof name !== 'string' || !name) throw new Error('setOutput: 변수명은 비어있지 않은 문자열이어야 합니다.')
    outputVars[name] = value
  }
  const setEnv = (name: string, value: AnyValue): void => {
    if (typeof name !== 'string' || !name) throw new Error('setEnv: 변수명은 비어있지 않은 문자열이어야 합니다.')
    envUpdates[name] = toEnvString(value)
  }
  const setInput = blockedSetter('Post Response', 'setInput')

  const fn = new AsyncFunction(
    'getInput', 'getOutput', 'setEnv', 'setInput', 'setOutput', 'console', 'env',
    code,
  )
  await fn(getInput, getOutput, setEnv, setInput, setOutput, console, ctx.envVars)

  return { outputVars, envUpdates }
}

export function templateValue(value: AnyValue): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try { return JSON.stringify(value) } catch { return String(value) }
}
