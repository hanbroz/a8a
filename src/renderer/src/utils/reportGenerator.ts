import { JSON_VIEWER_CSS, JSON_VIEWER_JS, jsonViewerBlock } from './jsonViewerTemplate'

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

export interface ReportNode {
  nodeId: string
  label: string
  type: 'start' | 'end' | 'data' | 'select' | 'api'
  status: 'success' | 'error' | 'skip' | 'running'
  input: unknown
  output?: unknown
  error?: string
  duration?: number
  apiDetail?: ReportApiDetail
  preScript?: string
  postScript?: string
}

export interface ReportInput {
  meta: ReportMeta
  // Order matches execution order. Includes Start/End for diagram, but body
  // sections are emitted only for nodes in selectedModuleIds.
  nodes: ReportNode[]
  selectedModuleIds: Set<string>
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

function htmlHeader(meta: ReportMeta): string {
  const statusBadge = meta.overallStatus === 'success'
    ? `<span class="status-pill ok">✓ 성공</span>`
    : meta.overallStatus === 'error'
      ? `<span class="status-pill err">✗ 실패</span>`
      : `<span class="status-pill warn">◐ 일부 성공</span>`
  return `
<header>
  <h1>${escapeHtml(meta.project)} 실행 리포트</h1>
  <div class="meta-row">
    <span class="meta-item"><span class="meta-k">환경</span> ${escapeHtml(meta.environment)}</span>
    <span class="meta-item"><span class="meta-k">워크스페이스</span> ${escapeHtml(meta.workspace)}</span>
    <span class="meta-item"><span class="meta-k">프로젝트</span> ${escapeHtml(meta.project)}</span>
  </div>
  <div class="meta-row">
    <span class="meta-item"><span class="meta-k">실행 시각</span> ${formatTimestamp(meta.executedAt)}</span>
    <span class="meta-item"><span class="meta-k">총 소요</span> ${formatDuration(meta.totalDuration)}</span>
    ${statusBadge}
  </div>
</header>
`
}

function htmlFlowDiagram(nodes: ReportNode[]): string {
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
          <div class="flow-status" style="color:${statusColor}">${statusIcon} ${n.status}</div>
        </div>
      </div>`
  }).join('<div class="flow-arrow">→</div>')
  return `<section class="flow-section"><div class="flow-wrap">${items}</div></section>`
}

function kvTable(rows: Array<[string, string]>): string {
  if (rows.length === 0) return '<div class="empty">(없음)</div>'
  return `
<table class="kv">
  <tbody>
    ${rows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join('')}
  </tbody>
</table>`
}

function htmlNodeSection(n: ReportNode, index: number): string {
  const typeColor = TYPE_COLOR[n.type] || '#6e7781'
  const statusColor = STATUS_COLOR[n.status] || '#8b949e'
  const statusIcon = STATUS_ICON[n.status] || '·'

  const headerBar = `
<div class="node-hd">
  <span class="node-toggle"></span>
  <span class="node-num">${index}</span>
  <span class="node-type-badge" style="background:${typeColor}22; color:${typeColor}; border-color:${typeColor}55">${n.type.toUpperCase()}</span>
  <span class="node-label">${escapeHtml(n.label)}</span>
  <span class="node-status" style="color:${statusColor}">${statusIcon} ${n.status}</span>
  <span class="node-duration">${formatDuration(n.duration)}</span>
</div>`

  let body = ''

  if (n.type === 'api' && n.apiDetail) {
    const a = n.apiDetail
    const mc = methodColor(a.method)
    const sc = statusCodeColor(a.statusCode)
    const reqHeaderRows = Object.entries(a.headers).map(([k, v]): [string, string] => [k, v])
    const reqBodyJson = tryParseJson(a.body)
    const resBodyJson = tryParseJson(a.responseText)

    body += `
<div class="api-line">
  <span class="api-method" style="background:${mc}22; color:${mc}; border-color:${mc}55">${escapeHtml(a.method)}</span>
  <span class="api-url">${escapeHtml(a.url)}</span>
  ${a.statusCode ? `<span class="api-status" style="color:${sc}; border-color:${sc}55">${a.statusCode} ${escapeHtml(a.statusText || '')}</span>` : ''}
</div>

<h3>요청 헤더</h3>
${kvTable(reqHeaderRows)}

${a.body && a.body.trim() ? `<h3>요청 바디</h3>${jsonViewerBlock(reqBodyJson)}` : ''}

${a.responseText !== undefined ? `<h3>응답 바디</h3>${jsonViewerBlock(resBodyJson)}` : ''}
`
  } else if (n.type === 'data' || n.type === 'select') {
    if (n.input !== null && n.input !== undefined) {
      body += `<h3>INPUT</h3>${jsonViewerBlock(n.input)}`
    }
    if (n.output !== null && n.output !== undefined) {
      body += `<h3>OUTPUT</h3>${jsonViewerBlock(n.output)}`
    }
  }

  if (n.preScript && n.preScript.trim()) {
    body += `<h3>Pre Request 스크립트</h3><pre class="code-block">${escapeHtml(n.preScript)}</pre>`
  }
  if (n.postScript && n.postScript.trim()) {
    body += `<h3>Post Response 스크립트</h3><pre class="code-block">${escapeHtml(n.postScript)}</pre>`
  }
  if (n.error) {
    body += `<div class="err-box"><strong>오류</strong><br>${escapeHtml(n.error)}</div>`
  }

  return `<details class="node-section"><summary class="node-hd-summary">${headerBar}</summary><div class="node-body">${body}</div></details>`
}

function buildHtml(input: ReportInput): string {
  const reportNodes = input.nodes.filter(n => input.selectedModuleIds.has(n.nodeId) && n.type !== 'start' && n.type !== 'end')
  const bodyHtml = reportNodes.map((n, i) => htmlNodeSection(n, i + 1)).join('')

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(input.meta.project)} 실행 리포트</title>
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

.code-block { background: #fff; border: 1px solid #d1d9e0; border-radius: 6px; padding: 10px 14px; font-family: "JetBrains Mono", monospace; font-size: 12px; line-height: 1.55; color: #1f2328; white-space: pre-wrap; max-height: 400px; overflow: auto; margin: 0; }
.err-box { background: #fee2e2; border-left: 3px solid #f85149; padding: 10px 14px; border-radius: 4px; color: #7f1d1d; font-size: 13px; margin-top: 12px; }
.empty { color: #6e7781; font-style: italic; font-size: 12px; padding: 6px 0; }
${JSON_VIEWER_CSS}
</style>
</head>
<body>
<div class="container">
  ${htmlHeader(input.meta)}
  ${htmlFlowDiagram(reportNodes)}
  ${bodyHtml}
</div>
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

function mdNodeSection(n: ReportNode, index: number): string {
  const lines: string[] = []
  lines.push(`## ${index}. ${n.type.toUpperCase()} · ${n.label}`)
  lines.push('')
  lines.push(`- 상태: **${n.status}** ${STATUS_ICON[n.status] || ''}`)
  if (n.duration !== undefined) lines.push(`- 소요: ${formatDuration(n.duration)}`)

  if (n.type === 'api' && n.apiDetail) {
    const a = n.apiDetail
    lines.push(`- ${a.method} \`${a.url}\``)
    if (a.statusCode) lines.push(`- 응답: ${a.statusCode} ${a.statusText ?? ''}`)
    lines.push('')
    lines.push('### 요청 헤더')
    lines.push('')
    if (Object.keys(a.headers).length === 0) {
      lines.push('_(없음)_')
    } else {
      lines.push('| 키 | 값 |')
      lines.push('|---|---|')
      for (const [k, v] of Object.entries(a.headers)) lines.push(`| ${k} | ${v} |`)
    }
    if (a.body && a.body.trim()) {
      lines.push('')
      lines.push('### 요청 바디')
      lines.push('')
      const parsed = tryParseJson(a.body)
      lines.push(mdCodeBlock(typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2), 'json'))
    }
    if (a.responseText !== undefined) {
      lines.push('')
      lines.push('### 응답 바디')
      lines.push('')
      const parsed = tryParseJson(a.responseText)
      lines.push(mdCodeBlock(typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2), 'json'))
    }
  } else if (n.type === 'data' || n.type === 'select') {
    if (n.input !== null && n.input !== undefined) {
      lines.push('')
      lines.push('### INPUT')
      lines.push('')
      lines.push(mdCodeBlock(JSON.stringify(n.input, null, 2), 'json'))
    }
    if (n.output !== null && n.output !== undefined) {
      lines.push('')
      lines.push('### OUTPUT')
      lines.push('')
      lines.push(mdCodeBlock(JSON.stringify(n.output, null, 2), 'json'))
    }
  }

  if (n.preScript && n.preScript.trim()) {
    lines.push('')
    lines.push('### Pre Request 스크립트')
    lines.push('')
    lines.push(mdCodeBlock(n.preScript, 'js'))
  }
  if (n.postScript && n.postScript.trim()) {
    lines.push('')
    lines.push('### Post Response 스크립트')
    lines.push('')
    lines.push(mdCodeBlock(n.postScript, 'js'))
  }
  if (n.error) {
    lines.push('')
    lines.push('### ⚠ 오류')
    lines.push('')
    lines.push('```')
    lines.push(n.error)
    lines.push('```')
  }
  return lines.join('\n')
}

