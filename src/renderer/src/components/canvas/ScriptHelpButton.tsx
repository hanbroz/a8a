import { useState } from 'react'
import { IcoHelpCircle, IcoX } from '../Icon'

type ScriptPhase = 'pre' | 'post'

interface ScriptHelpButtonProps {
  phase: ScriptPhase
}

const PRE_REQUEST_EXAMPLE = `const input = getInput()

// API URL, Header, Body에서 [[customerId]] 또는 <<customerId>>로 사용할 수 있습니다.
setInput("customerId", input.customerId)

// 이후 요청에서 {{token}}으로 사용할 수 있습니다.
setEnv("token", input.token)

console.log("customerId", input.customerId)`

const POST_RESPONSE_EXAMPLE = `const output = getOutput()

// OUTPUT 전체를 단순한 객체로 교체합니다.
setOutput({
  orderId: output.orderId,
  currencyCode: output.currencyCode
})

// 또는 이름/값 형태로 OUTPUT 필드를 추가할 수 있습니다.
setOutput("orderId", output.orderId)`

const POST_OUTPUT_OBJECT_EXAMPLE = `const output = getOutput()
const next = new Output()

next.add("from", output.results?.[0]?.trips?.[0])
next.add("to", output.results?.[1]?.trips?.[0])

setOutput(next)`

export default function ScriptHelpButton({ phase }: ScriptHelpButtonProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const isPre = phase === 'pre'
  const title = isPre ? 'PRE REQUEST 스크립트 도움말' : 'POST RESPONSE 스크립트 도움말'

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
                <div className="script-help-section-title">예제</div>
                <pre className="script-help-code">{isPre ? PRE_REQUEST_EXAMPLE : POST_RESPONSE_EXAMPLE}</pre>
                {!isPre && (
                  <>
                    <div className="script-help-section-title script-help-section-title-secondary">Output 객체 예제</div>
                    <pre className="script-help-code">{POST_OUTPUT_OBJECT_EXAMPLE}</pre>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
