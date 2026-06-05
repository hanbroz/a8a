export type Token =
  | { type: 'text'; text: string }
  | { type: 'env'; name: string; resolved: string | null }
  | { type: 'input'; key: string; resolved: string | null }
  | { type: 'data'; key: string; resolved: string | null }

type PathPart = string | number

const RESERVED_EXPRESSION_NAMES = new Set([
  '$',
  '$root',
  '$get',
  'Math',
  'Number',
  'String',
  'Boolean',
  'Array',
  'Object',
  'JSON',
  'Date',
  'parseInt',
  'parseFloat',
  'encodeURIComponent',
  'decodeURIComponent',
  'isFinite',
  'isNaN',
  'true',
  'false',
  'null',
  'undefined',
  'NaN',
  'Infinity',
])

function stringifyTemplateValue(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
  try { return JSON.stringify(value) } catch { return String(value) }
}

function isIdentifier(key: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(key)
}

function pathSegment(parent: string, key: string | number): string {
  if (typeof key === 'number') return `${parent}[${key}]`
  if (!parent) return isIdentifier(key) ? key : `[${JSON.stringify(key)}]`
  return isIdentifier(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`
}

function stripQuotedLiterals(source: string): string {
  return source.replace(/(['"`])(?:\\[\s\S]|(?!\1)[\s\S])*\1/g, ' ')
}

function hasExpressionSyntax(expression: string): boolean {
  return /[+\-*/%<>=!&|?:(),]/.test(stripQuotedLiterals(expression))
}

function getExpressionPrimaryIdentifier(expression: string): string | null {
  if (!hasExpressionSyntax(expression)) return null
  const source = stripQuotedLiterals(expression)
  const identifierRe = /[A-Za-z_$][\w$]*/g
  let match: RegExpExecArray | null
  while ((match = identifierRe.exec(source)) !== null) {
    const name = match[0]
    const prev = match.index > 0 ? source[match.index - 1] : ''
    if (prev === '.' || RESERVED_EXPRESSION_NAMES.has(name)) continue
    return name
  }
  return null
}

export function getInputMappingAlias(expression: string): string {
  const trimmed = expression.trim()
  return getExpressionPrimaryIdentifier(trimmed) ?? trimmed
}

function parseQuotedSegment(source: string, start: number): { value: string; next: number } | null {
  const quote = source[start]
  if (quote !== '"' && quote !== "'") return null
  let i = start + 1
  let value = ''
  while (i < source.length) {
    const ch = source[i]
    if (ch === '\\') {
      const next = source[i + 1]
      if (next === undefined) return null
      value += next
      i += 2
      continue
    }
    if (ch === quote) return { value, next: i + 1 }
    value += ch
    i += 1
  }
  return null
}

function parseInputPath(expression: string): PathPart[] | null {
  const source = expression.trim().replace(/^\$\.?/, '')
  if (!source) return []
  const parts: PathPart[] = []
  let i = 0

  while (i < source.length) {
    if (source[i] === '.') {
      i += 1
      if (i >= source.length) return null
    }

    if (source[i] === '[') {
      i += 1
      while (source[i] === ' ') i += 1
      const quoted = parseQuotedSegment(source, i)
      if (quoted) {
        parts.push(quoted.value)
        i = quoted.next
      } else {
        const start = i
        while (i < source.length && source[i] !== ']') i += 1
        if (i >= source.length) return null
        const raw = source.slice(start, i).trim()
        if (!/^-?\d+$/.test(raw)) return null
        parts.push(Number(raw))
      }
      while (source[i] === ' ') i += 1
      if (source[i] !== ']') return null
      i += 1
      continue
    }

    const start = i
    while (i < source.length && source[i] !== '.' && source[i] !== '[') i += 1
    const key = source.slice(start, i).trim()
    if (!key) return null
    if (hasExpressionSyntax(key)) return null
    parts.push(key)
  }

  return parts
}

