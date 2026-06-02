import { useRef, useState, useCallback, useEffect } from 'react'
import type { CSSProperties } from 'react'
import { IcoCopy, IcoPlay, IcoX } from '../Icon'
import { parseBranchConfig } from '../../utils/branch'

const NODE_W = 160
const NODE_H = 52
const DATA_NODE_W = 200
const DATA_NODE_H = 72
const SNAP_R = 20
const MIN_ZOOM = 0.45
const MAX_ZOOM = 1.8
const GRID_SIZE = 10
const AUTO_ARRANGE_PADDING = 80
const TILE_GAP_X = 50
const TILE_GAP_Y = 40
type NodeStatus = 'running' | 'success' | 'error' | 'skip'
type EdgeLineStyle = 'curve' | 'straight'
type InputPortSide = 'left' | 'top'
type OutputPortSide = 'right' | 'bottom'
type EndNodePnrValue = { name: string; value: string }
type ApiFlowItem = { id: string; index: number; label: string; method: string; url: string; rawUrl: string }

function nW(type: string): number { return (type === 'data' || type === 'select' || type === 'api' || type === 'branch') ? DATA_NODE_W : NODE_W }
function nH(type: string): number { return (type === 'data' || type === 'select' || type === 'api' || type === 'branch') ? DATA_NODE_H : NODE_H }

interface Props {
  nodes: ApiNode[]
  edges: ApiEdge[]
  onNodeMove: (id: string, x: number, y: number) => void
  onEdgeCreate: (sourceId: string, targetId: string, sourcePort?: string | null) => void
  onEdgeDelete: (id: string) => void
  onEdgeReconnect: (edgeId: string, newSourceId: string, newTargetId: string, sourcePort?: string | null) => void
  onNodeOpen: (nodeId: string) => void
  onNodeRun?: (nodeId: string) => void
  onNodeCopy?: (nodeIds: string[]) => void
  onNodePaste?: () => void
  onNodeDeleteRequest?: (nodeId: string) => void
  canPasteNode?: boolean
  onModuleDrop: (moduleType: string, x: number, y: number) => void
  nodeStatuses?: Record<string, NodeStatus>
  branchRoutes?: Record<string, 'true' | 'false'>
  endNodePnrValues?: Record<string, EndNodePnrValue[]>
  onNodeStatusClick?: (nodeId: string) => void
}

interface NodeDrag {
  primaryNodeId: string
  nodeIds: string[]
  primaryOffset: Point
  startPositions: Record<string, Point>
}
type Point = { x: number; y: number }
type SelectionBox = { x: number; y: number; width: number; height: number }
type PortPoint = Point & { side: InputPortSide | OutputPortSide; sourcePort?: string | null }

interface SelectionDrag {
  start: Point
  current: Point
  initialSelectedIds: string[]
}

interface Connecting {
  fromNodeId: string
  fromX: number
  fromY: number
  mouseX: number
  mouseY: number
  snapTo: string | null
  sourcePort?: string | null
}

interface Reconnecting {
  edgeId: string
  dragging: 'source' | 'target'
  fixedNodeId: string
  fixedX: number
  fixedY: number
  mouseX: number
  mouseY: number
  snapTo: string | null
  sourcePort?: string | null
}

function StopIcon(): JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
      <rect x="1.5" y="1.5" width="9" height="9" rx="2" />
    </svg>
  )
}

function DataIcon(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5" />
      <path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3" />
    </svg>
  )
}

function SelectIcon(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  )
}

function BranchIcon(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="3" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="18" cy="18" r="3" />
      <path d="M8.6 7.4 15.4 16.6" />
      <path d="M9 6h6" />
    </svg>
  )
}

function copyTextFallback(text: string): Promise<void> {
  if (typeof document === 'undefined') {
    return Promise.reject(new Error('Clipboard is unavailable'))
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()

  try {
    const copied = document.execCommand('copy')
    return copied ? Promise.resolve() : Promise.reject(new Error('Copy failed'))
  } finally {
    document.body.removeChild(textarea)
  }
}

function copyText(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).catch(() => copyTextFallback(text))
  }
  return copyTextFallback(text)
}

function bezier(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(Math.abs(x2 - x1) * 0.45, 50)
  return `M ${x1} ${y1} C ${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`
}

function orthogonalPath(x1: number, y1: number, x2: number, y2: number): string {
  if (Math.abs(x2 - x1) < 2 || Math.abs(y2 - y1) < 2) {
    return `M ${x1} ${y1} L ${x2} ${y2}`
  }

  if (x2 >= x1) {
    const midX = snapToGrid((x1 + x2) / 2)
    return `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`
  }

  const midY = snapToGrid((y1 + y2) / 2)
  return `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`
}

function edgePath(style: EdgeLineStyle, x1: number, y1: number, x2: number, y2: number): string {
  return style === 'straight' ? orthogonalPath(x1, y1, x2, y2) : bezier(x1, y1, x2, y2)
}

function edgeControlPoint(style: EdgeLineStyle, x1: number, y1: number, x2: number, y2: number): Point {
  if (style === 'straight' && x2 < x1) {
    return {
      x: snapToGrid((x1 + x2) / 2),
      y: snapToGrid((y1 + y2) / 2),
    }
  }
  return {
    x: snapToGrid((x1 + x2) / 2),
    y: snapToGrid((y1 + y2) / 2),
  }
}

function squaredDistance(a: Point, b: Point): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

function nearestPort<T extends PortPoint>(ports: T[], target: Point): T {
  return ports.reduce((best, port) => squaredDistance(port, target) < squaredDistance(best, target) ? port : best, ports[0])
}

function inputPorts(node: Pick<ApiNode, 'type' | 'x' | 'y'>): PortPoint[] {
  if (node.type === 'end') {
    return [
      { side: 'left', x: node.x, y: node.y + nH(node.type) / 2 },
    ]
  }
  return [
    { side: 'left', x: node.x, y: node.y + nH(node.type) / 2 },
    { side: 'top', x: node.x + nW(node.type) / 2, y: node.y },
  ]
}

function outputPorts(node: Pick<ApiNode, 'type' | 'x' | 'y'>): PortPoint[] {
  if (node.type === 'start') {
    return [
      { side: 'right', x: node.x + nW(node.type), y: node.y + nH(node.type) / 2 },
    ]
  }
  if (node.type === 'branch') {
    return [
      { side: 'right', sourcePort: 'true', x: node.x + nW(node.type), y: node.y + 22 },
      { side: 'right', sourcePort: 'false', x: node.x + nW(node.type), y: node.y + nH(node.type) - 22 },
    ]
  }
  return [
    { side: 'right', x: node.x + nW(node.type), y: node.y + nH(node.type) / 2 },
    { side: 'bottom', x: node.x + nW(node.type) / 2, y: node.y + nH(node.type) },
  ]
}

function outputPort(node: Pick<ApiNode, 'type' | 'x' | 'y'>, side: OutputPortSide, sourcePort?: string | null): PortPoint {
  return outputPorts(node).find(port => (sourcePort ? port.sourcePort === sourcePort : port.side === side)) ?? outputPorts(node)[0]
}

