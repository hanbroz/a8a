import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/tokens.css'
import './styles/layout.css'
import './styles/env.css'
import './styles/canvas.css'

// 플랫폼 정보를 HTML 루트에 기록 — CSS 조건부 스타일링 용도
const platform = (window as any).electron?.process?.platform ?? navigator.platform.toLowerCase()
document.documentElement.dataset.platform = platform.includes('mac') || platform === 'darwin' ? 'darwin' : 'other'

// Global error capture — shows any JS crash on screen even if React never mounts
window.onerror = (msg, src, line, col, err) => {
  document.body.style.cssText = 'margin:0;padding:24px;background:#0d1117;color:#f85149;font-family:monospace;font-size:13px;white-space:pre-wrap'
  document.body.innerHTML = `<b>JS ERROR</b>\n${msg}\n${src}:${line}:${col}\n\n${err?.stack ?? ''}`
  return true
}
window.onunhandledrejection = (e) => {
  document.body.style.cssText = 'margin:0;padding:24px;background:#0d1117;color:#f85149;font-family:monospace;font-size:13px;white-space:pre-wrap'
  document.body.innerHTML += `\n\n<b>UNHANDLED REJECTION</b>\n${e.reason}`
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
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
  </ErrorBoundary>
)
