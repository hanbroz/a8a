import { IcoX } from './Icon'

interface Props {
  title: string
  message: string
  warning: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  title,
  message,
  warning,
  confirmLabel = '삭제',
  onConfirm,
  onCancel
}: Props): JSX.Element {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="confirm-dialog" onClick={e => e.stopPropagation()}>
        <div className="confirm-hd">
          <span className="confirm-title">{title}</span>
          <button className="btn ghost icon" onClick={onCancel} title="닫기">
            <IcoX size={15} />
          </button>
        </div>
        <div className="confirm-body">
          <p className="confirm-message">{message}</p>
          <div className="confirm-warning">
            <span className="confirm-warning-icon">⚠</span>
            <span>{warning}</span>
          </div>
        </div>
        <div className="confirm-ft">
          <button className="btn" onClick={onCancel}>취소</button>
          <button className="btn danger" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
