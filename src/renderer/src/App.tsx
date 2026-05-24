import { useState, useEffect, useRef, useCallback } from 'react'
import { mergeEnvVars, resolveTemplate } from './utils/interpolate'
import { IcoPanelL, IcoPlay, IcoReset, IcoSave, IcoSun, IcoMoon, IcoPanelB, IcoChevD } from './components/Icon'
import WorkspaceHeader from './components/sidebar/WorkspaceHeader'
import ModuleSection from './components/sidebar/ModuleSection'
import ProjectSection from './components/sidebar/ProjectSection'
import ProjectModal from './components/sidebar/ProjectModal'
import WorkspaceModal from './components/sidebar/WorkspaceModal'
import EnvSection from './components/env/EnvSection'
import EnvModal from './components/env/EnvModal'
import ConfirmDialog from './components/ConfirmDialog'
import WorkflowCanvas from './components/canvas/WorkflowCanvas'
import StartNodeModal from './components/canvas/StartNodeModal'
import DataNodeModal from './components/canvas/DataNodeModal'
import SelectNodeModal from './components/canvas/SelectNodeModal'
import ApiNodeModal from './components/canvas/ApiNodeModal'
import SelectionPopup from './components/canvas/SelectionPopup'
import type { Environment } from './components/env/EnvSection'
import type { ProjectItem } from './components/sidebar/ProjectModal'
import type { WorkspaceModalItem } from './components/sidebar/WorkspaceModal'

// ── Log entry row component ───────────────────────────
type ApiLogDetail = {
  method: string
  url: string
  headers: Record<string, string>
  body?: string
  statusCode?: number
  statusText?: string
  responseText?: string
}

type LogEntry = {
  id: string; nodeId: string; label: string; type: string
  status: 'running' | 'success' | 'error' | 'skip'
  input: unknown; output?: unknown; error?: string
  startedAt: number; duration?: number
  apiDetail?: ApiLogDetail
}

const NODE_TYPE_COLORS: Record<string, { color: string; bg: string; label: string }> = {
  data:   { color: '#1f6feb', bg: 'rgba(31,111,235,0.15)',  label: 'DATA' },
  select: { color: '#8957e5', bg: 'rgba(137,87,229,0.15)', label: 'SELECT' },
  api:    { color: '#3fb950', bg: 'rgba(63,185,80,0.15)',   label: 'API' },
}

function statusCodeColor(code: number): string {
  if (code >= 200 && code < 300) return '#3fb950'
  if (code >= 300 && code < 400) return '#d29922'
  if (code >= 400) return '#f85149'
  return '#8b949e'
}

interface CanvasExecution {
  nodeOutputs: Record<string, unknown>
  plan: string[]
  step: number
  pendingSelectInput: unknown[] | null
  pendingLogEntryId?: string | null
}

