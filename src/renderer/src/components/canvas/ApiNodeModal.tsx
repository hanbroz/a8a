import { useState, useRef, useCallback, useEffect, useMemo, lazy, Suspense } from 'react'
import { IcoPlus, IcoTrash, IcoX } from '../Icon'
import { randomId } from '../../utils/id'
import { parseTemplate, resolveTemplate } from '../../utils/interpolate'
import type { Token } from '../../utils/interpolate'

// Monaco is loaded only when this modal is rendered. The side-effect import
// (`monacoSetup`) wires up bundled workers and must complete before Editor
// mounts — chaining via `await` inside lazy() guarantees the order.
const MonacoEditor = lazy(async () => {
  await import('../../utils/monacoSetup')
  return import('@monaco-editor/react')
})

function MonacoFallback(): JSX.Element {
  return <div className="dm-monaco-loading">에디터 로드 중…</div>
}

interface Props {
  node: ApiNode
  isNew?: boolean
  initialInput?: string
  initialOutput?: string
  envVars?: Record<string, string>
  onRun?: () => string | Promise<string>
  onSave: (nodeId: string, label: string, config: string) => Promise<void>
  onDelete?: () => Promise<void>
  onClose: () => void
}

type ResizeDir = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'
type SettingsTab = 'headers' | 'params' | 'body'

