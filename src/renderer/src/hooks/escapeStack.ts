// ESC 닫기 스택. 레이어 팝업이 겹쳐 열렸을 때 가장 마지막에 열린 것 하나만 닫아야 하므로,
// 각 팝업이 window 리스너를 따로 달지 않고 이 스택에 핸들러를 등록한다.
type CloseHandler = () => void

const stack: CloseHandler[] = []

// 등록 후 해제 함수를 돌려준다. 해제는 등록 순서와 무관하게 안전하다.
export function pushEscapeHandler(handler: CloseHandler): () => void {
  stack.push(handler)
  return () => {
    const index = stack.lastIndexOf(handler)
    if (index !== -1) stack.splice(index, 1)
  }
}

// 최상단 핸들러에게만 ESC를 넘긴다. 처리했으면 true.
export function runTopEscapeHandler(): boolean {
  const top = stack[stack.length - 1]
  if (!top) return false
  top()
  return true
}

export function escapeStackSize(): number {
  return stack.length
}
