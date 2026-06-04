import { useMemo, useRef, useState } from 'react'
import { IcoX } from '../Icon'
import { parseTableFile } from '../../utils/tabularData'
import { useI18n, type TranslationKey } from '../../i18n'

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

function rowStatusKey(status: StartRepeatRowStatus): TranslationKey {
  if (status === 'running') return 'module.start.status.running'
  if (status === 'success') return 'module.start.status.success'
  if (status === 'failed') return 'module.start.status.failed'
  if (status === 'stopped') return 'module.start.status.stopped'
  return 'module.start.status.pending'
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
  const { t, language } = useI18n()
  const [cfg, setCfg] = useState<StartConfig>(() => parseConfig(node.config))
  const [dataError, setDataError] = useState('')
  const [dataSearch, setDataSearch] = useState('')
  const [exportMessage, setExportMessage] = useState('')
  const [exportingFailedRows, setExportingFailedRows] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const repeat = cfg.repeat ?? DEFAULT_REPEAT
  const repeatData = repeat.data
  const weekdays = useMemo(() => [
    t('module.start.weekday.sun'),
    t('module.start.weekday.mon'),
    t('module.start.weekday.tue'),
    t('module.start.weekday.wed'),
    t('module.start.weekday.thu'),
    t('module.start.weekday.fri'),
    t('module.start.weekday.sat'),
  ], [t])

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
    const result = await parseTableFile(file, language)
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
      setExportMessage(t('module.start.exportSuccess', { path }))
    } catch (err) {
      setExportMessage(t('module.start.exportFailed', { message: String((err as Error)?.message ?? err) }))
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
            <th className="sn-data-status-col">{t('module.start.statusColumn')}</th>
            {repeatData?.columns.map(column => <th key={column}>{column}</th>)}
          </tr>
        </thead>
        <tbody>
          {filteredRows.length === 0 ? (
            <tr>
              <td colSpan={Math.max(1, (repeatData?.columns.length ?? 0) + 1)} className="sn-data-empty">
                {t('module.start.noSearchResults')}
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
                        title={status.error || t(rowStatusKey(status.status))}
                      >
                        {t(rowStatusKey(status.status))}
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
            <span className="sn-modal-title">{t('module.start.title')}</span>
          </div>
          <button className="btn ghost icon" onClick={onClose} title={t('common.close')} aria-label={t('common.close')}>
            <IcoX size={15} />
          </button>
        </div>

        <div className="sn-modal-body">
          <div className="sn-field">
            <label className="sn-label">{t('module.start.executionMode')}</label>
            <div className="sn-mode-tabs">
              <button
                className={`sn-mode-tab${cfg.mode === 'manual' ? ' active' : ''}`}
                onClick={() => setMode('manual')}
              >
                {t('module.start.manual')}
              </button>
              <button
                className={`sn-mode-tab${cfg.mode === 'schedule' ? ' active' : ''}`}
                onClick={() => setMode('schedule')}
              >
                {t('module.start.schedule')}
              </button>
            </div>
          </div>

          {cfg.mode === 'manual' ? (
            <div className="sn-hint">
              {t('module.start.manualHintPrefix')} <strong>{t('module.start.manualHintRun')}</strong> {t('module.start.manualHintSuffix')}
            </div>
          ) : (
            <>
              <div className="sn-field">
                <label className="sn-label">{t('module.start.repeatCycle')}</label>
                <select
                  className="sn-select"
                  value={cfg.schedule.type}
                  onChange={e => setSched({ type: e.target.value as StartSchedule['type'] })}
                >
                  <option value="daily">{t('module.start.daily')}</option>
                  <option value="weekly">{t('module.start.weekly')}</option>
                  <option value="monthly">{t('module.start.monthly')}</option>
                  <option value="cron">{t('module.start.cron')}</option>
                </select>
              </div>

              {cfg.schedule.type === 'weekly' && (
                <div className="sn-field">
                  <label className="sn-label">{t('module.start.runWeekday')}</label>
                  <div className="sn-weekdays">
                    {weekdays.map((label, i) => (
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
                  <label className="sn-label">{t('module.start.runDay')}</label>
                  <div className="sn-inline">
                    <input
                      type="number"
                      className="sn-input sn-input-sm"
                      min={1}
                      max={31}
                      value={cfg.schedule.monthDay}
                      onChange={e => setSched({ monthDay: Math.max(1, Math.min(31, Number(e.target.value))) })}
                    />
                    <span className="sn-unit">{t('module.start.dayUnit')}</span>
                  </div>
                </div>
              )}

              {cfg.schedule.type !== 'cron' && (
                <div className="sn-field">
                  <label className="sn-label">{t('module.start.runTime')}</label>
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
                  <label className="sn-label">{t('module.start.cronExpression')}</label>
                  <input
                    type="text"
                    className="sn-input sn-input-mono"
                    placeholder="0 9 * * *"
                    value={cfg.schedule.cron}
                    onChange={e => setSched({ cron: e.target.value })}
                  />
                  <span className="sn-hint-sm">{t('module.start.cronHint')}</span>
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
              <span>{t('module.start.repeat')}</span>
            </label>

            {repeat.enabled && (
              <div className="sn-repeat-panel">
                <label className="sn-repeat-check sn-repeat-stop-check">
                  <input
                    type="checkbox"
                    checked={repeat.stopOnFailure}
                    onChange={e => setRepeat({ stopOnFailure: e.target.checked })}
                  />
                  <span>{t('module.start.stopOnFailure')}</span>
                </label>
                <div className="sn-hint-sm">
                  {t('module.start.stopOnFailureHint')}
                </div>

                <div className="sn-mode-tabs">
                  <button
                    className={`sn-mode-tab${repeat.mode === 'count' ? ' active' : ''}`}
                    onClick={() => setRepeat({ mode: 'count' })}
                  >
                    {t('module.start.repeatCount')}
                  </button>
                  <button
                    className={`sn-mode-tab${repeat.mode === 'data' ? ' active' : ''}`}
                    onClick={() => setRepeat({ mode: 'data' })}
                  >
                    {t('module.start.repeatData')}
                  </button>
                </div>

                {repeat.mode === 'count' ? (
                  <div className="sn-field">
                    <label className="sn-label">{t('module.start.repeatCount')}</label>
                    <div className="sn-inline">
                      <input
                        type="number"
                        className="sn-input sn-input-sm"
                        min={1}
                        value={repeat.count}
                        onChange={e => setRepeat({ count: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
                      />
                      <span className="sn-unit">{t('module.start.timesUnit')}</span>
                    </div>
                    <span className="sn-hint-sm">{t('module.start.noHint')}</span>
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
                        {t('module.start.attachData')}
                      </button>
                      {repeatData && (
                        <button className="btn ghost" onClick={() => setFullscreen(true)}>
                          {t('module.start.fullscreen')}
                        </button>
                      )}
                      {repeatData && (
                        <button
                          className="btn ghost"
                          onClick={() => { void handleExportFailedRows() }}
                          disabled={failedCount === 0 || exportingFailedRows}
                          title={failedCount === 0 ? t('module.start.noFailedRows') : t('module.start.exportFailedRows')}
                        >
                          {exportingFailedRows ? t('module.start.exporting') : failedCount > 0 ? t('module.start.failedExportCount', { count: failedCount }) : t('module.start.failedExport')}
                        </button>
                      )}
                    </div>
                    <div className="sn-hint-sm">
                      {t('module.start.dataHint')}
                    </div>
                    {dataError && <div className="sn-error">{dataError}</div>}
                    {exportMessage && <div className="sn-export-message">{exportMessage}</div>}
                    {repeatData ? (
                      <div className="sn-data-preview">
                        <div className="sn-data-summary">
                          <span>{repeatData.fileName}</span>
                          <strong>{t('module.start.itemCount', { count: repeatData.rows.length })}</strong>
                        </div>
                        <input
                          className="sn-input"
                          value={dataSearch}
                          onChange={e => setDataSearch(e.target.value)}
                          placeholder={t('module.start.searchPlaceholder')}
                        />
                        {renderDataTable(false)}
                      </div>
                    ) : (
                      <div className="sn-empty-data">{t('module.start.noData')}</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="sn-modal-ft">
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn primary" onClick={handleSave}>{t('common.save')}</button>
        </div>

        {fullscreen && repeatData && (
          <div className="sn-fullscreen-data" onClick={() => setFullscreen(false)}>
            <div className="sn-fullscreen-panel" onClick={e => e.stopPropagation()}>
              <div className="sn-fullscreen-hd">
                <div>
                  <strong>{repeatData.fileName}</strong>
                  <span>{t('module.start.itemCount', { count: repeatData.rows.length })}</span>
                </div>
                <button className="btn ghost icon" onClick={() => setFullscreen(false)} title={t('common.close')} aria-label={t('common.close')}>
                  <IcoX size={15} />
                </button>
              </div>
              <input
                className="sn-input"
                value={dataSearch}
                onChange={e => setDataSearch(e.target.value)}
                placeholder={t('module.start.searchPlaceholder')}
              />
              {renderDataTable(true)}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
