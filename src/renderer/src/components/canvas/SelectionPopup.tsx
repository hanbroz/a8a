import { useState, useRef, useEffect, useCallback } from 'react'
import { IcoX } from '../Icon'

interface Props {
  data: Record<string, unknown>[]
  onConfirm: (selectedRows: Record<string, unknown>[]) => void
  onCancel: () => void
}

function CheckIcon(): JSX.Element {
  return (
    <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="2 6 5 9 10 3" />
    </svg>
  )
}

export default function SelectionPopup({ data, onConfirm, onCancel }: Props): JSX.Element {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const dragRef = useRef<{ ox: number; oy: number } | null>(null)
  const modalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (modalRef.current && pos === null) {
      const el = modalRef.current
      const w = el.offsetWidth || 800
      const h = el.offsetHeight || 400
      setPos({
        x: Math.max(0, (window.innerWidth - w) / 2),
        y: Math.max(0, (window.innerHeight - h) / 2),
      })
    }
  }, [pos])

  const onHeaderDown = useCallback((e: React.MouseEvent) => {
    if (!pos) return
    e.preventDefault()
    dragRef.current = { ox: e.clientX - pos.x, oy: e.clientY - pos.y }

    const onMove = (me: MouseEvent) => {
      if (!dragRef.current) return
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - 100, me.clientX - dragRef.current.ox)),
        y: Math.max(0, Math.min(window.innerHeight - 40, me.clientY - dragRef.current.oy)),
      })
    }
    const onUp = () => {
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [pos])

  const columns = data.length > 0 ? Object.keys(data[0]) : []

  const toggleRow = (idx: number) => {
    setSelectedIndex(prev => prev === idx ? null : idx)
  }

  const handleConfirm = () => {
    if (selectedIndex === null) return
    onConfirm([data[selectedIndex]])
  }

  const modalStyle: React.CSSProperties = pos
    ? { position: 'fixed', left: pos.x, top: pos.y, margin: 0 }
    : { position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', margin: 0 }

  return (
    <div className="sp-overlay" style={{ pointerEvents: 'none' }}>
      <div
        ref={modalRef}
        className="sp-modal"
        style={{ ...modalStyle, pointerEvents: 'all' }}
      >
        <div className="sp-hd" style={{ cursor: 'move' }} onMouseDown={onHeaderDown}>
          <div className="sp-hd-left">
            <span className="sp-title">데이터 선택</span>
            <span className="sp-subtitle">다음 모듈로 전달할 행을 선택하세요</span>
          </div>
          <button className="btn ghost icon dm-close-btn" onMouseDown={e => e.stopPropagation()} onClick={onCancel}><IcoX size={13} /></button>
        </div>

        <div className="sp-body">
          {data.length > 0 ? (
            <div className="sm-input-table">
              <table>
                <thead>
                  <tr>
                    <th></th>
                    {columns.map(col => <th key={col}>{col}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {data.map((row, idx) => {
                    const isChecked = selectedIndex === idx
                    return (
                      <tr
                        key={idx}
                        className={isChecked ? 'sm-row-checked' : ''}
                        onClick={() => toggleRow(idx)}
                      >
                        <td>
                          <div className={`sm-col-check${isChecked ? ' checked' : ''}`}>
                            {isChecked && <CheckIcon />}
                          </div>
                        </td>
                        {columns.map(col => (
                          <td key={col}>{String(row[col] ?? '')}</td>
                        ))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="sm-col-empty">데이터가 없습니다</div>
          )}
        </div>

        <div className="sp-ft">
          <span className="sp-count">{selectedIndex !== null ? `${selectedIndex + 1}번째 행 선택됨` : '미선택'}</span>
          <button className="btn ghost" onClick={onCancel}>취소</button>
          <button
            className="btn primary"
            onClick={handleConfirm}
            disabled={selectedIndex === null}
          >
            선택 완료
          </button>
        </div>
      </div>
    </div>
  )
}