const MIN_W = 720
const MIN_H = 420
const RESIZE_DIRS: ResizeDir[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

const MONACO_OPTIONS = {
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
  padding: { top: 8, bottom: 8 },
  scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
}

function parseConfig(raw: string): ApiConfig {
  try {
    const parsed = JSON.parse(raw)
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
      preScript: typeof parsed.preScript === 'string' ? parsed.preScript : '',
      postScript: typeof parsed.postScript === 'string' ? parsed.postScript : '',
    }
  } catch {
    return { method: 'GET', url: '', headers: [], params: [], body: '', bodyType: 'json', preScript: '', postScript: '' }
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

function hasBody(method: string): boolean {
  return ['POST', 'PUT', 'PATCH'].includes(method)
}

function hasVars(text: string): boolean {
  return text.includes('{{') || text.includes('[[')
}

// ── Autocomplete helpers ───────────────────────────

function detectTrigger(
  value: string,
  caretPos: number,
): { type: 'env' | 'input'; query: string; start: number } | null {
  const before = value.slice(0, caretPos)
  const envMatch = before.match(/\{\{([^{}]*)$/)
  if (envMatch) return { type: 'env', query: envMatch[1], start: caretPos - envMatch[0].length }
  const inputMatch = before.match(/\[\[([^\[\]]*)$/)
  if (inputMatch) return { type: 'input', query: inputMatch[1], start: caretPos - inputMatch[0].length }
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

// ── Icons ─────────────────────────────────────────

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

// ── Token display component ────────────────────────

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

// ── KV editor row ──────────────────────────────────

function KvRow({
  item, onChange, onRemove, envVars, inputData, onHover,
}: {
  item: ApiKvItem
  onChange: (id: string, field: 'key' | 'value' | 'enabled', val: string | boolean) => void
  onRemove: (id: string) => void
  envVars: Record<string, string>
  inputData: Record<string, unknown>
  onHover: (text: string | null, rect?: DOMRect) => void
}): JSX.Element {
  const envVarNames = useMemo(() => Object.keys(envVars), [envVars])
  const inputKeys = useMemo(() => Object.keys(inputData), [inputData])
  const showPreview = hasVars(item.value)
  const previewTokens = useMemo(
    () => showPreview ? parseTemplate(item.value, envVars, inputData) : [],
    [item.value, envVars, inputData, showPreview],
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

// ── Main component ────────────────────────────────

export default function ApiNodeModal({
  node, isNew, initialInput, initialOutput, envVars = {}, onRun, onSave, onDelete, onClose,
}: Props): JSX.Element {
  const initial = parseConfig(node.config)
  const [label, setLabel] = useState(node.label)
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
  const [preScript, setPreScript] = useState<string>(initial.preScript ?? '')
  const [postScript, setPostScript] = useState<string>(initial.postScript ?? '')
  const [activeTab, setActiveTab] = useState<SettingsTab>('headers')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const [inputJson, setInputJson] = useState(initialInput ?? '')
  const [inputError, setInputError] = useState(false)

  const [testing, setTesting] = useState(false)
  const [testResponse, setTestResponse] = useState<string | null>(initialOutput ?? null)
  const [testStatus, setTestStatus] = useState<{ code: number; text: string; ms: number } | null>(null)
  const [testError, setTestError] = useState<string | null>(null)

  // Tooltip state
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null)

  // Window position & size
  const [rect, setRect] = useState(() => {
    const ww = window.innerWidth
    const wh = window.innerHeight
    const w = Math.min(ww - 48, Math.max(800, Math.round(ww * 0.85)))
    const h = Math.min(wh - 80, Math.max(500, Math.round(wh * 0.85)))
    return { x: Math.round((ww - w) / 2), y: Math.round((wh - h) / 2), w, h }
  })

  const dragRef = useRef<{ ox: number; oy: number } | null>(null)
  const resizeRef = useRef<{ dir: ResizeDir; ox: number; oy: number; rx: number; ry: number; rw: number; rh: number } | null>(null)
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

  // Parse inputJson into a flat object for interpolation
  const inputData = useMemo<Record<string, unknown>>(() => {
    try {
      const p = JSON.parse(inputJson) as unknown
      if (Array.isArray(p)) return (p[0] ?? {}) as Record<string, unknown>
      if (typeof p === 'object' && p !== null) return p as Record<string, unknown>
      return {}
    } catch {
      return {}
    }
  }, [inputJson])

  const envVarNames = useMemo(() => Object.keys(envVars), [envVars])
  const inputKeys = useMemo(() => Object.keys(inputData), [inputData])

  const usedEnvVars = useMemo(() => {
    const allTemplates = [url, ...headers.map(h => h.value), ...params.map(p => p.value), body]
    const seen = new Map<string, string | null>()
    allTemplates.forEach(template => {
      parseTemplate(template, envVars, inputData).forEach(tok => {
        if (tok.type === 'env' && !seen.has(tok.name)) seen.set(tok.name, tok.resolved)
      })
    })
    return Array.from(seen.entries()).map(([name, resolved]) => ({ name, resolved }))
  }, [url, headers, params, body, envVars, inputData])

  // URL preview tokens
  const urlTokens = useMemo(
    () => hasVars(url) ? parseTemplate(url, envVars, inputData) : [],
    [url, envVars, inputData],
  )

  // Body vars summary: collect all tokens that are env/input
  const bodyTokens = useMemo(
    () => hasVars(body) ? parseTemplate(body, envVars, inputData) : [],
    [body, envVars, inputData],
  )
  const bodyVarTokens = useMemo(
    () => bodyTokens.filter(t => t.type !== 'text'),
    [bodyTokens],
  )

  const handleHover = useCallback((text: string | null, domRect?: DOMRect) => {
    if (!text || !domRect) { setTooltip(null); return }
    setTooltip({ text, x: domRect.left + domRect.width / 2, y: domRect.top - 6 })
  }, [])

  const onHeaderDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    dragRef.current = { ox: e.clientX - rect.x, oy: e.clientY - rect.y }
  }, [rect])

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

  // Test API call (resolves vars before sending)
  const handleTest = async () => {
    if (!url.trim()) return
    setTesting(true)
    setTestResponse(null)
    setTestStatus(null)
    setTestError(null)
    const t0 = Date.now()
    try {
      let fullUrl = resolveTemplate(url.trim(), envVars, inputData)
      const enabledParams = params.filter(p => p.enabled && p.key)
      if (enabledParams.length > 0) {
        const qs = new URLSearchParams(enabledParams.map(p => [p.key, resolveTemplate(p.value, envVars, inputData)]))
        fullUrl += (fullUrl.includes('?') ? '&' : '?') + qs.toString()
      }
      const hdrs: Record<string, string> = {}
      headers.filter(h => h.enabled && h.key).forEach(h => {
        hdrs[h.key] = resolveTemplate(h.value, envVars, inputData)
      })
      const opts: RequestInit = { method, headers: hdrs }
      if (hasBody(method) && body.trim()) {
        if (bodyType === 'json' && !hdrs['Content-Type'] && !hdrs['content-type']) {
          hdrs['Content-Type'] = 'application/json'
        }
        opts.body = resolveTemplate(body, envVars, inputData)
      }
      const res = await fetch(fullUrl, opts)
      const ms = Date.now() - t0
      const text = await res.text()
      setTestStatus({ code: res.status, text: res.statusText, ms })
      try {
        setTestResponse(JSON.stringify(JSON.parse(text), null, 2))
      } catch {
        setTestResponse(text)
      }
    } catch (err) {
      setTestError(String(err))
    } finally {
      setTesting(false)
    }
  }

  const handleFormatInput = () => {
    const result = formatJson(inputJson)
    setInputJson(result.value); setInputError(result.error)
  }

  const handleFormatBody = () => {
    const result = formatJson(body)
    setBody(result.value)
  }

  const handleSave = async () => {
    setSaving(true)
    const config: ApiConfig = {
      method, url: url.trim(), headers, params, body, bodyType,
      preScript: preScript ?? '',
      postScript: postScript ?? '',
    }
    await onSave(node.id, label.trim() || 'API', JSON.stringify(config))
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
      <div className="dm-modal" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}>
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
            <button className="btn ghost icon dm-close-btn" onClick={onClose}><IcoX size={13} /></button>
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
                    {onRun && (
                      <button
                        className="btn ghost icon dm-format-btn dm-run-btn"
                        onClick={async () => {
                          const out = await onRun()
                          setInputJson(out)
                          setInputError(false)
                        }}
                        title="상류 노드를 실행해 데이터 미리보기"
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
                  <textarea
                    className={`dm-json-area${inputError ? ' dm-json-area-error' : ''}`}
                    value={inputJson}
                    onChange={e => { setInputJson(e.target.value); setInputError(false) }}
                    placeholder="{}"
                    spellCheck={false}
                  />
                </div>
              </div>

              <div className="dm-splitter-h" onMouseDown={e => onHSplitterDown('inputPre', e)} />

              <div className="dm-pane" style={{ flex: '1 1 0', minHeight: 0 }}>
                <div className="dm-pane-hd">
                  <span className="dm-pane-label dm-pane-label-pre">PRE REQUEST</span>
                  <span className="dm-pane-type">JavaScript</span>
                </div>
                <div className="dm-pane-body dm-pane-body-monaco">
                  <Suspense fallback={<MonacoFallback />}>
                    <MonacoEditor
                      height="100%"
                      language="javascript"
                      theme="vs-dark"
                      value={preScript}
                      onChange={(v: string | undefined) => setPreScript(v ?? '')}
                      options={MONACO_OPTIONS}
                    />
                  </Suspense>
                </div>
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
                    value={label}
                    onChange={e => setLabel(e.target.value)}
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
                  {(['headers', 'params', 'body'] as SettingsTab[]).map(tab => (
                    <button
                      key={tab}
                      className={`api-tab${activeTab === tab ? ' api-tab-active' : ''}${tab === 'body' && !hasBody(method) ? ' api-tab-disabled' : ''}`}
                      onClick={() => { if (tab !== 'body' || hasBody(method)) setActiveTab(tab) }}
                    >
                      {tab === 'headers' ? 'HEADERS' : tab === 'params' ? 'PARAMS' : 'BODY'}
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
                      <button
                        className="btn ghost icon dm-format-btn"
                        style={{ width: 20, height: 20 }}
                        onClick={handleFormatBody}
                        title="JSON 정렬"
                      >
                        <FormatIcon />
                      </button>
                    </div>
                    <AutocompleteField
                      multiline
                      value={body}
                      onChange={setBody}
                      envVarNames={envVarNames}
                      inputKeys={inputKeys}
                      className="dm-json-area api-body-area"
                      placeholder='{"key": "value"}'
                      spellCheck={false}
                    />
                  </div>
                )}

                {usedEnvVars.length > 0 && (
                  <div className="dm-field">
                    <label className="dm-field-label">사용된 환경변수</label>
                    <table className="api-env-vars-table">
                      <thead>
                        <tr>
                          <th>변수</th>
                          <th>적용 값</th>
                        </tr>
                      </thead>
                      <tbody>
                        {usedEnvVars.map(({ name, resolved }) => (
                          <tr key={name}>
                            <td>
                              <span className={`api-var-token${resolved !== null ? ' api-var-ok' : ' api-var-err'}`}>{`{{${name}}}`}</span>
                            </td>
                            <td className={resolved !== null ? 'api-env-val-ok' : 'api-env-val-err'}>
                              {resolved !== null ? resolved : '미설정'}
                            </td>
                          </tr>
                        ))}
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
                  <span className="dm-pane-label api-pane-label-output">OUTPUT</span>
                  <div className="dm-pane-hd-actions">
                    {testStatus && (
                      <span
                        className="api-status-badge"
                        style={{ color: statusColor ?? undefined, borderColor: `${statusColor}44` }}
                      >
                        {testStatus.code} · {testStatus.ms}ms
                      </span>
                    )}
                    <span className="dm-pane-type">JSON</span>
                  </div>
                </div>
                <div className="dm-pane-body">
                  <textarea
                    className="dm-json-area api-json-area-output"
                    value={testError ?? testResponse ?? ''}
                    readOnly
                    placeholder={url.trim() ? 'INPUT 패널의 → 버튼으로 API를 실행하세요' : 'URL을 입력하세요'}
                    spellCheck={false}
                  />
                </div>
              </div>

              <div className="dm-splitter-h" onMouseDown={e => onHSplitterDown('outputPost', e)} />

              <div className="dm-pane" style={{ flex: '1 1 0', minHeight: 0 }}>
                <div className="dm-pane-hd">
                  <span className="dm-pane-label dm-pane-label-post">POST RESPONSE</span>
                  <span className="dm-pane-type">JavaScript</span>
                </div>
                <div className="dm-pane-body dm-pane-body-monaco">
                  <Suspense fallback={<MonacoFallback />}>
                    <MonacoEditor
                      height="100%"
                      language="javascript"
                      theme="vs-dark"
                      value={postScript}
                      onChange={(v: string | undefined) => setPostScript(v ?? '')}
                      options={MONACO_OPTIONS}
                    />
                  </Suspense>
                </div>
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
                <span className="dm-delete-warn">⚠ {node.moduleId ? '캔버스에서 노드만 제거됩니다. 모듈은 유지됩니다.' : '이 노드가 삭제됩니다.'}</span>
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
                  {saving ? '저장 중…' : '저장'}
                </button>
              </>
            )}
          </div>

        </div>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="api-var-tooltip"
          style={{ left: tooltip.x, top: tooltip.y, transform: 'translate(-50%, -100%)' }}
        >
          {tooltip.text}
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