function LogEntryRow({ entry, isActive }: { entry: LogEntry; isActive?: boolean }): JSX.Element {
  const [open, setOpen] = useState(false)
  const cfg = NODE_TYPE_COLORS[entry.type] ?? { color: '#8b949e', bg: 'rgba(139,148,158,0.15)', label: entry.type.toUpperCase() }
  const statusColor = entry.status === 'success' ? '#3fb950' : entry.status === 'error' ? '#f85149' : entry.status === 'skip' ? '#8b949e' : '#d29922'
  const api = entry.apiDetail

  useEffect(() => {
    if (isActive) setOpen(true)
  }, [isActive])

  const activeColor = entry.status === 'success' ? '#3fb950'
    : entry.status === 'error' ? '#f85149'
    : '#2f81f7'

  return (
    <div
      className={`log-entry${open ? ' log-entry-open' : ''}`}
      style={isActive ? { borderLeft: `2px solid ${activeColor}`, paddingLeft: 10 } : undefined}
      onClick={() => setOpen(v => !v)}
      id={`log-entry-${entry.nodeId}`}
    >
      <div className="log-entry-row">
        <span className="log-entry-type-badge" style={{ background: cfg.bg, color: cfg.color }}>{cfg.label}</span>
        {api && (
          <span className="log-entry-method-badge" style={{ color: cfg.color }}>{api.method}</span>
        )}
        <span className="log-entry-label">{api ? api.url : entry.label}</span>
        {api?.statusCode !== undefined && (
          <span className="log-entry-status-code" style={{ color: statusCodeColor(api.statusCode) }}>
            {api.statusCode} {api.statusText}
          </span>
        )}
        <span className="log-entry-status" style={{ color: statusColor }}>
          {entry.status === 'running' ? '실행 중…' : entry.status === 'success' ? '완료' : entry.status === 'error' ? '오류' : '건너뜀'}
        </span>
        {entry.duration !== undefined && (
          <span className="log-entry-dur">{entry.duration < 1000 ? `${entry.duration}ms` : `${(entry.duration / 1000).toFixed(1)}s`}</span>
        )}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0, color: 'var(--text-4)' }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>

      {open && (
        <div className="log-entry-detail" onClick={e => e.stopPropagation()}>
          {entry.error && <div className="log-entry-error">{entry.error}</div>}

          {api ? (
            <div className="log-api-detail">
              {/* REQUEST */}
              <div className="log-api-section">
                <div className="log-api-section-title">REQUEST</div>
                <div className="log-api-url-line">
                  <span className="log-api-method" style={{ color: cfg.color }}>{api.method}</span>
                  <span className="log-api-url">{api.url}</span>
                </div>
                {Object.keys(api.headers).length > 0 && (
                  <div className="log-api-block">
                    <div className="log-entry-io-label">HEADERS</div>
                    <div className="log-api-kv-list">
                      {Object.entries(api.headers).map(([k, v]) => (
                        <div key={k} className="log-api-kv">
                          <span className="log-api-kv-key">{k}</span>
                          <span className="log-api-kv-val">{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {api.body && (
                  <div className="log-api-block">
                    <div className="log-entry-io-label">BODY</div>
                    <pre className="log-entry-pre">{(() => { try { return JSON.stringify(JSON.parse(api.body), null, 2) } catch { return api.body } })()}</pre>
                  </div>
                )}
              </div>

              {/* RESPONSE */}
              {api.statusCode !== undefined && (
                <div className="log-api-section">
                  <div className="log-api-section-title">RESPONSE</div>
                  <div className="log-api-status-line">
                    <span className="log-api-status-code" style={{ color: statusCodeColor(api.statusCode) }}>{api.statusCode}</span>
                    <span className="log-api-status-text">{api.statusText}</span>
                  </div>
                  {api.responseText && (
                    <div className="log-api-block">
                      <div className="log-entry-io-label">BODY</div>
                      <pre className="log-entry-pre">{(() => { try { return JSON.stringify(JSON.parse(api.responseText), null, 2) } catch { return api.responseText } })()}</pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="log-entry-io">
              <div className="log-entry-io-col">
                <div className="log-entry-io-label">INPUT</div>
                <pre className="log-entry-pre">{entry.input === null || entry.input === undefined ? 'null' : JSON.stringify(entry.input, null, 2)}</pre>
              </div>
              {entry.output !== undefined && (
                <div className="log-entry-io-col">
                  <div className="log-entry-io-label">OUTPUT</div>
                  <pre className="log-entry-pre">{JSON.stringify(entry.output, null, 2)}</pre>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function executeNodeOutput(nodeId: string, nodes: ApiNode[], edges: ApiEdge[]): string {
  const node = nodes.find(n => n.id === nodeId)
  if (!node) return '[]'
  const inEdge = edges.find(e => e.targetNodeId === nodeId)
  const upstreamJson = inEdge ? executeNodeOutput(inEdge.sourceNodeId, nodes, edges) : '[]'
  if (node.type === 'data') {
    try {
      const cfg = JSON.parse(node.config || '{}') as DataConfig
      if (cfg.excelData?.rows?.length) return JSON.stringify(cfg.excelData.rows, null, 2)
      return JSON.stringify((cfg.items ?? []).map(i => i.value).filter(Boolean), null, 2)
    } catch { return '[]' }
  }
  if (node.type === 'select') {
    try {
      const cfg = JSON.parse(node.config || '{}') as SelectConfig
      const input = JSON.parse(upstreamJson) as unknown[]
      if (!Array.isArray(input) || input.length === 0 || cfg.selectedRowIndices.length === 0) return upstreamJson
      const filtered = cfg.selectedRowIndices.map(i => input[i]).filter(Boolean)
      return JSON.stringify(filtered[0] ?? null, null, 2)
    } catch { return upstreamJson }
  }
  if (node.type === 'api') {
    return upstreamJson
  }
  return upstreamJson
}

type Theme = 'dark' | 'light'
type SidebarLayout = 'full' | 'icons'
type LogState = 'collapsed' | 'fullscreen'

type Workspace = {
  id: string
  name: string
  description: string
  environments: Environment[]
  activeEnvId: string
  projects: ProjectItem[]
}

export default function App(): JSX.Element {
  const [theme, setTheme] = useState<Theme>('dark')
  const [sidebarLayout, setSidebarLayout] = useState<SidebarLayout>('full')
  const [logState, setLogState] = useState<LogState>('collapsed')
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('sidebar-width')
      const n = Number(saved)
      return Number.isFinite(n) ? Math.max(180, Math.min(480, n)) : 244
    } catch {
      return 244
    }
  })
  const isResizing = useRef(false)

  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [activeWsId, setActiveWsId] = useState<string>('')
  const [activeProjectId, setActiveProjectId] = useState<string>('')
  const [loading, setLoading] = useState(true)

  const [activeNodes, setActiveNodes] = useState<ApiNode[]>([])
  const [activeEdges, setActiveEdges] = useState<ApiEdge[]>([])
  const [confirmDeleteEdge, setConfirmDeleteEdge] = useState<ApiEdge | null>(null)
  const [editingNode, setEditingNode] = useState<ApiNode | null>(null)
  const [newModuleCtx, setNewModuleCtx] = useState<{ wsId: string | null; type: string } | null>(null)
  const [editingModule, setEditingModule] = useState<ApiModule | null>(null)
  const [nodeRunInputs, setNodeRunInputs] = useState<Record<string, string>>({})
  const [nodeRunOutputs, setNodeRunOutputs] = useState<Record<string, string>>({})
  const [allModules, setAllModules] = useState<ApiModule[]>([])

  const [envDropdownOpen, setEnvDropdownOpen] = useState(false)
  const [envDropdownPos, setEnvDropdownPos] = useState({ top: 0, left: 0 })
  const envBtnRef = useRef<HTMLButtonElement>(null)
  const envDropdownRef = useRef<HTMLDivElement>(null)
  const sidebarRef = useRef<HTMLElement>(null)
  const [modalEnv, setModalEnv] = useState<Environment | null | undefined>(undefined)
  const [modalWsId, setModalWsId] = useState<string>('')
  const [modalProject, setModalProject] = useState<{ wsId: string; project: ProjectItem | null } | null>(null)
  const [modalWorkspace, setModalWorkspace] = useState<{ workspace: WorkspaceModalItem | null } | null>(null)
  const [confirmDeleteWsId, setConfirmDeleteWsId] = useState<string | null>(null)
  const [confirmDeleteProject, setConfirmDeleteProject] = useState<{ wsId: string; project: ProjectItem } | null>(null)
  const [confirmDeleteEnv, setConfirmDeleteEnv] = useState<{ wsId: string; env: Environment } | null>(null)
  const [iconTooltip, setIconTooltip] = useState<{ text: string; x: number; y: number } | null>(null)

  // ── Canvas execution ──
  const [canvasExecution, setCanvasExecution] = useState<CanvasExecution | null>(null)
  const [execLogs, setExecLogs] = useState<LogEntry[]>([])
  const [nodeStatuses, setNodeStatuses] = useState<Record<string, 'running' | 'success' | 'error'>>({})
  const [activeLogNodeId, setActiveLogNodeId] = useState<string | null>(null)

  // ── Load from DB on mount ──
  useEffect(() => {
    async function init(): Promise<void> {
      try {
        const wsList = await window.api.workspace.list()
        const all = await Promise.all(
          wsList.map(async (ws) => {
            const [envs, projects] = await Promise.all([
              window.api.environment.list(ws.id),
              window.api.project.list(ws.id)
            ])
            const baseEnv = envs.find(e => e.isBase)
            const savedEnvId = localStorage.getItem(`ws_active_env_${ws.id}`)
            const savedEnv = savedEnvId ? envs.find(e => e.id === savedEnvId) : null
            return {
              id: ws.id,
              name: ws.name,
              description: ws.description ?? '',
              environments: envs as Environment[],
              activeEnvId: savedEnv?.id ?? baseEnv?.id ?? envs[0]?.id ?? '',
              projects: projects as ProjectItem[]
            }
          })
        )
        setWorkspaces(all)
        if (all.length > 0) {
          setActiveWsId(all[0].id)
          setActiveProjectId(all[0].projects[0]?.id ?? '')
        }
      } catch (err) {
        console.error('Failed to load workspaces:', err)
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [])

  useEffect(() => {
    const handler = (e: MouseEvent): void => {
      if (envDropdownRef.current && !envDropdownRef.current.contains(e.target as Node)) {
        setEnvDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      if (!isResizing.current || !sidebarRef.current) return
      const next = Math.max(180, Math.min(480, e.clientX))
      sidebarRef.current.style.width = `${next}px`
      sidebarRef.current.style.transition = 'none'
    }
    const onUp = (e: MouseEvent): void => {
      if (!isResizing.current) return
      isResizing.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      if (sidebarRef.current) sidebarRef.current.style.transition = ''
      const next = Math.max(180, Math.min(480, e.clientX))
      setSidebarWidth(next)
      localStorage.setItem('sidebar-width', String(next))
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [])

  const isFull = sidebarLayout === 'full'
  const activeWs = workspaces.find(w => w.id === activeWsId)
  const activeProject = workspaces.flatMap(w => w.projects).find(p => p.id === activeProjectId)
  // topbar는 현재 열린 프로젝트의 워크스페이스/환경을 표시 (사이드바 선택과 무관)
  const activeProjectWs = workspaces.find(w => w.projects.some(p => p.id === activeProjectId))
  const activeProjectEnv = activeProjectWs?.environments.find(e => e.id === activeProjectWs.activeEnvId)
  const activeEnv = activeWs?.environments.find(e => e.id === activeWs.activeEnvId)

  useEffect(() => {
    if (!activeProject) { setActiveNodes([]); setActiveEdges([]); return }
    Promise.all([
      window.api.node.list(activeProject.id),
      window.api.edge.list(activeProject.id)
    ]).then(([nodes, edges]) => {
      setActiveNodes(nodes)
      setActiveEdges(edges)
    }).catch(console.error)
  }, [activeProject?.id])

  useEffect(() => {
    window.api.module.listAll().then(setAllModules).catch(console.error)
  }, [])

  const handleNodeMove = useCallback(async (id: string, x: number, y: number): Promise<void> => {
    await window.api.node.updatePosition(id, x, y)
    setActiveNodes(prev => prev.map(n => n.id === id ? { ...n, x, y } : n))
  }, [])

  const handleEdgeCreate = useCallback(async (sourceId: string, targetId: string): Promise<void> => {
    if (!activeProject) return
    if (activeEdges.some(e => e.sourceNodeId === sourceId && e.targetNodeId === targetId)) return
    const edge = await window.api.edge.create(activeProject.id, sourceId, targetId)
    setActiveEdges(prev => [...prev, edge])
  }, [activeProject?.id, activeEdges])

  const handleNodeOpen = useCallback((nodeId: string): void => {
    const node = activeNodes.find(n => n.id === nodeId)
    if (node) setEditingNode(node)
  }, [activeNodes])

  const handleNodeSave = async (nodeId: string, config: string): Promise<void> => {
    await window.api.node.updateConfig(nodeId, config)
    setActiveNodes(prev => prev.map(n => n.id === nodeId ? { ...n, config } : n))
  }

  const handleDataNodeSave = async (nodeId: string, label: string, config: string): Promise<void> => {
    const node = activeNodes.find(n => n.id === nodeId)
    if (node?.moduleId) {
      await handleModuleUpdate(node.moduleId, label, config)
    } else {
      await Promise.all([
        window.api.node.updateLabel(nodeId, label),
        window.api.node.updateConfig(nodeId, config)
      ])
      setActiveNodes(prev => prev.map(n => n.id === nodeId ? { ...n, label, config } : n))
    }
  }

  const handleCreateDataNode = useCallback((wsId: string, type = 'data'): void => {
    setNewModuleCtx({ wsId, type })
  }, [])

  const handleCreateCommonModule = useCallback((type = 'data'): void => {
    setNewModuleCtx({ wsId: null, type })
  }, [])

  const handleModuleDrop = useCallback(async (moduleId: string, x: number, y: number): Promise<void> => {
    if (!activeProject) return
    const mod = allModules.find(m => m.id === moduleId)
    if (!mod) return
    // 공통 모듈이 아닌 경우, 현재 프로젝트의 워크스페이스 소속 모듈만 허용
    if (mod.workspaceId !== null) {
      const projectWsId = workspaces.find(w => w.projects.some(p => p.id === activeProject.id))?.id
      if (mod.workspaceId !== projectWsId) return
    }
    const node = await window.api.node.createFromModule(activeProject.id, moduleId, x, y)
    setActiveNodes(prev => [...prev, node])
  }, [activeProject?.id, allModules, workspaces])

  const handleModuleUpdate = useCallback(async (moduleId: string, label: string, config: string): Promise<void> => {
    await window.api.module.update(moduleId, label, config)
    const linkedNodes = activeNodes.filter(n => n.moduleId === moduleId)
    if (linkedNodes.length > 0) {
      await Promise.all(linkedNodes.flatMap(n => [
        window.api.node.updateLabel(n.id, label),
        window.api.node.updateConfig(n.id, config),
      ]))
    }
    const [mods, nodes] = await Promise.all([
      window.api.module.listAll(),
      activeProject ? window.api.node.list(activeProject.id) : Promise.resolve(activeNodes)
    ])
    setAllModules(mods)
    setActiveNodes(nodes)
  }, [activeProject?.id, activeNodes])

  const handleSetModuleCommon = useCallback(async (id: string, isCommon: boolean, wsId: string): Promise<void> => {
    await window.api.module.setCommon(id, isCommon, wsId)
    const mods = await window.api.module.listAll()
    setAllModules(mods)
  }, [])

  const handleDeleteModule = useCallback(async (id: string): Promise<void> => {
    await window.api.module.delete(id)
    const [mods, nodes] = await Promise.all([
      window.api.module.listAll(),
      activeProject ? window.api.node.list(activeProject.id) : Promise.resolve([])
    ])
    setAllModules(mods)
    setActiveNodes(nodes)
    if (activeProject) {
      const edges = await window.api.edge.list(activeProject.id)
      setActiveEdges(edges)
    }
  }, [activeProject?.id])

  const deleteEdge = async (): Promise<void> => {
    if (!confirmDeleteEdge) return
    await window.api.edge.delete(confirmDeleteEdge.id)
    setActiveEdges(prev => prev.filter(e => e.id !== confirmDeleteEdge.id))
    setConfirmDeleteEdge(null)
  }

  const handleNodeRun = useCallback((nodeId: string) => {
    const inEdge = activeEdges.find(e => e.targetNodeId === nodeId)
    const inputJson = inEdge ? executeNodeOutput(inEdge.sourceNodeId, activeNodes, activeEdges) : ''
    setNodeRunInputs(prev => ({ ...prev, [nodeId]: inputJson }))
    const node = activeNodes.find(n => n.id === nodeId)
    if (node) setEditingNode(node)
  }, [activeNodes, activeEdges])

  const handleEdgeReconnect = useCallback(async (edgeId: string, newSourceId: string, newTargetId: string): Promise<void> => {
    if (!activeProject) return
    const alreadyExists = activeEdges.some(e => e.sourceNodeId === newSourceId && e.targetNodeId === newTargetId && e.id !== edgeId)
    await window.api.edge.delete(edgeId)
    if (!alreadyExists) {
      const newEdge = await window.api.edge.create(activeProject.id, newSourceId, newTargetId)
      setActiveEdges(prev => [...prev.filter(e => e.id !== edgeId), newEdge])
    } else {
      setActiveEdges(prev => prev.filter(e => e.id !== edgeId))
    }
  }, [activeProject?.id, activeEdges])

  function buildExecutionPlan(nodes: ApiNode[], edges: ApiEdge[]): string[] {
    const start = nodes.find(n => n.type === 'start')
    if (!start) return []
    const plan: string[] = []
    const visited = new Set<string>()
    const queue = [start.id]
    while (queue.length > 0) {
      const id = queue.shift()!
      if (visited.has(id)) continue
      visited.add(id)
      plan.push(id)
      const outEdges = edges.filter(e => e.sourceNodeId === id)
      outEdges.forEach(e => queue.push(e.targetNodeId))
    }
    return plan
  }

  const advanceExecution = useCallback(async (exec: CanvasExecution, selectedRows?: unknown[]) => {
    const nodeOutputs = { ...exec.nodeOutputs }
    let { step, plan } = exec

    if (selectedRows !== undefined && step > 0) {
      const prevNodeId = plan[step - 1]
      nodeOutputs[prevNodeId] = selectedRows[0] ?? null
      setNodeRunOutputs(prev => ({ ...prev, [prevNodeId]: JSON.stringify(selectedRows[0] ?? null, null, 2) }))
      if (exec.pendingLogEntryId) {
        const sel = selectedRows[0] ?? null
        setExecLogs(prev => prev.map(e =>
          e.id === exec.pendingLogEntryId
            ? { ...e, status: 'success', output: sel, duration: Date.now() - e.startedAt }
            : e
        ))
        setNodeStatuses(prev => ({ ...prev, [prevNodeId]: 'success' }))
      }
    }

    while (step < plan.length) {
      const nodeId = plan[step]
      const node = activeNodes.find(n => n.id === nodeId)
      if (!node) { step++; continue }

      const inEdge = activeEdges.find(e => e.targetNodeId === nodeId)
      const rawInput = inEdge ? (nodeOutputs[inEdge.sourceNodeId] ?? null) : null
      const inputArray: unknown[] = rawInput === null ? [] : Array.isArray(rawInput) ? rawInput : [rawInput]

      if (node.type === 'start' || node.type === 'end') {
        setNodeStatuses(prev => ({ ...prev, [nodeId]: 'success' }))
        step++; continue
      }

      const startedAt = Date.now()
      const entryId = `${nodeId}-${startedAt}`
      setExecLogs(prev => [...prev, {
        id: entryId, nodeId, label: node.label, type: node.type,
        status: 'running', input: rawInput, startedAt
      }])
      setNodeStatuses(prev => ({ ...prev, [nodeId]: 'running' }))

      if (node.type === 'data') {
        setNodeRunInputs(prev => ({ ...prev, [nodeId]: JSON.stringify(rawInput, null, 2) }))
        try {
          const cfg = JSON.parse(node.config || '{}') as DataConfig
          const output = cfg.excelData?.rows?.length
            ? cfg.excelData.rows
            : (cfg.items ?? []).map((i: DataItem) => i.value).filter(Boolean)
          nodeOutputs[nodeId] = output
          setExecLogs(prev => prev.map(e => e.id === entryId
            ? { ...e, status: 'success', output, duration: Date.now() - startedAt } : e))
          setNodeStatuses(prev => ({ ...prev, [nodeId]: 'success' }))
        } catch (err) {
          nodeOutputs[nodeId] = []
          setExecLogs(prev => prev.map(e => e.id === entryId
            ? { ...e, status: 'error', error: String(err), duration: Date.now() - startedAt } : e))
          setNodeStatuses(prev => ({ ...prev, [nodeId]: 'error' }))
        }
        step++; continue
      }

      if (node.type === 'select') {
        setNodeRunInputs(prev => ({ ...prev, [nodeId]: JSON.stringify(rawInput, null, 2) }))
        const selCfg = JSON.parse(node.config || '{}') as SelectConfig
        if (selCfg.autoSelect && selCfg.selectedRowIndices.length > 0 && inputArray.length > 0) {
          const idx = selCfg.selectedRowIndices[0]
          const autoRow = inputArray[idx] ?? inputArray[0]
          nodeOutputs[nodeId] = autoRow
          setNodeRunOutputs(prev => ({ ...prev, [nodeId]: JSON.stringify(autoRow, null, 2) }))
          setExecLogs(prev => prev.map(e => e.id === entryId
            ? { ...e, status: 'success', output: autoRow, duration: Date.now() - startedAt } : e))
          setNodeStatuses(prev => ({ ...prev, [nodeId]: 'success' }))
          step++; continue
        }
        setCanvasExecution({ nodeOutputs, plan, step: step + 1, pendingSelectInput: inputArray, pendingLogEntryId: entryId })
        return
      }

      if (node.type === 'api') {
        setNodeRunInputs(prev => ({ ...prev, [nodeId]: JSON.stringify(rawInput, null, 2) }))
        let lastApiDetail: ApiLogDetail | undefined
        try {
          const cfg = JSON.parse(node.config || '{}') as ApiConfig
          if (!cfg.url.trim()) {
            nodeOutputs[nodeId] = null
            setExecLogs(prev => prev.map(e => e.id === entryId
              ? { ...e, status: 'skip', output: null, duration: Date.now() - startedAt } : e))
            step++; continue
          }

          const ws = workspaces.find(w => w.id === activeWsId)
          const envVarsForExec = ws
            ? mergeEnvVars(
                ws.environments as Array<{ id: string; isBase: boolean; vars: Array<{ key: string; value: string; enabled: boolean }> }>,
                ws.activeEnvId,
              )
            : {}

          const items: Array<Record<string, unknown>> =
            inputArray.length > 0
              ? inputArray.map(d =>
                  typeof d === 'object' && d !== null && !Array.isArray(d)
                    ? (d as Record<string, unknown>)
                    : {},
                )
              : [{}]

          const allResults: unknown[] = []

          for (const item of items) {
            let fullUrl = resolveTemplate(cfg.url.trim(), envVarsForExec, item)
            const enabledParams = (cfg.params ?? []).filter(p => p.enabled && p.key)
            if (enabledParams.length > 0) {
              const qs = new URLSearchParams(enabledParams.map(p => [p.key, resolveTemplate(p.value, envVarsForExec, item)]))
              fullUrl += (fullUrl.includes('?') ? '&' : '?') + qs.toString()
            }
            const hdrs: Record<string, string> = {}
            ;(cfg.headers ?? []).filter(h => h.enabled && h.key).forEach(h => {
              hdrs[h.key] = resolveTemplate(h.value, envVarsForExec, item)
            })
            let bodyStr: string | undefined
            if (['POST', 'PUT', 'PATCH'].includes(cfg.method) && cfg.body?.trim()) {
              if (cfg.bodyType === 'json' && !hdrs['Content-Type'] && !hdrs['content-type']) {
                hdrs['Content-Type'] = 'application/json'
              }
              bodyStr = resolveTemplate(cfg.body, envVarsForExec, item)
            }

            lastApiDetail = { method: cfg.method, url: fullUrl, headers: hdrs, body: bodyStr }

            const res = await window.api.http.fetch(fullUrl, { method: cfg.method, headers: hdrs, body: bodyStr })
            lastApiDetail = { ...lastApiDetail, statusCode: res.status, statusText: res.statusText, responseText: res.text }

            if (!res.ok) {
              throw new Error(`HTTP ${res.status} ${res.statusText}: ${res.text.slice(0, 300)}`)
            }
            try {
              const data = JSON.parse(res.text) as unknown
              if (Array.isArray(data)) allResults.push(...data)
              else allResults.push(data)
            } catch {
              allResults.push(res.text)
            }
          }

          nodeOutputs[nodeId] = allResults
          setNodeRunOutputs(prev => ({ ...prev, [nodeId]: JSON.stringify(allResults, null, 2) }))
          setExecLogs(prev => prev.map(e => e.id === entryId
            ? { ...e, status: 'success', output: allResults, duration: Date.now() - startedAt, apiDetail: lastApiDetail } : e))
          setNodeStatuses(prev => ({ ...prev, [nodeId]: 'success' }))
        } catch (err) {
          nodeOutputs[nodeId] = null
          const errStr = String(err)
          setNodeRunOutputs(prev => ({ ...prev, [nodeId]: errStr }))
          setExecLogs(prev => prev.map(e => e.id === entryId
            ? { ...e, status: 'error', error: errStr, duration: Date.now() - startedAt, apiDetail: lastApiDetail } : e))
          setNodeStatuses(prev => ({ ...prev, [nodeId]: 'error' }))
          setCanvasExecution(null)
          return
        }
        step++; continue
      }

      step++
    }

    setCanvasExecution(null)
  }, [activeNodes, activeEdges, workspaces, activeWsId])

  const handleCanvasRun = useCallback(() => {
    if (!activeProject) return
    const plan = buildExecutionPlan(activeNodes, activeEdges)
    if (plan.length === 0) return
    setExecLogs([])
    setNodeStatuses({})
    setActiveLogNodeId(null)
    const execution: CanvasExecution = { nodeOutputs: {}, plan, step: 0, pendingSelectInput: null }
    advanceExecution(execution)
  }, [activeNodes, activeEdges, activeProject, advanceExecution])

  const handleCanvasReset = useCallback(() => {
    setExecLogs([])
    setNodeStatuses({})
    setActiveLogNodeId(null)
    setLogState('collapsed')
    setNodeRunInputs({})
    setNodeRunOutputs({})
  }, [])

  const onNodeStatusClick = useCallback((nodeId: string) => {
    setLogState('fullscreen')
    setActiveLogNodeId(nodeId)
  }, [])

  useEffect(() => {
    if (activeLogNodeId && logState === 'fullscreen') {
      requestAnimationFrame(() => {
        document.getElementById(`log-entry-${activeLogNodeId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      })
    }
  }, [activeLogNodeId, logState])

  const toggleTheme = (): void => setTheme(t => (t === 'dark' ? 'light' : 'dark'))
  const toggleLog = (): void => setLogState(s => (s === 'collapsed' ? 'fullscreen' : 'collapsed'))

  const setActiveEnvId = (wsId: string, envId: string): void => {
    localStorage.setItem(`ws_active_env_${wsId}`, envId)
    setWorkspaces(prev => prev.map(w => w.id === wsId ? { ...w, activeEnvId: envId } : w))
  }

  const selectProject = (wsId: string, projectId: string): void => {
    setActiveWsId(wsId)
    setActiveProjectId(projectId)
  }

  const saveWorkspace = async (name: string, description: string): Promise<void> => {
    if (!modalWorkspace) return
    const { workspace } = modalWorkspace
    if (workspace) {
      await window.api.workspace.update(workspace.id, name, description)
      setWorkspaces(prev => prev.map(w => w.id === workspace.id ? { ...w, name, description } : w))
    } else {
      const ws = await window.api.workspace.create(name, description)
      const [envs, projects] = await Promise.all([
        window.api.environment.list(ws.id),
        window.api.project.list(ws.id)
      ])
      const baseEnv = envs.find((e) => (e as ApiEnv).isBase)
      setWorkspaces(prev => [...prev, {
        id: ws.id,
        name: ws.name,
        description: ws.description ?? '',
        environments: envs as Environment[],
        activeEnvId: baseEnv?.id ?? envs[0]?.id ?? '',
        projects: projects as ProjectItem[]
      }])
      setActiveWsId(ws.id)
    }
    setModalWorkspace(null)
  }

  const deleteWorkspace = async (): Promise<void> => {
    if (!confirmDeleteWsId) return
    await window.api.workspace.delete(confirmDeleteWsId)
    setWorkspaces(prev => {
      const next = prev.filter(w => w.id !== confirmDeleteWsId)
      if (activeWsId === confirmDeleteWsId) setActiveWsId(next[0]?.id ?? '')
      return next
    })
    setConfirmDeleteWsId(null)
  }

  // ── Env handlers ──
  const openAddEnvModal = (wsId: string): void => { setModalWsId(wsId); setModalEnv(null) }
  const openEditEnvModal = (wsId: string, env: Environment): void => { setModalWsId(wsId); setModalEnv(env) }
  const closeEnvModal = (): void => setModalEnv(undefined)

  const saveEnv = async (env: Environment): Promise<void> => {
    await window.api.environment.upsert(modalWsId, {
      id: env.id,
      name: env.name,
      isBase: env.isBase,
      color: env.color,
      initial: env.initial,
      vars: env.vars
    })
    setWorkspaces(prev => prev.map(w => {
      if (w.id !== modalWsId) return w
      const exists = w.environments.find(e => e.id === env.id)
      const envs = exists
        ? w.environments.map(e => e.id === env.id ? env : e)
        : [...w.environments, env]
      return { ...w, environments: envs, activeEnvId: env.id }
    }))
    closeEnvModal()
  }

  const deleteEnv = async (): Promise<void> => {
    if (!confirmDeleteEnv) return
    const { wsId, env } = confirmDeleteEnv
    await window.api.environment.delete(env.id)
    setWorkspaces(prev => prev.map(w => {
      if (w.id !== wsId) return w
      const next = w.environments.filter(e => e.id !== env.id)
      const fallback = next.find(e => e.isBase)?.id ?? next[0]?.id ?? ''
      const activeEnvId = w.activeEnvId === env.id ? fallback : w.activeEnvId
      return { ...w, environments: next, activeEnvId }
    }))
    setConfirmDeleteEnv(null)
  }

  // ── Project handlers ──
  const openAddProjectModal = (wsId: string): void => setModalProject({ wsId, project: null })
  const openEditProjectModal = (wsId: string, project: ProjectItem): void => setModalProject({ wsId, project })
  const closeProjectModal = (): void => setModalProject(null)

  const saveProject = async (name: string, description: string): Promise<void> => {
    if (!modalProject) return
    const { wsId, project } = modalProject
    if (project) {
      await window.api.project.update(project.id, name, description)
      setWorkspaces(prev => prev.map(w => {
        if (w.id !== wsId) return w
        return { ...w, projects: w.projects.map(p => p.id === project.id ? { ...p, name, description } : p) }
      }))
    } else {
      const created = await window.api.project.create(wsId, name, description)
      const newProject = created as ProjectItem
      setWorkspaces(prev => prev.map(w => {
        if (w.id !== wsId) return w
        return { ...w, projects: [...w.projects, newProject] }
      }))
      selectProject(wsId, newProject.id)
    }
    closeProjectModal()
  }

  const deleteProject = async (): Promise<void> => {
    if (!confirmDeleteProject) return
    const { wsId, project } = confirmDeleteProject
    await window.api.project.delete(project.id)
    setWorkspaces(prev => prev.map(w => {
      if (w.id !== wsId) return w
      const next = w.projects.filter(p => p.id !== project.id)
      return { ...w, projects: next }
    }))
    if (activeProjectId === project.id) {
      const ws = workspaces.find(w => w.id === wsId)
      const next = (ws?.projects ?? []).filter(p => p.id !== project.id)
      setActiveProjectId(next[0]?.id ?? '')
    }
    setConfirmDeleteProject(null)
  }

  if (loading) {
    return <div className="app" data-theme={theme} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-4)', fontSize: 13 }}>로드 중…</div>
  }

  return (
    <div className="app" data-theme={theme}>
      {/* ── Sidebar ── */}
      <aside
        ref={sidebarRef}
        className="sidebar"
        data-layout={isFull ? undefined : 'icons'}
        style={isFull ? { width: sidebarWidth } : undefined}
      >
        <div className="sidebar-hd">
          {isFull ? (
            <>
              <div className="sidebar-brand">
                <div className="brand-mark">a8a</div>
                <span className="brand-name">a8a</span>
              </div>
              <button
                className="btn ghost icon"
                style={{ width: 26, height: 26 }}
                onClick={() => setSidebarLayout('icons')}
                title="사이드바 접기"
              >
                <IcoPanelL size={14} />
              </button>
            </>
          ) : (
            <button
              className="btn ghost icon sidebar-expand-btn"
              onClick={() => setSidebarLayout('full')}
              title="사이드바 펼치기"
            >
              <IcoPanelL size={15} />
            </button>
          )}
        </div>

        {!isFull && (
          <div className="sidebar-icons-projects">
            {workspaces.map(ws =>
              ws.projects.length > 0 ? (
                <div key={ws.id} className="sidebar-icons-ws-group">
                  {ws.projects.map(proj => (
                    <button
                      key={proj.id}
                      className={`sidebar-proj-icon${proj.id === activeProjectId ? ' sidebar-proj-icon-active' : ''}`}
                      onMouseEnter={e => {
                        const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect()
                        setIconTooltip({ text: `${ws.name} › ${proj.name}`, x: rect.right + 8, y: rect.top + rect.height / 2 })
                      }}
                      onMouseLeave={() => setIconTooltip(null)}
                      onClick={() => selectProject(ws.id, proj.id)}
                    >
                      {proj.name.charAt(0).toUpperCase()}
                    </button>
                  ))}
                </div>
              ) : null
            )}
          </div>
        )}

        {isFull && (
          <div className="sidebar-body">
            <WorkspaceHeader
              workspaces={workspaces}
              activeId={activeWsId}
              onSelect={setActiveWsId}
              onAdd={() => setModalWorkspace({ workspace: null })}
              onEditRequest={(id) => {
                const ws = workspaces.find(w => w.id === id)
                if (ws) setModalWorkspace({ workspace: { id: ws.id, name: ws.name, description: ws.description } })
              }}
              onDeleteRequest={setConfirmDeleteWsId}
              renderContent={(wsId) => {
                const ws = workspaces.find(w => w.id === wsId)
                const wsModules = allModules.filter(m => m.workspaceId === wsId)
                return (
                  <>
                    <EnvSection
                      environments={ws?.environments ?? []}
                      activeEnvId={ws?.activeEnvId ?? ''}
                      onSelect={(envId) => setActiveEnvId(wsId, envId)}
                      onAdd={() => openAddEnvModal(wsId)}
                      onEdit={(env) => openEditEnvModal(wsId, env)}
                      onDelete={(env) => setConfirmDeleteEnv({ wsId, env })}
                    />
                    <ProjectSection
                      projects={ws?.projects ?? []}
                      activeProjectId={activeProjectId}
                      onSelect={(id) => selectProject(wsId, id)}
                      onAdd={() => openAddProjectModal(wsId)}
                      onEdit={(proj) => openEditProjectModal(wsId, proj)}
                      onDelete={(proj) => setConfirmDeleteProject({ wsId, project: proj })}
                    />
                    <ModuleSection
                      stateKey={`module-${wsId}`}
                      title="Module"
                      modules={wsModules}
                      onAdd={(type) => handleCreateDataNode(wsId, type)}
                      onEdit={setEditingModule}
                      onSetCommon={(id, isCommon) => handleSetModuleCommon(id, isCommon, wsId)}
                      onDelete={handleDeleteModule}
                    />
                  </>
                )
              }}
            />
            <ModuleSection
              stateKey="common-module"
              title="공통 모듈"
              modules={allModules.filter(m => m.workspaceId === null)}
              onAdd={(type) => handleCreateCommonModule(type)}
              onEdit={setEditingModule}
              onSetCommon={(id, isCommon) => {
                if (!isCommon && activeWsId) handleSetModuleCommon(id, false, activeWsId)
              }}
              onDelete={handleDeleteModule}
            />
          </div>
        )}

        {isFull && (
          <div
            className="sidebar-resize-handle"
            onMouseDown={() => {
              isResizing.current = true
              document.body.style.cursor = 'col-resize'
              document.body.style.userSelect = 'none'
            }}
          />
        )}
      </aside>

      {/* ── Workspace area ── */}
      <div className="workspace">
        <header className="topbar">
          <div className="topbar-left no-drag">
            {activeProject && (
              <div className="topbar-breadcrumb">
                {activeProjectEnv && activeProjectWs && (
                  <div className="topbar-env-picker">
                    <button
                      ref={envBtnRef}
                      className="topbar-env-btn"
                      onClick={() => {
                        const rect = envBtnRef.current?.getBoundingClientRect()
                        if (rect) setEnvDropdownPos({ top: rect.bottom + 6, left: rect.left })
                        setEnvDropdownOpen(o => !o)
                      }}
                      title="환경 변경"
                    >
                      <span className="topbar-bc-env-dot" style={{ background: activeProjectEnv.color }} />
                      <span className="topbar-bc-env" style={{ color: activeProjectEnv.color }}>{activeProjectEnv.name}</span>
                      <IcoChevD size={10} style={{ color: 'var(--text-4)', marginLeft: 2 }} />
                    </button>
                  </div>
                )}
                <span className="topbar-bc-sep topbar-bc-divider">|</span>
                <span className="topbar-bc-ws">{activeProjectWs?.name}</span>
                <span className="topbar-bc-sep">›</span>
                <span className="topbar-bc-proj">{activeProject.name}</span>
              </div>
            )}
          </div>
          <div className="topbar-right no-drag">
            <button className="btn ghost icon" onClick={toggleTheme} title={theme === 'dark' ? '라이트 테마' : '다크 테마'}>
              {theme === 'dark' ? <IcoSun size={15} /> : <IcoMoon size={15} />}
            </button>
            <button className="btn" onClick={() => {}}>
              <IcoSave size={14} />
              저장
            </button>
            {Object.keys(nodeStatuses).length > 0 ? (
              <button className="btn" onClick={handleCanvasReset}>
                <IcoReset size={13} />
                초기화
              </button>
            ) : (
              <button className="btn primary" onClick={handleCanvasRun}>
                <IcoPlay size={13} />
                실행
              </button>
            )}
          </div>
        </header>

        <div className="workspace-body">
          {activeProject ? (
            <div className="canvas-wrap">
              <div className="canvas-bg" />
              <WorkflowCanvas
                  nodes={activeNodes}
                  edges={activeEdges}
                  onNodeMove={handleNodeMove}
                  onEdgeCreate={handleEdgeCreate}
                  onEdgeDelete={id => setConfirmDeleteEdge(activeEdges.find(e => e.id === id) ?? null)}
                  onEdgeReconnect={handleEdgeReconnect}
                  onNodeRun={handleNodeRun}
                  onNodeOpen={handleNodeOpen}
                  onModuleDrop={handleModuleDrop}
                  nodeStatuses={nodeStatuses}
                  onNodeStatusClick={onNodeStatusClick}
                  activeProjectWsId={activeProjectWs?.id}
                />
            </div>
          ) : (
            <div className="workspace-empty">
              <span>프로젝트를 선택하거나 추가하세요</span>
            </div>
          )}
        </div>

        <div className={`log-panel ${logState === 'collapsed' ? 'log-panel-collapsed' : 'log-panel-fullscreen'}`}>
          <div className="log-hd" onClick={toggleLog}>
            <IcoPanelB size={13} style={{ color: 'var(--text-3)' }} />
            <span className="log-title">실행 로그</span>
            <span className="log-spacer" />
            <IcoChevD
              size={14}
              style={{
                color: 'var(--text-3)',
                transform: logState === 'fullscreen' ? 'rotate(180deg)' : 'none',
                transition: 'transform 0.15s'
              }}
            />
          </div>
          {logState === 'fullscreen' && (
            <div className="log-body">
              {execLogs.length === 0 ? (
                <span className="log-empty">실행하면 로그가 표시됩니다</span>
              ) : (
                <div className="log-entries">
                  {execLogs.map(entry => (
                    <LogEntryRow key={entry.id} entry={entry} isActive={activeLogNodeId === entry.nodeId} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Env Dropdown (fixed) ── */}
      {envDropdownOpen && activeProjectWs && (
        <div
          ref={envDropdownRef}
          className="topbar-env-dropdown"
          style={{ position: 'fixed', top: envDropdownPos.top, left: envDropdownPos.left }}
        >
          {activeProjectWs.environments.map(env => (
            <button
              key={env.id}
              className={`topbar-env-option${env.id === activeProjectWs.activeEnvId ? ' topbar-env-option-active' : ''}`}
              onClick={() => { setActiveEnvId(activeProjectWs.id, env.id); setEnvDropdownOpen(false) }}
            >
              <span className="topbar-bc-env-dot" style={{ background: env.color }} />
              <span>{env.name}</span>
            </button>
          ))}
        </div>
      )}

      {/* ── Workspace Modal ── */}
      {modalWorkspace !== null && (
        <WorkspaceModal
          workspace={modalWorkspace.workspace}
          environments={modalWorkspace.workspace ? workspaces.find(w => w.id === modalWorkspace.workspace!.id)?.environments : undefined}
          projects={modalWorkspace.workspace ? workspaces.find(w => w.id === modalWorkspace.workspace!.id)?.projects : undefined}
          onSave={saveWorkspace}
          onClose={() => setModalWorkspace(null)}
        />
      )}

      {/* ── Env Modal ── */}
      {modalEnv !== undefined && (
        <EnvModal env={modalEnv} onSave={saveEnv} onClose={closeEnvModal} />
      )}

      {/* ── Project Modal ── */}
      {modalProject !== null && (
        <ProjectModal
          project={modalProject.project}
          onSave={saveProject}
          onClose={closeProjectModal}
        />
      )}

      {/* ── Workspace Delete Confirm ── */}
      {confirmDeleteWsId && (() => {
        const ws = workspaces.find(w => w.id === confirmDeleteWsId)
        return ws ? (
          <ConfirmDialog
            title="워크스페이스 삭제"
            message={`"${ws.name}" 워크스페이스를 삭제하시겠습니까?`}
            warning="이 작업은 되돌릴 수 없으며, 워크스페이스에 포함된 모든 Environment와 Project가 함께 삭제됩니다."
            onConfirm={deleteWorkspace}
            onCancel={() => setConfirmDeleteWsId(null)}
          />
        ) : null
      })()}

      {/* ── Env Delete Confirm ── */}
      {confirmDeleteEnv && (
        <ConfirmDialog
          title="환경 삭제"
          message={`"${confirmDeleteEnv.env.name}" 환경을 삭제하시겠습니까?`}
          warning="이 작업은 되돌릴 수 없으며, 환경에 포함된 모든 변수가 함께 삭제됩니다."
          onConfirm={deleteEnv}
          onCancel={() => setConfirmDeleteEnv(null)}
        />
      )}

      {/* ── Project Delete Confirm ── */}
      {confirmDeleteProject && (
        <ConfirmDialog
          title="프로젝트 삭제"
          message={`"${confirmDeleteProject.project.name}" 프로젝트를 삭제하시겠습니까?`}
          warning="이 작업은 되돌릴 수 없으며, 프로젝트에 포함된 모든 데이터가 함께 삭제됩니다."
          onConfirm={deleteProject}
          onCancel={() => setConfirmDeleteProject(null)}
        />
      )}

      {/* ── Node Settings Modal ── */}
      {editingNode?.type === 'start' && (
        <StartNodeModal
          node={editingNode}
          onSave={handleNodeSave}
          onClose={() => setEditingNode(null)}
        />
      )}

      {editingNode?.type === 'data' && (
        <DataNodeModal
          node={editingNode}
          initialInput={nodeRunInputs[editingNode.id]}
          onRun={() => {
            const inEdge = activeEdges.find(e => e.targetNodeId === editingNode.id)
            return inEdge ? executeNodeOutput(inEdge.sourceNodeId, activeNodes, activeEdges) : ''
          }}
          onSave={handleDataNodeSave}
          onDelete={async () => {
            // 모듈 연결 노드는 캔버스에서 인스턴스만 제거 (모듈 자체는 유지)
            await window.api.node.delete(editingNode.id)
            setActiveNodes(prev => prev.filter(n => n.id !== editingNode.id))
            setActiveEdges(prev => prev.filter(e => e.sourceNodeId !== editingNode.id && e.targetNodeId !== editingNode.id))
            setEditingNode(null)
          }}
          onClose={() => setEditingNode(null)}
        />
      )}

      {editingNode?.type === 'select' && (
        <SelectNodeModal
          node={editingNode}
          initialInput={nodeRunInputs[editingNode.id]}
          onRun={() => {
            const inEdge = activeEdges.find(e => e.targetNodeId === editingNode.id)
            return inEdge ? executeNodeOutput(inEdge.sourceNodeId, activeNodes, activeEdges) : ''
          }}
          onSave={handleDataNodeSave}
          onDelete={async () => {
            await window.api.node.delete(editingNode.id)
            setActiveNodes(prev => prev.filter(n => n.id !== editingNode.id))
            setActiveEdges(prev => prev.filter(e => e.sourceNodeId !== editingNode.id && e.targetNodeId !== editingNode.id))
            setEditingNode(null)
          }}
          onClose={() => setEditingNode(null)}
        />
      )}

      {editingNode?.type === 'api' && (
        <ApiNodeModal
          node={editingNode}
          initialInput={nodeRunInputs[editingNode.id]}
          initialOutput={nodeRunOutputs[editingNode.id]}
          envVars={(() => {
            const ws = workspaces.find(w => w.id === activeWsId)
            return ws
              ? mergeEnvVars(
                  ws.environments as Array<{ id: string; isBase: boolean; vars: Array<{ key: string; value: string; enabled: boolean }> }>,
                  ws.activeEnvId,
                )
              : {}
          })()}
          onRun={() => {
            const inEdge = activeEdges.find(e => e.targetNodeId === editingNode.id)
            return inEdge ? executeNodeOutput(inEdge.sourceNodeId, activeNodes, activeEdges) : ''
          }}
          onSave={handleDataNodeSave}
          onDelete={async () => {
            await window.api.node.delete(editingNode.id)
            setActiveNodes(prev => prev.filter(n => n.id !== editingNode.id))
            setActiveEdges(prev => prev.filter(e => e.sourceNodeId !== editingNode.id && e.targetNodeId !== editingNode.id))
            setEditingNode(null)
          }}
          onClose={() => setEditingNode(null)}
        />
      )}

      {newModuleCtx && newModuleCtx.type === 'data' && (
        <DataNodeModal
          node={{ id: '__new__', projectId: '', type: 'data', label: 'Data', x: 0, y: 0, config: '{}' }}
          isNew
          onSave={async (_, label, config) => {
            if (newModuleCtx.wsId) {
              await window.api.module.create(newModuleCtx.wsId, newModuleCtx.type, label, config)
            } else {
              await window.api.module.createCommon(newModuleCtx.type, label, config)
            }
            const mods = await window.api.module.listAll()
            setAllModules(mods)
            setNewModuleCtx(null)
          }}
          onClose={() => setNewModuleCtx(null)}
        />
      )}

      {newModuleCtx && newModuleCtx.type === 'api' && (
        <ApiNodeModal
          node={{ id: '__new__', projectId: '', type: 'api', label: 'API', x: 0, y: 0, config: '{}' }}
          isNew
          envVars={(() => {
            const ws = workspaces.find(w => w.id === activeWsId)
            return ws
              ? mergeEnvVars(
                  ws.environments as Array<{ id: string; isBase: boolean; vars: Array<{ key: string; value: string; enabled: boolean }> }>,
                  ws.activeEnvId,
                )
              : {}
          })()}
          onSave={async (_, label, config) => {
            if (newModuleCtx.wsId) {
              await window.api.module.create(newModuleCtx.wsId, newModuleCtx.type, label, config)
            } else {
              await window.api.module.createCommon(newModuleCtx.type, label, config)
            }
            const mods = await window.api.module.listAll()
            setAllModules(mods)
            setNewModuleCtx(null)
          }}
          onClose={() => setNewModuleCtx(null)}
        />
      )}

      {newModuleCtx && newModuleCtx.type === 'select' && (
        <SelectNodeModal
          node={{ id: '__new__', projectId: '', type: 'select', label: 'Select', x: 0, y: 0, config: '{}' }}
          isNew
          onSave={async (_, label, config) => {
            if (newModuleCtx.wsId) {
              await window.api.module.create(newModuleCtx.wsId, newModuleCtx.type, label, config)
            } else {
              await window.api.module.createCommon(newModuleCtx.type, label, config)
            }
            const mods = await window.api.module.listAll()
            setAllModules(mods)
            setNewModuleCtx(null)
          }}
          onClose={() => setNewModuleCtx(null)}
        />
      )}

      {/* ── Canvas Execution SelectionPopup ── */}
      {canvasExecution?.pendingSelectInput !== null && canvasExecution !== null && (
        <SelectionPopup
          data={canvasExecution.pendingSelectInput as Record<string, unknown>[] ?? []}
          onConfirm={(selectedRows) => {
            advanceExecution(canvasExecution, selectedRows)
          }}
          onCancel={() => setCanvasExecution(null)}
        />
      )}

      {/* ── Module Edit Modals (from sidebar double-click) ── */}
      {editingModule && editingModule.type === 'data' && (
        <DataNodeModal
          node={{ id: editingModule.id, projectId: '', type: 'data', label: editingModule.label, x: 0, y: 0, config: editingModule.config, moduleId: editingModule.id }}
          onSave={async (_, label, config) => {
            await handleModuleUpdate(editingModule.id, label, config)
            setEditingModule(null)
          }}
          onDelete={async () => {
            await handleDeleteModule(editingModule.id)
            setEditingModule(null)
          }}
          onClose={() => setEditingModule(null)}
        />
      )}
      {editingModule && editingModule.type === 'select' && (
        <SelectNodeModal
          node={{ id: editingModule.id, projectId: '', type: 'select', label: editingModule.label, x: 0, y: 0, config: editingModule.config, moduleId: editingModule.id }}
          onSave={async (_, label, config) => {
            await handleModuleUpdate(editingModule.id, label, config)
            setEditingModule(null)
          }}
          onDelete={async () => {
            await handleDeleteModule(editingModule.id)
            setEditingModule(null)
          }}
          onClose={() => setEditingModule(null)}
        />
      )}
      {editingModule && editingModule.type === 'api' && (
        <ApiNodeModal
          node={{ id: editingModule.id, projectId: '', type: 'api', label: editingModule.label, x: 0, y: 0, config: editingModule.config, moduleId: editingModule.id }}
          envVars={(() => {
            const ws = workspaces.find(w => w.id === activeWsId)
            return ws ? mergeEnvVars(ws.environments, ws.activeEnvId) : {}
          })()}
          onSave={async (_, label, config) => {
            await handleModuleUpdate(editingModule.id, label, config)
            setEditingModule(null)
          }}
          onDelete={async () => {
            await handleDeleteModule(editingModule.id)
            setEditingModule(null)
          }}
          onClose={() => setEditingModule(null)}
        />
      )}

      {/* ── Edge Delete Confirm ── */}
      {confirmDeleteEdge && (
        <ConfirmDialog
          title="연결 삭제"
          message="이 연결선을 삭제하시겠습니까?"
          warning="삭제된 연결은 복구할 수 없습니다."
          onConfirm={deleteEdge}
          onCancel={() => setConfirmDeleteEdge(null)}
        />
      )}

      {/* ── Icon Tooltip ── */}
      {iconTooltip && (
        <div
          className="sidebar-icon-tooltip"
          style={{ top: iconTooltip.y, left: iconTooltip.x }}
        >
          {iconTooltip.text}
        </div>
      )}
    </div>
  )
}
