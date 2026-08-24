import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  defaultDashboardPreferences,
  normalizeDashboardPreferences,
  reorderDashboardItems,
} from './dashboard-editor'
import { activeUpcomingBookings } from './side-cards'
import { formatTrendSources } from './friend-trend-table'
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
  it('見出しをV5共通ページヘッダーで表示する', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/app/page.tsx'), 'utf8')
    expect(source).toContain("import Header from '@/components/layout/header'")
    expect(source).toContain('title="ダッシュボード"')
    expect(source).not.toContain('<h1')
  })

  it('旧Workerが追加集計を返さなくてもダッシュボードを描画できる', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/app/page.tsx'), 'utf8')
    expect(source).toContain('data?.partialFailures?.length')
    expect(source).toContain('data?.operations?.scenarios')
    expect(source).toContain('data?.operations?.migrations')
    expect(source).toContain('data?.operations?.bookings')
    expect(source).not.toContain('data?.partialFailures.length')
    expect(source).not.toMatch(/data\?\.operations\.[a-zA-Z]/)
  })

  it('旧Workerが友だちの流入元を返さなくても推移表を描画できる', () => {
    expect(formatTrendSources(undefined)).toEqual({ full: '', compact: '経路なし' })
    expect(formatTrendSources([{ name: '広告', count: 2 }])).toEqual({
      full: '広告 2',
      compact: '広告 2',
    })
  })

  it('既存カードは表示し、追加候補と友だちの状態はOFFにする', () => {
    const preferences = defaultDashboardPreferences()
    expect(preferences.today.filter((item) => item.visible).map((item) => item.id)).toEqual([
      'today-inbox',
      'today-photo-review',
      'today-bookings',
      'today-shipments',
    ])
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
    expect(normalized.today).toEqual(defaultDashboardPreferences().today)
    expect(normalized.main[0]).toEqual({ id: 'friend-trend', visible: true })
    expect(normalized.right.find((item) => item.id === 'friend-status')).toEqual({
      id: 'friend-status',
      visible: false,
    })
  })

  it('カードの表示状態を保ったままドラッグ順へ並べ替える', () => {
    const items = defaultDashboardPreferences().today.map((item, index) => ({
      ...item,
      visible: index !== 1,
    }))
    const reordered = reorderDashboardItems(items, 'today-shipments', 'today-inbox')
    expect(reordered.map((item) => item.id)).toEqual([
      'today-shipments',
      'today-inbox',
      'today-photo-review',
      'today-bookings',
    ])
    expect(reordered.find((item) => item.id === 'today-photo-review')?.visible).toBe(false)
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
