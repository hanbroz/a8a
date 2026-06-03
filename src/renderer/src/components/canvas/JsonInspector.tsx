import { Component, useEffect, useMemo, useRef, useState } from 'react'
import type { ErrorInfo, MouseEvent, ReactNode } from 'react'
import { IcoCopy, IcoMaximize, IcoX } from '../Icon'
import { useI18n } from '../../i18n'

type JsonInspectorMode = 'json' | 'tree' | 'ui'
type JsonPathPart = string | number
type JsonSearchMatch = { path: string }
type RawSearchMatch = { start: number; end: number }

type ParsedJsonSource =
  | { status: 'empty'; raw: string; value: null }
  | { status: 'valid'; raw: string; value: unknown }
  | { status: 'invalid'; raw: string; value: null }

interface JsonInspectorButtonProps {
  title: string
  value: unknown
  defaultMode?: JsonInspectorMode
  disabled?: boolean
}

interface JsonInspectorErrorBoundaryProps {
  children: ReactNode
  onError: () => void
}

interface JsonInspectorErrorBoundaryState {
  hasError: boolean
}

class JsonInspectorErrorBoundary extends Component<
  JsonInspectorErrorBoundaryProps,
  JsonInspectorErrorBoundaryState
> {
  state: JsonInspectorErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): JsonInspectorErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('JSON inspector render error', error, info)
    this.props.onError()
  }

  render(): ReactNode {
    if (this.state.hasError) return null
    return this.props.children
  }
}

function parseJsonSource(value: unknown): ParsedJsonSource {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return { status: 'empty', raw: '', value: null }
    try {
      const parsed = JSON.parse(trimmed) as unknown
      return { status: 'valid', raw: JSON.stringify(parsed, null, 2), value: parsed }
    } catch {
      return { status: 'invalid', raw: value, value: null }
    }
  }

  try {
    return { status: 'valid', raw: JSON.stringify(value ?? null, null, 2), value: value ?? null }
  } catch {
    return { status: 'invalid', raw: String(value), value: null }
  }
}

function jsonType(value: unknown): string {
  if (Array.isArray(value)) return 'array'
  if (value === null) return 'null'
  return typeof value
}

function isContainer(value: unknown): boolean {
  return Array.isArray(value) || (value !== null && typeof value === 'object')
}

function childPath(parent: string, key: JsonPathPart): string {
  if (typeof key === 'number') return `${parent}[${key}]`
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`
}

function previewValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.length}]`
  if (value && typeof value === 'object') return `{${Object.keys(value as Record<string, unknown>).length}}`
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === null) return 'null'
  return String(value)
}

function normalizeSearchQuery(query: string): string {
  return query.trim().toLowerCase()
}

function primitiveSearchValue(value: unknown): string {
  if (isContainer(value)) return previewValue(value)
  return copyTextForValue(value)
}

function textMatches(text: string, normalizedQuery: string): boolean {
  return !!normalizedQuery && text.toLowerCase().includes(normalizedQuery)
}

function nodeMatchesSearch(keyName: string, value: unknown, path: string, normalizedQuery: string): boolean {
  return [
    keyName,
    primitiveSearchValue(value),
    path,
  ].some(text => textMatches(text, normalizedQuery))
}

function collectJsonSearchMatches(
  value: unknown,
  normalizedQuery: string,
  keyName = '$',
  path = '$',
): JsonSearchMatch[] {
  if (!normalizedQuery) return []
  const current = nodeMatchesSearch(keyName, value, path, normalizedQuery) ? [{ path }] : []

  if (Array.isArray(value)) {
    return [
      ...current,
      ...value.flatMap((child, index) =>
        collectJsonSearchMatches(child, normalizedQuery, `[${index}]`, childPath(path, index)),
      ),
    ]
  }

  if (value && typeof value === 'object') {
    return [
      ...current,
      ...Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
        collectJsonSearchMatches(child, normalizedQuery, key, childPath(path, key)),
      ),
    ]
  }

  return current
}

function collectRawSearchMatches(text: string, normalizedQuery: string): RawSearchMatch[] {
  if (!normalizedQuery) return []
  const lower = text.toLowerCase()
  const matches: RawSearchMatch[] = []
  let start = lower.indexOf(normalizedQuery)

  while (start >= 0) {
    matches.push({ start, end: start + normalizedQuery.length })
    start = lower.indexOf(normalizedQuery, start + Math.max(1, normalizedQuery.length))
  }

  return matches
}

