import { describe, expect, it } from 'vitest'
import {
  defaultDashboardPreferences,
  normalizeDashboardPreferences,
} from './dashboard-editor'
import { activeUpcomingBookings } from './side-cards'
import type { BookingRequest } from '@/lib/api'

function booking(id: string, startsAt: string, status = 'confirmed'): BookingRequest {
  return {
    id,
    friend_id: `friend-${id}`,
    starts_at: startsAt,
    ends_at: startsAt,
    status,
    customer_note: null,
    internal_note: null,
    price_at_booking: 0,
    menu_name: '相談',
    staff_name: '担当者',
    friend_name: 'テスト',
    requested_at: startsAt,
    decided_at: null,
    external_event_id: null,
  }
}

describe('ダッシュボードV4の初期表示', () => {
  it('既存カードは表示し、追加候補と友だちの状態はOFFにする', () => {
    const preferences = defaultDashboardPreferences()
    expect(preferences.main.filter((item) => item.visible).map((item) => item.id)).toEqual([
      'shipment',
      'pending-inbox',
      'friend-trend',
      'friend-add',
    ])
    expect(preferences.right.filter((item) => item.visible).map((item) => item.id)).toEqual([
      'send-quota',
      'operational-alerts',
      'connection-status',
      'upcoming',
      'monthly-delivery',
      'recent-results',
    ])
    expect(preferences.right.find((item) => item.id === 'friend-status')?.visible).toBe(false)
  })

  it('古い保存設定へ新しいOFFカードを追加する', () => {
    const normalized = normalizeDashboardPreferences({
      main: [{ id: 'friend-trend', visible: true }],
      right: [{ id: 'monthly-delivery', visible: true }],
    })
    expect(normalized.main[0]).toEqual({ id: 'friend-trend', visible: true })
    expect(normalized.right.find((item) => item.id === 'friend-status')).toEqual({
      id: 'friend-status',
      visible: false,
    })
  })
})

describe('今後の予定', () => {
  it('過去と取消済みを除き、開始が近い順にする', () => {
    const now = new Date('2026-08-20T00:00:00.000Z').getTime()
    const result = activeUpcomingBookings([
      booking('later', '2026-08-22T00:00:00.000Z'),
      booking('past', '2026-08-19T00:00:00.000Z'),
      booking('cancelled', '2026-08-20T03:00:00.000Z', 'cancelled'),
      booking('next', '2026-08-20T02:00:00.000Z'),
    ], now)
    expect(result.map((item) => item.id)).toEqual(['next', 'later'])
  })
})
