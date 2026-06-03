import { useState } from 'react'
import { IcoCopy, IcoHelpCircle, IcoX } from '../Icon'
import {
  POST_OUTPUT_OBJECT_EXAMPLE,
  POST_RESPONSE_EXAMPLE,
  PRE_REQUEST_EXAMPLE,
} from '../../utils/scriptTemplates'
import { useI18n } from '../../i18n'

type ScriptPhase = 'pre' | 'post'

interface ScriptHelpButtonProps {
  phase: ScriptPhase
}

function copyTextFallback(text: string): Promise<void> {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  try {
    return document.execCommand('copy') ? Promise.resolve() : Promise.reject(new Error('copy failed'))
  } finally {
    document.body.removeChild(textarea)
  }
}

function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).catch(() => copyTextFallback(text))
  }
  return copyTextFallback(text)
}

export default function ScriptHelpButton({ phase }: ScriptHelpButtonProps): JSX.Element {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const isPre = phase === 'pre'
  const title = isPre ? t('module.scriptHelp.preTitle') : t('module.scriptHelp.postTitle')
  const copyExample = async (id: string, code: string): Promise<void> => {
    try {
      await copyText(code)
      setCopiedId(id)
      window.setTimeout(() => setCopiedId(current => current === id ? null : current), 1400)
    } catch {
      setCopiedId(null)
    }
  }
  const renderExample = (id: string, label: string, code: string): JSX.Element => (
    <div className="script-help-example">
      <div className="script-help-example-hd">
        <div className="script-help-section-title">{label}</div>
        <button
          type="button"
          className={`btn ghost script-help-copy${copiedId === id ? ' copied' : ''}`}
          onClick={() => void copyExample(id, code)}
          title={t('module.scriptHelp.copyExample')}
        >
          <IcoCopy size={12} />
          {copiedId === id ? t('common.copied') : t('common.copy')}
        </button>
      </div>
      <pre className="script-help-code">{code}</pre>
    </div>
  )

  return (
    <>
      <button
        type="button"
        className="btn ghost icon dm-format-btn api-script-help-btn"
        onClick={() => setOpen(true)}
        title={title}
        aria-label={title}
      >
        <IcoHelpCircle size={13} />
      </button>

      {open && (
        <div className="script-help-overlay" role="dialog" aria-modal="true" aria-labelledby="script-help-title" onClick={() => setOpen(false)}>
          <div className="script-help-modal" onClick={e => e.stopPropagation()}>
            <div className="script-help-hd">
              <div>
                <div id="script-help-title" className="script-help-title">{title}</div>
                <div className="script-help-subtitle">
                  {isPre ? t('module.scriptHelp.preSubtitle') : t('module.scriptHelp.postSubtitle')}
                </div>
              </div>
              <button type="button" className="btn ghost icon script-help-close" onClick={() => setOpen(false)} title={t('common.close')} aria-label={t('common.close')}>
                <IcoX size={14} />
              </button>
            </div>

            <div className="script-help-body">
              <div className="script-help-section">
                <div className="script-help-section-title">{t('module.scriptHelp.availableFunctions')}</div>
                {isPre ? (
                  <ul className="script-help-list">
                    <li><code>getInput()</code>: {t('module.scriptHelp.preGetInput')}</li>
                    <li><code>setInput(name, value)</code>: {t('module.scriptHelp.preSetInput')}</li>
                    <li><code>setEnv(name, value)</code>: {t('module.scriptHelp.setEnv')}</li>
                    <li><code>console.log(...)</code>: {t('module.scriptHelp.consoleLog')}</li>
                    <li><code>env</code>: {t('module.scriptHelp.env')}</li>
                  </ul>
                ) : (
                  <ul className="script-help-list">
                    <li><code>getInput()</code>: {t('module.scriptHelp.postGetInput')}</li>
                    <li><code>getOutput()</code>: {t('module.scriptHelp.getOutput')}</li>
                    <li><code>setOutput(value)</code>: {t('module.scriptHelp.setOutputValue')}</li>
                    <li><code>setOutput(name, value)</code>: {t('module.scriptHelp.setOutputField')}</li>
                    <li><code>new Output()</code>: {t('module.scriptHelp.outputObject')}</li>
                    <li><code>setEnv(name, value)</code>: {t('module.scriptHelp.setEnv')}</li>
                    <li><code>console.log(...)</code>: {t('module.scriptHelp.consoleLog')}</li>
                  </ul>
                )}
              </div>

              <div className="script-help-section">
                {renderExample(isPre ? 'pre-main' : 'post-main', t('module.scriptHelp.example'), isPre ? PRE_REQUEST_EXAMPLE : POST_RESPONSE_EXAMPLE)}
                {!isPre && (
                  renderExample('post-output-object', t('module.scriptHelp.outputObjectExample'), POST_OUTPUT_OBJECT_EXAMPLE)
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
