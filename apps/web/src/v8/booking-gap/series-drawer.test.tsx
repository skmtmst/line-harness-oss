// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { SeriesOccurrence } from '@/lib/api-gap2'

const preview = vi.fn()
const create = vi.fn()
vi.mock('@/lib/api-gap2', () => ({ bookingSeriesApi: { preview: (...a: unknown[]) => preview(...a), create: (...a: unknown[]) => create(...a) } }))
vi.mock('@/components/shared/toast', () => ({ notifySaved: vi.fn(), notifyToast: vi.fn() }))
const { default: SeriesBookingDrawer } = await import('./series-drawer')

const day = (n: number) => `2026-11-${String(n).padStart(2, '0')}T05:00:00.000Z`
const list: SeriesOccurrence[] = [
  { index: 0, startsAt: day(20), available: true, alternatives: [] },
  { index: 1, startsAt: '2026-12-04T05:00:00.000Z', available: false, reason: '佐々木が休み', alternatives: ['2026-12-04T07:00:00.000Z'] },
  { index: 2, startsAt: '2026-12-25T05:00:00.000Z', available: false, reason: '14:00 に別の予約', alternatives: [] },
]
const summary = { customerName: '山田 花子', friendId: 'f1', menuId: 'bm-1', menuName: 'トリミング（小型犬）', durationMin: 105, staffId: 'bs-1', staffName: '佐々木', startsAt: day(20), endsAt: '2026-11-20T06:45:00.000Z' }

beforeEach(() => { preview.mockResolvedValue({ success: true, data: { occurrences: list } }); create.mockResolvedValue({ success: true, data: { seriesId: 's1', created: 2, skipped: 1 } }) })
afterEach(() => { cleanup(); vi.clearAllMocks() })
const open = (onCreated = vi.fn()) => render(<SeriesBookingDrawer open accountId="a1" summary={summary} onClose={() => {}} onCreated={onCreated} />)

test('取れない回を表で見せ、飛ばす回を数えない（3 回のうち 2 件を入れる）', async () => {
  open()
  expect(await screen.findByText('取れない回 2 件')).toBeTruthy()
  expect(screen.getByText('→ 16:00 にする')).toBeTruthy()
  expect(screen.getByText('この回は作りません')).toBeTruthy()
  expect(screen.getByRole('button', { name: '2 件を入れる' })).toBeTruthy()
})

test('別の時間を飛ばすに替えると件数が減り、保存は回ごとの選択を送る（全部か無しは口が守る）', async () => {
  const onCreated = vi.fn()
  open(onCreated)
  await screen.findByText('取れない回 2 件')
  fireEvent.click(screen.getAllByText('飛ばす')[0])
  const save = await screen.findByRole('button', { name: '1 件を入れる' })
  fireEvent.click(save)
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
  const body = create.mock.calls[0][1]
  expect(body.choices.map((c: { action: string }) => c.action)).toEqual(['keep', 'skip', 'skip'])
  expect(typeof create.mock.calls[0][2]).toBe('string') // Idempotency-Key（二重押しは同じ組 1 つ）
  await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ seriesId: 's1', created: 2 }))
})

test('保存の間に埋まった回があれば何も作らず、表を出し直す', async () => {
  create.mockResolvedValue({ success: false, conflicts: [1] })
  const onCreated = vi.fn()
  open(onCreated)
  fireEvent.click(await screen.findByRole('button', { name: '2 件を入れる' }))
  expect(await screen.findByText('その間に埋まった回があります。表を確かめ直してください。')).toBeTruthy()
  expect(onCreated).not.toHaveBeenCalled()
  await waitFor(() => expect(preview.mock.calls.length).toBeGreaterThan(1))
})

test('確かめられないときは保存を押せない（確かめないで保存しない）', async () => {
  preview.mockRejectedValue(new Error('503'))
  open()
  expect(await screen.findByText(/空きを確かめられませんでした/)).toBeTruthy()
  expect((screen.getByRole('button', { name: /件を入れる/ }) as HTMLButtonElement).disabled).toBe(true)
})
