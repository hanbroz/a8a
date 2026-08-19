import { useEffect, useRef } from 'react'
import { pushEscapeHandler, runTopEscapeHandler } from './escapeStack'

let listening = false

function onWindowKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  // 한글 조합 중 ESC는 조합 취소용이다. 이때 팝업까지 닫으면 입력 중인 값이 날아간다.
  if (event.isComposing) return
  if (runTopEscapeHandler()) event.preventDefault()
}

/**
 * 레이어 팝업에 ESC 닫기를 붙인다. `enabled`가 true인 동안만 스택에 등록된다.
 *
 * onClose는 ref로 들고 있다. 인라인 함수를 넘겨도 매 렌더마다 재등록되지 않아야 하는데,
 * 재등록되면 아래에 깔린 팝업이 스택 최상단으로 올라가 엉뚱한 창이 닫힌다.
 */
export function useEscapeClose(onClose: () => void, enabled = true): void {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!enabled) return
    const remove = pushEscapeHandler(() => onCloseRef.current())
    if (!listening) {
      // ponytail: 리스너 1개를 앱 수명 동안 유지한다. 스택이 비면 아무 일도 하지 않으므로 떼어낼 이유가 없다.
      window.addEventListener('keydown', onWindowKeyDown)
      listening = true
    }
    return remove
  }, [enabled])
}
