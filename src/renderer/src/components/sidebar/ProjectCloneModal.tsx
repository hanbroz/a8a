import { useEffect, useRef, useState } from 'react'
import { IcoX } from '../Icon'
import { useI18n } from '../../i18n'
import type { ProjectItem } from './ProjectModal'

interface Props {
  project: ProjectItem
  onConfirm: (name: string) => Promise<void>
  onClose: () => void
}

export default function ProjectCloneModal({ project, onConfirm, onClose }: Props): JSX.Element {
  const { t } = useI18n()
  const [name, setName] = useState(`${project.name} ${t('modal.projectClone.defaultSuffix')}`)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    nameRef.current?.focus()
    nameRef.current?.select()
  }, [])

  const submit = async (): Promise<void> => {
    const trimmed = name.trim()
    if (!trimmed || saving) return
    setSaving(true)
    setError(null)
    try {
      await onConfirm(trimmed)
    } catch (err) {
      setError(String((err as Error)?.message ?? err))
      setSaving(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') void submit()
    if (e.key === 'Escape' && !saving) onClose()
  }

  return (
    <div className="modal-overlay" onClick={() => { if (!saving) onClose() }}>
      <div className="project-modal" onClick={e => e.stopPropagation()}>
        <div className="env-modal-hd">
          <span className="env-modal-base-label">{t('modal.projectClone.title')}</span>
          <button className="btn ghost icon" onClick={onClose} title={t('common.close')} disabled={saving}>
            <IcoX size={15} />
          </button>
        </div>

        <div className="project-modal-body">
          <div className="project-modal-hint">
            {t('modal.projectClone.hint', { name: project.name })}
          </div>
          <label className="project-field">
            <span className="project-field-label">{t('modal.projectClone.name')}</span>
            <input
              ref={nameRef}
              className="project-field-input"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('modal.project.namePlaceholder')}
              disabled={saving}
            />
          </label>
          {error && <div className="project-field-error">{error}</div>}
        </div>

        <div className="env-modal-ft">
          <button className="btn" onClick={onClose} disabled={saving}>{t('common.cancel')}</button>
          <button
            className="btn primary"
            onClick={() => { void submit() }}
            disabled={!name.trim() || saving}
          >
            {saving ? t('modal.projectClone.saving') : t('sidebar.project.duplicate')}
          </button>
        </div>
      </div>
    </div>
  )
}
