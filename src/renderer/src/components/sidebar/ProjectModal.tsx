import { useState, useRef, useEffect } from 'react'
import { IcoX } from '../Icon'

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
            {project ? '프로젝트 수정' : '새 프로젝트'}
          </span>
          <button className="btn ghost icon" onClick={onClose} title="닫기">
            <IcoX size={15} />
          </button>
        </div>

        <div className="project-modal-body">
          <label className="project-field">
            <span className="project-field-label">프로젝트 이름</span>
            <input
              ref={nameRef}
              className="project-field-input"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="프로젝트 이름을 입력하세요"
            />
          </label>
          <label className="project-field">
            <span className="project-field-label">설명 (선택)</span>
            <textarea
              className="project-field-input project-field-textarea"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="프로젝트에 대한 설명을 입력하세요"
              rows={3}
            />
          </label>
        </div>

        <div className="env-modal-ft">
          <button className="btn" onClick={onClose}>취소</button>
          <button
            className="btn primary"
            onClick={handleSave}
            disabled={!name.trim()}
          >
            {project ? '수정' : '추가'}
          </button>
        </div>
      </div>
    </div>
  )
}
