import { useEffect, useState } from 'react'

export type MonacoEditorTheme = 'vs' | 'vs-dark'

function currentMonacoTheme(): MonacoEditorTheme {
  const appTheme = document.querySelector<HTMLElement>('.app[data-theme]')?.dataset.theme
  return appTheme === 'light' ? 'vs' : 'vs-dark'
}

export function useMonacoTheme(): MonacoEditorTheme {
  const [theme, setTheme] = useState<MonacoEditorTheme>(() => currentMonacoTheme())

  useEffect(() => {
    const syncTheme = (): void => setTheme(currentMonacoTheme())
    syncTheme()

    if (typeof MutationObserver === 'undefined') return undefined

    const appRoot = document.querySelector('.app')
    const observer = new MutationObserver(syncTheme)
    observer.observe(appRoot ?? document.body, {
      attributes: true,
      attributeFilter: ['data-theme'],
      childList: !appRoot,
      subtree: !appRoot,
    })

    return () => observer.disconnect()
  }, [])

  return theme
}
