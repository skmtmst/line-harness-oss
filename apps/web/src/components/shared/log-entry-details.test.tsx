// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import LogEntryDetails, { LogEntryCopy } from './log-entry-details'

const entry = { occurredAt: '2026-10-22T01:00:00Z', target: '本店', status: '失敗', reason: '接続先が応答しませんでした。' }
afterEach(() => { cleanup(); vi.useRealTimers() })

it('時刻・相手・結果・理由だけを表示してコピーし、成功の印を1.6秒保つ', async () => {
  vi.useFakeTimers()
  const writeText = vi.fn(async (_text: string) => {})
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  render(<LogEntryDetails entry={{ ...entry, payload: '顧客の本文', secret: 'secret-value' } as typeof entry} onClose={() => {}} />)
  expect(screen.getByRole('dialog').textContent).toContain(entry.reason)
  expect(screen.getByRole('dialog').textContent).not.toContain('顧客の本文')
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'この記録をコピー' })))
  expect(writeText.mock.calls[0][0]).toContain('相手：本店\n結果：失敗\n理由：接続先が応答しませんでした。')
  expect(writeText.mock.calls[0][0]).not.toMatch(/顧客の本文|secret-value/)
  act(() => vi.advanceTimersByTime(1599))
  expect(screen.getByText('コピーしました')).toBeTruthy()
  act(() => vi.advanceTimersByTime(1))
  expect(screen.queryByText('コピーしました')).toBeNull()
})

it('コピー拒否で成功を出さず、同じ安全な記録を手で選べる', async () => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => { throw new Error('denied') }) } })
  render(<LogEntryCopy entry={entry} />)
  await act(async () => fireEvent.click(screen.getByRole('button')))
  expect(screen.getByRole('alert').textContent).toContain('コピーできませんでした')
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toContain('相手：本店')
})
