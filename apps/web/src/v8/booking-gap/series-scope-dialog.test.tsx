// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const impact = vi.fn(); const change = vi.fn(); const cancel = vi.fn()
vi.mock('@/lib/api-gap2', () => ({ bookingSeriesApi: { impact: (...a: unknown[]) => impact(...a), change: (...a: unknown[]) => change(...a), cancel: (...a: unknown[]) => cancel(...a) } }))
vi.mock('@/components/shared/toast', () => ({ notifySaved: vi.fn(), notifyToast: vi.fn() }))
const { default: SeriesScopeDialog } = await import('./series-scope-dialog')

const items = [
  { bookingId: 'b4', startsAt: '2026-12-11T05:00:00.000Z', after: '2026-12-11T07:00:00.000Z', blocked: false, fee: { amount: 4200, percent: 50, reason: '24 時間前を過ぎた' } },
  { bookingId: 'b5', startsAt: '2026-12-18T05:00:00.000Z', after: '2026-12-18T07:00:00.000Z', blocked: false, fee: null },
  { bookingId: 'b6', startsAt: '2027-01-01T05:00:00.000Z', after: null, blocked: true, fee: null },
]
const target = { seriesId: 's1', customerName: '山田 花子', ruleText: '毎週金曜 14:00', menuName: 'トリミング（小型犬）', index: 4, bookingId: 'b4', startsAt: '2026-12-11T05:00:00.000Z', version: 3 }

beforeEach(() => { impact.mockResolvedValue({ success: true, data: { items } }); change.mockResolvedValue({ success: true, data: { changed: 2, blocked: 1, version: 4 } }); cancel.mockResolvedValue({ success: true, data: { cancelled: 3 } }) })
afterEach(() => { cleanup(); vi.clearAllMocks() })

test('変える：埋まっている回は前のままにし、変わる件数だけを押す文字にする（黙って一部だけにしない）', async () => {
  const onDone = vi.fn()
  render(<SeriesScopeDialog open mode="change" accountId="a1" target={target} newStartsAt="2026-12-11T16:00:00+09:00" onClose={() => {}} onDone={onDone} />)
  expect(await screen.findByText(/埋まっています・14:00 のまま/)).toBeTruthy()
  expect(screen.getByText('変わる日（3 件のうち 2 件）')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '2 件を変える' }))
  await waitFor(() => expect(change).toHaveBeenCalledTimes(1))
  expect(change.mock.calls[0][2]).toMatchObject({ scope: 'following', fromBookingId: 'b4', expectedVersion: 3, notify: true })
  await waitFor(() => expect(onDone).toHaveBeenCalledWith({ count: 2 }))
})

test('取り消す：この回だけにすると 1 件。キャンセル料は期限後の回だけに出る。LINE で知らせるは外せる', async () => {
  render(<SeriesScopeDialog open mode="cancel" accountId="a1" target={target} onClose={() => {}} onDone={() => {}} />)
  expect(await screen.findByText(/¥4,200（50%・24 時間前を過ぎた）/)).toBeTruthy()
  expect(screen.getAllByText('かかりません').length).toBe(2)
  fireEvent.click(screen.getByRole('radio', { name: /この回だけ/ }))
  fireEvent.click(await screen.findByRole('checkbox', { name: /LINE で知らせる/ }))
  fireEvent.click(await screen.findByRole('button', { name: '1 件を取り消す' }))
  await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1))
  expect(cancel.mock.calls[0][2]).toMatchObject({ scope: 'this', fromBookingId: 'b4', notify: false })
})

test('影響する日を読めないときは実行できない', async () => {
  impact.mockRejectedValue(new Error('503'))
  render(<SeriesScopeDialog open mode="cancel" accountId="a1" target={target} onClose={() => {}} onDone={() => {}} />)
  expect(await screen.findByText(/影響する日を読み込めませんでした/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: /件を取り消す/ })?.hasAttribute('disabled') ?? true).toBe(true)
})
