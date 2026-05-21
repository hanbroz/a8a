import { useState, useEffect } from 'react'
import { IcoPanelL, IcoPlay, IcoSave, IcoSun, IcoMoon, IcoPanelB, IcoChevD } from './components/Icon'
import WorkspaceHeader from './components/sidebar/WorkspaceHeader'
import ModuleSection from './components/sidebar/ModuleSection'
import ProjectSection from './components/sidebar/ProjectSection'
import EnvSection from './components/env/EnvSection'
import EnvModal from './components/env/EnvModal'
import ConfirmDialog from './components/ConfirmDialog'
import type { Environment } from './components/env/EnvSection'

type Theme = 'dark' | 'light'
type SidebarLayout = 'full' | 'icons'
type LogState = 'collapsed' | 'fullscreen'

type Workspace = {
  id: string
  name: string
  environments: Environment[]
  activeEnvId: string
}

export default function App(): JSX.Element {
  const [theme, setTheme] = useState<Theme>('dark')
  const [sidebarLayout, setSidebarLayout] = useState<SidebarLayout>('full')
  const [logState, setLogState] = useState<LogState>('collapsed')

  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [activeWsId, setActiveWsId] = useState<string>('')
  const [loading, setLoading] = useState(true)

  const [modalEnv, setModalEnv] = useState<Environment | null | undefined>(undefined)
  const [modalWsId, setModalWsId] = useState<string>('')
  const [confirmDeleteWsId, setConfirmDeleteWsId] = useState<string | null>(null)

  // ── Load from DB on mount ──
  useEffect(() => {
    async function init(): Promise<void> {
      const wsList = await window.api.workspace.list()
      const all = await Promise.all(
        wsList.map(async (ws) => {
          const envs = await window.api.environment.list(ws.id)
          const baseEnv = envs.find(e => e.isBase)
          return {
            id: ws.id,
            name: ws.name,
            environments: envs as Environment[],
            activeEnvId: baseEnv?.id ?? envs[0]?.id ?? ''
          }
        })
      )
      setWorkspaces(all)
      if (all.length > 0) setActiveWsId(all[0].id)
      setLoading(false)
    }
    init()
  }, [])

  const toggleTheme = (): void => setTheme(t => (t === 'dark' ? 'light' : 'dark'))
  const toggleLog = (): void => setLogState(s => (s === 'collapsed' ? 'fullscreen' : 'collapsed'))

  const isFull = sidebarLayout === 'full'

  const setActiveEnvId = (wsId: string, envId: string): void => {
    setWorkspaces(prev => prev.map(w => w.id === wsId ? { ...w, activeEnvId: envId } : w))
  }

  const addWorkspace = async (name: string): Promise<void> => {
    const ws = await window.api.workspace.create(name)
    const envs = await window.api.environment.list(ws.id)
    const baseEnv = envs.find((e) => (e as ApiEnv).isBase)
    setWorkspaces(prev => [...prev, {
      id: ws.id,
      name: ws.name,
      environments: envs as Environment[],
      activeEnvId: baseEnv?.id ?? envs[0]?.id ?? ''
    }])
    setActiveWsId(ws.id)
  }

  const deleteWorkspace = async (): Promise<void> => {
    if (!confirmDeleteWsId) return
    await window.api.workspace.delete(confirmDeleteWsId)
    setWorkspaces(prev => {
      const next = prev.filter(w => w.id !== confirmDeleteWsId)
      if (activeWsId === confirmDeleteWsId && next.length > 0) setActiveWsId(next[0].id)
      return next
    })
    setConfirmDeleteWsId(null)
  }

  const openAddModal = (wsId: string): void => { setModalWsId(wsId); setModalEnv(null) }
  const openEditModal = (wsId: string, env: Environment): void => { setModalWsId(wsId); setModalEnv(env) }
  const closeModal = (): void => setModalEnv(undefined)

  const saveEnv = async (env: Environment): Promise<void> => {
    await window.api.environment.upsert(modalWsId, {
      id: env.id,
      name: env.name,
      isBase: env.isBase,
      color: env.color,
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
    closeModal()
  }

  if (loading) {
    return <div className="app" data-theme={theme} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-4)', fontSize: 13 }}>로드 중…</div>
  }

  return (
    <div className="app" data-theme={theme}>
      {/* ── Sidebar ── */}
      <aside className="sidebar" data-layout={isFull ? undefined : 'icons'}>
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

        {isFull && (
          <div className="sidebar-body">
            <WorkspaceHeader
              workspaces={workspaces}
              activeId={activeWsId}
              onSelect={setActiveWsId}
              onAdd={addWorkspace}
              onDeleteRequest={setConfirmDeleteWsId}
              renderContent={(wsId) => {
                const ws = workspaces.find(w => w.id === wsId)
                return (
                  <>
                    <EnvSection
                      environments={ws?.environments ?? []}
                      activeEnvId={ws?.activeEnvId ?? ''}
                      onSelect={(envId) => setActiveEnvId(wsId, envId)}
                      onAdd={() => openAddModal(wsId)}
                      onEdit={(env) => openEditModal(wsId, env)}
                    />
                    <ProjectSection />
                  </>
                )
              }}
            />
            <ModuleSection />
          </div>
        )}
      </aside>

      {/* ── Workspace area ── */}
      <div className="workspace">
        <header className="topbar">
          <div className="topbar-left no-drag">
            <span className="project-title">새 프로젝트</span>
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
          <div className="canvas-wrap">
            <div className="canvas-bg" />
            <div className="canvas-placeholder">
              캔버스 — 다음 단계에서 노드를 추가합니다
            </div>
          </div>
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

      {/* ── Env Modal ── */}
      {modalEnv !== undefined && (
        <EnvModal env={modalEnv} onSave={saveEnv} onClose={closeModal} />
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
    </div>
  )
}
