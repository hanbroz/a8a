import { useState } from 'react'
import { IcoCopy, IcoHelpCircle, IcoX } from '../Icon'
import {
  POST_OUTPUT_OBJECT_EXAMPLE,
  POST_RESPONSE_EXAMPLE,
  PRE_REQUEST_EXAMPLE,
} from '../../utils/scriptTemplates'

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
  const [open, setOpen] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const isPre = phase === 'pre'
  const title = isPre ? 'PRE REQUEST 스크립트 도움말' : 'POST RESPONSE 스크립트 도움말'
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
          title="예제 코드 복사"
        >
          <IcoCopy size={12} />
          {copiedId === id ? '복사됨' : '복사'}
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
                  {isPre ? '요청 실행 전에 INPUT과 환경변수를 준비합니다.' : '응답 수신 후 OUTPUT을 가공합니다.'}
                </div>
              </div>
              <button type="button" className="btn ghost icon script-help-close" onClick={() => setOpen(false)} title="닫기" aria-label="닫기">
                <IcoX size={14} />
              </button>
            </div>

            <div className="script-help-body">
              <div className="script-help-section">
                <div className="script-help-section-title">사용 가능한 함수</div>
                {isPre ? (
                  <ul className="script-help-list">
                    <li><code>getInput()</code>: 현재 모듈의 INPUT 값을 가져옵니다.</li>
                    <li><code>setInput(name, value)</code>: <code>[[name]]</code> 변수로 사용할 값을 만듭니다.</li>
                    <li><code>setEnv(name, value)</code>: 이후 요청에서 <code>{'{{name}}'}</code>으로 사용할 환경변수를 설정합니다.</li>
                    <li><code>console.log(...)</code>: 콘솔 탭에 로그를 남깁니다.</li>
                    <li><code>env</code>: 현재 환경변수 객체입니다.</li>
                  </ul>
                ) : (
                  <ul className="script-help-list">
                    <li><code>getInput()</code>: 현재 모듈의 INPUT 값을 가져옵니다.</li>
                    <li><code>getOutput()</code>: API 응답 또는 SELECT 결과 OUTPUT을 가져옵니다.</li>
                    <li><code>setOutput(value)</code>: OUTPUT 전체를 교체합니다.</li>
                    <li><code>setOutput(name, value)</code>: OUTPUT 객체에 필드를 추가하거나 교체합니다.</li>
                    <li><code>new Output()</code>: <code>add(name, value)</code>로 OUTPUT 객체를 구성합니다.</li>
                    <li><code>setEnv(name, value)</code>: 이후 요청에서 사용할 환경변수를 설정합니다.</li>
                    <li><code>console.log(...)</code>: 콘솔 탭에 로그를 남깁니다.</li>
                  </ul>
                )}
              </div>

              <div className="script-help-section">
                {renderExample(isPre ? 'pre-main' : 'post-main', '예제', isPre ? PRE_REQUEST_EXAMPLE : POST_RESPONSE_EXAMPLE)}
                {!isPre && (
                  renderExample('post-output-object', 'Output 객체 예제', POST_OUTPUT_OBJECT_EXAMPLE)
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
