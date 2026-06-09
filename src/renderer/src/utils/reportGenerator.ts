import { JSON_VIEWER_CSS, JSON_VIEWER_JS, jsonViewerBlock } from './jsonViewerTemplate'

export type ReportLanguage = 'ko' | 'en'

export interface ReportMeta {
  environment: string
  workspace: string
  project: string
  executedAt: Date
  totalDuration: number
  overallStatus: 'success' | 'error' | 'partial'
}

export interface ReportApiDetail {
  method: string
  url: string
  headers: Record<string, string>
  body?: string
  statusCode?: number
  statusText?: string
  responseText?: string
}

export interface ReportApiAttempt extends ReportApiDetail {
  index: number
  total: number
  startedAt: number
  duration?: number
  status: 'running' | 'success' | 'error'
  input?: unknown
  output?: unknown
  error?: string
}

export interface ReportScriptConsoleEntry {
  level: string
  message: string
  timestamp: string
}

export interface ReportScriptLogs {
  pre: ReportScriptConsoleEntry[]
  post: ReportScriptConsoleEntry[]
}

export interface ReportNode {
  nodeId: string
  label: string
  type: 'start' | 'end' | 'data' | 'select' | 'api' | 'branch'
  status: 'success' | 'error' | 'skip' | 'running'
  input: unknown
  output?: unknown
  error?: string
  duration?: number
  apiDetail?: ReportApiDetail
  apiAttempts?: ReportApiAttempt[]
  preScript?: string
  postScript?: string
  scriptLogs?: ReportScriptLogs
}

export interface ReportVariable {
  kind: 'env' | 'input' | 'data'
  name: string
  value: unknown
}

export interface ReportIncludeOptions {
  input: boolean
  output: boolean
  preRequest: boolean
  postResponse: boolean
  variables: boolean
}

export interface ReportInput {
  meta: ReportMeta
  // Order matches execution order. Includes Start/End for diagram, but body
  // sections are emitted only for nodes in selectedModuleIds.
  nodes: ReportNode[]
  selectedModuleIds: Set<string>
  variables?: ReportVariable[]
  include?: Partial<ReportIncludeOptions>
  language?: ReportLanguage
}

const DEFAULT_REPORT_INCLUDE_OPTIONS: ReportIncludeOptions = {
  input: true,
  output: true,
  preRequest: true,
  postResponse: true,
  variables: true,
}

function reportIncludeOptions(input: ReportInput): ReportIncludeOptions {
  return { ...DEFAULT_REPORT_INCLUDE_OPTIONS, ...(input.include ?? {}) }
}

const REPORT_LABELS = {
  ko: {
    reportTitle: '실행 리포트',
    environment: '환경',
    workspace: '워크스페이스',
    project: '프로젝트',
    executedAt: '실행 시각',
    totalDuration: '총 소요',
    success: '성공',
    error: '실패',
    partial: '일부 성공',
    skipped: '건너뜀',
    running: '실행 중',
    empty: '(없음)',
    requestHeaders: '요청 헤더',
    requestBody: '요청 바디',
    responseBody: '응답 바디',
    preScript: 'Pre Request 스크립트',
    postScript: 'Post Response 스크립트',
    errorLabel: '오류',
    usedVariables: '사용된 변수',
    countSuffix: '개',
    kind: '구분',
    variableName: '변수명',
    finalValue: '최종 값',
    status: '상태',
    duration: '소요',
    response: '응답',
    attempt: '호출',
    key: '키',
    value: '값',
    executionFlow: '실행 흐름',
  },
  en: {
    reportTitle: 'Execution Report',
    environment: 'Environment',
    workspace: 'Workspace',
    project: 'Project',
    executedAt: 'Executed at',
    totalDuration: 'Total duration',
    success: 'Success',
    error: 'Failed',
    partial: 'Partially successful',
    skipped: 'Skipped',
    running: 'Running',
    empty: '(none)',
    requestHeaders: 'Request headers',
    requestBody: 'Request body',
    responseBody: 'Response body',
    preScript: 'Pre Request script',
    postScript: 'Post Response script',
    errorLabel: 'Error',
    usedVariables: 'Used variables',
    countSuffix: '',
    kind: 'Kind',
    variableName: 'Variable',
    finalValue: 'Final value',
    status: 'Status',
    duration: 'Duration',
    response: 'Response',
    attempt: 'Attempt',
    key: 'Key',
    value: 'Value',
    executionFlow: 'Execution flow',
  },
} as const