function isSameOrDescendantPath(path: string, ancestor: string): boolean {
  if (path === ancestor) return true
  if (ancestor === '$') return path.startsWith('$.') || path.startsWith('$[')
  return path.startsWith(`${ancestor}.`) || path.startsWith(`${ancestor}[`)
}

function hasSearchMatchInSubtree(path: string, matchedPaths: Set<string>): boolean {
  for (const matchedPath of matchedPaths) {
    if (isSameOrDescendantPath(matchedPath, path)) return true
  }
  return false
}

function HighlightedText({ text, query }: { text: string; query: string }): JSX.Element {
  const normalizedQuery = normalizeSearchQuery(query)
  if (!normalizedQuery) return <>{text}</>

  const parts: JSX.Element[] = []
  const lower = text.toLowerCase()
  let cursor = 0
  let index = lower.indexOf(normalizedQuery)

  while (index >= 0) {
    if (index > cursor) parts.push(<span key={`t-${cursor}`}>{text.slice(cursor, index)}</span>)
    parts.push(
      <mark key={`m-${index}`} className="json-inspector-search-mark">
        {text.slice(index, index + normalizedQuery.length)}
      </mark>,
    )
    cursor = index + normalizedQuery.length
    index = lower.indexOf(normalizedQuery, cursor)
  }

  if (cursor < text.length) parts.push(<span key={`t-${cursor}`}>{text.slice(cursor)}</span>)
  return <>{parts}</>
}

function HighlightedRawText({
  text,
  matches,
  activeIndex,
}: {
  text: string
  matches: RawSearchMatch[]
  activeIndex: number
}): JSX.Element {
  if (matches.length === 0) return <>{text}</>

  const parts: JSX.Element[] = []
  let cursor = 0

  matches.forEach((match, index) => {
    if (match.start > cursor) parts.push(<span key={`t-${cursor}`}>{text.slice(cursor, match.start)}</span>)
    parts.push(
      <mark
        key={`m-${match.start}`}
        className={`json-inspector-search-mark${index === activeIndex ? ' json-inspector-search-active-mark' : ''}`}
        data-json-inspector-match-index={index}
      >
        {text.slice(match.start, match.end)}
      </mark>,
    )
    cursor = match.end
  })

  if (cursor < text.length) parts.push(<span key={`t-${cursor}`}>{text.slice(cursor)}</span>)
  return <>{parts}</>
}

function copyTextForValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined) return 'undefined'

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // execCommand fallback keeps copy available in older Electron contexts.
    }
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  textarea.style.top = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()

  try {
    if (!document.execCommand('copy')) throw new Error('copy failed')
  } finally {
    document.body.removeChild(textarea)
  }
}

function JsonCopyButton({ value }: { value: unknown }): JSX.Element {
  const { t } = useI18n()
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')

  const handleCopy = async (e: MouseEvent): Promise<void> => {
    e.stopPropagation()
    try {
      await copyText(copyTextForValue(value))
      setState('copied')
    } catch {
      setState('failed')
    }
    window.setTimeout(() => setState('idle'), 1100)
  }

  const label = state === 'copied' ? t('common.copied') : state === 'failed' ? t('common.copyFailed') : t('module.common.copyValue')

  return (
    <button
      type="button"
      className={`json-inspector-copy${state !== 'idle' ? ` ${state}` : ''}`}
      onClick={handleCopy}
      title={label}
      aria-label={label}
    >
      <IcoCopy size={13} />
    </button>
  )
}

