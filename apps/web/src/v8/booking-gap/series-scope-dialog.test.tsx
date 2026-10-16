// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const get = vi.fn(); const change = vi.fn(); const cancel = vi.fn()
vi.mock('@/lib/api-gap2', () => ({ bookingSeriesApi: { get: (...a: unknown[]) => get(...a), change: (...a: unknown[]) => change(...a), cancel: (...a: unknown[]) => cancel(...a) } }))
const impact = vi.fn()
vi.mock('@/lib/api-gap2-pending', () => ({ seriesImpactApi: { impact: (...a: unknown[]) => impact(...a) } }))
const notifySaved = vi.fn()
vi.mock('@/components/shared/toast', () => ({ notifySaved: (...a: unknown[]) => notifySaved(...a), notifyToast: vi.fn() }))
const { default: SeriesScopeDialog } = await import('./series-scope-dialog')

const b = (i: number, startsAt: string, status = 'confirmed') => ({ id: `b${i}`, series_index: i, starts_at: startsAt, status })
const bookings = [b(2, '2026-12-04T05:00:00.000Z'), b(3, '2026-12-11T05:00:00.000Z'), b(4, '2026-12-18T05:00:00.000Z'), b(5, '2027-01-01T05:00:00.000Z', 'cancelled'), b(6, '2027-01-08T05:00:00.000Z')]
const target = { seriesId: 's1', customerName: '山田 花子', ruleText: '毎週金曜 14:00', menuName: 'トリミング（小型犬）', index: 4, bookingId: 'b3', startsAt: '2026-12-11T05:00:00.000Z' }

beforeEach(() => {
  impact.mockRejectedValue(new Error('404'))
  get.mockResolvedValue({ success: true, data: { series: { id: 's1', version: 3 }, bookings } })
  change.mockResolvedValue({ success: true, data: { changed: ['b3', 'b4'], conflicts: ['b6'], version: 4 } })
  cancel.mockResolvedValue({ success: true, data: { cancelled: ['b3', 'b4', 'b6'], fees: [{ bookingId: 'b3', feeNow: 4200 }], version: 4 } })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

test('対象は選んだ回から後の有効な回だけ（取消済みは数えない）。版は組の版を添えて送る', async () => {
  const onDone = vi.fn()
  render(<SeriesScopeDialog open mode="change" accountId="a1" target={target} newStartsAt="2026-12-11T16:00:00+09:00" onClose={() => {}} onDone={onDone} />)
  expect(await screen.findByText('変わる日（3 件）')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '3 件を変える' }))
  await waitFor(() => expect(change).toHaveBeenCalledTimes(1))
  expect(change.mock.calls[0][2]).toMatchObject({ scope: 'following', fromBookingId: 'b3', expectedVersion: 3, change: { startsAt: '2026-12-11T16:00:00+09:00' } })
  /* 変えられなかった回（口の conflicts）は黙らず知らせる。 */
  await waitFor(() => expect(notifySaved.mock.calls[0][0]).toContain('1 件は埋まっていて前のまま'))
  expect(onDone).toHaveBeenCalledWith({ count: 2 })
})

test('取り消す：この回だけにすると 1 件。キャンセル料は口の返事の見込みを知らせに出す', async () => {
  render(<SeriesScopeDialog open mode="cancel" accountId="a1" target={target} onClose={() => {}} onDone={() => {}} />)
  fireEvent.click(await screen.findByRole('radio', { name: /この回だけ/ }))
  fireEvent.click(await screen.findByRole('button', { name: '1 件を取り消す' }))
  await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1))
  expect(cancel.mock.calls[0][2]).toMatchObject({ scope: 'this', fromBookingId: 'b3', expectedVersion: 3 })
  await waitFor(() => expect(notifySaved.mock.calls[0][0]).toContain('¥4,200'))
})

test('対象の日を読めないときは実行できない', async () => {
  get.mockRejectedValue(new Error('503'))
  render(<SeriesScopeDialog open mode="cancel" accountId="a1" target={target} onClose={() => {}} onDone={() => {}} />)
  expect(await screen.findByText(/対象の日を読み込めませんでした/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: /件を取り消す/ })?.hasAttribute('disabled') ?? true).toBe(true)
})

test('前もっての見込みの口があるとき：埋まっている回は前のままにして数えず、キャンセル料を表に出す。口が無い間は準備中', async () => {
  impact.mockResolvedValue({ success: true, data: { items: [
    { bookingId: 'b3', startsAt: bookings[1].starts_at, blocked: false, fee: { amount: 4200, percent: 50, reason: '24 時間前を過ぎた' } },
    { bookingId: 'b6', startsAt: bookings[4].starts_at, blocked: true, fee: null },
  ] } })
  render(<SeriesScopeDialog open mode="change" accountId="a1" target={target} newStartsAt="2026-12-11T16:00:00+09:00" onClose={() => {}} onDone={() => {}} />)
  expect(await screen.findByText(/埋まっています・14:00 のまま/)).toBeTruthy()
  expect(screen.getByRole('button', { name: '2 件を変える' })).toBeTruthy()
  cleanup()
  impact.mockRejectedValue(new Error('404'))
  render(<SeriesScopeDialog open mode="cancel" accountId="a1" target={target} onClose={() => {}} onDone={() => {}} />)
  fireEvent.click((await screen.findAllByRole('button', { name: '見込みを見る' }))[0])
  expect(await screen.findByText('現在準備中です')).toBeTruthy()
})
