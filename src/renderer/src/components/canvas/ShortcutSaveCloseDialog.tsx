import { useCallback, useEffect, useState } from 'react'
import { IcoX } from '../Icon'
import { useI18n } from '../../i18n'
import { saveShortcutSaveClosePreference } from '../../utils/shortcutSavePreference'

interface Props {
  onChoice: (closeAfterSave: boolean) => void
}

export default function ShortcutSaveCloseDialog({ onChoice }: Props): JSX.Element {
  const { t } = useI18n()
  const [remember, setRemember] = useState(false)

  const choose = useCallback((closeAfterSave: boolean): void => {
    if (remember) saveShortcutSaveClosePreference(closeAfterSave ? 'close' : 'keep-open')
    onChoice(closeAfterSave)
  }, [onChoice, remember])

  const dismiss = useCallback((): void => {
    onChoice(false)
  }, [onChoice])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        dismiss()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [dismiss])

  return (
    <div className="modal-overlay shortcut-save-overlay" onClick={dismiss}>
      <div className="confirm-dialog shortcut-save-dialog" onClick={e => e.stopPropagation()}>
        <div className="confirm-hd">
          <span className="confirm-title">{t('module.shortcutSave.closeTitle')}</span>
          <button className="btn ghost icon" onClick={dismiss} title={t('common.close')} aria-label={t('common.close')}>
            <IcoX size={15} />
          </button>
        </div>
        <div className="confirm-body">
          <p className="confirm-message">{t('module.shortcutSave.closeMessage')}</p>
          <label className="shortcut-save-remember">
            <input
              type="checkbox"
              checked={remember}
              onChange={event => setRemember(event.target.checked)}
            />
            <span>{t('module.shortcutSave.doNotAskAgain')}</span>
          </label>
        </div>
        <div className="confirm-ft">
          <button className="btn ghost" onClick={() => choose(false)}>{t('common.no')}</button>
          <button className="btn primary" onClick={() => choose(true)}>{t('common.yes')}</button>
        </div>
      </div>
    </div>
  )
}
