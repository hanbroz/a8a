import { useState, useRef, useEffect } from 'react'
import { IcoX } from '../Icon'
import { useI18n } from '../../i18n'

export type ProjectItem = { id: string; name: string; description: string }

interface Props {
  project: ProjectItem | null
  onSave: (name: string, description: string) => void
  onClose: () => void
}

export default function ProjectModal({ project, onSave, onClose }: Props): JSX.Element {
  const [name, setName] = useState(project?.name ?? '')
  const [description, setDescription] = useState(project?.description ?? '')
  const nameRef = useRef<HTMLInputElement>(null)
  const { t } = useI18n()

  useEffect(() => { nameRef.current?.focus() }, [])

  const handleSave = (): void => {
    const trimmed = name.trim()
    if (!trimmed) return
    onSave(trimmed, description.trim())
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey) handleSave()
    if (e.key === 'Escape') onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="project-modal" onClick={e => e.stopPropagation()}>
        <div className="env-modal-hd">
          <span className="env-modal-base-label">
            {project ? t('modal.project.editTitle') : t('modal.project.newTitle')}
          </span>
          <button className="btn ghost icon" onClick={onClose} title={t('common.close')}>
            <IcoX size={15} />
          </button>
        </div>

        <div className="project-modal-body">
          <label className="project-field">
            <span className="project-field-label">{t('modal.project.name')}</span>
            <input
              ref={nameRef}
              className="project-field-input"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('modal.project.namePlaceholder')}
            />
          </label>
          <label className="project-field">
            <span className="project-field-label">{t('modal.project.description')}</span>
            <textarea
              className="project-field-input project-field-textarea"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder={t('modal.project.descriptionPlaceholder')}
              rows={3}
            />
          </label>
        </div>

        <div className="env-modal-ft">
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button
            className="btn primary"
            onClick={handleSave}
            disabled={!name.trim()}
          >
            {project ? t('common.edit') : t('common.add')}
          </button>
        </div>
      </div>
    </div>
  )
}
