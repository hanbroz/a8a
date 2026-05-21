import { IcoPlus, IcoChevD, IcoTrash, IcoPencil } from '../Icon'
import { useSidebarOpen } from '../../hooks/useSidebarOpen'

export type WorkspaceItem = { id: string; name: string; description: string }

interface WorkspaceRowProps {
  workspace: WorkspaceItem
  isActive: boolean
  onSelect: () => void
  onEditRequest: () => void
  onDeleteRequest: () => void
  children?: React.ReactNode
}

function WorkspaceRow({ workspace, isActive, onSelect, onEditRequest, onDeleteRequest, children }: WorkspaceRowProps): JSX.Element {
  const [open, toggleOpen] = useSidebarOpen(`ws-item-${workspace.id}`, true)

  const handleRowClick = (): void => {
    onSelect()
    toggleOpen()
  }

  return (
    <div className="ws-item">
      <div
        className={`ws-item-hd${isActive ? ' ws-item-hd-active' : ''}`}
        onClick={handleRowClick}
      >
        <IcoChevD
          size={11}
          style={{
            color: 'var(--text-3)',
            transform: open ? 'none' : 'rotate(-90deg)',
            transition: 'transform 0.15s',
            flexShrink: 0
          }}
        />
        <span className="ws-item-name">{workspace.name}</span>
        <button
          className="btn ghost icon ws-item-del"
          onClick={e => { e.stopPropagation(); onEditRequest() }}
          title="워크스페이스 수정"
        >
          <IcoPencil size={12} />
        </button>
        <button
          className="btn ghost icon ws-item-del"
          onClick={e => { e.stopPropagation(); onDeleteRequest() }}
          title="워크스페이스 삭제"
          style={{ color: 'var(--state-danger, #f85149)' }}
        >
          <IcoTrash size={12} />
        </button>
      </div>
      {open && children && (
        <div className="ws-item-body">
          {children}
        </div>
      )}
    </div>
  )
}

interface Props {
  workspaces: WorkspaceItem[]
  activeId: string
  onSelect: (id: string) => void
  onAdd: () => void
  onEditRequest: (id: string) => void
  onDeleteRequest: (id: string) => void
  renderContent: (wsId: string) => React.ReactNode
}

export default function WorkspaceHeader({ workspaces, activeId, onSelect, onAdd, onEditRequest, onDeleteRequest, renderContent }: Props): JSX.Element {
  const [open, toggleOpen] = useSidebarOpen('workspace')

  return (
    <div className="sidebar-section ws-section">
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
        <span className="sidebar-section-title">Workspace</span>
        <button
          className="btn ghost icon sidebar-section-add"
          onClick={e => { e.stopPropagation(); onAdd() }}
          title="워크스페이스 추가"
        >
          <IcoPlus size={13} />
        </button>
      </div>

      {open && (
        <>
          {workspaces.map(ws => (
            <WorkspaceRow
              key={ws.id}
              workspace={ws}
              isActive={ws.id === activeId}
              onSelect={() => onSelect(ws.id)}
              onEditRequest={() => onEditRequest(ws.id)}
              onDeleteRequest={() => onDeleteRequest(ws.id)}
            >
              {renderContent(ws.id)}
            </WorkspaceRow>
          ))}
        </>
      )}
    </div>
  )
}