type ReportLabels = typeof REPORT_LABELS[ReportLanguage]

function reportLabels(language?: ReportLanguage): ReportLabels {
  return REPORT_LABELS[language ?? 'ko']
}

function jsonViewerLabels(language: ReportLanguage): Record<string, string> {
  return language === 'en'
    ? {
        copyValue: 'Copy value',
        copied: 'Copied',
        copyFailed: 'Copy failed',
        noData: 'No data',
        jsonSerializeFailed: 'Failed to serialize JSON',
        jsonParseFailed: 'Failed to parse JSON',
        tooLargePrefix: 'JSON size ',
        tooLargeSuffix: 'KB - UI/Tree views are disabled above 100KB. Only the JSON view is shown.',
      }
    : {
        copyValue: '값 복사',
        copied: '복사됨',
        copyFailed: '복사 실패',
        noData: '데이터 없음',
        jsonSerializeFailed: 'JSON 직렬화 실패',
        jsonParseFailed: 'JSON 파싱 실패',
        tooLargePrefix: 'JSON 크기 ',
        tooLargeSuffix: 'KB — 100KB 이상이라 UI/Tree 뷰는 비활성. JSON 뷰만 표시됩니다.',
      }
}

function jsonViewerLabelsScript(language: ReportLanguage): string {
  const payload = JSON.stringify(jsonViewerLabels(language)).replace(/</g, '\\u003c')
  return `window.__A8A_JSON_VIEWER_LABELS__=${payload};`
}

function statusText(status: ReportMeta['overallStatus'], labels: ReportLabels): string {
  if (status === 'success') return labels.success
  if (status === 'error') return labels.error
  return labels.partial
}

function nodeStatusText(status: ReportNode['status'], labels: ReportLabels): string {
  if (status === 'success') return labels.success
  if (status === 'error') return labels.errorLabel
  if (status === 'skip') return labels.skipped
  return labels.running
}

