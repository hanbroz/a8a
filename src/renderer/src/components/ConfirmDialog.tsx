import { IcoX } from './Icon'
import { useI18n } from '../i18n'

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
  confirmLabel,
  onConfirm,
  onCancel
}: Props): JSX.Element {
  const { t } = useI18n()
  const resolvedConfirmLabel = confirmLabel ?? t('common.delete')

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="confirm-dialog" onClick={e => e.stopPropagation()}>
        <div className="confirm-hd">
          <span className="confirm-title">{title}</span>
          <button className="btn ghost icon" onClick={onCancel} title={t('common.close')}>
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
          <button className="btn" onClick={onCancel}>{t('common.cancel')}</button>
          <button className="btn danger" onClick={onConfirm}>{resolvedConfirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
