import { useMemo, useRef, useState } from 'react'
import { IcoX } from '../Icon'
import { parseTableFile } from '../../utils/tabularData'

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

const DEFAULT_SCHEDULE: StartSchedule = {
  type: 'daily',
  time: '09:00',
  weekdays: [1],
  monthDay: 1,
  cron: '0 9 * * *',
}

const DEFAULT_REPEAT: StartRepeatConfig = {
  enabled: false,
  mode: 'count',
  count: 1,
  stopOnFailure: true,
  data: null,
}

function normalizeRepeat(raw: unknown): StartRepeatConfig {
  const parsed = raw && typeof raw === 'object' ? raw as Partial<StartRepeatConfig> : {}
  const data = parsed.data && typeof parsed.data === 'object'
    ? parsed.data as Partial<StartRepeatData>
    : null
  const rows = Array.isArray(data?.rows) ? data.rows.filter(row => row && typeof row === 'object' && !Array.isArray(row)) as Record<string, unknown>[] : []
  const columns = Array.isArray(data?.columns) ? data.columns.map(String).filter(Boolean) : []
  return {
    enabled: parsed.enabled === true,
    mode: parsed.mode === 'data' ? 'data' : 'count',
    count: Math.max(1, Math.floor(Number(parsed.count) || DEFAULT_REPEAT.count)),
    stopOnFailure: parsed.stopOnFailure !== false,
    data: data && rows.length > 0
      ? {
          fileName: typeof data.fileName === 'string' ? data.fileName : 'data',
          columns: columns.length > 0 ? columns : Array.from(new Set(rows.flatMap(row => Object.keys(row)))),
          rows,
        }
      : null,
  }
}

function parseConfig(raw: string): StartConfig {
  try {
    const parsed = JSON.parse(raw)
    return {
      mode: parsed.mode === 'schedule' ? 'schedule' : 'manual',
      schedule: { ...DEFAULT_SCHEDULE, ...parsed.schedule },
      repeat: normalizeRepeat(parsed.repeat),
    }
  } catch {
    return { mode: 'manual', schedule: { ...DEFAULT_SCHEDULE }, repeat: { ...DEFAULT_REPEAT } }
  }
}

function cronPreview(s: StartSchedule): string {
  const t = s.time || '09:00'
  const [hh, mm] = t.split(':')
  switch (s.type) {
    case 'daily': return `${mm} ${hh} * * *`
    case 'weekly': return `${mm} ${hh} * * ${s.weekdays.join(',')}`
    case 'monthly': return `${mm} ${hh} ${s.monthDay} * *`
    case 'cron': return s.cron
    default: return ''
  }
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
  try { return JSON.stringify(value) } catch { return String(value) }
}

function rowNo(row: Record<string, unknown>, index: number): number {
  const value = Number(row.no)
  return Number.isFinite(value) && value > 0 ? value : index + 1
}

function rowStatusLabel(status: StartRepeatRowStatus): string {
  if (status === 'running') return '실행중'
  if (status === 'success') return '성공'
  if (status === 'failed') return '실패'
  return '대기'
}

interface Props {
  node: ApiNode
  onSave: (nodeId: string, config: string) => void
  onClose: () => void
  repeatRowStates?: Record<number, StartRepeatRowRunState>
  onResetRepeatRowStates?: (nodeId: string) => void
  onExportFailedRows?: (nodeId: string) => Promise<string>
}

