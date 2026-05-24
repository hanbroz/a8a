import { useRef, useState, useCallback, useEffect } from 'react'
import { IcoPlay, IcoX } from '../Icon'

const NODE_W = 160
const NODE_H = 52
const DATA_NODE_W = 200
const DATA_NODE_H = 72
const SNAP_R = 20

function nW(type: string): number { return (type === 'data' || type === 'select' || type === 'api') ? DATA_NODE_W : NODE_W }
function nH(type: string): number { return (type === 'data' || type === 'select' || type === 'api') ? DATA_NODE_H : NODE_H }

interface Props {
  nodes: ApiNode[]
  edges: ApiEdge[]
  onNodeMove: (id: string, x: number, y: number) => void
  onEdgeCreate: (sourceId: string, targetId: string) => void
  onEdgeDelete: (id: string) => void
  onEdgeReconnect: (edgeId: string, newSourceId: string, newTargetId: string) => void
  onNodeOpen: (nodeId: string) => void
  onNodeRun?: (nodeId: string) => void
  onModuleDrop: (moduleId: string, x: number, y: number) => void
  nodeStatuses?: Record<string, 'running' | 'success' | 'error'>
  onNodeStatusClick?: (nodeId: string) => void
  activeProjectWsId?: string
}

interface NodeDrag { nodeId: string; ox: number; oy: number }

