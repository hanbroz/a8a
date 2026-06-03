import { Suspense, useState, useRef, useCallback, useEffect } from 'react'
import { IcoMaximize, IcoRestore, IcoX, IcoTrash } from '../Icon'
import JsonMonacoEditor from './JsonMonacoEditor'
import JsonInspectorButton from './JsonInspector'
import ScriptHelpButton from './ScriptHelpButton'
import {
  MonacoEditor,
  MonacoFallback,
  MONACO_OPTIONS,
  ScriptConsoleView,
  beforeApiScriptEditorMount,
} from './ApiNodeModal'
import { useModalMaximize } from './useModalMaximize'
import { isScriptRuntimeError, runPostResponse, runPreRequest } from '../../utils/scriptRuntime'
import { useMonacoTheme } from '../../utils/useMonacoTheme'
import type { ScriptConsoleEntry } from '../../utils/scriptRuntime'

interface Props {
  node: ApiNode
  isNew?: boolean
  initialInput?: string
  initialOutput?: string
  initialPreConsoleLogs?: ScriptConsoleEntry[]
  initialPostConsoleLogs?: ScriptConsoleEntry[]
  envVars?: Record<string, string>
  onRun?: () => string | Promise<string>
  onSave: (nodeId: string, label: string, config: string) => Promise<void>
  onDelete?: () => Promise<void>
  onClose: () => void
}

type ResizeDir = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'
type ScriptPaneTab = 'script' | 'console'
type SelectInputViewMode = 'json' | 'tree' | 'table'

