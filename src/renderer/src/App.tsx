import { useState, useEffect, useRef, useCallback } from 'react'
import { flushSync } from 'react-dom'
import { applyInputMappings, mergeEnvVars, parseTemplate, resolveInputExpression, resolveTemplate } from './utils/interpolate'
import { applyApiAuth, getApiAuthTemplateValues } from './utils/apiAuth'
import { isScriptRuntimeError, runPreRequest, runPostResponse } from './utils/scriptRuntime'
import { generateReport, fillFilenameTemplate } from './utils/reportGenerator'
import type { ReportNode, ReportApiDetail, ReportVariable } from './utils/reportGenerator'
import type { ScriptConsoleEntry } from './utils/scriptRuntime'
import { IcoPanelL, IcoPlay, IcoReset, IcoSave, IcoSun, IcoMoon, IcoPanelB, IcoChevD, IcoX, IcoDownload } from './components/Icon'
import WorkspaceHeader from './components/sidebar/WorkspaceHeader'
import ModulePaletteSection from './components/sidebar/ModulePaletteSection'
import ProjectSection from './components/sidebar/ProjectSection'
import ProjectModal from './components/sidebar/ProjectModal'
import WorkspaceModal from './components/sidebar/WorkspaceModal'
import EnvSection from './components/env/EnvSection'
import EnvModal from './components/env/EnvModal'
import ConfirmDialog from './components/ConfirmDialog'
import WorkflowCanvas from './components/canvas/WorkflowCanvas'
import StartNodeModal from './components/canvas/StartNodeModal'
import EndNodeModal from './components/canvas/EndNodeModal'
import DataNodeModal from './components/canvas/DataNodeModal'
import SelectNodeModal from './components/canvas/SelectNodeModal'
import ApiNodeModal from './components/canvas/ApiNodeModal'
import BranchNodeModal from './components/canvas/BranchNodeModal'
import BranchChoicePopup from './components/canvas/BranchChoicePopup'
import SelectionPopup from './components/canvas/SelectionPopup'
import JsonMonacoEditor from './components/canvas/JsonMonacoEditor'
import type { SelectionPopupSelection } from './components/canvas/SelectionPopup'
import { evaluateBranch, parseBranchConfig } from './utils/branch'
import type { Environment } from './components/env/EnvSection'
import type { ProjectItem } from './components/sidebar/ProjectModal'
import type { WorkspaceModalItem } from './components/sidebar/WorkspaceModal'
import { randomId } from './utils/id'

// Read a DATA node's output value. Accepts both new shape (`{ output: string }`)
// and legacy shape (`{ items, excelData }`). On any failure returns an empty array.
function readDataNodeOutput(rawConfig: string): unknown {
  try {
    const cfg = JSON.parse(rawConfig || '{}') as DataConfig & LegacyDataConfig
    if (typeof cfg.output === 'string') {
      try { return JSON.parse(cfg.output) } catch { return [] }
    }
    if (cfg.excelData?.rows?.length) return cfg.excelData.rows
    if (Array.isArray(cfg.items)) return cfg.items.map(i => i.value).filter(Boolean)
    return []
  } catch { return [] }
}

// ── Log entry row component ───────────────────────────
type ApiLogDetail = {
  method: string
  url: string
  headers: Record<string, string>
  body?: string
  statusCode?: number
  statusText?: string
  responseText?: string
}

type LogEntry = {
  id: string; nodeId: string; label: string; type: string
  status: 'running' | 'success' | 'error' | 'skip'
  input: unknown; output?: unknown; error?: string
  startedAt: number; duration?: number
  apiDetail?: ApiLogDetail
  scriptLogs?: ScriptLogBundle
}

const NODE_TYPE_COLORS: Record<string, { color: string; bg: string; label: string }> = {
  data:   { color: '#1f6feb', bg: 'rgba(31,111,235,0.15)',  label: 'DATA' },
  select: { color: '#8957e5', bg: 'rgba(137,87,229,0.15)', label: 'SELECT' },
  branch: { color: '#d29922', bg: 'rgba(210,153,34,0.15)', label: 'BRANCH' },
  api:    { color: '#3fb950', bg: 'rgba(63,185,80,0.15)',   label: 'API' },
}

function statusCodeColor(code: number): string {
  if (code >= 200 && code < 300) return '#3fb950'
  if (code >= 300 && code < 400) return '#d29922'
  if (code >= 400) return '#f85149'
  return '#8b949e'
}

interface CanvasExecution {
  nodeOutputs: Record<string, unknown>
  moduleVars: Record<string, Record<string, unknown>>
  branchRoutes?: Record<string, 'true' | 'false'>
  envVars: Record<string, string>
  usedVariables: Record<string, ReportVariable>
  execLogs: LogEntry[]
  startedAt: number
  plan: string[]
  step: number
  pendingSelectInput: unknown | null
  pendingBranchChoice?: {
    input: unknown
    trueLabel: string
    falseLabel: string
    defaultRoute: 'true' | 'false'
  } | null
  pendingLogEntryId?: string | null
}

type EndNodePnrValue = {
  name: string
  value: string
}

function usedVariableKey(kind: ReportVariable['kind'], name: string): string {
  return `${kind}:${name}`
}

function isPnrEnvName(name: string): boolean {
  const normalized = name.trim().toLowerCase()
  const compact = normalized.replace(/[_\-\s]/g, '')
  return normalized === 'pnr' || compact === 'recordlocator'
}

function formatPnrDisplayValue(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function extractPnrEnvValues(variables: ReportVariable[]): EndNodePnrValue[] {
  const seen = new Set<string>()
  return variables
    .filter(variable => variable.kind === 'env' && isPnrEnvName(variable.name))
    .map(variable => {
      const value = formatPnrDisplayValue(variable.value)
      return value ? { name: variable.name, value } : null
    })
    .filter((item): item is EndNodePnrValue => {
      if (!item) return false
      const dedupeKey = `${item.name.toLowerCase()}:${item.value}`
      if (seen.has(dedupeKey)) return false
      seen.add(dedupeKey)
      return true
    })
}

function recordUsedTemplateVariables(
  usedVariables: Record<string, ReportVariable>,
  templates: string[],
  envVars: Record<string, string>,
  inputData: Record<string, unknown>,
): void {
  templates
    .filter(template => template.trim().length > 0)
    .forEach(template => {
      parseTemplate(template, envVars, inputData).forEach(token => {
        if (token.type === 'env') {
          usedVariables[usedVariableKey('env', token.name)] = {
            kind: 'env',
            name: token.name,
            value: Object.prototype.hasOwnProperty.call(envVars, token.name) ? envVars[token.name] : null,
          }
        }
        if (token.type === 'input') {
          const value = resolveInputExpression(inputData, token.key)
          usedVariables[usedVariableKey('input', token.key)] = {
            kind: 'input',
            name: token.key,
            value: value === undefined ? null : value,
          }
        }
      })
    })
}

function recordUpdatedEnvVariables(
  usedVariables: Record<string, ReportVariable>,
  envVars: Record<string, string>,
  updates: Record<string, string>,
): void {
  for (const name of Object.keys(updates)) {
    usedVariables[usedVariableKey('env', name)] = {
      kind: 'env',
      name,
      value: Object.prototype.hasOwnProperty.call(envVars, name) ? envVars[name] : updates[name],
    }
  }
}

function recordUsedInputVariable(
  usedVariables: Record<string, ReportVariable>,
  name: string,
  inputData: Record<string, unknown>,
): void {
  const trimmed = name.trim()
  if (!trimmed) return
  const value = resolveInputExpression(inputData, trimmed)
  usedVariables[usedVariableKey('input', trimmed)] = {
    kind: 'input',
    name: trimmed,
    value: value === undefined ? null : value,
  }
}

function recordUsedBranchVariables(
  usedVariables: Record<string, ReportVariable>,
  expression: string,
  input: unknown,
): void {
  const inputData = input && typeof input === 'object' ? input as Record<string, unknown> : { value: input }
  const comparison = expression.match(/^\s*\[\[([\s\S]*?)\]\]\s*(?:===|!==|==|!=|>=|<=|>|<)\s*([\s\S]+?)\s*$/)
  if (comparison) {
    recordUsedInputVariable(usedVariables, comparison[1], inputData)
    return
  }

  const singleValue = expression.match(/^\s*\[\[([\s\S]*?)\]\]\s*$/)
  recordUsedInputVariable(usedVariables, singleValue ? singleValue[1] : expression, inputData)
}

function finalizeUsedVariables(
  usedVariables: Record<string, ReportVariable>,
  envVars: Record<string, string>,
): ReportVariable[] {
  return Object.values(usedVariables).map(variable => {
    if (variable.kind !== 'env') return variable
    return {
      ...variable,
      value: Object.prototype.hasOwnProperty.call(envVars, variable.name) ? envVars[variable.name] : variable.value,
    }
  })
}

function ExecutionScriptConsole({
  title,
  logs,
}: {
  title: string
  logs: ScriptConsoleEntry[]
}): JSX.Element | null {
  if (logs.length === 0) return null

  return (
    <div className="log-script-console">
      <div className="log-script-console-title">{title}</div>
      <div className="api-script-console-list log-script-console-list">
        {logs.map((log, index) => (
          <div key={`${log.timestamp}-${index}`} className={`api-script-console-row api-script-console-${log.level}`}>
            <span className="api-script-console-time">
              {new Date(log.timestamp).toLocaleTimeString('ko-KR', { hour12: false })}
            </span>
            <span className="api-script-console-level">{log.level}</span>
            <pre className="api-script-console-message">{log.message}</pre>
          </div>
        ))}
      </div>
    </div>
  )
}

function formatLogJsonValue(value: unknown): string {
  if (value === undefined) return ''
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return ''
    try { return JSON.stringify(JSON.parse(trimmed), null, 2) } catch { return value }
  }
  try { return JSON.stringify(value ?? null, null, 2) } catch { return String(value) }
}

function getLogJsonViewerHeight(value: string): number {
  const lineCount = Math.max(1, value.split(/\r\n|\r|\n/).length)
  return Math.max(120, Math.min(360, lineCount * 18 + 44))
}

function LogJsonViewer({
  value,
  path,
  placeholder = 'JSON 값이 없습니다.',
}: {
  value: unknown
  path: string
  placeholder?: string
}): JSX.Element {
  const formatted = formatLogJsonValue(value)
  return (
    <div className="log-json-viewer" style={{ height: getLogJsonViewerHeight(formatted) }}>
      <JsonMonacoEditor
        value={formatted}
        readOnly
        path={path}
        placeholder={placeholder}
      />
    </div>
  )
}

