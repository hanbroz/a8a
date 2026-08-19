import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { IcoMaximize, IcoRestore, IcoX } from '../Icon'
import { HighlightedText, JsonCopyButton, normalizeSearchQuery } from './JsonInspector'
import { useI18n } from '../../i18n'
import { useEscapeClose } from '../../hooks/useEscapeClose'

interface Props {
  data: unknown
  storageKey?: string
  initialSelectedRowIndices?: number[]
  initialSelectedJsonPaths?: string[]
  initialMode?: 'table' | 'json'
  selectionType?: 'multiple' | 'single'
  preferInitialSelection?: boolean
  onConfirm: (selectedValues: unknown[], selection: SelectionPopupSelection) => void
  onCancel: () => void
}

type JsonPathPart = string | number

export type SelectionPopupSelection =
  | { mode: 'table'; selectedRowIndices: number[] }
  | { mode: 'json'; selectedJsonPaths: string[] }

type JsonNode = {
  id: string
  path: string
  key: string
  value: unknown
  depth: number
  type: string
  parts: JsonPathPart[]
  hasChildren: boolean
  selectable: boolean
}

const SIZE_KEY = 'selection-popup-size'
const STATE_KEY_PREFIX = 'selection-popup-state:'
const MIN_W = 560
const MIN_H = 360

type SavedSelectionPopupState = {
  mode?: 'table' | 'json'
  selectedRowIndices?: number[]
  selectedJsonPaths?: string[]
  expandedJsonPaths?: string[]
}

function getTableRows(data: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(data) || data.length === 0) return null
  if (typeof data[0] !== 'object' || data[0] === null || Array.isArray(data[0])) return null
  return data as Record<string, unknown>[]
}

function readSavedSize(): { w: number; h: number } {
  try {
    const parsed = JSON.parse(localStorage.getItem(SIZE_KEY) ?? '{}') as Partial<{ w: number; h: number }>
    const w = Number.isFinite(parsed.w) ? parsed.w! : 820
    const h = Number.isFinite(parsed.h) ? parsed.h! : 520
    return {
      w: Math.max(MIN_W, Math.min(window.innerWidth - 24, w)),
      h: Math.max(MIN_H, Math.min(window.innerHeight - 24, h)),
    }
  } catch {
    return { w: 820, h: 520 }
  }
}

function saveSize(size: { w: number; h: number }): void {
  localStorage.setItem(SIZE_KEY, JSON.stringify(size))
}

function stateStorageKey(storageKey: string): string {
  return `${STATE_KEY_PREFIX}${storageKey}`
}

function readSavedState(storageKey?: string): SavedSelectionPopupState | null {
  if (!storageKey) return null
  try {
    const parsed = JSON.parse(localStorage.getItem(stateStorageKey(storageKey)) ?? '{}') as Partial<SavedSelectionPopupState>
    return {
      mode: parsed.mode === 'table' || parsed.mode === 'json' ? parsed.mode : undefined,
      selectedRowIndices: Array.isArray(parsed.selectedRowIndices)
        ? parsed.selectedRowIndices.filter(index => Number.isInteger(index) && index >= 0)
        : undefined,
      selectedJsonPaths: Array.isArray(parsed.selectedJsonPaths)
        ? parsed.selectedJsonPaths.filter((path): path is string => typeof path === 'string')
        : undefined,
      expandedJsonPaths: Array.isArray(parsed.expandedJsonPaths)
        ? parsed.expandedJsonPaths.filter((path): path is string => typeof path === 'string')
        : undefined,
    }
  } catch {
    return null
  }
}

function saveState(storageKey: string | undefined, state: SavedSelectionPopupState): void {
  if (!storageKey) return
  try {
    localStorage.setItem(stateStorageKey(storageKey), JSON.stringify(state))
  } catch {
    // localStorage 저장 실패는 선택 동작을 막지 않는다.
  }
}

