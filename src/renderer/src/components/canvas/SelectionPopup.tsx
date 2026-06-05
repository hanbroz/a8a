import { useState, useRef, useEffect, useCallback } from 'react'
import { IcoMaximize, IcoRestore, IcoX } from '../Icon'
import { useI18n } from '../../i18n'

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
  const tableRows = getTableRows(data)
  const canUseTable = tableRows !== null
  const jsonData = tableRows && tableRows.length === 1 ? tableRows[0] : data
  const jsonNodes = flattenJson(jsonData)
  const columns = tableRows && tableRows.length > 0 ? Object.keys(tableRows[0]) : []
  const savedState = readSavedState(storageKey)
  const savedSelectedJsonPaths = preferInitialSelection ? [] : savedState?.selectedJsonPaths ?? []
  const configuredJsonPaths = savedSelectedJsonPaths.length > 0 ? savedSelectedJsonPaths : initialSelectedJsonPaths
  const initialJsonPaths = configuredJsonPaths.filter(path => jsonNodes.some(node => node.id === path && node.selectable))
  const initialJsonNodeIds = new Set(selectionType === 'single' ? initialJsonPaths.slice(0, 1) : initialJsonPaths)
  const savedSelectedRowIndices = preferInitialSelection ? [] : savedState?.selectedRowIndices ?? []
  const configuredRowIndices = savedSelectedRowIndices.length > 0 ? savedSelectedRowIndices : initialSelectedRowIndices
  const initialTableIndices = canUseTable
    ? configuredRowIndices.filter(index => index >= 0 && index < tableRows.length)
    : []
  const savedExpandedIds = new Set((savedState?.expandedJsonPaths ?? []).filter(path =>
    jsonNodes.some(node => node.id === path && node.hasChildren),
  ))
  const hasSavedExpandedIds = savedState?.expandedJsonPaths !== undefined

  const [mode, setMode] = useState<'table' | 'json'>(() => {
    if (!preferInitialSelection && savedState?.mode === 'json') return 'json'
    if (!preferInitialSelection && savedState?.mode === 'table' && canUseTable) return 'table'
    if (initialMode === 'json' && initialJsonNodeIds.size > 0) return 'json'
    if (initialMode === 'table' && canUseTable) return 'table'
    if (savedState?.mode === 'json') return 'json'
    if (savedState?.mode === 'table' && canUseTable) return 'table'
    if (initialJsonNodeIds.size > 0) return 'json'
    return canUseTable && tableRows.length > 1 ? 'table' : 'json'
  })
  const [selectedIndices, setSelectedIndices] = useState<number[]>(selectionType === 'single' ? initialTableIndices.slice(0, 1) : initialTableIndices)
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(() => initialJsonNodeIds)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() =>
    hasSavedExpandedIds ? savedExpandedIds : expandedIdsForSelectedNodes(jsonNodes, initialJsonNodeIds),
  )
  const [size, setSize] = useState(readSavedSize)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [isMaximized, setIsMaximized] = useState(false)
  const dragRef = useRef<{ ox: number; oy: number } | null>(null)
  const modalRef = useRef<HTMLDivElement>(null)

  const selectedJsonNodes = Array.from(selectedNodeIds)
    .map(nodeId => jsonNodes.find(node => node.id === nodeId && node.selectable))
    .filter((node): node is JsonNode => !!node)
  const visibleJsonNodes = getVisibleNodes(jsonNodes, expandedIds)

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

        <div className="sp-body">
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
                    return (
                      <tr
                        key={idx}
                        className={isChecked ? 'sm-row-checked' : ''}
                        onClick={() => toggleRow(idx)}
                      >
                        <td>
                          <div className={`sm-col-check${selectionType === 'single' ? ' sm-col-check-radio' : ''}${isChecked ? ' checked' : ''}`} />
                        </td>
                        {columns.map(col => (
                          <td key={col}>{String(row[col] ?? '')}</td>
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
                return (
                  <button
                    key={node.id}
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
                    <span className="sp-json-key">{node.key}</span>
                    <span className="sp-json-type">{node.type}</span>
                    <span className="sp-json-path">{node.path}</span>
                    <span className="sp-json-preview">{valuePreview(node.value)}</span>
                  </button>
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
