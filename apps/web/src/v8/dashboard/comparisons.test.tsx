// @vitest-environment happy-dom
import React from 'react'
import { cleanup, render, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DashboardComparison, DashboardComparisons } from '@line-crm/shared'

const fx = vi.hoisted(() => ({ comparisons: vi.fn(), origins: vi.fn() }))
vi.mock('@/lib/api', async original => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, dashboard: { ...actual.api.dashboard, comparisons: fx.comparisons, deliveryFailureOrigins: fx.origins } } }
})
import { asOfLine, comparisonOf, useDashboardComparisons } from './comparisons'
import { ConnectionStatus, DeliveryFailures, friendCapacityMeter } from './sections'

const item = (current: number, previous: number, better: DashboardComparison['better'] = 'high'): DashboardComparison => ({
  current, previous, better, basis: 'same_weekday_last_week',
  asOf: '2026-10-25T17:51:00+09:00', previousFrom: '2026-10-18T00:00:00+09:00', previousTo: '2026-10-19T00:00:00+09:00',
})
const payload = (todayBookings: DashboardComparison | null): DashboardComparisons => ({
  generatedAt: '2026-10-25T17:51:00+09:00',
  comparisons: { todayBookings, activeFriends: null, deliveryFailures: null, monthlySent: null, monthlyBroadcasts: null },
  skipped: todayBookings ? {} : { todayBookings: 'no_previous_record' },
})

beforeEach(() => { fx.comparisons.mockReset() })
afterEach(cleanup)

describe('比べる値', () => {
  it('前の記録が無い数（null）は比べない。0 として扱わない', () => {
    expect(comparisonOf(payload(null), 'todayBookings')).toBeNull()
    expect(comparisonOf(null, 'todayBookings')).toBeNull()
    expect(comparisonOf(payload(item(12, 10)), 'todayBookings')).toMatchObject({ current: 12, previous: 10 })
    expect(comparisonOf(payload({ ...item(12, 0), previous: Number.NaN }), 'todayBookings')).toBeNull()
  })

  it('概要が読めるまで口を叩かず、読めたら1回読む。失敗・古い口は札なし', async () => {
    fx.comparisons.mockResolvedValue({ success: true, data: payload(item(12, 10)) })
    const view = renderHook(({ start }) => useDashboardComparisons('A', start), { initialProps: { start: false } })
    expect(fx.comparisons).not.toHaveBeenCalled()
    view.rerender({ start: true })
    await waitFor(() => expect(view.result.current?.comparisons.todayBookings?.current).toBe(12))
    expect(fx.comparisons).toHaveBeenCalledWith('A')
    view.unmount()

    fx.comparisons.mockRejectedValue(new Error('404'))
    const failed = renderHook(() => useDashboardComparisons('A', true))
    await waitFor(() => expect(fx.comparisons).toHaveBeenCalledTimes(2))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(failed.result.current).toBeNull()
    failed.unmount()

    fx.comparisons.mockResolvedValue({ success: true, data: { generatedAt: 'x' } })
    const legacy = renderHook(() => useDashboardComparisons('A', true))
    await waitFor(() => expect(fx.comparisons).toHaveBeenCalledTimes(3))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(legacy.result.current).toBeNull()
  })

  it('アカウントを替えたら前のアカウントの比べる値を出さない', async () => {
    fx.comparisons.mockResolvedValueOnce({ success: true, data: payload(item(12, 10)) })
    let resolveB!: (value: unknown) => void
    fx.comparisons.mockReturnValueOnce(new Promise(yes => { resolveB = yes }))
    const view = renderHook(({ account }) => useDashboardComparisons(account, true), { initialProps: { account: 'A' } })
    await waitFor(() => expect(view.result.current).not.toBeNull())
    view.rerender({ account: 'B' })
    expect(view.result.current).toBeNull()
    resolveB({ success: true, data: payload(item(3, 1)) })
    await waitFor(() => expect(view.result.current?.comparisons.todayBookings?.current).toBe(3))
  })
})