function resolvePathValue(inputData: Record<string, unknown> = {}, expression: string): unknown {
  const expr = expression.trim()
  if (!hasExpressionSyntax(expr) && Object.prototype.hasOwnProperty.call(inputData, expr)) return inputData[expr]

  const parts = parseInputPath(expr)
  if (!parts) return undefined

  return parts.reduce<unknown>((current, part) => {
    if (current === null || current === undefined) return undefined
    if (typeof part === 'number') {
      if (Array.isArray(current)) return current[part]
      if (typeof current === 'object') return Object.values(current as Record<string, unknown>)[part]
      return undefined
    }
    if (typeof current !== 'object') return undefined
    if (BLOCKED_MEMBER_NAMES.has(part)) return undefined
    const record = current as Record<string, unknown>
    if (!Object.prototype.hasOwnProperty.call(record, part)) return undefined
    return record[part]
  }, inputData)
}

type ExpressionToken =
  | { type: 'number'; value: number }
  | { type: 'string'; value: string }
  | { type: 'regex'; value: RegExp }
  | { type: 'identifier'; value: string }
  | { type: 'operator'; value: string }
  | { type: 'punct'; value: string }
  | { type: 'eof' }

type CallableRef = { type: 'callable'; name: string }
type MathRef = { type: 'math' }

const SAFE_MATH: MathRef = Object.freeze({ type: 'math' })
const BLOCKED_MEMBER_NAMES = new Set(['__proto__', 'prototype', 'constructor'])
const GLOBAL_CALLABLES = new Set([
  '$get',
  'Number',
  'String',
  'Boolean',
  'parseInt',
  'parseFloat',
  'encodeURIComponent',
  'decodeURIComponent',
  'isFinite',
  'isNaN',
])
const MATH_METHODS = new Set([
  'abs',
  'ceil',
  'floor',
  'round',
  'trunc',
  'max',
  'min',
  'pow',
  'sqrt',
  'sign',
])
const MATH_CONSTANTS: Record<string, number> = {
  E: Math.E,
  LN10: Math.LN10,
  LN2: Math.LN2,
  LOG10E: Math.LOG10E,
  LOG2E: Math.LOG2E,
  PI: Math.PI,
  SQRT1_2: Math.SQRT1_2,
  SQRT2: Math.SQRT2,
}

function isIdentifierStart(ch: string): boolean {
  return /^[A-Za-z_$]$/.test(ch) || ch.charCodeAt(0) > 127
}

function isIdentifierPart(ch: string): boolean {
  return /^[A-Za-z0-9_$]$/.test(ch) || ch.charCodeAt(0) > 127
}

function readExpressionString(source: string, start: number): { value: string; next: number } | null {
  const quote = source[start]
  if (quote !== '"' && quote !== "'") return null
  let value = ''
  for (let i = start + 1; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === '\\') {
      const next = source[i + 1]
      if (next === undefined) return null
      if (next === 'n') value += '\n'
      else if (next === 'r') value += '\r'
      else if (next === 't') value += '\t'
      else value += next
      i += 1
      continue
    }
    if (ch === quote) return { value, next: i + 1 }
    value += ch
  }
  return null
}

function readRegexLiteral(source: string, start: number): { value: RegExp; next: number } | null {
  let pattern = ''
  let inClass = false
  for (let i = start + 1; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === '\\') {
      const next = source[i + 1]
      if (next === undefined) return null
      pattern += ch + next
      i += 1
      continue
    }
    if (ch === '[') inClass = true
    if (ch === ']') inClass = false
    if (ch === '/' && !inClass) {
      let j = i + 1
      let flags = ''
      while (j < source.length && /[dgimsuvy]/.test(source[j])) {
        flags += source[j]
        j += 1
      }
      try {
        return { value: new RegExp(pattern, flags), next: j }
      } catch {
        return null
      }
    }
    pattern += ch
  }
  return null
}

