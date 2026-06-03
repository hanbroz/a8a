import { useState, useRef, useCallback, useEffect, useMemo, lazy, Suspense } from 'react'
import { IcoMaximize, IcoPlus, IcoRestore, IcoTrash, IcoX } from '../Icon'
import JsonMonacoEditor from './JsonMonacoEditor'
import JsonInspectorButton from './JsonInspector'
import ScriptHelpButton from './ScriptHelpButton'
import { useModalMaximize } from './useModalMaximize'
import { randomId } from '../../utils/id'
import { applyInputMappings, getInputPathSuggestions, parseTemplate, resolveInputExpression, resolveTemplate } from '../../utils/interpolate'
import { API_AUTH_TYPES, DEFAULT_API_AUTH, applyApiAuth, getApiAuthTemplateValues, normalizeApiAuth } from '../../utils/apiAuth'
import { isScriptRuntimeError, runPostResponse, runPreRequest } from '../../utils/scriptRuntime'
import { useMonacoTheme } from '../../utils/useMonacoTheme'
import { DEFAULT_POST_RESPONSE_SCRIPT, DEFAULT_PRE_REQUEST_SCRIPT } from '../../utils/scriptTemplates'
import type { Token } from '../../utils/interpolate'
import type { ScriptConsoleEntry } from '../../utils/scriptRuntime'
import type { BeforeMount, Monaco } from '@monaco-editor/react'

// Monaco is loaded only when this modal is rendered. The side-effect import
// (`monacoSetup`) wires up bundled workers and must complete before Editor
// mounts. `await` inside lazy() keeps the loading order stable.
export const MonacoEditor = lazy(async () => {
  await import('../../utils/monacoSetup')
  return import('@monaco-editor/react')
})

export function MonacoFallback(): JSX.Element {
  return <div className="dm-monaco-loading">에디터 로드 중...</div>
}

let apiScriptAssistantRegistered = false

function getScriptPhaseFromUri(uri: string): 'pre' | 'post' | null {
  if (uri.includes('/pre-request.')) return 'pre'
  if (uri.includes('/post-response.')) return 'post'
  return null
}

function registerApiScriptAssistant(monaco: Monaco): void {
  if (apiScriptAssistantRegistered) return
  apiScriptAssistantRegistered = true

  monaco.languages.registerCompletionItemProvider('javascript', {
    provideCompletionItems(model, position) {
      const phase = getScriptPhaseFromUri(model.uri.toString())
      if (!phase) return { suggestions: [] }

      const word = model.getWordUntilPosition(position)
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      }
      const fn = monaco.languages.CompletionItemKind.Function
      const variable = monaco.languages.CompletionItemKind.Variable
      const snippet = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
      const suggestions = [
        {
          label: 'getInput',
          kind: fn,
          detail: 'A8A Runtime API',
          documentation: '현재 모듈로 전달된 입력 값을 반환합니다.',
          insertText: 'getInput()',
          range,
        },
        {
          label: 'setEnv',
          kind: fn,
          detail: 'A8A Runtime API',
          documentation: '환경변수를 현재 실행 컨텍스트에 설정합니다. 캔버스 실행에서는 워크스페이스 BASE 환경에도 저장됩니다.',
          insertText: "setEnv('${1:name}', ${2:value})",
          insertTextRules: snippet,
          range,
        },
        {
          label: 'env',
          kind: variable,
          detail: 'A8A Runtime API',
          documentation: '현재 적용된 환경변수 객체입니다.',
          insertText: 'env',
          range,
        },
        {
          label: 'console.log',
          kind: fn,
          detail: 'A8A Console',
          documentation: '콘솔 탭에 로그를 출력합니다.',
          insertText: 'console.log(${1:value})',
          insertTextRules: snippet,
          range,
        },
        {
          label: 'console.warn',
          kind: fn,
          detail: 'A8A Console',
          documentation: '콘솔 탭에 경고 로그를 출력합니다.',
          insertText: 'console.warn(${1:value})',
          insertTextRules: snippet,
          range,
        },
        {
          label: 'console.error',
          kind: fn,
          detail: 'A8A Console',
          documentation: '콘솔 탭에 오류 로그를 출력합니다.',
          insertText: 'console.error(${1:value})',
          insertTextRules: snippet,
          range,
        },
      ]

      if (phase === 'pre') {
        suggestions.push({
          label: 'setInput',
          kind: fn,
          detail: 'A8A Pre Request API',
          documentation: 'API 호출 템플릿에서 사용할 INPUT 변수를 설정합니다.',
          insertText: "setInput('${1:name}', ${2:value})",
          insertTextRules: snippet,
          range,
        })
      } else {
        suggestions.push(
          {
            label: 'getOutput',
            kind: fn,
            detail: 'A8A Post Response API',
            documentation: 'API 응답 값을 반환합니다.',
            insertText: 'getOutput()',
            range,
          },
          {
            label: 'setOutput',
            kind: fn,
            detail: 'A8A Post Response API',
            documentation: '현재 API 모듈의 OUTPUT을 지정한 값으로 교체합니다.',
            insertText: 'setOutput(${1:value})',
            insertTextRules: snippet,
            range,
          },
          {
            label: 'Output',
            kind: variable,
            detail: 'A8A Post Response API',
            documentation: 'OUTPUT 객체를 구성합니다. add(name, value)로 값을 추가한 뒤 setOutput(output)으로 적용합니다.',
            insertText: 'new Output()',
            range,
          },
        )
      }

      return { suggestions }
    },
  })
}

export const beforeApiScriptEditorMount: BeforeMount = (monaco) => {
  registerApiScriptAssistant(monaco)
}

interface Props {
  node: ApiNode
  isNew?: boolean
  initialInput?: string
  initialOutput?: string
  initialPreConsoleLogs?: ScriptConsoleEntry[]
  initialPostConsoleLogs?: ScriptConsoleEntry[]
  envVars?: Record<string, string>
  dataVars?: Record<string, unknown>
  onRun?: () => string | Promise<string>
  onSave: (nodeId: string, label: string, config: string) => Promise<void>
  onDelete?: () => Promise<void>
  onClose: () => void
}

type ResizeDir = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'
type SettingsTab = 'auth' | 'headers' | 'params' | 'body'
type ScriptPaneTab = 'script' | 'console'
type UsedVariable = { kind: 'env' | 'input' | 'data'; name: string; resolved: string | null; mappedPath?: string }
type ResolvedApiRequest = {
  method: ApiConfig['method']
  url: string
  headers: Record<string, string>
  body?: string
}
type TestErrorDetail = {
  error: string
  request: ResolvedApiRequest
}

const MIN_W = 720
const MIN_H = 420
const RESIZE_DIRS: ResizeDir[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

export const MONACO_OPTIONS = {
  minimap: { enabled: false },
  fontSize: 12,
  fontFamily: 'JetBrains Mono, Cascadia Code, Consolas, monospace',
  automaticLayout: true,
  scrollBeyondLastLine: false,
  lineNumbers: 'on' as const,
  wordWrap: 'on' as const,
  tabSize: 2,
  insertSpaces: true,
  folding: true,
  renderLineHighlight: 'line' as const,
  smoothScrolling: true,
  cursorBlinking: 'smooth' as const,
  quickSuggestions: { other: true, comments: false, strings: false },
  suggest: { showSnippets: true },
  padding: { top: 8, bottom: 8 },
  scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
}

function parseConfig(raw: string): ApiConfig {
  try {
    const parsed = JSON.parse(raw)
    const inputMappings = parsed.inputMappings && typeof parsed.inputMappings === 'object' && !Array.isArray(parsed.inputMappings)
      ? Object.fromEntries(
          Object.entries(parsed.inputMappings as Record<string, unknown>)
            .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
        )
      : {}
    return {
      method: (['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(parsed.method)
        ? parsed.method
        : 'GET') as ApiConfig['method'],
      url: typeof parsed.url === 'string' ? parsed.url : '',
      headers: Array.isArray(parsed.headers) ? parsed.headers : [],
      params: Array.isArray(parsed.params) ? parsed.params : [],
      body: typeof parsed.body === 'string' ? parsed.body : '',
      bodyType: (['none', 'json', 'raw'].includes(parsed.bodyType)
        ? parsed.bodyType
        : 'json') as ApiConfig['bodyType'],
      auth: normalizeApiAuth(parsed.auth),
      preScript: typeof parsed.preScript === 'string' ? parsed.preScript : '',
      postScript: typeof parsed.postScript === 'string' ? parsed.postScript : '',
      inputMappings,
    }
  } catch {
    return { method: 'GET', url: '', headers: [], params: [], body: '', bodyType: 'json', auth: DEFAULT_API_AUTH, preScript: '', postScript: '', inputMappings: {} }
  }
}

function formatJson(raw: string): { value: string; error: boolean } {
  const trimmed = raw.trim()
  if (!trimmed) return { value: '', error: false }
  try {
    return { value: JSON.stringify(JSON.parse(trimmed), null, 2), error: false }
  } catch {
    return { value: raw, error: true }
  }
}

function formatTooltipValue(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return value
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    return value
  }
}

function getUsedVariableTooltipText(value: string, mappedPath?: string): string {
  const formattedValue = formatTooltipValue(value)
  if (!mappedPath) return formattedValue
  return `매핑 경로: ${mappedPath}\n\n적용 값:\n${formattedValue}`
}

function loadExpandedIds(storageKey: string): Set<string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? '[]') as unknown
    if (!Array.isArray(parsed)) return new Set(['$'])
    return new Set(['$', ...parsed.filter((item): item is string => typeof item === 'string')])
  } catch {
    return new Set(['$'])
  }
}

