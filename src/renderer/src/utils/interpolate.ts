export type Token =
  | { type: 'text'; text: string }
  | { type: 'env'; name: string; resolved: string | null }
  | { type: 'input'; key: string; resolved: string | null }
  | { type: 'data'; key: string; resolved: string | null }

type PathPart = string | number

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
    parts.push(key)
  }

  return parts
}

export function resolveInputExpression(inputData: Record<string, unknown> = {}, expression: string): unknown {
  const expr = expression.trim()
  if (Object.prototype.hasOwnProperty.call(inputData, expr)) return inputData[expr]

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
    return (current as Record<string, unknown>)[part]
  }, inputData)
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
    next[key] = resolveInputExpression(inputData, expression)
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
      const resolved = Object.prototype.hasOwnProperty.call(envVars, name) ? envVars[name] : null
      tokens.push({ type: 'env', name, resolved })
    } else if (m[2] !== undefined) {
      const key = m[2].trim()
      const val = resolveInputExpression(inputData, key)
      const resolved = stringifyTemplateValue(val)
      tokens.push({ type: 'input', key, resolved })
    } else if (m[3] !== undefined) {
      const key = m[3].trim()
      const val = resolveInputExpression(dataVars, key)
      const resolved = stringifyTemplateValue(val)
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
    .replace(/\{\{([^}]+)\}\}/g, (_, name: string) => {
      const key = name.trim()
      return Object.prototype.hasOwnProperty.call(envVars, key) ? envVars[key] : `{{${key}}}`
    })
    .replace(/\[\[([\s\S]*?)\]\]/g, (_, key: string) => {
      const k = key.trim()
      const resolved = stringifyTemplateValue(resolveInputExpression(inputData, k))
      if (resolved !== null) return resolved
      return `[[${k}]]`
    })
    .replace(/<<([\s\S]*?)>>/g, (_, key: string) => {
      const k = key.trim()
      const resolved = stringifyTemplateValue(resolveInputExpression(dataVars, k))
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