function tokenizeExpression(source: string): ExpressionToken[] | null {
  const tokens: ExpressionToken[] = []
  let i = 0
  let expectValue = true

  const push = (token: ExpressionToken): void => {
    tokens.push(token)
    if (token.type === 'number' || token.type === 'string' || token.type === 'regex' || token.type === 'identifier') {
      expectValue = false
      return
    }
    if (token.type === 'operator') {
      expectValue = true
      return
    }
    if (token.type === 'punct' && (token.value === '(' || token.value === '[' || token.value === ',' || token.value === '.')) {
      expectValue = true
      return
    }
    expectValue = false
  }

  while (i < source.length) {
    const ch = source[i]
    if (/\s/.test(ch)) {
      i += 1
      continue
    }
    if (ch === '"' || ch === "'") {
      const parsed = readExpressionString(source, i)
      if (!parsed) return null
      push({ type: 'string', value: parsed.value })
      i = parsed.next
      continue
    }
    if (ch === '/' && expectValue) {
      const parsed = readRegexLiteral(source, i)
      if (!parsed) return null
      push({ type: 'regex', value: parsed.value })
      i = parsed.next
      continue
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(source[i + 1] ?? ''))) {
      const start = i
      if (ch === '.') i += 1
      while (/[0-9]/.test(source[i] ?? '')) i += 1
      if (source[i] === '.') {
        i += 1
        while (/[0-9]/.test(source[i] ?? '')) i += 1
      }
      const raw = source.slice(start, i)
      push({ type: 'number', value: Number(raw) })
      continue
    }
    if (isIdentifierStart(ch)) {
      const start = i
      i += 1
      while (i < source.length && isIdentifierPart(source[i])) i += 1
      push({ type: 'identifier', value: source.slice(start, i) })
      continue
    }
    if ('+-*/%'.includes(ch)) {
      push({ type: 'operator', value: ch })
      i += 1
      continue
    }
    if ('()[],.'.includes(ch)) {
      push({ type: 'punct', value: ch })
      i += 1
      continue
    }
    return null
  }
  tokens.push({ type: 'eof' })
  return tokens
}

function makeCallable(name: string): CallableRef {
  return { type: 'callable', name }
}

function isCallableRef(value: unknown): value is CallableRef {
  return !!value && typeof value === 'object' && (value as CallableRef).type === 'callable'
}

function isMathRef(value: unknown): value is MathRef {
  return value === SAFE_MATH
}

function readMemberValue(target: unknown, member: unknown): unknown {
  if (target === null || target === undefined) return undefined
  const key = String(member)
  if (BLOCKED_MEMBER_NAMES.has(key)) return undefined
  if (isMathRef(target)) return MATH_CONSTANTS[key]
  if (typeof target === 'string') {
    if (key === 'length') return target.length
    return undefined
  }
  if (Array.isArray(target)) {
    if (/^\d+$/.test(key)) return target[Number(key)]
    if (key === 'length') return target.length
    return undefined
  }
  if (typeof target === 'object') {
    const record = target as Record<string, unknown>
    if (!Object.prototype.hasOwnProperty.call(record, key)) return undefined
    return record[key]
  }
  return undefined
}

function callGlobal(name: string, inputData: Record<string, unknown>, args: unknown[]): unknown {
  switch (name) {
    case '$get':
      return resolvePathValue(inputData, String(args[0] ?? ''))
    case 'Number':
      return Number(args[0])
    case 'String':
      return String(args[0] ?? '')
    case 'Boolean':
      return Boolean(args[0])
    case 'parseInt':
      return parseInt(String(args[0] ?? ''), args[1] === undefined ? 10 : Number(args[1]))
    case 'parseFloat':
      return parseFloat(String(args[0] ?? ''))
    case 'encodeURIComponent':
      return encodeURIComponent(String(args[0] ?? ''))
    case 'decodeURIComponent':
      try { return decodeURIComponent(String(args[0] ?? '')) } catch { return undefined }
    case 'isFinite':
      return Number.isFinite(Number(args[0]))
    case 'isNaN':
      return Number.isNaN(Number(args[0]))
    default:
      return undefined
  }
}