function bestEdgePorts(source: ApiNode, target: ApiNode, sourcePort?: string | null): { source: PortPoint; target: PortPoint } {
  const allSources = outputPorts(source)
  const effectiveSourcePort = source.type === 'branch' ? (sourcePort ?? 'true') : sourcePort
  const sources = effectiveSourcePort ? allSources.filter(port => port.sourcePort === effectiveSourcePort) : allSources
  const targets = inputPorts(target)
  let best = { source: sources[0] ?? allSources[0], target: targets[0] }
  let bestDistance = Number.POSITIVE_INFINITY
  sources.forEach(sourcePort => {
    targets.forEach(targetPort => {
      const distance = squaredDistance(sourcePort, targetPort)
      if (distance < bestDistance) {
        bestDistance = distance
        best = { source: sourcePort, target: targetPort }
      }
    })
  })
  return best
}

function parseDataConfig(config: string): DataConfig {
  try {
    const parsed = JSON.parse(config) as DataConfig & LegacyDataConfig
    if (typeof parsed.output === 'string') return { output: parsed.output }
    if (parsed.excelData?.rows?.length) return { output: JSON.stringify(parsed.excelData.rows, null, 2) }
    if (Array.isArray(parsed.items)) {
      return { output: JSON.stringify(parsed.items.map(i => i.value).filter(Boolean), null, 2) }
    }
    return { output: '' }
  } catch { return { output: '' } }
}

function describeDataOutput(cfg: DataConfig): string {
  if (!cfg.output.trim()) return '비어있음'
  try {
    const v = JSON.parse(cfg.output)
    if (Array.isArray(v)) return `${v.length}개`
    if (v && typeof v === 'object') return `${Object.keys(v).length}필드`
    return '단일 값'
  } catch { return 'JSON 오류' }
}

function parseSelectConfig(config: string): SelectConfig {
  try {
    const parsed = JSON.parse(config) as Partial<SelectConfig>
    return {
      selectedRowIndices: Array.isArray(parsed.selectedRowIndices) ? parsed.selectedRowIndices : [],
      selectedJsonPaths: Array.isArray(parsed.selectedJsonPaths) ? parsed.selectedJsonPaths : [],
      selectMode: parsed.selectMode === 'json' ? 'json' : parsed.selectMode === 'table' ? 'table' : undefined,
      selectionType: parsed.selectionType === 'single' ? 'single' : 'multiple',
      autoSelect: parsed.autoSelect === true,
    }
  } catch {
    return { selectedRowIndices: [], selectedJsonPaths: [], selectionType: 'multiple' }
  }
}

function parseApiConfig(config: string): ApiConfig {
  try { return JSON.parse(config) as ApiConfig } catch { return { method: 'GET', url: '', headers: [], params: [], body: '', bodyType: 'json' } }
}

function displayApiUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return '미설정'
  const withoutLeadingEnv = trimmed.replace(/^\{\{\s*[^{}[\]]+?\s*\}\}/, '').trim()
  if (!withoutLeadingEnv && withoutLeadingEnv !== trimmed) return '/'
  return withoutLeadingEnv || trimmed
}

function ApiIcon(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  )
}