function valueType(value: unknown): string {
  if (Array.isArray(value)) return 'array'
  if (value === null) return 'null'
  return typeof value
}

function isContainer(value: unknown): boolean {
  return Array.isArray(value) || (typeof value === 'object' && value !== null)
}

function valuePreview(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return `[${value.length}]`
  if (typeof value === 'object') return `{${Object.keys(value as Record<string, unknown>).length}}`
  return String(value)
}

function childPath(parentPath: string, key: JsonPathPart): string {
  if (typeof key === 'number') return `${parentPath}[${key}]`
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${parentPath}.${key}` : `${parentPath}[${JSON.stringify(key)}]`
}

function cloneJsonValue(value: unknown): unknown {
  if (!isContainer(value)) return value
  return JSON.parse(JSON.stringify(value)) as unknown
}

function flattenJson(value: unknown, path = '$', key = '$', depth = 0, parts: JsonPathPart[] = []): JsonNode[] {
  const hasChildren = isContainer(value) && (
    Array.isArray(value)
      ? value.length > 0
      : Object.keys(value as Record<string, unknown>).length > 0
  )
  const current: JsonNode = {
    id: path,
    path,
    key,
    value,
    depth,
    type: valueType(value),
    parts,
    hasChildren,
    selectable: true,
  }

  if (Array.isArray(value)) {
    return [
      current,
      ...value.flatMap((item, index) =>
        flattenJson(item, childPath(path, index), `[${index}]`, depth + 1, [...parts, index]),
      ),
    ]
  }

  if (value && typeof value === 'object') {
    return [
      current,
      ...Object.entries(value as Record<string, unknown>).flatMap(([childKey, childValue]) =>
        flattenJson(childValue, childPath(path, childKey), childKey, depth + 1, [...parts, childKey]),
      ),
    ]
  }

  return [current]
}

function getVisibleNodes(nodes: JsonNode[], expandedIds: Set<string>): JsonNode[] {
  return nodes.filter(node => {
    if (node.depth === 0) return true
    const parentParts = node.parts.slice(0, -1)
    let path = '$'
    if (!expandedIds.has(path)) return false
    for (const part of parentParts) {
      path = childPath(path, part)
      if (!expandedIds.has(path)) return false
    }
    return true
  })
}

function expandedIdsForSelectedNodes(nodes: JsonNode[], selectedIds: Set<string>): Set<string> {
  const expanded = new Set<string>()
  nodes.forEach(node => {
    if (!selectedIds.has(node.id)) return
    expanded.add('$')
    let path = '$'
    node.parts.slice(0, -1).forEach(part => {
      path = childPath(path, part)
      expanded.add(path)
    })
  })
  return expanded
}

function nodeMatchesQuery(node: JsonNode, normalizedQuery: string): boolean {
  return [node.key, node.path, valuePreview(node.value)].some(text =>
    text.toLowerCase().includes(normalizedQuery),
  )
}

function rowMatchesQuery(row: Record<string, unknown>, columns: string[], normalizedQuery: string): boolean {
  return columns.some(col => String(row[col] ?? '').toLowerCase().includes(normalizedQuery))
}

export default function SelectionPopup({
  data,
  storageKey,
  initialSelectedRowIndices = [],
  initialSelectedJsonPaths = [],
  initialMode,
  selectionType = 'multiple',
  preferInitialSelection = false,
  onConfirm,
  onCancel,
}: Props): JSX.Element {
  const { t } = useI18n()
  useEscapeClose(onCancel)
  const tableRows = getTableRows(data)
  const canUseTable = tableRows !== null
  const jsonData = tableRows && tableRows.length === 1 ? tableRows[0] : data
  // 아래 계산은 입력값과 무관한데도 리렌더마다 다시 돌면 큰 JSON에서 검색어를 한 글자
  // 칠 때마다 창이 멈춘다. 데이터가 바뀔 때만 계산하도록 묶는다.
  const jsonNodes = useMemo(() => flattenJson(jsonData), [jsonData])
  const columns = useMemo(
    () => tableRows && tableRows.length > 0 ? Object.keys(tableRows[0]) : [],
    [tableRows],
  )
  const initialSetup = useMemo(() => {
    const savedState = readSavedState(storageKey)
    const savedSelectedJsonPaths = preferInitialSelection ? [] : savedState?.selectedJsonPaths ?? []
    const configuredJsonPaths = savedSelectedJsonPaths.length > 0 ? savedSelectedJsonPaths : initialSelectedJsonPaths
    // 경로마다 jsonNodes를 전수 스캔하면 O(경로 x 노드)가 된다. Set으로 한 번만 색인한다.
    const selectableIds = new Set(jsonNodes.filter(node => node.selectable).map(node => node.id))
    const expandableIds = new Set(jsonNodes.filter(node => node.hasChildren).map(node => node.id))
    const jsonPaths = configuredJsonPaths.filter(path => selectableIds.has(path))
    const savedSelectedRowIndices = preferInitialSelection ? [] : savedState?.selectedRowIndices ?? []
    const configuredRowIndices = savedSelectedRowIndices.length > 0 ? savedSelectedRowIndices : initialSelectedRowIndices
    return {
      savedState,
      jsonNodeIds: new Set(selectionType === 'single' ? jsonPaths.slice(0, 1) : jsonPaths),
      tableIndices: canUseTable
        ? configuredRowIndices.filter(index => index >= 0 && index < tableRows.length)
        : [],
      savedExpandedIds: new Set((savedState?.expandedJsonPaths ?? []).filter(path => expandableIds.has(path))),
      hasSavedExpandedIds: savedState?.expandedJsonPaths !== undefined,
    }
  }, [canUseTable, initialSelectedJsonPaths, initialSelectedRowIndices, jsonNodes, preferInitialSelection, selectionType, storageKey, tableRows])

  const [mode, setMode] = useState<'table' | 'json'>(() => {
    const savedState = initialSetup.savedState
    if (!preferInitialSelection && savedState?.mode === 'json') return 'json'
    if (!preferInitialSelection && savedState?.mode === 'table' && canUseTable) return 'table'
    if (initialMode === 'json' && initialSetup.jsonNodeIds.size > 0) return 'json'
    if (initialMode === 'table' && canUseTable) return 'table'
    if (savedState?.mode === 'json') return 'json'
    if (savedState?.mode === 'table' && canUseTable) return 'table'
    if (initialSetup.jsonNodeIds.size > 0) return 'json'
    return canUseTable && tableRows.length > 1 ? 'table' : 'json'
  })
  const [selectedIndices, setSelectedIndices] = useState<number[]>(() =>
    selectionType === 'single' ? initialSetup.tableIndices.slice(0, 1) : initialSetup.tableIndices,
  )
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(() => initialSetup.jsonNodeIds)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() =>
    initialSetup.hasSavedExpandedIds
      ? initialSetup.savedExpandedIds
      : expandedIdsForSelectedNodes(jsonNodes, initialSetup.jsonNodeIds),
  )
  const [size, setSize] = useState(readSavedSize)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [isMaximized, setIsMaximized] = useState(false)
  // 입력 중인 검색어는 state가 아니라 input DOM에만 둔다(비제어). state로 두면 한 글자마다
  // 리렌더가 일어나 화면에 떠 있는 트리 행 전체가 다시 그려지고, 큰 JSON에서 그대로 프리징이
  // 된다. Enter를 누르는 순간에만 ref에서 값을 읽어 appliedQuery에 반영한다.
  const [appliedQuery, setAppliedQuery] = useState('')
  const [activeSearchIndex, setActiveSearchIndex] = useState(0)
  const dragRef = useRef<{ ox: number; oy: number } | null>(null)
  const modalRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const scrolledMatchRef = useRef<string | null>(null)

  const selectedJsonNodes = Array.from(selectedNodeIds)
    .map(nodeId => jsonNodes.find(node => node.id === nodeId && node.selectable))
    .filter((node): node is JsonNode => !!node)
  const visibleJsonNodes = useMemo(() => getVisibleNodes(jsonNodes, expandedIds), [expandedIds, jsonNodes])

  const showTable = mode === 'table' && tableRows !== null
  const normalizedQuery = normalizeSearchQuery(appliedQuery)
  const matchedNodeIds = useMemo(
    () => normalizedQuery && !showTable
      ? jsonNodes.filter(node => nodeMatchesQuery(node, normalizedQuery)).map(node => node.id)
      : [],
    [jsonNodes, normalizedQuery, showTable],
  )
  const matchedRowIndices = useMemo(
    () => normalizedQuery && showTable && tableRows
      ? tableRows.flatMap((row, index) => rowMatchesQuery(row, columns, normalizedQuery) ? [index] : [])
      : [],
    [columns, normalizedQuery, showTable, tableRows],
  )
  // 렌더 루프 안에서 includes()로 훑으면 행/노드 수 × 매치 수가 되므로 Set으로 조회한다.
  const matchedNodeIdSet = useMemo(() => new Set(matchedNodeIds), [matchedNodeIds])
  const matchedRowIndexSet = useMemo(() => new Set(matchedRowIndices), [matchedRowIndices])
  const searchCount = showTable ? matchedRowIndices.length : matchedNodeIds.length
  const visibleSearchIndex = searchCount > 0 ? Math.min(activeSearchIndex, searchCount - 1) : 0
  const activeMatchNodeId = showTable ? undefined : matchedNodeIds[visibleSearchIndex]
  const activeMatchRowIndex = showTable ? matchedRowIndices[visibleSearchIndex] : undefined

  const moveSearch = (delta: number): void => {
    if (searchCount === 0) return
    setActiveSearchIndex(index => (index + delta + searchCount) % searchCount)
  }

  // 검색어가 그대로면 다시 찾지 않고 다음(또는 이전) 결과로 넘어간다.
  const applySearch = (direction = 1): void => {
    const typed = searchInputRef.current?.value ?? ''
    if (normalizeSearchQuery(typed) === normalizedQuery) {
      moveSearch(direction)
      return
    }
    setAppliedQuery(typed)
  }

  const clearSearch = (): void => {
    if (searchInputRef.current) searchInputRef.current.value = ''
    setAppliedQuery('')
  }

  useEffect(() => {
    setActiveSearchIndex(0)
  }, [mode, normalizedQuery])

  // 매치된 노드 전부를 펼치면 큰 JSON에서 트리가 통째로 열려 수만 줄이 렌더된다.
  // 지금 보고 있는 매치의 조상 경로만 펼치고, 나머지는 이동할 때 그때그때 펼친다.
  useEffect(() => {
    if (!activeMatchNodeId) return
    const needed = expandedIdsForSelectedNodes(jsonNodes, new Set([activeMatchNodeId]))
    setExpandedIds(prev => {
      const missing = Array.from(needed).filter(id => !prev.has(id))
      if (missing.length === 0) return prev
      const next = new Set(prev)
      missing.forEach(id => next.add(id))
      return next
    })
  }, [activeMatchNodeId, jsonNodes])

  // 매치 하나당 한 번만 스크롤한다. expandedIds를 의존성에 넣는 이유는 접힌 노드가
  // 펼쳐진 뒤에야 대상이 DOM에 나타나기 때문이며, ref 가드가 없으면 사용자가 무관한
  // 노드를 접고 펼 때마다 화면이 매치 위치로 되돌아간다.
  useEffect(() => {
    if (activeMatchNodeId === undefined && activeMatchRowIndex === undefined) {
      scrolledMatchRef.current = null
      return
    }
    const matchKey = showTable ? `row:${activeMatchRowIndex}` : `node:${activeMatchNodeId}`
    if (scrolledMatchRef.current === matchKey) return
    const target = bodyRef.current?.querySelector('.json-inspector-search-active')
    if (!target) return
    scrolledMatchRef.current = matchKey
    target.scrollIntoView({ block: 'center', inline: 'nearest' })
  }, [activeMatchNodeId, activeMatchRowIndex, expandedIds, showTable])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'f') return
      e.preventDefault()
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (pos === null) {
      setPos({
        x: Math.max(0, (window.innerWidth - size.w) / 2),
        y: Math.max(0, (window.innerHeight - size.h) / 2),
      })
    }
  }, [pos, size.h, size.w])

  useEffect(() => {
    saveState(storageKey, {
      mode,
      selectedRowIndices: selectedIndices,
      selectedJsonPaths: Array.from(selectedNodeIds),
      expandedJsonPaths: Array.from(expandedIds),
    })
  }, [expandedIds, mode, selectedIndices, selectedNodeIds, storageKey])

  const onHeaderDown = useCallback((e: React.MouseEvent) => {
    if (isMaximized) return
    if (!pos) return
    e.preventDefault()
    dragRef.current = { ox: e.clientX - pos.x, oy: e.clientY - pos.y }

    const onMove = (me: MouseEvent) => {
      if (!dragRef.current) return
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - size.w, me.clientX - dragRef.current.ox)),
        y: Math.max(0, Math.min(window.innerHeight - size.h, me.clientY - dragRef.current.oy)),
      })
    }
    const onUp = () => {
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [isMaximized, pos, size.h, size.w])

  const onResizeDown = useCallback((e: React.MouseEvent) => {
    if (isMaximized) return
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startY = e.clientY
    const startSize = size
    let latest = startSize

    const onMove = (me: MouseEvent) => {
      latest = {
        w: Math.max(MIN_W, Math.min(window.innerWidth - (pos?.x ?? 0), startSize.w + me.clientX - startX)),
        h: Math.max(MIN_H, Math.min(window.innerHeight - (pos?.y ?? 0), startSize.h + me.clientY - startY)),
      }
      setSize(latest)
    }
    const onUp = () => {
      saveSize(latest)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [isMaximized, pos?.x, pos?.y, size])

  const toggleMaximized = useCallback(() => {
    setIsMaximized(prev => !prev)
  }, [])

  const toggleRow = (idx: number) => {
    setSelectedIndices(prev => {
      if (selectionType === 'single') return prev.includes(idx) ? [] : [idx]
      return prev.includes(idx) ? prev.filter(item => item !== idx) : [...prev, idx]
    })
  }

  const toggleExpanded = (nodeId: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(nodeId)) next.delete(nodeId)
      else next.add(nodeId)
      return next
    })
  }

  const toggleJsonNode = (node: JsonNode) => {
    if (!node.selectable) {
      if (node.hasChildren) toggleExpanded(node.id)
      return
    }
    setSelectedNodeIds(prev => {
      if (selectionType === 'single') return prev.has(node.id) ? new Set<string>() : new Set([node.id])
      const next = new Set(prev)
      if (next.has(node.id)) next.delete(node.id)
      else next.add(node.id)
      return next
    })
  }

  const handleConfirm = () => {
    if (mode === 'table' && tableRows) {
      if (selectedIndices.length === 0) return
      const selectedRows = selectedIndices
        .map(index => tableRows[index])
        .filter((row): row is Record<string, unknown> => row !== undefined)
      onConfirm(selectedRows, { mode: 'table', selectedRowIndices: selectedIndices })
      return
    }
    if (selectedJsonNodes.length === 0) return
    onConfirm(
      selectedJsonNodes.map(node => cloneJsonValue(node.value)),
      { mode: 'json', selectedJsonPaths: selectedJsonNodes.map(node => node.id) },
    )
  }

  const hasSelection = mode === 'table' && tableRows ? selectedIndices.length > 0 : selectedJsonNodes.length > 0

  // ponytail: ref keeps the listener registered once — `pos` changes every
  // mousemove while dragging, so depending on handleConfirm would re-register
  // per frame. handleConfirm already no-ops when nothing is selected.
  const confirmRef = useRef(handleConfirm)
  confirmRef.current = handleConfirm

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Enter' || e.repeat || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return
      const el = e.target as HTMLElement | null
      if (el && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return
      e.preventDefault()
      confirmRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const modalStyle: React.CSSProperties = isMaximized
    ? { position: 'fixed', left: 12, top: 12, width: 'calc(100vw - 24px)', height: 'calc(100vh - 24px)', margin: 0 }
    : pos
      ? { position: 'fixed', left: pos.x, top: pos.y, width: size.w, height: size.h, margin: 0 }
      : { position: 'fixed', left: '50%', top: '50%', width: size.w, height: size.h, transform: 'translate(-50%, -50%)', margin: 0 }

  return (
    <div className="sp-overlay" style={{ pointerEvents: 'none' }}>
      <div
        ref={modalRef}
        className={`sp-modal${isMaximized ? ' sp-modal-maximized' : ''}`}
        style={{ ...modalStyle, pointerEvents: 'all' }}
      >
        <div className="sp-hd" style={{ cursor: isMaximized ? 'default' : 'move' }} onMouseDown={onHeaderDown}>
          <div className="sp-hd-left">
            <span className="sp-title">{mode === 'table' ? t('module.selection.title.table') : t('module.selection.title.json')}</span>
            <span className="sp-subtitle">
              {mode === 'table'
                ? selectionType === 'single' ? t('module.selection.subtitle.tableSingle') : t('module.selection.subtitle.tableMultiple')
                : selectionType === 'single' ? t('module.selection.subtitle.jsonSingle') : t('module.selection.subtitle.jsonMultiple')}
            </span>
          </div>
          <div className="sp-hd-actions" onMouseDown={e => e.stopPropagation()}>
            {canUseTable && (
              <div className="sm-view-toggle">
                <button
                  className={`sm-view-btn${mode === 'table' ? ' active' : ''}`}
                  onClick={() => setMode('table')}
                >
                  Table
                </button>
                <button
                  className={`sm-view-btn${mode === 'json' ? ' active' : ''}`}
                  onClick={() => setMode('json')}
                >
                  JSON
                </button>
              </div>
            )}
            <button
              className="btn ghost icon dm-window-btn"
              onClick={toggleMaximized}
              title={isMaximized ? t('module.common.restoreWindow') : t('module.common.maximizeWindow')}
              aria-label={isMaximized ? t('module.common.restoreWindow') : t('module.common.maximizeWindow')}
            >
              {isMaximized ? <IcoRestore size={13} /> : <IcoMaximize size={13} />}
            </button>
            <button className="btn ghost icon dm-close-btn" onClick={onCancel}>
              <IcoX size={13} />
            </button>
          </div>
        </div>

        <div className="sp-search-bar">
          <div className="json-inspector-search">
            <input
              ref={searchInputRef}
              defaultValue=""
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  applySearch(e.shiftKey ? -1 : 1)
                }
                if (e.key === 'Escape') {
                  // 검색어만 지운다. 팝업까지 닫히지 않게 전파를 끊는다.
                  e.preventDefault()
                  e.stopPropagation()
                  clearSearch()
                }
              }}
              placeholder={t('module.common.searchEnterHint')}
              aria-label={t('module.common.searchPlaceholder')}
            />
            <span className="json-inspector-search-count">
              {normalizedQuery ? `${searchCount > 0 ? visibleSearchIndex + 1 : 0}/${searchCount}` : '0/0'}
            </span>
            <button type="button" onClick={() => moveSearch(-1)} disabled={searchCount === 0} title={t('module.common.searchPrev')} aria-label={t('module.common.searchPrev')}>&lt;</button>
            <button type="button" onClick={() => moveSearch(1)} disabled={searchCount === 0} title={t('module.common.searchNext')} aria-label={t('module.common.searchNext')}>&gt;</button>
            <button type="button" onClick={clearSearch} title={t('module.common.searchClear')} aria-label={t('module.common.searchClear')}>
              <IcoX size={11} />
            </button>
          </div>
        </div>

        <div className="sp-body" ref={bodyRef}>
          {mode === 'table' && tableRows ? (
            <div className="sm-input-table">
              <table>
                <thead>
                  <tr>
                    <th></th>
                    {columns.map(col => <th key={col}>{col}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((row, idx) => {
                    const isChecked = selectedIndices.includes(idx)
                    const isMatch = matchedRowIndexSet.has(idx)
                    return (
                      <tr
                        key={idx}
                        className={`${isChecked ? 'sm-row-checked' : ''}${isMatch ? ' json-inspector-search-match' : ''}${idx === activeMatchRowIndex ? ' json-inspector-search-active' : ''}`}
                        onClick={() => toggleRow(idx)}
                      >
                        <td>
                          <div className={`sm-col-check${selectionType === 'single' ? ' sm-col-check-radio' : ''}${isChecked ? ' checked' : ''}`} />
                        </td>
                        {columns.map(col => (
                          <td key={col}><HighlightedText text={String(row[col] ?? '')} query={appliedQuery} /></td>
                        ))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="sp-json-tree">
              {visibleJsonNodes.map(node => {
                const selected = selectedNodeIds.has(node.id)
                const expanded = expandedIds.has(node.id)
                const isMatch = matchedNodeIdSet.has(node.id)
                return (
                  <div
                    key={node.id}
                    className={`sp-json-row${isMatch ? ' json-inspector-search-match' : ''}${node.id === activeMatchNodeId ? ' json-inspector-search-active' : ''}`}
                  >
                    <button
                      className={`sp-json-node${selected ? ' sp-json-node-selected' : ''}`}
                      style={{ paddingLeft: 12 + node.depth * 18 }}
                      onClick={() => toggleJsonNode(node)}
                    >
                      <span
                        className={`sp-json-expander${node.hasChildren ? ' sp-json-expander-visible' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          if (node.hasChildren) toggleExpanded(node.id)
                        }}
                      >
                        {node.hasChildren ? (expanded ? '-' : '+') : ''}
                      </span>
                      <span className={`sm-col-check${selectionType === 'single' ? ' sm-col-check-radio' : ''}${selected ? ' checked' : ''}`} />
                      <span className="sp-json-key"><HighlightedText text={node.key} query={appliedQuery} /></span>
                      <span className="sp-json-type">{node.type}</span>
                      <span className="sp-json-path"><HighlightedText text={node.path} query={appliedQuery} /></span>
                      <span className="sp-json-preview"><HighlightedText text={valuePreview(node.value)} query={appliedQuery} /></span>
                    </button>
                    <JsonCopyButton value={node.value} />
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="sp-ft">
          <span className="sp-count">
            {mode === 'table' && tableRows
              ? selectedIndices.length > 0 ? t('module.selection.rowsSelected', { count: selectedIndices.length }) : t('module.selection.noneSelected')
              : selectedJsonNodes.length > 0 ? t('module.selection.itemsSelected', { count: selectedJsonNodes.length }) : t('module.selection.noneSelected')}
          </span>
          <button className="btn ghost" onClick={onCancel}>{t('common.cancel')}</button>
          <button
            className="btn primary"
            onClick={handleConfirm}
            disabled={!hasSelection}
          >
            {t('module.selection.complete')}
          </button>
        </div>
        {!isMaximized && <div className="sp-resize-handle" onMouseDown={onResizeDown} />}
      </div>
    </div>
  )
}