function callMemberValue(target: unknown, member: string, args: unknown[]): unknown {
  if (BLOCKED_MEMBER_NAMES.has(member)) return undefined
  if (isMathRef(target)) {
    if (!MATH_METHODS.has(member)) return undefined
    const mathFn = Math[member as keyof Math] as unknown
    if (typeof mathFn !== 'function') return undefined
    return mathFn(...args.map(arg => Number(arg)))
  }
  if (typeof target === 'string') {
    switch (member) {
      case 'replace': {
        const search = args[0]
        if (!(search instanceof RegExp) && typeof search !== 'string') return undefined
        return target.replace(search, String(args[1] ?? ''))
      }
      case 'trim':
        return target.trim()
      case 'toLowerCase':
        return target.toLowerCase()
      case 'toUpperCase':
        return target.toUpperCase()
      case 'slice':
        return target.slice(Number(args[0] ?? 0), args[1] === undefined ? undefined : Number(args[1]))
      case 'substring':
        return target.substring(Number(args[0] ?? 0), args[1] === undefined ? undefined : Number(args[1]))
      case 'substr':
        return target.substr(Number(args[0] ?? 0), args[1] === undefined ? undefined : Number(args[1]))
      case 'includes':
        return target.includes(String(args[0] ?? ''))
      case 'startsWith':
        return target.startsWith(String(args[0] ?? ''))
      case 'endsWith':
        return target.endsWith(String(args[0] ?? ''))
      default:
        return undefined
    }
  }
  if (typeof target === 'number') {
    if (member === 'toFixed') return target.toFixed(args[0] === undefined ? undefined : Number(args[0]))
    return undefined
  }
  if (Array.isArray(target)) {
    switch (member) {
      case 'join':
        return target.join(args[0] === undefined ? ',' : String(args[0]))
      case 'includes':
        return target.includes(args[0])
      case 'slice':
        return target.slice(Number(args[0] ?? 0), args[1] === undefined ? undefined : Number(args[1]))
      default:
        return undefined
    }
  }
  return undefined
}

function applyBinaryOperator(left: unknown, operator: string, right: unknown): unknown {
  if (operator === '+') {
    if (typeof left === 'string' || typeof right === 'string') return `${left ?? ''}${right ?? ''}`
    return Number(left) + Number(right)
  }
  if (operator === '-') return Number(left) - Number(right)
  if (operator === '*') return Number(left) * Number(right)
  if (operator === '/') return Number(left) / Number(right)
  if (operator === '%') return Number(left) % Number(right)
  return undefined
}

class ExpressionParser {
  private index = 0

  constructor(
    private readonly tokens: ExpressionToken[],
    private readonly inputData: Record<string, unknown>,
  ) {}

  parse(): unknown {
    const value = this.parseExpression()
    return this.peek().type === 'eof' ? value : undefined
  }

  private peek(offset = 0): ExpressionToken {
    return this.tokens[this.index + offset] ?? { type: 'eof' }
  }

  private consume(): ExpressionToken {
    const token = this.peek()
    this.index += 1
    return token
  }

  private match(value: string): boolean {
    const token = this.peek()
    if ((token.type === 'operator' || token.type === 'punct') && token.value === value) {
      this.index += 1
      return true
    }
    return false
  }

  private nextOperator(operators: string[]): string | null {
    const token = this.peek()
    return token.type === 'operator' && operators.includes(token.value) ? token.value : null
  }

  private parseExpression(): unknown {
    return this.parseAdditive()
  }

  private parseAdditive(): unknown {
    let value = this.parseMultiplicative()
    let operator = this.nextOperator(['+', '-'])
    while (operator) {
      this.consume()
      value = applyBinaryOperator(value, operator, this.parseMultiplicative())
      operator = this.nextOperator(['+', '-'])
    }
    return value
  }

  private parseMultiplicative(): unknown {
    let value = this.parseUnary()
    let operator = this.nextOperator(['*', '/', '%'])
    while (operator) {
      this.consume()
      value = applyBinaryOperator(value, operator, this.parseUnary())
      operator = this.nextOperator(['*', '/', '%'])
    }
    return value
  }

  private parseUnary(): unknown {
    if (this.match('+')) return Number(this.parseUnary())
    if (this.match('-')) return -Number(this.parseUnary())
    return this.parseMember()
  }

  private parseMember(): unknown {
    let value = this.parsePrimary()
    while (true) {
      if (this.match('.')) {
        const member = this.consume()
        if (member.type !== 'identifier') return undefined
        if (this.match('(')) value = this.parseMethodCall(value, member.value)
        else value = readMemberValue(value, member.value)
        continue
      }
      if (this.match('[')) {
        const key = this.parseExpression()
        if (!this.match(']')) return undefined
        value = readMemberValue(value, key)
        continue
      }
      if (this.match('(')) {
        value = this.parseCall(value)
        continue
      }
      return value
    }
  }

