// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { DashboardOverview } from '@/lib/api'
import { kpiFillCell, kpiFillIds } from './kpi-fill'

afterEach(cleanup)

describe('数の帯をいつも4マスにそろえる', () => {
  it('選んだ数が1つなら、今日の友だち・今月の配信・次の配信で4マスにする', () => {
    expect(kpiFillIds(['today-inbox'])).toEqual(['fill-friends', 'fill-delivery', 'fill-next-broadcast'])
  })

  it('予約のマスがある時は次の配信を足さず、予約を4枚目にする分だけ埋める', () => {
    expect(kpiFillIds(['today-inbox', 'today-bookings'])).toEqual(['fill-friends', 'fill-delivery'])
  })

  it('選んだ数（発送など）を優先し、4マスを超えて足さない', () => {
    expect(kpiFillIds(['today-inbox', 'today-shipments'])).toEqual(['fill-friends', 'fill-delivery'])
    expect(kpiFillIds(['today-inbox', 'today-photo-review', 'today-bookings', 'today-shipments'])).toEqual([])
  })
})

const overview = (patch: Partial<DashboardOverview> = {}): DashboardOverview => ({
  period: 'today', generatedAt: '2026-10-26 10:00:00',
  friends: { active: 10, total: 12, blockedByThem: 1, hiddenByUs: 0, blockedBoth: 0 },
  inbox: { unanswered: 0, inProgress: 0, resolved: 0, oldestUnansweredMinutes: null, averageFirstReplyMinutes: null },
  delivery: { sent: 0, push: 0, reply: 0, broadcasts: 0, quotaLimit: 5000, quotaUsed: 1842 },
  trend: [{ date: '2026-10-26', added: 3, blocked: 1, active: 10, estimated: false }],
  conversions: { total: 0, byPoint: [] },
  ...patch,
})
const input = (data: DashboardOverview | null, extra: Partial<Parameters<typeof kpiFillCell>[1]> = {}) => ({
  data, overviewFailed: false, trendAvailable: true, today: '2026-10-26', activeFriendsCompare: null, nextBroadcast: null, ...extra,
})

describe('埋めるマスの中身', () => {
  it('今日の友だちは今日増えた人とブロックの数、先週の同じ曜日の友だちの数と比べる', () => {
    render(<>{kpiFillCell('fill-friends', input(overview(), { activeFriendsCompare: { current: 10, previous: 8, better: 'high' } as never }))}</>)
    expect(screen.getByText('今日の友だち')).toBeTruthy()
    expect(screen.getByText('+3')).toBeTruthy()
    expect(screen.getByText('ブロック 1 人')).toBeTruthy()
    expect(screen.getByText('先週の同じ曜日の友だちの数より 2 人多い')).toBeTruthy()
  })

  it('今日の記録が推定の日はブロックを 0 と見せない', () => {
    render(<>{kpiFillCell('fill-friends', input(overview({ trend: [{ date: '2026-10-26', added: 2, blocked: 0, active: 9, estimated: true }] })))}</>)
    expect(screen.getByText('ブロック 未集計')).toBeTruthy()
  })

  it('今月の配信は送信枠の使った割合をメーターで出す', () => {
    render(<>{kpiFillCell('fill-delivery', input(overview()))}</>)
    expect(screen.getByText('1,842')).toBeTruthy()
    expect(screen.getByText('枠 5,000 通のうち 37%')).toBeTruthy()
    expect(screen.getByRole('progressbar', { name: '送信枠の使った割合' }).getAttribute('aria-valuenow')).toBe(String(1842 / 5000 * 100))
  })

  it('概要が取れない時は 0 にせず「読み込めませんでした」', () => {
    render(<>{kpiFillCell('fill-delivery', input(null, { overviewFailed: true }))}{kpiFillCell('fill-friends', input(null, { overviewFailed: true }))}</>)
    expect(screen.getAllByText('読み込めませんでした')).toHaveLength(2)
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('次の配信は予約の一番近い1本の日時と題、無ければ無いと書く', () => {
    const item = { kind: 'broadcast' as const, id: 'b1', title: '秋の新メニュー', startsAt: '2026-10-28T09:00:00Z', href: '/broadcasts' }
    render(<>{kpiFillCell('fill-next-broadcast', input(null, { nextBroadcast: { accountId: 'a', item, failed: false } }))}</>)
    expect(screen.getByText('「秋の新メニュー」')).toBeTruthy()
    expect(screen.getByText('10/28 18:00')).toBeTruthy()
    cleanup()
    render(<>{kpiFillCell('fill-next-broadcast', input(null, { nextBroadcast: { accountId: 'a', item: null, failed: false } }))}</>)
    expect(screen.getByText('予約した配信はありません')).toBeTruthy()
  })
})

describe('今日の記録が無い時', () => {
  it('読み込み中のままにせず、記録が無いと書く', () => {
    render(<>{kpiFillCell('fill-friends', input(overview({ trend: [{ date: '2026-10-25', added: 2, blocked: 0, active: 9, estimated: false }] })))}</>)
    expect(screen.getByText('今日の記録はまだありません')).toBeTruthy()
    expect(screen.queryByText('読み込んでいます')).toBeNull()
  })
})
