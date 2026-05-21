import { useState, useRef } from 'react'
import { IcoX, IcoPlus, IcoTrash } from '../Icon'
import type { Environment, EnvVar } from './EnvSection'

interface Props {
  env: Environment | null
  onSave: (env: Environment) => void
  onClose: () => void
}

function makeVar(): EnvVar {
  return { id: crypto.randomUUID(), key: '', value: '', enabled: true }
}

const PRESETS = [
  'Development', 'Staging', 'Production', 'QA',
  'Testing', 'Local', 'UAT', 'Release', 'Sandbox', 'Hotfix'
]

const ENV_COLORS = [
  '#4493f8', '#3fb950', '#f97316', '#a371f7', '#f85149',
  '#39c5cf', '#d29922', '#db61a2', '#6366f1', '#22d3ee'
]

const PRESET_COLORS: Record<string, string> = {
  'Development': '#4493f8', 'Staging': '#f97316', 'Production': '#f85149',
  'QA': '#a371f7', 'Testing': '#d29922', 'Local': '#3fb950',
  'UAT': '#39c5cf', 'Release': '#6366f1', 'Sandbox': '#22d3ee', 'Hotfix': '#db61a2'
}

export default function EnvModal({ env, onSave, onClose }: Props): JSX.Element {
  const isBase = env?.isBase === true
  const isNew = env === null
  const [step, setStep] = useState<'select' | 'edit'>(isNew ? 'select' : 'edit')
  const [name, setName] = useState(env?.name ?? '')
  const [color, setColor] = useState(env?.color ?? ENV_COLORS[0])
  const [initial, setInitial] = useState(env?.initial ?? '')
  const [vars, setVars] = useState<EnvVar[]>(
    env && env.vars.length > 0 ? env.vars : [makeVar()]
  )
  const [keyPct, setKeyPct] = useState(40)
  const containerRef = useRef<HTMLDivElement>(null)

  const updateVar = (id: string, field: keyof EnvVar, val: string | boolean): void => {
    setVars(prev => prev.map(v => v.id === id ? { ...v, [field]: val } : v))
  }

  const addVar = (): void => setVars(prev => [...prev, makeVar()])

  const removeVar = (id: string): void => {
    setVars(prev => {
      const next = prev.filter(v => v.id !== id)
      return next.length === 0 ? [makeVar()] : next
    })
  }

  const handleSave = (): void => {
    const finalName = isBase ? 'BASE' : name.trim()
    if (!finalName) return
    onSave({
      id: env?.id ?? crypto.randomUUID(),
      name: finalName,
      isBase: isBase,
      color: isBase ? '#4493f8' : color,
      initial: isBase ? 'B' : (initial.trim() || finalName.charAt(0)).toUpperCase().slice(0, 2),
      vars: vars.filter(v => v.key.trim() !== '')
    })
  }

  const handleSplitterMouseDown = (e: React.MouseEvent): void => {
    e.preventDefault()
    const startX = e.clientX
    const startPct = keyPct
    let mounted = true

    const onMove = (ev: MouseEvent): void => {
      if (!mounted || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const available = rect.width - 36 - 36 - 1
      const delta = ev.clientX - startX
      const deltaPct = (delta / available) * 100
      setKeyPct(Math.max(15, Math.min(80, startPct + deltaPct)))
    }

    const onUp = (): void => {
      mounted = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  if (step === 'select') {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="env-preset-modal" onClick={e => e.stopPropagation()}>
          <div className="env-modal-hd">
            <span className="env-modal-base-label">Environment 유형 선택</span>
            <button className="btn ghost icon" onClick={onClose} title="닫기">
              <IcoX size={15} />
            </button>
          </div>
          <div className="env-preset-grid">
            {PRESETS.map(p => (
              <button
                key={p}
                className="env-preset-item"
                onClick={() => { setName(p); setColor(PRESET_COLORS[p] ?? ENV_COLORS[0]); setInitial(p.charAt(0)); setStep('edit') }}
              >
                <span
                  className="env-item-badge env-preset-badge"
                  style={{ background: PRESET_COLORS[p] ?? ENV_COLORS[0], color: '#fff' }}
                >
                  {p.charAt(0)}
                </span>
                <span className="env-preset-name">{p}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="env-modal" onClick={e => e.stopPropagation()}>
        {/* Header — BASE only; custom env uses identity row */}
        {isBase ? (
          <div className="env-modal-hd">
            <div className="env-modal-base-title">
              <span className="env-item-badge">B</span>
              <span className="env-modal-base-label">BASE</span>
              <span className="env-modal-base-hint">모든 Environment가 이 값을 기본으로 상속합니다</span>
            </div>
            <button className="btn ghost icon" onClick={onClose} title="닫기">
              <IcoX size={15} />
            </button>
          </div>
        ) : null}

        {/* Icon preview + name + initial + color (custom env only) */}
        {!isBase && (
          <div className="env-identity-row">
            <span
              className="env-identity-preview"
              style={{ background: color }}
            >
              {(initial.trim() || name.charAt(0) || '?').toUpperCase().slice(0, 2)}
            </span>
            <div className="env-identity-fields">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  className="env-modal-name-input"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Environment 이름"
                  autoFocus
                />
                <button className="btn ghost icon" onClick={onClose} title="닫기" style={{ flexShrink: 0 }}>
                  <IcoX size={15} />
                </button>
              </div>
              <div className="env-identity-bottom">
                <div className="env-initial-wrap">
                  <span className="env-color-label">이니셜</span>
                  <input
                    className="env-initial-input"
                    value={initial}
                    onChange={e => setInitial(e.target.value.slice(0, 2))}
                    placeholder={name.charAt(0).toUpperCase() || '?'}
                    maxLength={2}
                  />
                </div>
                <div className="env-color-swatches">
                  {ENV_COLORS.map(c => (
                    <button
                      key={c}
                      className={`env-color-swatch${color === c ? ' env-color-swatch-active' : ''}`}
                      style={{ background: c }}
                      onClick={() => setColor(c)}
                      title={c}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Variable rows */}
        <div className="env-modal-body" ref={containerRef}>
          {/* Column header */}
          <div className="env-var-hd-row">
            <div className="env-var-cb" />
            <div className="env-var-key-col" style={{ flex: keyPct }}>
              <span className="env-var-col-label">Key</span>
            </div>
            <div
              className="env-var-splitter env-var-splitter-hd"
              onMouseDown={handleSplitterMouseDown}
            />
            <div className="env-var-val-col" style={{ flex: 100 - keyPct }}>
              <span className="env-var-col-label">Value</span>
            </div>
            <div className="env-var-del-col" />
          </div>

          {/* Data rows */}
          {vars.map(v => (
            <div key={v.id} className="env-var-row">
              <div className="env-var-cb">
                <input
                  type="checkbox"
                  className="env-var-checkbox"
                  checked={v.enabled}
                  onChange={e => updateVar(v.id, 'enabled', e.target.checked)}
                />
              </div>
              <div className="env-var-key-col" style={{ flex: keyPct }}>
                <input
                  className="env-var-input"
                  value={v.key}
                  onChange={e => updateVar(v.id, 'key', e.target.value)}
                  placeholder="key"
                />
              </div>
              <div
                className="env-var-splitter"
                onMouseDown={handleSplitterMouseDown}
              />
              <div className="env-var-val-col" style={{ flex: 100 - keyPct }}>
                <input
                  className="env-var-input"
                  value={v.value}
                  onChange={e => updateVar(v.id, 'value', e.target.value)}
                  placeholder="value"
                />
              </div>
              <div className="env-var-del-col">
                <button
                  className="btn ghost icon env-var-del-btn"
                  onClick={() => removeVar(v.id)}
                  title="삭제"
                >
                  <IcoTrash size={13} />
                </button>
              </div>
            </div>
          ))}

          <div className="env-add-row">
            <button className="env-add-btn" onClick={addVar}>
              <IcoPlus size={13} />
              변수 추가
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="env-modal-ft">
          <button className="btn" onClick={onClose}>취소</button>
          <button
            className="btn primary"
            onClick={handleSave}
            disabled={!isBase && !name.trim()}
          >
            저장
          </button>
        </div>
      </div>
    </div>
  )
}