function formatCount(count: number, labels: ReportLabels): string {
  return labels.countSuffix ? `${count}${labels.countSuffix}` : String(count)
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

function formatTimestamp(d: Date): string {
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function formatDuration(ms?: number): string {
  if (ms === undefined || ms === null) return '-'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

const TYPE_COLOR: Record<string, string> = {
  data: '#1f6feb',
  select: '#8957e5',
  branch: '#d29922',
  api: '#3fb950',
  start: '#6e7781',
  end: '#6e7781',
}

const STATUS_COLOR: Record<string, string> = {
  success: '#3fb950',
  error: '#f85149',
  skip: '#8b949e',
  running: '#d29922',
}

const STATUS_ICON: Record<string, string> = {
  success: '✓',
  error: '✗',
  skip: '⊘',
  running: '◌',
}

function methodColor(method: string): string {
  switch (method) {
    case 'GET': return '#3fb950'
    case 'POST': return '#2f81f7'
    case 'PUT': return '#d29922'
    case 'PATCH': return '#a371f7'
    case 'DELETE': return '#f85149'
    default: return '#6e7781'
  }
}

function statusCodeColor(code?: number): string {
  if (!code) return '#6e7781'
  if (code >= 200 && code < 300) return '#3fb950'
  if (code >= 300 && code < 400) return '#d29922'
  if (code >= 400) return '#f85149'
  return '#6e7781'
}

function tryParseJson(text?: string): unknown {
  if (!text || !text.trim()) return null
  try { return JSON.parse(text) } catch { return text }
}

// ── HTML report ──────────────────────────────────────────────

function htmlHeader(meta: ReportMeta, labels: ReportLabels): string {
  const statusBadge = meta.overallStatus === 'success'
    ? `<span class="status-pill ok">✓ ${labels.success}</span>`
    : meta.overallStatus === 'error'
      ? `<span class="status-pill err">✗ ${labels.error}</span>`
      : `<span class="status-pill warn">◐ ${labels.partial}</span>`
  return `
<header>
  <h1>${escapeHtml(meta.project)} ${labels.reportTitle}</h1>
  <div class="meta-row">
    <span class="meta-item"><span class="meta-k">${labels.environment}</span> ${escapeHtml(meta.environment)}</span>
    <span class="meta-item"><span class="meta-k">${labels.workspace}</span> ${escapeHtml(meta.workspace)}</span>
    <span class="meta-item"><span class="meta-k">${labels.project}</span> ${escapeHtml(meta.project)}</span>
  </div>
  <div class="meta-row">
    <span class="meta-item"><span class="meta-k">${labels.executedAt}</span> ${formatTimestamp(meta.executedAt)}</span>
    <span class="meta-item"><span class="meta-k">${labels.totalDuration}</span> ${formatDuration(meta.totalDuration)}</span>
    ${statusBadge}
  </div>
</header>
`
}

function htmlFlowDiagram(nodes: ReportNode[], labels: ReportLabels): string {
  if (nodes.length === 0) return ''
  const items = nodes.map(n => {
    const typeColor = TYPE_COLOR[n.type] || '#6e7781'
    const statusColor = STATUS_COLOR[n.status] || '#8b949e'
    const statusIcon = STATUS_ICON[n.status] || '·'
    return `
      <div class="flow-step">
        <div class="flow-card" style="border-color:${typeColor}; background:${typeColor}11">
          <div class="flow-type" style="color:${typeColor}">${n.type.toUpperCase()}</div>
          <div class="flow-label">${escapeHtml(n.label)}</div>
          <div class="flow-status" style="color:${statusColor}">${statusIcon} ${nodeStatusText(n.status, labels)}</div>
        </div>
      </div>`
  }).join('<div class="flow-arrow">→</div>')
  return `<section class="flow-section"><div class="flow-wrap">${items}</div></section>`
}

function kvTable(rows: Array<[string, string]>, labels: ReportLabels): string {
  if (rows.length === 0) return `<div class="empty">${labels.empty}</div>`
  return `
<table class="kv">
  <tbody>
    ${rows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join('')}
  </tbody>
</table>`
}

function formatVariableValue(value: unknown): string {
  if (value === undefined) return '(undefined)'
  if (value === null) return 'null'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
  try { return JSON.stringify(value, null, 2) } catch { return String(value) }
}

function variableKindLabel(kind: ReportVariable['kind']): string {
  if (kind === 'env') return 'ENV'
  if (kind === 'data') return 'DATA'
  return 'INPUT'
}

function hasReportValue(value: unknown): boolean {
  return value !== null && value !== undefined
}

function htmlValueSection(title: string, value: unknown): string {
  return hasReportValue(value) ? `<h3>${escapeHtml(title)}</h3>${jsonViewerBlock(value)}` : ''
}

function htmlOptionalBodySection(title: string, value: unknown, present: boolean, labels: ReportLabels): string {
  return `<h3>${escapeHtml(title)}</h3>${present ? jsonViewerBlock(value) : `<div class="empty">${labels.empty}</div>`}`
}

function htmlScriptLogSection(title: string, logs: ReportScriptConsoleEntry[] | undefined, language: ReportLanguage): string {
  if (!logs || logs.length === 0) return ''
  const locale = language === 'ko' ? 'ko-KR' : 'en-US'
  return `
<h3>${escapeHtml(title)}</h3>
<div class="script-log">
  ${logs.map(log => `
    <div class="script-log-row script-log-${escapeHtml(log.level)}">
      <span class="script-log-time">${escapeHtml(new Date(log.timestamp).toLocaleTimeString(locale, { hour12: false }))}</span>
      <span class="script-log-level">${escapeHtml(log.level)}</span>
      <pre>${escapeHtml(log.message)}</pre>
    </div>
  `).join('')}
</div>`
}

function reportApiAttempts(n: ReportNode): ReportApiAttempt[] {
  if (n.apiAttempts?.length) return n.apiAttempts
  if (!n.apiDetail) return []
  return [{
    ...n.apiDetail,
    index: 1,
    total: 1,
    startedAt: 0,
    status: n.status === 'error' ? 'error' : n.status === 'success' ? 'success' : 'running',
    duration: n.duration,
  }]
}

function htmlNodeSection(
  n: ReportNode,
  index: number,
  labels: ReportLabels,
  language: ReportLanguage,
  include: ReportIncludeOptions,
): string {
  const typeColor = TYPE_COLOR[n.type] || '#6e7781'
  const statusColor = STATUS_COLOR[n.status] || '#8b949e'
  const statusIcon = STATUS_ICON[n.status] || '·'

  const headerBar = `
<div class="node-hd">
  <span class="node-toggle"></span>
  <span class="node-num">${index}</span>
  <span class="node-type-badge" style="background:${typeColor}22; color:${typeColor}; border-color:${typeColor}55">${n.type.toUpperCase()}</span>
  <span class="node-label">${escapeHtml(n.label)}</span>
  <span class="node-status" style="color:${statusColor}">${statusIcon} ${nodeStatusText(n.status, labels)}</span>
  <span class="node-duration">${formatDuration(n.duration)}</span>
</div>`

  let body = ''

  if (include.input) body += htmlValueSection('INPUT', n.input)
  if (include.output) body += htmlValueSection('OUTPUT', n.output)

  const apiAttempts = n.type === 'api' ? reportApiAttempts(n) : []
  if (apiAttempts.length > 0) {
    body += apiAttempts.map(a => {
      const mc = methodColor(a.method)
      const sc = statusCodeColor(a.statusCode)
      const reqHeaderRows = Object.entries(a.headers).map(([k, v]): [string, string] => [k, v])
      const reqBodyJson = tryParseJson(a.body)
      const resBodyJson = tryParseJson(a.responseText)
      const attemptTitle = apiAttempts.length > 1
        ? `<h3>${labels.attempt} #${a.index}/${a.total} ${formatDuration(a.duration)}</h3>`
        : ''

      return `
${attemptTitle}
<div class="api-line">
  <span class="api-method" style="background:${mc}22; color:${mc}; border-color:${mc}55">${escapeHtml(a.method)}</span>
  <span class="api-url">${escapeHtml(a.url)}</span>
  ${a.statusCode !== undefined ? `<span class="api-status" style="color:${sc}; border-color:${sc}55">${a.statusCode} ${escapeHtml(a.statusText || '')}</span>` : ''}
</div>

<h3>${labels.requestHeaders}</h3>
${kvTable(reqHeaderRows, labels)}

${htmlOptionalBodySection(labels.requestBody, reqBodyJson, !!(a.body && a.body.trim()), labels)}

${htmlOptionalBodySection(labels.responseBody, resBodyJson, a.responseText !== undefined, labels)}
`
    }).join('')
  }

  if (include.preRequest) body += htmlScriptLogSection('PRE REQUEST / INPUT CONSOLE', n.scriptLogs?.pre, language)
  if (include.postResponse) body += htmlScriptLogSection('POST RESPONSE CONSOLE', n.scriptLogs?.post, language)

  if (include.preRequest && n.preScript && n.preScript.trim()) {
    body += `<h3>${labels.preScript}</h3><pre class="code-block">${escapeHtml(n.preScript)}</pre>`
  }
  if (include.postResponse && n.postScript && n.postScript.trim()) {
    body += `<h3>${labels.postScript}</h3><pre class="code-block">${escapeHtml(n.postScript)}</pre>`
  }
  if (n.error) {
    body += `<div class="err-box"><strong>${labels.errorLabel}</strong><br>${escapeHtml(n.error)}</div>`
  }

  return `<details class="node-section"><summary class="node-hd-summary">${headerBar}</summary><div class="node-body">${body}</div></details>`
}

function htmlVariablesSection(variables: ReportVariable[] | undefined, labels: ReportLabels): string {
  if (!variables || variables.length === 0) return ''
  const rows = variables.map(variable => `
    <tr>
      <td><span class="var-kind var-kind-${escapeHtml(variable.kind)}">${variableKindLabel(variable.kind)}</span></td>
      <th>${escapeHtml(variable.name)}</th>
      <td><pre>${escapeHtml(formatVariableValue(variable.value))}</pre></td>
    </tr>
  `).join('')

  return `
<details class="node-section variable-section">
  <summary class="node-hd-summary">
    <div class="node-hd">
      <span class="node-toggle"></span>
      <span class="node-type-badge variable-badge">VARS</span>
      <span class="node-label">${labels.usedVariables}</span>
      <span class="node-duration">${formatCount(variables.length, labels)}</span>
    </div>
  </summary>
  <div class="node-body">
    <table class="variable-table">
      <thead>
        <tr><th>${labels.kind}</th><th>${labels.variableName}</th><th>${labels.finalValue}</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</details>`
}

function buildHtml(input: ReportInput): string {
  const language = input.language ?? 'ko'
  const labels = reportLabels(language)
  const include = reportIncludeOptions(input)
  const reportNodes = input.nodes.filter(n => input.selectedModuleIds.has(n.nodeId) && n.type !== 'start' && n.type !== 'end')
  const bodyHtml = reportNodes.map((n, i) => htmlNodeSection(n, i + 1, labels, language, include)).join('')
  const variablesHtml = include.variables ? htmlVariablesSection(input.variables, labels) : ''

  return `<!DOCTYPE html>
<html lang="${language}">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(input.meta.project)} ${labels.reportTitle}</title>
<style>
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Pretendard", "Noto Sans KR", sans-serif;
  background: #f7f7f8;
  color: #1f2328;
  line-height: 1.6;
}
.container { max-width: 1200px; margin: 0 auto; padding: 32px 28px 96px; }
header { background: #fff; border: 1px solid #d1d9e0; border-radius: 12px; padding: 24px 28px; margin-bottom: 24px; }
header h1 { margin: 0 0 12px; font-size: 24px; font-weight: 700; color: #1f2328; }
.meta-row { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 6px; align-items: center; }
.meta-item { font-size: 13px; color: #1f2328; }
.meta-k { color: #6e7781; font-weight: 600; margin-right: 6px; }
.status-pill { padding: 3px 10px; border-radius: 12px; font-size: 12px; font-weight: 700; margin-left: auto; }
.status-pill.ok { background: #dcfce7; color: #166534; }
.status-pill.err { background: #fee2e2; color: #991b1b; }
.status-pill.warn { background: #fef3c7; color: #78350f; }

.flow-section { background: #fff; border: 1px solid #d1d9e0; border-radius: 12px; padding: 20px; margin-bottom: 24px; overflow-x: auto; }
.flow-wrap { display: flex; align-items: stretch; gap: 6px; min-width: max-content; }
.flow-step { display: flex; align-items: center; }
.flow-card { border: 1px solid; border-radius: 8px; padding: 10px 14px; min-width: 110px; text-align: center; }
.flow-type { font-size: 10px; font-weight: 700; letter-spacing: 0.06em; }
.flow-label { font-size: 13px; font-weight: 600; margin: 4px 0; color: #1f2328; }
.flow-status { font-size: 11px; font-weight: 600; }
.flow-arrow { color: #8b949e; align-self: center; font-size: 18px; }

details.node-section { background: #fff; border: 1px solid #d1d9e0; border-radius: 12px; padding: 0; margin-bottom: 20px; overflow: hidden; }
details.node-section > summary { cursor: pointer; list-style: none; }
details.node-section > summary::-webkit-details-marker { display: none; }
details.node-section > summary::marker { display: none; }
details.node-section > summary .node-toggle::before { content: '▶'; color: #6e7781; font-size: 11px; display: inline-block; transition: transform 0.15s ease; width: 12px; }
details[open].node-section > summary .node-toggle::before { content: '▼'; }
details.node-section > summary:hover { background: #f3f4f6; }
details[open].node-section > .node-hd { border-bottom: 1px solid #d1d9e0; }
.node-hd { display: flex; align-items: center; gap: 10px; padding: 14px 20px; background: #f9fafb; }
.node-num { font-weight: 700; color: #6e7781; min-width: 24px; }
.node-type-badge { font-size: 10px; font-weight: 700; padding: 3px 8px; border-radius: 4px; border: 1px solid; letter-spacing: 0.06em; }
.node-label { font-weight: 600; font-size: 14px; flex: 1; color: #1f2328; }
.node-status { font-size: 12px; font-weight: 600; }
.node-duration { font-size: 11px; color: #6e7781; font-family: "JetBrains Mono", monospace; }
.node-body { padding: 16px 20px 20px; }
.node-body h3 { font-size: 13px; color: #6e7781; text-transform: uppercase; letter-spacing: 0.06em; margin: 16px 0 6px; font-weight: 600; }
.node-body h3:first-child { margin-top: 4px; }

.api-line { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; flex-wrap: wrap; }
.api-method { font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 4px; border: 1px solid; font-family: "JetBrains Mono", monospace; }
.api-url { font-family: "JetBrains Mono", monospace; font-size: 12.5px; color: #1f2328; word-break: break-all; flex: 1; min-width: 0; }
.api-status { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 4px; border: 1px solid; font-family: "JetBrains Mono", monospace; }

table.kv { border-collapse: collapse; width: 100%; font-size: 12px; }
table.kv th { text-align: left; background: #f9fafb; color: #6e7781; font-weight: 600; padding: 6px 10px; border: 1px solid #d1d9e0; width: 200px; font-family: "JetBrains Mono", monospace; vertical-align: top; }
table.kv td { padding: 6px 10px; border: 1px solid #d1d9e0; color: #1f2328; font-family: "JetBrains Mono", monospace; word-break: break-all; }

.variable-section { margin-top: 28px; }
.variable-badge { background: #6e778122; color: #6e7781; border-color: #6e778155; }
.variable-table { border-collapse: collapse; width: 100%; font-size: 12px; }
.variable-table th,
.variable-table td { padding: 8px 10px; border: 1px solid #d1d9e0; text-align: left; vertical-align: top; }
.variable-table thead th { background: #f9fafb; color: #6e7781; font-weight: 700; }
.variable-table tbody th { width: 220px; color: #1f2328; font-family: "JetBrains Mono", monospace; font-weight: 700; word-break: break-all; }
.variable-table td:first-child { width: 72px; }
.variable-table pre { margin: 0; max-height: 260px; overflow: auto; white-space: pre-wrap; word-break: break-word; font-family: "JetBrains Mono", monospace; font-size: 12px; line-height: 1.5; color: #1f2328; }
.var-kind { display: inline-flex; align-items: center; justify-content: center; min-width: 48px; height: 22px; padding: 0 8px; border-radius: 4px; font-size: 10px; font-weight: 700; border: 1px solid; }
.var-kind-env { color: #3fb950; background: #3fb9501c; border-color: #3fb95055; }
.var-kind-input { color: #8957e5; background: #8957e51c; border-color: #8957e555; }
.var-kind-data { color: #1f6feb; background: #1f6feb1c; border-color: #1f6feb55; }

.script-log { border: 1px solid #d1d9e0; border-radius: 6px; overflow: hidden; background: #0f1720; }
.script-log-row { display: grid; grid-template-columns: 90px 64px minmax(0, 1fr); gap: 10px; align-items: start; padding: 7px 10px; border-bottom: 1px solid #263241; font-family: "JetBrains Mono", monospace; font-size: 12px; line-height: 1.5; }
.script-log-row:last-child { border-bottom: 0; }
.script-log-time { color: #8b949e; white-space: nowrap; }
.script-log-level { color: #58a6ff; font-weight: 700; text-transform: uppercase; }
.script-log-warn .script-log-level { color: #d29922; }
.script-log-error .script-log-level { color: #f85149; }
.script-log-row pre { margin: 0; color: #c9d1d9; white-space: pre-wrap; word-break: break-word; font-family: inherit; font-size: inherit; line-height: inherit; }

.code-block { background: #fff; border: 1px solid #d1d9e0; border-radius: 6px; padding: 10px 14px; font-family: "JetBrains Mono", monospace; font-size: 12px; line-height: 1.55; color: #1f2328; white-space: pre-wrap; max-height: 400px; overflow: auto; margin: 0; }
.err-box { background: #fee2e2; border-left: 3px solid #f85149; padding: 10px 14px; border-radius: 4px; color: #7f1d1d; font-size: 13px; margin-top: 12px; }
.empty { color: #6e7781; font-style: italic; font-size: 12px; padding: 6px 0; }
${JSON_VIEWER_CSS}
</style>
</head>
<body>
<div class="container">
  ${htmlHeader(input.meta, labels)}
  ${htmlFlowDiagram(reportNodes, labels)}
  ${bodyHtml}
  ${variablesHtml}
</div>
<script>${jsonViewerLabelsScript(language)}</script>
<script>${JSON_VIEWER_JS}</script>
</body>
</html>
`
}

// ── Markdown + Mermaid report ────────────────────────────────

function safeMermaidId(s: string): string {
  return s.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 24) || 'n'
}

function safeMermaidLabel(s: string): string {
  return s.replace(/["\n]/g, ' ').slice(0, 40)
}

function mermaidDiagram(nodes: ReportNode[]): string {
  const lines: string[] = ['flowchart LR']
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]
    const id = safeMermaidId(n.nodeId)
    const label = safeMermaidLabel(`${n.type.toUpperCase()}\n${n.label}`)
    lines.push(`  ${id}["${label}"]`)
    if (i > 0) {
      const prev = safeMermaidId(nodes[i - 1].nodeId)
      lines.push(`  ${prev} --> ${id}`)
    }
  }
  for (const n of nodes) {
    const id = safeMermaidId(n.nodeId)
    const color = STATUS_COLOR[n.status] || '#8b949e'
    lines.push(`  style ${id} fill:${color},color:#fff,stroke:#333`)
  }
  return lines.join('\n')
}

function mdCodeBlock(content: string, lang = ''): string {
  return '```' + lang + '\n' + content + '\n```'
}

function stringifyReportValue(value: unknown): string {
  if (typeof value === 'string') return value
  try { return JSON.stringify(value, null, 2) } catch { return String(value) }
}

function mdValueSection(title: string, value: unknown): string[] {
  if (!hasReportValue(value)) return []
  return [
    '',
    `### ${title}`,
    '',
    mdCodeBlock(stringifyReportValue(value), 'json'),
  ]
}

function mdOptionalBodySection(title: string, value: unknown, present: boolean, labels: ReportLabels): string[] {
  if (!present) return ['', `### ${title}`, '', `_${labels.empty}_`]
  return ['', `### ${title}`, '', mdCodeBlock(stringifyReportValue(value), 'json')]
}

function mdScriptLogSection(title: string, logs: ReportScriptConsoleEntry[] | undefined): string[] {
  if (!logs || logs.length === 0) return []
  const lines = ['', `### ${title}`, '']
  for (const log of logs) {
    lines.push(`- ${log.timestamp} [${log.level}] ${log.message.replace(/\n/g, ' ')}`)
  }
  return lines
}

function mdNodeSection(n: ReportNode, index: number, labels: ReportLabels, include: ReportIncludeOptions): string {
  const lines: string[] = []
  lines.push(`## ${index}. ${n.type.toUpperCase()} · ${n.label}`)
  lines.push('')
  lines.push(`- ${labels.status}: **${nodeStatusText(n.status, labels)}** ${STATUS_ICON[n.status] || ''}`)
  if (n.duration !== undefined) lines.push(`- ${labels.duration}: ${formatDuration(n.duration)}`)

  if (include.input) lines.push(...mdValueSection('INPUT', n.input))
  if (include.output) lines.push(...mdValueSection('OUTPUT', n.output))

  const apiAttempts = n.type === 'api' ? reportApiAttempts(n) : []
  for (const a of apiAttempts) {
    if (apiAttempts.length > 1) {
      lines.push('')
      lines.push(`### ${labels.attempt} #${a.index}/${a.total}`)
      if (a.duration !== undefined) lines.push(`- ${labels.duration}: ${formatDuration(a.duration)}`)
    }
    lines.push(`- ${a.method} \`${a.url}\``)
    if (a.statusCode !== undefined) lines.push(`- ${labels.response}: ${a.statusCode} ${a.statusText ?? ''}`)
    lines.push('')
    lines.push(`### ${apiAttempts.length > 1 ? `${labels.requestHeaders} #${a.index}/${a.total}` : labels.requestHeaders}`)
    lines.push('')
    if (Object.keys(a.headers).length === 0) {
      lines.push(`_${labels.empty}_`)
    } else {
      lines.push(`| ${labels.key} | ${labels.value} |`)
      lines.push('|---|---|')
      for (const [k, v] of Object.entries(a.headers)) lines.push(`| ${k} | ${v} |`)
    }
    lines.push(...mdOptionalBodySection(labels.requestBody, tryParseJson(a.body), !!(a.body && a.body.trim()), labels))
    lines.push(...mdOptionalBodySection(labels.responseBody, tryParseJson(a.responseText), a.responseText !== undefined, labels))
  }

  if (include.preRequest) lines.push(...mdScriptLogSection('PRE REQUEST / INPUT CONSOLE', n.scriptLogs?.pre))
  if (include.postResponse) lines.push(...mdScriptLogSection('POST RESPONSE CONSOLE', n.scriptLogs?.post))

  if (include.preRequest && n.preScript && n.preScript.trim()) {
    lines.push('')
    lines.push(`### ${labels.preScript}`)
    lines.push('')
    lines.push(mdCodeBlock(n.preScript, 'js'))
  }
  if (include.postResponse && n.postScript && n.postScript.trim()) {
    lines.push('')
    lines.push(`### ${labels.postScript}`)
    lines.push('')
    lines.push(mdCodeBlock(n.postScript, 'js'))
  }
  if (n.error) {
    lines.push('')
    lines.push(`### ⚠ ${labels.errorLabel}`)
    lines.push('')
    lines.push('```')
    lines.push(n.error)
    lines.push('```')
  }
  return lines.join('\n')
}

function buildMarkdown(input: ReportInput): string {
  const labels = reportLabels(input.language)
  const include = reportIncludeOptions(input)
  const m = input.meta
  const lines: string[] = []
  lines.push(`# ${m.project} ${labels.reportTitle}`)
  lines.push('')
  lines.push(`- **${labels.environment}**: ${m.environment}`)
  lines.push(`- **${labels.workspace}**: ${m.workspace}`)
  lines.push(`- **${labels.project}**: ${m.project}`)
  lines.push(`- **${labels.executedAt}**: ${formatTimestamp(m.executedAt)}`)
  lines.push(`- **${labels.totalDuration}**: ${formatDuration(m.totalDuration)}`)
  lines.push(`- **${labels.status}**: ${m.overallStatus === 'success' ? `✓ ${labels.success}` : m.overallStatus === 'error' ? `✗ ${labels.error}` : `◐ ${labels.partial}`}`)
  lines.push('')
  const bodyNodes = input.nodes.filter(n => input.selectedModuleIds.has(n.nodeId) && n.type !== 'start' && n.type !== 'end')

  if (bodyNodes.length > 0) {
    lines.push(`## ${labels.executionFlow}`)
    lines.push('')
    lines.push('```mermaid')
    lines.push(mermaidDiagram(bodyNodes))
    lines.push('```')
    lines.push('')
  }

  bodyNodes.forEach((n, i) => {
    lines.push(mdNodeSection(n, i + 1, labels, include))
    lines.push('')
  })

  if (include.variables && input.variables && input.variables.length > 0) {
    lines.push('<details>')
    lines.push(`<summary>${labels.usedVariables}</summary>`)
    lines.push('')
    lines.push(`| ${labels.kind} | ${labels.variableName} | ${labels.finalValue} |`)
    lines.push('|---|---|---|')
    for (const variable of input.variables) {
      const value = formatVariableValue(variable.value).replace(/\|/g, '\\|').replace(/\n/g, '<br>')
      lines.push(`| ${variableKindLabel(variable.kind)} | \`${variable.name.replace(/`/g, '\\`')}\` | ${value} |`)
    }
    lines.push('')
    lines.push('</details>')
    lines.push('')
  }

  return lines.join('\n')
}

export function generateReport(format: 'html' | 'markdown', input: ReportInput): string {
  return format === 'html' ? buildHtml(input) : buildMarkdown(input)
}

export function fillFilenameTemplate(
  template: string,
  vars: { env: string; ws: string; project: string; ts: Date },
): string {
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0')
  const ts =
    `${vars.ts.getFullYear()}${pad(vars.ts.getMonth() + 1)}${pad(vars.ts.getDate())}` +
    `${pad(vars.ts.getHours())}${pad(vars.ts.getMinutes())}${pad(vars.ts.getSeconds())}`
  const safe = (s: string): string => s.replace(/[\\/:*?"<>|]/g, '_').trim()
  return template
    .replace(/\{env\}/g, safe(vars.env))
    .replace(/\{ws\}/g, safe(vars.ws))
    .replace(/\{project\}/g, safe(vars.project))
    .replace(/\{ts\}/g, ts)
}
