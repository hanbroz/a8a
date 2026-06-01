import { useState, useRef, useCallback, useEffect } from 'react'
import ExcelJS from 'exceljs'
import { IcoMaximize, IcoRestore, IcoTrash, IcoX } from '../Icon'
import JsonMonacoEditor from './JsonMonacoEditor'
import { useModalMaximize } from './useModalMaximize'

interface Props {
  node: ApiNode
  isNew?: boolean
  initialInput?: string
  onRun?: () => string | Promise<string>
  onSave: (nodeId: string, label: string, config: string) => Promise<void>
  onDelete?: () => Promise<void>
  onClose: () => void
}

type ResizeDir = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'

const MIN_W = 600
const MIN_H = 360
const RESIZE_DIRS: ResizeDir[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']

// Reads node.config and returns the new-shape DataConfig.
// Migrates legacy `{ items, excelData }` shape to a single `output` JSON string.
function parseConfig(raw: string): DataConfig {
  try {
    const parsed = JSON.parse(raw) as DataConfig & LegacyDataConfig
    if (typeof parsed.output === 'string') return { output: parsed.output }
    if (parsed.excelData?.rows?.length) return { output: JSON.stringify(parsed.excelData.rows, null, 2) }
    if (Array.isArray(parsed.items)) {
      return { output: JSON.stringify(parsed.items.map(i => i.value).filter(Boolean), null, 2) }
    }
    return { output: '' }
  } catch {
    return { output: '' }
  }
}

function DataIcon({ size = 14 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5" />
      <path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3" />
    </svg>
  )
}

function FormatIcon(): JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 7 4 4 20 4 20 7" />
      <line x1="9" y1="20" x2="15" y2="20" />
      <line x1="12" y1="4" x2="12" y2="20" />
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

function ExcelIcon(): JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="16" y2="17" />
      <line x1="8" y1="9" x2="10" y2="9" />
    </svg>
  )
}

function UploadIcon(): JSX.Element {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  )
}

function formatJson(raw: string): { value: string; error: boolean } {
  const trimmed = raw.trim()
  if (!trimmed) return { value: '', error: false }
  try {
    return { value: JSON.stringify(JSON.parse(trimmed), null, 2), error: false }
  } catch {
    return { value: raw, error: true }
  }
}

interface ExcelInfo {
  fileName: string
  columns: string[]
  rowCount: number
}

