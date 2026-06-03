import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { flushSync } from 'react-dom'
import { applyInputMappings, mergeEnvVars, parseTemplate, resolveInputExpression, resolveTemplate } from './utils/interpolate'
import { applyApiAuth, getApiAuthTemplateValues } from './utils/apiAuth'
import { isScriptRuntimeError, runPreRequest, runPostResponse } from './utils/scriptRuntime'
import { generateReport, fillFilenameTemplate } from './utils/reportGenerator'
import type { ReportNode, ReportApiDetail, ReportVariable } from './utils/reportGenerator'
import { resolveEndReportSelectedModuleIds } from './utils/endReportSelection'
import type { ScriptConsoleEntry } from './utils/scriptRuntime'
import { IcoPanelL, IcoSave, IcoSun, IcoMoon, IcoPanelB, IcoChevD, IcoX, IcoDownload, IcoUpload, IcoSettings } from './components/Icon'
import WorkspaceHeader from './components/sidebar/WorkspaceHeader'
import ModulePaletteSection from './components/sidebar/ModulePaletteSection'
import ProjectSection from './components/sidebar/ProjectSection'
import ProjectModal from './components/sidebar/ProjectModal'
import ProjectCloneModal from './components/sidebar/ProjectCloneModal'
import WorkspaceModal from './components/sidebar/WorkspaceModal'
import EnvSection from './components/env/EnvSection'
import EnvModal from './components/env/EnvModal'
import ConfirmDialog from './components/ConfirmDialog'
import SettingsPage from './components/settings/SettingsPage'
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
import JsonInspectorButton from './components/canvas/JsonInspector'
import type { SelectionPopupSelection } from './components/canvas/SelectionPopup'
import { evaluateBranch, parseBranchConfig } from './utils/branch'
import type { Environment } from './components/env/EnvSection'
import type { ProjectItem } from './components/sidebar/ProjectModal'
import type { WorkspaceModalItem } from './components/sidebar/WorkspaceModal'
import { randomId } from './utils/id'
import { buildExcelWorkbookBase64 } from './utils/tabularData'
import {
  I18nProvider,
  detectSystemLanguage,
  isTranslationKey,
  loadLanguagePreference,
  resolveLanguagePreference,
  translate,
  useI18n,
  LANGUAGE_STORAGE_KEY,
  type AppLanguage,
  type LanguagePreference,
  type TranslationKey,
} from './i18n'

function sharedDataModuleIdFromConfig(rawConfig: string): string | null {
  try {
    const cfg = JSON.parse(rawConfig || '{}') as DataConfig & LegacyDataConfig
    return typeof cfg.sharedDataModuleId === 'string' && cfg.sharedDataModuleId.trim()
      ? cfg.sharedDataModuleId.trim()
      : null
  } catch { return null }
}

function sharedDataNodeConfig(moduleId: string): string {
  return JSON.stringify({ sharedDataModuleId: moduleId })
}

function stripSharedDataModuleMarker(rawConfig: string): string {
  try {
    const parsed = JSON.parse(rawConfig || '{}') as Record<string, unknown>
    delete parsed.sharedDataModuleId
    return JSON.stringify(parsed)
  } catch {
    return rawConfig
  }
}

function findCommonDataModule(modules: ApiModule[], moduleId: string | null): ApiModule | null {
  if (!moduleId) return null
  return modules.find(mod => mod.id === moduleId && mod.type === 'data' && mod.isCommon) ?? null
}

function effectiveDataConfig(rawConfig: string, commonDataModules: ApiModule[] = []): string {
  const sharedModule = findCommonDataModule(commonDataModules, sharedDataModuleIdFromConfig(rawConfig))
  return sharedModule?.config ?? rawConfig
}

