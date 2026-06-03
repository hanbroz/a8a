import { IcoChevD } from '../Icon'
import { useSidebarOpen } from '../../hooks/useSidebarOpen'

type CanvasModuleType = 'data' | 'select' | 'api' | 'branch'

const MODULE_TYPES: Array<{
  type: CanvasModuleType
  label: string
  color: string
  bg: string
}> = [
  { type: 'data', label: 'DATA', color: '#1f6feb', bg: 'rgba(31,111,235,0.14)' },
  { type: 'select', label: 'SELECT', color: '#8957e5', bg: 'rgba(137,87,229,0.14)' },
  { type: 'api', label: 'API', color: '#3fb950', bg: 'rgba(63,185,80,0.14)' },
  { type: 'branch', label: 'BRANCH', color: '#d29922', bg: 'rgba(210,153,34,0.14)' },
]

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

function TypeIcon({ type }: { type: CanvasModuleType }): JSX.Element {
  if (type === 'select') return <SelectIcon />
  if (type === 'api') return <ApiIcon />
  if (type === 'branch') return <BranchIcon />
  return <DataIcon />
}

export default function ModulePaletteSection({
  stateKey = 'module-palette',
  title = '공통 모듈',
  commonDataModules = [],
}: {
  stateKey?: string
  title?: string
  commonDataModules?: ApiModule[]
}): JSX.Element {
  const [open, toggleOpen] = useSidebarOpen(stateKey)

  return (
    <div className="sidebar-section">
      <div className="sidebar-section-hd" onClick={toggleOpen}>
        <IcoChevD
          size={11}
          style={{
            color: 'var(--text-3)',
            transform: open ? 'none' : 'rotate(-90deg)',
            transition: 'transform 0.15s',
            flexShrink: 0,
          }}
        />
        <span className="sidebar-section-title">{title}</span>
      </div>

      {open && (
        <div className="sidebar-section-body">
          {MODULE_TYPES.map(item => (
            <div key={item.type}>
              <div
                className="module-item module-palette-item"
                draggable
                onDragStart={e => {
                  e.dataTransfer.setData('moduleType', item.type)
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                title="캔버스에 드래그하여 독립 모듈을 생성합니다."
              >
                <div className="module-item-icon" style={{ background: item.bg, color: item.color }}>
                  <TypeIcon type={item.type} />
                </div>
                <div className="module-item-info">
                  <span className="module-item-name">{item.label}</span>
                </div>
              </div>
              {item.type === 'data' && commonDataModules.length > 0 && (
                <div className="module-type-group-body">
                  {commonDataModules.map(mod => (
                    <div
                      key={mod.id}
                      className="module-item module-item-nested module-palette-item"
                      draggable
                      onDragStart={e => {
                        e.dataTransfer.setData('moduleType', 'data')
                        e.dataTransfer.setData('moduleId', mod.id)
                        e.dataTransfer.setData('moduleWsId', '')
                        e.dataTransfer.effectAllowed = 'copy'
                      }}
                      title="캔버스에 드래그하여 공용 DATA를 참조하는 모듈을 생성합니다."
                    >
                      <div className="module-item-icon" style={{ background: item.bg, color: item.color }}>
                        <TypeIcon type="data" />
                      </div>
                      <div className="module-item-info">
                        <span className="module-item-name">{mod.label}</span>
                        <span className="module-item-meta" style={{ color: item.color, opacity: 0.8 }}>공용 DATA</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
