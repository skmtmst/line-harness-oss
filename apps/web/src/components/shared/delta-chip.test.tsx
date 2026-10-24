// @vitest-environment happy-dom
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import DeltaChip, { isZeroDelta } from './delta-chip'

afterEach(cleanup)

it('差が 0 の札は出さない（+0・−0・0.0%）', () => {
  for (const text of ['+0', '−0', '0', '0.0%', '±0', '0 pt']) expect(isZeroDelta(text)).toBe(true)
  for (const text of ['+1', '−1', '0.1%', '要確認']) expect(isZeroDelta(text)).toBe(false)
})

it('0 の差は数の横に描かない。0 でない差は今までどおり描く', () => {
  const zero = render(<DeltaChip tone="up">+0</DeltaChip>)
  expect(zero.container.textContent).toBe('')
  cleanup()
  const plus = render(<DeltaChip tone="up">+3</DeltaChip>)
  expect(plus.container.textContent).toContain('+3')
})

it('要確認の札は 0 の文字でも消さない', () => {
  const { container } = render(<DeltaChip tone="attention">0</DeltaChip>)
  expect(container.textContent).toContain('0')
})
