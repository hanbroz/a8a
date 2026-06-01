import { useRef, useState, useEffect, useMemo } from 'react'
import type { DragEvent } from 'react'
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
  onReorderCommon?: (type: string, orderedIds: string[]) => void
  groupByType?: boolean
}

// ── Type config ───────────────────────────────────
const MODULE_TYPES = [
  { type: 'data',   label: 'DATA',   color: '#1f6feb', bg: 'rgba(31,111,235,0.14)',  soon: false },
  { type: 'select', label: 'SELECT', color: '#8957e5', bg: 'rgba(137,87,229,0.14)', soon: false },
  { type: 'branch', label: 'BRANCH', color: '#d29922', bg: 'rgba(210,153,34,0.14)', soon: false },
  { type: 'api',    label: 'API',    color: '#3fb950', bg: 'rgba(63,185,80,0.14)',   soon: false },
]

function getTypeConfig(type: string) {
  return MODULE_TYPES.find(t => t.type === type) ?? {
    type,
    label: type.toUpperCase(),
    color: '#8b949e',
    bg: 'rgba(139,148,158,0.14)',
    soon: false,
  }
}

// ── Icons ─────────────────────────────────────────
function apiMethodColor(method: string): string {
  switch (method.toUpperCase()) {
    case 'GET': return '#3fb950'
    case 'POST': return '#2f81f7'
    case 'PUT': return '#d29922'
    case 'PATCH': return '#a371f7'
    case 'DELETE': return '#f85149'
    default: return '#8b949e'
  }
}

function apiDisplayUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return 'URL 미설정'
  const withoutLeadingEnv = trimmed.replace(/^\{\{\s*[^}]+?\s*\}\}/, '').trim()
  return withoutLeadingEnv || '/'
}

function parseApiMeta(config: string): { method: string; url: string; color: string } {
  try {
    const parsed = JSON.parse(config || '{}') as Partial<ApiConfig>
    const method = typeof parsed.method === 'string' && parsed.method.trim()
      ? parsed.method.trim().toUpperCase()
      : 'GET'
    const url = typeof parsed.url === 'string' ? parsed.url : ''
    return { method, url: apiDisplayUrl(url), color: apiMethodColor(method) }
  } catch {
    return { method: 'GET', url: 'URL 미설정', color: apiMethodColor('GET') }
  }
}

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

function BranchIcon(): JSX.Element {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="3" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="18" cy="18" r="3" />
      <path d="M8.6 7.4 15.4 16.6" />
      <path d="M9 6h6" />
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
  if (type === 'branch') return <BranchIcon />
  if (type === 'api') return <ApiIcon />
  return <DataIcon />
}

function ModuleItem({
  mod,
  nested = false,
  onEdit,
  onSetCommon,
  onDelete,
  reorderEnabled = false,
  isDragging = false,
  isDropTarget = false,
  onReorderDragStart,
  onReorderDragOver,
  onReorderDrop,
  onReorderDragEnd,
}: {
  mod: ApiModule
  nested?: boolean
  onEdit: (module: ApiModule) => void
  onSetCommon: (id: string, isCommon: boolean) => void
  onDelete: (id: string) => void
  reorderEnabled?: boolean
  isDragging?: boolean
  isDropTarget?: boolean
  onReorderDragStart?: (e: DragEvent<HTMLDivElement>) => void
  onReorderDragOver?: (e: DragEvent<HTMLDivElement>) => void
  onReorderDrop?: (e: DragEvent<HTMLDivElement>) => void
  onReorderDragEnd?: () => void
}): JSX.Element {
  const cfg = getTypeConfig(mod.type)
  const apiMeta = mod.type === 'api' ? parseApiMeta(mod.config) : null
  return (
    <div
      className={`module-item${nested ? ' module-item-nested' : ''}${isDragging ? ' module-item-dragging' : ''}${isDropTarget ? ' module-item-drop-target' : ''}`}
      draggable
      onDragStart={e => {
        e.dataTransfer.setData('moduleId', mod.id)
        e.dataTransfer.setData('moduleWsId', mod.workspaceId ?? '')
        if (reorderEnabled) {
          e.dataTransfer.setData('moduleReorderId', mod.id)
          e.dataTransfer.setData('moduleReorderType', mod.type)
          e.dataTransfer.effectAllowed = 'copyMove'
          onReorderDragStart?.(e)
        }
      }}
      onDragOver={reorderEnabled ? onReorderDragOver : undefined}
      onDrop={reorderEnabled ? onReorderDrop : undefined}
      onDragEnd={reorderEnabled ? onReorderDragEnd : undefined}
      onDoubleClick={() => onEdit(mod)}
      title="더블클릭하여 편집"
    >
      <div className="module-item-icon" style={{ background: cfg.bg, color: cfg.color }}>
        <TypeIcon type={mod.type} />
      </div>
      <div className="module-item-info">
        <span className="module-item-name">{mod.label}</span>
        {apiMeta ? (
          <span className="module-item-api-meta">
            <span className="module-item-api-method" style={{ color: apiMeta.color }}>[{apiMeta.method}]</span>
            <span className="module-item-api-url">{apiMeta.url}</span>
          </span>
        ) : (
          <span className="module-item-meta" style={{ color: cfg.color, opacity: 0.8 }}>{cfg.label}</span>
        )}
      </div>
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
          <IcoTrash size={10} />
        </button>
      </div>
    </div>
  )
}

