// 레이어 팝업이 겹쳤을 때 ESC가 최상단 하나만 닫는지 확인한다.
// 실행: npm run check:escape-stack
import { build } from 'esbuild'
import assert from 'node:assert/strict'

const { outputFiles } = await build({
  entryPoints: ['src/renderer/src/hooks/escapeStack.ts'],
  bundle: true, format: 'esm', write: false, logLevel: 'error',
})
const { pushEscapeHandler, runTopEscapeHandler, escapeStackSize } = await import(
  'data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64')
)

// 아무것도 열려 있지 않으면 ESC는 아무 일도 하지 않는다(앱 단축키를 가로채면 안 된다).
assert.equal(runTopEscapeHandler(), false)

const closed = []
const removeOuter = pushEscapeHandler(() => closed.push('outer'))
const removeInner = pushEscapeHandler(() => closed.push('inner'))

// 겹쳐 열렸으면 안쪽(마지막에 열린 것)만 닫힌다.
assert.equal(runTopEscapeHandler(), true)
assert.deepEqual(closed, ['inner'])

removeInner()
assert.equal(escapeStackSize(), 1)
assert.equal(runTopEscapeHandler(), true)
assert.deepEqual(closed, ['inner', 'outer'])

// 중복 해제는 남아 있는 다른 팝업을 건드리지 않는다.
removeInner()
removeOuter()
assert.equal(escapeStackSize(), 0)
assert.equal(runTopEscapeHandler(), false)

console.log('escape stack check OK')