function LogEntryRow({ entry, isActive }: { entry: LogEntry; isActive?: boolean }): JSX.Element {
  const [open, setOpen] = useState(false)
  const cfg = NODE_TYPE_COLORS[entry.type] ?? { color: '#8b949e', bg: 'rgba(139,148,158,0.15)', label: entry.type.toUpperCase() }
  const statusColor = entry.status === 'success' ? '#3fb950' : entry.status === 'error' ? '#f85149' : entry.status === 'skip' ? '#8b949e' : '#d29922'
  const api = entry.apiDetail
  const scriptLogs = entry.scriptLogs
  const hasScriptLogs = !!scriptLogs && (scriptLogs.pre.length > 0 || scriptLogs.post.length > 0)

  useEffect(() => {
    if (isActive) setOpen(true)
  }, [isActive])

  const activeColor = entry.status === 'success' ? '#3fb950'
    : entry.status === 'error' ? '#f85149'
    : '#2f81f7'

  return (
    <div
      className={`log-entry${open ? ' log-entry-open' : ''}`}
      style={isActive ? { borderLeft: `2px solid ${activeColor}`, paddingLeft: 10 } : undefined}
      onClick={() => setOpen(v => !v)}
      id={`log-entry-${entry.nodeId}`}
    >
      <div className="log-entry-row">
        <span className="log-entry-type-badge" style={{ background: cfg.bg, color: cfg.color }}>{cfg.label}</span>
        {api && (
          <span className="log-entry-method-badge" style={{ color: cfg.color }}>{api.method}</span>
        )}
        <span className="log-entry-label">{api ? api.url : entry.label}</span>
        {api?.statusCode !== undefined && (
          <span className="log-entry-status-code" style={{ color: statusCodeColor(api.statusCode) }}>
            {api.statusCode} {api.statusText}
          </span>
        )}
        <span className="log-entry-status" style={{ color: statusColor }}>
          {entry.status === 'running' ? '실행 중…' : entry.status === 'success' ? '완료' : entry.status === 'error' ? '오류' : '건너뜀'}
        </span>
        {entry.duration !== undefined && (
          <span className="log-entry-dur">{entry.duration < 1000 ? `${entry.duration}ms` : `${(entry.duration / 1000).toFixed(1)}s`}</span>
        )}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0, color: 'var(--text-4)' }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>

      {open && (
        <div className="log-entry-detail" onClick={e => e.stopPropagation()}>
          {entry.error && <div className="log-entry-error">{entry.error}</div>}

          {api ? (
            <div className="log-api-detail">
              {(entry.input !== null && entry.input !== undefined) || (entry.output !== null && entry.output !== undefined) ? (
                <div className="log-entry-io log-entry-io-api">
                  {entry.input !== null && entry.input !== undefined && (
                    <div className="log-entry-io-col">
                      <div className="log-entry-io-label">INPUT</div>
                      <LogJsonViewer value={entry.input} path={`execution-log/${entry.id}/api-input.json`} placeholder="INPUT 값이 없습니다." />
                    </div>
                  )}
                  {entry.output !== null && entry.output !== undefined && (
                    <div className="log-entry-io-col">
                      <div className="log-entry-io-label">OUTPUT</div>
                      <LogJsonViewer value={entry.output} path={`execution-log/${entry.id}/api-output.json`} placeholder="OUTPUT 값이 없습니다." />
                    </div>
                  )}
                </div>
              ) : null}

              {/* REQUEST */}
              <div className="log-api-section">
                <div className="log-api-section-title">REQUEST</div>
                <div className="log-api-url-line">
                  <span className="log-api-method" style={{ color: cfg.color }}>{api.method}</span>
                  <span className="log-api-url">{api.url}</span>
                </div>
                {Object.keys(api.headers).length > 0 && (
                  <div className="log-api-block">
                    <div className="log-entry-io-label">HEADERS</div>
                    <div className="log-api-kv-list">
                      {Object.entries(api.headers).map(([k, v]) => (
                        <div key={k} className="log-api-kv">
                          <span className="log-api-kv-key">{k}</span>
                          <span className="log-api-kv-val">{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {api.body && (
                  <div className="log-api-block">
                    <div className="log-entry-io-label">BODY</div>
                    <LogJsonViewer value={api.body} path={`execution-log/${entry.id}/request-body.json`} placeholder="요청 BODY가 없습니다." />
                  </div>
                )}
              </div>

              {/* RESPONSE */}
              {api.statusCode !== undefined && (
                <div className="log-api-section">
                  <div className="log-api-section-title">RESPONSE</div>
                  <div className="log-api-status-line">
                    <span className="log-api-status-code" style={{ color: statusCodeColor(api.statusCode) }}>{api.statusCode}</span>
                    <span className="log-api-status-text">{api.statusText}</span>
                  </div>
                  {api.responseText && (
                    <div className="log-api-block">
                      <div className="log-entry-io-label">BODY</div>
                      <LogJsonViewer value={api.responseText} path={`execution-log/${entry.id}/response-body.json`} placeholder="응답 BODY가 없습니다." />
                    </div>
                  )}
                </div>
              )}
              {hasScriptLogs && (
                <div className="log-api-section">
                  <div className="log-api-section-title">SCRIPT CONSOLE</div>
                  <ExecutionScriptConsole title="PRE REQUEST / INPUT" logs={scriptLogs.pre} />
                  <ExecutionScriptConsole title="POST RESPONSE" logs={scriptLogs.post} />
                </div>
              )}
            </div>
          ) : (
            <div className="log-entry-io">
              <div className="log-entry-io-col">
                <div className="log-entry-io-label">INPUT</div>
                <LogJsonViewer value={entry.input ?? null} path={`execution-log/${entry.id}/input.json`} placeholder="INPUT 값이 없습니다." />
              </div>
              {entry.output !== undefined && (
                <div className="log-entry-io-col">
                  <div className="log-entry-io-label">OUTPUT</div>
                  <LogJsonViewer value={entry.output} path={`execution-log/${entry.id}/output.json`} placeholder="OUTPUT 값이 없습니다." />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

type ScriptLogBundle = {
  pre: ScriptConsoleEntry[]
  post: ScriptConsoleEntry[]
}

type SelectPopupResult = {
  rows: unknown[]
  selection: SelectionPopupSelection
}

type JsonPathPart = string | number

function parseSelectConfig(raw: string): SelectConfig {
  try {
    const parsed = JSON.parse(raw || '{}') as Partial<SelectConfig>
    return {
      ...parsed,
      selectedRowIndices: Array.isArray(parsed.selectedRowIndices) ? parsed.selectedRowIndices : [],
      selectedJsonPaths: Array.isArray(parsed.selectedJsonPaths) ? parsed.selectedJsonPaths : [],
      selectMode: parsed.selectMode === 'json' ? 'json' : parsed.selectMode === 'table' ? 'table' : undefined,
      selectionType: parsed.selectionType === 'single' ? 'single' : 'multiple',
      autoSelect: parsed.autoSelect === true,
    }
  } catch {
    return { selectedRowIndices: [], selectedJsonPaths: [], selectionType: 'multiple', autoSelect: false }
  }
}

function selectedRowIndicesForConfig(config: SelectConfig): number[] {
  const indices = config.selectedRowIndices ?? []
  return config.selectionType === 'single' ? indices.slice(0, 1) : indices
}

function selectedJsonPathsForConfig(config: SelectConfig): string[] {
  const paths = config.selectedJsonPaths ?? []
  return config.selectionType === 'single' ? paths.slice(0, 1) : paths
}

function isJsonContainer(value: unknown): boolean {
  return Array.isArray(value) || (typeof value === 'object' && value !== null)
}

function selectChildPath(parentPath: string, key: JsonPathPart): string {
  if (typeof key === 'number') return `${parentPath}[${key}]`
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${parentPath}.${key}` : `${parentPath}[${JSON.stringify(key)}]`
}

function flattenJsonPaths(value: unknown, path = '$', parts: JsonPathPart[] = []): Array<{ id: string; parts: JsonPathPart[]; selectable: boolean }> {
  const current = { id: path, parts, selectable: true }
  if (Array.isArray(value)) {
    return [
      current,
      ...value.flatMap((item, index) => flattenJsonPaths(item, selectChildPath(path, index), [...parts, index])),
    ]
  }
  if (value && typeof value === 'object') {
    return [
      current,
      ...Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
        flattenJsonPaths(child, selectChildPath(path, key), [...parts, key]),
      ),
    ]
  }
  return [current]
}

function selectJsonData(data: unknown): unknown {
  const rows = Array.isArray(data) && data.length > 0 && typeof data[0] === 'object' && data[0] !== null && !Array.isArray(data[0])
    ? data as Record<string, unknown>[]
    : null
  return rows && rows.length === 1 ? rows[0] : data
}

function cloneSelectedJsonValue(value: unknown): unknown {
  if (!isJsonContainer(value)) return value
  return JSON.parse(JSON.stringify(value)) as unknown
}

function readJsonPath(source: unknown, parts: JsonPathPart[]): unknown {
  return parts.reduce<unknown>((current, part) => {
    if (current === null || current === undefined) return undefined
    return (current as Record<string, unknown> | unknown[])[part as never]
  }, source)
}

function assignJsonProjectionWithMaps(
  target: unknown,
  source: unknown,
  parts: JsonPathPart[],
  sourceParentParts: JsonPathPart[],
  arrayIndexMaps: Map<string, Map<number, number>>,
): void {
  let targetCursor = target as Record<string, unknown> | unknown[]
  let sourceCursor = source
  const sourcePath = [...sourceParentParts]
  parts.forEach((part, index) => {
    const nextSource = readJsonPath(sourceCursor, [part])
    const isLast = index === parts.length - 1
    let targetPart = part
    if (Array.isArray(targetCursor) && typeof part === 'number') {
      const mapKey = JSON.stringify(sourcePath)
      let indexMap = arrayIndexMaps.get(mapKey)
      if (!indexMap) {
        indexMap = new Map<number, number>()
        arrayIndexMaps.set(mapKey, indexMap)
      }
      if (!indexMap.has(part)) indexMap.set(part, indexMap.size)
      targetPart = indexMap.get(part)!
    }

    if (isLast) {
      ;(targetCursor as Record<string, unknown>)[targetPart] = cloneSelectedJsonValue(nextSource)
      return
    }
    const nextPart = parts[index + 1]
    if ((targetCursor as Record<string, unknown>)[targetPart] === undefined) {
      ;(targetCursor as Record<string, unknown>)[targetPart] = typeof nextPart === 'number' ? [] : {}
    }
    targetCursor = (targetCursor as Record<string, unknown>)[targetPart] as Record<string, unknown> | unknown[]
    sourceCursor = nextSource
    sourcePath.push(part)
  })
}

function buildSelectedJsonOutput(data: unknown, selectedPaths: string[]): unknown {
  if (selectedPaths.length === 0) return []
  const source = selectJsonData(data)
  const nodes = flattenJsonPaths(source)
  return selectedPaths
    .map(path => nodes.find(node => node.selectable && node.id === path))
    .filter((node): node is { id: string; parts: JsonPathPart[]; selectable: boolean } => !!node)
    .map(node => readJsonPath(source, node.parts))
    .filter(value => value !== undefined)
    .map(cloneSelectedJsonValue)
}

function reportNodeType(type: string): ReportNode['type'] {
  if (type === 'start' || type === 'end' || type === 'data' || type === 'select' || type === 'api' || type === 'branch') return type
  return 'data'
}

function isValidWorkflowEdge(edge: ApiEdge, nodes: ApiNode[]): boolean {
  const source = nodes.find(n => n.id === edge.sourceNodeId)
  const target = nodes.find(n => n.id === edge.targetNodeId)
  return !!source && !!target && source.id !== target.id && source.type !== 'end' && target.type !== 'start'
}

function getValidWorkflowEdges(nodes: ApiNode[], edges: ApiEdge[], replacedEdgeIds?: string | string[]): ApiEdge[] {
  const excluded = new Set(Array.isArray(replacedEdgeIds) ? replacedEdgeIds : replacedEdgeIds ? [replacedEdgeIds] : [])
  return edges.filter(e => !excluded.has(e.id) && isValidWorkflowEdge(e, nodes))
}

function executeNodeOutput(nodeId: string, nodes: ApiNode[], edges: ApiEdge[], visiting = new Set<string>()): string {
  if (visiting.has(nodeId)) return JSON.stringify({ __previewError: '순환 연결이 감지되었습니다.' }, null, 2)
  const node = nodes.find(n => n.id === nodeId)
  if (!node) return '[]'
  const validEdges = getValidWorkflowEdges(nodes, edges)
  const inEdge = validEdges.find(e => e.targetNodeId === nodeId)
  const nextVisiting = new Set(visiting)
  nextVisiting.add(nodeId)
  const upstreamJson = inEdge ? executeNodeOutput(inEdge.sourceNodeId, nodes, validEdges, nextVisiting) : '[]'
  if (node.type === 'data') {
    return JSON.stringify(readDataNodeOutput(node.config), null, 2)
  }
  if (node.type === 'select') {
    try {
      const cfg = parseSelectConfig(node.config)
      const input = JSON.parse(upstreamJson) as unknown[]
      const selectedJsonPaths = selectedJsonPathsForConfig(cfg)
      const selectedRowIndices = selectedRowIndicesForConfig(cfg)
      if (cfg.selectMode === 'json' && selectedJsonPaths.length > 0) {
        return JSON.stringify(buildSelectedJsonOutput(input, selectedJsonPaths), null, 2)
      }
      if (!Array.isArray(input) || input.length === 0 || selectedRowIndices.length === 0) return upstreamJson
      const filtered = selectedRowIndices.map(i => input[i]).filter(value => value !== undefined)
      return JSON.stringify(filtered, null, 2)
    } catch { return upstreamJson }
  }
  if (node.type === 'api') {
    return upstreamJson
  }
  if (node.type === 'branch') {
    return upstreamJson
  }
  return upstreamJson
}

function wouldCreateCycle(edges: ApiEdge[], sourceId: string, targetId: string): boolean {
  const stack = [targetId]
  const visited = new Set<string>()
  while (stack.length > 0) {
    const current = stack.pop()!
    if (current === sourceId) return true
    if (visited.has(current)) continue
    visited.add(current)
    edges.filter(e => e.sourceNodeId === current).forEach(e => stack.push(e.targetNodeId))
  }
  return false
}

function canConnectEdge(
  nodes: ApiNode[],
  edges: ApiEdge[],
  sourceId: string,
  targetId: string,
  replacedEdgeIds?: string | string[],
): boolean {
  if (sourceId === targetId) return false
  const source = nodes.find(n => n.id === sourceId)
  const target = nodes.find(n => n.id === targetId)
  if (!source || !target) return false
  if (source.type === 'end' || target.type === 'start') return false
  const nextEdges = getValidWorkflowEdges(nodes, edges, replacedEdgeIds)
  if (nextEdges.some(e => e.sourceNodeId === sourceId && e.targetNodeId === targetId)) return false
  if (source.type === 'start' && nextEdges.some(e => e.sourceNodeId === sourceId)) return false
  if (!allowsMultipleIncoming(target.type) && nextEdges.some(e => e.targetNodeId === targetId)) return false
  return !wouldCreateCycle(nextEdges, sourceId, targetId)
}

function allowsMultipleIncoming(type: string): boolean {
  return type === 'api' || type === 'branch'
}

function isRuntimeEdgeActive(edge: ApiEdge, nodes: ApiNode[], branchRoutes: Record<string, 'true' | 'false'>): boolean {
  const source = nodes.find(n => n.id === edge.sourceNodeId)
  if (source?.type !== 'branch') return true
  const selectedRoute = branchRoutes[source.id]
  if (!selectedRoute) return true
  return (edge.sourcePort ?? 'true') === selectedRoute
}

function getRuntimeReachableNodeIds(
  nodes: ApiNode[],
  edges: ApiEdge[],
  branchRoutes: Record<string, 'true' | 'false'>,
): Set<string> {
  const start = nodes.find(n => n.type === 'start')
  const reachable = new Set<string>()
  if (!start) return reachable
  const queue = [start.id]
  while (queue.length > 0) {
    const id = queue.shift()!
    if (reachable.has(id)) continue
    reachable.add(id)
    edges
      .filter(edge => edge.sourceNodeId === id && isRuntimeEdgeActive(edge, nodes, branchRoutes))
      .forEach(edge => queue.push(edge.targetNodeId))
  }
  return reachable
}

function buildApiInputEnvelope(incomingEdges: ApiEdge[], nodeOutputs: Record<string, unknown>): { output: Record<string, unknown> } {
  const output: Record<string, unknown> = {}
  incomingEdges.forEach(edge => {
    output[edge.sourceNodeId] = nodeOutputs[edge.sourceNodeId] ?? null
  })
  return { output }
}

function buildNodeInputValue(
  node: ApiNode,
  incomingEdges: ApiEdge[],
  nodeOutputs: Record<string, unknown>,
): unknown {
  if (node.type === 'api' || (node.type === 'branch' && incomingEdges.length > 1)) {
    return buildApiInputEnvelope(incomingEdges, nodeOutputs)
  }
  const inEdge = incomingEdges[0]
  return inEdge ? (nodeOutputs[inEdge.sourceNodeId] ?? null) : null
}

function getApiOutputMap(rawInput: unknown): Record<string, unknown> {
  if (rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)) {
    const output = (rawInput as Record<string, unknown>).output
    if (output && typeof output === 'object' && !Array.isArray(output)) {
      return output as Record<string, unknown>
    }
  }
  return {}
}

function mergeIncomingModuleVars(
  incomingEdges: ApiEdge[],
  moduleVars: Record<string, Record<string, unknown>>,
): Record<string, unknown> {
  return incomingEdges.reduce<Record<string, unknown>>((acc, edge) => ({
    ...acc,
    ...(moduleVars[edge.sourceNodeId] ?? {}),
  }), {})
}

function buildApiTemplateItems(
  rawInput: unknown,
  incomingEdges: ApiEdge[],
  upstreamModuleVars: Record<string, unknown>,
  preInputVars: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const outputMap = getApiOutputMap(rawInput)
  const singleSourceOutput = incomingEdges.length === 1 ? outputMap[incomingEdges[0].sourceNodeId] : undefined
  const sourceRows = incomingEdges.length === 1
    ? Array.isArray(singleSourceOutput) ? singleSourceOutput : singleSourceOutput === undefined || singleSourceOutput === null ? [] : [singleSourceOutput]
    : [rawInput]
  const rows = sourceRows.length > 0 ? sourceRows : [{}]

  return rows.map(row => {
    const rowVars = row && typeof row === 'object' && !Array.isArray(row)
      ? row as Record<string, unknown>
      : {}
    return {
      ...rowVars,
      ...upstreamModuleVars,
      ...preInputVars,
      output: outputMap,
    }
  })
}

type Theme = 'dark' | 'light'
type SidebarLayout = 'full' | 'icons'
type LogState = 'collapsed' | 'fullscreen'
type NodeStatus = 'running' | 'success' | 'error' | 'skip'

type Workspace = {
  id: string
  name: string
  description: string
  environments: Environment[]
  activeEnvId: string
  projects: ProjectItem[]
}

type CopiedCanvasSelection = {
  sourceProjectId: string
  nodes: ApiNode[]
  edges: ApiEdge[]
}

type CanvasModuleType = Extract<ApiNode['type'], 'data' | 'select' | 'api' | 'branch'>

function isCanvasModuleType(type: string): type is CanvasModuleType {
  return type === 'data' || type === 'select' || type === 'api' || type === 'branch'
}

function defaultCanvasNodeLabel(type: string): string {
  if (type === 'select') return 'SELECT'
  if (type === 'api') return 'API'
  if (type === 'branch') return 'BRANCH'
  return 'DATA'
}

export default function App(): JSX.Element {
  const [theme, setTheme] = useState<Theme>('dark')
  const [sidebarLayout, setSidebarLayout] = useState<SidebarLayout>('full')
  const [logState, setLogState] = useState<LogState>('collapsed')
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('sidebar-width')
      const n = Number(saved)
      return Number.isFinite(n) ? Math.max(180, Math.min(480, n)) : 244
    } catch {
      return 244
    }
  })
  const isResizing = useRef(false)

  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [activeWsId, setActiveWsId] = useState<string>('')
  const [activeProjectId, setActiveProjectId] = useState<string>('')
  const [loading, setLoading] = useState(true)

  const [activeNodes, setActiveNodes] = useState<ApiNode[]>([])
  const [activeEdges, setActiveEdges] = useState<ApiEdge[]>([])
  const [copiedCanvasSelection, setCopiedCanvasSelection] = useState<CopiedCanvasSelection | null>(null)
  const pasteOffsetRef = useRef(0)
  const [confirmDeleteEdge, setConfirmDeleteEdge] = useState<ApiEdge | null>(null)
  const [editingNode, setEditingNode] = useState<ApiNode | null>(null)
  const [nodeRunInputs, setNodeRunInputs] = useState<Record<string, string>>({})
  const [nodeRunOutputs, setNodeRunOutputs] = useState<Record<string, string>>({})
  const [nodeScriptLogs, setNodeScriptLogs] = useState<Record<string, ScriptLogBundle>>({})

  const [envDropdownOpen, setEnvDropdownOpen] = useState(false)
  const [envDropdownPos, setEnvDropdownPos] = useState({ top: 0, left: 0 })
  const envBtnRef = useRef<HTMLButtonElement>(null)
  const envDropdownRef = useRef<HTMLDivElement>(null)
  const sidebarRef = useRef<HTMLElement>(null)
  const [modalEnv, setModalEnv] = useState<Environment | null | undefined>(undefined)
  const [modalWsId, setModalWsId] = useState<string>('')
  const [modalProject, setModalProject] = useState<{ wsId: string; project: ProjectItem | null } | null>(null)
  const [modalWorkspace, setModalWorkspace] = useState<{ workspace: WorkspaceModalItem | null } | null>(null)
  const [confirmDeleteWsId, setConfirmDeleteWsId] = useState<string | null>(null)
  const [confirmDeleteProject, setConfirmDeleteProject] = useState<{ wsId: string; project: ProjectItem } | null>(null)
  const [confirmDeleteEnv, setConfirmDeleteEnv] = useState<{ wsId: string; env: Environment } | null>(null)
  const [confirmDeleteCanvasNode, setConfirmDeleteCanvasNode] = useState<ApiNode | null>(null)
  const [iconTooltip, setIconTooltip] = useState<{ text: string; x: number; y: number } | null>(null)

  // ── Canvas execution ──
  const [canvasExecution, setCanvasExecution] = useState<CanvasExecution | null>(null)
  const [execLogs, setExecLogs] = useState<LogEntry[]>([])
  const [nodeStatuses, setNodeStatuses] = useState<Record<string, NodeStatus>>({})
  const [activeBranchRoutes, setActiveBranchRoutes] = useState<Record<string, 'true' | 'false'>>({})
  const [endNodePnrValues, setEndNodePnrValues] = useState<Record<string, EndNodePnrValue[]>>({})
  const [activeLogNodeId, setActiveLogNodeId] = useState<string | null>(null)
  const [downloadingReport, setDownloadingReport] = useState(false)
  const [savedReport, setSavedReport] = useState<{ path: string } | null>(null)

  // Preview-mode select wait: when previewUpToNode hits a select without auto,
  // we surface a popup and pause until the user resolves the chosen rows.
  const [pendingPreviewSelect, setPendingPreviewSelect] = useState<{
    nodeId: string
    data: unknown
    config: SelectConfig
    resolve: (result: SelectPopupResult | null) => void
  } | null>(null)
  const [updateState, setUpdateState] = useState<AppUpdateState | null>(null)
  const [updateNoticeHidden, setUpdateNoticeHidden] = useState(false)
  const [manualUpdateRequested, setManualUpdateRequested] = useState(false)

  const setScriptLogsForNode = useCallback((nodeId: string, phase: keyof ScriptLogBundle, logs: ScriptConsoleEntry[]): void => {
    setNodeScriptLogs(prev => ({
      ...prev,
      [nodeId]: {
        pre: prev[nodeId]?.pre ?? [],
        post: prev[nodeId]?.post ?? [],
        [phase]: logs,
      },
    }))
  }, [])

  // ── Load from DB on mount ──
  useEffect(() => {
    async function init(): Promise<void> {
      try {
        const wsList = await window.api.workspace.list()
        const all = await Promise.all(
          wsList.map(async (ws) => {
            const [envs, projects] = await Promise.all([
              window.api.environment.list(ws.id),
              window.api.project.list(ws.id)
            ])
            const baseEnv = envs.find(e => e.isBase)
            const savedEnvId = localStorage.getItem(`ws_active_env_${ws.id}`)
            const savedEnv = savedEnvId ? envs.find(e => e.id === savedEnvId) : null
            return {
              id: ws.id,
              name: ws.name,
              description: ws.description ?? '',
              environments: envs as Environment[],
              activeEnvId: savedEnv?.id ?? baseEnv?.id ?? envs[0]?.id ?? '',
              projects: projects as ProjectItem[]
            }
          })
        )
        setWorkspaces(all)
        if (all.length > 0) {
          setActiveWsId(all[0].id)
          setActiveProjectId(all[0].projects[0]?.id ?? '')
        }
      } catch (err) {
        console.error('Failed to load workspaces:', err)
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [])

  useEffect(() => {
    const handler = (e: MouseEvent): void => {
      if (envDropdownRef.current && !envDropdownRef.current.contains(e.target as Node)) {
        setEnvDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      if (!isResizing.current || !sidebarRef.current) return
      const next = Math.max(180, Math.min(480, e.clientX))
      sidebarRef.current.style.width = `${next}px`
      sidebarRef.current.style.transition = 'none'
    }
    const onUp = (e: MouseEvent): void => {
      if (!isResizing.current) return
      isResizing.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      if (sidebarRef.current) sidebarRef.current.style.transition = ''
      const next = Math.max(180, Math.min(480, e.clientX))
      setSidebarWidth(next)
      localStorage.setItem('sidebar-width', String(next))
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [])

  const isFull = sidebarLayout === 'full'
  const activeProject = workspaces.flatMap(w => w.projects).find(p => p.id === activeProjectId)
  // topbar는 현재 열린 프로젝트의 워크스페이스/환경을 표시 (사이드바 선택과 무관)
  const activeProjectWs = workspaces.find(w => w.projects.some(p => p.id === activeProjectId))
  const activeProjectEnv = activeProjectWs?.environments.find(e => e.id === activeProjectWs.activeEnvId)
  const activeProjectEnvVars = activeProjectWs
    ? mergeEnvVars(
        activeProjectWs.environments as Array<{ id: string; isBase: boolean; vars: Array<{ key: string; value: string; enabled: boolean }> }>,
        activeProjectWs.activeEnvId,
      )
    : {}

  useEffect(() => {
    // 프로젝트가 바뀌면 이전 프로젝트의 실행 상태(진행 중 실행/로그/상태 배지/분기 경로)를
    // 초기화한다. 노드 id는 프로젝트마다 고유하므로 남겨두면 엉뚱하게 표시된다.
    setCanvasExecution(null)
    setExecLogs([])
    setNodeStatuses({})
    setActiveBranchRoutes({})
    setEndNodePnrValues({})
    if (!activeProject) { setActiveNodes([]); setActiveEdges([]); return }
    // 프로젝트 전환 경쟁 상태 방지: 로드가 끝나기 전에 다른 프로젝트로 바꾸면
    // 뒤늦게 도착한 응답이 현재 캔버스를 덮어쓰고, 엉뚱한 프로젝트의 엣지를
    // 삭제하는 것을 막는다.
    let cancelled = false
    const pid = activeProject.id
    Promise.all([
      window.api.node.list(pid),
      window.api.edge.list(pid)
    ]).then(([nodes, edges]) => {
      if (cancelled) return
      const validEdges = getValidWorkflowEdges(nodes, edges)
      const validIds = new Set(validEdges.map(e => e.id))
      edges.filter(e => !validIds.has(e.id)).forEach(e => {
        window.api.edge.delete(e.id).catch(console.error)
      })
      setActiveNodes(nodes)
      setActiveEdges(validEdges)
    }).catch(console.error)
    return () => { cancelled = true }
  }, [activeProject?.id])

  useEffect(() => {
    let mounted = true
    window.api.update.getState()
      .then(state => {
        if (mounted) setUpdateState(state)
      })
      .catch(console.error)
    const unsubscribe = window.api.update.onStatus(state => {
      setUpdateState(state)
      if (state.status === 'available' || state.status === 'downloading' || state.status === 'downloaded') {
        setUpdateNoticeHidden(false)
      }
    })
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  const handleUpdateAction = useCallback(async (): Promise<void> => {
    setManualUpdateRequested(true)
    setUpdateNoticeHidden(false)
    try {
      if (updateState?.status === 'downloaded') {
        await window.api.update.install()
        return
      }
      if (updateState?.status === 'available') {
        const next = await window.api.update.download()
        setUpdateState(next)
        return
      }
      const next = await window.api.update.check()
      setUpdateState(next)
    } catch (err) {
      setUpdateState(prev => ({
        status: 'error',
        currentVersion: prev?.currentVersion ?? '',
        availableVersion: prev?.availableVersion,
        message: String((err as Error)?.message ?? err),
      }))
    }
  }, [updateState?.status])

  const handleNodeMove = useCallback(async (id: string, x: number, y: number): Promise<void> => {
    await window.api.node.updatePosition(id, x, y)
    setActiveNodes(prev => prev.map(n => n.id === id ? { ...n, x, y } : n))
  }, [])

  const handleEdgeCreate = useCallback(async (sourceId: string, targetId: string, sourcePort?: string | null): Promise<void> => {
    if (!activeProject) return
    try {
      const source = activeNodes.find(n => n.id === sourceId)
      const target = activeNodes.find(n => n.id === targetId)
      const existingIncoming = target && allowsMultipleIncoming(target.type) ? undefined : activeEdges.find(e => e.targetNodeId === targetId)
      const existingStartOutgoing = source?.type === 'start' ? activeEdges.find(e => e.sourceNodeId === sourceId) : undefined
      if (existingIncoming?.sourceNodeId === sourceId && existingStartOutgoing?.targetNodeId === targetId) return
      const replaceIds = Array.from(new Set([existingIncoming?.id, existingStartOutgoing?.id].filter((id): id is string => typeof id === 'string')))
      if (!canConnectEdge(activeNodes, activeEdges, sourceId, targetId, replaceIds)) return
      await Promise.all(replaceIds.map(id => window.api.edge.delete(id)))
      const edge = await window.api.edge.create(activeProject.id, sourceId, targetId, sourcePort ?? null)
      setActiveEdges(prev => [...prev.filter(e => !replaceIds.includes(e.id)), edge])
      setNodeStatuses({})
      setActiveBranchRoutes({})
      setActiveLogNodeId(null)
    } catch (err) {
      console.error('연결 생성 실패:', err)
    }
  }, [activeProject?.id, activeNodes, activeEdges])

  const handleNodeOpen = useCallback((nodeId: string): void => {
    const node = activeNodes.find(n => n.id === nodeId)
    if (node) setEditingNode(node)
  }, [activeNodes])

  const handleNodeSave = async (nodeId: string, config: string): Promise<void> => {
    await window.api.node.updateConfig(nodeId, config)
    setActiveNodes(prev => prev.map(n => n.id === nodeId ? { ...n, config } : n))
  }

  const handleDataNodeSave = async (nodeId: string, label: string, config: string): Promise<void> => {
    const node = activeNodes.find(n => n.id === nodeId)
    const nextLabel = label.trim() || node?.label || defaultCanvasNodeLabel(node?.type ?? 'data')
    await Promise.all([
      window.api.node.updateLabel(nodeId, nextLabel),
      window.api.node.updateConfig(nodeId, config)
    ])
    setActiveNodes(prev => prev.map(n => n.id === nodeId ? { ...n, label: nextLabel, config } : n))
  }

  const rememberSelectSelection = useCallback(async (
    nodeId: string,
    selection: SelectionPopupSelection,
  ): Promise<void> => {
    const node = activeNodes.find(n => n.id === nodeId)
    if (!node || node.type !== 'select') return

    const current = parseSelectConfig(node.config)
    const next: SelectConfig = selection.mode === 'table'
      ? {
          ...current,
          selectMode: 'table',
          selectedRowIndices: selection.selectedRowIndices,
          selectedJsonPaths: current.selectedJsonPaths ?? [],
        }
      : {
          ...current,
          selectMode: 'json',
          selectedRowIndices: current.selectedRowIndices,
          selectedJsonPaths: selection.selectedJsonPaths,
        }
    const nextConfig = JSON.stringify(next)
    await window.api.node.updateConfig(nodeId, nextConfig)
    setActiveNodes(prev => prev.map(n => n.id === nodeId ? { ...n, config: nextConfig } : n))
  }, [activeNodes])

  const handleModuleDrop = useCallback(async (moduleType: string, x: number, y: number): Promise<void> => {
    if (!activeProject) return
    if (!isCanvasModuleType(moduleType)) return
    const label = defaultCanvasNodeLabel(moduleType)
    const node = await window.api.node.create(activeProject.id, moduleType, label, x, y)
    setActiveNodes(prev => [...prev, node])
  }, [activeProject?.id])

  const handleCanvasNodeCopy = useCallback((nodeIds: string[]): void => {
    const selectedIds = new Set(nodeIds)
    const nodes = activeNodes
      .filter(n => selectedIds.has(n.id) && n.type !== 'start' && n.type !== 'end')
      .map(n => ({ ...n }))
    if (nodes.length === 0 || !activeProject) return
    const copyableIds = new Set(nodes.map(node => node.id))
    const edges = activeEdges
      .filter(edge => copyableIds.has(edge.sourceNodeId) && copyableIds.has(edge.targetNodeId))
      .map(edge => ({ ...edge }))
    setCopiedCanvasSelection({
      sourceProjectId: activeProject.id,
      nodes,
      edges,
    })
    pasteOffsetRef.current = 0
  }, [activeEdges, activeNodes, activeProject?.id])

  const handleCanvasNodePaste = useCallback(async (): Promise<void> => {
    if (!activeProject || !copiedCanvasSelection) return
    const pasteCandidates = copiedCanvasSelection.nodes.filter(node => {
      if (node.type === 'start' || node.type === 'end') return false
      return isCanvasModuleType(node.type)
    })

    if (pasteCandidates.length === 0) return

    const offset = 40 + pasteOffsetRef.current * 20
    const createdBySourceId = new Map<string, ApiNode>()
    const pastedNodes: ApiNode[] = []

    for (const copiedNode of pasteCandidates) {
      const x = Math.round((copiedNode.x + offset) / 10) * 10
      const y = Math.round((copiedNode.y + offset) / 10) * 10
      const label = copiedNode.label.trim() || defaultCanvasNodeLabel(copiedNode.type)
      const config = copiedNode.config ?? ''

      try {
        const created = await window.api.node.create(activeProject.id, copiedNode.type, label, x, y)

        await window.api.node.updateConfig(created.id, config)

        const pasted: ApiNode = {
          ...created,
          label,
          x,
          y,
          config,
        }

        createdBySourceId.set(copiedNode.id, pasted)
        pastedNodes.push(pasted)
      } catch (err) {
        console.error('노드 붙여넣기 실패:', err)
      }
    }

    if (pastedNodes.length === 0) return

    const nextNodes = [...activeNodes, ...pastedNodes]
    const nextEdges = [...activeEdges]
    const pastedEdges: ApiEdge[] = []

    for (const copiedEdge of copiedCanvasSelection.edges) {
      const source = createdBySourceId.get(copiedEdge.sourceNodeId)
      const target = createdBySourceId.get(copiedEdge.targetNodeId)
      if (!source || !target) continue
      if (!canConnectEdge(nextNodes, nextEdges, source.id, target.id)) continue

      try {
        const edge = await window.api.edge.create(activeProject.id, source.id, target.id, copiedEdge.sourcePort ?? null)
        nextEdges.push(edge)
        pastedEdges.push(edge)
      } catch (err) {
        console.error('연결 붙여넣기 실패:', err)
      }
    }

    setActiveNodes(prev => [...prev, ...pastedNodes])
    if (pastedEdges.length > 0) {
      setActiveEdges(prev => [...prev, ...pastedEdges])
    }
    setNodeStatuses({})
    setActiveBranchRoutes({})
    setActiveLogNodeId(null)
    pasteOffsetRef.current = (pasteOffsetRef.current + 1) % 12
  }, [activeEdges, activeNodes, activeProject?.id, copiedCanvasSelection])

  const deleteCanvasNodeInstance = useCallback(async (node: ApiNode): Promise<void> => {
    if (node.type === 'start' || node.type === 'end') return
    await window.api.node.delete(node.id)
    setActiveNodes(prev => prev.filter(n => n.id !== node.id))
    setActiveEdges(prev => prev.filter(e => e.sourceNodeId !== node.id && e.targetNodeId !== node.id))
    setNodeRunInputs(prev => {
      const next = { ...prev }
      delete next[node.id]
      return next
    })
    setNodeRunOutputs(prev => {
      const next = { ...prev }
      delete next[node.id]
      return next
    })
    setNodeScriptLogs(prev => {
      const next = { ...prev }
      delete next[node.id]
      return next
    })
    setNodeStatuses({})
    setActiveBranchRoutes({})
    setActiveLogNodeId(null)
    setEditingNode(prev => prev?.id === node.id ? null : prev)
  }, [])

  const handleCanvasNodeDeleteRequest = useCallback((nodeId: string): void => {
    const node = activeNodes.find(n => n.id === nodeId)
    if (!node || node.type === 'start' || node.type === 'end') return
    setConfirmDeleteCanvasNode(node)
  }, [activeNodes])

  const deleteEdge = async (): Promise<void> => {
    if (!confirmDeleteEdge) return
    await window.api.edge.delete(confirmDeleteEdge.id)
    setActiveEdges(prev => prev.filter(e => e.id !== confirmDeleteEdge.id))
    setNodeStatuses({})
    setActiveLogNodeId(null)
    setConfirmDeleteEdge(null)
  }

  const handleEdgeReconnect = useCallback(async (edgeId: string, newSourceId: string, newTargetId: string, sourcePort?: string | null): Promise<void> => {
    if (!activeProject) return
    try {
      const source = activeNodes.find(n => n.id === newSourceId)
      const target = activeNodes.find(n => n.id === newTargetId)
      const targetIncoming = target && allowsMultipleIncoming(target.type) ? undefined : activeEdges.find(e => e.targetNodeId === newTargetId && e.id !== edgeId)
      const startOutgoing = source?.type === 'start' ? activeEdges.find(e => e.sourceNodeId === newSourceId && e.id !== edgeId) : undefined
      const replaceIds = Array.from(new Set([edgeId, targetIncoming?.id, startOutgoing?.id].filter((id): id is string => typeof id === 'string')))
      if (!canConnectEdge(activeNodes, activeEdges, newSourceId, newTargetId, replaceIds)) return
      await Promise.all(replaceIds.map(id => window.api.edge.delete(id)))
      const newEdge = await window.api.edge.create(activeProject.id, newSourceId, newTargetId, sourcePort ?? null)
      setActiveEdges(prev => [...prev.filter(e => !replaceIds.includes(e.id)), newEdge])
      setNodeStatuses({})
      setActiveBranchRoutes({})
      setActiveLogNodeId(null)
    } catch (err) {
      console.error('연결 변경 실패:', err)
    }
  }, [activeProject?.id, activeNodes, activeEdges])

  // Run upstream nodes for real and return the immediate parent's output as
  // JSON. Used by the INPUT ▶ button so users can preview live data without
  // running the whole canvas. setEnv during preview mutates a local env copy
  // only — workspace env is NOT persisted.
  const previewUpToNode = useCallback(async (targetNodeId: string): Promise<string> => {
    const reachableNodeIds = new Set(buildExecutionPlan(activeNodes, activeEdges))
    if (!reachableNodeIds.has(targetNodeId)) return ''

    const validEdges = getValidWorkflowEdges(activeNodes, activeEdges)
    const inEdge = validEdges.find(e => e.targetNodeId === targetNodeId && reachableNodeIds.has(e.sourceNodeId))
    if (!inEdge) return ''

    const envVars: Record<string, string> = { ...activeProjectEnvVars }
    const moduleVarsMap: Record<string, Record<string, unknown>> = {}
    const visiting = new Set<string>()

    const runNode = async (nodeId: string): Promise<unknown> => {
      if (visiting.has(nodeId)) throw new Error('순환 연결이 감지되었습니다.')
      visiting.add(nodeId)
      const node = activeNodes.find(n => n.id === nodeId)
      if (!node) { visiting.delete(nodeId); return null }
      const upstreamEdges = validEdges.filter(e => e.targetNodeId === nodeId && reachableNodeIds.has(e.sourceNodeId))
      const upstreamEdge = upstreamEdges[0]
      const upstreamOutputs: Record<string, unknown> = {}
      for (const edge of upstreamEdges) {
        upstreamOutputs[edge.sourceNodeId] = await runNode(edge.sourceNodeId)
      }
      const upstream = buildNodeInputValue(node, upstreamEdges, upstreamOutputs)
      const upstreamModuleVars = node.type === 'api' || (node.type === 'branch' && upstreamEdges.length > 1)
        ? mergeIncomingModuleVars(upstreamEdges, moduleVarsMap)
        : upstreamEdge ? (moduleVarsMap[upstreamEdge.sourceNodeId] ?? {}) : {}
      const inputArray: unknown[] = upstream === null ? [] : Array.isArray(upstream) ? upstream : [upstream]

      if (node.type === 'start' || node.type === 'end') {
        moduleVarsMap[nodeId] = { ...upstreamModuleVars }
        visiting.delete(nodeId)
        return upstream
      }
      if (node.type === 'data') {
        moduleVarsMap[nodeId] = { ...upstreamModuleVars }
        const output = readDataNodeOutput(node.config)
        visiting.delete(nodeId)
        return output
      }
      if (node.type === 'select') {
        moduleVarsMap[nodeId] = { ...upstreamModuleVars }
        const cfg = parseSelectConfig(node.config)
        const selectedJsonPaths = selectedJsonPathsForConfig(cfg)
        const selectedRowIndices = selectedRowIndicesForConfig(cfg)
        if (cfg.autoSelect && cfg.selectMode === 'json' && selectedJsonPaths.length > 0) {
          const output = buildSelectedJsonOutput(upstream, selectedJsonPaths)
          visiting.delete(nodeId)
          return output
        }
        if (Array.isArray(upstream) && cfg.autoSelect && selectedRowIndices.length > 0 && inputArray.length > 0) {
          const output = selectedRowIndices
            .map(index => inputArray[index])
            .filter(value => value !== undefined)
          visiting.delete(nodeId)
          return output
        }
        if (inputArray.length === 0) { visiting.delete(nodeId); return inputArray }
        const result = await new Promise<SelectPopupResult | null>(resolve => {
          setPendingPreviewSelect({ nodeId, data: upstream, config: cfg, resolve })
        })
        if (result?.selection) {
          await rememberSelectSelection(nodeId, result.selection)
        }
        const output = result?.rows ?? []
        visiting.delete(nodeId)
        return output
      }
      if (node.type === 'branch') {
        moduleVarsMap[nodeId] = { ...upstreamModuleVars }
        visiting.delete(nodeId)
        return upstream
      }
      if (node.type === 'api') {
        const cfg = JSON.parse(node.config || '{}') as ApiConfig
        if (!cfg.url.trim()) { moduleVarsMap[nodeId] = { ...upstreamModuleVars }; visiting.delete(nodeId); return null }

        let preInputVars: Record<string, unknown> = {}
        if (cfg.preScript && cfg.preScript.trim()) {
          try {
            const r = await runPreRequest(cfg.preScript, { input: upstream, envVars })
            setScriptLogsForNode(nodeId, 'pre', r.logs)
            preInputVars = r.inputVars
            for (const [k, v] of Object.entries(r.envUpdates)) envVars[k] = v
          } catch (err) {
            if (isScriptRuntimeError(err)) setScriptLogsForNode(nodeId, 'pre', err.logs)
            throw err
          }
        }

        const items = buildApiTemplateItems(upstream, upstreamEdges, upstreamModuleVars, preInputVars)

        const allResults: unknown[] = []
        for (const row of items) {
          const item: Record<string, unknown> = applyInputMappings(row, cfg.inputMappings ?? {})
          let fullUrl = resolveTemplate(cfg.url.trim(), envVars, item)
          const enabledParams = (cfg.params ?? []).filter(p => p.enabled && p.key)
          if (enabledParams.length > 0) {
            const qs = new URLSearchParams(enabledParams.map(p => [p.key, resolveTemplate(p.value, envVars, item)]))
            fullUrl += (fullUrl.includes('?') ? '&' : '?') + qs.toString()
          }
          const hdrs: Record<string, string> = {}
          ;(cfg.headers ?? []).filter(h => h.enabled && h.key).forEach(h => {
            hdrs[h.key] = resolveTemplate(h.value, envVars, item)
          })
          let bodyStr: string | undefined
          if (['POST', 'PUT', 'PATCH'].includes(cfg.method) && cfg.body?.trim()) {
            if (cfg.bodyType === 'json' && !hdrs['Content-Type'] && !hdrs['content-type']) {
              hdrs['Content-Type'] = 'application/json'
            }
            bodyStr = resolveTemplate(cfg.body, envVars, item)
          }
          const authedRequest = applyApiAuth({ url: fullUrl, headers: hdrs }, cfg.auth, envVars, item)
          fullUrl = authedRequest.url
          const requestHeaders = authedRequest.headers
          const res = await window.api.http.fetch(fullUrl, { method: cfg.method, headers: requestHeaders, body: bodyStr })
          if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}: ${res.text.slice(0, 200)}`)
          try {
            const data = JSON.parse(res.text) as unknown
            if (Array.isArray(data)) allResults.push(...data)
            else allResults.push(data)
          } catch { allResults.push(res.text) }
        }

        let postOutputVars: Record<string, unknown> = {}
        if (cfg.postScript && cfg.postScript.trim()) {
          try {
            const r = await runPostResponse(cfg.postScript, {
              input: upstream,
              output: allResults.length === 1 ? allResults[0] : allResults,
              envVars,
            })
            setScriptLogsForNode(nodeId, 'post', r.logs)
            postOutputVars = r.outputVars
            for (const [k, v] of Object.entries(r.envUpdates)) envVars[k] = v
          } catch (err) {
            if (isScriptRuntimeError(err)) setScriptLogsForNode(nodeId, 'post', err.logs)
            throw err
          }
        }
        moduleVarsMap[nodeId] = { ...upstreamModuleVars, ...postOutputVars }
        visiting.delete(nodeId)
        return allResults
      }
      visiting.delete(nodeId)
      return upstream
    }

    try {
      const targetNode = activeNodes.find(n => n.id === targetNodeId)
      if (targetNode?.type === 'api' || targetNode?.type === 'branch') {
        const targetIncomingEdges = validEdges.filter(e => e.targetNodeId === targetNodeId && reachableNodeIds.has(e.sourceNodeId))
        if (targetIncomingEdges.length === 0) return ''
        const upstreamOutputs: Record<string, unknown> = {}
        for (const edge of targetIncomingEdges) {
          upstreamOutputs[edge.sourceNodeId] = await runNode(edge.sourceNodeId)
        }
        return JSON.stringify(buildNodeInputValue(targetNode, targetIncomingEdges, upstreamOutputs), null, 2)
      }
      const result = await runNode(inEdge.sourceNodeId)
      return JSON.stringify(result, null, 2)
    } catch (err) {
      return JSON.stringify({ __previewError: String((err as Error)?.message ?? err) }, null, 2)
    }
  }, [activeNodes, activeEdges, activeProjectWs, activeProjectEnvVars, rememberSelectSelection, setScriptLogsForNode])

  const handleNodeRun = useCallback(async (nodeId: string) => {
    const inputJson = await previewUpToNode(nodeId)
    setNodeRunInputs(prev => ({ ...prev, [nodeId]: inputJson }))
    const node = activeNodes.find(n => n.id === nodeId)
    if (node) setEditingNode(node)
  }, [activeNodes, previewUpToNode])

  function buildExecutionPlan(nodes: ApiNode[], edges: ApiEdge[]): string[] {
    const start = nodes.find(n => n.type === 'start')
    if (!start) return []
    const validEdges = getValidWorkflowEdges(nodes, edges)
    const reachable = new Set<string>()
    const scanQueue = [start.id]
    while (scanQueue.length > 0) {
      const id = scanQueue.shift()!
      if (reachable.has(id)) continue
      reachable.add(id)
      validEdges
        .filter(e => e.sourceNodeId === id)
        .forEach(e => scanQueue.push(e.targetNodeId))
    }

    const reachableEdges = validEdges.filter(e => reachable.has(e.sourceNodeId) && reachable.has(e.targetNodeId))
    const indegree = new Map<string, number>()
    reachable.forEach(id => indegree.set(id, 0))
    reachableEdges.forEach(edge => {
      indegree.set(edge.targetNodeId, (indegree.get(edge.targetNodeId) ?? 0) + 1)
    })

    const plan: string[] = []
    const ready = [start.id]
    const visited = new Set<string>()
    while (ready.length > 0) {
      const id = ready.shift()!
      if (visited.has(id)) continue
      visited.add(id)
      plan.push(id)
      reachableEdges
        .filter(e => e.sourceNodeId === id)
        .forEach(edge => {
          const nextCount = (indegree.get(edge.targetNodeId) ?? 0) - 1
          indegree.set(edge.targetNodeId, nextCount)
          if (nextCount === 0) ready.push(edge.targetNodeId)
        })
    }
    return plan
  }

  const advanceExecution = useCallback(async (
    exec: CanvasExecution,
    selectedRows?: unknown[],
    selection?: SelectionPopupSelection,
    selectedBranchRoute?: 'true' | 'false',
  ) => {
    const nodeOutputs = { ...exec.nodeOutputs }
    const moduleVars: Record<string, Record<string, unknown>> = { ...(exec.moduleVars ?? {}) }
    const branchRoutes: Record<string, 'true' | 'false'> = { ...(exec.branchRoutes ?? {}) }
    const envVarsForRun: Record<string, string> = { ...(exec.envVars ?? activeProjectEnvVars) }
    const usedVariables: Record<string, ReportVariable> = { ...(exec.usedVariables ?? {}) }
    const executionEdges = getValidWorkflowEdges(activeNodes, activeEdges)
    const persistedEnvVarsByEnvId: Record<string, Environment['vars']> = {}
    const localLogs: LogEntry[] = [...(exec.execLogs ?? [])]
    const pushLog = (entry: LogEntry): void => {
      localLogs.push(entry)
      setExecLogs(prev => [...prev, entry])
    }
    const updateLog = (id: string, patch: Partial<LogEntry>): void => {
      const idx = localLogs.findIndex(e => e.id === id)
      if (idx >= 0) localLogs[idx] = { ...localLogs[idx], ...patch }
      setExecLogs(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e))
    }
    let { step, plan } = exec

    if (selectedRows !== undefined && step > 0) {
      const prevNodeId = plan[step - 1]
      const selectedOutput = selectedRows
      nodeOutputs[prevNodeId] = selectedOutput
      if (selection) await rememberSelectSelection(prevNodeId, selection)
      setNodeRunOutputs(prev => ({ ...prev, [prevNodeId]: JSON.stringify(selectedOutput, null, 2) }))
      if (exec.pendingLogEntryId) {
        const entry = localLogs.find(e => e.id === exec.pendingLogEntryId)
        updateLog(exec.pendingLogEntryId, { status: 'success', output: selectedOutput, duration: Date.now() - (entry?.startedAt ?? Date.now()) })
        setNodeStatuses(prev => ({ ...prev, [prevNodeId]: 'success' }))
      }
    }

    if (selectedBranchRoute !== undefined && step > 0) {
      const prevNodeId = plan[step - 1]
      const prevNode = activeNodes.find(n => n.id === prevNodeId)
      const branchCfg = parseBranchConfig(prevNode?.config ?? '{}')
      const route = selectedBranchRoute
      const output = {
        route,
        label: route === 'true' ? branchCfg.trueLabel ?? 'TRUE' : branchCfg.falseLabel ?? 'FALSE',
        value: route === 'true',
        passThrough: exec.pendingBranchChoice?.input ?? null,
      }
      branchRoutes[prevNodeId] = route
      setActiveBranchRoutes(prev => ({ ...prev, [prevNodeId]: route }))
      nodeOutputs[prevNodeId] = output
      setNodeRunOutputs(prev => ({ ...prev, [prevNodeId]: JSON.stringify(output, null, 2) }))
      if (exec.pendingLogEntryId) {
        const entry = localLogs.find(e => e.id === exec.pendingLogEntryId)
        updateLog(exec.pendingLogEntryId, { status: 'success', output, duration: Date.now() - (entry?.startedAt ?? Date.now()) })
        setNodeStatuses(prev => ({ ...prev, [prevNodeId]: 'success' }))
      }
    }

    while (step < plan.length) {
      const nodeId = plan[step]
      const node = activeNodes.find(n => n.id === nodeId)
      if (!node) { step++; continue }

      const runtimeReachable = getRuntimeReachableNodeIds(activeNodes, executionEdges, branchRoutes)
      if (!runtimeReachable.has(nodeId)) {
        const skippedAt = Date.now()
        pushLog({
          id: `${nodeId}-${skippedAt}-skip`,
          nodeId,
          label: node.label,
          type: node.type,
          status: 'skip',
          input: null,
          output: null,
          startedAt: skippedAt,
          duration: 0,
        })
        setNodeStatuses(prev => ({ ...prev, [nodeId]: 'skip' }))
        step++; continue
      }

      const incomingEdges = executionEdges.filter(e =>
        e.targetNodeId === nodeId
        && plan.includes(e.sourceNodeId)
        && runtimeReachable.has(e.sourceNodeId)
        && isRuntimeEdgeActive(e, activeNodes, branchRoutes),
      )
      const inEdge = incomingEdges[0]
      const rawInput = buildNodeInputValue(node, incomingEdges, nodeOutputs)
      const inputArray: unknown[] = rawInput === null ? [] : Array.isArray(rawInput) ? rawInput : [rawInput]

      const upstreamModuleVars = node.type === 'api' || (node.type === 'branch' && incomingEdges.length > 1)
        ? mergeIncomingModuleVars(incomingEdges, moduleVars)
        : inEdge ? (moduleVars[inEdge.sourceNodeId] ?? {}) : {}
      moduleVars[nodeId] = { ...upstreamModuleVars }

      if (node.type === 'start') {
        setNodeStatuses(prev => ({ ...prev, [nodeId]: 'success' }))
        step++; continue
      }

      if (node.type === 'end') {
        let endStatus: NodeStatus = 'success'
        const finalVariables = finalizeUsedVariables(usedVariables, envVarsForRun)
        const pnrValues = extractPnrEnvValues(finalVariables)
        try {
          const endCfg = JSON.parse(node.config || '{}') as Partial<EndNodeConfig>
          const fmt = endCfg.reportFormat
          if ((fmt === 'html' || fmt === 'markdown') && endCfg.savePath && endCfg.savePath.trim()) {
            const ws = activeProjectWs
            const envName = ws?.environments.find(e => e.id === ws.activeEnvId)?.name ?? 'BASE'
            const wsName = ws?.name ?? ''
            const projectName = activeProject?.name ?? ''
            const executedAt = new Date(exec.startedAt)
            const totalDuration = Date.now() - exec.startedAt
            const hasError = localLogs.some(e => e.status === 'error')
            const overallStatus: 'success' | 'error' | 'partial' = hasError
              ? (localLogs.some(e => e.status === 'success') ? 'partial' : 'error')
              : 'success'
            // Only plan-connected modules participate in the report. If user
            // saved with previously-connected IDs that are now disconnected,
            // they're silently dropped here.
            const planSet = new Set(plan)
            const connectedModuleIds = activeNodes
              .filter(n => planSet.has(n.id) && n.type !== 'start' && n.type !== 'end')
              .map(n => n.id)
            const hasExplicitSelection = Object.prototype.hasOwnProperty.call(endCfg, 'selectedModuleIds')
            const selectedSet = hasExplicitSelection && Array.isArray(endCfg.selectedModuleIds)
              ? new Set(endCfg.selectedModuleIds.filter(id => planSet.has(id)))
              : new Set(connectedModuleIds)
            const reportNodes: ReportNode[] = plan.map(pid => {
              const pn = activeNodes.find(n => n.id === pid)
              const logEntry = localLogs.find(e => e.nodeId === pid)
              const pcfg = pn && pn.type === 'api' ? (JSON.parse(pn.config || '{}') as ApiConfig) : undefined
              return {
                nodeId: pid,
                label: pn?.label ?? pid,
                type: (pn?.type ?? 'data') as ReportNode['type'],
                status: (logEntry?.status as ReportNode['status']) ?? 'success',
                input: logEntry?.input ?? null,
                output: logEntry?.output,
                error: logEntry?.error,
                duration: logEntry?.duration,
                apiDetail: logEntry?.apiDetail as ReportApiDetail | undefined,
                preScript: pcfg?.preScript,
                postScript: pcfg?.postScript,
              }
            })
            const content = generateReport(fmt, {
              meta: {
                environment: envName,
                workspace: wsName,
                project: projectName,
                executedAt,
                totalDuration,
                overallStatus,
              },
              nodes: reportNodes,
              selectedModuleIds: selectedSet,
              variables: finalVariables,
            })
            const tpl = endCfg.filenameTemplate && endCfg.filenameTemplate.trim() ? endCfg.filenameTemplate : '{env}_{ws}_{project}_{ts}'
            const filename = fillFilenameTemplate(tpl, { env: envName, ws: wsName, project: projectName, ts: executedAt })
            const ext = fmt === 'html' ? '.html' : '.md'
            const sep = endCfg.savePath.includes('/') && !endCfg.savePath.includes('\\') ? '/' : '\\'
            const fullPath = endCfg.savePath.replace(/[\\/]+$/, '') + sep + filename + ext
            const writeResult = await window.api.file.write(fullPath, content)
            if (writeResult.ok) {
              setSavedReport({ path: writeResult.path })
              console.log('[리포트 저장 완료]', writeResult.path)
            } else {
              endStatus = 'error'
              console.error('[리포트 저장 실패]', writeResult.error)
            }
          }
        } catch (err) {
          endStatus = 'error'
          console.error('[리포트 생성 오류]', err)
        }
        setEndNodePnrValues(prev => {
          const next = { ...prev }
          if (endStatus === 'success' && pnrValues.length > 0) next[nodeId] = pnrValues
          else delete next[nodeId]
          return next
        })
        setNodeStatuses(prev => ({ ...prev, [nodeId]: endStatus }))
        if (endStatus === 'error') {
          setCanvasExecution(null)
          return
        }
        step++; continue
      }

      const startedAt = Date.now()
      const entryId = `${nodeId}-${startedAt}`
      pushLog({
        id: entryId, nodeId, label: node.label, type: node.type,
        status: 'running', input: rawInput, startedAt,
      })
      setNodeStatuses(prev => ({ ...prev, [nodeId]: 'running' }))

      if (node.type === 'data') {
        setNodeRunInputs(prev => ({ ...prev, [nodeId]: JSON.stringify(rawInput, null, 2) }))
        try {
          const output = readDataNodeOutput(node.config)
          nodeOutputs[nodeId] = output
          updateLog(entryId, { status: 'success', output, duration: Date.now() - startedAt })
          setNodeStatuses(prev => ({ ...prev, [nodeId]: 'success' }))
        } catch (err) {
          nodeOutputs[nodeId] = []
          updateLog(entryId, { status: 'error', error: String(err), duration: Date.now() - startedAt })
          setNodeStatuses(prev => ({ ...prev, [nodeId]: 'error' }))
          setCanvasExecution(null)
          return
        }
        step++; continue
      }

      if (node.type === 'select') {
        setNodeRunInputs(prev => ({ ...prev, [nodeId]: JSON.stringify(rawInput, null, 2) }))
        const selCfg = parseSelectConfig(node.config)
        const selectedJsonPaths = selectedJsonPathsForConfig(selCfg)
        const selectedRowIndices = selectedRowIndicesForConfig(selCfg)
        if (selCfg.autoSelect && selCfg.selectMode === 'json' && selectedJsonPaths.length > 0) {
          const autoJson = buildSelectedJsonOutput(rawInput, selectedJsonPaths)
          nodeOutputs[nodeId] = autoJson
          setNodeRunOutputs(prev => ({ ...prev, [nodeId]: JSON.stringify(autoJson, null, 2) }))
          updateLog(entryId, { status: 'success', output: autoJson, duration: Date.now() - startedAt })
          setNodeStatuses(prev => ({ ...prev, [nodeId]: 'success' }))
          step++; continue
        }
        if (Array.isArray(rawInput) && selCfg.autoSelect && selectedRowIndices.length > 0 && inputArray.length > 0) {
          const autoRow = selectedRowIndices
            .map(index => inputArray[index])
            .filter(value => value !== undefined)
          nodeOutputs[nodeId] = autoRow
          setNodeRunOutputs(prev => ({ ...prev, [nodeId]: JSON.stringify(autoRow, null, 2) }))
          updateLog(entryId, { status: 'success', output: autoRow, duration: Date.now() - startedAt })
          setNodeStatuses(prev => ({ ...prev, [nodeId]: 'success' }))
          step++; continue
        }
        setCanvasExecution({ nodeOutputs, moduleVars, branchRoutes, envVars: envVarsForRun, usedVariables, execLogs: localLogs, startedAt: exec.startedAt, plan, step: step + 1, pendingSelectInput: rawInput ?? [], pendingBranchChoice: null, pendingLogEntryId: entryId })
        return
      }

      if (node.type === 'branch') {
        setNodeRunInputs(prev => ({ ...prev, [nodeId]: JSON.stringify(rawInput, null, 2) }))
        try {
          const branchCfg = parseBranchConfig(node.config)
          if (branchCfg.mode === 'manual' && branchCfg.manualSource === 'runtime') {
            setCanvasExecution({
              nodeOutputs,
              moduleVars,
              branchRoutes,
              envVars: envVarsForRun,
              usedVariables,
              execLogs: localLogs,
              startedAt: exec.startedAt,
              plan,
              step: step + 1,
              pendingSelectInput: null,
              pendingBranchChoice: {
                input: rawInput,
                trueLabel: branchCfg.trueLabel ?? 'TRUE',
                falseLabel: branchCfg.falseLabel ?? 'FALSE',
                defaultRoute: branchCfg.selectedRoute === 'false' ? 'false' : 'true',
              },
              pendingLogEntryId: entryId,
            })
            return
          }
          if (branchCfg.mode !== 'manual') {
            recordUsedBranchVariables(usedVariables, branchCfg.expression, rawInput)
          }
          const result = evaluateBranch(branchCfg, rawInput)
          branchRoutes[nodeId] = result.route
          setActiveBranchRoutes(prev => ({ ...prev, [nodeId]: result.route }))
          const output = {
            route: result.route,
            label: result.route === 'true' ? branchCfg.trueLabel ?? 'TRUE' : branchCfg.falseLabel ?? 'FALSE',
            value: result.value,
            passThrough: rawInput,
          }
          nodeOutputs[nodeId] = branchCfg.mode === 'manual' ? output : rawInput
          setNodeRunOutputs(prev => ({ ...prev, [nodeId]: JSON.stringify(output, null, 2) }))
          updateLog(entryId, { status: 'success', output, duration: Date.now() - startedAt })
          setNodeStatuses(prev => ({ ...prev, [nodeId]: 'success' }))
        } catch (err) {
          nodeOutputs[nodeId] = null
          updateLog(entryId, { status: 'error', error: String(err), duration: Date.now() - startedAt })
          setNodeStatuses(prev => ({ ...prev, [nodeId]: 'error' }))
          setCanvasExecution(null)
          return
        }
        step++; continue
      }

      if (node.type === 'api') {
        setNodeRunInputs(prev => ({ ...prev, [nodeId]: JSON.stringify(rawInput, null, 2) }))
        setNodeScriptLogs(prev => ({ ...prev, [nodeId]: { pre: [], post: [] } }))
        let lastApiDetail: ApiLogDetail | undefined
        let currentScriptLogs: ScriptLogBundle = { pre: [], post: [] }
        const recordScriptLogs = (phase: keyof ScriptLogBundle, logs: ScriptConsoleEntry[]): void => {
          currentScriptLogs = { ...currentScriptLogs, [phase]: logs }
          setScriptLogsForNode(nodeId, phase, logs)
          updateLog(entryId, { scriptLogs: currentScriptLogs })
        }
        try {
          const cfg = JSON.parse(node.config || '{}') as ApiConfig
          if (!cfg.url.trim()) {
            nodeOutputs[nodeId] = null
            updateLog(entryId, { status: 'skip', output: null, duration: Date.now() - startedAt })
            setNodeStatuses(prev => ({ ...prev, [nodeId]: 'skip' }))
            step++; continue
          }

          const ws = activeProjectWs
          const envVarsForExec = envVarsForRun

          const persistEnvUpdates = async (updates: Record<string, string>): Promise<void> => {
            if (!ws) return
            const baseEnv = ws.environments.find(e => e.isBase)
            const target = baseEnv
            if (!target) return
            const updatedVars = [...(persistedEnvVarsByEnvId[target.id] ?? target.vars)]
            for (const [k, v] of Object.entries(updates)) {
              const idx = updatedVars.findIndex(x => x.key === k)
              if (idx >= 0) updatedVars[idx] = { ...updatedVars[idx], value: v, enabled: true }
              else updatedVars.push({ id: randomId(), key: k, value: v, enabled: true })
            }
            persistedEnvVarsByEnvId[target.id] = updatedVars
            const updated = { ...target, vars: updatedVars }
            await window.api.environment.upsert(ws.id, updated)
            setWorkspaces(prev => prev.map(w => w.id === ws.id
              ? { ...w, environments: w.environments.map(e => e.id === target.id ? (updated as Environment) : e) }
              : w))
          }

          // ── Pre Request script ─────────────────────────
          let preInputVars: Record<string, unknown> = {}
          if (cfg.preScript && cfg.preScript.trim()) {
            try {
              const r = await runPreRequest(cfg.preScript, { input: rawInput, envVars: envVarsForExec })
              recordScriptLogs('pre', r.logs)
              preInputVars = r.inputVars
              for (const [k, v] of Object.entries(r.envUpdates)) envVarsForExec[k] = v
              recordUpdatedEnvVariables(usedVariables, envVarsForExec, r.envUpdates)
              if (Object.keys(r.envUpdates).length > 0) await persistEnvUpdates(r.envUpdates)
            } catch (err) {
              if (isScriptRuntimeError(err)) recordScriptLogs('pre', err.logs)
              throw new Error(`Pre Request 스크립트 오류: ${String((err as Error)?.message ?? err)}`)
            }
          }

          const items = buildApiTemplateItems(rawInput, incomingEdges, upstreamModuleVars, preInputVars)

          const allResults: unknown[] = []

          for (const row of items) {
            const item: Record<string, unknown> = applyInputMappings(row, cfg.inputMappings ?? {})
            const enabledParams = (cfg.params ?? []).filter(p => p.enabled && p.key)
            const enabledHeaders = (cfg.headers ?? []).filter(h => h.enabled && h.key)
            const bodyTemplate = ['POST', 'PUT', 'PATCH'].includes(cfg.method) && cfg.body?.trim() ? cfg.body : ''
            recordUsedTemplateVariables(
              usedVariables,
              [
                cfg.url.trim(),
                ...enabledParams.map(p => p.value),
                ...enabledHeaders.map(h => h.value),
                bodyTemplate,
                ...(cfg.auth ? getApiAuthTemplateValues(cfg.auth) : []),
              ],
              envVarsForExec,
              item,
            )

            let fullUrl = resolveTemplate(cfg.url.trim(), envVarsForExec, item)
            if (enabledParams.length > 0) {
              const qs = new URLSearchParams(enabledParams.map(p => [p.key, resolveTemplate(p.value, envVarsForExec, item)]))
              fullUrl += (fullUrl.includes('?') ? '&' : '?') + qs.toString()
            }
            const hdrs: Record<string, string> = {}
            ;enabledHeaders.forEach(h => {
              hdrs[h.key] = resolveTemplate(h.value, envVarsForExec, item)
            })
            let bodyStr: string | undefined
            if (['POST', 'PUT', 'PATCH'].includes(cfg.method) && cfg.body?.trim()) {
              if (cfg.bodyType === 'json' && !hdrs['Content-Type'] && !hdrs['content-type']) {
                hdrs['Content-Type'] = 'application/json'
              }
              bodyStr = resolveTemplate(cfg.body, envVarsForExec, item)
            }

            const authedRequest = applyApiAuth({ url: fullUrl, headers: hdrs }, cfg.auth, envVarsForExec, item)
            fullUrl = authedRequest.url
            const requestHeaders = authedRequest.headers

            lastApiDetail = { method: cfg.method, url: fullUrl, headers: requestHeaders, body: bodyStr }

            const res = await window.api.http.fetch(fullUrl, { method: cfg.method, headers: requestHeaders, body: bodyStr })
            lastApiDetail = { ...lastApiDetail, statusCode: res.status, statusText: res.statusText, responseText: res.text }

            if (!res.ok) {
              throw new Error(`HTTP ${res.status} ${res.statusText}: ${res.text.slice(0, 300)}`)
            }
            try {
              const data = JSON.parse(res.text) as unknown
              if (Array.isArray(data)) allResults.push(...data)
              else allResults.push(data)
            } catch {
              allResults.push(res.text)
            }
          }

          // ── Post Response script ───────────────────────
          let postOutputVars: Record<string, unknown> = {}
          if (cfg.postScript && cfg.postScript.trim()) {
            try {
              const r = await runPostResponse(cfg.postScript, {
                input: rawInput,
                output: allResults.length === 1 ? allResults[0] : allResults,
                envVars: envVarsForExec,
              })
              recordScriptLogs('post', r.logs)
              postOutputVars = r.outputVars
              for (const [k, v] of Object.entries(r.envUpdates)) envVarsForExec[k] = v
              recordUpdatedEnvVariables(usedVariables, envVarsForExec, r.envUpdates)
              if (Object.keys(r.envUpdates).length > 0) await persistEnvUpdates(r.envUpdates)
            } catch (err) {
              if (isScriptRuntimeError(err)) recordScriptLogs('post', err.logs)
              throw new Error(`Post Response 스크립트 오류: ${String((err as Error)?.message ?? err)}`)
            }
          }

          nodeOutputs[nodeId] = allResults
          moduleVars[nodeId] = { ...upstreamModuleVars, ...postOutputVars }
          setNodeRunOutputs(prev => ({ ...prev, [nodeId]: JSON.stringify(allResults, null, 2) }))
          updateLog(entryId, { status: 'success', output: allResults, duration: Date.now() - startedAt, apiDetail: lastApiDetail, scriptLogs: currentScriptLogs })
          setNodeStatuses(prev => ({ ...prev, [nodeId]: 'success' }))
        } catch (err) {
          nodeOutputs[nodeId] = null
          const errStr = String(err)
          setNodeRunOutputs(prev => ({ ...prev, [nodeId]: errStr }))
          updateLog(entryId, { status: 'error', error: errStr, duration: Date.now() - startedAt, apiDetail: lastApiDetail, scriptLogs: currentScriptLogs })
          setNodeStatuses(prev => ({ ...prev, [nodeId]: 'error' }))
          setCanvasExecution(null)
          return
        }
        step++; continue
      }

      step++
    }

    setCanvasExecution(null)
  }, [activeNodes, activeEdges, activeProjectWs, activeProjectEnvVars, activeProject?.name, rememberSelectSelection, setScriptLogsForNode])

  const handleCanvasRun = useCallback(() => {
    if (!activeProject) return
    const plan = buildExecutionPlan(activeNodes, activeEdges)
    if (plan.length === 0) return
    setExecLogs([])
    setNodeStatuses({})
    setActiveBranchRoutes({})
    setEndNodePnrValues({})
    setActiveLogNodeId(null)
    setNodeScriptLogs({})
    const execution: CanvasExecution = { nodeOutputs: {}, moduleVars: {}, branchRoutes: {}, envVars: { ...activeProjectEnvVars }, usedVariables: {}, execLogs: [], startedAt: Date.now(), plan, step: 0, pendingSelectInput: null, pendingBranchChoice: null }
    advanceExecution(execution)
  }, [activeNodes, activeEdges, activeProject, activeProjectEnvVars, advanceExecution])

  const handleCanvasReset = useCallback(() => {
    setExecLogs([])
    setNodeStatuses({})
    setActiveBranchRoutes({})
    setEndNodePnrValues({})
    setActiveLogNodeId(null)
    setLogState('collapsed')
    setNodeRunInputs({})
    setNodeRunOutputs({})
    setNodeScriptLogs({})
  }, [])

  const handleDownloadExecutionReport = useCallback(async (): Promise<void> => {
    if (!activeProject || execLogs.length === 0) return

    setDownloadingReport(true)
    try {
      const startedAt = new Date(Math.min(...execLogs.map(log => log.startedAt)))
      const finishedAt = Math.max(...execLogs.map(log => log.startedAt + (log.duration ?? 0)))
      const totalDuration = Math.max(0, finishedAt - startedAt.getTime())
      const hasError = execLogs.some(log => log.status === 'error')
      const hasSuccess = execLogs.some(log => log.status === 'success')
      const overallStatus: 'success' | 'error' | 'partial' = hasError ? (hasSuccess ? 'partial' : 'error') : 'success'
      const envName = activeProjectEnv?.name ?? 'BASE'
      const wsName = activeProjectWs?.name ?? ''
      const reportNodes: ReportNode[] = execLogs.map(log => {
        const node = activeNodes.find(n => n.id === log.nodeId)
        let cfg: Partial<ApiConfig> | undefined
        if (node?.type === 'api') {
          try { cfg = JSON.parse(node.config || '{}') as ApiConfig } catch { cfg = undefined }
        }
        return {
          nodeId: log.nodeId,
          label: log.label,
          type: reportNodeType(log.type),
          status: log.status,
          input: log.input,
          output: log.output,
          error: log.error,
          duration: log.duration,
          apiDetail: log.apiDetail as ReportApiDetail | undefined,
          preScript: cfg?.preScript,
          postScript: cfg?.postScript,
          scriptLogs: log.scriptLogs,
        }
      })
      const content = generateReport('html', {
        meta: {
          environment: envName,
          workspace: wsName,
          project: activeProject.name,
          executedAt: startedAt,
          totalDuration,
          overallStatus,
        },
        nodes: reportNodes,
        selectedModuleIds: new Set(reportNodes.map(node => node.nodeId)),
      })
      const dir = await window.api.file.downloadsDir()
      const filename = fillFilenameTemplate('execution-log_{env}_{ws}_{project}_{ts}', {
        env: envName,
        ws: wsName,
        project: activeProject.name,
        ts: new Date(),
      })
      const sep = dir.includes('/') && !dir.includes('\\') ? '/' : '\\'
      const result = await window.api.file.write(`${dir.replace(/[\\/]+$/, '')}${sep}${filename}.html`, content)
      if (!result.ok) {
        alert(`HTML 리포트 저장 실패: ${result.error}`)
        return
      }
      setSavedReport({ path: result.path })
    } catch (err) {
      alert(`HTML 리포트 생성 실패: ${String((err as Error)?.message ?? err)}`)
    } finally {
      setDownloadingReport(false)
    }
  }, [activeNodes, activeProject, activeProjectEnv?.name, activeProjectWs?.name, execLogs])

  const handleOpenSavedReport = useCallback(async (): Promise<void> => {
    if (!savedReport) return
    const reportPath = savedReport.path
    setSavedReport(null)
    const result = await window.api.file.open(reportPath)
    if (!result.ok) alert(`보고서 파일 열기 실패: ${result.error}`)
  }, [savedReport])

  const onNodeStatusClick = useCallback((nodeId: string) => {
    setLogState('fullscreen')
    setActiveLogNodeId(nodeId)
  }, [])

  useEffect(() => {
    if (activeLogNodeId && logState === 'fullscreen') {
      requestAnimationFrame(() => {
        document.getElementById(`log-entry-${activeLogNodeId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      })
    }
  }, [activeLogNodeId, logState])

  const toggleTheme = (): void => setTheme(t => (t === 'dark' ? 'light' : 'dark'))
  const toggleLog = (): void => setLogState(s => (s === 'collapsed' ? 'fullscreen' : 'collapsed'))

  const setActiveEnvId = (wsId: string, envId: string): void => {
    localStorage.setItem(`ws_active_env_${wsId}`, envId)
    setWorkspaces(prev => prev.map(w => w.id === wsId ? { ...w, activeEnvId: envId } : w))
  }

  const selectProject = (wsId: string, projectId: string): void => {
    setActiveWsId(wsId)
    setActiveProjectId(projectId)
  }

  const saveWorkspace = async (name: string, description: string): Promise<void> => {
    if (!modalWorkspace) return
    const { workspace } = modalWorkspace
    if (workspace) {
      await window.api.workspace.update(workspace.id, name, description)
      setWorkspaces(prev => prev.map(w => w.id === workspace.id ? { ...w, name, description } : w))
    } else {
      const ws = await window.api.workspace.create(name, description)
      const [envs, projects] = await Promise.all([
        window.api.environment.list(ws.id),
        window.api.project.list(ws.id)
      ])
      const baseEnv = envs.find((e) => (e as ApiEnv).isBase)
      setWorkspaces(prev => [...prev, {
        id: ws.id,
        name: ws.name,
        description: ws.description ?? '',
        environments: envs as Environment[],
        activeEnvId: baseEnv?.id ?? envs[0]?.id ?? '',
        projects: projects as ProjectItem[]
      }])
      setActiveWsId(ws.id)
    }
    setModalWorkspace(null)
  }

  const deleteWorkspace = async (): Promise<void> => {
    if (!confirmDeleteWsId) return
    await window.api.workspace.delete(confirmDeleteWsId)
    setWorkspaces(prev => {
      const next = prev.filter(w => w.id !== confirmDeleteWsId)
      if (activeWsId === confirmDeleteWsId) setActiveWsId(next[0]?.id ?? '')
      const deletedWs = prev.find(w => w.id === confirmDeleteWsId)
      if (deletedWs?.projects.some(p => p.id === activeProjectId)) {
        setActiveProjectId(next[0]?.projects[0]?.id ?? '')
      }
      return next
    })
    setConfirmDeleteWsId(null)
  }

  // ── Env handlers ──
  const openAddEnvModal = (wsId: string): void => { setModalWsId(wsId); setModalEnv(null) }
  const openEditEnvModal = (wsId: string, env: Environment): void => { setModalWsId(wsId); setModalEnv(env) }
  const closeEnvModal = (): void => setModalEnv(undefined)

  const saveEnv = async (env: Environment): Promise<void> => {
    await window.api.environment.upsert(modalWsId, {
      id: env.id,
      name: env.name,
      isBase: env.isBase,
      color: env.color,
      initial: env.initial,
      vars: env.vars
    })
    setWorkspaces(prev => prev.map(w => {
      if (w.id !== modalWsId) return w
      const exists = w.environments.find(e => e.id === env.id)
      const envs = exists
        ? w.environments.map(e => e.id === env.id ? env : e)
        : [...w.environments, env]
      return { ...w, environments: envs, activeEnvId: env.id }
    }))
    closeEnvModal()
  }

  const deleteEnv = async (): Promise<void> => {
    if (!confirmDeleteEnv) return
    const { wsId, env } = confirmDeleteEnv
    await window.api.environment.delete(env.id)
    setWorkspaces(prev => prev.map(w => {
      if (w.id !== wsId) return w
      const next = w.environments.filter(e => e.id !== env.id)
      const fallback = next.find(e => e.isBase)?.id ?? next[0]?.id ?? ''
      const activeEnvId = w.activeEnvId === env.id ? fallback : w.activeEnvId
      return { ...w, environments: next, activeEnvId }
    }))
    setConfirmDeleteEnv(null)
  }

  // ── Project handlers ──
  const openAddProjectModal = (wsId: string): void => setModalProject({ wsId, project: null })
  const openEditProjectModal = (wsId: string, project: ProjectItem): void => setModalProject({ wsId, project })
  const closeProjectModal = (): void => setModalProject(null)

  const saveProject = async (name: string, description: string): Promise<void> => {
    if (!modalProject) return
    const { wsId, project } = modalProject
    if (project) {
      await window.api.project.update(project.id, name, description)
      setWorkspaces(prev => prev.map(w => {
        if (w.id !== wsId) return w
        return { ...w, projects: w.projects.map(p => p.id === project.id ? { ...p, name, description } : p) }
      }))
    } else {
      const created = await window.api.project.create(wsId, name, description)
      const newProject = created as ProjectItem
      setWorkspaces(prev => prev.map(w => {
        if (w.id !== wsId) return w
        return { ...w, projects: [...w.projects, newProject] }
      }))
      selectProject(wsId, newProject.id)
    }
    closeProjectModal()
  }

  const deleteProject = async (): Promise<void> => {
    if (!confirmDeleteProject) return
    const { wsId, project } = confirmDeleteProject
    await window.api.project.delete(project.id)
    setWorkspaces(prev => prev.map(w => {
      if (w.id !== wsId) return w
      const next = w.projects.filter(p => p.id !== project.id)
      return { ...w, projects: next }
    }))
    if (activeProjectId === project.id) {
      const ws = workspaces.find(w => w.id === wsId)
      const next = (ws?.projects ?? []).filter(p => p.id !== project.id)
      setActiveProjectId(next[0]?.id ?? '')
    }
    setConfirmDeleteProject(null)
  }

  const manualUpdateNoticeVisible = !!updateState
    && manualUpdateRequested
    && (updateState.status === 'checking' || updateState.status === 'not-available' || updateState.status === 'error' || updateState.status === 'disabled')
  const updateNoticeVisible = !!updateState
    && !updateNoticeHidden
    && (
      updateState.status === 'available'
      || updateState.status === 'downloading'
      || updateState.status === 'downloaded'
      || manualUpdateNoticeVisible
    )
  const updateProgress = Math.round(updateState?.progress ?? 0)
  const updateDisplayTitle = updateState?.status === 'downloaded'
    ? '업데이트 준비 완료'
    : updateState?.status === 'downloading'
      ? '업데이트 다운로드 중'
      : updateState?.status === 'checking'
        ? '업데이트 확인 중'
        : updateState?.status === 'not-available'
          ? '최신 버전'
          : updateState?.status === 'error'
            ? '업데이트 확인 실패'
            : updateState?.status === 'disabled'
              ? '업데이트 확인 비활성화'
              : '새 업데이트 발견'
  const updateDisplayMessage = updateState?.message
    ?? (updateState?.availableVersion
      ? `버전 ${updateState.availableVersion} 업데이트를 사용할 수 있습니다.`
      : '새 버전 업데이트를 사용할 수 있습니다.')
  const updateActionBusy = updateState?.status === 'checking' || updateState?.status === 'downloading'
  const updateActionLabel = updateState?.status === 'downloaded'
    ? '업데이트 적용'
    : updateState?.status === 'available'
      ? '업데이트 다운로드'
      : updateState?.status === 'downloading'
        ? `다운로드 ${updateProgress}%`
        : updateState?.status === 'checking'
          ? '확인 중'
          : '업데이트 확인'

  if (loading) {
    return <div className="app" data-theme={theme} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-4)', fontSize: 13 }}>로드 중…</div>
  }

  return (
    <div className="app" data-theme={theme}>
      {updateNoticeVisible && updateState && (
        <div className="update-notice no-drag">
          <div className="update-notice-main">
            <div className="update-notice-title">{updateDisplayTitle}</div>
            <div className="update-notice-message">
              {updateDisplayMessage}
              {updateState.availableVersion && (
                <span className="update-notice-version">
                  현재 {updateState.currentVersion} → 최신 {updateState.availableVersion}
                </span>
              )}
            </div>
            {updateState.status === 'downloading' && (
              <div className="update-progress" aria-label={`업데이트 다운로드 ${updateProgress}%`}>
                <div className="update-progress-bar" style={{ width: `${updateProgress}%` }} />
              </div>
            )}
          </div>
          <div className="update-notice-actions">
            {updateState.status === 'available' && (
              <button className="btn" onClick={() => { void window.api.update.download() }}>
                다운로드
              </button>
            )}
            {updateState.status === 'downloaded' && (
              <button className="btn primary" onClick={() => { void window.api.update.install() }}>
                재시작 후 적용
              </button>
            )}
            <button
              className="btn ghost"
              onClick={() => {
                setUpdateNoticeHidden(true)
                setManualUpdateRequested(false)
              }}
            >
              나중에
            </button>
          </div>
        </div>
      )}
      {/* ── Sidebar ── */}
      <aside
        ref={sidebarRef}
        className="sidebar"
        data-layout={isFull ? undefined : 'icons'}
        style={isFull ? { width: sidebarWidth } : undefined}
      >
        <div className="sidebar-hd">
          {isFull ? (
            <>
              <div className="sidebar-brand">
                <div className="brand-mark">a8a</div>
                <span className="brand-name">a8a</span>
                <span className="brand-version">{updateState?.currentVersion ? `ver. ${updateState.currentVersion}` : ''}</span>
              </div>
              <button
                className="btn ghost icon"
                style={{ width: 26, height: 26 }}
                onClick={() => setSidebarLayout('icons')}
                title="사이드바 접기"
              >
                <IcoPanelL size={14} />
              </button>
            </>
          ) : (
            <button
              className="btn ghost icon sidebar-expand-btn"
              onClick={() => setSidebarLayout('full')}
              title="사이드바 펼치기"
            >
              <IcoPanelL size={15} />
            </button>
          )}
        </div>

        {!isFull && (
          <div className="sidebar-icons-projects">
            {workspaces.map(ws =>
              ws.projects.length > 0 ? (
                <div key={ws.id} className="sidebar-icons-ws-group">
                  {ws.projects.map(proj => (
                    <button
                      key={proj.id}
                      className={`sidebar-proj-icon${proj.id === activeProjectId ? ' sidebar-proj-icon-active' : ''}`}
                      onMouseEnter={e => {
                        const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect()
                        setIconTooltip({ text: `${ws.name} › ${proj.name}`, x: rect.right + 8, y: rect.top + rect.height / 2 })
                      }}
                      onMouseLeave={() => setIconTooltip(null)}
                      onClick={() => selectProject(ws.id, proj.id)}
                    >
                      {proj.name.charAt(0).toUpperCase()}
                    </button>
                  ))}
                </div>
              ) : null
            )}
          </div>
        )}

        {isFull && (
          <div className="sidebar-body">
            <WorkspaceHeader
              workspaces={workspaces}
              activeId={activeWsId}
              onSelect={setActiveWsId}
              onAdd={() => setModalWorkspace({ workspace: null })}
              onEditRequest={(id) => {
                const ws = workspaces.find(w => w.id === id)
                if (ws) setModalWorkspace({ workspace: { id: ws.id, name: ws.name, description: ws.description } })
              }}
              onDeleteRequest={setConfirmDeleteWsId}
              renderContent={(wsId) => {
                const ws = workspaces.find(w => w.id === wsId)
                return (
                  <>
                    <EnvSection
                      environments={ws?.environments ?? []}
                      activeEnvId={ws?.activeEnvId ?? ''}
                      onAdd={() => openAddEnvModal(wsId)}
                      onEdit={(env) => openEditEnvModal(wsId, env)}
                      onDelete={(env) => setConfirmDeleteEnv({ wsId, env })}
                    />
                    <ProjectSection
                      projects={ws?.projects ?? []}
                      activeProjectId={activeProjectId}
                      onSelect={(id) => selectProject(wsId, id)}
                      onAdd={() => openAddProjectModal(wsId)}
                      onEdit={(proj) => openEditProjectModal(wsId, proj)}
                      onDelete={(proj) => setConfirmDeleteProject({ wsId, project: proj })}
                    />
                  </>
                )
              }}
            />
            <ModulePaletteSection stateKey="common-module" title="공통 모듈" />
          </div>
        )}

        {isFull && (
          <div
            className="sidebar-resize-handle"
            onMouseDown={() => {
              isResizing.current = true
              document.body.style.cursor = 'col-resize'
              document.body.style.userSelect = 'none'
            }}
          />
        )}
      </aside>

      {/* ── Workspace area ── */}
      <div className="workspace">
        <header className="topbar">
          <div className="topbar-left no-drag">
            {activeProject && (
              <div className="topbar-breadcrumb">
                {activeProjectEnv && activeProjectWs && (
                  <div className="topbar-env-picker">
                    <button
                      ref={envBtnRef}
                      className="topbar-env-btn"
                      onClick={() => {
                        const rect = envBtnRef.current?.getBoundingClientRect()
                        if (rect) setEnvDropdownPos({ top: rect.bottom + 6, left: rect.left })
                        setEnvDropdownOpen(o => !o)
                      }}
                      title="환경 변경"
                    >
                      <span className="topbar-bc-env-dot" style={{ background: activeProjectEnv.color }} />
                      <span className="topbar-bc-env" style={{ color: activeProjectEnv.color }}>{activeProjectEnv.name}</span>
                      <IcoChevD size={10} style={{ color: 'var(--text-4)', marginLeft: 2 }} />
                    </button>
                  </div>
                )}
                <span className="topbar-bc-sep topbar-bc-divider">|</span>
                <span className="topbar-bc-ws">{activeProjectWs?.name}</span>
                <span className="topbar-bc-sep">›</span>
                <span className="topbar-bc-proj">{activeProject.name}</span>
              </div>
            )}
          </div>
          <div className="topbar-right no-drag">
            <button
              className="btn topbar-update-btn"
              onClick={() => { void handleUpdateAction() }}
              disabled={updateActionBusy}
              title="최신 버전 확인"
            >
              <IcoDownload size={13} />
              {updateActionLabel}
            </button>
            <button className="btn ghost icon" onClick={toggleTheme} title={theme === 'dark' ? '라이트 테마' : '다크 테마'}>
              {theme === 'dark' ? <IcoSun size={15} /> : <IcoMoon size={15} />}
            </button>
            <button className="btn" onClick={() => {}}>
              <IcoSave size={14} />
              저장
            </button>
            {Object.keys(nodeStatuses).length > 0 ? (
              <button className="btn" onClick={handleCanvasReset}>
                <IcoReset size={13} />
                초기화
              </button>
            ) : (
              <button className="btn primary" onClick={handleCanvasRun}>
                <IcoPlay size={13} />
                실행
              </button>
            )}
          </div>
        </header>

        <div className="workspace-body">
          {activeProject ? (
            <div className="canvas-wrap">
              <div className="canvas-bg" />
              <WorkflowCanvas
                  nodes={activeNodes}
                  edges={activeEdges}
                  onNodeMove={handleNodeMove}
                  onEdgeCreate={handleEdgeCreate}
                  onEdgeDelete={id => setConfirmDeleteEdge(activeEdges.find(e => e.id === id) ?? null)}
                  onEdgeReconnect={handleEdgeReconnect}
                  onNodeRun={handleNodeRun}
                  onNodeOpen={handleNodeOpen}
                  onNodeCopy={handleCanvasNodeCopy}
                  onNodePaste={handleCanvasNodePaste}
                  onNodeDeleteRequest={handleCanvasNodeDeleteRequest}
                  canPasteNode={!!copiedCanvasSelection && copiedCanvasSelection.nodes.length > 0}
                  onModuleDrop={handleModuleDrop}
                  nodeStatuses={nodeStatuses}
                  branchRoutes={activeBranchRoutes}
                  endNodePnrValues={endNodePnrValues}
                  onNodeStatusClick={onNodeStatusClick}
                />
            </div>
          ) : (
            <div className="workspace-empty">
              <span>프로젝트를 선택하거나 추가하세요</span>
            </div>
          )}
        </div>

        <div className={`log-panel ${logState === 'collapsed' ? 'log-panel-collapsed' : 'log-panel-fullscreen'}`}>
          <div className="log-hd" onClick={toggleLog}>
            <IcoPanelB size={13} style={{ color: 'var(--text-3)' }} />
            <span className="log-title">실행 로그</span>
            <span className="log-spacer" />
            {execLogs.length > 0 && (
              <button
                className="btn ghost log-report-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  void handleDownloadExecutionReport()
                }}
                disabled={downloadingReport}
                title="HTML 상세 리포트 다운로드"
              >
                <IcoSave size={12} />
                HTML
              </button>
            )}
            <IcoChevD
              size={14}
              style={{
                color: 'var(--text-3)',
                transform: logState === 'fullscreen' ? 'rotate(180deg)' : 'none',
                transition: 'transform 0.15s'
              }}
            />
          </div>
          {logState === 'fullscreen' && (
            <div className="log-body">
              {execLogs.length === 0 ? (
                <span className="log-empty">실행하면 로그가 표시됩니다</span>
              ) : (
                <div className="log-entries">
                  {execLogs.map(entry => (
                    <LogEntryRow key={entry.id} entry={entry} isActive={activeLogNodeId === entry.nodeId} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Env Dropdown (fixed) ── */}
      {envDropdownOpen && activeProjectWs && (
        <div
          ref={envDropdownRef}
          className="topbar-env-dropdown"
          style={{ position: 'fixed', top: envDropdownPos.top, left: envDropdownPos.left }}
        >
          {activeProjectWs.environments.map(env => (
            <button
              key={env.id}
              className={`topbar-env-option${env.id === activeProjectWs.activeEnvId ? ' topbar-env-option-active' : ''}`}
              onClick={() => { setActiveEnvId(activeProjectWs.id, env.id); setEnvDropdownOpen(false) }}
            >
              <span className="topbar-bc-env-dot" style={{ background: env.color }} />
              <span>{env.name}</span>
            </button>
          ))}
        </div>
      )}

      {savedReport && (
        <div className="modal-overlay" onClick={() => setSavedReport(null)}>
          <div className="report-saved-dialog" onClick={e => e.stopPropagation()}>
            <div className="confirm-hd">
              <span className="confirm-title">보고서 생성 완료</span>
              <button className="btn ghost icon" onClick={() => setSavedReport(null)} title="닫기">
                <IcoX size={15} />
              </button>
            </div>
            <div className="report-saved-body">
              <p className="confirm-message">보고서가 생성 되었습니다.</p>
              <p className="confirm-message">파일을 여시겠습니까?</p>
              <div className="report-saved-path" title={savedReport.path}>{savedReport.path}</div>
            </div>
            <div className="confirm-ft">
              <button className="btn" onClick={() => setSavedReport(null)}>취소</button>
              <button
                className="btn primary"
                onClick={() => { void handleOpenSavedReport() }}
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Workspace Modal ── */}
      {modalWorkspace !== null && (
        <WorkspaceModal
          workspace={modalWorkspace.workspace}
          environments={modalWorkspace.workspace ? workspaces.find(w => w.id === modalWorkspace.workspace!.id)?.environments : undefined}
          projects={modalWorkspace.workspace ? workspaces.find(w => w.id === modalWorkspace.workspace!.id)?.projects : undefined}
          onSave={saveWorkspace}
          onClose={() => setModalWorkspace(null)}
        />
      )}

      {/* ── Env Modal ── */}
      {modalEnv !== undefined && (
        <EnvModal env={modalEnv} onSave={saveEnv} onClose={closeEnvModal} />
      )}

      {/* ── Project Modal ── */}
      {modalProject !== null && (
        <ProjectModal
          project={modalProject.project}
          onSave={saveProject}
          onClose={closeProjectModal}
        />
      )}

      {/* ── Workspace Delete Confirm ── */}
      {confirmDeleteWsId && (() => {
        const ws = workspaces.find(w => w.id === confirmDeleteWsId)
        return ws ? (
          <ConfirmDialog
            title="워크스페이스 삭제"
            message={`"${ws.name}" 워크스페이스를 삭제하시겠습니까?`}
            warning="이 작업은 되돌릴 수 없으며, 워크스페이스에 포함된 모든 Environment와 Project가 함께 삭제됩니다."
            onConfirm={deleteWorkspace}
            onCancel={() => setConfirmDeleteWsId(null)}
          />
        ) : null
      })()}

      {/* ── Env Delete Confirm ── */}
      {confirmDeleteEnv && (
        <ConfirmDialog
          title="환경 삭제"
          message={`"${confirmDeleteEnv.env.name}" 환경을 삭제하시겠습니까?`}
          warning="이 작업은 되돌릴 수 없으며, 환경에 포함된 모든 변수가 함께 삭제됩니다."
          onConfirm={deleteEnv}
          onCancel={() => setConfirmDeleteEnv(null)}
        />
      )}

      {/* ── Project Delete Confirm ── */}
      {confirmDeleteCanvasNode && (
        <ConfirmDialog
          title="캔버스 모듈 삭제"
          message={`"${confirmDeleteCanvasNode.label}" 모듈을 캔버스에서 삭제하시겠습니까?`}
          warning="현재 캔버스에 배치된 독립 모듈과 연결선만 삭제됩니다."
          confirmLabel="삭제"
          onConfirm={async () => {
            const node = confirmDeleteCanvasNode
            setConfirmDeleteCanvasNode(null)
            await deleteCanvasNodeInstance(node)
          }}
          onCancel={() => setConfirmDeleteCanvasNode(null)}
        />
      )}

      {confirmDeleteProject && (
        <ConfirmDialog
          title="프로젝트 삭제"
          message={`"${confirmDeleteProject.project.name}" 프로젝트를 삭제하시겠습니까?`}
          warning="이 작업은 되돌릴 수 없으며, 프로젝트에 포함된 모든 데이터가 함께 삭제됩니다."
          onConfirm={deleteProject}
          onCancel={() => setConfirmDeleteProject(null)}
        />
      )}

      {/* ── Node Settings Modal ── */}
      {editingNode?.type === 'start' && (
        <StartNodeModal
          key={editingNode.id}
          node={editingNode}
          onSave={handleNodeSave}
          onClose={() => setEditingNode(null)}
        />
      )}

      {editingNode?.type === 'end' && (() => {
        const connectedIds = new Set(buildExecutionPlan(activeNodes, activeEdges))
        // Modules listed in the End modal are restricted to nodes reachable
        // from Start in edge-connected order. Disconnected modules can't be
        // selected and aren't part of the report.
        const ordered = buildExecutionPlan(activeNodes, activeEdges)
          .map(id => activeNodes.find(n => n.id === id))
          .filter((n): n is ApiNode => !!n && n.type !== 'start' && n.type !== 'end' && connectedIds.has(n.id))
          .map(n => ({ id: n.id, label: n.label, type: n.type }))
        return (
          <EndNodeModal
            key={editingNode.id}
            node={editingNode}
            moduleNodes={ordered}
            onSave={handleDataNodeSave}
            onClose={() => setEditingNode(null)}
          />
        )
      })()}

      {editingNode?.type === 'data' && (
        <DataNodeModal
          key={editingNode.id}
          node={editingNode}
          initialInput={nodeRunInputs[editingNode.id]}
          onRun={() => previewUpToNode(editingNode.id)}
          onSave={handleDataNodeSave}
          onDelete={async () => {
            await window.api.node.delete(editingNode.id)
            setActiveNodes(prev => prev.filter(n => n.id !== editingNode.id))
            setActiveEdges(prev => prev.filter(e => e.sourceNodeId !== editingNode.id && e.targetNodeId !== editingNode.id))
            setEditingNode(null)
          }}
          onClose={() => setEditingNode(null)}
        />
      )}

      {editingNode?.type === 'select' && (
        <SelectNodeModal
          key={editingNode.id}
          node={editingNode}
          initialInput={nodeRunInputs[editingNode.id]}
          onRun={() => previewUpToNode(editingNode.id)}
          onSave={handleDataNodeSave}
          onDelete={async () => {
            await window.api.node.delete(editingNode.id)
            setActiveNodes(prev => prev.filter(n => n.id !== editingNode.id))
            setActiveEdges(prev => prev.filter(e => e.sourceNodeId !== editingNode.id && e.targetNodeId !== editingNode.id))
            setEditingNode(null)
          }}
          onClose={() => setEditingNode(null)}
        />
      )}

      {editingNode?.type === 'branch' && (
        <BranchNodeModal
          key={editingNode.id}
          node={editingNode}
          initialInput={nodeRunInputs[editingNode.id]}
          onRun={async () => {
            const inputJson = await previewUpToNode(editingNode.id)
            setNodeRunInputs(prev => ({ ...prev, [editingNode.id]: inputJson }))
            return inputJson
          }}
          onSave={handleDataNodeSave}
          onDelete={async () => {
            await window.api.node.delete(editingNode.id)
            setActiveNodes(prev => prev.filter(n => n.id !== editingNode.id))
            setActiveEdges(prev => prev.filter(e => e.sourceNodeId !== editingNode.id && e.targetNodeId !== editingNode.id))
            setEditingNode(null)
          }}
          onClose={() => setEditingNode(null)}
        />
      )}

      {editingNode?.type === 'api' && (
        <ApiNodeModal
          key={editingNode.id}
          node={editingNode}
          initialInput={nodeRunInputs[editingNode.id]}
          initialOutput={nodeRunOutputs[editingNode.id]}
          initialPreConsoleLogs={nodeScriptLogs[editingNode.id]?.pre}
          initialPostConsoleLogs={nodeScriptLogs[editingNode.id]?.post}
          envVars={activeProjectEnvVars}
          onRun={() => previewUpToNode(editingNode.id)}
          onSave={handleDataNodeSave}
          onDelete={async () => {
            await window.api.node.delete(editingNode.id)
            setActiveNodes(prev => prev.filter(n => n.id !== editingNode.id))
            setActiveEdges(prev => prev.filter(e => e.sourceNodeId !== editingNode.id && e.targetNodeId !== editingNode.id))
            setEditingNode(null)
          }}
          onClose={() => setEditingNode(null)}
        />
      )}

      {/* ── Canvas Execution SelectionPopup ── */}
      {canvasExecution?.pendingSelectInput !== null && canvasExecution !== null && (() => {
        const pendingNodeId = canvasExecution.plan[canvasExecution.step - 1]
        const pendingNode = activeNodes.find(n => n.id === pendingNodeId)
        const pendingConfig = parseSelectConfig(pendingNode?.config ?? '{}')
        return (
          <SelectionPopup
            data={canvasExecution.pendingSelectInput}
            initialSelectedRowIndices={pendingConfig.selectedRowIndices}
            initialSelectedJsonPaths={pendingConfig.selectedJsonPaths}
            initialMode={pendingConfig.selectMode}
            selectionType={pendingConfig.selectionType ?? 'multiple'}
            onConfirm={(selectedRows, selection) => {
              const executionToResume = canvasExecution
              flushSync(() => {
                setCanvasExecution({
                  ...canvasExecution,
                  pendingSelectInput: null,
                  pendingBranchChoice: null,
                })
              })
              window.requestAnimationFrame(() => {
                window.requestAnimationFrame(() => {
                  void advanceExecution(executionToResume, selectedRows, selection)
                })
              })
            }}
            onCancel={() => setCanvasExecution(null)}
          />
        )
      })()}

      {canvasExecution?.pendingBranchChoice && canvasExecution !== null && (() => {
        const pendingNodeId = canvasExecution.plan[canvasExecution.step - 1]
        const pendingNode = activeNodes.find(n => n.id === pendingNodeId)
        return (
          <BranchChoicePopup
            title={pendingNode?.label ?? 'Branch'}
            trueLabel={canvasExecution.pendingBranchChoice.trueLabel}
            falseLabel={canvasExecution.pendingBranchChoice.falseLabel}
            defaultRoute={canvasExecution.pendingBranchChoice.defaultRoute}
            onConfirm={route => {
              const executionToResume = canvasExecution
              flushSync(() => {
                setCanvasExecution({
                  ...canvasExecution,
                  pendingSelectInput: null,
                  pendingBranchChoice: null,
                })
              })
              window.requestAnimationFrame(() => {
                window.requestAnimationFrame(() => {
                  void advanceExecution(executionToResume, undefined, undefined, route)
                })
              })
            }}
            onCancel={() => setCanvasExecution(null)}
          />
        )
      })()}

      {/* ── Preview Mode SelectionPopup ── */}
      {pendingPreviewSelect && (
        <SelectionPopup
          data={pendingPreviewSelect.data}
          initialSelectedRowIndices={pendingPreviewSelect.config.selectedRowIndices}
          initialSelectedJsonPaths={pendingPreviewSelect.config.selectedJsonPaths}
          initialMode={pendingPreviewSelect.config.selectMode}
          selectionType={pendingPreviewSelect.config.selectionType ?? 'multiple'}
          onConfirm={(rows, selection) => {
            pendingPreviewSelect.resolve({ rows, selection })
            setPendingPreviewSelect(null)
          }}
          onCancel={() => {
            pendingPreviewSelect.resolve(null)
            setPendingPreviewSelect(null)
          }}
        />
      )}

      {/* ── Edge Delete Confirm ── */}
      {confirmDeleteEdge && (
        <ConfirmDialog
          title="연결 삭제"
          message="이 연결선을 삭제하시겠습니까?"
          warning="삭제된 연결은 복구할 수 없습니다."
          onConfirm={deleteEdge}
          onCancel={() => setConfirmDeleteEdge(null)}
        />
      )}

      {/* ── Icon Tooltip ── */}
      {iconTooltip && (
        <div
          className="sidebar-icon-tooltip"
          style={{ top: iconTooltip.y, left: iconTooltip.x }}
        >
          {iconTooltip.text}
        </div>
      )}
    </div>
  )
}
