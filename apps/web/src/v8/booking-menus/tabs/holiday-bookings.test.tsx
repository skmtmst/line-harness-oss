// @vitest-environment happy-dom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
const list = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', () => ({ bookingApi: { listRequests: list } }))
import HolidayBookings from './holiday-bookings'
afterEach(() => { cleanup(); vi.clearAllMocks() })
it('選んだ日の有効な予約を全ページから数え、日付を指定した予約へつなぐ', async () => {
  list.mockResolvedValueOnce({ requests: [
    { status: 'requested', starts_at: '2026-10-25T15:00:00Z' },
    { status: 'cancelled', starts_at: '2026-10-26T01:00:00Z' },
  ], total: 3 }).mockResolvedValueOnce({ requests: [{ status: 'confirmed', starts_at: '2026-10-26T14:59:00Z' }], total: 3 })
  render(<HolidayBookings accountId="a" date="2026-10-26" />)
  await screen.findByText(/既存予約：2件/)
  expect(list.mock.calls[0]).toEqual(['a', 'all', { from: '2026-10-25T15:00:00.000Z', to: '2026-10-26T15:00:00.000Z', limit: 100, offset: 0 }])
  expect(list).toHaveBeenCalledTimes(2)
  expect(screen.getByRole('link', { name: 'この日の予約へ' }).getAttribute('href')).toBe('/booking/bookings?view=list&status=all&range=date&date=2026-10-26')
})
it('失敗した件数を0にせず、日付・アカウントを変えたあとの古い応答を使わない', async () => {
  let finish!: (value: unknown) => void
  list.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve })).mockRejectedValueOnce(new Error('down'))
  const { rerender } = render(<HolidayBookings accountId="a" date="2026-10-26" />)
  rerender(<HolidayBookings accountId="b" date="2026-10-27" />)
  await waitFor(() => expect(list).toHaveBeenCalledTimes(2))
  await act(async () => { finish({ requests: [{ status: 'confirmed', starts_at: '2026-10-26T00:00:00Z' }], total: 1 }) })
  expect(await screen.findByText(/読み込めていないため件数は分かりません/)).toBeTruthy()
  expect(screen.getByText('失敗：既存予約を読み込めませんでした')).toBeTruthy()
  expect(screen.queryByText(/既存予約：/)).toBeNull()
  expect(screen.getByRole('link', { name: 'この日の予約へ' }).getAttribute('href')).toContain('date=2026-10-27')
})