  private parsePrimary(): unknown {
    const token = this.consume()
    if (token.type === 'number' || token.type === 'string' || token.type === 'regex') return token.value
    if (token.type === 'identifier') return this.resolveIdentifier(token.value)
    if (token.type === 'punct' && token.value === '(') {
      const value = this.parseExpression()
      return this.match(')') ? value : undefined
    }
    return undefined
  }

  private resolveIdentifier(name: string): unknown {
    if (name === 'true') return true
    if (name === 'false') return false
    if (name === 'null') return null
    if (name === 'undefined') return undefined
    if (name === 'NaN') return NaN
    if (name === 'Infinity') return Infinity
    if (name === '$' || name === '$root') return this.inputData
    if (name === 'Math') return SAFE_MATH
    if (GLOBAL_CALLABLES.has(name)) return makeCallable(name)
    return resolvePathValue(this.inputData, name)
  }

  private parseArgs(): unknown[] | null {
    const args: unknown[] = []
    if (this.match(')')) return args
    while (this.peek().type !== 'eof') {
      args.push(this.parseExpression())
      if (this.match(')')) return args
      if (!this.match(',')) return null
    }
    return null
  }

  private parseCall(value: unknown): unknown {
    const args = this.parseArgs()
    if (!args || !isCallableRef(value)) return undefined
    return callGlobal(value.name, this.inputData, args)
  }

  private parseMethodCall(target: unknown, member: string): unknown {
    const args = this.parseArgs()
    if (!args) return undefined
    return callMemberValue(target, member, args)
  }
}

function evaluateLimitedExpression(inputData: Record<string, unknown>, expression: string): unknown {
  const source = expression.trim()
  if (!source) return undefined
  const tokens = tokenizeExpression(source)
  if (!tokens) return undefined
  try {
    return new ExpressionParser(tokens, inputData).parse()
  } catch {
    return undefined
  }
}

export function resolveInputExpression(inputData: Record<string, unknown> = {}, expression: string): unknown {
  const pathValue = resolvePathValue(inputData, expression)
  if (pathValue !== undefined) return pathValue
  return evaluateLimitedExpression(inputData, expression)
}

export function resolveTemplateExpression(inputData: Record<string, unknown> = {}, expression: string): unknown {
  return resolveInputExpression(inputData, expression)
}