export default function StartNodeModal({
  node,
  onSave,
  onClose,
  repeatRowStates = {},
  onResetRepeatRowStates,
  onExportFailedRows,
}: Props): JSX.Element {
  const [cfg, setCfg] = useState<StartConfig>(() => parseConfig(node.config))
  const [dataError, setDataError] = useState('')
  const [dataSearch, setDataSearch] = useState('')
  const [exportMessage, setExportMessage] = useState('')
  const [exportingFailedRows, setExportingFailedRows] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const repeat = cfg.repeat ?? DEFAULT_REPEAT
  const repeatData = repeat.data

  const setMode = (mode: 'manual' | 'schedule'): void =>
    setCfg(prev => ({ ...prev, mode }))

  const setSched = (patch: Partial<StartSchedule>): void =>
    setCfg(prev => ({ ...prev, schedule: { ...prev.schedule, ...patch } }))

  const setRepeat = (patch: Partial<StartRepeatConfig>): void =>
    setCfg(prev => ({ ...prev, repeat: { ...DEFAULT_REPEAT, ...(prev.repeat ?? DEFAULT_REPEAT), ...patch } }))

  const toggleWeekday = (d: number): void => {
    const next = cfg.schedule.weekdays.includes(d)
      ? cfg.schedule.weekdays.filter(x => x !== d)
      : [...cfg.schedule.weekdays, d].sort()
    setSched({ weekdays: next.length ? next : [d] })
  }

  const handleFile = async (file: File): Promise<void> => {
    setDataError('')
    setExportMessage('')
    onResetRepeatRowStates?.(node.id)
    const result = await parseTableFile(file)
    if (!result.ok) {
      setRepeat({ data: null })
      setDataSearch('')
      setDataError(result.error)
      return
    }
    setRepeat({ mode: 'data', data: result.data })
    setDataSearch('')
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0]
    if (file) void handleFile(file)
    e.target.value = ''
  }

  const filteredRows = useMemo(() => {
    if (!repeatData) return []
    const q = dataSearch.trim().toLowerCase()
    if (!q) return repeatData.rows
    return repeatData.rows.filter(row =>
      repeatData.columns.some(column =>
        column.toLowerCase().includes(q) || formatCellValue(row[column]).toLowerCase().includes(q),
      ),
    )
  }, [repeatData, dataSearch])

  const failedCount = repeatData?.rows.reduce((count, row, index) => (
    repeatRowStates[rowNo(row, index)]?.status === 'failed' ? count + 1 : count
  ), 0) ?? 0

  const handleExportFailedRows = async (): Promise<void> => {
    if (!onExportFailedRows || failedCount === 0) return
    setExportingFailedRows(true)
    setExportMessage('')
    try {
      const path = await onExportFailedRows(node.id)
      setExportMessage(`실패 데이터 저장 완료: ${path}`)
    } catch (err) {
      setExportMessage(`실패 데이터 저장 실패: ${String((err as Error)?.message ?? err)}`)
    } finally {
      setExportingFailedRows(false)
    }
  }

  const handleSave = (): void => {
    const normalizedRepeat = normalizeRepeat(repeat)
    const nextCfg: StartConfig = {
      ...cfg,
      repeat: normalizedRepeat.enabled ? normalizedRepeat : { ...DEFAULT_REPEAT },
    }
    onSave(node.id, JSON.stringify(nextCfg))
    onClose()
  }

  const preview = cfg.mode === 'schedule' ? cronPreview(cfg.schedule) : ''

  const renderDataTable = (isFullscreen: boolean): JSX.Element => (
    <div className={`sn-data-table-wrap${isFullscreen ? ' sn-data-table-full-wrap' : ''}`}>
      <table className="sn-data-table">
        <thead>
          <tr>
            <th className="sn-data-status-col">상태</th>
            {repeatData?.columns.map(column => <th key={column}>{column}</th>)}
          </tr>
        </thead>
        <tbody>
          {filteredRows.length === 0 ? (
            <tr>
              <td colSpan={Math.max(1, (repeatData?.columns.length ?? 0) + 1)} className="sn-data-empty">
                검색 결과가 없습니다.
              </td>
            </tr>
          ) : (
            filteredRows.map((row, index) => (
              <tr key={`${row.no ?? index}-${index}`}>
                <td className="sn-data-status-cell">
                  {(() => {
                    const status = repeatRowStates[rowNo(row, index)] ?? { status: 'pending' as StartRepeatRowStatus }
                    return (
                      <span
                        className={`sn-row-status sn-row-status-${status.status}`}
                        title={status.error || rowStatusLabel(status.status)}
                      >
                        {rowStatusLabel(status.status)}
                      </span>
                    )
                  })()}
                </td>
                {repeatData?.columns.map(column => (
                  <td key={column} title={formatCellValue(row[column])}>{formatCellValue(row[column])}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="sn-modal" onClick={e => e.stopPropagation()}>
        <div className="sn-modal-hd">
          <div className="sn-modal-title-row">
            <span className="sn-modal-icon">▶</span>
            <span className="sn-modal-title">Start 설정</span>
          </div>
          <button className="btn ghost icon" onClick={onClose} title="닫기">
            <IcoX size={15} />
          </button>
        </div>

        <div className="sn-modal-body">
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

          <div className="sn-repeat-section">
            <label className="sn-repeat-check">
              <input
                type="checkbox"
                checked={repeat.enabled}
                onChange={e => setRepeat({ enabled: e.target.checked })}
              />
              <span>반복 실행</span>
            </label>

            {repeat.enabled && (
              <div className="sn-repeat-panel">
                <label className="sn-repeat-check sn-repeat-stop-check">
                  <input
                    type="checkbox"
                    checked={repeat.stopOnFailure}
                    onChange={e => setRepeat({ stopOnFailure: e.target.checked })}
                  />
                  <span>실패하면 중지</span>
                </label>
                <div className="sn-hint-sm">
                  체크를 해제하면 반복 중 오류가 난 행은 실패로 표시하고 다음 행을 계속 실행합니다.
                </div>

                <div className="sn-mode-tabs">
                  <button
                    className={`sn-mode-tab${repeat.mode === 'count' ? ' active' : ''}`}
                    onClick={() => setRepeat({ mode: 'count' })}
                  >
                    반복 횟수
                  </button>
                  <button
                    className={`sn-mode-tab${repeat.mode === 'data' ? ' active' : ''}`}
                    onClick={() => setRepeat({ mode: 'data' })}
                  >
                    데이터
                  </button>
                </div>

                {repeat.mode === 'count' ? (
                  <div className="sn-field">
                    <label className="sn-label">반복 횟수</label>
                    <div className="sn-inline">
                      <input
                        type="number"
                        className="sn-input sn-input-sm"
                        min={1}
                        value={repeat.count}
                        onChange={e => setRepeat({ count: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
                      />
                      <span className="sn-unit">회</span>
                    </div>
                    <span className="sn-hint-sm">각 회차에서 <code>{'<<no>>'}</code>를 사용할 수 있습니다.</span>
                  </div>
                ) : (
                  <div className="sn-repeat-data">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".xlsx,.csv,.json"
                      onChange={handleFileChange}
                      style={{ display: 'none' }}
                    />
                    <div className="sn-data-actions">
                      <button className="btn" onClick={() => fileInputRef.current?.click()}>
                        데이터 첨부
                      </button>
                      {repeatData && (
                        <button className="btn ghost" onClick={() => setFullscreen(true)}>
                          전체 화면
                        </button>
                      )}
                      {repeatData && (
                        <button
                          className="btn ghost"
                          onClick={() => { void handleExportFailedRows() }}
                          disabled={failedCount === 0 || exportingFailedRows}
                          title={failedCount === 0 ? '실패한 데이터가 없습니다.' : '실패한 데이터만 Excel로 저장'}
                        >
                          {exportingFailedRows ? '저장 중...' : `실패 Export${failedCount > 0 ? ` (${failedCount})` : ''}`}
                        </button>
                      )}
                    </div>
                    <div className="sn-hint-sm">
                      Excel(.xlsx), CSV, JSON 객체 배열을 첨부합니다. 다시 첨부하면 이전 데이터는 리셋됩니다.
                    </div>
                    {dataError && <div className="sn-error">{dataError}</div>}
                    {exportMessage && <div className="sn-export-message">{exportMessage}</div>}
                    {repeatData ? (
                      <div className="sn-data-preview">
                        <div className="sn-data-summary">
                          <span>{repeatData.fileName}</span>
                          <strong>{repeatData.rows.length}개</strong>
                        </div>
                        <input
                          className="sn-input"
                          value={dataSearch}
                          onChange={e => setDataSearch(e.target.value)}
                          placeholder="컬럼명 또는 값 찾기"
                        />
                        {renderDataTable(false)}
                      </div>
                    ) : (
                      <div className="sn-empty-data">첨부된 데이터가 없습니다.</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="sn-modal-ft">
          <button className="btn" onClick={onClose}>취소</button>
          <button className="btn primary" onClick={handleSave}>저장</button>
        </div>

        {fullscreen && repeatData && (
          <div className="sn-fullscreen-data" onClick={() => setFullscreen(false)}>
            <div className="sn-fullscreen-panel" onClick={e => e.stopPropagation()}>
              <div className="sn-fullscreen-hd">
                <div>
                  <strong>{repeatData.fileName}</strong>
                  <span>{repeatData.rows.length}개</span>
                </div>
                <button className="btn ghost icon" onClick={() => setFullscreen(false)} title="닫기">
                  <IcoX size={15} />
                </button>
              </div>
              <input
                className="sn-input"
                value={dataSearch}
                onChange={e => setDataSearch(e.target.value)}
                placeholder="컬럼명 또는 값 찾기"
              />
              {renderDataTable(true)}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
