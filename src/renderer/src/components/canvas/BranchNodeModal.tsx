import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { IcoMaximize, IcoRestore, IcoTrash, IcoX } from '../Icon'
import JsonMonacoEditor from './JsonMonacoEditor'
import JsonInspectorButton from './JsonInspector'
import ShortcutSaveButtonLabel from './ShortcutSaveButtonLabel'
import { useModalMaximize } from './useModalMaximize'
import { useShortcutSave } from './useShortcutSave'
import { evaluateBranch, parseBranchConfig } from '../../utils/branch'
import { getInputPathSuggestions, parseTemplate, resolveInputExpression, resolveTemplateExpression } from '../../utils/interpolate'
import { useI18n } from '../../i18n'

interface Props {
  node: ApiNode
  isNew?: boolean
  initialInput?: string
  envVars?: Record<string, string>
  dataVars?: Record<string, unknown>
  onRun?: () => string | Promise<string>
  onSave: (nodeId: string, label: string, config: string) => Promise<void>
  onDelete?: () => Promise<void>
  onClose: () => void
}

type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
type BranchMode = 'condition' | 'manual'

const RESIZE_DIRS: ResizeDir[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']
const MIN_W = 720
const MIN_H = 460
const MIN_INPUT_W = 260
const MIN_SETTINGS_W = 320

type BranchVariableRow = {
  kind: 'env' | 'input' | 'data'
  name: string
  resolved: string | null
  rawValue?: unknown
  source: 'used' | 'available'
}

function BranchIcon({ size = 14 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="3" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="18" cy="18" r="3" />
      <path d="M8.6 7.4 15.4 16.6" />
      <path d="M9 6h6" />
    </svg>
  )
}

function RunIcon(): JSX.Element {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
      <polygon points="2,1 9,5 2,9" />
    </svg>
  )
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function stringifyBranchValue(value: unknown): string | null {
  if (value === undefined) return null
  if (value === null) return 'null'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function isConditionValue(value: unknown): boolean {
  return value === null || ['string', 'number', 'boolean', 'bigint'].includes(typeof value)
}

function literalForCondition(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value === null) return 'null'
  return ''
}

function isEmptyBranchConfig(raw: string): boolean {
  const source = raw.trim()
  return !source || source === '{}'
}

export default function BranchNodeModal({ node, isNew, initialInput, envVars = {}, dataVars, onRun, onSave, onDelete, onClose }: Props): JSX.Element {
  const { t, language } = useI18n()
  const initial = parseBranchConfig(node.config)
  const emptyConfig = isEmptyBranchConfig(node.config)
  const [moduleName, setModuleName] = useState(node.label)
  const [mode, setMode] = useState<BranchMode>(initial.mode ?? (isNew || emptyConfig ? 'manual' : 'condition'))
  const [expression, setExpression] = useState(initial.expression)
  const [trueLabel, setTrueLabel] = useState(initial.trueLabel ?? 'TRUE')
  const [falseLabel, setFalseLabel] = useState(initial.falseLabel ?? 'FALSE')
  const [defaultRoute, setDefaultRoute] = useState<'true' | 'false'>(initial.defaultRoute ?? 'false')
  const [selectedRoute, setSelectedRoute] = useState<'true' | 'false'>(initial.selectedRoute ?? 'true')
  const [manualSource, setManualSource] = useState<'saved' | 'runtime'>(initial.manualSource ?? 'saved')
  const [inputJson, setInputJson] = useState(initialInput ?? '')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [rect, setRect] = useState(() => {
    const ww = window.innerWidth
    const wh = window.innerHeight
    const w = Math.min(ww - 48, Math.max(980, Math.round(ww * 0.68)))
    const h = Math.min(wh - 48, Math.max(620, Math.round(wh * 0.72)))
    return { x: Math.round((ww - w) / 2), y: Math.round((wh - h) / 2), w, h }
  })
  const { isMaximized, toggleMaximized } = useModalMaximize(rect, setRect)
  const [inputW, setInputW] = useState(() => Math.max(420, Math.round(rect.w * 0.55)))

  const dragRef = useRef<{ ox: number; oy: number } | null>(null)
  const resizeRef = useRef<{ dir: ResizeDir; ox: number; oy: number; rx: number; ry: number; rw: number; rh: number } | null>(null)
  const splitterRef = useRef<{ startX: number; startW: number } | null>(null)

  useEffect(() => {
    setInputJson(initialInput ?? '')
  }, [initialInput, node.id])

  const parsedInput = useMemo((): { hasInput: boolean; value: unknown } => {
    if (!inputJson.trim()) return { hasInput: false, value: null }
    try {
      return { hasInput: true, value: JSON.parse(inputJson) as unknown }
    } catch {
      return { hasInput: false, value: null }
    }
  }, [inputJson])
  const inputValue = parsedInput.hasInput ? parsedInput.value : null
  const inputRecord = useMemo<Record<string, unknown>>(() => {
    if (inputValue && typeof inputValue === 'object') return inputValue as Record<string, unknown>
    return { value: inputValue }
  }, [inputValue])
  const dataInputRecord = useMemo<Record<string, unknown>>(() => dataVars ?? {}, [dataVars])

  const evalResult = useMemo(() => evaluateBranch({
    mode,
    expression,
    trueLabel,
    falseLabel,
    defaultRoute,
    selectedRoute,
  }, inputValue, dataInputRecord, envVars, language), [dataInputRecord, defaultRoute, envVars, expression, falseLabel, inputValue, language, mode, selectedRoute, trueLabel])

  const variableRows = useMemo<BranchVariableRow[]>(() => {
    const rows: BranchVariableRow[] = []
    const seen = new Set<string>()
    const addRow = (row: BranchVariableRow): void => {
      const key = `${row.kind}:${row.name}`
      if (seen.has(key)) return
      seen.add(key)
      rows.push(row)
    }

    parseTemplate(expression, envVars, inputRecord, dataInputRecord).forEach(token => {
      if (token.type === 'input') {
        addRow({
          kind: 'input',
          name: token.key,
          resolved: token.resolved,
          rawValue: resolveInputExpression(inputRecord, token.key),
          source: 'used',
        })
      }
      if (token.type === 'data') {
        addRow({
          kind: 'data',
          name: token.key,
          resolved: token.resolved,
          rawValue: resolveInputExpression(dataInputRecord, token.key),
          source: 'used',
        })
      }
      if (token.type === 'env') {
        const rawValue = resolveTemplateExpression(envVars, token.name)
        addRow({
          kind: 'env',
          name: token.name,
          resolved: token.resolved,
          rawValue,
          source: 'used',
        })
      }
    })

    if (parsedInput.hasInput) {
      getInputPathSuggestions(inputRecord, { maxDepth: 8, maxResults: 120, maxArrayItems: 20 })
        .filter(path => path.trim().length > 0)
        .forEach(path => {
          const rawValue = resolveInputExpression(inputRecord, path)
          if (!isConditionValue(rawValue)) return
          addRow({
            kind: 'input',
            name: path,
            resolved: stringifyBranchValue(rawValue),
            rawValue,
            source: 'available',
          })
        })
    }

    return rows
  }, [dataInputRecord, envVars, expression, inputRecord, parsedInput.hasInput])

  const handleUseVariable = (row: BranchVariableRow): void => {
    if (row.kind !== 'input' || row.resolved === null) return
    const token = `[[${row.name}]]`
    const literal = literalForCondition(row.rawValue)
    setExpression(literal ? `${token} == ${literal}` : token)
  }

  const onHeaderDown = useCallback((e: React.MouseEvent) => {
    if (isMaximized) return
    if ((e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    dragRef.current = { ox: e.clientX - rect.x, oy: e.clientY - rect.y }
  }, [isMaximized, rect.x, rect.y])

  const onResizeDown = useCallback((e: React.MouseEvent, dir: ResizeDir) => {
    e.preventDefault()
    e.stopPropagation()
    resizeRef.current = { dir, ox: e.clientX, oy: e.clientY, rx: rect.x, ry: rect.y, rw: rect.w, rh: rect.h }
  }, [rect])

  const onSplitterDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    splitterRef.current = { startX: e.clientX, startW: inputW }
  }, [inputW])

  useEffect(() => {
    const maxInputW = Math.max(MIN_INPUT_W, rect.w - MIN_SETTINGS_W - 16)
    setInputW(w => Math.max(MIN_INPUT_W, Math.min(maxInputW, w)))
  }, [rect.w])

  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      if (dragRef.current) {
        const d = dragRef.current
        setRect(r => ({
          ...r,
          x: Math.max(0, Math.min(window.innerWidth - r.w, e.clientX - d.ox)),
          y: Math.max(0, Math.min(window.innerHeight - r.h, e.clientY - d.oy)),
        }))
      }

      if (resizeRef.current) {
        const { dir, ox, oy, rx, ry, rw, rh } = resizeRef.current
        const dx = e.clientX - ox
        const dy = e.clientY - oy
        setRect(() => {
          let x = rx
          let y = ry
          let w = rw
          let h = rh
          if (dir.includes('e')) w = Math.max(MIN_W, rw + dx)
          if (dir.includes('s')) h = Math.max(MIN_H, rh + dy)
          if (dir.includes('w')) { w = Math.max(MIN_W, rw - dx); x = rx + rw - w }
          if (dir.includes('n')) { h = Math.max(MIN_H, rh - dy); y = ry + rh - h }
          x = Math.max(0, Math.min(window.innerWidth - MIN_W, x))
          y = Math.max(0, Math.min(window.innerHeight - MIN_H, y))
          return { x, y, w, h }
        })
      }

      if (splitterRef.current) {
        const delta = e.clientX - splitterRef.current.startX
        const maxInputW = Math.max(MIN_INPUT_W, rect.w - MIN_SETTINGS_W - 16)
        setInputW(Math.max(MIN_INPUT_W, Math.min(maxInputW, splitterRef.current.startW + delta)))
      }
    }

    const onUp = (): void => {
      dragRef.current = null
      resizeRef.current = null
      splitterRef.current = null
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [rect.w])

  const handleSave = async (closeAfterSave = true): Promise<boolean> => {
    setSaving(true)
    try {
      const config: BranchConfig = {
        mode,
        expression: expression.trim(),
        trueLabel: trueLabel.trim() || 'TRUE',
        falseLabel: falseLabel.trim() || 'FALSE',
        defaultRoute,
        selectedRoute,
        manualSource,
      }
      const nextModuleName = moduleName.trim() || 'BRANCH'
      await onSave(node.id, nextModuleName, JSON.stringify(config, null, 2))
      if (closeAfterSave) onClose()
      return true
    } finally {
      setSaving(false)
    }
  }

  const { shortcutSaveDialog } = useShortcutSave({
    disabled: saving,
    onClose,
    onSave: handleSave,
  })

  const handleRun = async (): Promise<void> => {
    if (!onRun) return
    setRunning(true)
    try {
      const result = await onRun()
      setInputJson(result || '')
    } catch (err) {
      setInputJson(JSON.stringify({ __previewError: String((err as Error)?.message ?? err) }, null, 2))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="dm-overlay">
      <div className={`dm-modal branch-modal-shell${isMaximized ? ' is-maximized' : ''}`} style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}>
        {RESIZE_DIRS.map(dir => (
          <div key={dir} className={`dm-resize-handle dm-resize-${dir}`} onMouseDown={e => onResizeDown(e, dir)} />
        ))}

        <div className="dm-modal-inner">
          <div className="dm-hd" onMouseDown={onHeaderDown}>
            <div className="dm-hd-left">
              <div className="dm-hd-icon branch-modal-icon"><BranchIcon size={13} /></div>
              <span className="dm-hd-title">{isNew ? t('module.branch.titleAdd') : t('module.branch.titleSettings')}</span>
            </div>
            <div className="dm-hd-window-actions">
              <button
                className="btn ghost icon dm-window-btn"
                onClick={toggleMaximized}
                title={isMaximized ? t('module.common.restoreWindow') : t('module.common.maximizeWindow')}
                aria-label={isMaximized ? t('module.common.restoreWindow') : t('module.common.maximizeWindow')}
              >
                {isMaximized ? <IcoRestore size={13} /> : <IcoMaximize size={13} />}
              </button>
              <button className="btn ghost icon dm-close-btn" onClick={onClose} title={t('common.close')} aria-label={t('common.close')}>
                <IcoX size={15} />
              </button>
            </div>
          </div>

          <div className="dm-body branch-modal-body">
            <div className="branch-input-pane" style={{ width: inputW }}>
              <div className="branch-pane-hd">
                <span className="dm-pane-label dm-pane-label-input">INPUT</span>
                <JsonInspectorButton
                  title={`${moduleName || 'BRANCH'} INPUT`}
                  value={inputJson}
                  disabled={!inputJson.trim()}
                />
                {onRun && (
                  <button
                    className="btn ghost icon dm-format-btn dm-run-btn"
                    onClick={handleRun}
                    disabled={running}
                    title={t('module.common.runUpstream')}
                  >
                    <RunIcon />
                  </button>
                )}
              </div>
              <div className="branch-input-editor">
                <JsonMonacoEditor
                  path={`${node.id}/branch-input.json`}
                  value={inputJson}
                  readOnly
                  placeholder={t('module.branch.inputPlaceholder')}
                />
              </div>
            </div>

            <div className="dm-splitter branch-splitter" onMouseDown={onSplitterDown} />

            <div className="branch-settings-pane">
              <div className="dm-field">
                <label className="dm-field-label">{t('module.common.moduleName')}</label>
                <input
                  className="dm-input"
                  value={moduleName}
                  onChange={e => setModuleName(e.target.value)}
                  placeholder="BRANCH"
                  autoFocus
                />
              </div>

              <div className="dm-field">
                <label className="dm-field-label">{t('module.branch.mode')}</label>
                <div className="branch-mode-tabs">
                  <button
                    type="button"
                    className={`branch-mode-tab${mode === 'manual' ? ' branch-mode-tab-active' : ''}`}
                    onClick={() => setMode('manual')}
                  >
                    {t('module.branch.manualMode')}
                  </button>
                  <button
                    type="button"
                    className={`branch-mode-tab${mode === 'condition' ? ' branch-mode-tab-active' : ''}`}
                    onClick={() => setMode('condition')}
                  >
                    {t('module.branch.conditionMode')}
                  </button>
                </div>

                {mode === 'manual' && (
                  <div className="branch-manual-options">
                    <button
                      type="button"
                      className={`branch-manual-option branch-manual-option-true${manualSource === 'saved' && selectedRoute === 'true' ? ' branch-manual-option-active' : ''}`}
                      onClick={() => { setManualSource('saved'); setSelectedRoute('true') }}
                    >
                      <span className="branch-manual-radio" />
                      <span>{trueLabel || 'TRUE'}</span>
                    </button>
                    <button
                      type="button"
                      className={`branch-manual-option branch-manual-option-false${manualSource === 'saved' && selectedRoute === 'false' ? ' branch-manual-option-active' : ''}`}
                      onClick={() => { setManualSource('saved'); setSelectedRoute('false') }}
                    >
                      <span className="branch-manual-radio" />
                      <span>{falseLabel || 'FALSE'}</span>
                    </button>
                    <button
                      type="button"
                      className={`branch-manual-option branch-manual-option-runtime${manualSource === 'runtime' ? ' branch-manual-option-active' : ''}`}
                      onClick={() => setManualSource('runtime')}
                    >
                      <span className="branch-manual-radio" />
                      <span>{t('module.branch.userSelect')}</span>
                    </button>
                  </div>
                )}
              </div>

              <div className="dm-field">
                <label className="dm-field-label">{t('module.branch.labels')}</label>
                <div className="branch-route-grid">
                  <div className="module-name-cell">
                    <span>{t('module.branch.trueLabel')}</span>
                    <input className="dm-input" value={trueLabel} onChange={e => setTrueLabel(e.target.value)} placeholder="TRUE" />
                  </div>
                  <div className="module-name-cell">
                    <span>{t('module.branch.falseLabel')}</span>
                    <input className="dm-input" value={falseLabel} onChange={e => setFalseLabel(e.target.value)} placeholder="FALSE" />
                  </div>
                </div>
              </div>

              {mode === 'condition' && (
                <>
                  <div className="dm-field">
                    <label className="dm-field-label">{t('module.branch.expression')}</label>
                    <input
                      className="dm-input branch-expression-input"
                      value={expression}
                      onChange={e => setExpression(e.target.value)}
                      placeholder="[[0.value]] == true"
                    />
                    <div className="branch-help">
                      {t('module.branch.example')} <code>[[0.value]] == true</code>, <code>[[0.type]] == "seat"</code>
                    </div>
                  </div>

                  <div className="dm-field">
                    <label className="dm-field-label">{t('module.branch.usedVars')}</label>
                    {variableRows.length > 0 ? (
                      <table className="api-env-vars-table branch-vars-table">
                        <thead>
                          <tr>
                            <th>{t('module.branch.kind')}</th>
                            <th>{t('module.branch.variable')}</th>
                            <th>{t('module.branch.appliedValue')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {variableRows.map(row => {
                            const isInput = row.kind === 'input'
                            const isData = row.kind === 'data'
                            const isClickable = isInput && row.resolved !== null
                            const valueText = row.resolved !== null
                              ? row.resolved
                              : isInput
                                ? t('module.branch.inputNoValue')
                                : isData
                                  ? t('module.branch.dataNoValue')
                                  : t('module.branch.envNoValue')
                            const tokenText = isInput ? `[[${row.name}]]` : isData ? `<<${row.name}>>` : `{{${row.name}}}`
                            const kindLabel = isInput ? 'INPUT' : isData ? 'DATA' : t('module.branch.kindEnv')
                            return (
                              <tr
                                key={`${row.kind}:${row.name}`}
                                className={isClickable ? 'api-var-row-clickable' : undefined}
                                onClick={() => handleUseVariable(row)}
                                title={isClickable ? t('module.branch.clickToApply') : undefined}
                              >
                                <td>
                                  <span className={`api-var-kind api-var-kind-${row.kind}`}>
                                    {kindLabel}
                                  </span>
                                </td>
                                <td>
                                  <span className={`api-var-token${isInput ? ' api-input-token' : ''}${row.resolved !== null ? ' api-var-ok' : ' api-var-err'}`}>
                                    {tokenText}
                                  </span>
                                </td>
                                <td className={row.resolved !== null ? 'api-env-val-ok' : 'api-env-val-err'}>
                                  <div className="api-env-val-content">{valueText}</div>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    ) : (
                      <div className="branch-vars-empty">
                        {t('module.branch.varsEmpty')}
                      </div>
                    )}
                  </div>

                  <div className="dm-field">
                    <label className="dm-field-label">{t('module.branch.errorDefaultRoute')}</label>
                    <select className="dm-input" value={defaultRoute} onChange={e => setDefaultRoute(e.target.value === 'true' ? 'true' : 'false')}>
                      <option value="false">{t('module.branch.falseRoute')}</option>
                      <option value="true">{t('module.branch.trueRoute')}</option>
                    </select>
                  </div>
                </>
              )}

              <div className={`branch-preview branch-preview-${evalResult.route}`}>
                <div className="branch-preview-hd">
                  <div className="branch-preview-title">{t('module.branch.preview')}</div>
                  <JsonInspectorButton
                    title={`${moduleName || 'BRANCH'} OUTPUT`}
                    value={evalResult.value}
                  />
                </div>
                <div className="branch-preview-route">
                  {t('module.branch.selectedRoute')} <strong>{evalResult.route === 'true' ? trueLabel || 'TRUE' : falseLabel || 'FALSE'}</strong>
                </div>
                <pre className="branch-preview-value">{formatJson(evalResult.value)}</pre>
                {evalResult.error && <div className="branch-preview-error">{evalResult.error}</div>}
              </div>
            </div>
          </div>

          <div className="branch-modal-ft">
            {onDelete && !confirmDelete && (
              <button className="btn ghost dm-delete-btn" onClick={() => setConfirmDelete(true)}>
                <IcoTrash size={13} />
                {t('common.delete')}
              </button>
            )}
            {confirmDelete ? (
              <>
                <span className="dm-delete-warn">{t('module.common.deleteWarning')}</span>
                <button className="btn ghost" onClick={() => setConfirmDelete(false)}>{t('common.cancel')}</button>
                <button className="btn dm-delete-confirm-btn" onClick={async () => { await onDelete?.(); onClose() }}>{t('module.common.deleteConfirm')}</button>
              </>
            ) : (
              <>
                <button className="btn ghost" onClick={onClose}>{t('common.cancel')}</button>
                <button className="btn primary" onClick={() => void handleSave(true)} disabled={saving}><ShortcutSaveButtonLabel saving={saving} /></button>
              </>
            )}
          </div>
        </div>
      </div>
      {shortcutSaveDialog}
    </div>
  )
}