// Read a DATA node's output value. Accepts both new shape (`{ output: string }`)
// and legacy shape (`{ items, excelData }`). On any failure returns an empty array.
function readDataNodeOutput(rawConfig: string, commonDataModules: ApiModule[] = []): unknown {
  try {
    const cfg = JSON.parse(effectiveDataConfig(rawConfig, commonDataModules) || '{}') as DataConfig & LegacyDataConfig
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

class ApiHttpError extends Error {
  output: unknown

  constructor(status: number, statusText: string, responseText: string) {
    super(`HTTP ${status}${statusText ? ` ${statusText}` : ''}`)
    this.name = 'ApiHttpError'
    this.output = parseHttpResponseOutput(responseText)
  }
}

function parseHttpResponseOutput(responseText: string): unknown {
  const trimmed = responseText.trim()
  if (!trimmed) return null
  try { return JSON.parse(trimmed) as unknown } catch { return responseText }
}

function stringifyNodeOutput(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
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
  persistedEnvVarsByEnvId?: Record<string, Environment['vars']>
  usedVariables: Record<string, ReportVariable>
  execLogs: LogEntry[]
  startedAt: number
  plan: string[]
  step: number
  loop?: ExecutionLoopContext
  pendingSelectInput: unknown | null
  pendingBranchChoice?: {
    input: unknown
    trueLabel: string
    falseLabel: string
    defaultRoute: 'true' | 'false'
  } | null
  pendingLogEntryId?: string | null
}

interface ExecutionLoopContext {
  startNodeId: string
  rows: Record<string, unknown>[]
  index: number
  total: number
  stopOnFailure: boolean
  logStartIndex: number
  iterationStartedAt: number
}

type EndNodeDisplayValue = {
  name: string
  value: string
}

type StartNodeLoopProgressValue = {
  current: number
  total: number
}

function usedVariableKey(kind: ReportVariable['kind'], name: string): string {
  return `${kind}:${name}`
}

function formatDisplayValue(value: unknown): string | null {
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

function extractEndNodeDisplayValues(
  selectedKeys: string[] | undefined,
  runtimeEnvVars: Record<string, string>,
  configuredEnvVars: Record<string, string>,
): EndNodeDisplayValue[] {
  const seen = new Set<string>()
  return (selectedKeys ?? [])
    .map(key => key.trim())
    .filter(Boolean)
    .filter(key => {
      const normalized = key.toLowerCase()
      if (seen.has(normalized)) return false
      seen.add(normalized)
      return true
    })
    .map(variable => {
      const rawValue = Object.prototype.hasOwnProperty.call(runtimeEnvVars, variable)
        ? runtimeEnvVars[variable]
        : configuredEnvVars[variable]
      const value = formatDisplayValue(rawValue)
      return value ? { name: variable, value } : null
    })
    .filter((item): item is EndNodeDisplayValue => !!item)
}

function appendRepeatNoSuffix(filename: string, no: unknown): string {
  const value = formatDisplayValue(no)
  return value ? `${filename} - ${value}` : filename
}

function safeDownloadFilePart(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim() || 'a8a'
}

function mergeConfiguredEnvVarsForDisplay(
  environments: Array<{ id: string; isBase: boolean; vars: Array<{ key: string; value: string }> }>,
  activeEnvId?: string,
): Record<string, string> {
  const result: Record<string, string> = {}
  const apply = (env?: { vars: Array<{ key: string; value: string }> }): void => {
    env?.vars.forEach(variable => {
      const key = variable.key.trim()
      if (key) result[key] = variable.value
    })
  }
  apply(environments.find(env => env.isBase))
  apply(environments.find(env => env.id === activeEnvId && !env.isBase))
  return result
}

function normalizeStartRepeat(raw: unknown): StartRepeatConfig {
  const parsed = raw && typeof raw === 'object' ? raw as Partial<StartRepeatConfig> : {}
  const data = parsed.data && typeof parsed.data === 'object'
    ? parsed.data as Partial<StartRepeatData>
    : null
  const rows = Array.isArray(data?.rows)
    ? data.rows.filter(row => row && typeof row === 'object' && !Array.isArray(row)) as Record<string, unknown>[]
    : []
  const columns = Array.isArray(data?.columns) ? data.columns.map(String).filter(Boolean) : []
  return {
    enabled: parsed.enabled === true,
    mode: parsed.mode === 'data' ? 'data' : 'count',
    count: Math.max(1, Math.floor(Number(parsed.count) || 1)),
    stopOnFailure: parsed.stopOnFailure !== false,
    data: data && rows.length > 0
      ? {
          fileName: typeof data.fileName === 'string' ? data.fileName : 'data',
          columns: columns.length > 0 ? columns : Array.from(new Set(rows.flatMap(row => Object.keys(row)))),
          rows: rows.map((row, index) => {
            const { no: _reservedNo, ...rest } = row
            return { no: index + 1, ...rest }
          }),
        }
      : null,
  }
}

function parseStartConfig(raw: string): StartConfig {
  try {
    const parsed = JSON.parse(raw || '{}') as Partial<StartConfig>
    return {
      mode: parsed.mode === 'schedule' ? 'schedule' : 'manual',
      schedule: parsed.schedule as StartSchedule,
      repeat: normalizeStartRepeat(parsed.repeat),
    }
  } catch {
    return {
      mode: 'manual',
      schedule: {
        type: 'daily',
        time: '09:00',
        weekdays: [1],
        monthDay: 1,
        cron: '0 9 * * *',
      },
      repeat: normalizeStartRepeat(null),
    }
  }
}

type RepeatRowsResult =
  | { ok: true; rows: Record<string, unknown>[] | null; stopOnFailure: boolean }
  | { ok: false; error: string }

function buildRepeatRows(startNode: ApiNode | undefined, missingDataMessage = 'START repeat data is empty. Attach the data again.'): RepeatRowsResult {
  if (!startNode) return { ok: true, rows: null, stopOnFailure: true }
  const repeat = parseStartConfig(startNode.config).repeat
  if (!repeat?.enabled) return { ok: true, rows: null, stopOnFailure: true }
  if (repeat.mode === 'data') {
    const rows = repeat.data?.rows ?? []
    if (rows.length === 0) return { ok: false, error: missingDataMessage }
    return { ok: true, rows, stopOnFailure: repeat.stopOnFailure }
  }
  return {
    ok: true,
    rows: Array.from({ length: Math.max(1, repeat.count) }, (_, index) => ({ no: index + 1 })),
    stopOnFailure: repeat.stopOnFailure,
  }
}

function getStartRepeatPreviewRow(startNode: ApiNode | undefined): Record<string, unknown> | null {
  const result = buildRepeatRows(startNode)
  if (!result.ok || !result.rows || result.rows.length === 0) return null
  return result.rows[0]
}

function repeatExecutionSignature(config: string): string {
  const repeat = parseStartConfig(config).repeat
  if (!repeat?.enabled) return ''
  return JSON.stringify({
    mode: repeat.mode,
    count: repeat.count,
    stopOnFailure: repeat.stopOnFailure,
    data: repeat.mode === 'data' && repeat.data
      ? {
          fileName: repeat.data.fileName,
          columns: repeat.data.columns,
          rows: repeat.data.rows,
        }
      : null,
  })
}

function recordUsedTemplateVariables(
  usedVariables: Record<string, ReportVariable>,
  templates: string[],
  envVars: Record<string, string>,
  inputData: Record<string, unknown>,
  dataVars: Record<string, unknown> = inputData,
): void {
  templates
    .filter(template => template.trim().length > 0)
    .forEach(template => {
      parseTemplate(template, envVars, inputData, dataVars).forEach(token => {
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
        if (token.type === 'data') {
          const value = resolveInputExpression(dataVars, token.key)
          usedVariables[usedVariableKey('data', token.key)] = {
            kind: 'data',
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
  kind: Extract<ReportVariable['kind'], 'input' | 'data'> = 'input',
): void {
  const trimmed = name.trim()
  if (!trimmed) return
  const value = resolveInputExpression(inputData, trimmed)
  usedVariables[usedVariableKey(kind, trimmed)] = {
    kind,
    name: trimmed,
    value: value === undefined ? null : value,
  }
}

function recordUsedBranchVariables(
  usedVariables: Record<string, ReportVariable>,
  expression: string,
  input: unknown,
  dataVars?: Record<string, unknown>,
): void {
  const inputData = input && typeof input === 'object' ? input as Record<string, unknown> : { value: input }
  const dataInput = dataVars ?? inputData
  const comparison = expression.match(/^\s*(?:\[\[([\s\S]*?)\]\]|<<([\s\S]*?)>>)\s*(?:===|!==|==|!=|>=|<=|>|<)\s*([\s\S]+?)\s*$/)
  if (comparison) {
    const isData = comparison[2] !== undefined
    recordUsedInputVariable(usedVariables, comparison[1] ?? comparison[2], isData ? dataInput : inputData, isData ? 'data' : 'input')
    return
  }

  const singleValue = expression.match(/^\s*(?:\[\[([\s\S]*?)\]\]|<<([\s\S]*?)>>)\s*$/)
  const isData = singleValue?.[2] !== undefined
  recordUsedInputVariable(
    usedVariables,
    singleValue ? (singleValue[1] ?? singleValue[2]) : expression,
    isData ? dataInput : inputData,
    isData ? 'data' : 'input',
  )
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
  placeholder,
}: {
  value: unknown
  path: string
  placeholder?: string
}): JSX.Element {
  const { t } = useI18n()
  const formatted = formatLogJsonValue(value)
  const resolvedPlaceholder = placeholder ?? t('log.placeholder.json')
  const lowerPath = path.toLowerCase()
  const title = lowerPath.includes('input') ? 'INPUT' : lowerPath.includes('output') || lowerPath.includes('response') ? 'OUTPUT' : 'JSON'
  return (
    <div className="log-json-viewer-shell" style={{ height: getLogJsonViewerHeight(formatted) }}>
      <div className="log-json-viewer-actions">
        <JsonInspectorButton title={title} value={formatted} disabled={!formatted.trim()} />
      </div>
      <div className="log-json-viewer">
        <JsonMonacoEditor
          value={formatted}
          readOnly
          path={path}
          placeholder={resolvedPlaceholder}
        />
      </div>
    </div>
  )
}

function LogEntryRow({ entry, isActive }: { entry: LogEntry; isActive?: boolean }): JSX.Element {
  const { t } = useI18n()
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
          {entry.status === 'running' ? t('log.status.running') : entry.status === 'success' ? t('log.status.success') : entry.status === 'error' ? t('log.status.error') : t('log.status.skip')}
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
                      <LogJsonViewer value={entry.input} path={`execution-log/${entry.id}/api-input.json`} placeholder={t('log.placeholder.input')} />
                    </div>
                  )}
                  {entry.output !== null && entry.output !== undefined && (
                    <div className="log-entry-io-col">
                      <div className="log-entry-io-label">OUTPUT</div>
                      <LogJsonViewer value={entry.output} path={`execution-log/${entry.id}/api-output.json`} placeholder={t('log.placeholder.output')} />
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
                    <LogJsonViewer value={api.body} path={`execution-log/${entry.id}/request-body.json`} placeholder={t('log.placeholder.requestBody')} />
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
                      <LogJsonViewer value={api.responseText} path={`execution-log/${entry.id}/response-body.json`} placeholder={t('log.placeholder.responseBody')} />
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
                <LogJsonViewer value={entry.input ?? null} path={`execution-log/${entry.id}/input.json`} placeholder={t('log.placeholder.input')} />
              </div>
              {entry.output !== undefined && (
                <div className="log-entry-io-col">
                  <div className="log-entry-io-label">OUTPUT</div>
                  <LogJsonViewer value={entry.output} path={`execution-log/${entry.id}/output.json`} placeholder={t('log.placeholder.output')} />
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
type SelectSelectionType = NonNullable<SelectConfig['selectionType']>

function hasSelectPreRequestScript(script?: string): boolean {
  return typeof script === 'string' && script.trim().length > 0
}

function resolveSelectSelectionType(selectionType: unknown, preScript: string): SelectSelectionType {
  if (hasSelectPreRequestScript(preScript)) return 'script'
  return selectionType === 'single' ? 'single' : 'multiple'
}

function manualSelectionPopupType(selectionType: SelectConfig['selectionType']): 'multiple' | 'single' {
  return selectionType === 'single' ? 'single' : 'multiple'
}

function buildSelectScriptOutput(inputVars: Record<string, unknown>): unknown {
  const entries = Object.entries(inputVars)
  if (entries.length === 0) return []
  if (entries.length === 1) return entries[0][1]
  return { ...inputVars }
}

function parseSelectConfig(raw: string): SelectConfig {
  try {
    const parsed = JSON.parse(raw || '{}') as Partial<SelectConfig>
    const preScript = typeof parsed.preScript === 'string' ? parsed.preScript : ''
    const postScript = typeof parsed.postScript === 'string' ? parsed.postScript : ''
    return {
      ...parsed,
      selectedRowIndices: Array.isArray(parsed.selectedRowIndices) ? parsed.selectedRowIndices : [],
      selectedJsonPaths: Array.isArray(parsed.selectedJsonPaths) ? parsed.selectedJsonPaths : [],
      selectMode: parsed.selectMode === 'json' ? 'json' : parsed.selectMode === 'table' ? 'table' : undefined,
      selectionType: resolveSelectSelectionType(parsed.selectionType, preScript),
      autoSelect: parsed.autoSelect === true,
      preScript,
      postScript,
    }
  } catch {
    return { selectedRowIndices: [], selectedJsonPaths: [], selectionType: 'multiple', autoSelect: false, preScript: '', postScript: '' }
  }
}

function selectedRowIndicesForConfig(config: SelectConfig): number[] {
  const indices = config.selectedRowIndices ?? []
  if (config.selectionType === 'script') return []
  return config.selectionType === 'single' ? indices.slice(0, 1) : indices
}

function selectedJsonPathsForConfig(config: SelectConfig): string[] {
  const paths = config.selectedJsonPaths ?? []
  if (config.selectionType === 'script') return []
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

function executeNodeOutput(nodeId: string, nodes: ApiNode[], edges: ApiEdge[], commonDataModules: ApiModule[] = [], visiting = new Set<string>()): string {
  if (visiting.has(nodeId)) return JSON.stringify({ __previewError: 'A circular connection was detected.' }, null, 2)
  const node = nodes.find(n => n.id === nodeId)
  if (!node) return '[]'
  const validEdges = getValidWorkflowEdges(nodes, edges)
  const inEdge = validEdges.find(e => e.targetNodeId === nodeId)
  const nextVisiting = new Set(visiting)
  nextVisiting.add(nodeId)
  const upstreamJson = inEdge ? executeNodeOutput(inEdge.sourceNodeId, nodes, validEdges, commonDataModules, nextVisiting) : '[]'
  if (node.type === 'data') {
    return JSON.stringify(readDataNodeOutput(node.config, commonDataModules), null, 2)
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

function normalizeEdgeSourcePort(sourceType: ApiNode['type'] | undefined, sourcePort?: string | null): string | null {
  if (sourceType !== 'branch') return null
  return sourcePort === 'false' ? 'false' : 'true'
}

function canConnectEdge(
  nodes: ApiNode[],
  edges: ApiEdge[],
  sourceId: string,
  targetId: string,
  sourcePort?: string | null,
  replacedEdgeIds?: string | string[],
): boolean {
  if (sourceId === targetId) return false
  const source = nodes.find(n => n.id === sourceId)
  const target = nodes.find(n => n.id === targetId)
  if (!source || !target) return false
  if (source.type === 'end' || target.type === 'start') return false
  const nextEdges = getValidWorkflowEdges(nodes, edges, replacedEdgeIds)
  const normalizedSourcePort = normalizeEdgeSourcePort(source.type, sourcePort)
  if (nextEdges.some(e =>
    e.sourceNodeId === sourceId
    && e.targetNodeId === targetId
    && normalizeEdgeSourcePort(source.type, e.sourcePort) === normalizedSourcePort
  )) return false
  if (source.type === 'start' && nextEdges.some(e => e.sourceNodeId === sourceId)) return false
  if (!allowsMultipleIncoming(target.type) && nextEdges.some(e => e.targetNodeId === targetId)) return false
  return !wouldCreateCycle(nextEdges, sourceId, targetId)
}

function allowsMultipleIncoming(type: string): boolean {
  return type === 'api' || type === 'branch' || type === 'end'
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
  if (node.type === 'api' || node.type === 'end' || (node.type === 'branch' && incomingEdges.length > 1)) {
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

function buildRuntimeInputContext(
  rawInput: unknown,
  upstreamModuleVars: Record<string, unknown>,
): unknown {
  if (Object.keys(upstreamModuleVars).length === 0) return rawInput
  if (Array.isArray(rawInput)) {
    return Object.assign([...rawInput], upstreamModuleVars)
  }
  if (rawInput && typeof rawInput === 'object') {
    return { ...(rawInput as Record<string, unknown>), ...upstreamModuleVars }
  }
  return { value: rawInput, ...upstreamModuleVars }
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

function appendApiExecutionResult(
  results: unknown[],
  value: unknown,
): void {
  if (Array.isArray(value)) {
    results.push(...value)
    return
  }
  results.push(value)
}

function normalizeApiExecutionOutput(results: unknown[]): unknown {
  return results.length === 1 ? results[0] : results
}

type Theme = 'dark' | 'light'
type SidebarLayout = 'full' | 'icons'
type AppView = 'canvas' | 'settings'
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
type CanvasSnapshot = { nodes: ApiNode[]; edges: ApiEdge[] }
type CanvasHistoryEntry = { before: CanvasSnapshot; after: CanvasSnapshot }
type CanvasHistoryState = { undo: CanvasHistoryEntry[]; redo: CanvasHistoryEntry[] }
type CanvasNodeMove = { id: string; x: number; y: number }

const CANVAS_GRID_SIZE = 10
const MODULE_NODE_DEFAULT_WIDTH = 200
const MODULE_NODE_DEFAULT_HEIGHT = 72
const MODULE_NODE_LABEL_HORIZONTAL_CHROME = 28 + 10 + 28
const CANVAS_HISTORY_LIMIT = 10

function isCanvasModuleType(type: string): type is CanvasModuleType {
  return type === 'data' || type === 'select' || type === 'api' || type === 'branch'
}

function defaultCanvasNodeLabel(type: string): string {
  if (type === 'select') return 'SELECT'
  if (type === 'api') return 'API'
  if (type === 'branch') return 'BRANCH'
  return 'DATA'
}

function projectIconSeed(name: string, fallbackIndex: number): string {
  const trimmed = name.trim()
  const withoutOrderPrefix = trimmed.replace(/^[\s\d._-]+/, '')
  const source = withoutOrderPrefix || trimmed || String(fallbackIndex + 1)
  const token = source.split(/[\s._/\\|-]+/).find(part => /\D/.test(part)) ?? source
  const chars = Array.from(token)
    .filter(ch => /[0-9A-Za-z\u3131-\u318E\uAC00-\uD7A3]/.test(ch))
    .join('')
  return (chars || String(fallbackIndex + 1)).replace(/[a-z]/g, ch => ch.toUpperCase())
}

function buildProjectIconLabels(projects: ProjectItem[]): Map<string, string> {
  const seeds = projects.map((project, index) => projectIconSeed(project.name, index))
  const labels = new Map<string, string>()

  projects.forEach((project, index) => {
    const seed = seeds[index] || String(index + 1)
    for (let len = 1; len <= 3; len += 1) {
      const candidate = Array.from(seed).slice(0, len).join('')
      const duplicate = seeds.some((otherSeed, otherIndex) => (
        otherIndex !== index && Array.from(otherSeed).slice(0, len).join('') === candidate
      ))
      if (!duplicate) {
        labels.set(project.id, candidate)
        return
      }
    }

    const suffix = String(index + 1)
    const base = Array.from(seed).slice(0, Math.max(1, 3 - suffix.length)).join('')
    labels.set(project.id, `${base}${suffix}`)
  })

  return labels
}

function estimateCanvasLabelWidth(label: string): number {
  const text = label.trim()
  if (!text) return 0
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (context) {
      const fontFamily = getComputedStyle(document.body).getPropertyValue('--font-sans').trim() || 'system-ui'
      context.font = `600 13px ${fontFamily}`
      return context.measureText(text).width
    }
  }
  return Array.from(text).reduce((sum, char) => {
    if (/[A-Z0-9]/.test(char)) return sum + 8
    if (/[a-z]/.test(char)) return sum + 7
    if (/\s/.test(char)) return sum + 4
    return sum + 13
  }, 0)
}

function preferredCanvasModuleWidth(type: ApiNode['type'], label: string): number | null {
  if (!isCanvasModuleType(type)) return null
  const labelWidth = estimateCanvasLabelWidth(label)
  const rawWidth = Math.ceil(labelWidth + MODULE_NODE_LABEL_HORIZONTAL_CHROME)
  return Math.max(MODULE_NODE_DEFAULT_WIDTH, Math.ceil(rawWidth / CANVAS_GRID_SIZE) * CANVAS_GRID_SIZE)
}

function cloneCanvasSnapshot(nodes: ApiNode[], edges: ApiEdge[]): CanvasSnapshot {
  return {
    nodes: nodes.map(node => ({ ...node })),
    edges: edges.map(edge => ({ ...edge })),
  }
}

function canvasSnapshotsEqual(a: CanvasSnapshot, b: CanvasSnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function emptyCanvasHistory(): CanvasHistoryState {
  return { undo: [], redo: [] }
}

function filterRecordByKeys<T>(record: Record<string, T>, keys: Set<string>): Record<string, T> {
  const next: Record<string, T> = {}
  Object.entries(record).forEach(([key, value]) => {
    if (keys.has(key)) next[key] = value
  })
  return next
}

function remapCopiedNodeConfig(config: string, nodeIdMap: Map<string, string>): string {
  if (!config || nodeIdMap.size === 0) return config
  let next = config
  nodeIdMap.forEach((newId, oldId) => {
    next = next.split(oldId).join(newId)
  })
  return next
}

export default function App(): JSX.Element {
  const [languagePreference, setLanguagePreferenceState] = useState<LanguagePreference>(() => loadLanguagePreference())
  const [systemLanguage] = useState<AppLanguage>(() => detectSystemLanguage())
  const language = resolveLanguagePreference(languagePreference, systemLanguage)
  const t = useCallback((key: TranslationKey, vars?: Record<string, string | number | boolean | null | undefined>) => {
    return translate(language, key, vars)
  }, [language])
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return localStorage.getItem('a8a-theme') === 'light' ? 'light' : 'dark'
    } catch {
      return 'dark'
    }
  })
  const [sidebarLayout, setSidebarLayout] = useState<SidebarLayout>('full')
  const [activeView, setActiveView] = useState<AppView>('canvas')
  const [logState, setLogState] = useState<LogState>('collapsed')
  const [isCanvasFullscreen, setCanvasFullscreen] = useState(false)
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
  const [commonDataModules, setCommonDataModules] = useState<ApiModule[]>([])
  const [activeWsId, setActiveWsId] = useState<string>('')
  const [activeProjectId, setActiveProjectId] = useState<string>('')
  const [loading, setLoading] = useState(true)

  const [activeNodes, setActiveNodes] = useState<ApiNode[]>([])
  const [activeEdges, setActiveEdges] = useState<ApiEdge[]>([])
  const [canvasHistories, setCanvasHistories] = useState<Record<string, CanvasHistoryState>>({})
  const [copiedCanvasSelection, setCopiedCanvasSelection] = useState<CopiedCanvasSelection | null>(null)
  const [confirmDeleteEdge, setConfirmDeleteEdge] = useState<ApiEdge | null>(null)
  const [editingNode, setEditingNode] = useState<ApiNode | null>(null)
  const [nodeRunInputs, setNodeRunInputs] = useState<Record<string, string>>({})
  const [nodeRunOutputs, setNodeRunOutputs] = useState<Record<string, string>>({})
  const [nodeScriptLogs, setNodeScriptLogs] = useState<Record<string, ScriptLogBundle>>({})

  const [envDropdownOpen, setEnvDropdownOpen] = useState(false)
  const [envDropdownPos, setEnvDropdownPos] = useState({ top: 0, left: 0 })
  const envBtnRef = useRef<HTMLButtonElement>(null)
  const envDropdownRef = useRef<HTMLDivElement>(null)
  const transferMenuRef = useRef<HTMLDivElement>(null)
  const sidebarRef = useRef<HTMLElement>(null)
  const [modalEnv, setModalEnv] = useState<Environment | null | undefined>(undefined)
  const [modalWsId, setModalWsId] = useState<string>('')
  const [modalProject, setModalProject] = useState<{ wsId: string; project: ProjectItem | null } | null>(null)
  const [modalProjectClone, setModalProjectClone] = useState<{ wsId: string; project: ProjectItem } | null>(null)
  const [modalWorkspace, setModalWorkspace] = useState<{ workspace: WorkspaceModalItem | null } | null>(null)
  const [confirmDeleteWsId, setConfirmDeleteWsId] = useState<string | null>(null)
  const [confirmDeleteProject, setConfirmDeleteProject] = useState<{ wsId: string; project: ProjectItem } | null>(null)
  const [confirmDeleteEnv, setConfirmDeleteEnv] = useState<{ wsId: string; env: Environment } | null>(null)
  const [confirmDeleteCanvasNodes, setConfirmDeleteCanvasNodes] = useState<ApiNode[]>([])
  const [iconTooltip, setIconTooltip] = useState<{ text: string; x: number; y: number } | null>(null)

  // ── Canvas execution ──
  const [canvasExecution, setCanvasExecution] = useState<CanvasExecution | null>(null)
  const [execLogs, setExecLogs] = useState<LogEntry[]>([])
  const [nodeStatuses, setNodeStatuses] = useState<Record<string, NodeStatus>>({})
  const [activeBranchRoutes, setActiveBranchRoutes] = useState<Record<string, 'true' | 'false'>>({})
  const [endNodeDisplayValues, setEndNodeDisplayValues] = useState<Record<string, EndNodeDisplayValue[]>>({})
  const [startRepeatRowStates, setStartRepeatRowStates] = useState<Record<string, Record<number, StartRepeatRowRunState>>>({})
  const [lastStartNodeLoopProgress, setLastStartNodeLoopProgress] = useState<Record<string, StartNodeLoopProgressValue>>({})
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
  const [transferMenuOpen, setTransferMenuOpen] = useState(false)
  const [transferBusy, setTransferBusy] = useState(false)

  const refreshCommonDataModules = useCallback(async (): Promise<ApiModule[]> => {
    const modules = (await window.api.module.listAll()).filter(mod => mod.type === 'data' && mod.isCommon)
    setCommonDataModules(modules)
    return modules
  }, [])

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
        const [wsList] = await Promise.all([
          window.api.workspace.list(),
          refreshCommonDataModules(),
        ])
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
  }, [refreshCommonDataModules])

  useEffect(() => {
    try {
      localStorage.setItem('a8a-theme', theme)
    } catch {
      // localStorage를 사용할 수 없는 환경에서는 현재 세션 테마만 유지합니다.
    }
  }, [theme])

  const setLanguagePreference = useCallback((preference: LanguagePreference): void => {
    setLanguagePreferenceState(preference)
  }, [])

  useEffect(() => {
    document.documentElement.lang = language
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, languagePreference)
    } catch {
      // localStorage를 사용할 수 없는 환경에서는 현재 세션 언어만 유지합니다.
    }
  }, [language, languagePreference])

  const i18nValue = useMemo(() => ({
    language,
    languagePreference,
    systemLanguage,
    setLanguagePreference,
    t,
  }), [language, languagePreference, systemLanguage, setLanguagePreference, t])

  useEffect(() => {
    const handler = (e: MouseEvent): void => {
      if (envDropdownRef.current && !envDropdownRef.current.contains(e.target as Node)) {
        setEnvDropdownOpen(false)
      }
      if (transferMenuRef.current && !transferMenuRef.current.contains(e.target as Node)) {
        setTransferMenuOpen(false)
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
  const activeProjectEnvDisplayVars = activeProjectWs
    ? mergeConfiguredEnvVarsForDisplay(activeProjectWs.environments, activeProjectWs.activeEnvId)
    : {}
  const activeProjectEnvDisplayKeys = activeProjectWs
    ? (() => {
        const keys = Object.keys(activeProjectEnvDisplayVars)
        return keys.sort((a, b) => a.localeCompare(b))
      })()
    : []
  const activeCanvasHistory = activeProject ? canvasHistories[activeProject.id] ?? emptyCanvasHistory() : emptyCanvasHistory()
  const canCanvasUndo = !canvasExecution && activeCanvasHistory.undo.length > 0
  const canCanvasRedo = !canvasExecution && activeCanvasHistory.redo.length > 0
  const startRepeatPreviewData = useMemo(
    () => getStartRepeatPreviewRow(activeNodes.find(node => node.type === 'start')) ?? undefined,
    [activeNodes],
  )
  const runningStartNodeLoopProgress = canvasExecution?.loop
    ? (() => {
        const startNodeId = activeNodes.find(node => node.type === 'start')?.id
        if (!startNodeId) return undefined
        return {
          [startNodeId]: {
            current: canvasExecution.loop.index + 1,
            total: canvasExecution.loop.total,
          },
        }
      })()
    : undefined
  const startNodeLoopProgress = runningStartNodeLoopProgress ?? lastStartNodeLoopProgress

  useEffect(() => {
    if (commonDataModules.length === 0) return
    setActiveNodes(prev => {
      let changed = false
      const next = prev.map(node => {
        if (node.type !== 'data') return node
        const sharedModule = findCommonDataModule(commonDataModules, sharedDataModuleIdFromConfig(node.config))
        if (!sharedModule || node.label === sharedModule.label) return node
        changed = true
        return { ...node, label: sharedModule.label }
      })
      return changed ? next : prev
    })
  }, [commonDataModules])

  useEffect(() => {
    // 프로젝트가 바뀌면 이전 프로젝트의 실행 상태(진행 중 실행/로그/상태 배지/분기 경로)를
    // 초기화한다. 노드 id는 프로젝트마다 고유하므로 남겨두면 엉뚱하게 표시된다.
    setCanvasExecution(null)
    setExecLogs([])
    setNodeStatuses({})
    setActiveBranchRoutes({})
    setEndNodeDisplayValues({})
    setStartRepeatRowStates({})
    setLastStartNodeLoopProgress({})
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

  const recordCanvasHistory = useCallback((projectId: string, before: CanvasSnapshot, after: CanvasSnapshot): void => {
    if (canvasSnapshotsEqual(before, after)) return
    const entry: CanvasHistoryEntry = {
      before: cloneCanvasSnapshot(before.nodes, before.edges),
      after: cloneCanvasSnapshot(after.nodes, after.edges),
    }
    setCanvasHistories(prev => {
      const current = prev[projectId] ?? emptyCanvasHistory()
      return {
        ...prev,
        [projectId]: {
          undo: [...current.undo, entry].slice(-CANVAS_HISTORY_LIMIT),
          redo: [],
        },
      }
    })
  }, [])

  const restoreCanvasSnapshot = useCallback(async (projectId: string, snapshot: CanvasSnapshot): Promise<void> => {
    const next = cloneCanvasSnapshot(snapshot.nodes, snapshot.edges)
    await window.api.project.replaceCanvas(projectId, next.nodes, next.edges)
    if (activeProjectId !== projectId) return

    const nodeIds = new Set(next.nodes.map(node => node.id))
    setActiveNodes(next.nodes)
    setActiveEdges(next.edges)
    setNodeRunInputs(prev => filterRecordByKeys(prev, nodeIds))
    setNodeRunOutputs(prev => filterRecordByKeys(prev, nodeIds))
    setNodeScriptLogs(prev => filterRecordByKeys(prev, nodeIds))
    setStartRepeatRowStates(prev => filterRecordByKeys(prev, nodeIds))
    setLastStartNodeLoopProgress(prev => filterRecordByKeys(prev, nodeIds))
    setNodeStatuses({})
    setActiveBranchRoutes({})
    setEndNodeDisplayValues({})
    setActiveLogNodeId(null)
    setEditingNode(prev => prev ? next.nodes.find(node => node.id === prev.id) ?? null : null)
  }, [activeProjectId])

  const handleCanvasUndo = useCallback(async (): Promise<void> => {
    if (!activeProject || canvasExecution) return
    const history = canvasHistories[activeProject.id]
    const entry = history?.undo[history.undo.length - 1]
    if (!entry) return
    await restoreCanvasSnapshot(activeProject.id, entry.before)
    setCanvasHistories(prev => {
      const current = prev[activeProject.id] ?? emptyCanvasHistory()
      return {
        ...prev,
        [activeProject.id]: {
          undo: current.undo.slice(0, -1),
          redo: [...current.redo, entry].slice(-CANVAS_HISTORY_LIMIT),
        },
      }
    })
  }, [activeProject, canvasExecution, canvasHistories, restoreCanvasSnapshot])

  const handleCanvasRedo = useCallback(async (): Promise<void> => {
    if (!activeProject || canvasExecution) return
    const history = canvasHistories[activeProject.id]
    const entry = history?.redo[history.redo.length - 1]
    if (!entry) return
    await restoreCanvasSnapshot(activeProject.id, entry.after)
    setCanvasHistories(prev => {
      const current = prev[activeProject.id] ?? emptyCanvasHistory()
      return {
        ...prev,
        [activeProject.id]: {
          undo: [...current.undo, entry].slice(-CANVAS_HISTORY_LIMIT),
          redo: current.redo.slice(0, -1),
        },
      }
    })
  }, [activeProject, canvasExecution, canvasHistories, restoreCanvasSnapshot])

  const handleNodeMove = useCallback(async (moves: CanvasNodeMove[]): Promise<void> => {
    if (!activeProject || moves.length === 0) return
    const moveById = new Map(moves.map(move => [move.id, move]))
    const nextNodes = activeNodes.map(node => {
      const move = moveById.get(node.id)
      return move ? { ...node, x: move.x, y: move.y } : node
    })
    const changedMoves = moves.filter(move => {
      const node = activeNodes.find(item => item.id === move.id)
      return !!node && (node.x !== move.x || node.y !== move.y)
    })
    if (changedMoves.length === 0) return

    const before = cloneCanvasSnapshot(activeNodes, activeEdges)
    await Promise.all(changedMoves.map(move => window.api.node.updatePosition(move.id, move.x, move.y)))
    setActiveNodes(nextNodes)
    recordCanvasHistory(activeProject.id, before, { nodes: nextNodes, edges: activeEdges })
  }, [activeEdges, activeNodes, activeProject, recordCanvasHistory])

  const handleNodeResize = useCallback(async (id: string, width: number, height: number): Promise<void> => {
    if (!activeProject) return
    const node = activeNodes.find(item => item.id === id)
    if (!node || (node.width === width && node.height === height)) return
    const before = cloneCanvasSnapshot(activeNodes, activeEdges)
    const nextNodes = activeNodes.map(n => n.id === id ? { ...n, width, height } : n)
    await window.api.node.updateSize(id, width, height)
    setActiveNodes(nextNodes)
    recordCanvasHistory(activeProject.id, before, { nodes: nextNodes, edges: activeEdges })
  }, [activeEdges, activeNodes, activeProject, recordCanvasHistory])

  const handleEdgeCreate = useCallback(async (sourceId: string, targetId: string, sourcePort?: string | null): Promise<void> => {
    if (!activeProject) return
    try {
      const before = cloneCanvasSnapshot(activeNodes, activeEdges)
      const source = activeNodes.find(n => n.id === sourceId)
      const target = activeNodes.find(n => n.id === targetId)
      const existingIncoming = target && allowsMultipleIncoming(target.type) ? undefined : activeEdges.find(e => e.targetNodeId === targetId)
      const existingStartOutgoing = source?.type === 'start' ? activeEdges.find(e => e.sourceNodeId === sourceId) : undefined
      if (existingIncoming?.sourceNodeId === sourceId && existingStartOutgoing?.targetNodeId === targetId) return
      const replaceIds = Array.from(new Set([existingIncoming?.id, existingStartOutgoing?.id].filter((id): id is string => typeof id === 'string')))
      if (!canConnectEdge(activeNodes, activeEdges, sourceId, targetId, sourcePort ?? null, replaceIds)) return
      await Promise.all(replaceIds.map(id => window.api.edge.delete(id)))
      const edge = await window.api.edge.create(activeProject.id, sourceId, targetId, sourcePort ?? null)
      const nextEdges = [...activeEdges.filter(e => !replaceIds.includes(e.id)), edge]
      setActiveEdges(nextEdges)
      setNodeStatuses({})
      setActiveBranchRoutes({})
      setActiveLogNodeId(null)
      recordCanvasHistory(activeProject.id, before, { nodes: activeNodes, edges: nextEdges })
    } catch (err) {
      console.error('Failed to create edge:', err)
    }
  }, [activeProject, activeNodes, activeEdges, recordCanvasHistory])

  const handleNodeOpen = useCallback((nodeId: string): void => {
    const node = activeNodes.find(n => n.id === nodeId)
    if (node) setEditingNode(node)
  }, [activeNodes])

  const handleNodeSave = async (nodeId: string, config: string): Promise<void> => {
    const node = activeNodes.find(n => n.id === nodeId)
    if (!activeProject || !node) return
    const shouldResetRepeatRows = node?.type === 'start' && repeatExecutionSignature(node.config) !== repeatExecutionSignature(config)
    const before = cloneCanvasSnapshot(activeNodes, activeEdges)
    const nextNodes = activeNodes.map(n => n.id === nodeId ? { ...n, config } : n)
    await window.api.node.updateConfig(nodeId, config)
    setActiveNodes(nextNodes)
    recordCanvasHistory(activeProject.id, before, { nodes: nextNodes, edges: activeEdges })
    if (shouldResetRepeatRows) {
      setStartRepeatRowStates(prev => {
        if (!prev[nodeId]) return prev
        const next = { ...prev }
        delete next[nodeId]
        return next
      })
      setLastStartNodeLoopProgress(prev => {
        if (!prev[nodeId]) return prev
        const next = { ...prev }
        delete next[nodeId]
        return next
      })
    }
  }

  const handleDataNodeSave = async (
    nodeId: string,
    label: string,
    config: string,
    options?: { shareAsCommonData?: boolean },
  ): Promise<void> => {
    const node = activeNodes.find(n => n.id === nodeId)
    if (!activeProject || !node) return
    const nextLabel = label.trim() || node?.label || defaultCanvasNodeLabel(node?.type ?? 'data')
    const preferredWidth = node ? preferredCanvasModuleWidth(node.type, nextLabel) : null
    const currentWidth = node?.width ?? MODULE_NODE_DEFAULT_WIDTH
    const currentHeight = node?.height ?? MODULE_NODE_DEFAULT_HEIGHT
    const nextWidth = preferredWidth !== null && preferredWidth > currentWidth ? preferredWidth : null
    const before = cloneCanvasSnapshot(activeNodes, activeEdges)
    let nextConfig = config
    let affectedNodeIds = new Set([nodeId])

    if (node.type === 'data') {
      const dataConfig = stripSharedDataModuleMarker(config)
      const currentSharedModuleId = sharedDataModuleIdFromConfig(node.config)
      const shouldShare = options?.shareAsCommonData === true

      if (shouldShare && currentSharedModuleId) {
        await window.api.module.update(currentSharedModuleId, nextLabel, dataConfig)
        setCommonDataModules(prev => prev.map(mod => mod.id === currentSharedModuleId ? { ...mod, label: nextLabel, config: dataConfig } : mod))
        nextConfig = sharedDataNodeConfig(currentSharedModuleId)
        affectedNodeIds = new Set(activeNodes
          .filter(n => n.type === 'data' && sharedDataModuleIdFromConfig(n.config) === currentSharedModuleId)
          .map(n => n.id))
      } else if (shouldShare) {
        const created = await window.api.module.createCommon('data', nextLabel, dataConfig)
        setCommonDataModules(prev => [...prev, created])
        nextConfig = sharedDataNodeConfig(created.id)
      } else {
        nextConfig = dataConfig
      }
    }

    const nextNodes = activeNodes.map(n => affectedNodeIds.has(n.id)
      ? { ...n, label: nextLabel, config: nextConfig, ...(n.id === nodeId && nextWidth !== null ? { width: nextWidth, height: currentHeight } : {}) }
      : n)
    await Promise.all([
      ...Array.from(affectedNodeIds).flatMap(id => [
        window.api.node.updateLabel(id, nextLabel),
        window.api.node.updateConfig(id, nextConfig),
      ]),
      nextWidth !== null ? window.api.node.updateSize(nodeId, nextWidth, currentHeight) : Promise.resolve(),
    ])
    setActiveNodes(nextNodes)
    recordCanvasHistory(activeProject.id, before, { nodes: nextNodes, edges: activeEdges })
  }

  const rememberSelectSelection = useCallback(async (
    nodeId: string,
    selection: SelectionPopupSelection,
  ): Promise<void> => {
    const node = activeNodes.find(n => n.id === nodeId)
    if (!activeProject || !node || node.type !== 'select') return

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
    const before = cloneCanvasSnapshot(activeNodes, activeEdges)
    const nextNodes = activeNodes.map(n => n.id === nodeId ? { ...n, config: nextConfig } : n)
    await window.api.node.updateConfig(nodeId, nextConfig)
    setActiveNodes(nextNodes)
    recordCanvasHistory(activeProject.id, before, { nodes: nextNodes, edges: activeEdges })
  }, [activeEdges, activeNodes, activeProject, recordCanvasHistory])

  const handleModuleDrop = useCallback(async (moduleType: string, x: number, y: number, moduleId?: string | null): Promise<void> => {
    if (!activeProject) return
    if (!isCanvasModuleType(moduleType)) return
    const before = cloneCanvasSnapshot(activeNodes, activeEdges)
    const node = moduleType === 'data' && moduleId
      ? await window.api.node.createFromModule(activeProject.id, moduleId, x, y)
      : await window.api.node.create(activeProject.id, moduleType, defaultCanvasNodeLabel(moduleType), x, y)
    const nextNodes = [...activeNodes, node]
    setActiveNodes(nextNodes)
    recordCanvasHistory(activeProject.id, before, { nodes: nextNodes, edges: activeEdges })
  }, [activeEdges, activeNodes, activeProject, recordCanvasHistory])

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
  }, [activeEdges, activeNodes, activeProject?.id])

  const handleCanvasNodePaste = useCallback(async (pasteCenter: { x: number; y: number }): Promise<void> => {
    if (!activeProject || !copiedCanvasSelection) return
    const pasteCandidates = copiedCanvasSelection.nodes.filter(node => {
      if (node.type === 'start' || node.type === 'end') return false
      return isCanvasModuleType(node.type)
    })

    if (pasteCandidates.length === 0) return
    const before = cloneCanvasSnapshot(activeNodes, activeEdges)

    const pasteBounds = pasteCandidates.reduce((bounds, node) => {
      const width = node.width ?? MODULE_NODE_DEFAULT_WIDTH
      const height = node.height ?? MODULE_NODE_DEFAULT_HEIGHT
      return {
        left: Math.min(bounds.left, node.x),
        top: Math.min(bounds.top, node.y),
        right: Math.max(bounds.right, node.x + width),
        bottom: Math.max(bounds.bottom, node.y + height),
      }
    }, { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity })
    const sourceCenter = {
      x: (pasteBounds.left + pasteBounds.right) / 2,
      y: (pasteBounds.top + pasteBounds.bottom) / 2,
    }
    const delta = {
      x: pasteCenter.x - sourceCenter.x,
      y: pasteCenter.y - sourceCenter.y,
    }
    const createdBySourceId = new Map<string, ApiNode>()
    const pastedNodes: ApiNode[] = []

    for (const copiedNode of pasteCandidates) {
      const x = Math.round((copiedNode.x + delta.x) / 10) * 10
      const y = Math.round((copiedNode.y + delta.y) / 10) * 10
      const label = copiedNode.label.trim() || defaultCanvasNodeLabel(copiedNode.type)

      try {
        const created = await window.api.node.create(activeProject.id, copiedNode.type, label, x, y)

        await window.api.node.updateSize(created.id, copiedNode.width, copiedNode.height)

        const pasted: ApiNode = {
          ...created,
          label,
          x,
          y,
          width: copiedNode.width,
          height: copiedNode.height,
          config: copiedNode.config ?? '',
        }

        createdBySourceId.set(copiedNode.id, pasted)
        pastedNodes.push(pasted)
      } catch (err) {
        console.error('Failed to paste nodes:', err)
      }
    }

    if (pastedNodes.length === 0) return

    const nodeIdMap = new Map(Array.from(createdBySourceId.entries()).map(([sourceId, pasted]) => [sourceId, pasted.id]))
    await Promise.all(Array.from(createdBySourceId.entries()).map(([sourceId, pasted]) => {
      const copiedNode = pasteCandidates.find(node => node.id === sourceId)
      const nextConfig = remapCopiedNodeConfig(copiedNode?.config ?? '', nodeIdMap)
      pasted.config = nextConfig
      return window.api.node.updateConfig(pasted.id, nextConfig)
    }))

    const nextNodes = [...activeNodes, ...pastedNodes]
    const nextEdges = [...activeEdges]
    const pastedEdges: ApiEdge[] = []

    for (const copiedEdge of copiedCanvasSelection.edges) {
      const source = createdBySourceId.get(copiedEdge.sourceNodeId)
      const target = createdBySourceId.get(copiedEdge.targetNodeId)
      if (!source || !target) continue
      if (!canConnectEdge(nextNodes, nextEdges, source.id, target.id, copiedEdge.sourcePort ?? null)) continue

      try {
        const edge = await window.api.edge.create(activeProject.id, source.id, target.id, copiedEdge.sourcePort ?? null)
        nextEdges.push(edge)
        pastedEdges.push(edge)
      } catch (err) {
        console.error('Failed to paste edges:', err)
      }
    }

    const finalNodes = [...activeNodes, ...pastedNodes]
    const finalEdges = pastedEdges.length > 0 ? [...activeEdges, ...pastedEdges] : activeEdges
    setActiveNodes(finalNodes)
    if (pastedEdges.length > 0) {
      setActiveEdges(finalEdges)
    }
    setNodeStatuses({})
    setActiveBranchRoutes({})
    setActiveLogNodeId(null)
    recordCanvasHistory(activeProject.id, before, { nodes: finalNodes, edges: finalEdges })
  }, [activeEdges, activeNodes, activeProject, copiedCanvasSelection, recordCanvasHistory])

  const deleteCanvasNodeInstances = useCallback(async (nodes: ApiNode[]): Promise<void> => {
    if (!activeProject) return
    const deletableNodes = nodes.filter(node => node.type !== 'start' && node.type !== 'end')
    if (deletableNodes.length === 0) return

    const before = cloneCanvasSnapshot(activeNodes, activeEdges)
    const deletedNodeIds = new Set(deletableNodes.map(node => node.id))
    await Promise.all(deletableNodes.map(node => window.api.node.delete(node.id)))
    const nextNodes = activeNodes.filter(n => !deletedNodeIds.has(n.id))
    const nextEdges = activeEdges.filter(e => !deletedNodeIds.has(e.sourceNodeId) && !deletedNodeIds.has(e.targetNodeId))
    setActiveNodes(nextNodes)
    setActiveEdges(nextEdges)
    setNodeRunInputs(prev => {
      const next = { ...prev }
      deletedNodeIds.forEach(id => delete next[id])
      return next
    })
    setNodeRunOutputs(prev => {
      const next = { ...prev }
      deletedNodeIds.forEach(id => delete next[id])
      return next
    })
    setNodeScriptLogs(prev => {
      const next = { ...prev }
      deletedNodeIds.forEach(id => delete next[id])
      return next
    })
    setNodeStatuses({})
    setActiveBranchRoutes({})
    setActiveLogNodeId(null)
    setEditingNode(prev => prev && deletedNodeIds.has(prev.id) ? null : prev)
    recordCanvasHistory(activeProject.id, before, { nodes: nextNodes, edges: nextEdges })
  }, [activeEdges, activeNodes, activeProject, recordCanvasHistory])

  const handleCanvasNodeDeleteRequest = useCallback((nodeIds: string[]): void => {
    const selectedNodeIds = new Set(nodeIds)
    const nodes = activeNodes.filter(node => selectedNodeIds.has(node.id) && node.type !== 'start' && node.type !== 'end')
    if (nodes.length === 0) return
    setConfirmDeleteCanvasNodes(nodes)
  }, [activeNodes])

  const deleteEdge = async (): Promise<void> => {
    if (!activeProject || !confirmDeleteEdge) return
    const before = cloneCanvasSnapshot(activeNodes, activeEdges)
    await window.api.edge.delete(confirmDeleteEdge.id)
    const nextEdges = activeEdges.filter(e => e.id !== confirmDeleteEdge.id)
    setActiveEdges(nextEdges)
    setNodeStatuses({})
    setActiveLogNodeId(null)
    setConfirmDeleteEdge(null)
    recordCanvasHistory(activeProject.id, before, { nodes: activeNodes, edges: nextEdges })
  }

  const handleEdgeReconnect = useCallback(async (edgeId: string, newSourceId: string, newTargetId: string, sourcePort?: string | null): Promise<void> => {
    if (!activeProject) return
    try {
      const before = cloneCanvasSnapshot(activeNodes, activeEdges)
      const source = activeNodes.find(n => n.id === newSourceId)
      const target = activeNodes.find(n => n.id === newTargetId)
      const targetIncoming = target && allowsMultipleIncoming(target.type) ? undefined : activeEdges.find(e => e.targetNodeId === newTargetId && e.id !== edgeId)
      const startOutgoing = source?.type === 'start' ? activeEdges.find(e => e.sourceNodeId === newSourceId && e.id !== edgeId) : undefined
      const replaceIds = Array.from(new Set([edgeId, targetIncoming?.id, startOutgoing?.id].filter((id): id is string => typeof id === 'string')))
      if (!canConnectEdge(activeNodes, activeEdges, newSourceId, newTargetId, sourcePort ?? null, replaceIds)) return
      await Promise.all(replaceIds.map(id => window.api.edge.delete(id)))
      const newEdge = await window.api.edge.create(activeProject.id, newSourceId, newTargetId, sourcePort ?? null)
      const nextEdges = [...activeEdges.filter(e => !replaceIds.includes(e.id)), newEdge]
      setActiveEdges(nextEdges)
      setNodeStatuses({})
      setActiveBranchRoutes({})
      setActiveLogNodeId(null)
      recordCanvasHistory(activeProject.id, before, { nodes: activeNodes, edges: nextEdges })
    } catch (err) {
      console.error('Failed to change edge:', err)
    }
  }, [activeProject, activeNodes, activeEdges, recordCanvasHistory])

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
    const previewDataVars = getStartRepeatPreviewRow(activeNodes.find(node => node.type === 'start')) ?? {}
    const visiting = new Set<string>()

    const runNode = async (nodeId: string): Promise<unknown> => {
      if (visiting.has(nodeId)) throw new Error(t('runtime.error.cycleDetected'))
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

      if (node.type === 'start') {
        const startPreviewRow = getStartRepeatPreviewRow(node)
        moduleVarsMap[nodeId] = startPreviewRow ? { ...startPreviewRow } : { ...upstreamModuleVars }
        visiting.delete(nodeId)
        return startPreviewRow ?? upstream
      }
      if (node.type === 'end') {
        moduleVarsMap[nodeId] = { ...upstreamModuleVars }
        visiting.delete(nodeId)
        return upstream
      }
      if (node.type === 'data') {
        moduleVarsMap[nodeId] = { ...upstreamModuleVars }
        const output = readDataNodeOutput(node.config, commonDataModules)
        visiting.delete(nodeId)
        return output
      }
      if (node.type === 'select') {
        const cfg = parseSelectConfig(node.config)
        let preInputVars: Record<string, unknown> = {}
        const preScriptInput = buildRuntimeInputContext(upstream, upstreamModuleVars)
        if (cfg.preScript && cfg.preScript.trim()) {
          try {
            const r = await runPreRequest(cfg.preScript, { input: preScriptInput, envVars, language })
            setScriptLogsForNode(nodeId, 'pre', r.logs)
            preInputVars = r.inputVars
            for (const [k, v] of Object.entries(r.envUpdates)) envVars[k] = v
          } catch (err) {
            if (isScriptRuntimeError(err)) setScriptLogsForNode(nodeId, 'pre', err.logs)
            throw err
          }
        }
        moduleVarsMap[nodeId] = { ...upstreamModuleVars, ...preInputVars }
        const applySelectPost = async (selectedOutput: unknown): Promise<unknown> => {
          let finalOutput = selectedOutput
          let postOutputVars: Record<string, unknown> = {}
          if (cfg.postScript && cfg.postScript.trim()) {
            try {
              const postScriptInput = buildRuntimeInputContext(upstream, { ...upstreamModuleVars, ...preInputVars })
              const r = await runPostResponse(cfg.postScript, {
                input: postScriptInput,
                output: selectedOutput,
                envVars,
                language,
              })
              setScriptLogsForNode(nodeId, 'post', r.logs)
              postOutputVars = r.outputVars
              if (r.hasOutputOverride) finalOutput = r.outputOverride
              for (const [k, v] of Object.entries(r.envUpdates)) envVars[k] = v
            } catch (err) {
              if (isScriptRuntimeError(err)) setScriptLogsForNode(nodeId, 'post', err.logs)
              throw err
            }
          }
          moduleVarsMap[nodeId] = { ...upstreamModuleVars, ...preInputVars, ...postOutputVars }
          return finalOutput
        }
        if (cfg.selectionType === 'script') {
          const output = await applySelectPost(buildSelectScriptOutput(preInputVars))
          visiting.delete(nodeId)
          return output
        }
        const selectedJsonPaths = selectedJsonPathsForConfig(cfg)
        const selectedRowIndices = selectedRowIndicesForConfig(cfg)
        if (cfg.autoSelect && cfg.selectMode === 'json' && selectedJsonPaths.length > 0) {
          const output = await applySelectPost(buildSelectedJsonOutput(upstream, selectedJsonPaths))
          visiting.delete(nodeId)
          return output
        }
        if (Array.isArray(upstream) && cfg.autoSelect && selectedRowIndices.length > 0 && inputArray.length > 0) {
          const selectedOutput = selectedRowIndices
            .map(index => inputArray[index])
            .filter(value => value !== undefined)
          const output = await applySelectPost(selectedOutput)
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
        const output = await applySelectPost(result?.rows ?? [])
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
        const preScriptInput = buildRuntimeInputContext(upstream, upstreamModuleVars)
        if (cfg.preScript && cfg.preScript.trim()) {
          try {
            const r = await runPreRequest(cfg.preScript, { input: preScriptInput, envVars, language })
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
          const templateDataVars = previewDataVars
          let fullUrl = resolveTemplate(cfg.url.trim(), envVars, item, templateDataVars)
          const enabledParams = (cfg.params ?? []).filter(p => p.enabled && p.key)
          if (enabledParams.length > 0) {
            const qs = new URLSearchParams(enabledParams.map(p => [p.key, resolveTemplate(p.value, envVars, item, templateDataVars)]))
            fullUrl += (fullUrl.includes('?') ? '&' : '?') + qs.toString()
          }
          const hdrs: Record<string, string> = {}
          ;(cfg.headers ?? []).filter(h => h.enabled && h.key).forEach(h => {
            hdrs[h.key] = resolveTemplate(h.value, envVars, item, templateDataVars)
          })
          let bodyStr: string | undefined
          if (['POST', 'PUT', 'PATCH'].includes(cfg.method) && cfg.body?.trim()) {
            if (cfg.bodyType === 'json' && !hdrs['Content-Type'] && !hdrs['content-type']) {
              hdrs['Content-Type'] = 'application/json'
            }
            bodyStr = resolveTemplate(cfg.body, envVars, item, templateDataVars)
          }
          const authedRequest = applyApiAuth({ url: fullUrl, headers: hdrs }, cfg.auth, envVars, item, templateDataVars)
          fullUrl = authedRequest.url
          const requestHeaders = authedRequest.headers
          const res = await window.api.http.fetch(fullUrl, { method: cfg.method, headers: requestHeaders, body: bodyStr })
          if (!res.ok) throw new ApiHttpError(res.status, res.statusText, res.text)
          try {
            const data = JSON.parse(res.text) as unknown
            appendApiExecutionResult(allResults, data)
          } catch { appendApiExecutionResult(allResults, res.text) }
        }

        let postOutputVars: Record<string, unknown> = {}
        const responseOutput = normalizeApiExecutionOutput(allResults)
        let finalOutput: unknown = responseOutput
        if (cfg.postScript && cfg.postScript.trim()) {
          try {
            const postScriptInput = buildRuntimeInputContext(upstream, { ...upstreamModuleVars, ...preInputVars })
            const r = await runPostResponse(cfg.postScript, {
              input: postScriptInput,
              output: responseOutput,
              envVars,
              language,
            })
            setScriptLogsForNode(nodeId, 'post', r.logs)
            postOutputVars = r.outputVars
            if (r.hasOutputOverride) finalOutput = r.outputOverride
            for (const [k, v] of Object.entries(r.envUpdates)) envVars[k] = v
          } catch (err) {
            if (isScriptRuntimeError(err)) setScriptLogsForNode(nodeId, 'post', err.logs)
            throw err
          }
        }
        moduleVarsMap[nodeId] = { ...upstreamModuleVars, ...postOutputVars }
        visiting.delete(nodeId)
        return finalOutput
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
      if (err instanceof ApiHttpError) {
        return stringifyNodeOutput(err.output)
      }
      return JSON.stringify({ __previewError: String((err as Error)?.message ?? err) }, null, 2)
    }
  }, [activeNodes, activeEdges, activeProjectWs, activeProjectEnvVars, commonDataModules, language, rememberSelectSelection, setScriptLogsForNode, t])

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
    const persistedEnvVarsByEnvId: Record<string, Environment['vars']> = { ...(exec.persistedEnvVarsByEnvId ?? {}) }
    const localLogs: LogEntry[] = [...(exec.execLogs ?? [])]
    const loop = exec.loop
    const loopRow = loop ? (loop.rows[loop.index] ?? { no: loop.index + 1 }) : null
    const loopRowNo = loop ? Math.max(1, Math.floor(Number(loopRow?.no) || loop.index + 1)) : 0
    let { step, plan } = exec
    const setLoopRowState = (patch: { status: StartRepeatRowStatus; error?: string; failedNodeId?: string }): void => {
      if (!loop) return
      setStartRepeatRowStates(prev => {
        const currentRows = prev[loop.startNodeId] ?? {}
        const nextState: StartRepeatRowRunState = {
          ...(currentRows[loopRowNo] ?? {}),
          status: patch.status,
          updatedAt: Date.now(),
        }
        if (patch.status === 'failed') {
          nextState.error = patch.error
          nextState.failedNodeId = patch.failedNodeId
        } else {
          delete nextState.error
          delete nextState.failedNodeId
        }
        return {
          ...prev,
          [loop.startNodeId]: {
            ...currentRows,
            [loopRowNo]: nextState,
          },
        }
      })
    }
    const rememberLoopProgress = (index: number): void => {
      if (!loop) return
      setLastStartNodeLoopProgress({
        [loop.startNodeId]: {
          current: Math.max(1, Math.min(loop.total, index + 1)),
          total: loop.total,
        },
      })
    }
    const startNextLoopIteration = (): boolean => {
      if (!loop || loop.index + 1 >= loop.total) return false
      const nextStartedAt = Date.now()
      rememberLoopProgress(loop.index + 1)
      const nextExecution: CanvasExecution = {
        nodeOutputs: {},
        moduleVars: {},
        branchRoutes: {},
        envVars: envVarsForRun,
        persistedEnvVarsByEnvId,
        usedVariables: {},
        execLogs: localLogs,
        startedAt: nextStartedAt,
        plan,
        step: 0,
        loop: {
          ...loop,
          index: loop.index + 1,
          logStartIndex: localLogs.length,
          iterationStartedAt: nextStartedAt,
        },
        pendingSelectInput: null,
        pendingBranchChoice: null,
        pendingLogEntryId: null,
      }
      setNodeStatuses({})
      setActiveBranchRoutes({})
      setEndNodeDisplayValues({})
      setNodeRunInputs({})
      setNodeRunOutputs({})
      setNodeScriptLogs({})
      setCanvasExecution(nextExecution)
      void advanceExecution(nextExecution)
      return true
    }
    const continueLoopIfNeeded = (): boolean => {
      if (!loop) return false
      setLoopRowState({ status: 'success' })
      return startNextLoopIteration()
    }
    const handleLoopFailure = (failedNodeId: string, message: string): boolean => {
      if (!loop) return false
      setLoopRowState({ status: 'failed', error: message, failedNodeId })
      if (loop.stopOnFailure) {
        setCanvasExecution(null)
        return true
      }
      if (startNextLoopIteration()) return true
      setCanvasExecution(null)
      return true
    }
    const pushLog = (entry: LogEntry): void => {
      localLogs.push(entry)
      setExecLogs(prev => [...prev, entry])
    }
    const updateLog = (id: string, patch: Partial<LogEntry>): void => {
      const idx = localLogs.findIndex(e => e.id === id)
      if (idx >= 0) localLogs[idx] = { ...localLogs[idx], ...patch }
      setExecLogs(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e))
    }
    const persistEnvUpdatesForRun = async (updates: Record<string, string>): Promise<void> => {
      const ws = activeProjectWs
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
    if (selectedRows !== undefined && step > 0) {
      const prevNodeId = plan[step - 1]
      const prevNode = activeNodes.find(n => n.id === prevNodeId)
      let selectedOutput: unknown = selectedRows
      let selectedScriptLogs: ScriptLogBundle = localLogs.find(e => e.id === exec.pendingLogEntryId)?.scriptLogs ?? { pre: [], post: [] }
      if (prevNode?.type === 'select') {
        const cfg = parseSelectConfig(prevNode.config)
        if (cfg.postScript && cfg.postScript.trim()) {
          try {
            const scriptInput = buildRuntimeInputContext(exec.pendingSelectInput, moduleVars[prevNodeId] ?? {})
            const postResult = await runPostResponse(cfg.postScript, {
              input: scriptInput,
              output: selectedRows,
              envVars: envVarsForRun,
              language,
            })
            selectedScriptLogs = { ...selectedScriptLogs, post: postResult.logs }
            setScriptLogsForNode(prevNodeId, 'post', postResult.logs)
            if (postResult.hasOutputOverride) selectedOutput = postResult.outputOverride
            moduleVars[prevNodeId] = { ...(moduleVars[prevNodeId] ?? {}), ...postResult.outputVars }
            for (const [k, v] of Object.entries(postResult.envUpdates)) envVarsForRun[k] = v
            recordUpdatedEnvVariables(usedVariables, envVarsForRun, postResult.envUpdates)
            if (Object.keys(postResult.envUpdates).length > 0) await persistEnvUpdatesForRun(postResult.envUpdates)
          } catch (err) {
            if (isScriptRuntimeError(err)) {
              selectedScriptLogs = { ...selectedScriptLogs, post: err.logs }
              setScriptLogsForNode(prevNodeId, 'post', err.logs)
            }
            const entry = exec.pendingLogEntryId ? localLogs.find(e => e.id === exec.pendingLogEntryId) : undefined
            if (exec.pendingLogEntryId) {
              const message = t('runtime.error.postScript', { message: String((err as Error)?.message ?? err) })
              updateLog(exec.pendingLogEntryId, {
                status: 'error',
                error: message,
                duration: Date.now() - (entry?.startedAt ?? Date.now()),
                scriptLogs: selectedScriptLogs,
              })
            }
            setNodeStatuses(prev => ({ ...prev, [prevNodeId]: 'error' }))
            if (handleLoopFailure(prevNodeId, t('runtime.error.postScript', { message: String((err as Error)?.message ?? err) }))) return
            setCanvasExecution(null)
            return
          }
        }
      }
      nodeOutputs[prevNodeId] = selectedOutput
      if (selection) await rememberSelectSelection(prevNodeId, selection)
      setNodeRunOutputs(prev => ({ ...prev, [prevNodeId]: JSON.stringify(selectedOutput, null, 2) }))
      if (exec.pendingLogEntryId) {
        const entry = localLogs.find(e => e.id === exec.pendingLogEntryId)
        updateLog(exec.pendingLogEntryId, { status: 'success', output: selectedOutput, duration: Date.now() - (entry?.startedAt ?? Date.now()), scriptLogs: selectedScriptLogs })
        setNodeStatuses(prev => ({ ...prev, [prevNodeId]: 'success' }))
      }
    }

    if (selectedBranchRoute !== undefined && step > 0) {
      const prevNodeId = plan[step - 1]
      const route = selectedBranchRoute
      const passThroughOutput = exec.pendingBranchChoice?.input ?? null
      branchRoutes[prevNodeId] = route
      setActiveBranchRoutes(prev => ({ ...prev, [prevNodeId]: route }))
      nodeOutputs[prevNodeId] = passThroughOutput
      setNodeRunOutputs(prev => ({ ...prev, [prevNodeId]: JSON.stringify(passThroughOutput, null, 2) }))
      if (exec.pendingLogEntryId) {
        const entry = localLogs.find(e => e.id === exec.pendingLogEntryId)
        updateLog(exec.pendingLogEntryId, { status: 'success', output: passThroughOutput, duration: Date.now() - (entry?.startedAt ?? Date.now()) })
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
        const startOutput = loopRow ? { ...loopRow } : null
        nodeOutputs[nodeId] = startOutput
        moduleVars[nodeId] = loopRow ? { ...loopRow } : {}
        setNodeRunOutputs(prev => ({ ...prev, [nodeId]: JSON.stringify(startOutput, null, 2) }))
        setLoopRowState({ status: 'running' })
        setNodeStatuses(prev => ({ ...prev, [nodeId]: 'success' }))
        step++; continue
      }

      if (node.type === 'end') {
        let endStatus: NodeStatus = 'success'
        let endErrorMessage = t('runtime.error.reportCreateOrSave')
        const finalVariables = finalizeUsedVariables(usedVariables, envVarsForRun)
        let endCfg: Partial<EndNodeConfig> = {}
        try { endCfg = JSON.parse(node.config || '{}') as Partial<EndNodeConfig> } catch { endCfg = {} }
        const displayValues = extractEndNodeDisplayValues(endCfg.displayEnvKeys, envVarsForRun, activeProjectEnvDisplayVars)
        const reportLogs = loop ? localLogs.slice(loop.logStartIndex) : localLogs
        const iterationStartedAt = loop ? loop.iterationStartedAt : exec.startedAt
        try {
          const fmt = endCfg.reportFormat
          if ((fmt === 'html' || fmt === 'markdown') && endCfg.savePath && endCfg.savePath.trim()) {
            const ws = activeProjectWs
            const envName = ws?.environments.find(e => e.id === ws.activeEnvId)?.name ?? 'BASE'
            const wsName = ws?.name ?? ''
            const projectName = activeProject?.name ?? ''
            const executedAt = new Date(iterationStartedAt)
            const totalDuration = Date.now() - iterationStartedAt
            const hasError = reportLogs.some(e => e.status === 'error')
            const overallStatus: 'success' | 'error' | 'partial' = hasError
              ? (reportLogs.some(e => e.status === 'success') ? 'partial' : 'error')
              : 'success'
            // Only plan-connected modules participate in the report. If user
            // saved with previously-connected IDs that are now disconnected,
            // they're silently dropped here.
            const planSet = new Set(plan)
            const connectedModuleIds = activeNodes
              .filter(n => planSet.has(n.id) && n.type !== 'start' && n.type !== 'end')
              .map(n => n.id)
            const selectedSet = resolveEndReportSelectedModuleIds(endCfg, connectedModuleIds)
            const reportNodes: ReportNode[] = plan.map(pid => {
              const pn = activeNodes.find(n => n.id === pid)
              const logEntry = reportLogs.find(e => e.nodeId === pid)
              let pcfg: Partial<ApiConfig & SelectConfig> | undefined
              if (pn && (pn.type === 'api' || pn.type === 'select')) {
                try { pcfg = JSON.parse(pn.config || '{}') as Partial<ApiConfig & SelectConfig> } catch { pcfg = undefined }
              }
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
                scriptLogs: logEntry?.scriptLogs,
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
              language,
            })
            const tpl = endCfg.filenameTemplate && endCfg.filenameTemplate.trim() ? endCfg.filenameTemplate : '{env}_{ws}_{project}_{ts}'
            const baseFilename = fillFilenameTemplate(tpl, { env: envName, ws: wsName, project: projectName, ts: executedAt })
            const filename = loop ? appendRepeatNoSuffix(baseFilename, loopRow?.no) : baseFilename
            const ext = fmt === 'html' ? '.html' : '.md'
            const sep = endCfg.savePath.includes('/') && !endCfg.savePath.includes('\\') ? '/' : '\\'
            const fullPath = endCfg.savePath.replace(/[\\/]+$/, '') + sep + filename + ext
            const writeResult = await window.api.file.write(fullPath, content, language)
            if (writeResult.ok) {
              if (!loop) setSavedReport({ path: writeResult.path })
            } else {
              endStatus = 'error'
              endErrorMessage = t('runtime.error.reportSaveFailed', { message: writeResult.error })
              console.error('[Report save failed]', writeResult.error)
            }
          }
        } catch (err) {
          endStatus = 'error'
          endErrorMessage = t('runtime.error.reportCreateFailed', { message: String((err as Error)?.message ?? err) })
          console.error('[Report generation failed]', err)
        }
        setEndNodeDisplayValues(prev => {
          const next = { ...prev }
          if (endStatus === 'success' && displayValues.length > 0) next[nodeId] = displayValues
          else delete next[nodeId]
          return next
        })
        setNodeStatuses(prev => ({ ...prev, [nodeId]: endStatus }))
        if (endStatus === 'error') {
          if (handleLoopFailure(nodeId, endErrorMessage)) return
          setCanvasExecution(null)
          return
        }
        if (continueLoopIfNeeded()) return
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
          const output = readDataNodeOutput(node.config, commonDataModules)
          nodeOutputs[nodeId] = output
          updateLog(entryId, { status: 'success', output, duration: Date.now() - startedAt })
          setNodeStatuses(prev => ({ ...prev, [nodeId]: 'success' }))
        } catch (err) {
          nodeOutputs[nodeId] = []
          const errStr = String(err)
          updateLog(entryId, { status: 'error', error: errStr, duration: Date.now() - startedAt })
          setNodeStatuses(prev => ({ ...prev, [nodeId]: 'error' }))
          if (handleLoopFailure(nodeId, errStr)) return
          setCanvasExecution(null)
          return
        }
        step++; continue
      }

      if (node.type === 'select') {
        setNodeRunInputs(prev => ({ ...prev, [nodeId]: JSON.stringify(rawInput, null, 2) }))
        setNodeScriptLogs(prev => ({ ...prev, [nodeId]: { pre: [], post: [] } }))
        let currentScriptLogs: ScriptLogBundle = { pre: [], post: [] }
        const recordScriptLogs = (phase: keyof ScriptLogBundle, logs: ScriptConsoleEntry[]): void => {
          currentScriptLogs = { ...currentScriptLogs, [phase]: logs }
          setScriptLogsForNode(nodeId, phase, logs)
          updateLog(entryId, { scriptLogs: currentScriptLogs })
        }
        try {
          const selCfg = parseSelectConfig(node.config)
          let preInputVars: Record<string, unknown> = {}
          const preScriptInput = buildRuntimeInputContext(rawInput, upstreamModuleVars)
          if (selCfg.preScript && selCfg.preScript.trim()) {
            try {
              const preResult = await runPreRequest(selCfg.preScript, { input: preScriptInput, envVars: envVarsForRun, language })
              recordScriptLogs('pre', preResult.logs)
              preInputVars = preResult.inputVars
              for (const [k, v] of Object.entries(preResult.envUpdates)) envVarsForRun[k] = v
              recordUpdatedEnvVariables(usedVariables, envVarsForRun, preResult.envUpdates)
              if (Object.keys(preResult.envUpdates).length > 0) await persistEnvUpdatesForRun(preResult.envUpdates)
            } catch (err) {
              if (isScriptRuntimeError(err)) recordScriptLogs('pre', err.logs)
              throw new Error(t('runtime.error.preScript', { message: String((err as Error)?.message ?? err) }))
            }
          }
          moduleVars[nodeId] = { ...upstreamModuleVars, ...preInputVars }

          const applySelectPost = async (selectedOutput: unknown): Promise<unknown> => {
            let finalOutput = selectedOutput
            let postOutputVars: Record<string, unknown> = {}
            if (selCfg.postScript && selCfg.postScript.trim()) {
              try {
                const postScriptInput = buildRuntimeInputContext(rawInput, { ...upstreamModuleVars, ...preInputVars })
                const postResult = await runPostResponse(selCfg.postScript, {
                  input: postScriptInput,
                  output: selectedOutput,
                  envVars: envVarsForRun,
                  language,
                })
                recordScriptLogs('post', postResult.logs)
                postOutputVars = postResult.outputVars
                if (postResult.hasOutputOverride) finalOutput = postResult.outputOverride
                for (const [k, v] of Object.entries(postResult.envUpdates)) envVarsForRun[k] = v
                recordUpdatedEnvVariables(usedVariables, envVarsForRun, postResult.envUpdates)
                if (Object.keys(postResult.envUpdates).length > 0) await persistEnvUpdatesForRun(postResult.envUpdates)
              } catch (err) {
                if (isScriptRuntimeError(err)) recordScriptLogs('post', err.logs)
                throw new Error(t('runtime.error.postScript', { message: String((err as Error)?.message ?? err) }))
              }
            }
            moduleVars[nodeId] = { ...upstreamModuleVars, ...preInputVars, ...postOutputVars }
            return finalOutput
          }

          if (selCfg.selectionType === 'script') {
            const finalOutput = await applySelectPost(buildSelectScriptOutput(preInputVars))
            nodeOutputs[nodeId] = finalOutput
            setNodeRunOutputs(prev => ({ ...prev, [nodeId]: JSON.stringify(finalOutput, null, 2) }))
            updateLog(entryId, { status: 'success', output: finalOutput, duration: Date.now() - startedAt, scriptLogs: currentScriptLogs })
            setNodeStatuses(prev => ({ ...prev, [nodeId]: 'success' }))
            step++; continue
          }

          const selectedJsonPaths = selectedJsonPathsForConfig(selCfg)
          const selectedRowIndices = selectedRowIndicesForConfig(selCfg)
          if (selCfg.autoSelect && selCfg.selectMode === 'json' && selectedJsonPaths.length > 0) {
            const autoJson = buildSelectedJsonOutput(rawInput, selectedJsonPaths)
            const finalOutput = await applySelectPost(autoJson)
            nodeOutputs[nodeId] = finalOutput
            setNodeRunOutputs(prev => ({ ...prev, [nodeId]: JSON.stringify(finalOutput, null, 2) }))
            updateLog(entryId, { status: 'success', output: finalOutput, duration: Date.now() - startedAt, scriptLogs: currentScriptLogs })
            setNodeStatuses(prev => ({ ...prev, [nodeId]: 'success' }))
            step++; continue
          }
          if (Array.isArray(rawInput) && selCfg.autoSelect && selectedRowIndices.length > 0 && inputArray.length > 0) {
            const autoRow = selectedRowIndices
              .map(index => inputArray[index])
              .filter(value => value !== undefined)
            const finalOutput = await applySelectPost(autoRow)
            nodeOutputs[nodeId] = finalOutput
            setNodeRunOutputs(prev => ({ ...prev, [nodeId]: JSON.stringify(finalOutput, null, 2) }))
            updateLog(entryId, { status: 'success', output: finalOutput, duration: Date.now() - startedAt, scriptLogs: currentScriptLogs })
            setNodeStatuses(prev => ({ ...prev, [nodeId]: 'success' }))
            step++; continue
          }
          updateLog(entryId, { scriptLogs: currentScriptLogs })
          setCanvasExecution({
            nodeOutputs,
            moduleVars,
            branchRoutes,
            envVars: envVarsForRun,
            persistedEnvVarsByEnvId,
            usedVariables,
            execLogs: localLogs,
            startedAt: exec.startedAt,
            plan,
            step: step + 1,
            loop: exec.loop,
            pendingSelectInput: rawInput ?? [],
            pendingBranchChoice: null,
            pendingLogEntryId: entryId,
          })
          return
        } catch (err) {
          nodeOutputs[nodeId] = null
          const errStr = String(err)
          setNodeRunOutputs(prev => ({ ...prev, [nodeId]: errStr }))
          updateLog(entryId, { status: 'error', error: errStr, duration: Date.now() - startedAt, scriptLogs: currentScriptLogs })
          setNodeStatuses(prev => ({ ...prev, [nodeId]: 'error' }))
          if (handleLoopFailure(nodeId, errStr)) return
          setCanvasExecution(null)
          return
        }
      }

      if (node.type === 'branch') {
        setNodeRunInputs(prev => ({ ...prev, [nodeId]: JSON.stringify(rawInput, null, 2) }))
        try {
          const branchCfg = parseBranchConfig(node.config)
          const branchInput = buildRuntimeInputContext(rawInput, upstreamModuleVars)
          if (branchCfg.mode === 'manual' && branchCfg.manualSource === 'runtime') {
            setCanvasExecution({
              nodeOutputs,
              moduleVars,
              branchRoutes,
              envVars: envVarsForRun,
              persistedEnvVarsByEnvId,
              usedVariables,
              execLogs: localLogs,
              startedAt: exec.startedAt,
              plan,
              step: step + 1,
              loop: exec.loop,
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
            recordUsedBranchVariables(usedVariables, branchCfg.expression, branchInput, loopRow ? { ...loopRow } : upstreamModuleVars)
          }
          const result = evaluateBranch(branchCfg, branchInput, loopRow ? { ...loopRow } : upstreamModuleVars, language)
          branchRoutes[nodeId] = result.route
          setActiveBranchRoutes(prev => ({ ...prev, [nodeId]: result.route }))
          nodeOutputs[nodeId] = rawInput
          setNodeRunOutputs(prev => ({ ...prev, [nodeId]: JSON.stringify(rawInput, null, 2) }))
          updateLog(entryId, { status: 'success', output: rawInput, duration: Date.now() - startedAt })
          setNodeStatuses(prev => ({ ...prev, [nodeId]: 'success' }))
        } catch (err) {
          nodeOutputs[nodeId] = null
          const errStr = String(err)
          updateLog(entryId, { status: 'error', error: errStr, duration: Date.now() - startedAt })
          setNodeStatuses(prev => ({ ...prev, [nodeId]: 'error' }))
          if (handleLoopFailure(nodeId, errStr)) return
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
          const preScriptInput = buildRuntimeInputContext(rawInput, upstreamModuleVars)
          if (cfg.preScript && cfg.preScript.trim()) {
            try {
              const r = await runPreRequest(cfg.preScript, { input: preScriptInput, envVars: envVarsForExec, language })
              recordScriptLogs('pre', r.logs)
              preInputVars = r.inputVars
              for (const [k, v] of Object.entries(r.envUpdates)) envVarsForExec[k] = v
              recordUpdatedEnvVariables(usedVariables, envVarsForExec, r.envUpdates)
              if (Object.keys(r.envUpdates).length > 0) await persistEnvUpdates(r.envUpdates)
            } catch (err) {
              if (isScriptRuntimeError(err)) recordScriptLogs('pre', err.logs)
              throw new Error(t('runtime.error.preScript', { message: String((err as Error)?.message ?? err) }))
            }
          }

          const items = buildApiTemplateItems(rawInput, incomingEdges, upstreamModuleVars, preInputVars)

          const allResults: unknown[] = []

          for (const row of items) {
            const item: Record<string, unknown> = applyInputMappings(row, cfg.inputMappings ?? {})
            const templateDataVars = loopRow ? { ...loopRow } : item
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
              templateDataVars,
            )

            let fullUrl = resolveTemplate(cfg.url.trim(), envVarsForExec, item, templateDataVars)
            if (enabledParams.length > 0) {
              const qs = new URLSearchParams(enabledParams.map(p => [p.key, resolveTemplate(p.value, envVarsForExec, item, templateDataVars)]))
              fullUrl += (fullUrl.includes('?') ? '&' : '?') + qs.toString()
            }
            const hdrs: Record<string, string> = {}
            ;enabledHeaders.forEach(h => {
              hdrs[h.key] = resolveTemplate(h.value, envVarsForExec, item, templateDataVars)
            })
            let bodyStr: string | undefined
            if (['POST', 'PUT', 'PATCH'].includes(cfg.method) && cfg.body?.trim()) {
              if (cfg.bodyType === 'json' && !hdrs['Content-Type'] && !hdrs['content-type']) {
                hdrs['Content-Type'] = 'application/json'
              }
              bodyStr = resolveTemplate(cfg.body, envVarsForExec, item, templateDataVars)
            }

            const authedRequest = applyApiAuth({ url: fullUrl, headers: hdrs }, cfg.auth, envVarsForExec, item, templateDataVars)
            fullUrl = authedRequest.url
            const requestHeaders = authedRequest.headers

            lastApiDetail = { method: cfg.method, url: fullUrl, headers: requestHeaders, body: bodyStr }

            const res = await window.api.http.fetch(fullUrl, { method: cfg.method, headers: requestHeaders, body: bodyStr })
            lastApiDetail = { ...lastApiDetail, statusCode: res.status, statusText: res.statusText, responseText: res.text }

            if (!res.ok) {
              throw new ApiHttpError(res.status, res.statusText, res.text)
            }
            try {
              const data = JSON.parse(res.text) as unknown
              appendApiExecutionResult(allResults, data)
            } catch {
              appendApiExecutionResult(allResults, res.text)
            }
          }

          // ── Post Response script ───────────────────────
          let postOutputVars: Record<string, unknown> = {}
          const responseOutput = normalizeApiExecutionOutput(allResults)
          let finalOutput: unknown = responseOutput
          if (cfg.postScript && cfg.postScript.trim()) {
            try {
              const postScriptInput = buildRuntimeInputContext(rawInput, { ...upstreamModuleVars, ...preInputVars })
              const r = await runPostResponse(cfg.postScript, {
                input: postScriptInput,
                output: responseOutput,
                envVars: envVarsForExec,
                language,
              })
              recordScriptLogs('post', r.logs)
              postOutputVars = r.outputVars
              if (r.hasOutputOverride) finalOutput = r.outputOverride
              for (const [k, v] of Object.entries(r.envUpdates)) envVarsForExec[k] = v
              recordUpdatedEnvVariables(usedVariables, envVarsForExec, r.envUpdates)
              if (Object.keys(r.envUpdates).length > 0) await persistEnvUpdates(r.envUpdates)
            } catch (err) {
              if (isScriptRuntimeError(err)) recordScriptLogs('post', err.logs)
              throw new Error(t('runtime.error.postScript', { message: String((err as Error)?.message ?? err) }))
            }
          }

          nodeOutputs[nodeId] = finalOutput
          moduleVars[nodeId] = { ...upstreamModuleVars, ...postOutputVars }
          setNodeRunOutputs(prev => ({ ...prev, [nodeId]: JSON.stringify(finalOutput, null, 2) }))
          updateLog(entryId, { status: 'success', output: finalOutput, duration: Date.now() - startedAt, apiDetail: lastApiDetail, scriptLogs: currentScriptLogs })
          setNodeStatuses(prev => ({ ...prev, [nodeId]: 'success' }))
        } catch (err) {
          const isHttpError = err instanceof ApiHttpError
          const errorOutput = isHttpError ? err.output : null
          const errStr = isHttpError ? err.message : String(err)
          nodeOutputs[nodeId] = errorOutput
          setNodeRunOutputs(prev => ({ ...prev, [nodeId]: isHttpError ? stringifyNodeOutput(errorOutput) : errStr }))
          updateLog(entryId, { status: 'error', output: errorOutput, error: errStr, duration: Date.now() - startedAt, apiDetail: lastApiDetail, scriptLogs: currentScriptLogs })
          setNodeStatuses(prev => ({ ...prev, [nodeId]: 'error' }))
          if (handleLoopFailure(nodeId, errStr)) return
          setCanvasExecution(null)
          return
        }
        step++; continue
      }

      step++
    }

    if (continueLoopIfNeeded()) return
    setCanvasExecution(null)
  }, [activeNodes, activeEdges, activeProjectWs, activeProjectEnvVars, activeProjectEnvDisplayVars, activeProject?.name, rememberSelectSelection, setScriptLogsForNode, t])

  const handleCanvasRun = useCallback(() => {
    if (!activeProject || canvasExecution) return
    const plan = buildExecutionPlan(activeNodes, activeEdges)
    if (plan.length === 0) return
    const startNode = activeNodes.find(n => n.id === plan[0] && n.type === 'start')
    const repeatRowsResult = buildRepeatRows(startNode, t('runtime.error.startRepeatDataMissing'))
    if (!repeatRowsResult.ok) {
      alert(repeatRowsResult.error)
      return
    }
    const startedAt = Date.now()
    const loop = repeatRowsResult.rows
      ? {
          startNodeId: startNode?.id ?? '',
          rows: repeatRowsResult.rows,
          index: 0,
          total: repeatRowsResult.rows.length,
          stopOnFailure: repeatRowsResult.stopOnFailure,
          logStartIndex: 0,
          iterationStartedAt: startedAt,
        } satisfies ExecutionLoopContext
      : undefined
    setExecLogs([])
    setNodeStatuses({})
    setActiveBranchRoutes({})
    setEndNodeDisplayValues({})
    setActiveLogNodeId(null)
    setNodeScriptLogs({})
    setStartRepeatRowStates(loop && startNode
      ? {
          [startNode.id]: Object.fromEntries(loop.rows.map((row, index) => {
            const no = Math.max(1, Math.floor(Number(row.no) || index + 1))
            return [no, { status: 'pending' as StartRepeatRowStatus, updatedAt: startedAt }]
          })),
        }
      : {})
    setLastStartNodeLoopProgress(loop && startNode
      ? {
          [startNode.id]: {
            current: 1,
            total: loop.total,
          },
        }
      : {})
    const execution: CanvasExecution = {
      nodeOutputs: {},
      moduleVars: {},
      branchRoutes: {},
      envVars: { ...activeProjectEnvVars },
      usedVariables: {},
      execLogs: [],
      startedAt,
      plan,
      step: 0,
      loop,
      pendingSelectInput: null,
      pendingBranchChoice: null,
    }
    advanceExecution(execution)
  }, [activeNodes, activeEdges, activeProject, activeProjectEnvVars, advanceExecution, canvasExecution, t])

  const handleCanvasReset = useCallback(() => {
    setExecLogs([])
    setNodeStatuses({})
    setActiveBranchRoutes({})
    setEndNodeDisplayValues({})
    setActiveLogNodeId(null)
    setLogState('collapsed')
    setNodeRunInputs({})
    setNodeRunOutputs({})
    setNodeScriptLogs({})
    setStartRepeatRowStates({})
    setLastStartNodeLoopProgress({})
  }, [])

  const handleExportFailedRepeatRows = useCallback(async (nodeId: string): Promise<string> => {
    const startNode = activeNodes.find(node => node.id === nodeId && node.type === 'start')
    if (!startNode) throw new Error(t('runtime.error.startNotFound'))

    const repeat = parseStartConfig(startNode.config).repeat
    if (!repeat?.data || repeat.data.rows.length === 0) {
      throw new Error(t('runtime.error.repeatDataMissing'))
    }

    const states = startRepeatRowStates[nodeId] ?? {}
    const failedRows = repeat.data.rows
      .map((row, index) => {
        const no = Math.max(1, Math.floor(Number(row.no) || index + 1))
        return { row, no, state: states[no] }
      })
      .filter(item => item.state?.status === 'failed')

    if (failedRows.length === 0) {
      throw new Error(t('runtime.error.failedDataMissing'))
    }

    const nodeLabelById = new Map(activeNodes.map(node => [node.id, node.label]))
    const sourceColumns = repeat.data.columns.length > 0
      ? repeat.data.columns
      : Array.from(new Set(repeat.data.rows.flatMap(row => Object.keys(row))))
    const failedStatusColumn = t('runtime.export.failedStatusColumn')
    const failedModuleColumn = t('runtime.export.failedModuleColumn')
    const failedReasonColumn = t('runtime.export.failedReasonColumn')
    const exportColumns = Array.from(new Set(['no', ...sourceColumns, failedStatusColumn, failedModuleColumn, failedReasonColumn]))
    const exportRows = failedRows.map(({ row, state }) => ({
      ...row,
      [failedStatusColumn]: t('runtime.export.failedStatus'),
      [failedModuleColumn]: state?.failedNodeId ? (nodeLabelById.get(state.failedNodeId) ?? state.failedNodeId) : '',
      [failedReasonColumn]: state?.error ?? '',
    }))

    const workbookBase64 = await buildExcelWorkbookBase64(exportColumns, exportRows, 'failed')
    const timestamp = new Date().toISOString().replace(/[:.]/g, '').replace('T', '_').replace('Z', '')
    const projectName = safeDownloadFilePart(activeProject?.name ?? 'project')
    const nodeName = safeDownloadFilePart(startNode.label || 'START')
    const fileName = `a8a_failed_${projectName}_${nodeName}_${timestamp}.xlsx`
    const result = await window.api.file.writeXlsxDownload(fileName, workbookBase64, language)
    if (!result.ok) throw new Error(result.error)
    return result.path
  }, [activeNodes, activeProject?.name, language, startRepeatRowStates, t])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return

      const target = e.target as HTMLElement | null
      const tagName = target?.tagName.toLowerCase()
      if (target?.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select') return
      if (target?.closest('.wf-canvas')) return

      const hasOpenModal = editingNode
        || modalEnv !== undefined
        || modalProject
        || modalProjectClone
        || modalWorkspace
        || confirmDeleteWsId
        || confirmDeleteProject
        || confirmDeleteEnv
        || confirmDeleteCanvasNodes.length > 0
        || confirmDeleteEdge
        || savedReport
        || pendingPreviewSelect
        || envDropdownOpen

      if (!activeProject || hasOpenModal) return

      const key = e.key.toLowerCase()
      if (!canvasExecution && key === 'z') {
        e.preventDefault()
        if (e.shiftKey) {
          if (canCanvasRedo) void handleCanvasRedo()
        } else if (canCanvasUndo) {
          void handleCanvasUndo()
        }
        return
      }

      if (!canvasExecution && key === 'y') {
        e.preventDefault()
        if (canCanvasRedo) void handleCanvasRedo()
        return
      }

      if (canvasExecution || key !== 'enter') return

      e.preventDefault()
      handleCanvasRun()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    activeProject,
    canCanvasRedo,
    canCanvasUndo,
    canvasExecution,
    confirmDeleteCanvasNodes.length,
    confirmDeleteEdge,
    confirmDeleteEnv,
    confirmDeleteProject,
    confirmDeleteWsId,
    editingNode,
    envDropdownOpen,
    handleCanvasRedo,
    handleCanvasRun,
    handleCanvasUndo,
    modalEnv,
    modalProject,
    modalProjectClone,
    modalWorkspace,
    pendingPreviewSelect,
    savedReport,
  ])

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
        let cfg: Partial<ApiConfig & SelectConfig> | undefined
        if (node?.type === 'api' || node?.type === 'select') {
          try { cfg = JSON.parse(node.config || '{}') as Partial<ApiConfig & SelectConfig> } catch { cfg = undefined }
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
        language,
      })
      const dir = await window.api.file.downloadsDir()
      const filename = fillFilenameTemplate('execution-log_{env}_{ws}_{project}_{ts}', {
        env: envName,
        ws: wsName,
        project: activeProject.name,
        ts: new Date(),
      })
      const sep = dir.includes('/') && !dir.includes('\\') ? '/' : '\\'
      const result = await window.api.file.write(`${dir.replace(/[\\/]+$/, '')}${sep}${filename}.html`, content, language)
      if (!result.ok) {
        alert(t('report.alert.htmlSaveFailed', { message: result.error }))
        return
      }
      setSavedReport({ path: result.path })
    } catch (err) {
      alert(t('report.alert.htmlCreateFailed', { message: String((err as Error)?.message ?? err) }))
    } finally {
      setDownloadingReport(false)
    }
  }, [activeNodes, activeProject, activeProjectEnv?.name, activeProjectWs?.name, execLogs, language, t])

  const handleOpenSavedReport = useCallback(async (): Promise<void> => {
    if (!savedReport) return
    const reportPath = savedReport.path
    setSavedReport(null)
    const result = await window.api.file.open(reportPath, language)
    if (!result.ok) alert(t('report.alert.openFailed', { message: result.error }))
  }, [language, savedReport, t])

  const reloadWorkspaceTree = useCallback(async (preferredWsId?: string, preferredProjectId?: string): Promise<void> => {
    const [wsList] = await Promise.all([
      window.api.workspace.list(),
      refreshCommonDataModules(),
    ])
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

    const nextWs = all.find(ws => ws.id === preferredWsId) ?? all[0]
    setActiveWsId(nextWs?.id ?? '')
    const nextProject = nextWs?.projects.find(project => project.id === preferredProjectId) ?? nextWs?.projects[0]
    setActiveProjectId(nextProject?.id ?? '')
  }, [refreshCommonDataModules])

  const handleExportWorkspace = useCallback(async (): Promise<void> => {
    if (!activeProjectWs) {
      alert(t('transfer.noWorkspaceToExport'))
      return
    }
    setTransferBusy(true)
    setTransferMenuOpen(false)
    try {
      const result = await window.api.transfer.exportWorkspace(activeProjectWs.id, language)
      if (result.ok) alert(t('transfer.exportWorkspaceSuccess', { path: result.path }))
      else if (!result.canceled) alert(t('transfer.exportWorkspaceFailed', { message: result.error ?? t('transfer.unknownError') }))
    } finally {
      setTransferBusy(false)
    }
  }, [activeProjectWs, language, t])

  const handleExportProject = useCallback(async (): Promise<void> => {
    if (!activeProject) {
      alert(t('transfer.noProjectToExport'))
      return
    }
    setTransferBusy(true)
    setTransferMenuOpen(false)
    try {
      const result = await window.api.transfer.exportProject(activeProject.id, language)
      if (result.ok) alert(t('transfer.exportProjectSuccess', { path: result.path }))
      else if (!result.canceled) alert(t('transfer.exportProjectFailed', { message: result.error ?? t('transfer.unknownError') }))
    } finally {
      setTransferBusy(false)
    }
  }, [activeProject, language, t])

  const handleImportWorkspace = useCallback(async (): Promise<void> => {
    setTransferBusy(true)
    setTransferMenuOpen(false)
    try {
      const result = await window.api.transfer.importWorkspace(language)
      if (!result.ok) {
        if (!result.canceled) alert(t('transfer.importWorkspaceFailed', { message: result.error ?? t('transfer.unknownError') }))
        return
      }
      await reloadWorkspaceTree(result.result.workspaceId, result.result.projectId)
      alert(t('transfer.importWorkspaceSuccess', { name: result.result.workspaceName ?? t('transfer.importedWorkspaceFallback') }))
    } finally {
      setTransferBusy(false)
    }
  }, [language, reloadWorkspaceTree, t])

  const handleImportProject = useCallback(async (): Promise<void> => {
    const targetWorkspace = activeProjectWs ?? workspaces.find(ws => ws.id === activeWsId) ?? workspaces[0]
    if (!targetWorkspace) {
      alert(t('transfer.noWorkspaceToImportProject'))
      return
    }
    setTransferBusy(true)
    setTransferMenuOpen(false)
    try {
      const result = await window.api.transfer.importProject(targetWorkspace.id, language)
      if (!result.ok) {
        if (!result.canceled) alert(t('transfer.importProjectFailed', { message: result.error ?? t('transfer.unknownError') }))
        return
      }
      await reloadWorkspaceTree(targetWorkspace.id, result.result.projectId)
      alert(t('transfer.importProjectSuccess', { name: result.result.projectName ?? t('transfer.importedProjectFallback') }))
    } finally {
      setTransferBusy(false)
    }
  }, [activeProjectWs, activeWsId, language, reloadWorkspaceTree, workspaces, t])

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
    setActiveView('canvas')
  }

  const openSettings = (): void => {
    setCanvasFullscreen(false)
    setIconTooltip(null)
    setActiveView('settings')
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
    const deletedProjectIds = new Set(workspaces.find(w => w.id === confirmDeleteWsId)?.projects.map(project => project.id) ?? [])
    await window.api.workspace.delete(confirmDeleteWsId)
    setCanvasHistories(prev => {
      if (deletedProjectIds.size === 0) return prev
      const next = { ...prev }
      deletedProjectIds.forEach(id => delete next[id])
      return next
    })
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
  const openCloneProjectModal = (wsId: string, project: ProjectItem): void => setModalProjectClone({ wsId, project })
  const closeProjectModal = (): void => setModalProject(null)
  const closeCloneProjectModal = (): void => setModalProjectClone(null)

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

  const duplicateProject = async (name: string): Promise<void> => {
    if (!modalProjectClone) return
    const { wsId, project } = modalProjectClone
    const created = await window.api.project.duplicate(project.id, name)
    const newProject = created as ProjectItem
    setWorkspaces(prev => prev.map(w => {
      if (w.id !== wsId) return w
      const sourceIndex = w.projects.findIndex(p => p.id === project.id)
      const nextProjects = [...w.projects]
      if (sourceIndex >= 0) {
        nextProjects.splice(sourceIndex + 1, 0, newProject)
      } else {
        nextProjects.push(newProject)
      }
      return { ...w, projects: nextProjects }
    }))
    closeCloneProjectModal()
    selectProject(wsId, newProject.id)
  }

  const deleteProject = async (): Promise<void> => {
    if (!confirmDeleteProject) return
    const { wsId, project } = confirmDeleteProject
    await window.api.project.delete(project.id)
    setCanvasHistories(prev => {
      if (!prev[project.id]) return prev
      const next = { ...prev }
      delete next[project.id]
      return next
    })
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

  const handleProjectReorder = useCallback(async (wsId: string, orderedIds: string[]): Promise<void> => {
    const workspace = workspaces.find(w => w.id === wsId)
    if (!workspace) return
    const byId = new Map(workspace.projects.map(project => [project.id, project]))
    const orderedProjects = orderedIds
      .map(id => byId.get(id))
      .filter((project): project is ProjectItem => !!project)
    if (orderedProjects.length !== workspace.projects.length) return

    setWorkspaces(prev => prev.map(w => (
      w.id === wsId ? { ...w, projects: orderedProjects } : w
    )))

    try {
      await window.api.project.reorder(wsId, orderedIds)
    } catch (err) {
      console.error('Failed to reorder projects:', err)
      setWorkspaces(prev => prev.map(w => (
        w.id === wsId ? { ...w, projects: workspace.projects } : w
      )))
    }
  }, [workspaces])

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
    ? t('topbar.update.ready')
    : updateState?.status === 'downloading'
      ? t('topbar.update.downloadingTitle')
      : updateState?.status === 'checking'
        ? t('topbar.update.checking')
        : updateState?.status === 'not-available'
          ? t('topbar.update.latest')
          : updateState?.status === 'error'
            ? t('topbar.update.failed')
            : updateState?.status === 'disabled'
              ? t('topbar.update.disabled')
              : t('topbar.update.available')
  const updateDisplayMessage = (() => {
    if (!updateState) return ''
    if (updateState.messageKey && isTranslationKey(updateState.messageKey)) {
      return t(updateState.messageKey, updateState.messageVars)
    }
    if (updateState.status === 'available') {
      return updateState.availableVersion
        ? t('topbar.update.message.availableVersion', { version: updateState.availableVersion })
        : t('topbar.update.message.available')
    }
    if (updateState.status === 'downloading') return t('topbar.update.message.downloading')
    if (updateState.status === 'downloaded') {
      const isMac = document.documentElement.dataset.platform === 'darwin'
      return t(isMac ? 'topbar.update.message.downloadedMac' : 'topbar.update.message.downloadedWin')
    }
    if (updateState.status === 'not-available') return t('topbar.update.message.latest')
    if (updateState.status === 'disabled') return t('topbar.update.message.disabledDev')
    if (updateState.status === 'error') return updateState.message ?? t('topbar.update.message.errorGeneric')
    return updateState.message ?? t('topbar.update.message.available')
  })()
  const updateActionBusy = updateState?.status === 'checking' || updateState?.status === 'downloading'
  const updateActionLabel = updateState?.status === 'downloaded'
    ? t('topbar.update.apply')
    : updateState?.status === 'available'
      ? t('topbar.update.download')
      : updateState?.status === 'downloading'
        ? t('topbar.update.downloading', { progress: updateProgress })
        : updateState?.status === 'checking'
          ? t('topbar.update.checking')
          : t('topbar.update.check')

  if (loading) {
    return (
      <I18nProvider value={i18nValue}>
        <div className="app" data-theme={theme} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-4)', fontSize: 13 }}>
          {t('app.loading')}
        </div>
      </I18nProvider>
    )
  }

  return (
    <I18nProvider value={i18nValue}>
    <div className={`app${isCanvasFullscreen ? ' app-canvas-fullscreen' : ''}`} data-theme={theme}>
      {updateNoticeVisible && updateState && (
        <div className="update-notice no-drag">
          <div className="update-notice-main">
            <div className="update-notice-title">{updateDisplayTitle}</div>
            <div className="update-notice-message">
              {updateDisplayMessage}
              {updateState.availableVersion && (
                <span className="update-notice-version">
                  {t('topbar.update.versionLine', { current: updateState.currentVersion, latest: updateState.availableVersion })}
                </span>
              )}
            </div>
            {updateState.status === 'downloading' && (
              <div className="update-progress" aria-label={t('topbar.update.progressAria', { progress: updateProgress })}>
                <div className="update-progress-bar" style={{ width: `${updateProgress}%` }} />
              </div>
            )}
          </div>
          <div className="update-notice-actions">
            {updateState.status === 'available' && (
              <button className="btn" onClick={() => { void window.api.update.download() }}>
                {t('common.download')}
              </button>
            )}
            {updateState.status === 'downloaded' && (
              <button className="btn primary" onClick={() => { void handleUpdateAction() }} disabled={updateActionBusy}>
                {updateActionLabel}
              </button>
            )}
            <button
              className="btn ghost"
              onClick={() => {
                setUpdateNoticeHidden(true)
                setManualUpdateRequested(false)
              }}
            >
              {t('common.later')}
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
                title={t('sidebar.collapse')}
              >
                <IcoPanelL size={14} />
              </button>
            </>
          ) : (
            <button
              className="btn ghost icon sidebar-expand-btn"
              onClick={() => setSidebarLayout('full')}
              title={t('sidebar.expand')}
            >
              <IcoPanelL size={15} />
            </button>
          )}
        </div>

        {!isFull && (
          <div className="sidebar-icons-projects">
            {workspaces.map(ws => {
              const projectIconLabels = buildProjectIconLabels(ws.projects)
              return ws.projects.length > 0 ? (
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
                      aria-label={t('sidebar.project.openAria', { workspace: ws.name, project: proj.name })}
                    >
                      {projectIconLabels.get(proj.id) ?? proj.name.charAt(0).toUpperCase()}
                    </button>
                  ))}
                </div>
              ) : null
            })}
          </div>
        )}

        {!isFull && (
          <div className="sidebar-icons-footer">
            <button
              className={`sidebar-proj-icon sidebar-settings-icon${activeView === 'settings' ? ' sidebar-proj-icon-active' : ''}`}
              onMouseEnter={e => {
                const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect()
                setIconTooltip({ text: t('settings.menu'), x: rect.right + 8, y: rect.top + rect.height / 2 })
              }}
              onMouseLeave={() => setIconTooltip(null)}
              onClick={openSettings}
              aria-label={t('settings.menu')}
            >
              <IcoSettings size={15} />
            </button>
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
                      onDuplicate={(proj) => openCloneProjectModal(wsId, proj)}
                      onDelete={(proj) => setConfirmDeleteProject({ wsId, project: proj })}
                      onReorder={(orderedIds) => { void handleProjectReorder(wsId, orderedIds) }}
                    />
                  </>
                )
              }}
            />
            <ModulePaletteSection stateKey="common-module" title={t('sidebar.commonModules')} commonDataModules={commonDataModules} />
          </div>
        )}

        {isFull && (
          <div className="sidebar-footer">
            <button
              className={`sidebar-settings-btn${activeView === 'settings' ? ' sidebar-settings-btn-active' : ''}`}
              onClick={openSettings}
              title={t('settings.menu')}
            >
              <IcoSettings size={14} />
              <span>{t('settings.menu')}</span>
            </button>
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
            {activeView === 'settings' ? (
              <div className="topbar-breadcrumb">
                <span className="topbar-bc-proj">{t('settings.title')}</span>
              </div>
            ) : activeProject && (
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
                      title={t('topbar.environment.change')}
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
              title={t('topbar.update.check')}
            >
              <IcoDownload size={13} />
              {updateActionLabel}
            </button>
            <button className="btn ghost icon" onClick={toggleTheme} title={theme === 'dark' ? t('topbar.theme.light') : t('topbar.theme.dark')}>
              {theme === 'dark' ? <IcoSun size={15} /> : <IcoMoon size={15} />}
            </button>
            <div className="topbar-transfer" ref={transferMenuRef}>
              <button
                className="btn topbar-transfer-btn"
                onClick={() => setTransferMenuOpen(open => !open)}
                disabled={transferBusy}
                title={t('topbar.transfer.title')}
              >
                <IcoUpload size={13} />
                {transferBusy ? t('common.processing') : t('topbar.transfer.label')}
                <IcoChevD size={10} />
              </button>
              {transferMenuOpen && (
                <div className="topbar-transfer-menu">
                  <div className="topbar-transfer-group-label">{t('topbar.transfer.export')}</div>
                  <button className="topbar-transfer-option" onClick={() => { void handleExportWorkspace() }} disabled={!activeProjectWs || transferBusy}>
                    <IcoDownload size={13} />
                    {t('topbar.transfer.exportWorkspace')}
                  </button>
                  <button className="topbar-transfer-option" onClick={() => { void handleExportProject() }} disabled={!activeProject || transferBusy}>
                    <IcoDownload size={13} />
                    {t('topbar.transfer.exportProject')}
                  </button>
                  <div className="topbar-transfer-separator" />
                  <div className="topbar-transfer-group-label">{t('topbar.transfer.import')}</div>
                  <button className="topbar-transfer-option" onClick={() => { void handleImportWorkspace() }} disabled={transferBusy}>
                    <IcoUpload size={13} />
                    {t('topbar.transfer.importWorkspace')}
                  </button>
                  <button className="topbar-transfer-option" onClick={() => { void handleImportProject() }} disabled={transferBusy}>
                    <IcoUpload size={13} />
                    {t('topbar.transfer.importProject')}
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="workspace-body">
          {activeView === 'settings' ? (
            <SettingsPage />
          ) : activeProject ? (
            <div className="canvas-wrap">
              <div className="canvas-bg" />
              <WorkflowCanvas
                  key={activeProject.id}
                  projectId={activeProject.id}
                  nodes={activeNodes}
                  edges={activeEdges}
                  onNodeMove={handleNodeMove}
                  onNodeResize={handleNodeResize}
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
                  endNodeDisplayValues={endNodeDisplayValues}
                  startNodeLoopProgress={startNodeLoopProgress}
                  commonDataModules={commonDataModules}
                  envVars={activeProjectEnvVars}
                  dataVars={startRepeatPreviewData}
                  nodeRunInputs={nodeRunInputs}
                  onCanvasRun={handleCanvasRun}
                  onCanvasReset={handleCanvasReset}
                  onCanvasUndo={handleCanvasUndo}
                  onCanvasRedo={handleCanvasRedo}
                  canCanvasUndo={canCanvasUndo}
                  canCanvasRedo={canCanvasRedo}
                  showCanvasReset={Object.keys(nodeStatuses).length > 0}
                  canvasRunDisabled={!!canvasExecution}
                  onNodeStatusClick={onNodeStatusClick}
                  isCanvasFullscreen={isCanvasFullscreen}
                  onCanvasFullscreenChange={setCanvasFullscreen}
                />
            </div>
          ) : (
            <div className="workspace-empty">
              <span>{t('workspace.empty')}</span>
            </div>
          )}
        </div>

        {activeView === 'canvas' && (
        <div className={`log-panel ${logState === 'collapsed' ? 'log-panel-collapsed' : 'log-panel-fullscreen'}`}>
          <div className="log-hd" onClick={toggleLog}>
            <IcoPanelB size={13} style={{ color: 'var(--text-3)' }} />
            <span className="log-title">{t('log.title')}</span>
            <span className="log-spacer" />
            {execLogs.length > 0 && (
              <button
                className="btn ghost log-report-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  void handleDownloadExecutionReport()
                }}
                disabled={downloadingReport}
                title={t('report.downloadHtml')}
              >
                <IcoSave size={12} />
                {t('common.html')}
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
                <span className="log-empty">{t('log.empty')}</span>
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
        )}
      </div>

      {/* ── Env Dropdown (fixed) ── */}
      {envDropdownOpen && !isCanvasFullscreen && activeProjectWs && (
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
              <span className="confirm-title">{t('report.saved.title')}</span>
              <button className="btn ghost icon" onClick={() => setSavedReport(null)} title={t('common.close')}>
                <IcoX size={15} />
              </button>
            </div>
            <div className="report-saved-body">
              <p className="confirm-message">{t('report.saved.message')}</p>
              <p className="confirm-message">{t('report.saved.openQuestion')}</p>
              <div className="report-saved-path" title={savedReport.path}>{savedReport.path}</div>
            </div>
            <div className="confirm-ft">
              <button className="btn" onClick={() => setSavedReport(null)}>{t('common.cancel')}</button>
              <button
                className="btn primary"
                onClick={() => { void handleOpenSavedReport() }}
              >
                {t('common.confirm')}
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

      {modalProjectClone !== null && (
        <ProjectCloneModal
          project={modalProjectClone.project}
          onConfirm={duplicateProject}
          onClose={closeCloneProjectModal}
        />
      )}

      {/* ── Workspace Delete Confirm ── */}
      {confirmDeleteWsId && (() => {
        const ws = workspaces.find(w => w.id === confirmDeleteWsId)
        return ws ? (
          <ConfirmDialog
            title={t('confirm.workspaceDelete.title')}
            message={t('confirm.workspaceDelete.message', { name: ws.name })}
            warning={t('confirm.workspaceDelete.warning')}
            onConfirm={deleteWorkspace}
            onCancel={() => setConfirmDeleteWsId(null)}
          />
        ) : null
      })()}

      {/* ── Env Delete Confirm ── */}
      {confirmDeleteEnv && (
        <ConfirmDialog
          title={t('confirm.envDelete.title')}
          message={t('confirm.envDelete.message', { name: confirmDeleteEnv.env.name })}
          warning={t('confirm.envDelete.warning')}
          onConfirm={deleteEnv}
          onCancel={() => setConfirmDeleteEnv(null)}
        />
      )}

      {/* ── Project Delete Confirm ── */}
      {confirmDeleteCanvasNodes.length > 0 && (
        <ConfirmDialog
          title={t('confirm.canvasNodeDelete.title')}
          message={
            confirmDeleteCanvasNodes.length === 1
              ? t('confirm.canvasNodeDelete.single', { name: confirmDeleteCanvasNodes[0].label })
              : t('confirm.canvasNodeDelete.multiple', { count: confirmDeleteCanvasNodes.length })
          }
          warning={t('confirm.canvasNodeDelete.warning')}
          confirmLabel={t('common.delete')}
          onConfirm={async () => {
            const nodes = confirmDeleteCanvasNodes
            setConfirmDeleteCanvasNodes([])
            await deleteCanvasNodeInstances(nodes)
          }}
          onCancel={() => setConfirmDeleteCanvasNodes([])}
        />
      )}

      {confirmDeleteProject && (
        <ConfirmDialog
          title={t('confirm.projectDelete.title')}
          message={t('confirm.projectDelete.message', { name: confirmDeleteProject.project.name })}
          warning={t('confirm.projectDelete.warning')}
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
          repeatRowStates={startRepeatRowStates[editingNode.id]}
          onResetRepeatRowStates={nodeId => {
            setStartRepeatRowStates(prev => {
              if (!prev[nodeId]) return prev
              const next = { ...prev }
              delete next[nodeId]
              return next
            })
            setLastStartNodeLoopProgress(prev => {
              if (!prev[nodeId]) return prev
              const next = { ...prev }
              delete next[nodeId]
              return next
            })
          }}
          onExportFailedRows={handleExportFailedRepeatRows}
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
            envVarKeys={activeProjectEnvDisplayKeys}
            onSave={handleDataNodeSave}
            onClose={() => setEditingNode(null)}
          />
        )
      })()}

      {editingNode?.type === 'data' && (
        <DataNodeModal
          key={editingNode.id}
          node={editingNode}
          sharedDataModule={findCommonDataModule(commonDataModules, sharedDataModuleIdFromConfig(editingNode.config))}
          initialInput={nodeRunInputs[editingNode.id]}
          onRun={() => previewUpToNode(editingNode.id)}
          onSave={handleDataNodeSave}
          onDelete={async () => {
            await deleteCanvasNodeInstances([editingNode])
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
            await deleteCanvasNodeInstances([editingNode])
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
          dataVars={startRepeatPreviewData}
          onSave={handleDataNodeSave}
          onDelete={async () => {
            await deleteCanvasNodeInstances([editingNode])
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
          dataVars={startRepeatPreviewData}
          onRun={() => previewUpToNode(editingNode.id)}
          onSave={handleDataNodeSave}
          onDelete={async () => {
            await deleteCanvasNodeInstances([editingNode])
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
            selectionType={manualSelectionPopupType(pendingConfig.selectionType)}
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
          selectionType={manualSelectionPopupType(pendingPreviewSelect.config.selectionType)}
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
          title={t('confirm.edgeDelete.title')}
          message={t('confirm.edgeDelete.message')}
          warning={t('confirm.edgeDelete.warning')}
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
    </I18nProvider>
  )
}
