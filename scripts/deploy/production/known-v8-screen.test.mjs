import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFECT_ROUTES } from '../../../apps/web/scripts/v8-guard/layout-defects.mjs'
import { WIDTHS } from '../../../apps/web/scripts/v8-guard/browser-env.mjs'
import { checkKnownV8Screen } from './known-v8-screen.mjs'

const finding = { kind: 'overlap', target: 'button.save', text: '保存', measure: { pixels: 12 } }
function fixture() {
  const rows = Object.fromEntries(WIDTHS.flatMap(width => [...new Set(Object.values(DEFECT_ROUTES))].map(route => [
    `${width} ${route}`,
    route === '/conversions' ? { error: '指定画面を開けませんでした' } : { failures: [], baseFindings: [] },
  ])))
  rows[`${WIDTHS[0]} /`].failures = [finding]
  rows[`${WIDTHS[0]} /`].baseFindings = [{ ...finding }]
  return rows
}

test('同じ画面・幅・測定値だけを受け入れる', () => {
  const result = checkKnownV8Screen(fixture())
  assert.equal(result.findings, 1)
  assert.equal(result.redirects, WIDTHS.length)
})
test('追加・件数増加・測定値変化を拒否する', () => {
  for (const newFinding of [
    { ...finding, target: 'button.delete' },
    { ...finding, measure: { pixels: 24 } },
    { ...finding },
  ]) {
    const rows = fixture()
    rows[`${WIDTHS[0]} /`].failures.push(newFinding)
    assert.throws(() => checkKnownV8Screen(rows), /v8_new_finding/)
  }
})
test('画面不足・比較元欠落・想定外の測定失敗を拒否する', () => {
  const missing = fixture(); delete missing[`${WIDTHS[0]} /`]
  assert.throws(() => checkKnownV8Screen(missing), /v8_routes_incomplete/)
  const noBase = fixture(); delete noBase[`${WIDTHS[0]} /`].baseFindings
  assert.throws(() => checkKnownV8Screen(noBase), /v8_comparison_missing/)
  const error = fixture(); error[`${WIDTHS[0]} /`] = { error: 'HTTP 500' }
  assert.throws(() => checkKnownV8Screen(error), /v8_measurement_error/)
})