describe('いつ時点か', () => {
  it('時刻は口の集計時刻を日本時間で出す', () => {
    expect(asOfLine({ generatedAt: '2026-10-25T08:51:00Z', asOf: '2026-10-25T08:40:00Z', freshness: 'fresh' }, true)).toBe('10月25日 17:51 時点・先週の同じ曜日と比べています')
    expect(asOfLine({ generatedAt: '2026-10-25T08:51:00Z', freshness: 'fresh' }, false)).toBe('10月25日 17:51 時点')
  })

  it('数のもとが古い時は一番古い時刻（D1 の形は日本時間）と「更新が遅れています」', () => {
    expect(asOfLine({ generatedAt: '2026-10-25T08:51:00Z', asOf: '2026-10-25 16:05:00', freshness: 'stale' }, true)).toBe('10月25日 16:05 時点（更新が遅れています）・先週の同じ曜日と比べています')
    expect(asOfLine({ generatedAt: '2026-10-25T08:51:00Z', asOf: null, freshness: 'stale' }, false)).toBe('10月25日 17:51 時点（更新が遅れています）')
  })

  it('概要が無い・時刻が読めない時は行を出さない', () => {
    expect(asOfLine(null, true)).toBeNull()
    expect(asOfLine({ generatedAt: 'not-a-time' }, true)).toBeNull()
  })
})

describe('友だちの上限のメーター', () => {
  const account = (friendCapacity: number | null, capacityWarnAt: number | null, friendCount = 146) => ({
    id: 'A', channelId: 'c', name: '店', isActive: true, country: null, role: null, displayOrder: 0,
    friendCapacity, capacityWarnAt, stats: { friendCount, activeScenarios: 0, messagesThisMonth: 0, staffCount: 1 },
  })

  it('上限が入っていないアカウントには出さない', () => {
    expect(friendCapacityMeter(account(null, null))).toBeNull()
    expect(friendCapacityMeter({ ...account(150, null), stats: undefined })).toBeNull()
    const { container } = render(<ConnectionStatus account={account(null, null)} canCheck={false} onChecked={() => {}} risk="normal" activeFriends={140} />)
    expect(container.textContent).not.toContain('友だちの上限')
    expect(container.querySelector('[role="progressbar"]')).toBeNull()
  })

  it('146 / 150 人で棒は 97%、警告の人数以上で注意の色', () => {
    expect(friendCapacityMeter(account(150, 140))).toMatchObject({ count: 146, capacity: 150, warn: true })
    expect(Math.round(friendCapacityMeter(account(150, 140))!.rate)).toBe(97)
    expect(friendCapacityMeter(account(150, 147))?.warn).toBe(false)
    expect(friendCapacityMeter(account(150, 146))?.warn).toBe(true)
    expect(friendCapacityMeter(account(150, null, 150))?.warn).toBe(true)
    expect(friendCapacityMeter(account(150, null))?.warn).toBe(false)
    const { container } = render(<ConnectionStatus account={account(150, 140)} canCheck={false} onChecked={() => {}} risk="normal" activeFriends={140} />)
    expect(container.textContent).toContain('146 / 150 人')
    const bar = container.querySelector<HTMLElement>('[role="progressbar"]')!
    expect(Math.round(Number(bar.getAttribute('aria-valuenow')))).toBe(97)
    expect(bar.dataset.tone).toBe('danger')
  })

  it('有効友だちの差の札は比べる値がある時だけ', () => {
    const none = render(<ConnectionStatus account={account(null, null)} canCheck={false} onChecked={() => {}} risk="normal" activeFriends={140} activeFriendsCompare={null} />)
    expect(none.container.querySelector('[data-kpi-delta]')).toBeNull()
    cleanup()
    const down = render(<ConnectionStatus account={account(null, null)} canCheck={false} onChecked={() => {}} risk="normal" activeFriends={140} activeFriendsCompare={item(140, 146)} />)
    expect(down.container.querySelector<HTMLElement>('[data-kpi-delta]')?.dataset.kpiDelta).toBe('bad')
  })
})

describe('配信の失敗の差の札', () => {
  it('減ったら緑。欄の数と比べる値の今の数が違う時は出さない', async () => {
    const origins = (total: number) => fx.origins.mockResolvedValue({ success: true, data: { total, asOf: '2026-10-25T08:51:00Z' } })
    origins(1)
    const good = render(<DeliveryFailures accountId="A" startLoad compare={item(1, 4, 'low')} />)
    await waitFor(() => expect(good.container.textContent).toContain('1'))
    await waitFor(() => expect(good.container.querySelector<HTMLElement>('[data-kpi-delta]')?.dataset.kpiDelta).toBe('good'))
    cleanup()
    origins(2)
    const mismatch = render(<DeliveryFailures accountId="A" startLoad compare={item(1, 4, 'low')} />)
    await waitFor(() => expect(mismatch.container.querySelector('[class*="bigNum"]')?.textContent).toBe('2'))
    expect(mismatch.container.querySelector('[data-kpi-delta]')).toBeNull()
  })
})
