import { useCallback, useEffect, useRef, useState } from 'react'
import ShortcutSaveCloseDialog from './ShortcutSaveCloseDialog'
import { loadShortcutSaveClosePreference } from '../../utils/shortcutSavePreference'

interface UseShortcutSaveOptions {
  disabled?: boolean
  onClose: () => void
  onSave: (closeAfterSave: boolean) => Promise<boolean> | boolean
}

interface UseShortcutSaveResult {
  shortcutSaveDialog: JSX.Element | null
}

export function useShortcutSave({
  disabled = false,
  onClose,
  onSave,
}: UseShortcutSaveOptions): UseShortcutSaveResult {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const savingRef = useRef(false)
  const confirmOpenRef = useRef(false)
  const disabledRef = useRef(disabled)
  const onCloseRef = useRef(onClose)
  const onSaveRef = useRef(onSave)

  useEffect(() => { confirmOpenRef.current = confirmOpen }, [confirmOpen])
  useEffect(() => { disabledRef.current = disabled }, [disabled])
  useEffect(() => { onCloseRef.current = onClose }, [onClose])
  useEffect(() => { onSaveRef.current = onSave }, [onSave])

  const handleShortcutSave = useCallback(async (): Promise<void> => {
    if (savingRef.current || disabledRef.current || confirmOpenRef.current) return
    savingRef.current = true
    try {
      const preference = loadShortcutSaveClosePreference()
      const closeAfterSave = preference === 'close'
      const saved = await onSaveRef.current(closeAfterSave)
      if (!saved) return
      if (preference === 'ask') setConfirmOpen(true)
    } finally {
      savingRef.current = false
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || !(event.ctrlKey || event.metaKey) || event.altKey) return
      if (event.key.toLowerCase() !== 's') return
      event.preventDefault()
      void handleShortcutSave()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [handleShortcutSave])

  return {
    shortcutSaveDialog: confirmOpen
      ? <ShortcutSaveCloseDialog onChoice={closeAfterSave => {
          setConfirmOpen(false)
          if (closeAfterSave) onCloseRef.current()
        }} />
      : null,
  }
}
