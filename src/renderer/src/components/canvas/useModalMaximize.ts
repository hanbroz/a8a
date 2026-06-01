import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'

export interface ModalRect {
  x: number
  y: number
  w: number
  h: number
}

function getMaximizedRect(): ModalRect {
  const margin = 12
  return {
    x: margin,
    y: margin,
    w: Math.max(320, window.innerWidth - margin * 2),
    h: Math.max(240, window.innerHeight - margin * 2),
  }
}

function clampRect(rect: ModalRect): ModalRect {
  const w = Math.min(rect.w, Math.max(320, window.innerWidth - 24))
  const h = Math.min(rect.h, Math.max(240, window.innerHeight - 24))
  return {
    x: Math.max(0, Math.min(window.innerWidth - w, rect.x)),
    y: Math.max(0, Math.min(window.innerHeight - h, rect.y)),
    w,
    h,
  }
}

export function useModalMaximize(
  rect: ModalRect,
  setRect: Dispatch<SetStateAction<ModalRect>>,
): {
  isMaximized: boolean
  toggleMaximized: () => void
} {
  const restoreRectRef = useRef<ModalRect | null>(null)
  const [isMaximized, setIsMaximized] = useState(false)

  const toggleMaximized = useCallback(() => {
    if (isMaximized) {
      setRect(clampRect(restoreRectRef.current ?? rect))
      restoreRectRef.current = null
      setIsMaximized(false)
      return
    }

    restoreRectRef.current = rect
    setRect(getMaximizedRect())
    setIsMaximized(true)
  }, [isMaximized, rect, setRect])

  useEffect(() => {
    if (!isMaximized) return

    const onResize = (): void => setRect(getMaximizedRect())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [isMaximized, setRect])

  return { isMaximized, toggleMaximized }
}
