import { IcoChevD, IcoPlus } from '../Icon'
import { useSidebarOpen } from '../../hooks/useSidebarOpen'

export default function ProjectSection(): JSX.Element {
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
          onClick={e => e.stopPropagation()}
          title="프로젝트 추가"
        >
          <IcoPlus size={13} />
        </button>
      </div>

      {open && (
        <div className="sidebar-section-body">
          <div className="sidebar-empty-hint">프로젝트를 추가하세요</div>
        </div>
      )}
    </div>
  )
}