function normalizeOutputKeyPathToFirstIndex(inputData: Record<string, unknown>, expression: string): string | null {
  const output = inputData.output
  if (!output || typeof output !== 'object' || Array.isArray(output)) return null
  if (Object.keys(output as Record<string, unknown>).length === 0) return null

  const match = expression.trim().match(/^(\$?\.?output)\[(["'])(.*?)\2\]([\s\S]*)$/)
  if (!match) return null

  const prefix = match[1].startsWith('$') ? '$.output' : 'output'
  return `${prefix}[0]${match[4]}`
}

function resolveInputMappingExpression(inputData: Record<string, unknown>, expression: string): unknown {
  const value = resolveInputExpression(inputData, expression)
  if (value !== undefined) return value

  const fallbackExpression = normalizeOutputKeyPathToFirstIndex(inputData, expression)
  if (!fallbackExpression) return undefined
  return resolveInputExpression(inputData, fallbackExpression)
}

export function applyInputMappings(
  inputData: Record<string, unknown> = {},
  mappings: Record<string, string> = {},
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...inputData }
  Object.entries(mappings).forEach(([alias, path]) => {
    const key = alias.trim()
    const expression = path.trim()
    if (!key || !expression) return
    const value = resolveInputMappingExpression(inputData, expression)
    next[key] = value
    const expressionAlias = getInputMappingAlias(key)
    if (expressionAlias !== key && !Object.prototype.hasOwnProperty.call(mappings, expressionAlias)) {
      next[expressionAlias] = value
    }
  })
  return next
}

export function getInputPathSuggestions(
  inputData: Record<string, unknown> = {},
  options: { maxDepth?: number; maxResults?: number; maxArrayItems?: number } = {},
): string[] {
  const maxDepth = options.maxDepth ?? 8
  const maxResults = options.maxResults ?? 500
  const maxArrayItems = options.maxArrayItems ?? 20
  const results: string[] = []
  const added = new Set<string>()

  const pushResult = (path: string): void => {
    if (!path || added.has(path) || results.length >= maxResults) return
    added.add(path)
    results.push(path)
  }

  const visit = (value: unknown, path: string, depth: number, ancestors: object[] = []): void => {
    pushResult(path)
    if (results.length >= maxResults || depth >= maxDepth) return
    if (value === null || typeof value !== 'object') return
    if (ancestors.includes(value)) return
    const nextAncestors = [...ancestors, value]

    if (Array.isArray(value)) {
      value.slice(0, maxArrayItems).forEach((item, index) => visit(item, pathSegment(path, index), depth + 1, nextAncestors))
      return
    }

    const entries = Object.entries(value as Record<string, unknown>)
    if (path && entries.length > 0) {
      visit(entries[0][1], pathSegment(path, 0), depth + 1, nextAncestors)
    }

    entries.forEach(([key, child]) => {
      if (results.length < maxResults) visit(child, pathSegment(path, key), depth + 1, nextAncestors)
    })
  }

  visit(inputData, '', 0)
  return results
}

export function parseTemplate(
  template: string,
  envVars: Record<string, string> = {},
  inputData: Record<string, unknown> = {},
  dataVars: Record<string, unknown> = inputData,
): Token[] {
  const tokens: Token[] = []
  const re = /\{\{([\s\S]*?)\}\}|\[\[([\s\S]*?)\]\]|<<([\s\S]*?)>>/g
  let last = 0
  let m: RegExpExecArray | null

  while ((m = re.exec(template)) !== null) {
    if (m.index > last) {
      tokens.push({ type: 'text', text: template.slice(last, m.index) })
    }
    if (m[1] !== undefined) {
      const name = m[1].trim()
      const resolved = stringifyTemplateValue(resolveTemplateExpression(envVars, name))
      tokens.push({ type: 'env', name, resolved })
    } else if (m[2] !== undefined) {
      const key = m[2].trim()
      const resolved = stringifyTemplateValue(resolveTemplateExpression(inputData, key))
      tokens.push({ type: 'input', key, resolved })
    } else if (m[3] !== undefined) {
      const key = m[3].trim()
      const resolved = stringifyTemplateValue(resolveTemplateExpression(dataVars, key))
      tokens.push({ type: 'data', key, resolved })
    }
    last = m.index + m[0].length
  }

  if (last < template.length) {
    tokens.push({ type: 'text', text: template.slice(last) })
  }

  return tokens
}

export function resolveTemplate(
  template: string,
  envVars: Record<string, string> = {},
  inputData: Record<string, unknown> = {},
  dataVars: Record<string, unknown> = inputData,
): string {
  return template
    .replace(/\{\{([\s\S]*?)\}\}/g, (_, name: string) => {
      const key = name.trim()
      const resolved = stringifyTemplateValue(resolveTemplateExpression(envVars, key))
      if (resolved !== null) return resolved
      return `{{${key}}}`
    })
    .replace(/\[\[([\s\S]*?)\]\]/g, (_, key: string) => {
      const k = key.trim()
      const resolved = stringifyTemplateValue(resolveTemplateExpression(inputData, k))
      if (resolved !== null) return resolved
      return `[[${k}]]`
    })
    .replace(/<<([\s\S]*?)>>/g, (_, key: string) => {
      const k = key.trim()
      const resolved = stringifyTemplateValue(resolveTemplateExpression(dataVars, k))
      if (resolved !== null) return resolved
      return `<<${k}>>`
    })
}

export function mergeEnvVars(
  environments: Array<{ id: string; isBase: boolean; vars: Array<{ key: string; value: string; enabled: boolean }> }>,
  activeEnvId: string,
): Record<string, string> {
  const base = environments.find(e => e.isBase)
  const active = environments.find(e => e.id === activeEnvId && !e.isBase)

  const result: Record<string, string> = {}

  if (base) {
    for (const v of base.vars) {
      if (v.enabled && v.key) result[v.key] = v.value
    }
  }

  if (active) {
    for (const v of active.vars) {
      if (v.enabled && v.key) result[v.key] = v.value
    }
  }

  return result
}
