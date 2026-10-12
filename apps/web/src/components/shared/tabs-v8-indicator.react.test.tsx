// @vitest-environment happy-dom
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Tabs } from './tabs'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  document.documentElement.removeAttribute('data-theme')
})

const ITEMS = [
  { label: 'すべて', current: true },
  { label: '予約中' },
]

/*
 * ★V8 仕上げ（M10）：選ばれている下線が滑って移る。
 * 古いDOMの値が残っていても同じ下線を使う。
 */
describe('V8 タブの下線', () => {
  it('古いDOMの値で現役の下線を止めない', () => {
    document.documentElement.dataset.theme = 'v7'
    const { container } = render(<Tabs items={ITEMS} />)
    expect(screen.getByRole('tablist').getAttribute('data-sliding')).toBe('true')
    expect(container.querySelector('[aria-hidden="true"]')).toBeTruthy()
  })

  it('v8は今のタブの下に動く印を出す', () => {
    document.documentElement.dataset.theme = 'v8'
    const { container } = render(<Tabs items={ITEMS} />)
    expect(screen.getByRole('tablist').getAttribute('data-sliding')).toBe('true')
    expect(container.querySelector('[aria-hidden="true"]')).toBeTruthy()
  })

  it('確認待ちの件数が変わったら、下線も新しいタブの幅に合わせる', () => {
    document.documentElement.dataset.theme = 'v8'
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const width = this.getAttribute('role') === 'tab' ? (this.textContent?.endsWith('100') ? 160 : 140) : 300
      return { left: 0, top: 0, right: width, bottom: 20, width, height: 20, x: 0, y: 0, toJSON: () => ({}) }
    })
    const { container, rerender } = render(<Tabs items={[{ label: '紙のカードの移行', current: true, count: 9, countTone: 'warning' }]} />)
    expect((container.querySelector('[aria-hidden="true"]') as HTMLElement).style.width).toBe('140px')
    rerender(<Tabs items={[{ label: '紙のカードの移行', current: true, count: 100, countTone: 'warning' }]} />)
    expect((container.querySelector('[aria-hidden="true"]') as HTMLElement).style.width).toBe('160px')
  })
})
