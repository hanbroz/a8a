import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/tokens.css'
import './styles/layout.css'
import './styles/env.css'
import './styles/canvas.css'

// 플랫폼 정보를 HTML 루트에 기록해 OS별 스타일 조건에 사용합니다.
const platform = (window as any).electron?.process?.platform ?? navigator.platform.toLowerCase()
document.documentElement.dataset.platform = platform.includes('mac') || platform === 'darwin' ? 'darwin' : 'other'

function stringifyError(value: unknown): string {
  if (value instanceof Error) return `${value.message}\n\n${value.stack ?? ''}`
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function ensureRuntimeErrorPanel(): HTMLDivElement {
  const existing = document.getElementById('runtime-error-panel')
  if (existing instanceof HTMLDivElement) return existing

  const panel = document.createElement('div')
  panel.id = 'runtime-error-panel'
  panel.style.cssText = [
    'position:fixed',
    'left:12px',
    'right:12px',
    'bottom:12px',
    'max-height:44vh',
    'overflow:auto',
    'z-index:2147483647',
    'background:rgba(13,17,23,0.96)',
    'color:#f85149',
    'border:1px solid rgba(248,81,73,0.45)',
    'box-shadow:0 12px 36px rgba(0,0,0,0.4)',
    'border-radius:8px',
    'padding:12px 14px',
    'font-family:monospace',
    'font-size:12px',
    'line-height:1.45',
    'white-space:pre-wrap',
  ].join(';')

  const close = document.createElement('button')
  close.type = 'button'
  close.textContent = '닫기'
  close.style.cssText = [
    'position:sticky',
    'top:0',
    'float:right',
    'margin-left:12px',
    'border:1px solid rgba(248,81,73,0.45)',
    'border-radius:6px',
    'background:#161b22',
    'color:#f0f6fc',
    'font:inherit',
    'padding:3px 8px',
    'cursor:pointer',
  ].join(';')
  close.onclick = () => panel.remove()

  panel.appendChild(close)
  document.body.appendChild(panel)
  return panel
}

function appendRuntimeError(title: string, detail: string): void {
  const panel = ensureRuntimeErrorPanel()
  const section = document.createElement('section')
  section.style.cssText = 'padding:0 0 10px;margin:0 0 10px;border-bottom:1px solid rgba(248,81,73,0.25)'

  const heading = document.createElement('b')
  heading.textContent = title

  const body = document.createElement('pre')
  body.textContent = detail
  body.style.cssText = 'margin:6px 0 0;font:inherit;white-space:pre-wrap'

  section.appendChild(heading)
  section.appendChild(body)
  panel.appendChild(section)
}

// 전역 오류를 앱 DOM을 다시 쓰지 않는 별도 패널에 표시합니다.
window.onerror = (msg, src, line, col, err) => {
  appendRuntimeError('JS ERROR', `${String(msg)}\n${src ?? ''}:${line ?? ''}:${col ?? ''}\n\n${stringifyError(err)}`)
  return false
}
window.onunhandledrejection = (e) => {
  appendRuntimeError('UNHANDLED REJECTION', stringifyError(e.reason))
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      const e = this.state.error as Error
      return (
        <div style={{ padding: 32, fontFamily: 'monospace', color: '#f85149', background: '#0d1117', minHeight: '100vh', whiteSpace: 'pre-wrap' }}>
          <b>REACT ERROR</b>{'\n'}{e.message}{'\n\n'}{e.stack}
        </div>
      )
    }
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
)