const MIN_W = 600
const MIN_H = 360
const RESIZE_DIRS: ResizeDir[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']
const EMPTY_SCRIPT_LOGS: ScriptConsoleEntry[] = []
type SelectSelectionType = NonNullable<SelectConfig['selectionType']>

function selectModeFromViewMode(viewMode: SelectInputViewMode): NonNullable<SelectConfig['selectMode']> {
  return viewMode === 'table' ? 'table' : 'json'
}

function initialSelectInputViewMode(selectMode: SelectConfig['selectMode'], inputJson?: string): SelectInputViewMode {
  if (selectMode === 'table' && inputJson && parseTableData(inputJson)) return 'table'
  return 'tree'
}

function hasPreRequestScript(script?: string): boolean {
  return typeof script === 'string' && script.trim().length > 0
}

function resolveSelectionType(selectionType: unknown, preScript: string): SelectSelectionType {
  if (hasPreRequestScript(preScript)) return 'script'
  return selectionType === 'single' ? 'single' : 'multiple'
}

function buildScriptSelectionOutput(inputVars: Record<string, unknown>): unknown {
  const entries = Object.entries(inputVars)
  if (entries.length === 0) return []
  if (entries.length === 1) return entries[0][1]
  return { ...inputVars }
}

function parseConfig(raw: string): SelectConfig {
  try {
    const parsed = JSON.parse(raw) as Partial<SelectConfig>
    const preScript = typeof parsed.preScript === 'string' ? parsed.preScript : ''
    const postScript = typeof parsed.postScript === 'string' ? parsed.postScript : ''
    return {
      ...parsed,
      selectedRowIndices: Array.isArray(parsed.selectedRowIndices) ? parsed.selectedRowIndices : [],
      selectedJsonPaths: Array.isArray(parsed.selectedJsonPaths) ? parsed.selectedJsonPaths : [],
      selectMode: parsed.selectMode === 'json' ? 'json' : parsed.selectMode === 'table' ? 'table' : undefined,
      selectionType: resolveSelectionType(parsed.selectionType, preScript),
      autoSelect: parsed.autoSelect === true,
      preScript,
      postScript,
    }
  } catch {
    return { selectedRowIndices: [], selectedJsonPaths: [], selectionType: 'multiple', autoSelect: false, preScript: '', postScript: '' }
  }
}

function parseTableData(inputJson: string): Record<string, unknown>[] | null {
  try {
    const data = JSON.parse(inputJson)
    if (!Array.isArray(data) || data.length === 0) return null
    if (typeof data[0] !== 'object' || data[0] === null) return null
    return data as Record<string, unknown>[]
  } catch {
    return null
  }
}

function buildOutputJson(rows: Record<string, unknown>[], selectedIndices: number[]): string {
  if (rows.length === 0 || selectedIndices.length === 0) return '[]'
  const selectedRows = selectedIndices
    .map(index => rows[index])
    .filter((row): row is Record<string, unknown> => row !== undefined)
  return JSON.stringify(selectedRows, null, 2)
}

type JsonPathPart = string | number

type SelectJsonNode = {
  id: string
  parts: JsonPathPart[]
  key: string
  depth: number
  value: unknown
  type: string
  hasChildren: boolean
}

function isJsonContainer(value: unknown): boolean {
  return Array.isArray(value) || (typeof value === 'object' && value !== null)
}

function valueType(value: unknown): string {
  if (Array.isArray(value)) return 'array'
  if (value === null) return 'null'
  return typeof value
}

function valuePreview(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return `[${value.length}]`
  if (typeof value === 'object') return `{${Object.keys(value as Record<string, unknown>).length}}`
  return String(value)
}

function cloneJsonValue(value: unknown): unknown {
  if (!isJsonContainer(value)) return value
  return JSON.parse(JSON.stringify(value)) as unknown
}

function childPath(parentPath: string, key: JsonPathPart): string {
  if (typeof key === 'number') return `${parentPath}[${key}]`
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${parentPath}.${key}` : `${parentPath}[${JSON.stringify(key)}]`
}

function flattenJsonPaths(
  value: unknown,
  path = '$',
  parts: JsonPathPart[] = [],
  key = '$',
  depth = 0,
): SelectJsonNode[] {
  const hasChildren = isJsonContainer(value) && (
    Array.isArray(value)
      ? value.length > 0
      : Object.keys(value as Record<string, unknown>).length > 0
  )
  const current: SelectJsonNode = { id: path, parts, key, depth, value, type: valueType(value), hasChildren }
  if (Array.isArray(value)) {
    return [
      current,
      ...value.flatMap((item, index) => flattenJsonPaths(item, childPath(path, index), [...parts, index], `[${index}]`, depth + 1)),
    ]
  }
  if (value && typeof value === 'object') {
    return [
      current,
      ...Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
        flattenJsonPaths(child, childPath(path, key), [...parts, key], key, depth + 1),
      ),
    ]
  }
  return [current]
}

function getVisibleJsonNodes(nodes: SelectJsonNode[], expandedIds: Set<string>): SelectJsonNode[] {
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

function expandedIdsForSelectedPaths(selectedPaths: string[]): Set<string> {
  const expanded = new Set<string>()
  selectedPaths.forEach(selectedPath => {
    expanded.add('$')
    let current = '$'
    const parts = selectedPath.match(/(?:\.[A-Za-z_$][\w$]*|\[(?:\d+|".*?")\])/g) ?? []
    parts.slice(0, -1).forEach(part => {
      if (part.startsWith('.')) current += part
      else current += part
      expanded.add(current)
    })
  })
  return expanded
}

function selectJsonData(data: unknown): unknown {
  const rows = Array.isArray(data) && data.length > 0 && typeof data[0] === 'object' && data[0] !== null && !Array.isArray(data[0])
    ? data as Record<string, unknown>[]
    : null
  return rows && rows.length === 1 ? rows[0] : data
}

function readJsonPath(source: unknown, parts: JsonPathPart[]): unknown {
  return parts.reduce<unknown>((current, part) => {
    if (current === null || current === undefined) return undefined
    return (current as Record<string, unknown> | unknown[])[part as never]
  }, source)
}

function buildSelectedJsonArray(inputJson: string, selectedPaths: string[]): string {
  if (selectedPaths.length === 0) return '[]'
  try {
    const source = selectJsonData(JSON.parse(inputJson))
    const nodes = flattenJsonPaths(source)
    const output = selectedPaths
      .map(path => nodes.find(node => node.id === path))
      .filter((node): node is SelectJsonNode => !!node)
      .map(node => readJsonPath(source, node.parts))
      .filter(value => value !== undefined)
      .map(cloneJsonValue)
    return JSON.stringify(output, null, 2)
  } catch {
    return 'null'
  }
}

function normalizeSelection<T>(values: T[], selectionType: SelectConfig['selectionType']): T[] {
  if (selectionType === 'script') return []
  return selectionType === 'single' ? values.slice(0, 1) : values
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

function SelectIcon({ size = 14 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  )
}

function CheckIcon(): JSX.Element {
  return (
    <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="2 6 5 9 10 3" />
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

function RunIcon(): JSX.Element {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
      <polygon points="2,1 9,5 2,9" />
    </svg>
  )
}

export default function SelectNodeModal({
  node,
  isNew,
  initialInput,
  initialOutput,
  initialPreConsoleLogs = EMPTY_SCRIPT_LOGS,
  initialPostConsoleLogs = EMPTY_SCRIPT_LOGS,
  envVars = {},
  onRun,
  onSave,
  onDelete,
  onClose,
}: Props): JSX.Element {
  const initial = parseConfig(node.config)
  const monacoTheme = useMonacoTheme()
  const [moduleName, setModuleName] = useState(node.label)
  const [selectionType, setSelectionType] = useState<SelectSelectionType>(initial.selectionType ?? 'multiple')
  const [selectedRowIndices, setSelectedRowIndices] = useState<number[]>(normalizeSelection(initial.selectedRowIndices, selectionType))
  const [selectedJsonPathIds, setSelectedJsonPathIds] = useState<string[]>(normalizeSelection(initial.selectedJsonPaths ?? [], selectionType))
  const [expandedJsonIds, setExpandedJsonIds] = useState<Set<string>>(() =>
    expandedIdsForSelectedPaths(initial.selectedJsonPaths ?? []),
  )
  const [autoSelect, setAutoSelect] = useState(initial.autoSelect ?? false)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [inputJson, setInputJson] = useState(initialInput ?? '')
  const [inputError, setInputError] = useState(false)
  const [viewMode, setViewMode] = useState<SelectInputViewMode>(() =>
    initialSelectInputViewMode(initial.selectMode, initialInput),
  )
  const [outputOverride, setOutputOverride] = useState<{ source: string; value: string } | null>(null)
  const [scriptOutputOverride, setScriptOutputOverride] = useState<{ source: string; value: string } | null>(() =>
    initialOutput ? { source: '', value: initialOutput } : null,
  )
  const [preScript, setPreScript] = useState(initial.preScript ?? '')
  const [postScript, setPostScript] = useState(initial.postScript ?? '')
  const [prePaneTab, setPrePaneTab] = useState<ScriptPaneTab>('script')
  const [postPaneTab, setPostPaneTab] = useState<ScriptPaneTab>('script')
  const [preConsoleLogs, setPreConsoleLogs] = useState<ScriptConsoleEntry[]>(initialPreConsoleLogs)
  const [postConsoleLogs, setPostConsoleLogs] = useState<ScriptConsoleEntry[]>(initialPostConsoleLogs)
  const [scriptError, setScriptError] = useState<string | null>(null)
  const [scriptTesting, setScriptTesting] = useState(false)

  useEffect(() => {
    const nextInitial = parseConfig(node.config)
    setModuleName(node.label)
    const nextSelectionType = nextInitial.selectionType ?? 'multiple'
    setSelectionType(nextSelectionType)
    setSelectedRowIndices(normalizeSelection(nextInitial.selectedRowIndices, nextSelectionType))
    setSelectedJsonPathIds(normalizeSelection(nextInitial.selectedJsonPaths ?? [], nextSelectionType))
    setExpandedJsonIds(expandedIdsForSelectedPaths(nextInitial.selectedJsonPaths ?? []))
    setAutoSelect(nextInitial.autoSelect ?? false)
    setInputJson(initialInput ?? '')
    setInputError(false)
    setViewMode(() => initialSelectInputViewMode(nextInitial.selectMode, initialInput))
    setOutputOverride(null)
    setScriptOutputOverride(initialOutput ? { source: '', value: initialOutput } : null)
    setPreScript(nextInitial.preScript ?? '')
    setPostScript(nextInitial.postScript ?? '')
    setPreConsoleLogs(initialPreConsoleLogs)
    setPostConsoleLogs(initialPostConsoleLogs)
    setScriptError(null)
  }, [node.id, node.label, node.config, initialInput, initialOutput, initialPreConsoleLogs, initialPostConsoleLogs])

  useEffect(() => {
    if (hasPreRequestScript(preScript)) {
      if (selectionType !== 'script') setSelectionType('script')
      return
    }
    if (selectionType === 'script') setSelectionType('multiple')
  }, [preScript, selectionType])

  const inputRows = parseTableData(inputJson)
  const columns = inputRows && inputRows.length > 0 ? Object.keys(inputRows[0]) : []
  let jsonNodes: SelectJsonNode[] = []
  let jsonParseError = false
  try {
    const parsed = inputJson.trim() ? JSON.parse(inputJson) : null
    jsonNodes = flattenJsonPaths(selectJsonData(parsed))
  } catch {
    jsonParseError = true
  }
  const visibleJsonNodes = getVisibleJsonNodes(jsonNodes, expandedJsonIds)

  const [rect, setRect] = useState(() => {
    const ww = window.innerWidth
    const wh = window.innerHeight
    const w = Math.min(ww - 48, Math.max(720, Math.round(ww * 0.8)))
    const h = Math.min(wh - 80, Math.max(480, Math.round(wh * 0.8)))
    return { x: Math.round((ww - w) / 2), y: Math.round((wh - h) / 2), w, h }
  })
  const { isMaximized, toggleMaximized } = useModalMaximize(rect, setRect)

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
  const [inputH, setInputH] = useState(() => Math.round(rect.h * 0.44))
  const [outputH, setOutputH] = useState(() => Math.round(rect.h * 0.44))

  const onHeaderDown = useCallback(
    (e: React.MouseEvent) => {
      if (isMaximized) return
      if ((e.target as HTMLElement).closest('button')) return
      e.preventDefault()
      dragRef.current = { ox: e.clientX - rect.x, oy: e.clientY - rect.y }
    },
    [isMaximized, rect]
  )

  const onResizeDown = useCallback(
    (e: React.MouseEvent, dir: ResizeDir) => {
      e.preventDefault()
      e.stopPropagation()
      resizeRef.current = { dir, ox: e.clientX, oy: e.clientY, rx: rect.x, ry: rect.y, rw: rect.w, rh: rect.h }
    },
    [rect]
  )

  const onSplitterDown = useCallback(
    (which: 'left' | 'right', e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      splitterRef.current = { kind: 'v', which, startX: e.clientX, startW: which === 'left' ? leftW : rightW }
    },
    [leftW, rightW]
  )

  const onHSplitterDown = useCallback(
    (which: 'inputPre' | 'outputPost', e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      splitterRef.current = { kind: 'h', which, startY: e.clientY, startH: which === 'inputPre' ? inputH : outputH }
    },
    [inputH, outputH]
  )

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
        const dx = e.clientX - ox
        const dy = e.clientY - oy
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
        const d = splitterRef.current
        if (d.kind === 'v') {
          const totalW = bodyRef.current?.offsetWidth ?? 800
          const delta = e.clientX - d.startX
          if (d.which === 'left') setLeftW(() => Math.max(100, Math.min(totalW - rightW - 160, d.startW + delta)))
          else setRightW(() => Math.max(100, Math.min(totalW - leftW - 160, d.startW - delta)))
        } else {
          const colH = d.which === 'inputPre'
            ? (leftColRef.current?.offsetHeight ?? 480)
            : (rightColRef.current?.offsetHeight ?? 480)
          const delta = e.clientY - d.startY
          const nextH = Math.max(120, Math.min(colH - 140, d.startH + delta))
          if (d.which === 'inputPre') setInputH(nextH)
          else setOutputH(nextH)
        }
      }
    }
    const onUp = () => {
      dragRef.current = null
      resizeRef.current = null
      splitterRef.current = null
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [leftW, rightW])

  const preRequestScriptEnabled = hasPreRequestScript(preScript)
  const activeSelectionType = resolveSelectionType(selectionType, preScript)

  const setSelectionTypeMode = (nextType: SelectSelectionType) => {
    if (preRequestScriptEnabled && nextType !== 'script') return
    if (!preRequestScriptEnabled && nextType === 'script') return
    setScriptOutputOverride(null)
    setScriptError(null)
    setSelectionType(nextType)
    if (nextType === 'single') {
      setSelectedRowIndices(prev => prev.slice(0, 1))
      setSelectedJsonPathIds(prev => prev.slice(0, 1))
    }
  }

  const toggleRow = (idx: number) => {
    if (activeSelectionType === 'script') return
    setScriptOutputOverride(null)
    setScriptError(null)
    setSelectedRowIndices(prev => {
      if (activeSelectionType === 'single') return prev.includes(idx) ? [] : [idx]
      return prev.includes(idx) ? prev.filter(item => item !== idx) : [...prev, idx]
    })
  }

  const toggleJsonExpanded = (nodeId: string) => {
    setExpandedJsonIds(prev => {
      const next = new Set(prev)
      if (next.has(nodeId)) next.delete(nodeId)
      else next.add(nodeId)
      return next
    })
  }

  const toggleJsonNode = (node: SelectJsonNode) => {
    if (activeSelectionType === 'script') return
    setScriptOutputOverride(null)
    setScriptError(null)
    setSelectedJsonPathIds(prev => {
      if (activeSelectionType === 'single') return prev.includes(node.id) ? [] : [node.id]
      return prev.includes(node.id) ? prev.filter(item => item !== node.id) : [...prev, node.id]
    })
  }

  const handleFormatInput = () => {
    const result = formatJson(inputJson)
    setInputJson(result.value)
    setInputError(result.error)
  }

  const handleRunClick = async () => {
    if (!onRun) return
    const result = await onRun()
    setInputJson(result)
    setInputError(false)
    setViewMode(prev => prev === 'table' ? (parseTableData(result) ? 'table' : 'tree') : prev)
    setOutputOverride(null)
    setScriptOutputOverride(null)
    setScriptError(null)
  }

  const handleInputChange = (val: string) => {
    setInputJson(val)
    setInputError(false)
    setScriptOutputOverride(null)
    setScriptError(null)
  }

  const handleSave = async () => {
    setSaving(true)
    const effectiveSelectionType = activeSelectionType
    const config: SelectConfig = {
      ...initial,
      selectedRowIndices: normalizeSelection(selectedRowIndices, effectiveSelectionType),
      selectedJsonPaths: normalizeSelection(selectedJsonPathIds, effectiveSelectionType),
      selectMode: selectModeFromViewMode(viewMode),
      selectionType: effectiveSelectionType,
      autoSelect,
      preScript,
      postScript,
    }
    const nextModuleName = moduleName.trim() || 'SELECT'
    await onSave(node.id, nextModuleName, JSON.stringify(config))
    setSaving(false)
    onClose()
  }

  const outputJson = activeSelectionType === 'script'
    ? '[]'
    : viewMode === 'table'
      ? inputRows ? buildOutputJson(inputRows, normalizeSelection(selectedRowIndices, activeSelectionType)) : '[]'
      : buildSelectedJsonArray(inputJson, normalizeSelection(selectedJsonPathIds, activeSelectionType))
  const formattedOutputJson = outputOverride?.source === outputJson ? outputOverride.value : outputJson
  const displayedOutputJson = scriptOutputOverride && (scriptOutputOverride.source === outputJson || scriptOutputOverride.source === '')
    ? scriptOutputOverride.value
    : formattedOutputJson

  const handleFormatOutput = () => {
    const result = formatJson(outputJson)
    setOutputOverride({ source: outputJson, value: result.value })
  }

  const handleTestScripts = async (): Promise<void> => {
    setScriptTesting(true)
    setScriptError(null)
    setPreConsoleLogs([])
    setPostConsoleLogs([])
    setScriptOutputOverride(null)
    let runningPhase: 'pre' | 'post' | null = null
    try {
      const scriptInput = inputJson.trim() ? JSON.parse(inputJson) as unknown : null
      let selectedOutput = outputJson.trim() ? JSON.parse(outputJson) as unknown : null
      const testEnvVars = { ...envVars }

      if (preScript.trim()) {
        runningPhase = 'pre'
        const preResult = await runPreRequest(preScript, { input: scriptInput, envVars: testEnvVars })
        setPreConsoleLogs(preResult.logs)
        for (const [key, value] of Object.entries(preResult.envUpdates)) testEnvVars[key] = value
        if (activeSelectionType === 'script') selectedOutput = buildScriptSelectionOutput(preResult.inputVars)
      }

      let finalOutput = selectedOutput
      if (postScript.trim()) {
        runningPhase = 'post'
        const postResult = await runPostResponse(postScript, {
          input: scriptInput,
          output: selectedOutput,
          envVars: testEnvVars,
        })
        setPostConsoleLogs(postResult.logs)
        if (postResult.hasOutputOverride) finalOutput = postResult.outputOverride
      }

      setScriptOutputOverride({ source: outputJson, value: JSON.stringify(finalOutput, null, 2) })
    } catch (err) {
      if (isScriptRuntimeError(err)) {
        if (runningPhase === 'pre') setPreConsoleLogs(err.logs)
        if (runningPhase === 'post') setPostConsoleLogs(err.logs)
      }
      setScriptError(String((err as Error)?.message ?? err))
    } finally {
      setScriptTesting(false)
    }
  }

  const totalRows = inputRows?.length ?? 0

  return (
    <div className="dm-overlay">
      <div className={`dm-modal${isMaximized ? ' is-maximized' : ''}`} style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}>
        {RESIZE_DIRS.map(dir => (
          <div key={dir} className={`dm-resize-handle dm-resize-${dir}`} onMouseDown={e => onResizeDown(e, dir)} />
        ))}

        <div className="dm-modal-inner">
          <div className="dm-hd" onMouseDown={onHeaderDown}>
            <div className="dm-hd-left">
              <div className="dm-hd-icon dm-hd-icon-select"><SelectIcon size={13} /></div>
              <span className="dm-hd-title">{isNew ? 'Select 모듈 추가' : 'Select 모듈 설정'}</span>
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

          <div className="dm-body" ref={bodyRef}>

            {/* INPUT + PRE REQUEST */}
            <div className="dm-pane-col" ref={leftColRef} style={{ width: leftW, flexShrink: 0 }}>
            <div className="dm-pane" style={{ height: inputH, flexShrink: 0 }}>
              <div className="dm-pane-hd">
                <span className={`dm-pane-label dm-pane-label-input${inputError ? ' dm-pane-label-error' : ''}`}>INPUT</span>
                <div className="dm-pane-hd-actions">
                  {(inputError || jsonParseError) && <span className="dm-json-err-badge">Invalid JSON</span>}
                  <JsonInspectorButton
                    title={`${moduleName || 'SELECT'} INPUT`}
                    value={inputJson}
                    defaultMode={viewMode === 'tree' ? 'tree' : 'json'}
                    disabled={!inputJson.trim()}
                  />
                  <div className="sm-view-toggle">
                    <button
                      className={`sm-view-btn${viewMode === 'json' ? ' active' : ''}`}
                      onClick={() => { setViewMode('json'); setScriptOutputOverride(null); setScriptError(null) }}
                    >JSON</button>
                    <button
                      className={`sm-view-btn${viewMode === 'tree' ? ' active' : ''}`}
                      onClick={() => { setViewMode('tree'); setScriptOutputOverride(null); setScriptError(null) }}
                    >TREE</button>
                    <button
                      className={`sm-view-btn${viewMode === 'table' ? ' active' : ''}`}
                      onClick={() => { setViewMode('table'); setScriptOutputOverride(null); setScriptError(null) }}
                    >표</button>
                  </div>
                  {onRun && (
                    <button
                      className="btn ghost icon dm-format-btn dm-run-btn"
                      onClick={handleRunClick}
                      title="실행 — 연결된 상류 노드 데이터 가져오기"
                    >
                      <RunIcon />
                    </button>
                  )}
                  <button className="btn ghost icon dm-format-btn" onClick={handleFormatInput} title="JSON 정렬">
                    <FormatIcon />
                  </button>
                </div>
              </div>
              <div className="dm-pane-body">
                {viewMode === 'json' ? (
                  <JsonMonacoEditor
                    path={`${node.id}/select-input.json`}
                    value={inputJson}
                    onChange={handleInputChange}
                    error={inputError || jsonParseError}
                    placeholder='[{"column1": "value"}]'
                  />
                ) : viewMode === 'tree' ? (
                  <div className="sp-json-tree sm-json-select-tree">
                    {visibleJsonNodes.length > 0 ? visibleJsonNodes.map(jsonNode => {
                      const selected = selectedJsonPathIds.includes(jsonNode.id)
                      const expanded = expandedJsonIds.has(jsonNode.id)
                      return (
                        <button
                          key={jsonNode.id}
                          className={`sp-json-node${selected ? ' sp-json-node-selected' : ''}`}
                          style={{ paddingLeft: 12 + jsonNode.depth * 18 }}
                          onClick={() => toggleJsonNode(jsonNode)}
                        >
                          <span
                            className={`sp-json-expander${jsonNode.hasChildren ? ' sp-json-expander-visible' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              if (jsonNode.hasChildren) toggleJsonExpanded(jsonNode.id)
                            }}
                          >
                            {jsonNode.hasChildren ? (expanded ? '-' : '+') : ''}
                          </span>
                          <span className={`sm-col-check${activeSelectionType === 'single' ? ' sm-col-check-radio' : ''}${selected ? ' checked' : ''}`} />
                          <span className="sp-json-key">{jsonNode.key}</span>
                          <span className="sp-json-type">{jsonNode.type}</span>
                          <span className="sp-json-path">{jsonNode.id}</span>
                          <span className="sp-json-preview">{valuePreview(jsonNode.value)}</span>
                        </button>
                      )
                    }) : (
                      <div className="sm-col-empty">표시할 JSON 데이터가 없습니다.</div>
                    )}
                  </div>
                ) : (
                  <div className="sm-input-table">
                    {inputRows && inputRows.length > 0 ? (
                      <table>
                        <thead>
                          <tr>
                            <th></th>
                            {columns.map(col => <th key={col}>{col}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {inputRows.map((row, idx) => {
                            const isChecked = selectedRowIndices.includes(idx)
                            return (
                              <tr
                                key={idx}
                                className={isChecked ? 'sm-row-checked' : ''}
                                onClick={() => toggleRow(idx)}
                              >
                                <td>
                                  <div className={`sm-col-check${activeSelectionType === 'single' ? ' sm-col-check-radio' : ''}${isChecked ? ' checked' : ''}`} />
                                </td>
                                {columns.map(col => (
                                  <td key={col}>{String(row[col] ?? '')}</td>
                                ))}
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    ) : (
                      <div className="sm-col-empty">
                        INPUT에 배열 데이터를 붙여넣거나 실행하세요
                      </div>
                    )}
                  </div>
                )}
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
            <div className="dm-pane dm-pane-settings" style={{ flex: '1 1 0', minWidth: 160 }}>
              <div className="dm-pane-hd">
                <span className="dm-pane-label">설정</span>
              </div>
              <div className="dm-pane-body dm-settings-body">
                <div className="dm-field">
                  <label className="dm-field-label">모듈 이름</label>
                  <input
                    className="dm-input"
                    value={moduleName}
                    onChange={e => setModuleName(e.target.value)}
                    placeholder="SELECT"
                    autoFocus
                  />
                </div>

                <div className="dm-field">
                  <label className="dm-field-label">선택 방식</label>
                  <div className="sm-selection-type-tabs">
                    <button
                      type="button"
                      className={`sm-selection-type-btn${activeSelectionType === 'multiple' ? ' active' : ''}`}
                      onClick={() => setSelectionTypeMode('multiple')}
                      disabled={preRequestScriptEnabled}
                    >
                      체크박스
                      <span>여러 개 선택</span>
                    </button>
                    <button
                      type="button"
                      className={`sm-selection-type-btn${activeSelectionType === 'single' ? ' active' : ''}`}
                      onClick={() => setSelectionTypeMode('single')}
                      disabled={preRequestScriptEnabled}
                    >
                      라디오
                      <span>한 개만 선택</span>
                    </button>
                    <button
                      type="button"
                      className={`sm-selection-type-btn${activeSelectionType === 'script' ? ' active' : ''}`}
                      onClick={() => setSelectionTypeMode('script')}
                      disabled={!preRequestScriptEnabled}
                    >
                      스크립트
                      <span>PRE REQUEST SCRIPT 에서 결정</span>
                    </button>
                  </div>
                </div>

                <div className="dm-field">
                  <label className="dm-field-label">선택 현황</label>
                  <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
                    {activeSelectionType === 'script'
                      ? 'PRE REQUEST SCRIPT 에서 결정'
                      : viewMode !== 'table'
                      ? selectedJsonPathIds.length > 0 ? `${selectedJsonPathIds.length}개 JSON 노드 선택됨` : '미선택'
                      : `${selectedRowIndices.length > 0 ? `${selectedRowIndices.length}개 행 선택됨` : '미선택'} / 전체 ${totalRows}행`}
                  </span>
                </div>

                <div className="dm-field">
                  <label className="dm-field-label">자동 선택</label>
                  <label className="dm-toggle-row" title="캔버스 실행 시 팝업 없이 저장된 행을 자동으로 사용합니다">
                    <input
                      type="checkbox"
                      checked={autoSelect}
                      onChange={e => setAutoSelect(e.target.checked)}
                      style={{ marginRight: 6 }}
                    />
                    <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
                      묻지 않고 선택
                    </span>
                  </label>
                </div>

                {viewMode === 'table' && selectedRowIndices.length > 0 && (
                  <div className="sm-select-all-row">
                    <button
                      className="sm-select-all-btn sm-select-all-btn-clear"
                      onClick={() => { setSelectedRowIndices([]); setScriptOutputOverride(null); setScriptError(null) }}
                    >선택 해제</button>
                  </div>
                )}

                {(!inputRows || inputRows.length === 0) && (
                  <div className="sm-col-empty">
                    INPUT에 배열 데이터를 붙여넣거나<br />실행하세요
                  </div>
                )}
              </div>
            </div>

            <div className="dm-splitter" onMouseDown={e => onSplitterDown('right', e)} />

            {/* OUTPUT + POST RESPONSE */}
            <div className="dm-pane-col" ref={rightColRef} style={{ width: rightW, flexShrink: 0 }}>
            <div className="dm-pane" style={{ height: outputH, flexShrink: 0 }}>
              <div className="dm-pane-hd">
                <span className="dm-pane-label dm-pane-label-select-output">OUTPUT</span>
                <div className="dm-pane-hd-actions">
                  {scriptError && <span className="dm-json-err-badge">Script Error</span>}
                  <span className="dm-pane-type">JSON</span>
                  <JsonInspectorButton
                    title={`${moduleName || 'SELECT'} OUTPUT`}
                    value={displayedOutputJson}
                    disabled={!displayedOutputJson.trim()}
                  />
                  <button
                    className="btn ghost icon api-test-btn"
                    onClick={handleTestScripts}
                    disabled={scriptTesting || (!preScript.trim() && !postScript.trim())}
                    title="SELECT 스크립트 테스트"
                  >
                    {scriptTesting ? <span className="api-testing-dot" /> : <RunIcon />}
                  </button>
                  <button className="btn ghost icon dm-format-btn" onClick={handleFormatOutput} title="JSON 정렬">
                    <FormatIcon />
                  </button>
                </div>
              </div>
              <div className="dm-pane-body">
                <JsonMonacoEditor
                  path={`${node.id}/select-output.json`}
                  value={displayedOutputJson}
                  readOnly
                  placeholder="null"
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

          <div className="dm-ft">
            {onDelete && !confirmDelete && (
              <button className="btn ghost dm-delete-btn" onClick={() => setConfirmDelete(true)} title="모듈 삭제">
                <IcoTrash size={13} />
                삭제
              </button>
            )}
            {confirmDelete && (
              <>
                <span className="dm-delete-warn">⚠ 이 모듈이 삭제됩니다.</span>
                <button className="btn ghost" onClick={() => setConfirmDelete(false)}>취소</button>
                <button className="btn dm-delete-confirm-btn" onClick={async () => { await onDelete!(); onClose() }}>삭제 확인</button>
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
                <button className="btn primary" onClick={handleSave} disabled={saving}>
                  {saving ? '저장 중…' : '저장'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
