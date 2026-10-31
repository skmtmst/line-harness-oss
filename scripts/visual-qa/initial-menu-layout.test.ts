import { it as test } from 'vitest'
import assert from 'node:assert/strict'
import { initialMenuLayoutFailures } from './initial-menu-layout.mjs'

const readable = { width: 900, imageWidth: 460, imageReady: true, overflow: 0, beside: true, gap: 24 }
test('readable previews fit both the two-column and narrow stacked layouts', () => {
  assert.deepEqual(initialMenuLayoutFailures([readable, { ...readable, width: 700, beside: false }]), [])
})
test('small labels and an empty right side both fail the rendered layout check', () => {
  assert.deepEqual(initialMenuLayoutFailures([{ ...readable, imageWidth: 320, beside: false }]), [
    'initial menu labels are smaller than 12px',
    'initial menu explanation leaves unused space beside the image',
  ])
})
test('missing images and horizontal overflow remain failures', () => {
  assert.ok(initialMenuLayoutFailures([]).length)
  assert.equal(initialMenuLayoutFailures([{ ...readable, imageReady: false, overflow: 1 }]).length, 2)
})

test('a visible preview collapsed to zero is never ignored', () => {
  assert.ok(initialMenuLayoutFailures([{ ...readable, width: 0, imageWidth: 0 }]).includes('initial menu preview has collapsed'))
})
