// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import TagOverflow from './tag-overflow'
import TagPill from './tag-pill'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('同じ寸法通知をまとめて測り、幅・タグ変更後の全件と+Nを保つ', async () => {
  let available = 220
  const observers: ResizeObserverCallback[] = []
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { observers.push(callback) }
    observe() {} disconnect() {}
  })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => available)
  const measured = vi.fn()
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.parentElement?.getAttribute('aria-hidden') === 'true' && this.tagName === 'SPAN') measured()
    return { width: this.tagName === 'BUTTON' ? 40 : 80, height: 20, top: 0, bottom: 20 } as DOMRect
  })
  const { container, rerender } = render(<TagOverflow><TagPill name="VIP" /><TagPill name="会員" /></TagOverflow>)
  await act(async () => { await Promise.resolve() })
  expect(screen.queryByRole('button', { name: /すべてのタグ/ })).toBeNull()
  measured.mockClear()
  available = 100
  await act(async () => {
    for (let i = 0; i < 4; i++) observers[0]([], {} as ResizeObserver)
    await Promise.resolve()
  })
  expect(measured).toHaveBeenCalledTimes(2)
  expect(screen.getByRole('button', { name: 'すべてのタグ（ほか2件）' }).textContent).toBe('+2')
  expect(container.querySelector('[data-tag-overflow]')?.textContent).toContain('VIP')
  available = 300
  rerender(<TagOverflow><TagPill name="VIP" /><TagPill name="会員" /><TagPill name="常連" /></TagOverflow>)
  await act(async () => { await Promise.resolve() })
  expect(screen.queryByRole('button', { name: /すべてのタグ/ })).toBeNull()
  expect([...container.querySelector('[data-tag-overflow]')!.children].filter(el => el.getAttribute('aria-hidden') !== 'true').map(el => el.textContent)).toEqual(['VIP', '会員', '常連'])
})
