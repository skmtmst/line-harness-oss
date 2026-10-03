// @vitest-environment happy-dom
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Tabs } from './tabs'

afterEach(() => {
  cleanup()
  document.documentElement.removeAttribute('data-theme')
})

const ITEMS = [
  { label: 'すべて', current: true },
  { label: '予約中' },
]

/*
 * ★V8 仕上げ（M10）：選ばれている下線が滑って移る。
 * v7 は今までどおり枠線の下線だけで、動く印は出さない。
 */
describe('V8 タブの下線', () => {
  it('v7は動く印を出さない', () => {
    const { container } = render(<Tabs items={ITEMS} />)
    expect(screen.getByRole('tablist').getAttribute('data-sliding')).toBeNull()
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull()
  })

  it('v8は今のタブの下に動く印を出す', () => {
    document.documentElement.dataset.theme = 'v8'
    const { container } = render(<Tabs items={ITEMS} />)
    expect(screen.getByRole('tablist').getAttribute('data-sliding')).toBe('true')
    expect(container.querySelector('[aria-hidden="true"]')).toBeTruthy()
  })
})