function hasBody(method: string): boolean {
  return ['POST', 'PUT', 'PATCH'].includes(method)
}

function hasVars(text: string): boolean {
  return text.includes('{{') || text.includes('[[') || text.includes('<<')
}

function parseInputValue(raw: string): unknown {
  try {
    return raw.trim() ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function withDataVarsForScript(input: unknown, dataVars: Record<string, unknown>): unknown {
  if (Object.keys(dataVars).length === 0) return input
  if (Array.isArray(input)) return Object.assign([...input], dataVars)
  if (input && typeof input === 'object') return { ...(input as Record<string, unknown>), ...dataVars }
  return { value: input, ...dataVars }
}

function parseResponseValue(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

function stringifyRuntimeValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined) return 'undefined'
  return JSON.stringify(value, null, 2)
}

// ?? Autocomplete helpers ???????????????????????????

type JsonViewMode = 'tree' | 'raw'
type JsonParseState =
  | { status: 'empty'; value: null }
  | { status: 'valid'; value: unknown }
  | { status: 'invalid'; value: null }

type JsonTreeNode = {
  id: string
  key: string
  value: unknown
  depth: number
  type: string
  parts: Array<string | number>
  hasChildren: boolean
}

function parseJsonForViewer(raw: string): JsonParseState {
  const trimmed = raw.trim()
  if (!trimmed) return { status: 'empty', value: null }
  try {
    return { status: 'valid', value: JSON.parse(trimmed) as unknown }
  } catch {
    return { status: 'invalid', value: null }
  }
}

function canShowJsonTree(raw?: string | null): boolean {
  return typeof raw === 'string' && parseJsonForViewer(raw).status === 'valid'
}

function jsonViewerType(value: unknown): string {
  if (Array.isArray(value)) return 'array'
  if (value === null) return 'null'
  return typeof value
}

function jsonViewerHasChildren(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0
  return typeof value === 'object' && value !== null && Object.keys(value as Record<string, unknown>).length > 0
}

function jsonViewerPreview(value: unknown): string {
  if (Array.isArray(value)) return `[${value.length}]`
  if (value && typeof value === 'object') return `{${Object.keys(value as Record<string, unknown>).length}}`
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === null) return 'null'
  return String(value)
}

function jsonViewerChildPath(parentPath: string, key: string | number): string {
  if (typeof key === 'number') return `${parentPath}[${key}]`
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${parentPath}.${key}` : `${parentPath}[${JSON.stringify(key)}]`
}

function flattenJsonViewer(value: unknown, id = '$', key = '$', depth = 0, parts: Array<string | number> = []): JsonTreeNode[] {
  const current: JsonTreeNode = {
    id,
    key,
    value,
    depth,
    type: jsonViewerType(value),
    parts,
    hasChildren: jsonViewerHasChildren(value),
  }

  if (Array.isArray(value)) {
    return [
      current,
      ...value.flatMap((item, index) =>
        flattenJsonViewer(item, jsonViewerChildPath(id, index), `[${index}]`, depth + 1, [...parts, index]),
      ),
    ]
  }

  if (value && typeof value === 'object') {
    return [
      current,
      ...Object.entries(value as Record<string, unknown>).flatMap(([childKey, childValue]) =>
        flattenJsonViewer(childValue, jsonViewerChildPath(id, childKey), childKey, depth + 1, [...parts, childKey]),
      ),
    ]
  }

  return [current]
}

function getVisibleJsonViewerNodes(nodes: JsonTreeNode[], expandedIds: Set<string>): JsonTreeNode[] {
  return nodes.filter(node => {
    if (node.depth === 0) return true
    let path = '$'
    if (!expandedIds.has(path)) return false
    for (const part of node.parts.slice(0, -1)) {
      path = jsonViewerChildPath(path, part)
      if (!expandedIds.has(path)) return false
    }
    return true
  })
}

function JsonTreeViewer({ data, emptyText }: { data: unknown; emptyText: string }): JSX.Element {
  const nodes = useMemo(() => flattenJsonViewer(data), [data])
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set(['$']))
  const visibleNodes = useMemo(() => getVisibleJsonViewerNodes(nodes, expandedIds), [nodes, expandedIds])

  useEffect(() => {
    setExpandedIds(new Set(['$']))
  }, [data])

  const toggleExpanded = (nodeId: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(nodeId)) next.delete(nodeId)
      else next.add(nodeId)
      return next
    })
  }

  if (nodes.length === 0) return <div className="api-json-view-empty">{emptyText}</div>

  return (
    <div className="api-json-tree-viewer">
      {visibleNodes.map(node => {
        const expanded = expandedIds.has(node.id)
        return (
          <button
            key={node.id}
            type="button"
            className={`api-json-view-node${node.hasChildren ? ' api-json-view-node-parent' : ''}`}
            style={{ paddingLeft: 10 + node.depth * 14 }}
            onClick={() => { if (node.hasChildren) toggleExpanded(node.id) }}
          >
            <span className={`api-json-view-expander${node.hasChildren ? ' api-json-view-expander-visible' : ''}`}>
              {node.hasChildren ? (expanded ? '-' : '+') : ''}
            </span>
            <span className="api-json-view-key">{node.key}</span>
            <span className="api-json-view-type">{node.type}</span>
            <span className="api-json-view-preview">{jsonViewerPreview(node.value)}</span>
          </button>
        )
      })}
    </div>
  )
}

function expandedIdsForJsonPath(
  nodes: JsonTreeNode[],
  selectedPath?: string,
  baseExpandedIds: Set<string> = new Set(['$']),
): Set<string> {
  const expanded = new Set(baseExpandedIds)
  expanded.add('$')
  const selected = selectedPath ? nodes.find(node => node.id === selectedPath) : null
  if (!selected) return expanded
  let path = '$'
  selected.parts.slice(0, -1).forEach(part => {
    path = jsonViewerChildPath(path, part)
    expanded.add(path)
  })
  return expanded
}

function JsonPathPicker({
  data,
  variableName,
  initialPath,
  expandedIds,
  onExpandedIdsChange,
  onConfirm,
  onClose,
}: {
  data: Record<string, unknown>
  variableName: string
  initialPath?: string
  expandedIds: Set<string>
  onExpandedIdsChange: (ids: Set<string>) => void
  onConfirm: (path: string) => void
  onClose: () => void
}): JSX.Element {
  const nodes = useMemo(() => flattenJsonViewer(data), [data])
  const [selectedPath, setSelectedPath] = useState<string>(initialPath ?? '')
  const visibleNodes = useMemo(() => getVisibleJsonViewerNodes(nodes, expandedIds), [nodes, expandedIds])
  const selectedValue = selectedPath ? resolveInputExpression(data, selectedPath) : undefined

  useEffect(() => {
    setSelectedPath(initialPath ?? '')
  }, [initialPath])

  const toggleExpanded = (nodeId: string) => {
    const next = new Set(expandedIds)
    if (next.has(nodeId)) next.delete(nodeId)
    else next.add(nodeId)
    next.add('$')
    onExpandedIdsChange(next)
  }

  const selectedPreview = selectedPath
    ? (() => {
        try { return JSON.stringify(selectedValue, null, 2) } catch { return String(selectedValue) }
      })()
    : ''

  return (
    <div className="api-input-picker-overlay" onClick={onClose}>
      <div className="api-input-picker-dialog" onClick={e => e.stopPropagation()}>
        <div className="api-input-picker-hd">
          <div>
            <div className="api-input-picker-title">INPUT 변수 값 선택</div>
            <div className="api-input-picker-subtitle">
              <code>[[{variableName}]]</code> 변수에 매핑할 JSON 노드를 선택하세요.
            </div>
          </div>
          <button className="btn ghost icon" onClick={onClose} title="닫기">
            <IcoX size={13} />
          </button>
        </div>
        <div className="api-input-picker-body">
          <div className="api-input-picker-tree">
            {visibleNodes.map(node => {
              const selected = selectedPath === node.id
              const expanded = expandedIds.has(node.id)
              return (
                <button
                  key={node.id}
                  type="button"
                  className={`api-json-view-node api-input-picker-node${node.hasChildren ? ' api-json-view-node-parent' : ''}${selected ? ' api-input-picker-node-selected' : ''}`}
                  style={{ paddingLeft: 10 + node.depth * 14 }}
                  onClick={() => setSelectedPath(node.id)}
                >
                  <span
                    className={`api-json-view-expander${node.hasChildren ? ' api-json-view-expander-visible' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (node.hasChildren) toggleExpanded(node.id)
                    }}
                  >
                    {node.hasChildren ? (expanded ? '-' : '+') : ''}
                  </span>
                  <span className="api-json-view-key">{node.key}</span>
                  <span className="api-json-view-type">{node.type}</span>
                  <span className="api-json-view-preview">{jsonViewerPreview(node.value)}</span>
                </button>
              )
            })}
          </div>
          <div className="api-input-picker-preview">
            <div className="api-input-picker-preview-label">선택 경로</div>
            <code>{selectedPath || '미선택'}</code>
            <div className="api-input-picker-preview-label">적용 값</div>
            <pre>{selectedPreview || '선택한 값이 없습니다.'}</pre>
          </div>
        </div>
        <div className="api-input-picker-ft">
          <button className="btn ghost" onClick={onClose}>취소</button>
          <button
            className="btn primary"
            onClick={() => selectedPath && onConfirm(selectedPath)}
            disabled={!selectedPath}
          >
            선택 적용
          </button>
        </div>
      </div>
    </div>
  )
}

