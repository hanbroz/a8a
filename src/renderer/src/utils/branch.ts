import { resolveInputExpression } from './interpolate'

export type BranchRouteKey = 'true' | 'false'

export interface BranchEvalResult {
  route: BranchRouteKey
  matched: boolean
  value: unknown
  error?: string
}

const DEFAULT_BRANCH_CONFIG: BranchConfig = {
  mode: 'condition',
  expression: '[[0.value]] == true',
  trueLabel: 'TRUE',
  falseLabel: 'FALSE',
  defaultRoute: 'false',
  selectedRoute: 'true',
  manualSource: 'saved',
}

function inputAsRecord(input: unknown): Record<string, unknown> {
  if (input && typeof input === 'object') return input as Record<string, unknown>
  return { value: input }
}

function parseLiteral(raw: string): unknown {
  const source = raw.trim()
  if (!source) return ''
  try {
    return JSON.parse(source)
  } catch {
    if ((source.startsWith("'") && source.endsWith("'")) || (source.startsWith('"') && source.endsWith('"'))) {
      return source.slice(1, -1)
    }
    return source
  }
}

function normalizeScalar(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const source = value.trim()
  if (/^(true|false|null)$/i.test(source) || /^-?\d+(?:\.\d+)?$/.test(source)) {
    try { return JSON.parse(source.toLowerCase()) } catch { return value }
  }
  return value
}

function isTruthy(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    return normalized !== '' && normalized !== 'false' && normalized !== '0' && normalized !== 'n' && normalized !== 'no' && normalized !== 'null' && normalized !== 'undefined'
  }
  if (Array.isArray(value)) return value.length > 0
  if (value && typeof value === 'object') return Object.keys(value).length > 0
  return false
}

function compare(left: unknown, op: string, right: unknown): boolean {
  const a = normalizeScalar(left)
  const b = normalizeScalar(right)
  if (op === '===' || op === '==') return Object.is(a, b) || String(a) === String(b)
  if (op === '!==' || op === '!=') return !(Object.is(a, b) || String(a) === String(b))

  const leftNum = typeof a === 'number' ? a : Number(a)
  const rightNum = typeof b === 'number' ? b : Number(b)
  if (!Number.isFinite(leftNum) || !Number.isFinite(rightNum)) return false
  if (op === '>') return leftNum > rightNum
  if (op === '>=') return leftNum >= rightNum
  if (op === '<') return leftNum < rightNum
  if (op === '<=') return leftNum <= rightNum
  return false
}

export function parseBranchConfig(raw: string): BranchConfig {
  try {
    const parsed = JSON.parse(raw || '{}') as Partial<BranchConfig> & { mode?: string }
    const mode = parsed.mode === 'manual' || parsed.mode === 'condition' ? parsed.mode : undefined
    return {
      mode,
      expression: typeof parsed.expression === 'string' && parsed.expression.trim()
        ? parsed.expression
        : DEFAULT_BRANCH_CONFIG.expression,
      trueLabel: typeof parsed.trueLabel === 'string' && parsed.trueLabel.trim()
        ? parsed.trueLabel
        : DEFAULT_BRANCH_CONFIG.trueLabel,
      falseLabel: typeof parsed.falseLabel === 'string' && parsed.falseLabel.trim()
        ? parsed.falseLabel
        : DEFAULT_BRANCH_CONFIG.falseLabel,
      defaultRoute: parsed.defaultRoute === 'true' ? 'true' : 'false',
      selectedRoute: parsed.selectedRoute === 'false' ? 'false' : 'true',
      manualSource: parsed.manualSource === 'runtime' ? 'runtime' : 'saved',
    }
  } catch {
    return { ...DEFAULT_BRANCH_CONFIG }
  }
}

export function evaluateBranch(config: BranchConfig, input: unknown): BranchEvalResult {
  if (config.mode === 'manual') {
    const route: BranchRouteKey = config.selectedRoute === 'false' ? 'false' : 'true'
    return { route, matched: route === 'true', value: route === 'true' }
  }

  const expression = (config.expression || '').trim()
  const defaultRoute: BranchRouteKey = config.defaultRoute === 'true' ? 'true' : 'false'
  if (!expression) {
    return { route: defaultRoute, matched: defaultRoute === 'true', value: null, error: '조건식이 비어 있습니다.' }
  }

  try {
    const inputRecord = inputAsRecord(input)
    const comparison = expression.match(/^\s*\[\[([\s\S]*?)\]\]\s*(===|!==|==|!=|>=|<=|>|<)\s*([\s\S]+?)\s*$/)
    if (comparison) {
      const value = resolveInputExpression(inputRecord, comparison[1].trim())
      const matched = compare(value, comparison[2], parseLiteral(comparison[3]))
      return { route: matched ? 'true' : 'false', matched, value }
    }

    const singleValue = expression.match(/^\s*\[\[([\s\S]*?)\]\]\s*$/)
    const value = singleValue
      ? resolveInputExpression(inputRecord, singleValue[1].trim())
      : resolveInputExpression(inputRecord, expression)
    const matched = isTruthy(value)
    return { route: matched ? 'true' : 'false', matched, value }
  } catch (err) {
    return {
      route: defaultRoute,
      matched: defaultRoute === 'true',
      value: null,
      error: String((err as Error)?.message ?? err),
    }
  }
}
