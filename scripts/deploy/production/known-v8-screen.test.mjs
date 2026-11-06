import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFECT_ROUTES } from '../../../apps/web/scripts/v8-guard/layout-defects.mjs'
import { WIDTHS } from '../../../apps/web/scripts/v8-guard/browser-env.mjs'
import { checkKnownV8Screen, checkKnownV8Presentation } from './known-v8-screen.mjs'

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

function presentationRows() {
  return [1024, 1152, 1440].flatMap(width => Array.from({ length: 263 }, (_, index) => ({
    width, route: `/screen-${index}`, finalPath: `/screen-${index}`,
    errors: [], findings: index === 0 ? [finding] : [], missingDots: [],
  })))
}

test('画面監査の既存測定だけを受け入れる', () => {
  const rows = presentationRows()
  rows[1] = { width: 1024, route: '/screen-1', error: 'HTTP 404' }
  const result = checkKnownV8Presentation(rows, structuredClone(rows))
  assert.deepEqual(result, { routes: 789, knownFindings: 3, knownErrors: 1 })
})

test('presentation audit rejects extra output and incomplete coverage', () => {
  const baseline = presentationRows()
  const extraFinding = structuredClone(baseline)
  extraFinding[0].findings.push({ ...finding })
  assert.throws(() => checkKnownV8Presentation(extraFinding, baseline), /v8_presentation_new_finding/)
  const newError = structuredClone(baseline)
  newError[0].error = 'HTTP 500'
  assert.throws(() => checkKnownV8Presentation(newError, baseline), /v8_presentation_new_error/)
  const missingRoute = structuredClone(baseline)
  missingRoute.pop()
  assert.throws(() => checkKnownV8Presentation(missingRoute, baseline), /v8_presentation_routes_incomplete/)
  const missingDot = structuredClone(baseline)
  missingDot[0].missingDots.push('folder')
  assert.throws(() => checkKnownV8Presentation(missingDot, baseline), /v8_presentation_new_missing_dot/)
})
