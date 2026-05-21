import { useState } from 'react'

export function useSidebarOpen(key: string, defaultOpen = true): [boolean, () => void] {
  const storageKey = `sidebar-open-${key}`

  const [open, setOpen] = useState<boolean>(() => {
    const saved = localStorage.getItem(storageKey)
    return saved !== null ? saved === 'true' : defaultOpen
  })

  const toggle = (): void => {
    setOpen(prev => {
      const next = !prev
      localStorage.setItem(storageKey, String(next))
      return next
    })
  }

  return [open, toggle]
}
