import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { IcoMaximize, IcoRestore, IcoX } from '../Icon'
import { useModalMaximize } from './useModalMaximize'
import { resolveEndReportSelectedModuleIds } from '../../utils/endReportSelection'

interface Props {
  node: ApiNode
  moduleNodes: Array<{ id: string; label: string; type: string }>
  envVarKeys: string[]
  onSave: (nodeId: string, label: string, config: string) => Promise<void>
  onClose: () => void
}

type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

const RESIZE_DIRS: ResizeDir[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']
const MIN_W = 540
const MIN_H = 480

const DEFAULT_TEMPLATE = '{env}_{ws}_{project}_{ts}'

type ParsedEndConfig = EndNodeConfig & { selectedModuleIdsExplicit: boolean }

function parseConfig(raw: string): ParsedEndConfig {
  try {
    const p = JSON.parse(raw) as Partial<EndNodeConfig>
    const selectedModuleIdsExplicit = Object.prototype.hasOwnProperty.call(p, 'selectedModuleIds')
    return {
      reportFormat: (['none', 'html', 'markdown'].includes(p.reportFormat as string) ? p.reportFormat : 'none') as EndNodeConfig['reportFormat'],
      savePath: typeof p.savePath === 'string' ? p.savePath : '',
      filenameTemplate: typeof p.filenameTemplate === 'string' && p.filenameTemplate ? p.filenameTemplate : DEFAULT_TEMPLATE,
      selectedModuleIds: Array.isArray(p.selectedModuleIds) ? p.selectedModuleIds : [],
      reportCandidateModuleIds: Array.isArray(p.reportCandidateModuleIds) ? p.reportCandidateModuleIds.map(String).filter(Boolean) : undefined,
      displayEnvKeys: Array.isArray(p.displayEnvKeys) ? p.displayEnvKeys.map(String).filter(Boolean) : [],
      selectedModuleIdsExplicit,
    }
  } catch {
    return { reportFormat: 'none', savePath: '', filenameTemplate: DEFAULT_TEMPLATE, selectedModuleIds: [], displayEnvKeys: [], selectedModuleIdsExplicit: false }
  }
}

export default function EndNodeModal({ node, moduleNodes, envVarKeys, onSave, onClose }: Props): JSX.Element {
  const initial = parseConfig(node.config)
  const [label, setLabel] = useState(node.label)
  const [reportFormat, setReportFormat] = useState<EndNodeConfig['reportFormat']>(initial.reportFormat)
  const [savePath, setSavePath] = useState<string>(initial.savePath)
  const [filenameTemplate, setFilenameTemplate] = useState<string>(initial.filenameTemplate || DEFAULT_TEMPLATE)
  const [displayEnvKeys, setDisplayEnvKeys] = useState<Set<string>>(() => new Set(initial.displayEnvKeys ?? []))
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => {
    const allIds = moduleNodes.map(n => n.id)
    return resolveEndReportSelectedModuleIds(initial, allIds)
  })
  const [saving, setSaving] = useState(false)

  // Default save path: fetch user's Downloads dir on first render if not set
  useEffect(() => {
    if (!savePath) {
      window.api.file.downloadsDir().then(dir => setSavePath(dir)).catch(() => { /* ignore */ })
    }
  }, [savePath])

  // ── Window position & size ──
  const [rect, setRect] = useState(() => {
    const ww = window.innerWidth
    const wh = window.innerHeight
    const w = Math.min(ww - 48, Math.max(680, Math.round(ww * 0.65)))
    const h = Math.min(wh - 80, Math.max(540, Math.round(wh * 0.75)))
    return { x: Math.round((ww - w) / 2), y: Math.round((wh - h) / 2), w, h }
  })
  const { isMaximized, toggleMaximized } = useModalMaximize(rect, setRect)

  const dragRef = useRef<{ ox: number; oy: number } | null>(null)
  const resizeRef = useRef<{ dir: ResizeDir; ox: number; oy: number; rx: number; ry: number; rw: number; rh: number } | null>(null)

  const onHeaderDown = useCallback((e: React.MouseEvent) => {
    if (isMaximized) return
    if ((e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    dragRef.current = { ox: e.clientX - rect.x, oy: e.clientY - rect.y }
  }, [isMaximized, rect])

  const onResizeDown = useCallback((e: React.MouseEvent, dir: ResizeDir) => {
    e.preventDefault(); e.stopPropagation()
    resizeRef.current = { dir, ox: e.clientX, oy: e.clientY, rx: rect.x, ry: rect.y, rw: rect.w, rh: rect.h }
  }, [rect])

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
        const dx = e.clientX - ox, dy = e.clientY - oy
        setRect(() => {
          let x = rx, y = ry, w = rw, h = rh
          if (dir.includes('e')) w = Math.max(MIN_W, rw + dx)
          if (dir.includes('s')) h = Math.max(MIN_H, rh + dy)
          if (dir.includes('w')) { w = Math.max(MIN_W, rw - dx); x = rx + rw - w }
          if (dir.includes('n')) { h = Math.max(MIN_H, rh - dy); y = ry + rh - h }
          return { x: Math.max(0, x), y: Math.max(0, y), w, h }
        })
      }
    }
    const onUp = (): void => { dragRef.current = null; resizeRef.current = null }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
  }, [])

  const handleBrowse = async (): Promise<void> => {
    const picked = await window.api.dialog.openDirectory(savePath || undefined)
    if (picked) setSavePath(picked)
  }

  const handleToggleModule = (id: string): void => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const handleToggleAll = (): void => {
    setSelectedIds(prev => {
      if (prev.size === moduleNodes.length) return new Set()
      return new Set(moduleNodes.map(n => n.id))
    })
  }

  const handleToggleDisplayEnv = (key: string): void => {
    setDisplayEnvKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  const handleSave = async (): Promise<void> => {
    setSaving(true)
    const cfg: EndNodeConfig = {
      reportFormat,
      savePath: savePath.trim(),
      filenameTemplate: filenameTemplate.trim() || DEFAULT_TEMPLATE,
      selectedModuleIds: Array.from(selectedIds),
      reportCandidateModuleIds: moduleNodes.map(n => n.id),
      displayEnvKeys: Array.from(displayEnvKeys).filter(key => envVarKeys.includes(key)),
    }
    await onSave(node.id, label.trim() || 'End', JSON.stringify(cfg))
    setSaving(false)
    onClose()
  }

  const disabled = reportFormat === 'none'
  const ext = reportFormat === 'html' ? '.html' : reportFormat === 'markdown' ? '.md' : ''

  const moduleColors: Record<string, { color: string; bg: string; label: string }> = useMemo(() => ({
    data:   { color: '#1f6feb', bg: 'rgba(31,111,235,0.15)',  label: 'DATA' },
    select: { color: '#8957e5', bg: 'rgba(137,87,229,0.15)',  label: 'SELECT' },
    api:    { color: '#3fb950', bg: 'rgba(63,185,80,0.15)',   label: 'API' },
  }), [])

  return (
    <div className="dm-overlay">
      <div className={`dm-modal${isMaximized ? ' is-maximized' : ''}`} style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}>
        {RESIZE_DIRS.map(dir => (
          <div key={dir} className={`dm-resize-handle dm-resize-${dir}`} onMouseDown={e => onResizeDown(e, dir)} />
        ))}
        <div className="dm-modal-inner">

          <div className="dm-hd" onMouseDown={onHeaderDown}>
            <div className="dm-hd-left">
              <div className="dm-hd-icon" style={{ background: '#6e778122', color: '#6e7781' }}>■</div>
              <span className="dm-hd-title">End 노드 설정</span>
            </div>
            <div className="dm-hd-window-actions">
              <button
                className="btn ghost icon dm-window-btn"
                onClick={toggleMaximized}
                title={isMaximized ? '이전 크기로 복원' : '창 최대화'}
                aria-label={isMaximized ? '이전 크기로 복원' : '창 최대화'}
              >
                {isMaximized ? <IcoRestore size={13} /> : <IcoMaximize size={13} />}
              </button>
              <button className="btn ghost icon dm-close-btn" onClick={onClose} title="닫기" aria-label="닫기"><IcoX size={13} /></button>
            </div>
          </div>

          <div className="dm-body" style={{ flexDirection: 'column' }}>
            <div className="dm-pane dm-pane-settings" style={{ width: '100%', flex: '1 1 0' }}>
              <div className="dm-pane-body dm-settings-body">

                <div className="dm-field">
                  <label className="dm-field-label">모듈 이름</label>
                  <input className="dm-input" value={label} onChange={e => setLabel(e.target.value)} placeholder="End" />
                </div>

                <div className="dm-field">
                  <label className="dm-field-label">리포트 형식</label>
                  <div className="end-radio-row">
                    {(['none', 'html', 'markdown'] as const).map(fmt => (
                      <label key={fmt} className={`end-radio${reportFormat === fmt ? ' end-radio-on' : ''}`}>
                        <input
                          type="radio"
                          name="reportFormat"
                          checked={reportFormat === fmt}
                          onChange={() => setReportFormat(fmt)}
                        />
                        <span>{fmt === 'none' ? '없음' : fmt === 'html' ? 'HTML' : 'MARKDOWN + MERMAID'}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="dm-field">
                  <label className="dm-field-label">저장 경로</label>
                  <div className="end-path-row">
                    <input
                      className="dm-input"
                      value={savePath}
                      onChange={e => setSavePath(e.target.value)}
                      disabled={disabled}
                      placeholder="C:\Users\…\Downloads"
                      style={{ flex: 1 }}
                    />
                    <button className="btn ghost end-browse-btn" onClick={handleBrowse} disabled={disabled}>
                      📁 찾아보기
                    </button>
                  </div>
                </div>

                <div className="dm-field">
                  <label className="dm-field-label">
                    파일명{' '}
                    <span className="end-field-hint">
                      변수: <code>{'{env}'}</code> <code>{'{ws}'}</code> <code>{'{project}'}</code> <code>{'{ts}'}</code>
                    </span>
                  </label>
                  <div className="end-path-row">
                    <input
                      className="dm-input"
                      value={filenameTemplate}
                      onChange={e => setFilenameTemplate(e.target.value)}
                      disabled={disabled}
                      placeholder={DEFAULT_TEMPLATE}
                      style={{ flex: 1, fontFamily: 'monospace' }}
                    />
                    {ext && <span className="end-ext-hint">{ext} 자동 부여</span>}
                  </div>
                </div>

                <div className="dm-field dm-field-grow">
                  <div className="dm-field-hd">
                    <label className="dm-field-label">출력을 저장할 모듈 ({selectedIds.size}/{moduleNodes.length})</label>
                    <button className="btn ghost end-toggle-all-btn" onClick={handleToggleAll} disabled={disabled || moduleNodes.length === 0}>
                      {selectedIds.size === moduleNodes.length ? '모두 해제' : '모두 선택'}
                    </button>
                  </div>
                  <div className="end-module-list">
                    {moduleNodes.length === 0 ? (
                      <div className="dm-empty-hint">캔버스에 모듈이 없습니다.</div>
                    ) : (
                      moduleNodes.map(m => {
                        const meta = moduleColors[m.type] ?? { color: '#6e7781', bg: 'rgba(110,119,129,0.15)', label: m.type.toUpperCase() }
                        const checked = selectedIds.has(m.id)
                        return (
                          <label key={m.id} className={`end-module-item${disabled ? ' end-module-item-disabled' : ''}`}>
                            <input type="checkbox" checked={checked} onChange={() => handleToggleModule(m.id)} disabled={disabled} />
                            <span className="end-module-badge" style={{ background: meta.bg, color: meta.color, borderColor: `${meta.color}55` }}>
                              {meta.label}
                            </span>
                            <span className="end-module-label">{m.label}</span>
                          </label>
                        )
                      })
                    )}
                  </div>
                </div>

                <div className="dm-field">
                  <label className="dm-field-label">END 모듈에 표시할 환경 변수</label>
                  <div className="end-env-key-list">
                    {envVarKeys.length === 0 ? (
                      <div className="dm-empty-hint">선택할 환경 변수가 없습니다.</div>
                    ) : (
                      envVarKeys.map(key => (
                        <label key={key} className="end-env-key-item">
                          <input
                            type="checkbox"
                            checked={displayEnvKeys.has(key)}
                            onChange={() => handleToggleDisplayEnv(key)}
                          />
                          <span>{key}</span>
                        </label>
                      ))
                    )}
                  </div>
                  <div className="end-field-hint">
                    선택한 값은 실행 완료 후 END 모듈 안에 표시되고 복사할 수 있습니다.
                  </div>
                </div>

              </div>
            </div>
          </div>

          <div className="dm-ft">
            <button className="btn ghost" onClick={onClose}>취소</button>
            <button className="btn primary" onClick={handleSave} disabled={saving}>
              {saving ? '저장 중…' : '저장'}
            </button>
          </div>

        </div>
      </div>
    </div>
  )
}
