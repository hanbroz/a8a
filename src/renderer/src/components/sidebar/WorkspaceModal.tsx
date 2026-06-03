import { useState, useRef, useEffect } from 'react'
import { IcoX } from '../Icon'
import { useI18n } from '../../i18n'
import type { Environment } from '../env/EnvSection'
import type { ProjectItem } from './ProjectModal'

export type WorkspaceModalItem = {
  id: string
  name: string
  description: string
}

interface Props {
  workspace: WorkspaceModalItem | null
  environments?: Environment[]
  projects?: ProjectItem[]
  onSave: (name: string, description: string) => void
  onClose: () => void
}

export default function WorkspaceModal({ workspace, environments, projects, onSave, onClose }: Props): JSX.Element {
  const [name, setName] = useState(workspace?.name ?? '')
  const [description, setDescription] = useState(workspace?.description ?? '')
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

  const isEdit = workspace !== null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="ws-modal" onClick={e => e.stopPropagation()}>
        <div className="ws-modal-hd">
          <span className="ws-modal-title">
            {isEdit ? t('modal.workspace.editTitle') : t('modal.workspace.newTitle')}
          </span>
          <button className="btn ghost icon" onClick={onClose} title={t('common.close')}>
            <IcoX size={15} />
          </button>
        </div>

        <div className="ws-modal-body">
          <label className="ws-modal-field">
            <span className="ws-modal-field-label">{t('modal.workspace.name')}</span>
            <input
              ref={nameRef}
              className="ws-modal-input"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('modal.workspace.namePlaceholder')}
            />
          </label>
          <label className="ws-modal-field">
            <span className="ws-modal-field-label">{t('modal.workspace.description')}</span>
            <textarea
              className="ws-modal-input ws-modal-textarea"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder={t('modal.workspace.descriptionPlaceholder')}
              rows={3}
            />
          </label>

          {isEdit && (environments || projects) && (
            <div className="ws-modal-summary">
              {environments && environments.length > 0 && (
                <div className="ws-modal-summary-section">
                  <span className="ws-modal-summary-label">{t('modal.workspace.environments')}</span>
                  <div className="ws-modal-summary-list">
                    {environments.map(env => (
                      <span key={env.id} className="ws-modal-summary-badge">
                        <span className="ws-modal-summary-dot" style={{ background: env.color }} />
                        {env.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {projects && projects.length > 0 && (
                <div className="ws-modal-summary-section">
                  <span className="ws-modal-summary-label">{t('modal.workspace.projects')}</span>
                  <div className="ws-modal-summary-list">
                    {projects.map(proj => (
                      <span key={proj.id} className="ws-modal-summary-badge ws-modal-summary-badge-proj">
                        {proj.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {environments?.length === 0 && projects?.length === 0 && (
                <p className="ws-modal-summary-empty">{t('modal.workspace.empty')}</p>
              )}
            </div>
          )}
        </div>

        <div className="ws-modal-ft">
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button
            className="btn primary"
            onClick={handleSave}
            disabled={!name.trim()}
          >
            {isEdit ? t('common.edit') : t('common.add')}
          </button>
        </div>
      </div>
    </div>
  )
}
