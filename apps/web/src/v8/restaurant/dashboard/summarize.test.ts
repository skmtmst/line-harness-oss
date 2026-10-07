import { describe, expect, it } from 'vitest'
import type { RestaurantChannelCloseTask } from '@line-crm/shared'
import type { RestaurantReservation, RestaurantTable } from '@/lib/restaurant-test-api'
import { reservation, tables } from '../booking-kit/test-data'
import { WALK_IN_NOTE } from '../front-desk/walk-in'
import { canMarkVisited, canWriteRole, groupCloseTasks, openItems, summarizeToday, visitState } from './summarize'
import { toMedia } from './use-store-today'

const today = (hour: number, minute = 0) => { const d = new Date(); d.setHours(hour, minute, 0, 0); return d.toISOString() }
const row = (id: string, over: Record<string, unknown>) => reservation(id, { starts_at: today(18), ends_at: today(20), ...over }) as unknown as RestaurantReservation

describe('今日のお店の数（E-1）', () => {
  it('取消・無断・押さえを除いて組と人数を数え、経路（LINE・電話・ウォークイン・予約サイト）に分ける', () => {
    const rows = [
      row('a', { source: 'line', guest_count: 2 }),
      row('b', { source: 'phone', guest_count: 4, starts_at: today(19), ends_at: today(21) }),
      row('c', { source: 'manual', note: WALK_IN_NOTE, guest_count: 3, starts_at: today(19), ends_at: today(21) }),
      row('d', { source: 'tabelog', guest_count: 6, starts_at: today(19), ends_at: today(21) }),
      row('e', { source: 'line', status: 'cancelled', guest_count: 9 }),
      row('f', { source: 'line', status: 'no_show', guest_count: 9 }),
      row('g', { source: 'manual', status: 'pending', hold_expires_at: today(23), guest_count: 9 }),
    ]
    const s = summarizeToday(rows, tables as unknown as RestaurantTable[], Date.parse(today(12)))
    expect(s.groups).toBe(4)
    expect(s.guests).toBe(15)
    expect([s.line, s.phone, s.walkIn, s.media]).toEqual([1, 1, 1, 1])
    expect(s.peak).toEqual({ label: '19:00', guests: 13 })
  })

  it('空席（いま）は動いている卓のうち、いま予約が重なっていない卓', () => {
    const rows = [row('a', { table_id: 't1', starts_at: today(11), ends_at: today(13) }), row('b', { table_id: 't3', starts_at: today(18), ends_at: today(20) })]
    const s = summarizeToday(rows, tables as unknown as RestaurantTable[], Date.parse(today(12)))
    /* 動いている卓 5（個室B は停止中）のうち T1 だけが使用中。 */
    expect(s.totalTables).toBe(5)
    expect(s.freeTables).toBe(4)
  })

  it('来店の印は承認待ち・予約確定だけ（押さえ・来店済み・取消は付けない）', () => {
    expect(canMarkVisited(row('a', { status: 'confirmed' }))).toBe(true)
    expect(canMarkVisited(row('a', { status: 'pending' }))).toBe(true)
    expect(canMarkVisited(row('a', { status: 'pending', hold_expires_at: today(23) }))).toBe(false)
    expect(canMarkVisited(row('a', { status: 'seated' }))).toBe(false)
    expect(canMarkVisited(row('a', { status: 'cancelled' }))).toBe(false)
    expect(visitState(row('a', { status: 'seated' })).label).toBe('来店済み')
    expect(visitState(row('a', { status: 'confirmed' })).label).toBe('予約中')
  })

  it('閲覧のみ（owner・admin・staff 以外）は変える操作を出さない', () => {
    expect(canWriteRole('staff')).toBe(true)
    expect(canWriteRole(null)).toBe(true)
    expect(canWriteRole('viewer')).toBe(false)
  })
})

describe('枠を閉じる知らせ（E-1 の帯・E-5）', () => {
  const task = (id: string, slotId: string, channel: string, status: RestaurantChannelCloseTask['status']): RestaurantChannelCloseTask => ({
    id, storeId: 's', slotId, startsAt: slotId === 'x' ? today(19) : today(20), channel, status, reason: 'limited', remainingSeats: 2, recipientIds: [], createdAt: '', updatedAt: '',
  })
  const media = toMedia([
    { code: 'hotpepper', name: 'ホットペッパー', receiveMethod: 'email_forward' },
    { code: 'tabelog', name: '食べログ', receiveMethod: 'email_forward' },
    { code: 'manual', name: '手入力・電話・LINE', receiveMethod: 'manual' },
    { code: 'restaurant_board', name: 'レストランボード', receiveMethod: 'direct' },
  ])

  it('媒体の一覧は受信の口（手入力・直接）を除く', () => {
    expect(media.map((m) => m.name)).toEqual(['ホットペッパー', '食べログ'])
    expect(media[0].adminUrl).toBeNull()
  })

  it('枠ごとに1行へまとめ、媒体の名前を付け、状態を決める', () => {
    const groups = groupCloseTasks([
      task('1', 'x', 'hotpepper', 'close'), task('2', 'x', 'tabelog', 'done'),
      task('3', 'y', 'hotpepper', 'reopen'), task('4', 'y', 'tabelog', 'done'),
    ], media)
    expect(groups.map((g) => [g.slotId, g.state])).toEqual([['x', 'partly'], ['y', 'reopen']])
    expect(groups[0].items.map((i) => i.name)).toEqual(['ホットペッパー', '食べログ'])
    expect(openItems(groups[0]).map((i) => i.id)).toEqual(['1'])
    expect(groupCloseTasks([task('5', 'x', 'hotpepper', 'done')], media)[0].state).toBe('done')
    expect(groupCloseTasks([task('6', 'x', 'hotpepper', 'close')], media)[0].state).toBe('open')
  })
})
