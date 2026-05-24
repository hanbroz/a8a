import { useRef, useState, useEffect } from 'react'
import { IcoChevD, IcoTrash } from '../Icon'
import { useSidebarOpen } from '../../hooks/useSidebarOpen'

interface Props {
  stateKey?: string
  title?: string
  modules: ApiModule[]
  onAdd: (type: string) => void
  onEdit: (module: ApiModule) => void
  onSetCommon: (id: string, isCommon: boolean) => void
  onDelete: (id: string) => void
}

// ── Type config ───────────────────────────────────
const MODULE_TYPES = [
  { type: 'data',   label: 'DATA',   color: '#1f6feb', bg: 'rgba(31,111,235,0.14)',  soon: false },
  { type: 'select', label: 'SELECT', color: '#8957e5', bg: 'rgba(137,87,229,0.14)', soon: false },
  { type: 'api',    label: 'API',    color: '#3fb950', bg: 'rgba(63,185,80,0.14)',   soon: false },
]

function getTypeConfig(type: string) {
  return MODULE_TYPES.find(t => t.type === type) ?? MODULE_TYPES[0]
}

// ── Icons ─────────────────────────────────────────
function DataIcon(): JSX.Element {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5" />
      <path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3" />
    </svg>
  )
}

function SelectIcon(): JSX.Element {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  )
}

function ApiIcon(): JSX.Element {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  )
}

function GlobeIcon(): JSX.Element {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  )
}

function TypeIcon({ type }: { type: string }): JSX.Element {
  if (type === 'select') return <SelectIcon />
  if (type === 'api') return <ApiIcon />
  return <DataIcon />
}

// ── Type picker dropdown ──────────────────────────
function TypeMenu({ onSelect, onClose }: { onSelect: (type: string) => void; onClose: () => void }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return (
    <div className="module-type-menu" ref={ref}>
      {MODULE_TYPES.map(t => (
        <button
          key={t.type}
          className={`module-type-item${t.soon ? ' module-type-item-soon' : ''}`}
          onClick={() => { if (!t.soon) { onSelect(t.type); onClose() } }}
          title={t.soon ? '준비 중' : t.label}
        >
          <div className="module-type-item-icon" style={{ background: t.bg, color: t.color }}>
            <TypeIcon type={t.type} />
          </div>
          <span className="module-type-item-label" style={{ color: t.soon ? 'var(--text-4)' : 'var(--text-1)' }}>
            {t.label}
          </span>
          {t.soon && <span className="module-type-item-soon-badge">준비 중</span>}
        </button>
      ))}
    </div>
  )
}

// ── Main component ────────────────────────────────
export default function ModuleSection({ stateKey, title = 'Module', modules, onAdd, onEdit, onSetCommon, onDelete }: Props): JSX.Element {
  const [open, toggleOpen] = useSidebarOpen(stateKey ?? 'module')
  const [showMenu, setShowMenu] = useState(false)
  const addBtnRef = useRef<HTMLButtonElement>(null)

  return (
    <div className="sidebar-section" style={{ position: 'relative' }}>
      <div className="sidebar-section-hd" onClick={toggleOpen}>
        <IcoChevD
          size={11}
          style={{
            color: 'var(--text-3)',
            transform: open ? 'none' : 'rotate(-90deg)',
            transition: 'transform 0.15s',
            flexShrink: 0
          }}
        />
        <span className="sidebar-section-title">{title}</span>
        <button
          ref={addBtnRef}
          className="btn ghost icon sidebar-section-add"
          onClick={e => { e.stopPropagation(); setShowMenu(v => !v) }}
          title="모듈 추가"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>

      {showMenu && (
        <TypeMenu
          onSelect={type => { onAdd(type); setShowMenu(false) }}
          onClose={() => setShowMenu(false)}
        />
      )}

      {open && (
        <div className="sidebar-section-body">
          {modules.length === 0 ? (
            <div className="sidebar-empty-hint">모듈을 추가하세요</div>
          ) : (
            modules.map(mod => {
              const cfg = getTypeConfig(mod.type)
              return (
                <div
                  key={mod.id}
                  className="module-item"
                  draggable
                  onDragStart={e => {
                    e.dataTransfer.setData('moduleId', mod.id)
                    e.dataTransfer.setData('moduleWsId', mod.workspaceId ?? '')
                  }}
                  onDoubleClick={() => onEdit(mod)}
                  title="더블클릭하여 편집"
                >
                  <div className="module-item-icon" style={{ background: cfg.bg, color: cfg.color }}>
                    <TypeIcon type={mod.type} />
                  </div>
                  <div className="module-item-info">
                    <span className="module-item-name">{mod.label}</span>
                    <span className="module-item-meta" style={{ color: cfg.color, opacity: 0.8 }}>{cfg.label}</span>
                  </div>
                  {mod.isCommon && (
                    <span className="module-item-badge">공통</span>
                  )}
                  <div className="module-item-actions">
                    <button
                      className="btn ghost icon"
                      style={{ width: 20, height: 20 }}
                      title={mod.isCommon ? '워크스페이스로' : '공통으로 설정'}
                      onClick={e => { e.stopPropagation(); onSetCommon(mod.id, !mod.isCommon) }}
                    >
                      <GlobeIcon />
                    </button>
                    <button
                      className="btn ghost icon"
                      style={{ width: 20, height: 20 }}
                      title="삭제"
                      onClick={e => { e.stopPropagation(); onDelete(mod.id) }}
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4h6v2" />
                      </svg>
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