function detectTrigger(
  value: string,
  caretPos: number,
): { type: 'env' | 'input'; query: string; start: number } | null {
  const before = value.slice(0, caretPos)
  const envOpen = before.lastIndexOf('{{')
  const envClose = before.lastIndexOf('}}')
  if (envOpen > envClose) return { type: 'env', query: before.slice(envOpen + 2), start: envOpen }
  const inputOpen = before.lastIndexOf('[[')
  const inputClose = before.lastIndexOf(']]')
  if (inputOpen > inputClose) return { type: 'input', query: before.slice(inputOpen + 2), start: inputOpen }
  return null
}

function insertCompletion(
  value: string,
  caretPos: number,
  trigger: { type: 'env' | 'input'; query: string; start: number },
  suggestion: string,
): { value: string; newCaret: number } {
  const [open, close] = trigger.type === 'env' ? ['{{', '}}'] : ['[[', ']]']
  const inserted = open + suggestion + close
  return {
    value: value.slice(0, trigger.start) + inserted + value.slice(caretPos),
    newCaret: trigger.start + inserted.length,
  }
}

function AutocompleteField({
  value, onChange, envVarNames, inputKeys, className, placeholder, multiline = false, style, ...rest
}: {
  value: string
  onChange: (v: string) => void
  envVarNames: string[]
  inputKeys: string[]
  className?: string
  placeholder?: string
  multiline?: boolean
  style?: React.CSSProperties
  [key: string]: unknown
}): JSX.Element {
  const [caret, setCaret] = useState(0)
  const [activeIdx, setActiveIdx] = useState(0)
  const fieldRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null)

  const trigger = useMemo(() => detectTrigger(value, caret), [value, caret])
  const suggestions = useMemo(() => {
    if (!trigger) return []
    const pool = trigger.type === 'env' ? envVarNames : inputKeys
    const q = trigger.query.toLowerCase()
    return q ? pool.filter(n => n.toLowerCase().includes(q)) : pool
  }, [trigger, envVarNames, inputKeys])

  const open = trigger !== null && suggestions.length > 0

  useEffect(() => { setActiveIdx(0) }, [open, trigger?.query])

  const select = (suggestion: string) => {
    if (!trigger) return
    const { value: nv, newCaret } = insertCompletion(value, caret, trigger, suggestion)
    onChange(nv)
    requestAnimationFrame(() => {
      fieldRef.current?.focus()
      fieldRef.current?.setSelectionRange(newCaret, newCaret)
      setCaret(newCaret)
    })
  }

  const updateCaret = (el: HTMLInputElement | HTMLTextAreaElement) =>
    setCaret(el.selectionStart ?? 0)

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (!open || suggestions.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, suggestions.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter' || e.key === 'Tab') {
      if (suggestions[activeIdx]) { e.preventDefault(); select(suggestions[activeIdx]) }
    } else if (e.key === 'Escape') { setCaret(0) }
  }

  const Tag = multiline ? 'textarea' : 'input'

  return (
    <div className="ac-wrap" style={multiline ? { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, position: 'relative' } : { position: 'relative' }}>
      <Tag
        ref={fieldRef as React.Ref<HTMLTextAreaElement & HTMLInputElement>}
        className={className}
        placeholder={placeholder}
        value={value}
        style={style}
        onChange={e => { onChange(e.target.value); updateCaret(e.target) }}
        onKeyDown={handleKeyDown}
        onSelect={e => updateCaret(e.target as HTMLInputElement)}
        onClick={e => updateCaret(e.target as HTMLInputElement)}
        {...(rest as object)}
      />
      {open && (
        <div className="ac-dropdown">
          {suggestions.slice(0, 10).map((s, i) => (
            <button
              key={s}
              className={`ac-option${i === activeIdx ? ' ac-option-active' : ''}`}
              title={s}
              onMouseDown={e => { e.preventDefault(); select(s) }}
              onMouseEnter={() => setActiveIdx(i)}
            >
              <span className={`ac-option-badge${trigger?.type === 'input' ? ' ac-option-badge-input' : ''}`}>
                {trigger?.type === 'env' ? '{{}}' : '[[]]'}
              </span>
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ?? Icons ?????????????????????????????????????????

function ApiIcon({ size = 14 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  )
}

function RunIcon(): JSX.Element {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
      <polygon points="2,1 9,5 2,9" />
    </svg>
  )
}

function FormatIcon(): JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 7 4 4 20 4 20 7" />
      <line x1="9" y1="20" x2="15" y2="20" />
      <line x1="12" y1="4" x2="12" y2="20" />
    </svg>
  )
}

function SendIcon(): JSX.Element {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  )
}

export function ScriptConsoleView({
  logs,
  emptyText,
}: {
  logs: ScriptConsoleEntry[]
  emptyText: string
}): JSX.Element {
  if (logs.length === 0) {
    return <div className="api-script-console-empty">{emptyText}</div>
  }

  return (
    <div className="api-script-console-list">
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
  )
}

// 템플릿 변수 표시

function TokenDisplay({
  tokens,
  onHover,
}: {
  tokens: Token[]
  onHover: (text: string | null, rect?: DOMRect) => void
}): JSX.Element {
  return (
    <span className="api-url-preview-text">
      {tokens.map((tok, i) => {
        if (tok.type === 'text') return <span key={i}>{tok.text}</span>
        if (tok.type === 'env') return (
          <span
            key={i}
            className={`api-var-token${tok.resolved !== null ? ' api-var-ok' : ' api-var-err'}`}
            onMouseEnter={e => onHover(tok.resolved !== null ? `= ${tok.resolved}` : '환경변수 없음', e.currentTarget.getBoundingClientRect())}
            onMouseLeave={() => onHover(null)}
          >{`{{${tok.name}}}`}</span>
        )
        if (tok.type === 'data') return (
          <span
            key={i}
            className={`api-var-token api-data-token${tok.resolved !== null ? ' api-var-ok' : ' api-var-err'}`}
            onMouseEnter={e => onHover(tok.resolved !== null ? `= ${tok.resolved}` : 'DATA 값 없음', e.currentTarget.getBoundingClientRect())}
            onMouseLeave={() => onHover(null)}
          >{`<<${tok.key}>>`}</span>
        )
        return (
          <span
            key={i}
            className={`api-var-token api-input-token${tok.resolved !== null ? ' api-var-ok' : ' api-var-err'}`}
            onMouseEnter={e => onHover(tok.resolved !== null ? `= ${tok.resolved}` : 'INPUT 키 없음', e.currentTarget.getBoundingClientRect())}
            onMouseLeave={() => onHover(null)}
          >{`[[${tok.key}]]`}</span>
        )
      })}
    </span>
  )
}

// ?? KV editor row ??????????????????????????????????

function KvRow({
  item, onChange, onRemove, envVars, inputData, dataVars, onHover,
}: {
  item: ApiKvItem
  onChange: (id: string, field: 'key' | 'value' | 'enabled', val: string | boolean) => void
  onRemove: (id: string) => void
  envVars: Record<string, string>
  inputData: Record<string, unknown>
  dataVars: Record<string, unknown>
  onHover: (text: string | null, rect?: DOMRect) => void
}): JSX.Element {
  const envVarNames = useMemo(() => Object.keys(envVars), [envVars])
  const inputKeys = useMemo(() => getInputPathSuggestions(inputData), [inputData])
  const showPreview = hasVars(item.value)
  const previewTokens = useMemo(
    () => showPreview ? parseTemplate(item.value, envVars, inputData, dataVars) : [],
    [item.value, envVars, inputData, dataVars, showPreview],
  )

  return (
    <div className="api-kv-row-wrap">
      <div className="api-kv-row">
        <button
          className={`api-kv-check${item.enabled ? ' api-kv-check-on' : ''}`}
          onClick={() => onChange(item.id, 'enabled', !item.enabled)}
          title={item.enabled ? '비활성화' : '활성화'}
        />
        <input
          className="dm-input api-kv-input"
          value={item.key}
          onChange={e => onChange(item.id, 'key', e.target.value)}
          placeholder="Key"
        />
        <AutocompleteField
          value={item.value}
          onChange={v => onChange(item.id, 'value', v)}
          envVarNames={envVarNames}
          inputKeys={inputKeys}
          className="dm-input api-kv-input"
          placeholder="Value"
          spellCheck={false}
        />
        <button
          className="btn ghost icon dm-item-del"
          style={{ width: 22, height: 22, flexShrink: 0 }}
          onClick={() => onRemove(item.id)}
          title="삭제"
        >
          <IcoTrash size={11} />
        </button>
      </div>
    </div>
  )
}

// ?? Main component ????????????????????????????????

export default function ApiNodeModal({
  node, isNew, initialInput, initialOutput, initialPreConsoleLogs, initialPostConsoleLogs,
  envVars = {}, dataVars, onRun, onSave, onDelete, onClose,
}: Props): JSX.Element {
  const initial = parseConfig(node.config)
  const monacoTheme = useMonacoTheme()
  const inputPickerExpandedStorageKey = `api-input-picker-expanded-${node.id}`
  const [moduleName, setModuleName] = useState(node.label)
  const [method, setMethod] = useState<ApiConfig['method']>(initial.method)
  const [url, setUrl] = useState(initial.url)
  const [headers, setHeaders] = useState<ApiKvItem[]>(
    isNew && initial.headers.length === 0
      ? [{ id: randomId(), key: 'Content-Type', value: 'application/json', enabled: true }]
      : initial.headers,
  )
  const [params, setParams] = useState<ApiKvItem[]>(initial.params)
  const [body, setBody] = useState(initial.body)
  const [bodyType] = useState<ApiConfig['bodyType']>(initial.bodyType)
  const [auth, setAuth] = useState<ApiAuthConfig>(() => normalizeApiAuth(initial.auth))
  const [preScript, setPreScript] = useState<string>(() => initial.preScript?.trim() ? initial.preScript : DEFAULT_PRE_REQUEST_SCRIPT)
  const [postScript, setPostScript] = useState<string>(() => initial.postScript?.trim() ? initial.postScript : DEFAULT_POST_RESPONSE_SCRIPT)
  const [inputMappings, setInputMappings] = useState<Record<string, string>>(initial.inputMappings ?? {})
  const [activeTab, setActiveTab] = useState<SettingsTab>(() => hasBody(initial.method) ? 'body' : 'auth')
  const [prePaneTab, setPrePaneTab] = useState<ScriptPaneTab>('script')
  const [postPaneTab, setPostPaneTab] = useState<ScriptPaneTab>('script')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [isBodyFullscreen, setIsBodyFullscreen] = useState(false)

  const [inputJson, setInputJson] = useState(initialInput ?? '')
  const [inputError, setInputError] = useState(false)
  const [inputViewMode, setInputViewMode] = useState<JsonViewMode>(() => canShowJsonTree(initialInput) ? 'tree' : 'raw')

  const [testing, setTesting] = useState(false)
  const [testResponse, setTestResponse] = useState<string | null>(initialOutput ?? null)
  const [outputViewMode, setOutputViewMode] = useState<JsonViewMode>(() => canShowJsonTree(initialOutput) ? 'tree' : 'raw')
  const [testStatus, setTestStatus] = useState<{ code: number; text: string; ms: number } | null>(null)
  const [testError, setTestError] = useState<string | null>(null)
  const [outputError, setOutputError] = useState(false)
  const [testErrorDetail, setTestErrorDetail] = useState<TestErrorDetail | null>(null)
  const [preConsoleLogs, setPreConsoleLogs] = useState<ScriptConsoleEntry[]>(initialPreConsoleLogs ?? [])
  const [postConsoleLogs, setPostConsoleLogs] = useState<ScriptConsoleEntry[]>(initialPostConsoleLogs ?? [])
  const [mappingPickerName, setMappingPickerName] = useState<string | null>(null)
  const [inputPickerExpandedIds, setInputPickerExpandedIds] = useState<Set<string>>(() =>
    loadExpandedIds(inputPickerExpandedStorageKey),
  )

  // Tooltip state
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number; placement: 'above' | 'below' } | null>(null)

  // Window position & size
  const [rect, setRect] = useState(() => {
    const ww = window.innerWidth
    const wh = window.innerHeight
    const w = Math.min(ww - 48, Math.max(800, Math.round(ww * 0.85)))
    const h = Math.min(wh - 80, Math.max(500, Math.round(wh * 0.85)))
    return { x: Math.round((ww - w) / 2), y: Math.round((wh - h) / 2), w, h }
  })
  const { isMaximized, toggleMaximized } = useModalMaximize(rect, setRect)

  const dragRef = useRef<{ ox: number; oy: number } | null>(null)
  const resizeRef = useRef<{ dir: ResizeDir; ox: number; oy: number; rx: number; ry: number; rw: number; rh: number } | null>(null)
  const tooltipTimerRef = useRef<number | null>(null)
  const splitterRef = useRef<
    | { kind: 'v'; which: 'left' | 'right'; startX: number; startW: number }
    | { kind: 'h'; which: 'inputPre' | 'outputPost'; startY: number; startH: number }
    | null
  >(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const leftColRef = useRef<HTMLDivElement>(null)
  const rightColRef = useRef<HTMLDivElement>(null)
  const [leftW, setLeftW] = useState(() => Math.round(rect.w / 3))
  const [rightW, setRightW] = useState(() => Math.round(rect.w / 3))
  const [inputH, setInputH] = useState<number>(() => Math.round((rect.h - 100) * 0.45))
  const [outputH, setOutputH] = useState<number>(() => Math.round((rect.h - 100) * 0.45))

  useEffect(() => {
    setPreConsoleLogs(initialPreConsoleLogs ?? [])
    setPostConsoleLogs(initialPostConsoleLogs ?? [])
  }, [initialPreConsoleLogs, initialPostConsoleLogs, node.id])

  useEffect(() => {
    if (!hasBody(method) && activeTab === 'body') setActiveTab('auth')
  }, [activeTab, method])

  useEffect(() => {
    if (!hasBody(method)) setIsBodyFullscreen(false)
  }, [method])

  useEffect(() => {
    if (!isBodyFullscreen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsBodyFullscreen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isBodyFullscreen])

  useEffect(() => {
    localStorage.setItem(inputPickerExpandedStorageKey, JSON.stringify(Array.from(inputPickerExpandedIds)))
  }, [inputPickerExpandedIds, inputPickerExpandedStorageKey])

  const inputParseState = useMemo(() => parseJsonForViewer(inputJson), [inputJson])
  const outputRaw = testError ?? testResponse ?? ''
  const outputParseState = useMemo(() => parseJsonForViewer(outputRaw), [outputRaw])

  useEffect(() => {
    if (inputParseState.status !== 'valid' && inputViewMode === 'tree') setInputViewMode('raw')
  }, [inputParseState.status, inputViewMode])

  useEffect(() => {
    if (outputParseState.status !== 'valid' && outputViewMode === 'tree') setOutputViewMode('raw')
  }, [outputParseState.status, outputViewMode])

  // Parse inputJson into a flat object for interpolation
  const baseInputData = useMemo<Record<string, unknown>>(() => {
    try {
      const p = JSON.parse(inputJson) as unknown
      if (Array.isArray(p)) return (p[0] ?? {}) as Record<string, unknown>
      if (typeof p === 'object' && p !== null) return p as Record<string, unknown>
      return {}
    } catch {
      return {}
    }
  }, [inputJson])
  const inputData = useMemo(
    () => applyInputMappings(baseInputData, inputMappings),
    [baseInputData, inputMappings],
  )
  const dataInputData = useMemo<Record<string, unknown>>(() => dataVars ?? {}, [dataVars])

  const envVarNames = useMemo(() => Object.keys(envVars), [envVars])
  const inputKeys = useMemo(() => getInputPathSuggestions(inputData), [inputData])
  const authLabel = useMemo(
    () => API_AUTH_TYPES.find(item => item.type === auth.type)?.label ?? 'No Auth',
    [auth.type],
  )

  const usedVariables = useMemo<UsedVariable[]>(() => {
    const allTemplates = [url, ...headers.map(h => h.value), ...params.map(p => p.value), body, ...getApiAuthTemplateValues(auth)]
    const seen = new Map<string, UsedVariable>()
    allTemplates.forEach(template => {
      parseTemplate(template, envVars, inputData, dataInputData).forEach(tok => {
        if (tok.type === 'env') {
          const key = `env:${tok.name}`
          if (!seen.has(key)) seen.set(key, { kind: 'env', name: tok.name, resolved: tok.resolved })
        }
        if (tok.type === 'input') {
          const key = `input:${tok.key}`
          if (!seen.has(key)) seen.set(key, { kind: 'input', name: tok.key, resolved: tok.resolved, mappedPath: inputMappings[tok.key] })
        }
        if (tok.type === 'data') {
          const key = `data:${tok.key}`
          if (!seen.has(key)) seen.set(key, { kind: 'data', name: tok.key, resolved: tok.resolved })
        }
      })
    })
    return Array.from(seen.values())
  }, [url, headers, params, body, auth, envVars, inputData, dataInputData, inputMappings])

  // URL preview tokens
  const urlTokens = useMemo(
    () => hasVars(url) ? parseTemplate(url, envVars, inputData, dataInputData) : [],
    [url, envVars, inputData, dataInputData],
  )

  // Body vars summary: collect all tokens that are env/input
  const bodyTokens = useMemo(
    () => hasVars(body) ? parseTemplate(body, envVars, inputData, dataInputData) : [],
    [body, envVars, inputData, dataInputData],
  )
  const bodyVarTokens = useMemo(
    () => bodyTokens.filter(t => t.type !== 'text'),
    [bodyTokens],
  )

  const handleHover = useCallback((text: string | null, domRect?: DOMRect) => {
    if (tooltipTimerRef.current !== null) {
      window.clearTimeout(tooltipTimerRef.current)
      tooltipTimerRef.current = null
    }
    if (!text || !domRect) {
      setTooltip(null)
      return
    }

    const targetRect = {
      left: domRect.left,
      right: domRect.right,
      top: domRect.top,
      bottom: domRect.bottom,
      width: domRect.width,
    }
    tooltipTimerRef.current = window.setTimeout(() => {
      const margin = 16
      const maxTooltipWidth = Math.min(720, window.innerWidth - margin * 2)
      const halfWidth = maxTooltipWidth / 2
      const centerX = targetRect.left + targetRect.width / 2
      const x = Math.min(Math.max(centerX, margin + halfWidth), window.innerWidth - margin - halfWidth)
      const canShowBelow = targetRect.bottom + 260 < window.innerHeight || targetRect.top < 260
      setTooltip({
        text,
        x,
        y: canShowBelow ? targetRect.bottom + 12 : targetRect.top - 12,
        placement: canShowBelow ? 'below' : 'above',
      })
      tooltipTimerRef.current = null
    }, 1000)
  }, [])

  useEffect(() => () => {
    if (tooltipTimerRef.current !== null) {
      window.clearTimeout(tooltipTimerRef.current)
    }
  }, [])

  const onHeaderDown = useCallback((e: React.MouseEvent) => {
    if (isMaximized) return
    if ((e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    dragRef.current = { ox: e.clientX - rect.x, oy: e.clientY - rect.y }
  }, [isMaximized, rect])

  const onResizeDown = useCallback((e: React.MouseEvent, dir: ResizeDir) => {
    e.preventDefault(); e.stopPropagation()
    resizeRef.current = { dir, ox: e.clientX, oy: e.clientY, rx: rect.x, ry: rect.y, rw: rect.w, rh: rect.h }
  }, [rect])

  const onSplitterDown = useCallback((which: 'left' | 'right', e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    splitterRef.current = { kind: 'v', which, startX: e.clientX, startW: which === 'left' ? leftW : rightW }
  }, [leftW, rightW])

  const onHSplitterDown = useCallback((which: 'inputPre' | 'outputPost', e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    splitterRef.current = { kind: 'h', which, startY: e.clientY, startH: which === 'inputPre' ? inputH : outputH }
  }, [inputH, outputH])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (dragRef.current) {
        const d = dragRef.current
        setRect(r => ({
          ...r,
          x: Math.max(0, Math.min(window.innerWidth - r.w, e.clientX - d.ox)),
          y: Math.max(0, Math.min(window.innerHeight - r.h, e.clientY - d.oy)),
        }))
      }
      if (resizeRef.current) {
        const { dir, ox, oy, rx, ry, rw, rh } = resizeRef.current
        const dx = e.clientX - ox, dy = e.clientY - oy
        setRect(() => {
          let x = rx, y = ry, w = rw, h = rh
          if (dir.includes('e')) w = Math.max(MIN_W, rw + dx)
          if (dir.includes('s')) h = Math.max(MIN_H, rh + dy)
          if (dir.includes('w')) { w = Math.max(MIN_W, rw - dx); x = rx + rw - w }
          if (dir.includes('n')) { h = Math.max(MIN_H, rh - dy); y = ry + rh - h }
          return { x: Math.max(0, x), y: Math.max(0, y), w, h }
        })
      }
      if (splitterRef.current) {
        const s = splitterRef.current
        if (s.kind === 'v') {
          const totalW = bodyRef.current?.offsetWidth ?? 900
          const delta = e.clientX - s.startX
          if (s.which === 'left') setLeftW(() => Math.max(160, Math.min(totalW - rightW - 220, s.startW + delta)))
          else setRightW(() => Math.max(160, Math.min(totalW - leftW - 220, s.startW - delta)))
        } else {
          const colH = (s.which === 'inputPre' ? leftColRef : rightColRef).current?.offsetHeight ?? 400
          const delta = e.clientY - s.startY
          const next = Math.max(80, Math.min(colH - 100, s.startH + delta))
          if (s.which === 'inputPre') setInputH(next)
          else setOutputH(next)
        }
      }
    }
    const onUp = () => { dragRef.current = null; resizeRef.current = null; splitterRef.current = null }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
  }, [leftW, rightW, inputH, outputH])

  // KV helpers
  const addKv = (setter: React.Dispatch<React.SetStateAction<ApiKvItem[]>>) => {
    setter(prev => [...prev, { id: randomId(), key: '', value: '', enabled: true }])
  }
  const updateKv = (
    setter: React.Dispatch<React.SetStateAction<ApiKvItem[]>>,
    id: string,
    field: 'key' | 'value' | 'enabled',
    val: string | boolean,
  ) => {
    setter(prev => prev.map(it => it.id === id ? { ...it, [field]: val } : it))
  }
  const removeKv = (setter: React.Dispatch<React.SetStateAction<ApiKvItem[]>>, id: string) => {
    setter(prev => prev.filter(it => it.id !== id))
  }
  const updateAuthField = (field: keyof ApiAuthConfig, value: string) => {
    setAuth(prev => ({ ...normalizeApiAuth(prev), [field]: value }))
  }
  const updateAuthType = (type: ApiAuthType) => {
    setAuth(prev => ({ ...normalizeApiAuth(prev), type }))
  }
  const authInput = (
    field: keyof Pick<ApiAuthConfig, 'token' | 'username' | 'password' | 'key' | 'value' | 'accessToken'>,
    label: string,
    placeholder: string,
  ): JSX.Element => (
    <div className="dm-field">
      <label className="dm-field-label">{label}</label>
      <AutocompleteField
        value={typeof auth[field] === 'string' ? auth[field] : ''}
        onChange={v => updateAuthField(field, v)}
        envVarNames={envVarNames}
        inputKeys={inputKeys}
        className="dm-input api-auth-input"
        placeholder={placeholder}
        spellCheck={false}
      />
    </div>
  )

  const buildResolvedRequest = useCallback((
    requestEnvVars: Record<string, string> = envVars,
    requestInputData: Record<string, unknown> = baseInputData,
  ): ResolvedApiRequest => {
    const mappedRequestInputData = applyInputMappings(requestInputData, inputMappings)
    let fullUrl = resolveTemplate(url.trim(), requestEnvVars, mappedRequestInputData, dataInputData)
    const enabledParams = params.filter(p => p.enabled && p.key)
    if (enabledParams.length > 0) {
      const qs = new URLSearchParams(enabledParams.map(p => [p.key, resolveTemplate(p.value, requestEnvVars, mappedRequestInputData, dataInputData)]))
      fullUrl += (fullUrl.includes('?') ? '&' : '?') + qs.toString()
    }
    const hdrs: Record<string, string> = {}
    headers.filter(h => h.enabled && h.key).forEach(h => {
      hdrs[h.key] = resolveTemplate(h.value, requestEnvVars, mappedRequestInputData, dataInputData)
    })
    let bodyStr: string | undefined
    if (hasBody(method) && body.trim()) {
      if (bodyType === 'json' && !hdrs['Content-Type'] && !hdrs['content-type']) {
        hdrs['Content-Type'] = 'application/json'
      }
      bodyStr = resolveTemplate(body, requestEnvVars, mappedRequestInputData, dataInputData)
    }
    const authedRequest = applyApiAuth({ url: fullUrl, headers: hdrs }, auth, requestEnvVars, mappedRequestInputData, dataInputData)
    return { method, url: authedRequest.url, headers: authedRequest.headers, body: bodyStr }
  }, [auth, baseInputData, body, bodyType, envVars, headers, inputMappings, method, params, url, dataInputData])

  // Test API call (resolves vars before sending)
  const handleTest = async () => {
    if (!url.trim()) return
    setTesting(true)
    setTestResponse(null)
    setOutputViewMode('raw')
    setTestStatus(null)
    setTestError(null)
    setOutputError(false)
    setTestErrorDetail(null)
    setPreConsoleLogs([])
    setPostConsoleLogs([])
    const t0 = Date.now()
    let request: ResolvedApiRequest | null = null
    let scriptPhase: 'pre' | 'post' | null = null
    try {
      const requestEnvVars = { ...envVars }
      let requestInputData = { ...baseInputData }
      const scriptInput = withDataVarsForScript(parseInputValue(inputJson), dataInputData)

      if (preScript.trim()) {
        scriptPhase = 'pre'
        const preResult = await runPreRequest(preScript, { input: scriptInput, envVars: requestEnvVars })
        setPreConsoleLogs(preResult.logs)
        Object.assign(requestEnvVars, preResult.envUpdates)
        requestInputData = { ...requestInputData, ...preResult.inputVars }
        scriptPhase = null
      }

      request = buildResolvedRequest(requestEnvVars, requestInputData)
      const res = await window.api.http.fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
      })
      const ms = Date.now() - t0
      setTestStatus({ code: res.status, text: res.statusText, ms })
      const responseValue = parseResponseValue(res.text)
      const runtimeOutput = Array.isArray(responseValue)
        ? responseValue.length === 1 ? responseValue[0] : responseValue
        : responseValue
      if (typeof responseValue === 'string') {
        setTestResponse(res.text)
        setOutputViewMode(canShowJsonTree(res.text) ? 'tree' : 'raw')
      } else {
        setTestResponse(JSON.stringify(responseValue, null, 2))
        setOutputViewMode('tree')
      }
      setOutputError(false)

      if (!res.ok) {
        setTestErrorDetail({
          error: `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`,
          request,
        })
        return
      }

      if (postScript.trim()) {
        scriptPhase = 'post'
        const postResult = await runPostResponse(postScript, {
          input: scriptInput,
          output: runtimeOutput,
          envVars: requestEnvVars,
        })
        setPostConsoleLogs(postResult.logs)
        Object.assign(requestEnvVars, postResult.envUpdates)
        if (postResult.hasOutputOverride) {
          const nextOutput = stringifyRuntimeValue(postResult.outputOverride)
          setTestResponse(nextOutput)
          setOutputViewMode(canShowJsonTree(nextOutput) ? 'tree' : 'raw')
          setOutputError(false)
        }
        scriptPhase = null
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (isScriptRuntimeError(err)) {
        if (scriptPhase === 'pre') setPreConsoleLogs(err.logs)
        if (scriptPhase === 'post') setPostConsoleLogs(err.logs)
      }
      setTestError(message)
      setOutputViewMode('raw')
      setOutputError(false)
      setTestErrorDetail({
        error: message,
        request: request ?? { method, url: url.trim(), headers: {} },
      })
    } finally {
      setTesting(false)
    }
  }

  const handleFormatInput = () => {
    const result = formatJson(inputJson)
    setInputJson(result.value); setInputError(result.error)
    if (!result.error && result.value.trim()) setInputViewMode('tree')
  }

  const handleFormatBody = () => {
    const result = formatJson(body)
    setBody(result.value)
  }

  const handleFormatOutput = () => {
    const raw = testError ?? testResponse ?? ''
    const result = formatJson(raw)
    if (testError !== null) setTestError(result.value)
    else setTestResponse(result.value)
    setOutputError(result.error)
    if (!result.error && result.value.trim()) setOutputViewMode('tree')
  }

  const handleApplyInputMapping = (name: string, path: string) => {
    setInputMappings(prev => ({ ...prev, [name]: path }))
    setMappingPickerName(null)
  }

  const handleOpenInputMappingPicker = (name: string) => {
    const nodes = flattenJsonViewer(baseInputData)
    setInputPickerExpandedIds(prev => expandedIdsForJsonPath(nodes, inputMappings[name], prev))
    setMappingPickerName(name)
  }

  const handleSave = async () => {
    setSaving(true)
    const config: ApiConfig = {
      method, url: url.trim(), headers, params, body, bodyType,
      auth: normalizeApiAuth(auth),
      preScript: preScript ?? '',
      postScript: postScript ?? '',
      inputMappings,
    }
    const nextModuleName = moduleName.trim() || 'API'
    await onSave(node.id, nextModuleName, JSON.stringify(config))
    setSaving(false)
    onClose()
  }

  const statusColor = testStatus
    ? testStatus.code >= 200 && testStatus.code < 300
      ? '#3fb950'
      : testStatus.code >= 400
        ? '#f85149'
        : '#d29922'
    : null

  return (
    <div className="dm-overlay">
      <div className={`dm-modal${isMaximized ? ' is-maximized' : ''}`} style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}>
        {RESIZE_DIRS.map(dir => (
          <div key={dir} className={`dm-resize-handle dm-resize-${dir}`} onMouseDown={e => onResizeDown(e, dir)} />
        ))}

        <div className="dm-modal-inner">

          {/* Header */}
          <div className="dm-hd" onMouseDown={onHeaderDown}>
            <div className="dm-hd-left">
              <div className="dm-hd-icon api-hd-icon"><ApiIcon size={13} /></div>
              <span className="dm-hd-title">{isNew ? 'API 모듈 추가' : 'API 모듈 설정'}</span>
            </div>
            <div className="dm-hd-window-actions">
              <button
                className="btn ghost icon dm-window-btn"
                onClick={toggleMaximized}
                title={isMaximized ? '이전 크기로 복원' : '창 최대화'}
                aria-label={isMaximized ? '이전 크기로 복원' : '창 최대화'}
              >
                {isMaximized ? <IcoRestore size={13} /> : <IcoMaximize size={13} />}
              </button>
              <button className="btn ghost icon dm-close-btn" onClick={onClose} title="닫기" aria-label="닫기"><IcoX size={13} /></button>
            </div>
          </div>

          {/* 3-pane body */}
          <div className="dm-body" ref={bodyRef}>

            {/* LEFT column: INPUT (top) + Pre Request (bottom) */}
            <div className="dm-pane-col" ref={leftColRef} style={{ width: leftW, flexShrink: 0 }}>
              <div className="dm-pane" style={{ height: inputH, flexShrink: 0 }}>
                <div className="dm-pane-hd">
                  <span className={`dm-pane-label dm-pane-label-input${inputError ? ' dm-pane-label-error' : ''}`}>INPUT</span>
                  <div className="dm-pane-hd-actions">
                    {inputError && <span className="dm-json-err-badge">Invalid JSON</span>}
                    <span className="dm-pane-type">JSON</span>
                    <JsonInspectorButton
                      title={`${moduleName || 'API'} INPUT`}
                      value={inputJson}
                      disabled={!inputJson.trim()}
                    />
                    {onRun && (
                      <button
                        className="btn ghost icon dm-format-btn dm-run-btn"
                        onClick={async () => {
                          const out = await onRun()
                          setInputJson(out)
                          setInputError(false)
                          setInputViewMode(canShowJsonTree(out) ? 'tree' : 'raw')
                        }}
                        title="상위 노드를 실행해 데이터를 미리보기"
                      >
                        <RunIcon />
                      </button>
                    )}
                    <button className="btn ghost icon dm-format-btn" onClick={handleFormatInput} title="JSON 정렬">
                      <FormatIcon />
                    </button>
                    <button
                      className="btn ghost icon api-test-btn"
                      onClick={handleTest}
                      disabled={testing || !url.trim()}
                      title="API 테스트 실행"
                    >
                      {testing ? <span className="api-testing-dot" /> : <SendIcon />}
                    </button>
                  </div>
                </div>
                <div className="dm-pane-body">
                  <JsonMonacoEditor
                    path={`${node.id}/input.json`}
                    value={inputJson}
                    onChange={next => { setInputJson(next); setInputError(false) }}
                    error={inputError}
                    placeholder="{}"
                  />
                </div>
              </div>

              <div className="dm-splitter-h" onMouseDown={e => onHSplitterDown('inputPre', e)} />

              <div className="dm-pane" style={{ flex: '1 1 0', minHeight: 0 }}>
                <div className="dm-pane-hd">
                  <span className="dm-pane-label dm-pane-label-pre">PRE REQUEST</span>
                  <div className="dm-pane-hd-actions">
                    <ScriptHelpButton phase="pre" />
                    <div className="api-script-pane-tabs">
                      <button
                        className={`api-script-pane-tab${prePaneTab === 'script' ? ' api-script-pane-tab-active' : ''}`}
                        onClick={() => setPrePaneTab('script')}
                      >
                        JS
                      </button>
                      <button
                        className={`api-script-pane-tab${prePaneTab === 'console' ? ' api-script-pane-tab-active' : ''}`}
                        onClick={() => setPrePaneTab('console')}
                      >
                        콘솔
                        {preConsoleLogs.length > 0 && <span className="api-script-log-count">{preConsoleLogs.length}</span>}
                      </button>
                    </div>
                  </div>
                </div>
                {prePaneTab === 'script' ? (
                  <div className="dm-pane-body dm-pane-body-monaco">
                    <Suspense fallback={<MonacoFallback />}>
                      <MonacoEditor
                        height="100%"
                        language="javascript"
                        path={`a8a://api-script/${node.id}/pre-request.js`}
                        theme={monacoTheme}
                        value={preScript}
                        beforeMount={beforeApiScriptEditorMount}
                        onChange={(v: string | undefined) => setPreScript(v ?? '')}
                        options={MONACO_OPTIONS}
                      />
                    </Suspense>
                  </div>
                ) : (
                  <div className="dm-pane-body api-script-console-body">
                    <ScriptConsoleView logs={preConsoleLogs} emptyText="PRE REQUEST 콘솔 로그가 없습니다." />
                  </div>
                )}
              </div>
            </div>

            <div className="dm-splitter" onMouseDown={e => onSplitterDown('left', e)} />

            {/* Settings pane */}
            <div className="dm-pane dm-pane-settings" style={{ flex: '1 1 0', minWidth: 200 }}>
              <div className="dm-pane-hd">
                <span className="dm-pane-label">설정</span>
              </div>
              <div className="dm-pane-body dm-settings-body">

                {/* Module name */}
                <div className="dm-field">
                  <label className="dm-field-label">모듈 이름</label>
                  <input
                    className="dm-input"
                    value={moduleName}
                    onChange={e => setModuleName(e.target.value)}
                    placeholder="API"
                    autoFocus
                  />
                </div>

                {/* Method + URL */}
                <div className="dm-field">
                  <label className="dm-field-label">엔드포인트</label>
                  <div className="api-endpoint-row">
                    <select
                      className="api-method-select"
                      value={method}
                      onChange={e => setMethod(e.target.value as ApiConfig['method'])}
                      style={{ color: methodColor(method) }}
                    >
                      {HTTP_METHODS.map(m => (
                        <option
                          key={m}
                          value={m}
                          style={{ color: methodColor(m), background: 'var(--bg-2)', fontWeight: 700 }}
                        >
                          {m}
                        </option>
                      ))}
                    </select>
                    <AutocompleteField
                      value={url}
                      onChange={setUrl}
                      envVarNames={envVarNames}
                      inputKeys={inputKeys}
                      className="dm-input api-url-input"
                      placeholder="https://api.example.com/endpoint"
                      spellCheck={false}
                    />
                  </div>
                </div>

                {/* Tab bar */}
                <div className="api-tabs">
                  {(['auth', 'headers', 'params', 'body'] as SettingsTab[]).map(tab => (
                    <button
                      key={tab}
                      className={`api-tab${activeTab === tab ? ' api-tab-active' : ''}${tab === 'body' && !hasBody(method) ? ' api-tab-disabled' : ''}`}
                      onClick={() => { if (tab !== 'body' || hasBody(method)) setActiveTab(tab) }}
                    >
                      {tab === 'auth' ? 'AUTH' : tab === 'headers' ? 'HEADERS' : tab === 'params' ? 'PARAMS' : 'BODY'}
                      {tab === 'auth' && auth.type !== 'noAuth' && (
                        <span className="api-tab-count" title={authLabel}>ON</span>
                      )}
                      {tab === 'headers' && headers.filter(h => h.enabled && h.key).length > 0 && (
                        <span className="api-tab-count">{headers.filter(h => h.enabled && h.key).length}</span>
                      )}
                      {tab === 'params' && params.filter(p => p.enabled && p.key).length > 0 && (
                        <span className="api-tab-count">{params.filter(p => p.enabled && p.key).length}</span>
                      )}
                    </button>
                  ))}
                </div>

                {/* Tab content */}
                {activeTab === 'auth' && (
                  <div className="dm-field dm-field-grow">
                    <div className="dm-field-hd">
                      <label className="dm-field-label">Authentication</label>
                      <span className="api-auth-current">{authLabel}</span>
                    </div>
                    <div className="api-auth-fields">
                      <div className="dm-field">
                        <label className="dm-field-label">Type</label>
                        <select
                          className="dm-input api-auth-select"
                          value={auth.type}
                          onChange={e => updateAuthType(e.target.value as ApiAuthType)}
                        >
                          {API_AUTH_TYPES.map(item => (
                            <option key={item.type} value={item.type}>{item.label}</option>
                          ))}
                        </select>
                      </div>

                      {auth.type === 'noAuth' && (
                        <div className="api-auth-empty">API request auth headers will not be added.</div>
                      )}

                      {auth.type === 'bearer' && authInput('token', 'Token', '{{token}} or raw token')}

                      {auth.type === 'basic' && (
                        <div className="api-auth-row">
                          {authInput('username', 'Username', 'username')}
                          {authInput('password', 'Password', 'password')}
                        </div>
                      )}

                      {auth.type === 'apiKey' && (
                        <>
                          <div className="api-auth-row">
                            <div className="dm-field api-auth-addto">
                              <label className="dm-field-label">Add To</label>
                              <select
                                className="dm-input api-auth-select"
                                value={auth.addTo ?? 'header'}
                                onChange={e => updateAuthField('addTo', e.target.value)}
                              >
                                <option value="header">Header</option>
                                <option value="query">Query Param</option>
                              </select>
                            </div>
                            {authInput('key', 'Key', auth.addTo === 'query' ? 'api_key' : 'X-API-Key')}
                          </div>
                          {authInput('value', 'Value', '{{apiKey}} or raw value')}
                        </>
                      )}

                      {auth.type === 'oauth2' && authInput('accessToken', 'Access Token', '{{accessToken}} or raw token')}
                    </div>
                  </div>
                )}

                {(activeTab === 'headers' || activeTab === 'params') && (
                  <div className="dm-field dm-field-grow">
                    <div className="dm-field-hd">
                      <label className="dm-field-label">
                        {activeTab === 'headers' ? `헤더 (${headers.length})` : `쿼리 파라미터 (${params.length})`}
                      </label>
                      <button
                        className="btn ghost icon"
                        style={{ width: 20, height: 20 }}
                        onClick={() => addKv(activeTab === 'headers' ? setHeaders : setParams)}
                        title="항목 추가"
                      >
                        <IcoPlus size={11} />
                      </button>
                    </div>
                    <div className="api-kv-list">
                      {activeTab === 'headers' && (
                        headers.length === 0
                          ? <div className="dm-empty-hint">+ 버튼으로 헤더를 추가하세요</div>
                          : headers.map(h => (
                            <KvRow
                              key={h.id}
                              item={h}
                              onChange={(id, f, v) => updateKv(setHeaders, id, f, v)}
                              onRemove={id => removeKv(setHeaders, id)}
                              envVars={envVars}
                              inputData={inputData}
                              dataVars={dataInputData}
                              onHover={handleHover}
                            />
                          ))
                      )}
                      {activeTab === 'params' && (
                        params.length === 0
                          ? <div className="dm-empty-hint">+ 버튼으로 파라미터를 추가하세요</div>
                          : params.map(p => (
                            <KvRow
                              key={p.id}
                              item={p}
                              onChange={(id, f, v) => updateKv(setParams, id, f, v)}
                              onRemove={id => removeKv(setParams, id)}
                              envVars={envVars}
                              inputData={inputData}
                              dataVars={dataInputData}
                              onHover={handleHover}
                            />
                          ))
                      )}
                    </div>
                  </div>
                )}

                {activeTab === 'body' && hasBody(method) && (
                  <div className="dm-field dm-field-grow">
                    <div className="dm-field-hd">
                      <label className="dm-field-label">Body (JSON)</label>
                      <div className="api-body-actions">
                        <button
                          className="btn ghost icon dm-format-btn"
                          onClick={() => setIsBodyFullscreen(true)}
                          title="Body 전체화면 편집"
                          aria-label="Body 전체화면 편집"
                        >
                          <IcoMaximize size={13} />
                        </button>
                        <button
                          className="btn ghost icon dm-format-btn"
                          onClick={handleFormatBody}
                          title="JSON 정렬"
                          aria-label="JSON 정렬"
                        >
                          <FormatIcon />
                        </button>
                      </div>
                    </div>
                    <JsonMonacoEditor
                      path={`${node.id}/body.json`}
                      value={body}
                      onChange={setBody}
                      placeholder='{"key": "value"}'
                      templateSuggestions={{ envVarNames, inputKeys }}
                    />
                  </div>
                )}

                {usedVariables.length > 0 && (
                  <div className="dm-field">
                    <label className="dm-field-label">사용된 환경변수 / INPUT / DATA</label>
                    <table className="api-env-vars-table">
                      <thead>
                        <tr>
                          <th>구분</th>
                          <th>변수</th>
                          <th>적용 값</th>
                        </tr>
                      </thead>
                      <tbody>
                        {usedVariables.map(({ kind, name, resolved, mappedPath }) => {
                          const isInput = kind === 'input'
                          const isData = kind === 'data'
                          const valueText = resolved !== null
                            ? resolved
                            : isInput
                              ? '클릭하여 INPUT JSON에서 선택'
                              : isData
                                ? 'DATA 값 없음'
                                : '환경변수 없음'
                          const valueTooltipText = getUsedVariableTooltipText(valueText, mappedPath)
                          const tokenText = isInput ? `[[${name}]]` : isData ? `<<${name}>>` : `{{${name}}}`
                          const kindLabel = isInput ? 'INPUT' : isData ? 'DATA' : '환경'
                          return (
                            <tr
                              key={`${kind}:${name}`}
                              className={isInput ? 'api-var-row-clickable' : undefined}
                              onClick={() => {
                                if (isInput) {
                                  handleHover(null)
                                  handleOpenInputMappingPicker(name)
                                }
                              }}
                            >
                              <td>
                                <span className={`api-var-kind api-var-kind-${kind}`}>
                                  {kindLabel}
                                </span>
                              </td>
                              <td>
                                <span className={`api-var-token${isInput ? ' api-input-token' : ''}${resolved !== null ? ' api-var-ok' : ' api-var-err'}`}>
                                  {tokenText}
                                </span>
                              </td>
                              <td
                                className={resolved !== null ? 'api-env-val-ok' : 'api-env-val-err'}
                                onMouseEnter={e => handleHover(valueTooltipText, e.currentTarget.getBoundingClientRect())}
                                onMouseLeave={() => handleHover(null)}
                              >
                                {isInput && mappedPath && (
                                  <div className="api-input-mapping-path">{mappedPath}</div>
                                )}
                                <div className="api-env-val-content">{valueText}</div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

              </div>
            </div>

            <div className="dm-splitter" onMouseDown={e => onSplitterDown('right', e)} />

            {/* RIGHT column: OUTPUT (top) + Post Response (bottom) */}
            <div className="dm-pane-col" ref={rightColRef} style={{ width: rightW, flexShrink: 0 }}>
              <div className="dm-pane" style={{ height: outputH, flexShrink: 0 }}>
                <div className="dm-pane-hd">
                  <span className={`dm-pane-label api-pane-label-output${outputError ? ' dm-pane-label-error' : ''}`}>OUTPUT</span>
                  <div className="dm-pane-hd-actions">
                    {outputError && <span className="dm-json-err-badge">Invalid JSON</span>}
                    {testStatus && (
                      <span
                        className="api-status-badge"
                        style={{ color: statusColor ?? undefined, borderColor: `${statusColor}44` }}
                      >
                        {testStatus.code} · {testStatus.ms}ms
                      </span>
                    )}
                    <span className="dm-pane-type">JSON</span>
                    <JsonInspectorButton
                      title={`${moduleName || 'API'} OUTPUT`}
                      value={outputRaw}
                      disabled={!outputRaw.trim()}
                    />
                    <button className="btn ghost icon dm-format-btn" onClick={handleFormatOutput} title="JSON 정렬">
                      <FormatIcon />
                    </button>
                  </div>
                </div>
                <div className="dm-pane-body">
                  <JsonMonacoEditor
                    path={`${node.id}/output.json`}
                    value={outputRaw}
                    readOnly
                    error={outputError}
                    placeholder={url.trim() ? 'INPUT 패널의 실행 버튼으로 API를 실행하세요' : 'URL을 입력하세요'}
                  />
                </div>
              </div>

              <div className="dm-splitter-h" onMouseDown={e => onHSplitterDown('outputPost', e)} />

              <div className="dm-pane" style={{ flex: '1 1 0', minHeight: 0 }}>
                <div className="dm-pane-hd">
                  <span className="dm-pane-label dm-pane-label-post">POST RESPONSE</span>
                  <div className="dm-pane-hd-actions">
                    <ScriptHelpButton phase="post" />
                    <div className="api-script-pane-tabs">
                      <button
                        className={`api-script-pane-tab${postPaneTab === 'script' ? ' api-script-pane-tab-active' : ''}`}
                        onClick={() => setPostPaneTab('script')}
                      >
                        JS
                      </button>
                      <button
                        className={`api-script-pane-tab${postPaneTab === 'console' ? ' api-script-pane-tab-active' : ''}`}
                        onClick={() => setPostPaneTab('console')}
                      >
                        콘솔
                        {postConsoleLogs.length > 0 && <span className="api-script-log-count">{postConsoleLogs.length}</span>}
                      </button>
                    </div>
                  </div>
                </div>
                {postPaneTab === 'script' ? (
                  <div className="dm-pane-body dm-pane-body-monaco">
                    <Suspense fallback={<MonacoFallback />}>
                      <MonacoEditor
                        height="100%"
                        language="javascript"
                        path={`a8a://api-script/${node.id}/post-response.js`}
                        theme={monacoTheme}
                        value={postScript}
                        beforeMount={beforeApiScriptEditorMount}
                        onChange={(v: string | undefined) => setPostScript(v ?? '')}
                        options={MONACO_OPTIONS}
                      />
                    </Suspense>
                  </div>
                ) : (
                  <div className="dm-pane-body api-script-console-body">
                    <ScriptConsoleView logs={postConsoleLogs} emptyText="POST RESPONSE 콘솔 로그가 없습니다." />
                  </div>
                )}
              </div>
            </div>

          </div>

          {/* Footer */}
          <div className="dm-ft">
            {onDelete && !confirmDelete && (
              <button className="btn ghost dm-delete-btn" onClick={() => setConfirmDelete(true)}>
                <IcoTrash size={13} />
                삭제
              </button>
            )}
            {confirmDelete && (
              <>
                <span className="dm-delete-warn">주의: 이 모듈이 삭제됩니다.</span>
                <button className="btn ghost" onClick={() => setConfirmDelete(false)}>취소</button>
                <button
                  className="btn dm-delete-confirm-btn"
                  onClick={async () => { await onDelete!(); onClose() }}
                >
                  삭제 확인
                </button>
              </>
            )}
            {!confirmDelete && (
              <>
                <button
                  className="btn ghost"
                  onClick={isNew && onDelete ? async () => { await onDelete(); onClose() } : onClose}
                >
                  취소
                </button>
                <button className="btn primary api-save-btn" onClick={handleSave} disabled={saving}>
                  {saving ? '저장 중...' : '저장'}
                </button>
              </>
            )}
          </div>

        </div>
      </div>

      {isBodyFullscreen && (
        <div
          className="api-body-fullscreen"
          role="dialog"
          aria-modal="true"
          aria-labelledby="api-body-fullscreen-title"
          onClick={() => setIsBodyFullscreen(false)}
        >
          <div className="api-body-fullscreen-panel" onClick={event => event.stopPropagation()}>
            <div className="api-body-fullscreen-hd">
              <div className="api-body-fullscreen-title-wrap">
                <div id="api-body-fullscreen-title" className="api-body-fullscreen-title">Body (JSON)</div>
                <div className="api-body-fullscreen-meta">{method} 요청 Body</div>
              </div>
              <div className="api-body-fullscreen-actions">
                <button className="btn ghost" onClick={handleFormatBody}>JSON 정렬</button>
                <button
                  className="btn ghost icon api-body-fullscreen-close"
                  onClick={() => setIsBodyFullscreen(false)}
                  title="닫기"
                  aria-label="닫기"
                >
                  <IcoX size={14} />
                </button>
              </div>
            </div>
            <div className="api-body-fullscreen-editor">
              <JsonMonacoEditor
                path={`${node.id}/body.fullscreen.json`}
                value={body}
                onChange={setBody}
                placeholder='{"key": "value"}'
                templateSuggestions={{ envVarNames, inputKeys }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Tooltip */}
      {tooltip && (
        <div
          className="api-var-tooltip"
          style={{
            left: tooltip.x,
            top: tooltip.y,
            transform: tooltip.placement === 'above' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
          }}
        >
          {tooltip.text}
        </div>
      )}

      {mappingPickerName && (
        <JsonPathPicker
          key={mappingPickerName}
          data={baseInputData}
          variableName={mappingPickerName}
          initialPath={inputMappings[mappingPickerName]}
          expandedIds={inputPickerExpandedIds}
          onExpandedIdsChange={setInputPickerExpandedIds}
          onConfirm={path => handleApplyInputMapping(mappingPickerName, path)}
          onClose={() => setMappingPickerName(null)}
        />
      )}

      {testErrorDetail && (
        <div className="api-test-error-overlay" role="dialog" aria-modal="true" aria-labelledby="api-test-error-title">
          <div className="api-test-error-dialog">
            <div className="api-test-error-hd">
              <div>
                <div id="api-test-error-title" className="api-test-error-title">API 테스트 실패</div>
                <div className="api-test-error-subtitle">아래 값으로 호출을 시도했습니다.</div>
              </div>
              <button
                className="btn ghost icon api-test-error-close"
                onClick={() => setTestErrorDetail(null)}
                title="닫기"
              >
                <IcoX size={13} />
              </button>
            </div>
            <div className="api-test-error-body">
              <div className="api-test-error-section">
                <div className="api-test-error-label">오류</div>
                <pre>{testErrorDetail.error}</pre>
              </div>
              <div className="api-test-error-grid">
                <div>
                  <div className="api-test-error-label">Method</div>
                  <code>{testErrorDetail.request.method}</code>
                </div>
                <div>
                  <div className="api-test-error-label">URL</div>
                  <pre>{testErrorDetail.request.url}</pre>
                </div>
              </div>
              <div className="api-test-error-section">
                <div className="api-test-error-label">Headers</div>
                <pre>{JSON.stringify(testErrorDetail.request.headers, null, 2)}</pre>
              </div>
              <div className="api-test-error-section">
                <div className="api-test-error-label">Body</div>
                <pre>{testErrorDetail.request.body ?? '없음'}</pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function methodColor(method: string): string {
  switch (method) {
    case 'GET': return '#3fb950'
    case 'POST': return '#2f81f7'
    case 'PUT': return '#d29922'
    case 'PATCH': return '#a371f7'
    case 'DELETE': return '#f85149'
    default: return 'var(--text-1)'
  }
}
