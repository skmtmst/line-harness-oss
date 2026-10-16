// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import LedgerMonthNavigation, { monthKey } from './month-navigation'

afterEach(cleanup)

it('壊れた日付を復元しても今月から月を選べる', () => {
  const change = vi.fn()
  render(<LedgerMonthNavigation anchor="2026-99-01" onChange={change} shareUrl="" historyUrl="" />)
  const now = new Date(Date.now() + 9 * 3600_000)
  expect(screen.getByText(`${now.getUTCFullYear()}年${now.getUTCMonth() + 1}月`)).toBeTruthy()
  expect(monthKey(0, '2026-99-01')).toBe(now.toISOString().slice(0, 7))
  fireEvent.click(screen.getByRole('button', { name: '次の月' }))
  expect(change).toHaveBeenCalledWith(`${monthKey(1)}-01`)
})

it('月末と年末から進んでも、月の先頭で前後へ移る', () => {
  const change = vi.fn()
  const { rerender } = render(<LedgerMonthNavigation anchor="2026-12-31" onChange={change} shareUrl="" historyUrl="" />)
  fireEvent.click(screen.getByRole('button', { name: '次の月' }))
  expect(change).toHaveBeenLastCalledWith('2027-01-01')
  rerender(<LedgerMonthNavigation anchor="2028-03-31" onChange={change} shareUrl="" historyUrl="" />)
  fireEvent.click(screen.getByRole('button', { name: '前の月' }))
  expect(change).toHaveBeenLastCalledWith('2028-02-01')
})

it('予約と履歴のコピーは別のURLを使う', async () => {
  const writeText = vi.fn(async () => {})
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  render(<LedgerMonthNavigation anchor="2026-10-01" onChange={vi.fn()} shareUrl="https://example.test/book" historyUrl="https://example.test/history" />)
  fireEvent.click(screen.getByRole('button', { name: '友だち予約URLをコピーする' }))
  expect(writeText).toHaveBeenLastCalledWith('https://example.test/book')
  fireEvent.click(screen.getByRole('button', { name: '予約履歴URLをコピーする' }))
  expect(writeText).toHaveBeenLastCalledWith('https://example.test/history')
})
