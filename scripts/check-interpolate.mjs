// 하이픈이 들어간 환경변수 키가 뺄셈으로 해석돼 NaN이 되던 회귀를 막는다.
// 실행: npm run check:interpolate
import { build } from 'esbuild'
import assert from 'node:assert/strict'

const { outputFiles } = await build({
  entryPoints: ['src/renderer/src/utils/interpolate.ts'],
  bundle: true, format: 'esm', write: false, logLevel: 'error',
})
const { resolveTemplate, parseTemplate } = await import(
  'data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64')
)

const env = { baseUrl: 'https://x', 'ocp-apim-subscription-key': 'SECRET', token: 'ey' }

assert.equal(resolveTemplate('{{ocp-apim-subscription-key}}', env), 'SECRET')
assert.equal(parseTemplate('{{ocp-apim-subscription-key}}', env)[0].resolved, 'SECRET')
// 값이 없으면 NaN이 아니라 "미해결"로 남아야 한다
assert.equal(parseTemplate('{{no-such-key}}', env)[0].resolved, null)
assert.equal(resolveTemplate('{{no-such-key}}', env), '{{no-such-key}}')
// 진짜 수식은 계속 동작
assert.equal(resolveTemplate('{{1+2}}', env), '3')

console.log('interpolate check OK')
