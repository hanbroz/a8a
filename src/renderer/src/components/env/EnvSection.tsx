import { IcoChevD, IcoPlus, IcoPencil, IcoTrash } from '../Icon'
import { useSidebarOpen } from '../../hooks/useSidebarOpen'
import { useI18n } from '../../i18n'

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
  initial: string
  runWarningEnabled: boolean
  vars: EnvVar[]
}

interface Props {
  environments: Environment[]
  activeEnvId: string
  onAdd: () => void
  onEdit: (env: Environment) => void
  onDelete: (env: Environment) => void
}

export default function EnvSection({ environments, activeEnvId, onAdd, onEdit, onDelete }: Props): JSX.Element {
  const [open, toggleOpen] = useSidebarOpen('environment')
  const { t } = useI18n()

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
        <span className="sidebar-section-title">{t('sidebar.environment')}</span>
        <button
          className="btn ghost icon sidebar-section-add"
          onClick={e => { e.stopPropagation(); onAdd() }}
          title={t('sidebar.environment.add')}
        >
          <IcoPlus size={13} />
        </button>
      </div>

      {open && (
        <div className="sidebar-section-body">
          {baseEnv && (
            <div
              className={`env-item env-item-base${activeEnvId === baseEnv.id ? ' env-item-active' : ''}`}
              onClick={() => onEdit(baseEnv)}
            >
              <span className="env-item-badge">B</span>
              <span className="env-item-name">BASE</span>
              <button
                className="btn ghost icon env-item-edit"
                onClick={e => { e.stopPropagation(); onEdit(baseEnv) }}
                title={t('sidebar.environment.baseEdit')}
              >
                <IcoPencil size={12} />
              </button>
            </div>
          )}
          {customEnvs.map(env => (
            <div
              key={env.id}
              className={`env-item${activeEnvId === env.id ? ' env-item-active' : ''}`}
              onClick={() => onEdit(env)}
            >
              <span
                className="env-item-badge"
                style={{ background: env.color, color: '#fff' }}
              >
                {(env.initial || env.name.charAt(0)).toUpperCase()}
              </span>
              <span className="env-item-name">{env.name}</span>
              <button
                className="btn ghost icon env-item-edit"
                onClick={e => { e.stopPropagation(); onEdit(env) }}
                title={t('sidebar.environment.edit')}
              >
                <IcoPencil size={12} />
              </button>
              <button
                className="btn ghost icon env-item-edit"
                onClick={e => { e.stopPropagation(); onDelete(env) }}
                title={t('sidebar.environment.delete')}
                style={{ color: 'var(--state-danger, #f85149)' }}
              >
                <IcoTrash size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
