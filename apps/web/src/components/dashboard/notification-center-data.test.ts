import { describe, expect, it, vi } from 'vitest'
import type { NotificationCenterData, NotificationCenterItem } from '@line-crm/shared'
import {
  dashboardNotificationDestination,
  dashboardNotificationFilters,
  dashboardNotificationItems,
  markDashboardNotificationRead,
} from './notification-center-data'

const item = (
  id: string,
  category: NotificationCenterItem['category'],
  isRead = false,
  eventType = 'notice',
): NotificationCenterItem => ({
  id,
  eventType,
  category,
  title: `通知 ${id}`,
  body: `本文 ${id}`,
  metadata: null,
  isRead,
  createdAt: '2026-08-28T08:00:00.000Z',
})

const data = (): NotificationCenterData => ({
  items: [item('error', 'error'), item('update', 'update'), item('read', 'info', true)],
  counts: { all: 3, error: 1, update: 1, unread: 2 },
  unreadCount: 2,
})

describe('ダッシュボード通知センター', () => {
  it('サーバーの集計値をタブへそのまま使う', () => {
    expect(dashboardNotificationFilters(data())).toEqual([
      { id: 'all', label: 'すべて', count: 3 },
      { id: 'error', label: 'エラー', count: 1 },
      { id: 'update', label: 'アップデート', count: 1 },
    ])
  })

  it('通知本文・既読・種類を共通パネルの形へ変える', () => {
    const onSelect = vi.fn()
    const items = dashboardNotificationItems(data(), onSelect)
    expect(items[0]).toMatchObject({
      id: 'error', title: '通知 error', meta: '本文 error', unread: true, filterId: 'error',
    })
    items[0].onSelect?.()
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'error' }))
  })

  it('個別既読は未読数だけ減らし、二度押しで重ねて減らさない', () => {
    const first = markDashboardNotificationRead(data(), 'error')!
    expect(first.unreadCount).toBe(1)
    expect(first.items.find((entry) => entry.id === 'error')?.isRead).toBe(true)
    expect(markDashboardNotificationRead(first, 'error')?.unreadCount).toBe(1)
  })

  it('既知の通知だけを安全な管理画面へ送る', () => {
    expect(dashboardNotificationDestination(item('health', 'error', false, 'account_health_danger'))).toBe('/emergency')
    expect(dashboardNotificationDestination(item('release', 'update', false, 'release'))).toBe('/updates')
    expect(dashboardNotificationDestination(item('unknown', 'info'))).toBeNull()
  })
})
