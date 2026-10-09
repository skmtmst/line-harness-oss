// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import ToastHost, { clearToastsForTest, notifyToast } from './toast'
afterEach(() => { cleanup(); clearToastsForTest(); vi.restoreAllMocks(); document.documentElement.removeAttribute('data-theme') })
it('F-3: 通知が消えたら残る通知の位置を200msで詰める', async () => {
  document.documentElement.dataset.theme = 'v8'
  const animate = vi.fn(() => ({ cancel: vi.fn() }))
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
    const siblings = Array.from(this.parentElement?.children ?? [])
    return { top: siblings.indexOf(this) * 40, height: 32, width: 380, bottom: 32, left: 0, right: 380, x: 0, y: 0, toJSON() {} }
  })
  render(<ToastHost />)
  await act(async () => { notifyToast('最初', { duration: 0 }); notifyToast('次', { duration: 0 }) })
  fireEvent.click(screen.getAllByRole('button', { name: '知らせを閉じる' })[0])
  await act(async () => new Promise(resolve => setTimeout(resolve, 180)))
  expect(animate).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ duration: 200 }))
  expect(screen.getByText('次')).toBeTruthy()
})
