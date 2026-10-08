// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import CopyTextButton from '../ui/copy-text-button'
afterEach(() => { cleanup(); vi.useRealTimers(); document.documentElement.removeAttribute('data-theme') })
it('F-1: 成功を1.6秒示し、対象が変われば結果を戻す', async () => {
  vi.useFakeTimers()
  document.documentElement.dataset.theme = 'v8'
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => {}) } })
  const view = render(<CopyTextButton value="a" aria-label="URLをコピー" />)
  await act(async () => fireEvent.click(screen.getByRole('button')))
  expect(screen.getByRole('button').textContent).toContain('コピーしました')
  act(() => vi.advanceTimersByTime(1599))
  expect(screen.getByRole('button').textContent).toContain('コピーしました')
  act(() => vi.advanceTimersByTime(1))
  expect(screen.getByRole('button').textContent).toBe('コピー')
  await act(async () => fireEvent.click(screen.getByRole('button')))
  view.rerender(<CopyTextButton value="b" aria-label="URLをコピー" />)
  expect(screen.getByRole('button').textContent).toBe('コピー')
})
