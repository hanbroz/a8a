import { IcoChevD, IcoPlus, IcoPencil, IcoTrash } from '../Icon'
import { useSidebarOpen } from '../../hooks/useSidebarOpen'
import type { ProjectItem } from './ProjectModal'

interface Props {
  projects: ProjectItem[]
  activeProjectId: string
  onSelect: (id: string) => void
  onAdd: () => void
  onEdit: (project: ProjectItem) => void
  onDelete: (project: ProjectItem) => void
}

export default function ProjectSection({ projects, activeProjectId, onSelect, onAdd, onEdit, onDelete }: Props): JSX.Element {
  const [open, toggleOpen] = useSidebarOpen('project')

  return (
    <div className="sidebar-section">
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
        <span className="sidebar-section-title">Project</span>
        <button
          className="btn ghost icon sidebar-section-add"
          onClick={e => { e.stopPropagation(); onAdd() }}
          title="프로젝트 추가"
        >
          <IcoPlus size={13} />
        </button>
      </div>

      {open && (
        <div className="sidebar-section-body">
          {projects.length === 0 ? (
            <div className="sidebar-empty-hint">프로젝트를 추가하세요</div>
          ) : (
            projects.map(proj => (
              <div
                key={proj.id}
                className={`env-item${activeProjectId === proj.id ? ' env-item-active proj-item-active' : ''}`}
                onClick={() => onSelect(proj.id)}
                title={proj.description || undefined}
              >
                <span className="env-item-dot" />
                <span className="env-item-name">{proj.name}</span>
                <button
                  className="btn ghost icon env-item-edit"
                  onClick={e => { e.stopPropagation(); onEdit(proj) }}
                  title="수정"
                >
                  <IcoPencil size={12} />
                </button>
                <button
                  className="btn ghost icon env-item-edit"
                  onClick={e => { e.stopPropagation(); onDelete(proj) }}
                  title="삭제"
                  style={{ color: 'var(--state-danger, #f85149)' }}
                >
                  <IcoTrash size={12} />
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
