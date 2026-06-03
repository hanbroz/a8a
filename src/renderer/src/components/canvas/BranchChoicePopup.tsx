import { useI18n } from '../../i18n'

interface Props {
  title: string
  trueLabel: string
  falseLabel: string
  defaultRoute: 'true' | 'false'
  onConfirm: (route: 'true' | 'false') => void
  onCancel: () => void
}

function BranchIcon(): JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="3" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="18" cy="18" r="3" />
      <path d="M8.6 7.4 15.4 16.6" />
      <path d="M9 6h6" />
    </svg>
  )
}

export default function BranchChoicePopup({
  title,
  trueLabel,
  falseLabel,
  defaultRoute,
  onConfirm,
  onCancel,
}: Props): JSX.Element {
  const { t } = useI18n()
  return (
    <div className="branch-choice-overlay">
      <div className="branch-choice-modal">
        <div className="branch-choice-hd">
          <span className="branch-choice-icon"><BranchIcon /></span>
          <div>
            <div className="branch-choice-title">{title}</div>
            <div className="branch-choice-subtitle">{t('module.branchChoice.subtitle')}</div>
          </div>
        </div>

        <div className="branch-choice-options">
          <button
            className={`branch-choice-option branch-choice-option-true${defaultRoute === 'true' ? ' branch-choice-option-default' : ''}`}
            onClick={() => onConfirm('true')}
          >
            <span className="branch-choice-dot" />
            <span>{trueLabel || 'TRUE'}</span>
          </button>
          <button
            className={`branch-choice-option branch-choice-option-false${defaultRoute === 'false' ? ' branch-choice-option-default' : ''}`}
            onClick={() => onConfirm('false')}
          >
            <span className="branch-choice-dot" />
            <span>{falseLabel || 'FALSE'}</span>
          </button>
        </div>

        <div className="branch-choice-ft">
          <button className="btn ghost" onClick={onCancel}>{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  )
}