export default function DataNodeModal({ node, isNew, initialInput, onRun, onSave, onDelete, onClose }: Props): JSX.Element {
  const initial = parseConfig(node.config)
  const [moduleName, setModuleName] = useState(node.label)
  const [outputJson, setOutputJson] = useState(initial.output)
  const [outputError, setOutputError] = useState(false)
  const [excelInfo, setExcelInfo] = useState<ExcelInfo | null>(null)
  const [saving, setSaving] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const [inputJson, setInputJson] = useState(initialInput ?? '')
  const [inputError, setInputError] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Window position & size ──
  const [rect, setRect] = useState(() => {
    const ww = window.innerWidth
    const wh = window.innerHeight
    const w = Math.min(ww - 48, Math.max(720, Math.round(ww * 0.8)))
    const h = Math.min(wh - 80, Math.max(480, Math.round(wh * 0.8)))
    return { x: Math.round((ww - w) / 2), y: Math.round((wh - h) / 2), w, h }
  })
  const { isMaximized, toggleMaximized } = useModalMaximize(rect, setRect)

  const dragRef = useRef<{ ox: number; oy: number } | null>(null)
  const resizeRef = useRef<{ dir: ResizeDir; ox: number; oy: number; rx: number; ry: number; rw: number; rh: number } | null>(null)
  const splitterRef = useRef<{ which: 'left' | 'right'; startX: number; startW: number } | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [leftW, setLeftW] = useState(() => Math.round(rect.w / 3))
  const [rightW, setRightW] = useState(() => Math.round(rect.w / 3))

  useEffect(() => {
    const nextInitial = parseConfig(node.config)
    setModuleName(node.label)
    setOutputJson(nextInitial.output)
    setOutputError(false)
    setInputJson(initialInput ?? '')
    setInputError(false)
    setExcelInfo(null)
  }, [node.id, node.label, node.config, initialInput])

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

  const onSplitterDown = useCallback((which: 'left' | 'right', e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    splitterRef.current = { which, startX: e.clientX, startW: which === 'left' ? leftW : rightW }
  }, [leftW, rightW])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
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
      if (splitterRef.current) {
        const d = splitterRef.current
        const totalW = bodyRef.current?.offsetWidth ?? 800
        const delta = e.clientX - d.startX
        if (d.which === 'left') setLeftW(() => Math.max(100, Math.min(totalW - rightW - 160, d.startW + delta)))
        else setRightW(() => Math.max(100, Math.min(totalW - leftW - 160, d.startW - delta)))
      }
    }
    const onUp = () => { dragRef.current = null; resizeRef.current = null; splitterRef.current = null }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
  }, [leftW, rightW])

  // ── Excel parsing — populates OUTPUT JSON and stores local-only Excel info ──
  const applyExcelData = (fileName: string, columns: string[], rows: Record<string, unknown>[]) => {
    setExcelInfo({ fileName, columns, rowCount: rows.length })
    setOutputJson(JSON.stringify(rows, null, 2))
    setOutputError(false)
  }

  const parseExcel = useCallback((file: File) => {
    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        const buffer = e.target?.result as ArrayBuffer
        if (file.name.toLowerCase().endsWith('.csv')) {
          const text = new TextDecoder('utf-8').decode(buffer)
          const lines = text.split(/\r?\n/).filter(l => l.trim())
          if (lines.length === 0) {
            applyExcelData(file.name, [], [])
            return
          }
          const columns = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''))
          const rows = lines.slice(1).map(line => {
            const vals = line.split(',')
            const obj: Record<string, unknown> = {}
            columns.forEach((h, i) => { obj[h] = (vals[i] ?? '').trim().replace(/^"|"$/g, '') })
            return obj
          })
          applyExcelData(file.name, columns, rows)
        } else {
          const workbook = new ExcelJS.Workbook()
          await workbook.xlsx.load(buffer)
          const sheet = workbook.worksheets[0]
          const columns: string[] = []
          sheet.getRow(1).eachCell({ includeEmpty: false }, cell => {
            columns.push(String(cell.value ?? ''))
          })
          const rows: Record<string, unknown>[] = []
          sheet.eachRow((row, rowNum) => {
            if (rowNum === 1) return
            const obj: Record<string, unknown> = {}
            columns.forEach((h, i) => { obj[h] = row.getCell(i + 1).value ?? '' })
            rows.push(obj)
          })
          applyExcelData(file.name, columns, rows)
        }
      } catch {
        alert('파일을 파싱할 수 없습니다. .xlsx, .xls, .csv 파일을 사용해 주세요.')
      }
    }
    reader.readAsArrayBuffer(file)
  }, [])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) parseExcel(file)
    e.target.value = ''
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) parseExcel(file)
  }

  const handleFormatInput = () => {
    const result = formatJson(inputJson)
    setInputJson(result.value); setInputError(result.error)
  }

  const handleFormatOutput = () => {
    const result = formatJson(outputJson)
    setOutputJson(result.value); setOutputError(result.error)
  }

  const handleSave = async () => {
    setSaving(true)
    const result = formatJson(outputJson)
    if (result.error) {
      setOutputJson(result.value)
      setOutputError(result.error)
      setSaving(false)
      return
    }
    const config: DataConfig = { output: result.value }
    const nextModuleName = moduleName.trim() || 'DATA'
    await onSave(node.id, nextModuleName, JSON.stringify(config))
    setSaving(false); onClose()
  }

  return (
    <div className="dm-overlay">
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      <div className={`dm-modal${isMaximized ? ' is-maximized' : ''}`} style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}>
        {RESIZE_DIRS.map(dir => (
          <div key={dir} className={`dm-resize-handle dm-resize-${dir}`} onMouseDown={e => onResizeDown(e, dir)} />
        ))}

        <div className="dm-modal-inner">

          {/* Header */}
          <div className="dm-hd" onMouseDown={onHeaderDown}>
            <div className="dm-hd-left">
              <div className="dm-hd-icon"><DataIcon size={13} /></div>
              <span className="dm-hd-title">{isNew ? 'Data 모듈 추가' : 'Data 모듈 설정'}</span>
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

          {/* 3-pane body */}
          <div className="dm-body" ref={bodyRef}>

            {/* INPUT pane */}
            <div className="dm-pane" style={{ width: leftW, flexShrink: 0 }}>
              <div className="dm-pane-hd">
                <span className={`dm-pane-label dm-pane-label-input${inputError ? ' dm-pane-label-error' : ''}`}>INPUT</span>
                <div className="dm-pane-hd-actions">
                  {inputError && <span className="dm-json-err-badge">Invalid JSON</span>}
                  <span className="dm-pane-type">JSON</span>
                  {onRun && (
                    <button
                      className="btn ghost icon dm-format-btn dm-run-btn"
                      onClick={async () => {
                        const result = await onRun()
                        setInputJson(result)
                        setInputError(false)
                      }}
                      title="실행 — 연결된 상류 노드 데이터 가져오기"
                    >
                      <RunIcon />
                    </button>
                  )}
                  <button className="btn ghost icon dm-format-btn" onClick={handleFormatInput} title="JSON 정렬">
                    <FormatIcon />
                  </button>
                </div>
              </div>
              <div className="dm-pane-body">
                <JsonMonacoEditor
                  path={`${node.id}/data-input.json`}
                  value={inputJson}
                  onChange={next => { setInputJson(next); setInputError(false) }}
                  error={inputError}
                  placeholder="{}"
                />
              </div>
            </div>

            <div className="dm-splitter" onMouseDown={e => onSplitterDown('left', e)} />

            {/* Settings pane */}
            <div className="dm-pane dm-pane-settings" style={{ flex: '1 1 0', minWidth: 160 }}>
              <div className="dm-pane-hd">
                <span className="dm-pane-label">설정</span>
              </div>
              <div className="dm-pane-body dm-settings-body">

                <div className="dm-field">
                  <label className="dm-field-label">모듈 이름</label>
                  <input className="dm-input" value={moduleName} onChange={e => setModuleName(e.target.value)} placeholder="DATA" autoFocus />
                </div>

                {/* Excel upload — populates OUTPUT on success; info chip is local-only */}
                <div className="dm-field">
                  <label className="dm-field-label">Excel 업로드</label>
                  {excelInfo ? (
                    <div className="dm-excel-info">
                      <div className="dm-excel-file-row">
                        <div className="dm-excel-file-icon"><ExcelIcon /></div>
                        <div className="dm-excel-file-meta">
                          <span className="dm-excel-file-name">{excelInfo.fileName}</span>
                          <span className="dm-excel-file-stat">
                            {excelInfo.columns.length}열 · {excelInfo.rowCount}행
                          </span>
                        </div>
                        <button
                          className="btn ghost icon dm-item-del"
                          style={{ width: 22, height: 22, marginLeft: 'auto' }}
                          onClick={() => setExcelInfo(null)}
                          title="표시 제거 (OUTPUT 데이터는 유지)"
                        >
                          <IcoX size={11} />
                        </button>
                      </div>
                      {excelInfo.columns.length > 0 && (
                        <div className="dm-excel-cols">
                          {excelInfo.columns.map(col => (
                            <span key={col} className="dm-excel-col-chip">{col}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div
                      className={`dm-upload-zone${dragOver ? ' dm-upload-zone-over' : ''}`}
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={handleDrop}
                    >
                      <div className="dm-upload-icon"><UploadIcon /></div>
                      <span className="dm-upload-text">클릭하거나 파일을 드래그하세요</span>
                      <span className="dm-upload-hint">.xlsx · .xls · .csv → OUTPUT에 자동 채움</span>
                    </div>
                  )}
                </div>

              </div>
            </div>

            <div className="dm-splitter" onMouseDown={e => onSplitterDown('right', e)} />

            {/* OUTPUT pane — editable */}
            <div className="dm-pane" style={{ width: rightW, flexShrink: 0 }}>
              <div className="dm-pane-hd">
                <span className={`dm-pane-label dm-pane-label-output${outputError ? ' dm-pane-label-error' : ''}`}>OUTPUT</span>
                <div className="dm-pane-hd-actions">
                  {outputError && <span className="dm-json-err-badge">Invalid JSON</span>}
                  <span className="dm-pane-type">JSON</span>
                  <button
                    className="btn ghost icon dm-format-btn"
                    onClick={handleFormatOutput}
                    title="JSON 정렬"
                  >
                    <FormatIcon />
                  </button>
                </div>
              </div>
              <div className="dm-pane-body">
                <JsonMonacoEditor
                  path={`${node.id}/data-output.json`}
                  value={outputJson}
                  onChange={next => { setOutputJson(next); setOutputError(false) }}
                  error={outputError}
                  placeholder="[]"
                />
              </div>
            </div>

          </div>

          {/* Footer */}
          <div className="dm-ft">
            {onDelete && !confirmDelete && (
              <button
                className="btn ghost dm-delete-btn"
                onClick={() => setConfirmDelete(true)}
                title="모듈 삭제"
              >
                <IcoTrash size={13} />
                삭제
              </button>
            )}
            {confirmDelete && (
              <>
                <span className="dm-delete-warn">⚠ 이 모듈이 삭제됩니다.</span>
                <button className="btn ghost" onClick={() => setConfirmDelete(false)}>취소</button>
                <button
                  className="btn dm-delete-confirm-btn"
                  onClick={async () => { await onDelete!(); onClose() }}
                >
                  삭제 확인
                </button>
              </>
            )}
            {!confirmDelete && (
              <>
                <button
                  className="btn ghost"
                  onClick={isNew && onDelete ? async () => { await onDelete(); onClose() } : onClose}
                >
                  취소
                </button>
                <button className="btn primary" onClick={handleSave} disabled={saving}>{saving ? '저장 중…' : '저장'}</button>
              </>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}
