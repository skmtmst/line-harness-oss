import test from 'node:test'
import assert from 'node:assert/strict'
import { assessToolbarFilterSpacing } from './toolbar-filter-spacing.mjs'

const group = (gap, left, top = 0) => [{ gap, controls: [
  { label: '種類', left: 0, right: 100, top: 0 },
  { label: '状態', left, right: left + 100, top },
] }]

test('共通の間隔、接触、別の段を分ける', () => {
  assert.deepEqual(assessToolbarFilterSpacing(group(8, 108)), [])
  assert.equal(assessToolbarFilterSpacing(group(8, 100)).length, 1)
  assert.equal(assessToolbarFilterSpacing(group(8, 104)).length, 1)
  assert.deepEqual(assessToolbarFilterSpacing(group(8, 0, 44)), [])
  assert.equal(assessToolbarFilterSpacing(group(NaN, 108)).length, 1)
})
