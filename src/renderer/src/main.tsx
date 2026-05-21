import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/tokens.css'
import './styles/layout.css'
import './styles/env.css'

// 플랫폼 정보를 HTML 루트에 기록 — CSS 조건부 스타일링 용도
const platform = (window as any).electron?.process?.platform ?? navigator.platform.toLowerCase()
document.documentElement.dataset.platform = platform.includes('mac') || platform === 'darwin' ? 'darwin' : 'other'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
