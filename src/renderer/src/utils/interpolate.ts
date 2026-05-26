export type Token =
  | { type: 'text'; text: string }
  | { type: 'env'; name: string; resolved: string | null }
  | { type: 'input'; key: string; resolved: string | null }

export function parseTemplate(
  template: string,
  envVars: Record<string, string> = {},
  inputData: Record<string, unknown> = {},
): Token[] {
  const tokens: Token[] = []
  const re = /\{\{([^}]+)\}\}|\[\[([^\]]+)\]\]/g
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
      const val = Object.prototype.hasOwnProperty.call(inputData, key) ? inputData[key] : null
      const resolved = val !== null && val !== undefined ? String(val) : null
      tokens.push({ type: 'input', key, resolved })
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
): string {
  return template
    .replace(/\{\{([^}]+)\}\}/g, (_, name: string) => {
      const key = name.trim()
      return Object.prototype.hasOwnProperty.call(envVars, key) ? envVars[key] : `{{${key}}}`
    })
    .replace(/\[\[([^\]]+)\]\]/g, (_, key: string) => {
      const k = key.trim()
      if (Object.prototype.hasOwnProperty.call(inputData, k)) {
        return String(inputData[k])
      }
      return `[[${k}]]`
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