function buildMarkdown(input: ReportInput): string {
  const m = input.meta
  const lines: string[] = []
  lines.push(`# ${m.project} 실행 리포트`)
  lines.push('')
  lines.push(`- **환경**: ${m.environment}`)
  lines.push(`- **워크스페이스**: ${m.workspace}`)
  lines.push(`- **프로젝트**: ${m.project}`)
  lines.push(`- **실행 시각**: ${formatTimestamp(m.executedAt)}`)
  lines.push(`- **총 소요**: ${formatDuration(m.totalDuration)}`)
  lines.push(`- **상태**: ${m.overallStatus === 'success' ? '✓ 성공' : m.overallStatus === 'error' ? '✗ 실패' : '◐ 일부 성공'}`)
  lines.push('')
  const bodyNodes = input.nodes.filter(n => input.selectedModuleIds.has(n.nodeId) && n.type !== 'start' && n.type !== 'end')

  if (bodyNodes.length > 0) {
    lines.push('## 실행 흐름')
    lines.push('')
    lines.push('```mermaid')
    lines.push(mermaidDiagram(bodyNodes))
    lines.push('```')
    lines.push('')
  }

  bodyNodes.forEach((n, i) => {
    lines.push(mdNodeSection(n, i + 1))
    lines.push('')
  })

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
