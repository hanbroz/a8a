import { useState } from 'react'
import { IcoX } from '../Icon'

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

const DEFAULT_SCHEDULE: StartSchedule = {
  type: 'daily',
  time: '09:00',
  weekdays: [1],
  monthDay: 1,
  cron: '0 9 * * *',
}

function parseConfig(raw: string): StartConfig {
  try {
    const parsed = JSON.parse(raw)
    return {
      mode: parsed.mode ?? 'manual',
      schedule: { ...DEFAULT_SCHEDULE, ...parsed.schedule },
    }
  } catch {
    return { mode: 'manual', schedule: { ...DEFAULT_SCHEDULE } }
  }
}

function cronPreview(s: StartSchedule): string {
  const t = s.time || '09:00'
  const [hh, mm] = t.split(':')
  switch (s.type) {
    case 'daily':   return `${mm} ${hh} * * *`
    case 'weekly':  return `${mm} ${hh} * * ${s.weekdays.join(',')}`
    case 'monthly': return `${mm} ${hh} ${s.monthDay} * *`
    case 'cron':    return s.cron
    default:        return ''
  }
}

interface Props {
  node: ApiNode
  onSave: (nodeId: string, config: string) => void
  onClose: () => void
}

export default function StartNodeModal({ node, onSave, onClose }: Props): JSX.Element {
  const [cfg, setCfg] = useState<StartConfig>(() => parseConfig(node.config))

  const setMode = (mode: 'manual' | 'schedule') =>
    setCfg(prev => ({ ...prev, mode }))

  const setSched = (patch: Partial<StartSchedule>) =>
    setCfg(prev => ({ ...prev, schedule: { ...prev.schedule, ...patch } }))

  const toggleWeekday = (d: number) => {
    const next = cfg.schedule.weekdays.includes(d)
      ? cfg.schedule.weekdays.filter(x => x !== d)
      : [...cfg.schedule.weekdays, d].sort()
    setSched({ weekdays: next.length ? next : [d] })
  }

  const handleSave = () => {
    onSave(node.id, JSON.stringify(cfg))
    onClose()
  }

  const preview = cfg.mode === 'schedule' ? cronPreview(cfg.schedule) : ''

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="sn-modal" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="sn-modal-hd">
          <div className="sn-modal-title-row">
            <span className="sn-modal-icon">▶</span>
            <span className="sn-modal-title">Start 설정</span>
          </div>
          <button className="btn ghost icon" onClick={onClose} title="닫기">
            <IcoX size={15} />
          </button>
        </div>

        {/* Body */}
        <div className="sn-modal-body">
          {/* Mode toggle */}
          <div className="sn-field">
            <label className="sn-label">실행 방식</label>
            <div className="sn-mode-tabs">
              <button
                className={`sn-mode-tab${cfg.mode === 'manual' ? ' active' : ''}`}
                onClick={() => setMode('manual')}
              >
                수동 실행
              </button>
              <button
                className={`sn-mode-tab${cfg.mode === 'schedule' ? ' active' : ''}`}
                onClick={() => setMode('schedule')}
              >
                스케줄 실행
              </button>
            </div>
          </div>

          {cfg.mode === 'manual' ? (
            <div className="sn-hint">
              상단의 <strong>실행</strong> 버튼을 클릭하면 워크플로우가 즉시 시작됩니다.
            </div>
          ) : (
            <>
              {/* Schedule type */}
              <div className="sn-field">
                <label className="sn-label">반복 주기</label>
                <select
                  className="sn-select"
                  value={cfg.schedule.type}
                  onChange={e => setSched({ type: e.target.value as StartSchedule['type'] })}
                >
                  <option value="daily">매일</option>
                  <option value="weekly">매주</option>
                  <option value="monthly">매월</option>
                  <option value="cron">Cron 직접 입력</option>
                </select>
              </div>

              {/* Weekly: weekday selector */}
              {cfg.schedule.type === 'weekly' && (
                <div className="sn-field">
                  <label className="sn-label">실행 요일</label>
                  <div className="sn-weekdays">
                    {WEEKDAYS.map((label, i) => (
                      <button
                        key={i}
                        className={`sn-weekday-btn${cfg.schedule.weekdays.includes(i) ? ' active' : ''}`}
                        onClick={() => toggleWeekday(i)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Monthly: day input */}
              {cfg.schedule.type === 'monthly' && (
                <div className="sn-field">
                  <label className="sn-label">실행 일</label>
                  <div className="sn-inline">
                    <input
                      type="number"
                      className="sn-input sn-input-sm"
                      min={1}
                      max={31}
                      value={cfg.schedule.monthDay}
                      onChange={e => setSched({ monthDay: Math.max(1, Math.min(31, Number(e.target.value))) })}
                    />
                    <span className="sn-unit">일</span>
                  </div>
                </div>
              )}

              {/* Time picker (not for cron) */}
              {cfg.schedule.type !== 'cron' && (
                <div className="sn-field">
                  <label className="sn-label">실행 시간</label>
                  <input
                    type="time"
                    className="sn-input sn-input-time"
                    value={cfg.schedule.time}
                    onChange={e => setSched({ time: e.target.value })}
                  />
                </div>
              )}

              {/* Cron expression */}
              {cfg.schedule.type === 'cron' ? (
                <div className="sn-field">
                  <label className="sn-label">Cron 표현식</label>
                  <input
                    type="text"
                    className="sn-input sn-input-mono"
                    placeholder="0 9 * * *"
                    value={cfg.schedule.cron}
                    onChange={e => setSched({ cron: e.target.value })}
                  />
                  <span className="sn-hint-sm">분 시 일 월 요일</span>
                </div>
              ) : (
                <div className="sn-cron-preview">
                  <span className="sn-cron-label">Cron</span>
                  <code className="sn-cron-value">{preview}</code>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="sn-modal-ft">
          <button className="btn" onClick={onClose}>취소</button>
          <button className="btn primary" onClick={handleSave}>저장</button>
        </div>
      </div>
    </div>
  )
}