function JsonTreeNode({
  keyName,
  value,
  depth,
  path,
  searchQuery,
  matchedPaths,
  matchedPathKey,
  activePath,
}: {
  keyName: string
  value: unknown
  depth: number
  path: string
  searchQuery: string
  matchedPaths: Set<string>
  matchedPathKey: string
  activePath?: string
}): JSX.Element {
  const [open, setOpen] = useState(depth < 2)
  const normalizedSearchQuery = normalizeSearchQuery(searchQuery)
  const type = jsonType(value)
  const children = useMemo(() => {
    if (Array.isArray(value)) {
      return value.map((child, index) => ({ key: `[${index}]`, path: childPath(path, index), value: child }))
    }

    if (value && typeof value === 'object') {
      return Object.entries(value as Record<string, unknown>).map(([key, child]) => ({
        key,
        path: childPath(path, key),
        value: child,
      }))
    }

    return []
  }, [path, value])
  const hasChildren = children.length > 0
  const isSearchMatch = matchedPaths.has(path)
  const isActiveSearchMatch = activePath === path

  useEffect(() => {
    if (!open && hasChildren && normalizedSearchQuery && hasSearchMatchInSubtree(path, matchedPaths)) {
      setOpen(true)
    }
  }, [hasChildren, matchedPathKey, normalizedSearchQuery, open, path])

  return (
    <div className="json-inspector-tree-node">
      <div
        className={`json-inspector-tree-row${hasChildren ? ' has-children' : ''}${isSearchMatch ? ' json-inspector-search-match' : ''}${isActiveSearchMatch ? ' json-inspector-search-active' : ''}`}
        style={{ paddingLeft: 12 + depth * 16 }}
        onClick={() => { if (hasChildren) setOpen(prev => !prev) }}
      >
        <span className={`json-inspector-tree-expander${hasChildren ? ' visible' : ''}`}>
          {hasChildren ? (open ? '-' : '+') : ''}
        </span>
        <span className="json-inspector-tree-key"><HighlightedText text={keyName} query={searchQuery} /></span>
        <span className="json-inspector-tree-type">{type}</span>
        <span className="json-inspector-tree-path"><HighlightedText text={path} query={searchQuery} /></span>
        <span className="json-inspector-tree-preview"><HighlightedText text={previewValue(value)} query={searchQuery} /></span>
        <JsonCopyButton value={value} />
      </div>
      {hasChildren && open && (
        <div className="json-inspector-tree-children">
          {children.map(child => (
            <JsonTreeNode
              key={child.path}
              keyName={child.key}
              value={child.value}
              depth={depth + 1}
              path={child.path}
              searchQuery={searchQuery}
              matchedPaths={matchedPaths}
              matchedPathKey={matchedPathKey}
              activePath={activePath}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function JsonUiCard({
  keyName,
  value,
  path,
  searchQuery,
  matchedPaths,
  matchedPathKey,
  activePath,
}: {
  keyName: string
  value: unknown
  path: string
  searchQuery: string
  matchedPaths: Set<string>
  matchedPathKey: string
  activePath?: string
}): JSX.Element {
  const [open, setOpen] = useState(path === '$')
  const normalizedSearchQuery = normalizeSearchQuery(searchQuery)
  const type = jsonType(value)
  const isSearchMatch = matchedPaths.has(path)
  const isActiveSearchMatch = activePath === path
  const valueIsContainer = isContainer(value)

  useEffect(() => {
    if (!open && valueIsContainer && normalizedSearchQuery && hasSearchMatchInSubtree(path, matchedPaths)) {
      setOpen(true)
    }
  }, [matchedPathKey, normalizedSearchQuery, open, path, valueIsContainer])

  if (!valueIsContainer) {
    return (
      <div className={`json-inspector-card type-${type}${isSearchMatch ? ' json-inspector-search-match' : ''}${isActiveSearchMatch ? ' json-inspector-search-active' : ''}`}>
        <div className="json-inspector-card-hd">
          <span className="json-inspector-card-type">{type === 'string' ? 'T' : type === 'number' ? '#' : type === 'boolean' ? '?' : 'null'}</span>
          <span className="json-inspector-card-key" title={keyName}><HighlightedText text={keyName} query={searchQuery} /></span>
          <span className="json-inspector-card-path" title={path}><HighlightedText text={path} query={searchQuery} /></span>
          <JsonCopyButton value={value} />
        </div>
        <div className="json-inspector-card-value"><HighlightedText text={value === null ? 'null' : String(value)} query={searchQuery} /></div>
      </div>
    )
  }

  const entries = Array.isArray(value)
    ? value.map((child, index) => ({ key: `[${index}]`, value: child, path: childPath(path, index) }))
    : Object.entries(value as Record<string, unknown>).map(([key, child]) => ({ key, value: child, path: childPath(path, key) }))

  return (
    <div className="json-inspector-group">
      <button
        type="button"
        className={`json-inspector-group-hd${isSearchMatch ? ' json-inspector-search-match' : ''}${isActiveSearchMatch ? ' json-inspector-search-active' : ''}`}
        onClick={() => setOpen(prev => !prev)}
      >
        <span className="json-inspector-group-toggle">{open ? '-' : '+'}</span>
        <span className="json-inspector-group-type">{Array.isArray(value) ? '[]' : '{}'}</span>
        <span className="json-inspector-group-key" title={keyName}><HighlightedText text={keyName} query={searchQuery} /></span>
        <span className="json-inspector-group-count">{entries.length}</span>
        <span className="json-inspector-card-path" title={path}><HighlightedText text={path} query={searchQuery} /></span>
        <JsonCopyButton value={value} />
      </button>
      {open && (
        <div className="json-inspector-grid">
          {entries.map(entry => (
            <JsonUiCard
              key={entry.path}
              keyName={entry.key}
              value={entry.value}
              path={entry.path}
              searchQuery={searchQuery}
              matchedPaths={matchedPaths}
              matchedPathKey={matchedPathKey}
              activePath={activePath}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function JsonInspectorModal({
  title,
  value,
  defaultMode = 'json',
  onClose,
}: {
  title: string
  value: unknown
  defaultMode?: JsonInspectorMode
  onClose: () => void
}): JSX.Element {
  const { t } = useI18n()
  const parsed = useMemo(() => parseJsonSource(value), [value])
  const [mode, setMode] = useState<JsonInspectorMode>(() => parsed.status === 'valid' ? defaultMode : 'json')
  const [searchQuery, setSearchQuery] = useState('')
  const [activeSearchIndex, setActiveSearchIndex] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setMode(parsed.status === 'valid' ? defaultMode : 'json')
  }, [defaultMode, parsed.status])

  const canRenderStructured = parsed.status === 'valid'
  const normalizedSearchQuery = normalizeSearchQuery(searchQuery)
  const rawSearchText = parsed.raw || t('module.common.noValue')
  const rawMatches = useMemo(
    () => collectRawSearchMatches(rawSearchText, normalizedSearchQuery),
    [normalizedSearchQuery, rawSearchText],
  )
  const structuredMatches = useMemo(
    () => canRenderStructured ? collectJsonSearchMatches(parsed.value, normalizedSearchQuery) : [],
    [canRenderStructured, normalizedSearchQuery, parsed.value],
  )
  const structuredMatchedPaths = useMemo(
    () => new Set(structuredMatches.map(match => match.path)),
    [structuredMatches],
  )
  const matchedPathKey = useMemo(
    () => structuredMatches.map(match => match.path).join('\n'),
    [structuredMatches],
  )
  const currentSearchCount = mode === 'json' ? rawMatches.length : structuredMatches.length
  const visibleSearchIndex = currentSearchCount > 0
    ? Math.min(activeSearchIndex, currentSearchCount - 1)
    : 0
  const currentSearchLabel = normalizedSearchQuery
    ? `${currentSearchCount > 0 ? visibleSearchIndex + 1 : 0}/${currentSearchCount}`
    : '0/0'
  const activeSearchPath = mode === 'json' ? undefined : structuredMatches[visibleSearchIndex]?.path

  const moveSearch = (delta: number): void => {
    if (currentSearchCount === 0) return
    setActiveSearchIndex(index => (index + delta + currentSearchCount) % currentSearchCount)
  }

  useEffect(() => {
    setActiveSearchIndex(0)
  }, [mode, normalizedSearchQuery, parsed.raw, parsed.value])

  useEffect(() => {
    if (activeSearchIndex >= currentSearchCount) {
      setActiveSearchIndex(currentSearchCount > 0 ? currentSearchCount - 1 : 0)
    }
  }, [activeSearchIndex, currentSearchCount])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (!normalizedSearchQuery || currentSearchCount === 0) return
    const root = bodyRef.current
    if (!root) return
    const selector = mode === 'json'
      ? `[data-json-inspector-match-index="${visibleSearchIndex}"]`
      : '.json-inspector-search-active'
    const target = root.querySelector(selector)
    target?.scrollIntoView({ block: 'center', inline: 'nearest' })
  }, [currentSearchCount, mode, normalizedSearchQuery, visibleSearchIndex])

  return (
    <div className="json-inspector-overlay" role="dialog" aria-modal="true" aria-labelledby="json-inspector-title">
      <div className="json-inspector-modal">
        <div className="json-inspector-hd">
          <div>
            <div id="json-inspector-title" className="json-inspector-title">{title}</div>
            <div className="json-inspector-subtitle">
              {parsed.status === 'invalid'
                ? t('module.common.rawJsonInvalid')
                : parsed.raw
                  ? t('module.common.charCount', { count: parsed.raw.length.toLocaleString() })
                  : t('common.empty')}
            </div>
          </div>
          <button type="button" className="btn ghost icon json-inspector-close" onClick={onClose} title={t('common.close')} aria-label={t('common.close')}>
            <IcoX size={15} />
          </button>
        </div>

        <div className="json-inspector-tabs">
          <div className="json-inspector-tab-group">
            {(['json', 'tree', 'ui'] as const).map(tab => (
              <button
                key={tab}
                type="button"
                className={`json-inspector-tab${mode === tab ? ' active' : ''}`}
                onClick={() => setMode(tab)}
                disabled={tab !== 'json' && !canRenderStructured}
              >
                {tab === 'json' ? t('module.inspector.tab.json') : tab === 'tree' ? t('module.inspector.tab.tree') : t('module.inspector.tab.ui')}
              </button>
            ))}
          </div>
          <div className="json-inspector-search">
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  moveSearch(e.shiftKey ? -1 : 1)
                }
                if (e.key === 'Escape' && searchQuery) {
                  e.preventDefault()
                  setSearchQuery('')
                }
              }}
              placeholder={t('module.common.searchPlaceholder')}
              aria-label={t('module.common.searchPlaceholder')}
            />
            <span className="json-inspector-search-count">{currentSearchLabel}</span>
            <button type="button" onClick={() => moveSearch(-1)} disabled={currentSearchCount === 0} title={t('module.common.searchPrev')} aria-label={t('module.common.searchPrev')}>&lt;</button>
            <button type="button" onClick={() => moveSearch(1)} disabled={currentSearchCount === 0} title={t('module.common.searchNext')} aria-label={t('module.common.searchNext')}>&gt;</button>
            <button type="button" onClick={() => setSearchQuery('')} disabled={!searchQuery} title={t('module.common.searchClear')} aria-label={t('module.common.searchClear')}>
              <IcoX size={11} />
            </button>
          </div>
        </div>

        <div className="json-inspector-body" ref={bodyRef}>
          {mode === 'json' && (
            <pre className={`json-inspector-json${parsed.status === 'invalid' ? ' invalid' : ''}`}>
              <HighlightedRawText text={rawSearchText} matches={rawMatches} activeIndex={visibleSearchIndex} />
            </pre>
          )}
          {mode === 'tree' && canRenderStructured && (
            <div className="json-inspector-tree">
              <JsonTreeNode
                keyName="$"
                value={parsed.value}
                depth={0}
                path="$"
                searchQuery={searchQuery}
                matchedPaths={structuredMatchedPaths}
                matchedPathKey={matchedPathKey}
                activePath={activeSearchPath}
              />
            </div>
          )}
          {mode === 'ui' && canRenderStructured && (
            <div className="json-inspector-ui">
              <JsonUiCard
                keyName="$"
                value={parsed.value}
                path="$"
                searchQuery={searchQuery}
                matchedPaths={structuredMatchedPaths}
                matchedPathKey={matchedPathKey}
                activePath={activeSearchPath}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function JsonInspectorButton({
  title,
  value,
  defaultMode = 'json',
  disabled = false,
}: JsonInspectorButtonProps): JSX.Element {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        className="btn ghost icon dm-format-btn json-inspector-open-btn"
        onClick={(e) => {
          e.stopPropagation()
          setOpen(true)
        }}
        disabled={disabled}
        title={t('module.common.fullscreenView')}
        aria-label={t('module.common.fullscreenAria', { title })}
      >
        <IcoMaximize size={12} />
      </button>
      {open && (
        <JsonInspectorErrorBoundary onError={() => setOpen(false)}>
          <JsonInspectorModal
            title={title}
            value={value}
            defaultMode={defaultMode}
            onClose={() => setOpen(false)}
          />
        </JsonInspectorErrorBoundary>
      )}
    </>
  )
}
