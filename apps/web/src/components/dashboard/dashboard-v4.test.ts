import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  defaultDashboardPreferences,
  normalizeDashboardPreferences,
  reorderDashboardItems,
  toggleDashboardItem,
} from './dashboard-editor'
import { activeUpcomingBookings } from './side-cards'
import { hasInboundSupportMark, summarizeTwoFactor } from './live-summary'
import {
  dashboardNotificationDestination,
  dashboardNotificationFilters,
  dashboardNotificationItems,
  isDashboardNotificationData,
  markDashboardNotificationRead,
} from './notification-summary'
import { formatTrendSources } from './friend-trend-table'
import type { BookingRequest } from '@/lib/api'
import type { NotificationCenterData, StaffMember } from '@line-crm/shared'

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
  it('編集パネルとQRコードをPencil V6の文言・寸法にそろえる', () => {
    const editor = readFileSync(path.join(process.cwd(), 'src/components/dashboard/dashboard-editor.tsx'), 'utf8')
    const qrDialog = readFileSync(path.join(process.cwd(), 'src/components/dashboard/qr-dialog.tsx'), 'utf8')

    expect(editor).toContain('max-w-[540px]')
    expect(editor).toContain('表示するカードと位置を変更します')
    expect(editor).toContain('ダッシュボードに反映')
    expect(editor).toContain('5つ目をONにすると、いちばん下のカードが自動でOFFになります。')
    expect(qrDialog).toContain('max-w-[820px]')
    expect(qrDialog).toContain("{ value: '300x300', label: '小（300px）'")
    expect(qrDialog).toContain('ダウンロード形式')
    expect(qrDialog).toContain('画像をダウンロード')
    expect(qrDialog).not.toContain('PNGをダウンロード')
  })

  it('画面名はV6共通トップバーだけに表示する', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/app/page.tsx'), 'utf8')
    expect(source).not.toContain("import Header from '@/components/layout/header'")
    expect(source).not.toContain('<Header')
    expect(source).not.toContain('title="ダッシュボード"')
    expect(source).not.toContain('<h1')
    expect(source).toContain('V6 `vUXKb/vwcM6`')
    expect(source).toContain('ダッシュボード編集')
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

  it('通知は選択中アカウントの取得・1件既読・全件既読へ接続する', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/app/page.tsx'), 'utf8')
    expect(source).toContain('api.notifications.center.list(selectedAccountId')
    expect(source).toContain('api.notifications.center.markRead(item.id, accountId)')
    expect(source).toContain('api.notifications.center.markAllRead(accountId, filter)')
    expect(source).toContain('通知を読み込めませんでした。もう一度お試しください。')
  })

  it('アカウントや絞り込みを切り替えた後は、遅れて届いた既読処理を反映しない', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/app/page.tsx'), 'utf8')
    expect(source).toContain('selectedAccountIdRef.current !== accountId')
    expect(source).toContain('notificationFilterRef.current !== filter')
    expect(source).toContain('notificationAccountId === selectedAccountId ? notificationData : null')
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
      // 設計 `vUXKb` は接続状態のすぐ下に「現在の対応マーク」を置く。
      'support-mark-status',
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

  it('今日やることの5枚目をONにすると並びのいちばん下をOFFにする', () => {
    const items = [
      ...defaultDashboardPreferences().today,
      { id: 'scenario-status' as const, visible: false },
    ]
    const toggled = toggleDashboardItem(items, 'scenario-status', 4)

    expect(toggled.filter((item) => item.visible)).toHaveLength(4)
    expect(toggled.at(-1)).toEqual({ id: 'scenario-status', visible: false })
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

describe('既存データを使う運用状況', () => {
  const member = (
    id: string,
    twoFactorEnabled: boolean,
    isActive = true,
  ): StaffMember => ({
    id,
    name: id,
    email: null,
    role: 'staff',
    lineLinked: false,
    twoFactorEnabled,
    isActive,
    permissionKeys: [],
    notificationPreferences: {},
    inviteStatus: 'active',
    createdAt: '2026-08-27T00:00:00.000Z',
    updatedAt: '2026-08-27T00:00:00.000Z',
    assignedLineAccountId: null,
    canAccessDescendantAccounts: false,
  })

  it('二段階認証は有効なログインユーザーだけを分母にする', () => {
    expect(summarizeTwoFactor([
      member('enabled', true),
      member('disabled', false),
      member('inactive', false, false),
    ])).toEqual({ enabled: 1, total: 2 })
  })

  it('受信時に自動変更する対応マークが1つでもあれば有効とする', () => {
    expect(hasInboundSupportMark([{ autoOnInbound: false }, { autoOnInbound: true }])).toBe(true)
    expect(hasInboundSupportMark([{ autoOnInbound: false }])).toBe(false)
  })
})

describe('ダッシュボード通知', () => {
  const data: NotificationCenterData = {
    items: [
      {
        id: 'danger',
        eventType: 'account_health_danger',
        category: 'error',
        title: '接続を確認してください',
        body: '運用状態から確認してください。',
        metadata: null,
        isRead: false,
        createdAt: '2026-08-27T01:30:00.000Z',
      },
      {
        id: 'recovered',
        eventType: 'account_health_recovered',
        category: 'update',
        title: '正常に戻りました',
        body: '接続が正常に戻りました。',
        metadata: null,
        isRead: false,
        createdAt: '2026-08-27T02:30:00.000Z',
      },
    ],
    counts: { all: 2, error: 1, update: 1, unread: 2 },
    unreadCount: 2,
  }

  it('APIの件数を通知タブへそのまま出す', () => {
    expect(dashboardNotificationFilters(data)).toEqual([
      { id: 'all', label: 'すべて', count: 2 },
      { id: 'error', label: 'エラー', count: 1 },
      { id: 'update', label: 'アップデート', count: 1 },
    ])
    expect(dashboardNotificationFilters(null).map((filter) => filter.count)).toEqual([null, null, null])
    expect(dashboardNotificationFilters({} as NotificationCenterData).map((filter) => filter.count)).toEqual([null, null, null])
  })

  it('不完全な返事は0件として扱わず、取得失敗へ分ける', () => {
    expect(isDashboardNotificationData(data)).toBe(true)
    expect(isDashboardNotificationData({})).toBe(false)
    expect(isDashboardNotificationData({ ...data, counts: undefined })).toBe(false)
    const source = readFileSync(path.join(process.cwd(), 'src/app/page.tsx'), 'utf8')
    expect(source).toContain('!isDashboardNotificationData(response.data)')
  })

  it('本文と日本時間を表示し、種類と未読状態を保つ', () => {
    const selected: string[] = []
    const items = dashboardNotificationItems(data.items, (item) => selected.push(item.id))
    expect(items[0]).toMatchObject({
      id: 'danger',
      filterId: 'error',
      unread: true,
      meta: '運用状態から確認してください。｜8/27 10:30',
    })
    items[0].onSelect?.()
    expect(selected).toEqual(['danger'])
  })

  it('1件既読は未読数だけを1減らし、二重操作では減らさない', () => {
    const once = markDashboardNotificationRead(data, 'danger')
    expect(once.unreadCount).toBe(1)
    expect(once.counts).toEqual({ all: 2, error: 1, update: 1, unread: 1 })
    expect(once.items.find((item) => item.id === 'danger')?.isRead).toBe(true)
    expect(markDashboardNotificationRead(once, 'danger')).toBe(once)
  })

  it('まとめて既読にした後はAPIの総対象数を引かず、未読数を再取得する', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/app/page.tsx'), 'utf8')
    expect(source).toContain('api.notifications.center.markAllRead(accountId, filter)')
    expect(source).toContain('await loadNotificationCenter()')
    expect(source).not.toContain('markDashboardNotificationsRead')
  })

  it('通知種類ごとに安全な管理画面へ送る', () => {
    expect(dashboardNotificationDestination(data.items[0])).toBe('/emergency')
    expect(dashboardNotificationDestination({
      ...data.items[1],
      eventType: 'release',
    })).toBe('/updates')
    expect(dashboardNotificationDestination({
      ...data.items[1],
      eventType: 'unknown',
    })).toBeNull()
  })
})
