import { useState, useEffect, useRef, useCallback } from 'react'
import { IcoPanelL, IcoPlay, IcoSave, IcoSun, IcoMoon, IcoPanelB, IcoChevD } from './components/Icon'
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
import type { Environment } from './components/env/EnvSection'
import type { ProjectItem } from './components/sidebar/ProjectModal'
import type { WorkspaceModalItem } from './components/sidebar/WorkspaceModal'

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
  activeProjectId: string
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
  const [loading, setLoading] = useState(true)

  const [activeNodes, setActiveNodes] = useState<ApiNode[]>([])
  const [activeEdges, setActiveEdges] = useState<ApiEdge[]>([])
  const [confirmDeleteEdge, setConfirmDeleteEdge] = useState<ApiEdge | null>(null)
  const [editingNode, setEditingNode] = useState<ApiNode | null>(null)

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
            return {
              id: ws.id,
              name: ws.name,
              description: ws.description ?? '',
              environments: envs as Environment[],
              activeEnvId: baseEnv?.id ?? envs[0]?.id ?? '',
              projects: projects as ProjectItem[],
              activeProjectId: projects[0]?.id ?? ''
            }
          })
        )
        setWorkspaces(all)
        if (all.length > 0) setActiveWsId(all[0].id)
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
  const activeProject = activeWs?.projects.find(p => p.id === activeWs.activeProjectId)
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

  const deleteEdge = async (): Promise<void> => {
    if (!confirmDeleteEdge) return
    await window.api.edge.delete(confirmDeleteEdge.id)
    setActiveEdges(prev => prev.filter(e => e.id !== confirmDeleteEdge.id))
    setConfirmDeleteEdge(null)
  }

  const toggleTheme = (): void => setTheme(t => (t === 'dark' ? 'light' : 'dark'))
  const toggleLog = (): void => setLogState(s => (s === 'collapsed' ? 'fullscreen' : 'collapsed'))

  const setActiveEnvId = (wsId: string, envId: string): void => {
    setWorkspaces(prev => prev.map(w => w.id === wsId ? { ...w, activeEnvId: envId } : w))
  }

  const setActiveProjectId = (wsId: string, projectId: string): void => {
    setWorkspaces(prev => prev.map(w => w.id === wsId ? { ...w, activeProjectId: projectId } : w))
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
        projects: projects as ProjectItem[],
        activeProjectId: projects[0]?.id ?? ''
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
      setWorkspaces(prev => prev.map(w => {
        if (w.id !== wsId) return w
        const newProject = created as ProjectItem
        return { ...w, projects: [...w.projects, newProject], activeProjectId: newProject.id }
      }))
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
      const activeProjectId = w.activeProjectId === project.id ? (next[0]?.id ?? '') : w.activeProjectId
      return { ...w, projects: next, activeProjectId }
    }))
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
                      className={`sidebar-proj-icon${ws.id === activeWsId && proj.id === ws.activeProjectId ? ' sidebar-proj-icon-active' : ''}`}
                      onMouseEnter={e => {
                        const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect()
                        setIconTooltip({ text: `${ws.name} › ${proj.name}`, x: rect.right + 8, y: rect.top + rect.height / 2 })
                      }}
                      onMouseLeave={() => setIconTooltip(null)}
                      onClick={() => { setActiveWsId(ws.id); setActiveProjectId(ws.id, proj.id) }}
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
                      activeProjectId={ws?.activeProjectId ?? ''}
                      onSelect={(id) => { setActiveWsId(wsId); setActiveProjectId(wsId, id) }}
                      onAdd={() => openAddProjectModal(wsId)}
                      onEdit={(proj) => openEditProjectModal(wsId, proj)}
                      onDelete={(proj) => setConfirmDeleteProject({ wsId, project: proj })}
                    />
                  </>
                )
              }}
            />
            <ModuleSection />
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
                {activeEnv && activeWs && (
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
                      <span className="topbar-bc-env-dot" style={{ background: activeEnv.color }} />
                      <span className="topbar-bc-env" style={{ color: activeEnv.color }}>{activeEnv.name}</span>
                      <IcoChevD size={10} style={{ color: 'var(--text-4)', marginLeft: 2 }} />
                    </button>
                  </div>
                )}
                <span className="topbar-bc-sep topbar-bc-divider">|</span>
                <span className="topbar-bc-ws">{activeWs?.name}</span>
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
            <button className="btn primary">
              <IcoPlay size={13} />
              실행
            </button>
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
                  onNodeOpen={handleNodeOpen}
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
            <div className="log-body">로그 패널 — 다음 단계에서 구성합니다</div>
          )}
        </div>
      </div>

      {/* ── Env Dropdown (fixed) ── */}
      {envDropdownOpen && activeWs && (
        <div
          ref={envDropdownRef}
          className="topbar-env-dropdown"
          style={{ position: 'fixed', top: envDropdownPos.top, left: envDropdownPos.left }}
        >
          {activeWs.environments.map(env => (
            <button
              key={env.id}
              className={`topbar-env-option${env.id === activeWs.activeEnvId ? ' topbar-env-option-active' : ''}`}
              onClick={() => { setActiveEnvId(activeWsId, env.id); setEnvDropdownOpen(false) }}
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
