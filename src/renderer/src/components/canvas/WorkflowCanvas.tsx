import { useRef, useState, useCallback, useEffect } from 'react'
import { IcoPlay, IcoX } from '../Icon'

const NODE_W = 160
const NODE_H = 52
const DATA_NODE_W = 200
const DATA_NODE_H = 72
const SNAP_R = 20

function nW(type: string): number { return type === 'data' ? DATA_NODE_W : NODE_W }
function nH(type: string): number { return type === 'data' ? DATA_NODE_H : NODE_H }

interface Props {
  nodes: ApiNode[]
  edges: ApiEdge[]
  onNodeMove: (id: string, x: number, y: number) => void
  onEdgeCreate: (sourceId: string, targetId: string) => void
  onEdgeDelete: (id: string) => void
  onNodeOpen: (nodeId: string) => void
  onModuleDrop: (moduleId: string, x: number, y: number) => void
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

function bezier(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(Math.abs(x2 - x1) * 0.45, 50)
  return `M ${x1} ${y1} C ${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`
}

function parseDataConfig(config: string): DataConfig {
  try {
    return JSON.parse(config) as DataConfig
  } catch {
    return { items: [] }
  }
}

export default function WorkflowCanvas({ nodes, edges, onNodeMove, onEdgeCreate, onEdgeDelete, onNodeOpen, onModuleDrop }: Props): JSX.Element {
  const canvasRef = useRef<HTMLDivElement>(null)
  const nodeDragRef = useRef<NodeDrag | null>(null)
  const connectRef = useRef<Connecting | null>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({})
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [connecting, setConnecting] = useState<Connecting | null>(null)
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
  }, [positions, onNodeMove, onEdgeCreate])

  const setEdgeHover = (id: string | null) => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    if (id) {
      setHoveredEdgeId(id)
    } else {
      hoverTimerRef.current = setTimeout(() => setHoveredEdgeId(null), 120)
    }
  }

  const liveNodes = nodes.map(n => ({ ...n, x: positions[n.id]?.x ?? n.x, y: positions[n.id]?.y ?? n.y }))

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
          const isHovered = hoveredEdgeId === edge.id && !connecting
          return (
            <g key={edge.id}>
              <path d={d} className={`wf-edge${isHovered ? ' wf-edge-hovered' : ''}`} markerEnd="url(#wf-arrow)" />
              <path
                d={d}
                stroke="transparent"
                strokeWidth={14}
                fill="none"
                style={{ cursor: 'pointer', pointerEvents: 'all' }}
                onMouseEnter={() => setEdgeHover(edge.id)}
                onMouseLeave={() => setEdgeHover(null)}
              />
            </g>
          )
        })}

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
      </svg>

      {/* Edge delete buttons */}
      {!connecting && edges.map(edge => {
        if (hoveredEdgeId !== edge.id) return null
        const src = liveNodes.find(n => n.id === edge.sourceNodeId)
        const tgt = liveNodes.find(n => n.id === edge.targetNodeId)
        if (!src || !tgt) return null
        const midX = (src.x + nW(src.type) + tgt.x) / 2
        const midY = (src.y + nH(src.type) / 2 + tgt.y + nH(tgt.type) / 2) / 2
        return (
          <button
            key={`del-${edge.id}`}
            className="wf-edge-delete-btn"
            style={{ left: midX, top: midY }}
            onMouseEnter={() => setEdgeHover(edge.id)}
            onMouseLeave={() => setEdgeHover(null)}
            onClick={() => onEdgeDelete(edge.id)}
            title="연결 삭제"
          >
            <IcoX size={10} />
          </button>
        )
      })}

      {liveNodes.map(node => {
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
              <div className={`wf-port wf-port-input${connecting?.snapTo === node.id ? ' wf-port-snap' : ''}`} />
              <div className="wf-node-icon">
                <DataIcon />
              </div>
              <div className="wf-node-data-content">
                <span className="wf-node-label">{node.label}</span>
                <div className="wf-node-data-meta">
                  <span className="wf-node-data-count">{countLabel}</span>
                </div>
              </div>
              <div
                className={`wf-port wf-port-output${connecting?.fromNodeId === node.id ? ' wf-port-active' : ''}`}
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
              <div className={`wf-port wf-port-input${connecting?.snapTo === node.id ? ' wf-port-snap' : ''}`} />
            )}
            <div className="wf-node-icon">
              {node.type === 'start' ? <IcoPlay size={13} /> : <StopIcon />}
            </div>
            <span className="wf-node-label">{node.label}</span>
            {node.type !== 'end' && (
              <div
                className={`wf-port wf-port-output${connecting?.fromNodeId === node.id ? ' wf-port-active' : ''}`}
                onMouseDown={e => onOutputPortDown(e, node.id, node.type)}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
