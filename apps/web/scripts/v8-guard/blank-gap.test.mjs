import test from 'node:test'
import assert from 'node:assert/strict'
import { whitespaceReport } from './blank-gap.mjs'

test('whitespace observations are diagnostic data regardless of their amount', () => {
  const result = { findings: [10, 1000].map(excess => ({ kind: 'vertical', excess })), bands: [{ cardH: [600], contentH: [20] }] }
  assert.deepEqual(whitespaceReport(result), { mode: 'diagnostic', ...result })
})
test('declared and excluded regions remain in the diagnostic report', () => {
  const result = { findings: [{ excluded: 'preview', excess: 400 }], bands: [], declarations: [{ reason: '比較用' }], invalidDeclarations: [{ selector: 'main' }] }
  assert.deepEqual(whitespaceReport(result), { mode: 'diagnostic', ...result })
})