function apiMethodColor(method: string): string {
  switch (method) {
    case 'GET': return '#3fb950'
    case 'POST': return '#2f81f7'
    case 'PUT': return '#d29922'
    case 'PATCH': return '#a371f7'
    case 'DELETE': return '#f85149'
    default: return '#3fb950'
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function snapToGrid(value: number): number {
  return Math.round(value / GRID_SIZE) * GRID_SIZE
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor
}

function selectionBoxFromPoints(a: Point, b: Point): SelectionBox {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  }
}

function boxIntersectsNode(box: SelectionBox, node: Pick<ApiNode, 'type' | 'x' | 'y'>): boolean {
  const nodeRight = node.x + nW(node.type)
  const nodeBottom = node.y + nH(node.type)
  const boxRight = box.x + box.width
  const boxBottom = box.y + box.height
  return box.x <= nodeRight && boxRight >= node.x && box.y <= nodeBottom && boxBottom >= node.y
}

function buildExecutionOrderedIds(nodes: ApiNode[], edges: ApiEdge[]): { orderedIds: string[]; reachableIds: Set<string> } {
  const nodeIds = new Set(nodes.map(node => node.id))
  const outgoing = new Map<string, ApiEdge[]>()
  edges.forEach(edge => {
    if (!nodeIds.has(edge.sourceNodeId) || !nodeIds.has(edge.targetNodeId)) return
    outgoing.set(edge.sourceNodeId, [...(outgoing.get(edge.sourceNodeId) ?? []), edge])
  })

  const start = nodes.find(node => node.type === 'start')
  const reachableIds = new Set<string>()
  if (start) {
    const queue = [start.id]
    while (queue.length > 0) {
      const id = queue.shift()!
      if (reachableIds.has(id)) continue
      reachableIds.add(id)
      ;(outgoing.get(id) ?? []).forEach(edge => queue.push(edge.targetNodeId))
    }
  }

  const reachableEdges = edges.filter(edge => reachableIds.has(edge.sourceNodeId) && reachableIds.has(edge.targetNodeId))
  const indegree = new Map<string, number>()
  reachableIds.forEach(id => indegree.set(id, 0))
  reachableEdges.forEach(edge => {
    indegree.set(edge.targetNodeId, (indegree.get(edge.targetNodeId) ?? 0) + 1)
  })

  const orderedIds: string[] = []
  const visited = new Set<string>()
  const ready = start ? [start.id] : []
  while (ready.length > 0) {
    const id = ready.shift()!
    if (visited.has(id)) continue
    visited.add(id)
    orderedIds.push(id)
    ;(outgoing.get(id) ?? [])
      .filter(edge => reachableIds.has(edge.targetNodeId))
      .forEach(edge => {
        const nextCount = (indegree.get(edge.targetNodeId) ?? 0) - 1
        indegree.set(edge.targetNodeId, nextCount)
        if (nextCount === 0) ready.push(edge.targetNodeId)
      })
  }

  // 순환이나 잘못된 연결로 위상 정렬에 빠진 노드는 연결 탐색 순서를 유지해 뒤에 둔다.
  reachableIds.forEach(id => {
    if (!visited.has(id)) orderedIds.push(id)
  })
  nodes.forEach(node => {
    if (!reachableIds.has(node.id)) orderedIds.push(node.id)
  })

  return { orderedIds, reachableIds }
}

function buildAutoArrangeOrder(nodes: ApiNode[], edges: ApiEdge[]): ApiNode[] {
  const nodeById = new Map(nodes.map(node => [node.id, node]))
  const { orderedIds } = buildExecutionOrderedIds(nodes, edges)
  return orderedIds.map(id => nodeById.get(id)).filter((node): node is ApiNode => !!node)
}

function buildApiFlowItems(nodes: ApiNode[], edges: ApiEdge[]): ApiFlowItem[] {
  const nodeById = new Map(nodes.map(node => [node.id, node]))
  const { orderedIds, reachableIds } = buildExecutionOrderedIds(nodes, edges)
  return orderedIds
    .map(id => nodeById.get(id))
    .filter((node): node is ApiNode => !!node && node.type === 'api' && reachableIds.has(node.id))
    .map((node, index) => {
      const cfg = parseApiConfig(node.config)
      return {
        id: node.id,
        index: index + 1,
        label: node.label || 'API',
        method: cfg.method || 'GET',
        url: displayApiUrl(cfg.url),
        rawUrl: cfg.url,
      }
    })
}


export default function WorkflowCanvas({
  nodes, edges,
  onNodeMove, onEdgeCreate, onEdgeDelete, onEdgeReconnect,
  onNodeOpen, onNodeRun, onNodeCopy, onNodePaste, onNodeDeleteRequest, canPasteNode,
  onModuleDrop,
  nodeStatuses, branchRoutes, endNodePnrValues, onNodeStatusClick,
}: Props): JSX.Element {
  const canvasRef = useRef<HTMLDivElement>(null)
  const nodeDragRef = useRef<NodeDrag | null>(null)
  const selectionDragRef = useRef<SelectionDrag | null>(null)
  const connectRef = useRef<Connecting | null>(null)
  const reconnectRef = useRef<Reconnecting | null>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const floatingToolRowRef = useRef<HTMLDivElement>(null)

  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({})
  const [draggingNodeIds, setDraggingNodeIds] = useState<string[]>([])
  const [connecting, setConnecting] = useState<Connecting | null>(null)
  const [reconnecting, setReconnecting] = useState<Reconnecting | null>(null)
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null)
  const [canvasDragOver, setCanvasDragOver] = useState(false)
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([])
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null)
  const [viewport, setViewport] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [copiedPnrKey, setCopiedPnrKey] = useState<string | null>(null)
  const [lineStyle, setLineStyle] = useState<EdgeLineStyle>(() =>
    localStorage.getItem('wf-edge-line-style') === 'straight' ? 'straight' : 'curve',
  )
  const [apiListOpen, setApiListOpen] = useState(false)
  const [floatingToolsWidth, setFloatingToolsWidth] = useState<number | null>(null)
  const [panning, setPanning] = useState(false)
  const panRef = useRef<{ startX: number; startY: number; vx0: number; vy0: number } | null>(null)
  const copiedPnrTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const canvasRect = () => canvasRef.current?.getBoundingClientRect()

  const clientToWorld = useCallback((clientX: number, clientY: number): Point | null => {
    const rect = canvasRect()
    if (!rect) return null
    return {
      x: (clientX - rect.left - viewport.x) / zoom,
      y: (clientY - rect.top - viewport.y) / zoom,
    }
  }, [viewport, zoom])

  const onCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    canvasRef.current?.focus({ preventScroll: true })
    const t = e.target as HTMLElement
    if (e.button === 0) {
      if (!t.closest('.wf-node, .wf-port, .wf-edge-endpoint, .wf-edge-delete-btn, .wf-floating-tools') && t.tagName.toLowerCase() !== 'path') {
        const world = clientToWorld(e.clientX, e.clientY)
        if (!world) return
        e.preventDefault()
        const keepExisting = e.shiftKey || e.ctrlKey || e.metaKey
        selectionDragRef.current = {
          start: world,
          current: world,
          initialSelectedIds: keepExisting ? selectedNodeIds : [],
        }
        setSelectionBox(selectionBoxFromPoints(world, world))
        if (!keepExisting) setSelectedNodeIds([])
      }
      return
    }
    if (e.button !== 2) return
    if (t.closest('.wf-node, .wf-port, .wf-edge-endpoint, .wf-edge-delete-btn, .wf-floating-tools')) return
    if (t.tagName.toLowerCase() === 'path') return
    e.preventDefault()
    panRef.current = { startX: e.clientX, startY: e.clientY, vx0: viewport.x, vy0: viewport.y }
    setPanning(true)
  }, [clientToWorld, selectedNodeIds, viewport])

  const onCanvasWheel = useCallback((e: React.WheelEvent) => {
    if (!e.ctrlKey) return
    e.preventDefault()
    const rect = canvasRect()
    if (!rect) return
    const worldX = (e.clientX - rect.left - viewport.x) / zoom
    const worldY = (e.clientY - rect.top - viewport.y) / zoom
    const factor = Math.exp(-e.deltaY * 0.0012)
    const nextZoom = clamp(zoom * factor, MIN_ZOOM, MAX_ZOOM)
    if (Math.abs(nextZoom - zoom) < 0.001) return
    setZoom(nextZoom)
    setViewport({
      x: e.clientX - rect.left - worldX * nextZoom,
      y: e.clientY - rect.top - worldY * nextZoom,
    })
  }, [viewport, zoom])

  useEffect(() => {
    setPositions(prev => {
      const next: Record<string, { x: number; y: number }> = {}
      nodes.forEach(n => { next[n.id] = prev[n.id] ?? { x: n.x, y: n.y } })
      return next
    })
  }, [nodes])

  useEffect(() => {
    localStorage.setItem('wf-edge-line-style', lineStyle)
  }, [lineStyle])

  useEffect(() => {
    const row = floatingToolRowRef.current
    if (!row) return

    const updateWidth = (): void => {
      setFloatingToolsWidth(Math.ceil(row.scrollWidth))
    }

    updateWidth()
    window.addEventListener('resize', updateWidth)

    if (typeof ResizeObserver === 'undefined') {
      return () => window.removeEventListener('resize', updateWidth)
    }

    const observer = new ResizeObserver(updateWidth)
    observer.observe(row)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateWidth)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (copiedPnrTimerRef.current) clearTimeout(copiedPnrTimerRef.current)
    }
  }, [])

  useEffect(() => {
    const nodeIds = new Set(nodes.map(node => node.id))
    setSelectedNodeIds(prev => prev.filter(id => nodeIds.has(id)))
  }, [nodes])

  const markPnrCopied = useCallback((key: string): void => {
    if (copiedPnrTimerRef.current) clearTimeout(copiedPnrTimerRef.current)
    setCopiedPnrKey(key)
    copiedPnrTimerRef.current = setTimeout(() => {
      setCopiedPnrKey(prev => prev === key ? null : prev)
      copiedPnrTimerRef.current = null
    }, 1200)
  }, [])

  const onPnrCopy = useCallback((e: React.MouseEvent, key: string, value: string): void => {
    e.preventDefault()
    e.stopPropagation()
    void copyText(value).then(() => markPnrCopied(key))
  }, [markPnrCopied])

  const onNodeDown = useCallback((e: React.MouseEvent, nodeId: string) => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('.wf-port')) return
    e.preventDefault()
    canvasRef.current?.focus({ preventScroll: true })
    const additive = e.shiftKey || e.ctrlKey || e.metaKey
    let nextSelectedIds: string[]
    if (additive) {
      nextSelectedIds = selectedNodeIds.includes(nodeId)
        ? selectedNodeIds.filter(id => id !== nodeId)
        : [...selectedNodeIds, nodeId]
      setSelectedNodeIds(nextSelectedIds)
      if (!nextSelectedIds.includes(nodeId)) return
    } else if (selectedNodeIds.includes(nodeId)) {
      nextSelectedIds = selectedNodeIds
    } else {
      nextSelectedIds = [nodeId]
      setSelectedNodeIds(nextSelectedIds)
    }

    const pos = positions[nodeId] ?? nodes.find(node => node.id === nodeId)
    if (!pos) return
    const world = clientToWorld(e.clientX, e.clientY)
    if (!world) return
    const startPositions: Record<string, Point> = {}
    nextSelectedIds.forEach(id => {
      const selectedPos = positions[id] ?? nodes.find(node => node.id === id)
      if (selectedPos) startPositions[id] = { x: selectedPos.x, y: selectedPos.y }
    })
    const nodeIds = Object.keys(startPositions)
    nodeDragRef.current = {
      primaryNodeId: nodeId,
      nodeIds,
      primaryOffset: { x: world.x - pos.x, y: world.y - pos.y },
      startPositions,
    }
    setDraggingNodeIds(nodeIds)
  }, [clientToWorld, nodes, positions, selectedNodeIds])

  const onOutputPortDown = useCallback((e: React.MouseEvent, nodeId: string, nodeType: ApiNode['type'], side: OutputPortSide, sourcePort?: string | null) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    const pos = positions[nodeId]
    if (!pos) return
    const world = clientToWorld(e.clientX, e.clientY)
    if (!world) return
    const port = outputPort({ type: nodeType, x: pos.x, y: pos.y }, side, sourcePort)
    const state: Connecting = {
      fromNodeId: nodeId,
      fromX: port.x,
      fromY: port.y,
      mouseX: world.x,
      mouseY: world.y,
      snapTo: null,
      sourcePort: port.sourcePort ?? null,
    }
    connectRef.current = state
    setConnecting(state)
  }, [clientToWorld, positions])

  const onEndpointDown = useCallback((
    e: React.MouseEvent,
    edge: ApiEdge,
    dragging: 'source' | 'target',
    fixedNodeId: string,
    fixedX: number,
    fixedY: number,
  ) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    const world = clientToWorld(e.clientX, e.clientY)
    if (!world) return
    const state: Reconnecting = {
      edgeId: edge.id,
      dragging,
      fixedNodeId,
      fixedX,
      fixedY,
      mouseX: world.x,
      mouseY: world.y,
      snapTo: null,
      sourcePort: dragging === 'target' ? (edge.sourcePort ?? null) : null,
    }
    reconnectRef.current = state
    setReconnecting(state)
    setHoveredEdgeId(null)
  }, [clientToWorld])

  const onInputPortUp = useCallback((e: React.MouseEvent, targetNodeId: string) => {
    e.preventDefault()
    e.stopPropagation()

    const conn = connectRef.current
    if (conn) {
      if (conn.fromNodeId !== targetNodeId) onEdgeCreate(conn.fromNodeId, targetNodeId, conn.sourcePort ?? null)
      connectRef.current = null
      setConnecting(null)
      return
    }

    const rc = reconnectRef.current
    if (rc?.dragging === 'target') {
      if (rc.fixedNodeId !== targetNodeId) onEdgeReconnect(rc.edgeId, rc.fixedNodeId, targetNodeId, rc.sourcePort ?? null)
      reconnectRef.current = null
      setReconnecting(null)
    }
  }, [onEdgeCreate, onEdgeReconnect])

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = canvasRect()
    if (!rect) return

    if (panRef.current) {
      const p = panRef.current
      setViewport({ x: p.vx0 + (e.clientX - p.startX), y: p.vy0 + (e.clientY - p.startY) })
      return
    }

    if (selectionDragRef.current) {
      const world = clientToWorld(e.clientX, e.clientY)
      if (!world) return
      const drag = { ...selectionDragRef.current, current: world }
      selectionDragRef.current = drag
      const box = selectionBoxFromPoints(drag.start, drag.current)
      const selectedFromBox = nodes
        .filter(node => {
          const pos = positions[node.id] ?? node
          return boxIntersectsNode(box, { type: node.type, x: pos.x, y: pos.y })
        })
        .map(node => node.id)
      setSelectionBox(box)
      setSelectedNodeIds(Array.from(new Set([...drag.initialSelectedIds, ...selectedFromBox])))
      return
    }

    const nd = nodeDragRef.current
    if (nd) {
      const world = clientToWorld(e.clientX, e.clientY)
      if (!world) return
      const primaryStart = nd.startPositions[nd.primaryNodeId]
      if (!primaryStart) return
      const x = snapToGrid(world.x - nd.primaryOffset.x)
      const y = snapToGrid(world.y - nd.primaryOffset.y)
      const dx = x - primaryStart.x
      const dy = y - primaryStart.y
      setPositions(prev => {
        const next = { ...prev }
        Object.entries(nd.startPositions).forEach(([id, pos]) => {
          next[id] = { x: pos.x + dx, y: pos.y + dy }
        })
        return next
      })
    }

    if (connectRef.current) {
      const world = clientToWorld(e.clientX, e.clientY)
      if (!world) return
      const mx = world.x
      const my = world.y
      let snapTo: string | null = null
      for (const n of nodes) {
        if (n.type === 'start' || n.id === connectRef.current.fromNodeId) continue
        const pos = positions[n.id]
        if (!pos) continue
        const nearest = nearestPort(inputPorts({ type: n.type, x: pos.x, y: pos.y }), { x: mx, y: my })
        if (Math.hypot(mx - nearest.x, my - nearest.y) < SNAP_R) { snapTo = n.id; break }
      }
      const next: Connecting = { ...connectRef.current, mouseX: mx, mouseY: my, snapTo }
      connectRef.current = next
      setConnecting(next)
    }

    if (reconnectRef.current) {
      const world = clientToWorld(e.clientX, e.clientY)
      if (!world) return
      const mx = world.x
      const my = world.y
      const rc = reconnectRef.current
      let snapTo: string | null = null
      for (const n of nodes) {
        if (n.id === rc.fixedNodeId) continue
        const pos = positions[n.id]
        if (!pos) continue
        if (rc.dragging === 'target') {
          // Dragging target end → snap to input port (left side), exclude start nodes
          if (n.type === 'start') continue
          const nearest = nearestPort(inputPorts({ type: n.type, x: pos.x, y: pos.y }), { x: mx, y: my })
          if (Math.hypot(mx - nearest.x, my - nearest.y) < SNAP_R) { snapTo = n.id; break }
        } else {
          // Dragging source end → snap to output port (right side), exclude end nodes
          if (n.type === 'end') continue
          const nearest = nearestPort(outputPorts({ type: n.type, x: pos.x, y: pos.y }), { x: mx, y: my })
          if (Math.hypot(mx - nearest.x, my - nearest.y) < SNAP_R) { snapTo = n.id; break }
        }
      }
      const next: Reconnecting = { ...rc, mouseX: mx, mouseY: my, snapTo }
      reconnectRef.current = next
      setReconnecting(next)
    }
  }, [clientToWorld, nodes, positions])

  const onMouseUp = useCallback(() => {
    if (panRef.current) {
      panRef.current = null
      setPanning(false)
    }

    if (selectionDragRef.current) {
      selectionDragRef.current = null
      setSelectionBox(null)
    }

    const nd = nodeDragRef.current
    if (nd) {
      nd.nodeIds.forEach(id => {
        const pos = positions[id]
        if (pos) onNodeMove(id, pos.x, pos.y)
      })
      nodeDragRef.current = null
      setDraggingNodeIds([])
    }

    const conn = connectRef.current
    if (conn) {
      if (conn.snapTo) onEdgeCreate(conn.fromNodeId, conn.snapTo, conn.sourcePort ?? null)
      connectRef.current = null
      setConnecting(null)
    }

    const rc = reconnectRef.current
    if (rc) {
      if (rc.snapTo) {
        const newSourceId = rc.dragging === 'target' ? rc.fixedNodeId : rc.snapTo
        const newTargetId = rc.dragging === 'target' ? rc.snapTo : rc.fixedNodeId
        let nextSourcePort = rc.dragging === 'target' ? (rc.sourcePort ?? null) : null
        if (rc.dragging === 'source') {
          const sourceNode = nodes.find(n => n.id === rc.snapTo)
          const sourcePos = rc.snapTo ? positions[rc.snapTo] : undefined
          if (sourceNode && sourcePos) {
            nextSourcePort = nearestPort(outputPorts({ type: sourceNode.type, x: sourcePos.x, y: sourcePos.y }), { x: rc.fixedX, y: rc.fixedY }).sourcePort ?? null
          }
        }
        onEdgeReconnect(rc.edgeId, newSourceId, newTargetId, nextSourcePort)
      }
      reconnectRef.current = null
      setReconnecting(null)
    }
  }, [nodes, positions, onNodeMove, onEdgeCreate, onEdgeReconnect])

  const setEdgeHover = (id: string | null) => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    if (id) {
      setHoveredEdgeId(id)
    } else {
      hoverTimerRef.current = setTimeout(() => setHoveredEdgeId(null), 120)
    }
  }

  const autoArrangeNodes = useCallback(() => {
    const rect = canvasRect()
    if (!rect || nodes.length === 0) return

    const orderedNodes = buildAutoArrangeOrder(nodes, edges)
    if (orderedNodes.length === 0) return

    const visibleW = rect.width / zoom
    const visibleH = rect.height / zoom
    const safePadding = snapToGrid(Math.min(AUTO_ARRANGE_PADDING, Math.max(40, Math.min(visibleW, visibleH) * 0.12)))
    const worldLeft = Math.max(0, -viewport.x / zoom) + safePadding
    const worldTop = Math.max(0, -viewport.y / zoom) + safePadding
    const usableW = Math.max(1, visibleW - safePadding * 2)
    const usableH = Math.max(1, visibleH - safePadding * 2)
    const maxNodeW = Math.max(...orderedNodes.map(node => nW(node.type)))
    const maxNodeH = Math.max(...orderedNodes.map(node => nH(node.type)))
    const maxColsByWidth = Math.max(1, Math.floor((usableW + TILE_GAP_X) / (maxNodeW + TILE_GAP_X)))
    const targetAspect = usableW / Math.max(1, usableH)
    const idealCols = Math.ceil(Math.sqrt(orderedNodes.length * targetAspect * (maxNodeH / maxNodeW)))
    const cols = clamp(idealCols, 1, Math.min(orderedNodes.length, maxColsByWidth))
    const rows = Math.ceil(orderedNodes.length / cols)
    const colGap = cols > 1
      ? Math.max(TILE_GAP_X, (usableW - maxNodeW * cols) / (cols - 1))
      : 0
    const rowGap = rows > 1
      ? Math.max(TILE_GAP_Y, (usableH - maxNodeH * rows) / (rows - 1))
      : 0
    const gridW = maxNodeW * cols + colGap * Math.max(0, cols - 1)
    const gridH = maxNodeH * rows + rowGap * Math.max(0, rows - 1)
    const startX = worldLeft + Math.max(0, (usableW - gridW) / 2)
    const startY = worldTop + Math.max(0, (usableH - gridH) / 2)

    const nextPositions: Record<string, { x: number; y: number }> = {}
    orderedNodes.forEach((node, index) => {
      const col = index % cols
      const row = Math.floor(index / cols)
      nextPositions[node.id] = {
        x: snapToGrid(startX + col * (maxNodeW + colGap) + (maxNodeW - nW(node.type)) / 2),
        y: snapToGrid(startY + row * (maxNodeH + rowGap) + (maxNodeH - nH(node.type)) / 2),
      }
    })

    setPositions(prev => ({ ...prev, ...nextPositions }))
    orderedNodes.forEach(node => {
      const pos = nextPositions[node.id]
      onNodeMove(node.id, pos.x, pos.y)
    })
  }, [edges, nodes, onNodeMove, viewport, zoom])

  const liveNodes = nodes.map(n => ({ ...n, x: positions[n.id]?.x ?? n.x, y: positions[n.id]?.y ?? n.y }))
  const apiFlowItems = buildApiFlowItems(liveNodes, edges)
  const liveNodeById = new Map(liveNodes.map(node => [node.id, node]))
  const selectedNodeIdSet = new Set(selectedNodeIds)
  const draggingNodeIdSet = new Set(draggingNodeIds)
  const selectedNode = selectedNodeIds.length === 1 ? liveNodeById.get(selectedNodeIds[0]) ?? null : null
  const selectedCopyableNode = selectedNode && selectedNode.type !== 'start' && selectedNode.type !== 'end' ? selectedNode : null
  const selectedCopyableNodeIds = selectedNodeIds.filter(id => {
    const node = liveNodeById.get(id)
    return !!node && node.type !== 'start' && node.type !== 'end'
  })

  const onCanvasKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const key = e.key.toLowerCase()
    if (key === 'delete' && selectedCopyableNode && onNodeDeleteRequest) {
      e.preventDefault()
      onNodeDeleteRequest(selectedCopyableNode.id)
      return
    }
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return
    if (key === 'c' && selectedCopyableNodeIds.length > 0 && onNodeCopy) {
      e.preventDefault()
      onNodeCopy(selectedCopyableNodeIds)
    }
    if (key === 'v' && canPasteNode && onNodePaste) {
      e.preventDefault()
      onNodePaste()
    }
  }, [canPasteNode, onNodeCopy, onNodeDeleteRequest, onNodePaste, selectedCopyableNode, selectedCopyableNodeIds])

  // Snap indicators: which input/output ports to highlight
  const snapInputId = connecting?.snapTo ?? (reconnecting?.dragging === 'target' ? reconnecting.snapTo : null)
  const snapOutputId = reconnecting?.dragging === 'source' ? reconnecting.snapTo : null
  const gridScreenSize = GRID_SIZE * zoom
  const gridX = positiveModulo(viewport.x, gridScreenSize)
  const gridY = positiveModulo(viewport.y, gridScreenSize)
  const renderInputPorts = (node: ApiNode): JSX.Element | null => {
    if (node.type === 'start') return null
    const active = snapInputId === node.id ? ' wf-port-snap' : ''
    if (node.type === 'end') {
      return (
        <div
          className={`wf-port wf-port-input wf-port-input-left${active}`}
          onMouseUp={e => onInputPortUp(e, node.id)}
          title="INPUT"
        />
      )
    }
    return (
      <>
        <div
          className={`wf-port wf-port-input wf-port-input-left${active}`}
          onMouseUp={e => onInputPortUp(e, node.id)}
          title="INPUT"
        />
        <div
          className={`wf-port wf-port-input wf-port-input-top${active}`}
          onMouseUp={e => onInputPortUp(e, node.id)}
          title="INPUT"
        />
      </>
    )
  }
  const renderOutputPorts = (node: ApiNode): JSX.Element | null => {
    if (node.type === 'end') return null
    const active = connecting?.fromNodeId === node.id || snapOutputId === node.id ? ' wf-port-active' : ''
    if (node.type === 'start') {
      return (
        <div
          className={`wf-port wf-port-output wf-port-output-right${active}`}
          onMouseDown={e => onOutputPortDown(e, node.id, node.type, 'right')}
          title="OUTPUT"
        />
      )
    }
    if (node.type === 'branch') {
      const cfg = parseBranchConfig(node.config)
      const selectedRoute = branchRoutes?.[node.id]
      return (
        <>
          <div
            className={`wf-port wf-port-output wf-port-output-branch wf-port-output-branch-true${active}`}
            onMouseDown={e => onOutputPortDown(e, node.id, node.type, 'right', 'true')}
            title={cfg.trueLabel ?? 'TRUE'}
          />
          <span className={`wf-branch-port-label wf-branch-port-label-true${selectedRoute === 'true' ? ' wf-branch-port-label-selected' : ''}`}>{cfg.trueLabel ?? 'TRUE'}</span>
          <div
            className={`wf-port wf-port-output wf-port-output-branch wf-port-output-branch-false${active}`}
            onMouseDown={e => onOutputPortDown(e, node.id, node.type, 'right', 'false')}
            title={cfg.falseLabel ?? 'FALSE'}
          />
          <span className={`wf-branch-port-label wf-branch-port-label-false${selectedRoute === 'false' ? ' wf-branch-port-label-selected' : ''}`}>{cfg.falseLabel ?? 'FALSE'}</span>
        </>
      )
    }
    return (
      <>
        <div
          className={`wf-port wf-port-output wf-port-output-right${active}`}
          onMouseDown={e => onOutputPortDown(e, node.id, node.type, 'right')}
          title="OUTPUT"
        />
        <div
          className={`wf-port wf-port-output wf-port-output-bottom${active}`}
          onMouseDown={e => onOutputPortDown(e, node.id, node.type, 'bottom')}
          title="OUTPUT"
        />
      </>
    )
  }

  return (
    <div
      ref={canvasRef}
      className={`wf-canvas${canvasDragOver ? ' wf-canvas-dragover' : ''}${panning ? ' wf-canvas-panning' : ''}`}
      style={{
        '--wf-grid-size': `${gridScreenSize}px`,
        '--wf-grid-x': `${gridX}px`,
        '--wf-grid-y': `${gridY}px`,
      } as CSSProperties}
      onMouseDown={onCanvasMouseDown}
      onContextMenu={e => e.preventDefault()}
      onWheel={onCanvasWheel}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onKeyDown={onCanvasKeyDown}
      tabIndex={0}
      onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setCanvasDragOver(true) }}
      onDragLeave={() => setCanvasDragOver(false)}
      onDrop={e => {
        e.preventDefault()
        setCanvasDragOver(false)
        const moduleType = e.dataTransfer.getData('moduleType')
        if (!moduleType || !canvasRef.current) return
        const world = clientToWorld(e.clientX, e.clientY)
        if (!world) return
        onModuleDrop(moduleType, snapToGrid(world.x - 100), snapToGrid(world.y - 36))
      }}
    >
      <div
        className="wf-floating-tools"
        style={{ width: floatingToolsWidth ?? undefined }}
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="wf-floating-tool-row" ref={floatingToolRowRef}>
        {onNodeCopy && (
          <button
            type="button"
            className="wf-floating-tool-btn"
            disabled={selectedCopyableNodeIds.length === 0}
            onClick={() => { if (selectedCopyableNodeIds.length > 0) onNodeCopy(selectedCopyableNodeIds) }}
            title="선택한 모듈 복사 (Ctrl+C)"
          >
            복사
          </button>
        )}
        {onNodePaste && (
          <button
            type="button"
            className="wf-floating-tool-btn"
            disabled={!canPasteNode}
            onClick={() => { if (canPasteNode) onNodePaste() }}
            title="복사한 모듈 붙여넣기 (Ctrl+V)"
          >
            붙여넣기
          </button>
        )}
        <button type="button" className="wf-floating-tool-btn" onClick={autoArrangeNodes} title="연결 순서 기준 자동정렬">
          자동정렬
        </button>
        <button
          type="button"
          className={`wf-floating-tool-btn${apiListOpen ? ' active' : ''}`}
          onClick={() => setApiListOpen(open => !open)}
          title="연결선 실행 순서에 따른 API 목록"
        >
          API 목록
        </button>
        <div className="wf-line-style-toggle" role="group" aria-label="연결선 형태">
          <button
            type="button"
            className={`wf-line-style-btn${lineStyle === 'curve' ? ' active' : ''}`}
            onClick={() => setLineStyle('curve')}
            title="곡선 연결선"
          >
            곡선
          </button>
          <button
            type="button"
            className={`wf-line-style-btn${lineStyle === 'straight' ? ' active' : ''}`}
            onClick={() => setLineStyle('straight')}
            title="직선 연결선"
          >
            직선
          </button>
        </div>
        <span className="wf-zoom-indicator">{Math.round(zoom * 100)}%</span>
        </div>
        {apiListOpen && (
          <div className="wf-api-flow-list">
            {apiFlowItems.length === 0 ? (
              <div className="wf-api-flow-empty">연결된 API가 없습니다.</div>
            ) : (
              <>
                <div className="wf-api-flow-header">
                  <span>#</span>
                  <span>모듈</span>
                  <span>Method</span>
                  <span>URL</span>
                </div>
                {apiFlowItems.map(item => {
                  const methodColor = apiMethodColor(item.method)
                  const selected = selectedNodeIdSet.has(item.id)
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`wf-api-flow-item${selected ? ' active' : ''}`}
                      title={`${item.label} ${item.method} ${item.rawUrl}`}
                      onClick={() => {
                        setSelectedNodeIds([item.id])
                        canvasRef.current?.focus({ preventScroll: true })
                      }}
                    >
                      <span className="wf-api-flow-index">{item.index}</span>
                      <span className="wf-api-flow-name">{item.label}</span>
                      <span className="wf-api-flow-method" style={{ color: methodColor, background: `${methodColor}22` }}>{item.method}</span>
                      <span className="wf-api-flow-url">{item.url}</span>
                    </button>
                  )
                })}
              </>
            )}
          </div>
        )}
      </div>
      <div
        className="wf-viewport"
        style={{
          position: 'absolute',
          inset: 0,
          transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${zoom})`,
          transformOrigin: '0 0',
        }}
      >
      <svg className="wf-edge-layer" width="100%" height="100%" style={{ overflow: 'visible' }}>
        <defs>
          <marker id="wf-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
            <path d="M0 0 L0 6 L7 3 z" className="wf-edge-arrow" />
          </marker>
          <marker id="wf-arrow-pending" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
            <path d="M0 0 L0 6 L7 3 z" className="wf-edge-arrow-pending" />
          </marker>
          <marker id="wf-arrow-exec-running" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
            <path d="M0 0 L0 6 L7 3 z" className="wf-edge-arrow-exec-running" />
          </marker>
          <marker id="wf-arrow-exec-success" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
            <path d="M0 0 L0 6 L7 3 z" className="wf-edge-arrow-exec-success" />
          </marker>
          <marker id="wf-arrow-exec-error" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
            <path d="M0 0 L0 6 L7 3 z" className="wf-edge-arrow-exec-error" />
          </marker>
        </defs>

        {edges.map(edge => {
          const src = liveNodes.find(n => n.id === edge.sourceNodeId)
          const tgt = liveNodes.find(n => n.id === edge.targetNodeId)
          if (!src || !tgt) return null
          const ports = bestEdgePorts(src, tgt, edge.sourcePort)
          const x1 = ports.source.x
          const y1 = ports.source.y
          const x2 = ports.target.x
          const y2 = ports.target.y
          const d = edgePath(lineStyle, x1, y1, x2, y2)
          const isReconnecting = reconnecting?.edgeId === edge.id
          const isHovered = hoveredEdgeId === edge.id && !connecting && !reconnecting
          const selectedBranchRoute = src.type === 'branch' ? branchRoutes?.[src.id] : undefined
          const isExecutedBranchEdge = src.type !== 'branch'
            || (selectedBranchRoute !== undefined && (edge.sourcePort ?? 'true') === selectedBranchRoute)
          const execStatus = isExecutedBranchEdge ? nodeStatuses?.[edge.sourceNodeId] : undefined
          const execClass = execStatus === 'running' ? ' wf-edge-exec-running'
            : execStatus === 'success' ? ' wf-edge-exec-success'
            : ''
          const execMarker = execStatus === 'running' ? 'url(#wf-arrow-exec-running)'
            : execStatus === 'success' ? 'url(#wf-arrow-exec-success)'
            : 'url(#wf-arrow)'
          return (
            <g key={edge.id}>
              <path
                d={d}
                className={`wf-edge${isHovered ? ' wf-edge-hovered' : ''}${isReconnecting ? ' wf-edge-reconnecting' : ''}${execClass}`}
                markerEnd={isReconnecting ? undefined : execMarker}
              />
              {!isReconnecting && (
                <path
                  d={d}
                  stroke="transparent"
                  strokeWidth={14}
                  fill="none"
                  style={{ cursor: 'pointer', pointerEvents: 'all' }}
                  onMouseEnter={() => setEdgeHover(edge.id)}
                  onMouseLeave={() => setEdgeHover(null)}
                />
              )}
            </g>
          )
        })}

        {/* Pending bezier for new connection */}
        {connecting && (() => {
          const snap = connecting.snapTo ? liveNodes.find(n => n.id === connecting.snapTo) : null
          const snapTarget = snap ? nearestPort(inputPorts(snap), { x: connecting.fromX, y: connecting.fromY }) : null
          const toX = snapTarget ? snapTarget.x : connecting.mouseX
          const toY = snapTarget ? snapTarget.y : connecting.mouseY
          return (
            <path
              d={edgePath(lineStyle, connecting.fromX, connecting.fromY, toX, toY)}
              className={`wf-edge-pending${snap ? ' wf-edge-snap' : ''}`}
              markerEnd="url(#wf-arrow-pending)"
            />
          )
        })()}

        {/* Pending bezier for reconnection */}
        {reconnecting && (() => {
          const snap = reconnecting.snapTo ? liveNodes.find(n => n.id === reconnecting.snapTo) : null
          let x1: number, y1: number, x2: number, y2: number
          if (reconnecting.dragging === 'target') {
            x1 = reconnecting.fixedX; y1 = reconnecting.fixedY
            const snapTarget = snap ? nearestPort(inputPorts(snap), { x: x1, y: y1 }) : null
            x2 = snapTarget ? snapTarget.x : reconnecting.mouseX
            y2 = snapTarget ? snapTarget.y : reconnecting.mouseY
          } else {
            const snapSource = snap ? nearestPort(outputPorts(snap), { x: reconnecting.fixedX, y: reconnecting.fixedY }) : null
            x1 = snapSource ? snapSource.x : reconnecting.mouseX
            y1 = snapSource ? snapSource.y : reconnecting.mouseY
            x2 = reconnecting.fixedX; y2 = reconnecting.fixedY
          }
          return (
            <path
              d={edgePath(lineStyle, x1, y1, x2, y2)}
              className={`wf-edge-pending${snap ? ' wf-edge-snap' : ''}`}
              markerEnd="url(#wf-arrow-pending)"
            />
          )
        })()}
      </svg>

      {selectionBox && (
        <div
          className="wf-selection-box"
          style={{
            left: selectionBox.x,
            top: selectionBox.y,
            width: selectionBox.width,
            height: selectionBox.height,
          }}
        />
      )}

      {/* Edge controls: delete button + endpoint handles */}
      {!connecting && !reconnecting && edges.map(edge => {
        if (hoveredEdgeId !== edge.id) return null
        const src = liveNodes.find(n => n.id === edge.sourceNodeId)
        const tgt = liveNodes.find(n => n.id === edge.targetNodeId)
        if (!src || !tgt) return null
        const ports = bestEdgePorts(src, tgt, edge.sourcePort)
        const srcX = ports.source.x
        const srcY = ports.source.y
        const tgtX = ports.target.x
        const tgtY = ports.target.y
        const controlPoint = edgeControlPoint(lineStyle, srcX, srcY, tgtX, tgtY)
        return (
          <div key={`ec-${edge.id}`}>
            {/* Source endpoint handle */}
            <div
              className="wf-edge-endpoint"
              style={{ left: srcX, top: srcY }}
              onMouseEnter={() => setEdgeHover(edge.id)}
              onMouseLeave={() => setEdgeHover(null)}
              onMouseDown={e => onEndpointDown(e, edge, 'source', tgt.id, tgtX, tgtY)}
              title="연결 시작점 이동"
            />
            {/* Target endpoint handle */}
            <div
              className="wf-edge-endpoint"
              style={{ left: tgtX, top: tgtY }}
              onMouseEnter={() => setEdgeHover(edge.id)}
              onMouseLeave={() => setEdgeHover(null)}
              onMouseDown={e => onEndpointDown(e, edge, 'target', src.id, srcX, srcY)}
              title="연결 끝점 이동"
            />
            {/* Delete button */}
            <button
              className="wf-edge-delete-btn"
              style={{ left: controlPoint.x, top: controlPoint.y }}
              onMouseEnter={() => setEdgeHover(edge.id)}
              onMouseLeave={() => setEdgeHover(null)}
              onClick={() => onEdgeDelete(edge.id)}
              title="연결 삭제"
            >
              <IcoX size={10} />
            </button>
          </div>
        )
      })}

      {liveNodes.map(node => {
        const ns = nodeStatuses?.[node.id]
        const statusBullet = ns ? (
          <div
            className={`wf-node-status-badge wf-node-status-badge-${ns}`}
            onMouseDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); onNodeStatusClick?.(node.id) }}
          >
            {ns === 'running' ? '실행중' : ns === 'success' ? '완료' : ns === 'skip' ? '건너뜀' : '오류'}
          </div>
        ) : null

        if (node.type === 'data') {
          const cfg = parseDataConfig(node.config)
          const countLabel = describeDataOutput(cfg)
          return (
            <div
              key={node.id}
              className={`wf-node wf-node-data${selectedNodeIdSet.has(node.id) ? ' wf-node-selected' : ''}`}
              data-dragging={draggingNodeIdSet.has(node.id) ? 'true' : undefined}
              style={{ left: node.x, top: node.y }}
              onMouseDown={e => onNodeDown(e, node.id)}
              onDoubleClick={() => onNodeOpen(node.id)}
            >
              {renderInputPorts(node)}
              <div className="wf-node-icon"><DataIcon /></div>
              <div className="wf-node-data-content">
                <span className="wf-node-label">{node.label}</span>
                <div className="wf-node-data-meta">
                  <span className="wf-node-data-count">{countLabel}</span>
                </div>
              </div>
              {statusBullet}
              {renderOutputPorts(node)}
            </div>
          )
        }

        if (node.type === 'select') {
          const cfg = parseSelectConfig(node.config)
          const rowCount = (cfg.selectedRowIndices ?? []).length
          const countLabel = rowCount > 0 ? `${rowCount}행 선택됨` : '미설정'
          return (
            <div
              key={node.id}
              className={`wf-node wf-node-select${selectedNodeIdSet.has(node.id) ? ' wf-node-selected' : ''}`}
              data-dragging={draggingNodeIdSet.has(node.id) ? 'true' : undefined}
              style={{ left: node.x, top: node.y }}
              onMouseDown={e => onNodeDown(e, node.id)}
              onDoubleClick={() => onNodeOpen(node.id)}
            >
              {renderInputPorts(node)}
              <div className="wf-node-icon"><SelectIcon /></div>
              <div className="wf-node-data-content">
                <span className="wf-node-label">{node.label}</span>
                <div className="wf-node-select-meta">
                  <span className="wf-node-select-count">{countLabel}</span>
                </div>
              </div>
              {statusBullet}
              {renderOutputPorts(node)}
            </div>
          )
        }

        if (node.type === 'api') {
          const cfg = parseApiConfig(node.config)
          const mc = apiMethodColor(cfg.method)
          const displayUrl = displayApiUrl(cfg.url)
          return (
            <div
              key={node.id}
              className={`wf-node wf-node-api${selectedNodeIdSet.has(node.id) ? ' wf-node-selected' : ''}`}
              data-dragging={draggingNodeIdSet.has(node.id) ? 'true' : undefined}
              style={{ left: node.x, top: node.y }}
              onMouseDown={e => onNodeDown(e, node.id)}
              onDoubleClick={() => onNodeOpen(node.id)}
            >
              {renderInputPorts(node)}
              <div className="wf-node-icon wf-node-icon-api"><ApiIcon /></div>
              <div className="wf-node-data-content">
                <span className="wf-node-label wf-node-label-api">{node.label}</span>
                <div className="wf-node-api-meta">
                  <span className="wf-node-api-method" style={{ color: mc, background: `${mc}22` }}>{cfg.method}</span>
                  <span className="wf-node-api-url" title={cfg.url || undefined}>{displayUrl}</span>
                </div>
              </div>
              {statusBullet}
              {renderOutputPorts(node)}
            </div>
          )
        }

        if (node.type === 'branch') {
          const cfg = parseBranchConfig(node.config)
          const modeLabel = cfg.mode === 'manual' ? '직접선택' : '조건식'
          return (
            <div
              key={node.id}
              className={`wf-node wf-node-branch${selectedNodeIdSet.has(node.id) ? ' wf-node-selected' : ''}`}
              data-dragging={draggingNodeIdSet.has(node.id) ? 'true' : undefined}
              style={{ left: node.x, top: node.y }}
              onMouseDown={e => onNodeDown(e, node.id)}
              onDoubleClick={() => onNodeOpen(node.id)}
            >
              {renderInputPorts(node)}
              <div className="wf-node-icon wf-node-icon-branch"><BranchIcon /></div>
              <div className="wf-node-data-content">
                <span className="wf-node-label wf-node-label-branch">{node.label}</span>
                <div className="wf-node-branch-meta">{modeLabel}</div>
              </div>
              {statusBullet}
              {renderOutputPorts(node)}
            </div>
          )
        }

        const endPnrList = node.type === 'end' ? endNodePnrValues?.[node.id] ?? [] : []

        return (
          <div
            key={node.id}
            className={`wf-node wf-node-${node.type}${endPnrList.length > 0 ? ' wf-node-end-has-pnr' : ''}${selectedNodeIdSet.has(node.id) ? ' wf-node-selected' : ''}`}
            data-dragging={draggingNodeIdSet.has(node.id) ? 'true' : undefined}
            style={{ left: node.x, top: node.y }}
            onMouseDown={e => onNodeDown(e, node.id)}
            onDoubleClick={() => onNodeOpen(node.id)}
          >
            {renderInputPorts(node)}
            <div className="wf-node-icon">
              {node.type === 'start' ? <IcoPlay size={13} /> : <StopIcon />}
            </div>
            <div className="wf-node-terminal-content">
              <span className="wf-node-label">{node.label}</span>
              {endPnrList.length > 0 && (
                <div
                  className="wf-node-end-pnr-list"
                  onMouseDown={e => e.stopPropagation()}
                  title={endPnrList.map(item => `${item.name}: ${item.value}`).join('\n')}
                >
                  {endPnrList.map(item => {
                    const pnrKey = `${node.id}:${item.name}:${item.value}`
                    const copied = copiedPnrKey === pnrKey
                    return (
                      <span key={`${item.name}:${item.value}`} className="wf-node-end-pnr-chip">
                        <span className="wf-node-end-pnr-name">PNR</span>
                        <span className="wf-node-end-pnr-value">{item.value}</span>
                        <button
                          type="button"
                          className={`wf-node-end-pnr-copy${copied ? ' copied' : ''}`}
                          onMouseDown={e => e.stopPropagation()}
                          onDoubleClick={e => e.stopPropagation()}
                          onClick={e => onPnrCopy(e, pnrKey, item.value)}
                          title={copied ? '복사됨' : 'PNR 복사'}
                          aria-label={`${item.name} 값 복사`}
                        >
                          <IcoCopy size={11} />
                        </button>
                      </span>
                    )
                  })}
                </div>
              )}
            </div>
            {statusBullet}
            {renderOutputPorts(node)}
          </div>
        )
      })}
      </div>
    </div>
  )
}
