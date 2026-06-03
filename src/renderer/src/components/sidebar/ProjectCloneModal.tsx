import { useEffect, useRef, useState } from 'react'
import { IcoX } from '../Icon'
import type { ProjectItem } from './ProjectModal'

interface Props {
  project: ProjectItem
  onConfirm: (name: string) => Promise<void>
  onClose: () => void
}

export default function ProjectCloneModal({ project, onConfirm, onClose }: Props): JSX.Element {
  const [name, setName] = useState(`${project.name} 복사본`)
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
          <span className="env-modal-base-label">프로젝트 복제</span>
          <button className="btn ghost icon" onClick={onClose} title="닫기" disabled={saving}>
            <IcoX size={15} />
          </button>
        </div>

        <div className="project-modal-body">
          <div className="project-modal-hint">
            원본 프로젝트 "{project.name}"의 캔버스와 연결선을 새 프로젝트로 복제합니다.
          </div>
          <label className="project-field">
            <span className="project-field-label">복제할 프로젝트 이름</span>
            <input
              ref={nameRef}
              className="project-field-input"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="프로젝트 이름을 입력하세요"
              disabled={saving}
            />
          </label>
          {error && <div className="project-field-error">{error}</div>}
        </div>

        <div className="env-modal-ft">
          <button className="btn" onClick={onClose} disabled={saving}>취소</button>
          <button
            className="btn primary"
            onClick={() => { void submit() }}
            disabled={!name.trim() || saving}
          >
            {saving ? '복제 중...' : '복제'}
          </button>
        </div>
      </div>
    </div>
  )
}