interface Connecting {
  fromNodeId: string
  fromX: number
  fromY: number
  mouseX: number
  mouseY: number
  snapTo: string | null
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

function bezier(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(Math.abs(x2 - x1) * 0.45, 50)
  return `M ${x1} ${y1} C ${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`
}

function parseDataConfig(config: string): DataConfig {
  try { return JSON.parse(config) as DataConfig } catch { return { items: [] } }
}

function parseSelectConfig(config: string): SelectConfig {
  try { return JSON.parse(config) as SelectConfig } catch { return { selectedRowIndices: [] } }
}

function parseApiConfig(config: string): ApiConfig {
  try { return JSON.parse(config) as ApiConfig } catch { return { method: 'GET', url: '', headers: [], params: [], body: '', bodyType: 'json' } }
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


export default function WorkflowCanvas({
  nodes, edges,
  onNodeMove, onEdgeCreate, onEdgeDelete, onEdgeReconnect,
  onNodeOpen, onNodeRun, onModuleDrop,
  nodeStatuses, onNodeStatusClick,
  activeProjectWsId,
}: Props): JSX.Element {
  const canvasRef = useRef<HTMLDivElement>(null)
  const nodeDragRef = useRef<NodeDrag | null>(null)
  const connectRef = useRef<Connecting | null>(null)
  const reconnectRef = useRef<Reconnecting | null>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({})
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [connecting, setConnecting] = useState<Connecting | null>(null)
  const [reconnecting, setReconnecting] = useState<Reconnecting | null>(null)
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null)
  const [canvasDragOver, setCanvasDragOver] = useState(false)

  useEffect(() => {
    setPositions(prev => {
      const next: Record<string, { x: number; y: number }> = {}
      nodes.forEach(n => { next[n.id] = prev[n.id] ?? { x: n.x, y: n.y } })
      return next
    })
  }, [nodes])

  const canvasRect = () => canvasRef.current?.getBoundingClientRect()

  const onNodeDown = useCallback((e: React.MouseEvent, nodeId: string) => {
    if ((e.target as HTMLElement).closest('.wf-port')) return
    e.preventDefault()
    const pos = positions[nodeId]
    if (!pos) return
    nodeDragRef.current = { nodeId, ox: e.clientX - pos.x, oy: e.clientY - pos.y }
    setDraggingId(nodeId)
  }, [positions])

  const onOutputPortDown = useCallback((e: React.MouseEvent, nodeId: string, nodeType: string) => {
    e.stopPropagation()
    e.preventDefault()
    const rect = canvasRect()
    if (!rect) return
    const pos = positions[nodeId]
    if (!pos) return
    const state: Connecting = {
      fromNodeId: nodeId,
      fromX: pos.x + nW(nodeType),
      fromY: pos.y + nH(nodeType) / 2,
      mouseX: e.clientX - rect.left,
      mouseY: e.clientY - rect.top,
      snapTo: null,
    }
    connectRef.current = state
    setConnecting(state)
  }, [positions])

  const onEndpointDown = useCallback((
    e: React.MouseEvent,
    edge: ApiEdge,
    dragging: 'source' | 'target',
    fixedNodeId: string,
    fixedX: number,
    fixedY: number,
  ) => {
    e.stopPropagation()
    e.preventDefault()
    const rect = canvasRect()
    if (!rect) return
    const state: Reconnecting = {
      edgeId: edge.id,
      dragging,
      fixedNodeId,
      fixedX,
      fixedY,
      mouseX: e.clientX - rect.left,
      mouseY: e.clientY - rect.top,
      snapTo: null,
    }
    reconnectRef.current = state
    setReconnecting(state)
    setHoveredEdgeId(null)
  }, [])

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = canvasRect()
    if (!rect) return

    const nd = nodeDragRef.current
    if (nd) {
      const node = nodes.find(n => n.id === nd.nodeId)
      const w = nW(node?.type ?? '')
      const h = nH(node?.type ?? '')
      const x = Math.max(0, Math.min(rect.width - w, e.clientX - nd.ox))
      const y = Math.max(0, Math.min(rect.height - h, e.clientY - nd.oy))
      setPositions(prev => ({ ...prev, [nd.nodeId]: { x, y } }))
    }

    if (connectRef.current) {
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      let snapTo: string | null = null
      for (const n of nodes) {
        if (n.type === 'start' || n.id === connectRef.current.fromNodeId) continue
        const pos = positions[n.id]
        if (!pos) continue
        if (Math.hypot(mx - pos.x, my - (pos.y + nH(n.type) / 2)) < SNAP_R) { snapTo = n.id; break }
      }
      const next: Connecting = { ...connectRef.current, mouseX: mx, mouseY: my, snapTo }
      connectRef.current = next
      setConnecting(next)
    }

    if (reconnectRef.current) {
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const rc = reconnectRef.current
      let snapTo: string | null = null
      for (const n of nodes) {
        if (n.id === rc.fixedNodeId) continue
        const pos = positions[n.id]
        if (!pos) continue
        if (rc.dragging === 'target') {
          // Dragging target end → snap to input port (left side), exclude start nodes
          if (n.type === 'start') continue
          if (Math.hypot(mx - pos.x, my - (pos.y + nH(n.type) / 2)) < SNAP_R) { snapTo = n.id; break }
        } else {
          // Dragging source end → snap to output port (right side), exclude end nodes
          if (n.type === 'end') continue
          if (Math.hypot(mx - (pos.x + nW(n.type)), my - (pos.y + nH(n.type) / 2)) < SNAP_R) { snapTo = n.id; break }
        }
      }
      const next: Reconnecting = { ...rc, mouseX: mx, mouseY: my, snapTo }
      reconnectRef.current = next
      setReconnecting(next)
    }
  }, [nodes, positions])

  const onMouseUp = useCallback(() => {
    const nd = nodeDragRef.current
    if (nd) {
      const pos = positions[nd.nodeId]
      if (pos) onNodeMove(nd.nodeId, pos.x, pos.y)
      nodeDragRef.current = null
      setDraggingId(null)
    }

    const conn = connectRef.current
    if (conn) {
      if (conn.snapTo) onEdgeCreate(conn.fromNodeId, conn.snapTo)
      connectRef.current = null
      setConnecting(null)
    }

    const rc = reconnectRef.current
    if (rc) {
      if (rc.snapTo) {
        const newSourceId = rc.dragging === 'target' ? rc.fixedNodeId : rc.snapTo
        const newTargetId = rc.dragging === 'target' ? rc.snapTo : rc.fixedNodeId
        onEdgeReconnect(rc.edgeId, newSourceId, newTargetId)
      }
      reconnectRef.current = null
      setReconnecting(null)
    }
  }, [positions, onNodeMove, onEdgeCreate, onEdgeReconnect])

  const setEdgeHover = (id: string | null) => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    if (id) {
      setHoveredEdgeId(id)
    } else {
      hoverTimerRef.current = setTimeout(() => setHoveredEdgeId(null), 120)
    }
  }

  const liveNodes = nodes.map(n => ({ ...n, x: positions[n.id]?.x ?? n.x, y: positions[n.id]?.y ?? n.y }))

  // Snap indicators: which input/output ports to highlight
  const snapInputId = connecting?.snapTo ?? (reconnecting?.dragging === 'target' ? reconnecting.snapTo : null)
  const snapOutputId = reconnecting?.dragging === 'source' ? reconnecting.snapTo : null

  return (
    <div
      ref={canvasRef}
      className={`wf-canvas${canvasDragOver ? ' wf-canvas-dragover' : ''}`}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setCanvasDragOver(true) }}
      onDragLeave={() => setCanvasDragOver(false)}
      onDrop={e => {
        e.preventDefault()
        setCanvasDragOver(false)
        const moduleId = e.dataTransfer.getData('moduleId')
        if (!moduleId || !canvasRef.current) return
        const moduleWsId = e.dataTransfer.getData('moduleWsId')
        // 워크스페이스 모듈(공통 아닌)은 현재 프로젝트의 워크스페이스와 일치해야 드롭 허용
        if (moduleWsId && activeProjectWsId && moduleWsId !== activeProjectWsId) return
        const rect = canvasRef.current.getBoundingClientRect()
        onModuleDrop(moduleId, e.clientX - rect.left - 100, e.clientY - rect.top - 36)
      }}
    >
      <svg className="wf-edge-layer" width="100%" height="100%">
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
          const x1 = src.x + nW(src.type)
          const y1 = src.y + nH(src.type) / 2
          const x2 = tgt.x
          const y2 = tgt.y + nH(tgt.type) / 2
          const d = bezier(x1, y1, x2, y2)
          const isReconnecting = reconnecting?.edgeId === edge.id
          const isHovered = hoveredEdgeId === edge.id && !connecting && !reconnecting
          const execStatus = nodeStatuses?.[edge.sourceNodeId]
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
          const toX = snap ? snap.x : connecting.mouseX
          const toY = snap ? snap.y + nH(snap.type) / 2 : connecting.mouseY
          return (
            <path
              d={bezier(connecting.fromX, connecting.fromY, toX, toY)}
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
            x2 = snap ? snap.x : reconnecting.mouseX
            y2 = snap ? snap.y + nH(snap.type) / 2 : reconnecting.mouseY
          } else {
            x1 = snap ? snap.x + nW(snap.type) : reconnecting.mouseX
            y1 = snap ? snap.y + nH(snap.type) / 2 : reconnecting.mouseY
            x2 = reconnecting.fixedX; y2 = reconnecting.fixedY
          }
          return (
            <path
              d={bezier(x1, y1, x2, y2)}
              className={`wf-edge-pending${snap ? ' wf-edge-snap' : ''}`}
              markerEnd="url(#wf-arrow-pending)"
            />
          )
        })()}
      </svg>

      {/* Edge controls: delete button + endpoint handles */}
      {!connecting && !reconnecting && edges.map(edge => {
        if (hoveredEdgeId !== edge.id) return null
        const src = liveNodes.find(n => n.id === edge.sourceNodeId)
        const tgt = liveNodes.find(n => n.id === edge.targetNodeId)
        if (!src || !tgt) return null
        const srcX = src.x + nW(src.type)
        const srcY = src.y + nH(src.type) / 2
        const tgtX = tgt.x
        const tgtY = tgt.y + nH(tgt.type) / 2
        const midX = (srcX + tgtX) / 2
        const midY = (srcY + tgtY) / 2
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
              style={{ left: midX, top: midY }}
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
            {ns === 'running' ? '실행중' : ns === 'success' ? '완료' : '오류'}
          </div>
        ) : null

        if (node.type === 'data') {
          const cfg = parseDataConfig(node.config)
          const hasExcel = !!cfg.excelData?.rows?.length
          const countLabel = hasExcel
            ? `${cfg.excelData!.columns.length}컬럼 · ${cfg.excelData!.rows.length}행`
            : `${cfg.items.length}개`
          return (
            <div
              key={node.id}
              className="wf-node wf-node-data"
              data-dragging={draggingId === node.id ? 'true' : undefined}
              style={{ left: node.x, top: node.y }}
              onMouseDown={e => onNodeDown(e, node.id)}
              onDoubleClick={() => onNodeOpen(node.id)}
            >
              <div className={`wf-port wf-port-input${snapInputId === node.id ? ' wf-port-snap' : ''}`} />
              <div className="wf-node-icon"><DataIcon /></div>
              <div className="wf-node-data-content">
                <span className="wf-node-label">{node.label}</span>
                <div className="wf-node-data-meta">
                  <span className="wf-node-data-count">{countLabel}</span>
                </div>
              </div>
              {statusBullet}
              <div
                className={`wf-port wf-port-output${connecting?.fromNodeId === node.id || snapOutputId === node.id ? ' wf-port-active' : ''}`}
                onMouseDown={e => onOutputPortDown(e, node.id, node.type)}
              />
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
              className="wf-node wf-node-select"
              data-dragging={draggingId === node.id ? 'true' : undefined}
              style={{ left: node.x, top: node.y }}
              onMouseDown={e => onNodeDown(e, node.id)}
              onDoubleClick={() => onNodeOpen(node.id)}
            >
              <div className={`wf-port wf-port-input${snapInputId === node.id ? ' wf-port-snap' : ''}`} />
              <div className="wf-node-icon"><SelectIcon /></div>
              <div className="wf-node-data-content">
                <span className="wf-node-label">{node.label}</span>
                <div className="wf-node-select-meta">
                  <span className="wf-node-select-count">{countLabel}</span>
                </div>
              </div>
              {statusBullet}
              <div
                className={`wf-port wf-port-output${connecting?.fromNodeId === node.id || snapOutputId === node.id ? ' wf-port-active' : ''}`}
                onMouseDown={e => onOutputPortDown(e, node.id, node.type)}
              />
            </div>
          )
        }

        if (node.type === 'api') {
          const cfg = parseApiConfig(node.config)
          const mc = apiMethodColor(cfg.method)
          return (
            <div
              key={node.id}
              className="wf-node wf-node-api"
              data-dragging={draggingId === node.id ? 'true' : undefined}
              style={{ left: node.x, top: node.y }}
              onMouseDown={e => onNodeDown(e, node.id)}
              onDoubleClick={() => onNodeOpen(node.id)}
            >
              <div className={`wf-port wf-port-input${snapInputId === node.id ? ' wf-port-snap' : ''}`} />
              <div className="wf-node-icon wf-node-icon-api"><ApiIcon /></div>
              <div className="wf-node-data-content">
                <span className="wf-node-label wf-node-label-api">{node.label}</span>
                <div className="wf-node-api-meta">
                  <span className="wf-node-api-method" style={{ color: mc, background: `${mc}22` }}>{cfg.method}</span>
                  <span className="wf-node-api-url">{cfg.url || '미설정'}</span>
                </div>
              </div>
              {statusBullet}
              <div
                className={`wf-port wf-port-output${connecting?.fromNodeId === node.id || snapOutputId === node.id ? ' wf-port-active' : ''}`}
                onMouseDown={e => onOutputPortDown(e, node.id, node.type)}
              />
            </div>
          )
        }

        return (
          <div
            key={node.id}
            className={`wf-node wf-node-${node.type}`}
            data-dragging={draggingId === node.id ? 'true' : undefined}
            style={{ left: node.x, top: node.y }}
            onMouseDown={e => onNodeDown(e, node.id)}
            onDoubleClick={() => onNodeOpen(node.id)}
          >
            {node.type !== 'start' && (
              <div className={`wf-port wf-port-input${snapInputId === node.id ? ' wf-port-snap' : ''}`} />
            )}
            <div className="wf-node-icon">
              {node.type === 'start' ? <IcoPlay size={13} /> : <StopIcon />}
            </div>
            <span className="wf-node-label">{node.label}</span>
            {statusBullet}
            {node.type !== 'end' && (
              <div
                className={`wf-port wf-port-output${connecting?.fromNodeId === node.id || snapOutputId === node.id ? ' wf-port-active' : ''}`}
                onMouseDown={e => onOutputPortDown(e, node.id, node.type)}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
