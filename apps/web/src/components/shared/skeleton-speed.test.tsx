// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { DelayedSkeleton } from './skeleton'

afterEach(() => { cleanup(); vi.useRealTimers(); document.documentElement.style.removeProperty('--polish-loading-delay') })
it.each(['300ms', '.3s'])('本番のCSS時間 %s でも300ms以内の応答に骨組みを出さない', async value => {
  vi.useFakeTimers()
  document.documentElement.style.setProperty('--polish-loading-delay', value)
  const content = (loading: boolean) => <DelayedSkeleton loading={loading} skeleton={<span role="status">骨組み</span>}><span>読込完了</span></DelayedSkeleton>
  const { rerender } = render(content(true))
  await act(async () => { vi.advanceTimersByTime(250) })
  expect(screen.queryByRole('status')).toBeNull()
  rerender(content(false))
  expect(screen.getByText('読込完了')).toBeTruthy()
  await act(async () => { vi.advanceTimersByTime(500) })
  expect(screen.queryByRole('status')).toBeNull()
})
it('秒表記でも遅い応答では骨組みを出し、最低400msの表示を保つ', async () => {
  vi.useFakeTimers()
  document.documentElement.style.setProperty('--polish-loading-delay', '.3s')
  const content = (loading: boolean) => <DelayedSkeleton loading={loading} skeleton={<span role="status">骨組み</span>}><span>読込完了</span></DelayedSkeleton>
  const { rerender } = render(content(true))
  await act(async () => { vi.advanceTimersByTime(300) })
  expect(screen.getByRole('status')).toBeTruthy()
  rerender(content(false))
  await act(async () => { vi.advanceTimersByTime(399) })
  expect(screen.getByRole('status')).toBeTruthy()
  await act(async () => { vi.advanceTimersByTime(1) })
  expect(screen.queryByRole('status')).toBeNull()
  expect(screen.getByText('読込完了')).toBeTruthy()
})
