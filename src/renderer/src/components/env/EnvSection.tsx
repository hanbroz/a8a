import { IcoChevD, IcoPlus, IcoPencil } from '../Icon'
import { useSidebarOpen } from '../../hooks/useSidebarOpen'

export type EnvVar = {
  id: string
  key: string
  value: string
  enabled: boolean
}

export type Environment = {
  id: string
  name: string
  isBase: boolean
  color: string
  vars: EnvVar[]
}

interface Props {
  environments: Environment[]
  activeEnvId: string
  onSelect: (id: string) => void
  onAdd: () => void
  onEdit: (env: Environment) => void
}

export default function EnvSection({ environments, activeEnvId, onSelect, onAdd, onEdit }: Props): JSX.Element {
  const [open, toggleOpen] = useSidebarOpen('environment')

  const baseEnv = environments.find(e => e.isBase)
  const customEnvs = environments.filter(e => !e.isBase)

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
        <span className="sidebar-section-title">Environment</span>
        <button
          className="btn ghost icon sidebar-section-add"
          onClick={e => { e.stopPropagation(); onAdd() }}
          title="환경 추가"
        >
          <IcoPlus size={13} />
        </button>
      </div>

      {open && (
        <div className="sidebar-section-body">
          {baseEnv && (
            <div
              className={`env-item env-item-base${activeEnvId === baseEnv.id ? ' env-item-active' : ''}`}
              onClick={() => onSelect(baseEnv.id)}
            >
              <span className="env-item-badge">B</span>
              <span className="env-item-name">BASE</span>
              <button
                className="btn ghost icon env-item-edit"
                onClick={e => { e.stopPropagation(); onEdit(baseEnv) }}
                title="BASE 환경 편집"
              >
                <IcoPencil size={12} />
              </button>
            </div>
          )}
          {customEnvs.map(env => (
            <div
              key={env.id}
              className={`env-item${activeEnvId === env.id ? ' env-item-active' : ''}`}
              onClick={() => onSelect(env.id)}
            >
              <span
                className="env-item-badge"
                style={{ background: env.color, color: '#fff' }}
              >
                {env.name.charAt(0).toUpperCase()}
              </span>
              <span className="env-item-name">{env.name}</span>
              <button
                className="btn ghost icon env-item-edit"
                onClick={e => { e.stopPropagation(); onEdit(env) }}
                title="편집"
              >
                <IcoPencil size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