function ModuleTypeGroup({
  stateKey,
  type,
  modules,
  onEdit,
  onSetCommon,
  onDelete,
  onReorderCommon,
}: {
  stateKey: string
  type: string
  modules: ApiModule[]
  onEdit: (module: ApiModule) => void
  onSetCommon: (id: string, isCommon: boolean) => void
  onDelete: (id: string) => void
  onReorderCommon?: (type: string, orderedIds: string[]) => void
}): JSX.Element {
  const cfg = getTypeConfig(type)
  const [open, toggleOpen] = useSidebarOpen(`${stateKey}-group-${type}`, false)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const reorderEnabled = !!onReorderCommon

  const endReorderDrag = () => {
    setDraggingId(null)
    setDropTargetId(null)
  }

  const dropOnModule = (targetId: string, e: DragEvent<HTMLDivElement>) => {
    if (!reorderEnabled || !draggingId || draggingId === targetId) {
      endReorderDrag()
      return
    }
    e.preventDefault()
    e.stopPropagation()
    const ids = modules.map(mod => mod.id)
    const from = ids.indexOf(draggingId)
    const to = ids.indexOf(targetId)
    if (from < 0 || to < 0) {
      endReorderDrag()
      return
    }
    const next = ids.filter(id => id !== draggingId)
    next.splice(to, 0, draggingId)
    onReorderCommon?.(type, next)
    endReorderDrag()
  }

  return (
    <div className="module-type-group">
      <button className="module-type-group-hd" type="button" onClick={toggleOpen}>
        <IcoChevD
          size={11}
          style={{
            color: 'var(--text-3)',
            transform: open ? 'none' : 'rotate(-90deg)',
            transition: 'transform 0.15s',
            flexShrink: 0,
          }}
        />
        <span className="module-type-group-icon" style={{ background: cfg.bg, color: cfg.color }}>
          <TypeIcon type={type} />
        </span>
        <span className="module-type-group-name">{cfg.label}</span>
        <span className="module-type-group-count">{modules.length}</span>
      </button>
      {open && (
        <div className="module-type-group-body">
          {modules.map(mod => (
            <ModuleItem
              key={mod.id}
              mod={mod}
              nested
              onEdit={onEdit}
              onSetCommon={onSetCommon}
              onDelete={onDelete}
              reorderEnabled={reorderEnabled}
              isDragging={draggingId === mod.id}
              isDropTarget={dropTargetId === mod.id && draggingId !== mod.id}
              onReorderDragStart={() => setDraggingId(mod.id)}
              onReorderDragOver={e => {
                if (!draggingId || draggingId === mod.id) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                setDropTargetId(mod.id)
              }}
              onReorderDrop={e => dropOnModule(mod.id, e)}
              onReorderDragEnd={endReorderDrag}
            />
          ))}
        </div>
      )}
    </div>
  )
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
export default function ModuleSection({ stateKey, title = 'Module', modules, onAdd, onEdit, onSetCommon, onDelete, onReorderCommon, groupByType = false }: Props): JSX.Element {
  const [open, toggleOpen] = useSidebarOpen(stateKey ?? 'module')
  const [showMenu, setShowMenu] = useState(false)
  const addBtnRef = useRef<HTMLButtonElement>(null)
  const sectionKey = stateKey ?? 'module'
  const groupedModules = useMemo(() => {
    const byType = new Map<string, ApiModule[]>()
    modules.forEach(mod => {
      byType.set(mod.type, [...(byType.get(mod.type) ?? []), mod])
    })
    const ordered = MODULE_TYPES
      .map(({ type }) => ({ type, modules: byType.get(type) ?? [] }))
      .filter(group => group.modules.length > 0)
    const knownTypes = new Set(MODULE_TYPES.map(({ type }) => type))
    const unknown = Array.from(byType.entries())
      .filter(([type]) => !knownTypes.has(type))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([type, groupModules]) => ({ type, modules: groupModules }))
    return [...ordered, ...unknown]
  }, [modules])

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
          ) : groupByType ? (
            groupedModules.map(group => (
              <ModuleTypeGroup
                key={group.type}
                stateKey={sectionKey}
                type={group.type}
                modules={group.modules}
                onEdit={onEdit}
                onSetCommon={onSetCommon}
                onDelete={onDelete}
                onReorderCommon={onReorderCommon}
              />
            ))
          ) : (
            modules.map(mod => (
              <ModuleItem
                key={mod.id}
                mod={mod}
                onEdit={onEdit}
                onSetCommon={onSetCommon}
                onDelete={onDelete}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}
