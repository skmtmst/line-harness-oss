'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { NotificationCenterData, NotificationCenterItem } from '@line-crm/shared'
import BellPopover, { type BellFilter, type BellItem, type BellPopoverState } from '@/components/shared/bell-popover'
import type { TopBarNotificationsPopover } from '@/components/shared/top-bar'
import { isDashboardNotificationData } from '@/components/dashboard/notification-summary'
import { notificationDestination, notificationLinkLabel } from '@/v8/notifications/destination'
import { loadFailureCopy, loadFailureNotice } from '@/components/shared/api-error-message'
import { formatRelative } from '@/lib/format'
import { runOptimistic } from '@/lib/undoable'

/** 小窓に出す最大の件数（絵 mV28V）。 */
export const BELL_POPOVER_LIMIT = 5
/** 読む件数。通知の一覧と同じ 50 件から未読を先に並べ、先頭の5件を出す。 */
const FETCH_LIMIT = 50

/** 未読が先・それぞれの中は口の順（新しい順）。通知の一覧（y8QQV）と同じ並び。 */
export function bellOrder(items: NotificationCenterItem[]): NotificationCenterItem[] {
  return [...items.filter((item) => !item.isRead), ...items.filter((item) => item.isRead)]
}

/**
 * ★V8 ベルの小窓の中身（取得・既読・行き先）。見た目は `shared/bell-popover.tsx`。
 *
 * 通知の一覧（`v8/notifications/list.tsx`）と同じ口・同じ判定を使う：
 *   一覧 `api.notifications.center.list`・既読 `markRead`・まとめて既読 `markAllRead`
 *   行き先 `notificationDestination`（ダッシュボードの通知パネルと同じ判定＋EC連携）。
 * 既読は押した瞬間に反映し、失敗したら戻して「もう一度」の知らせ（runOptimistic）。
 * 未読の数が変わったら onUnreadChange でベルの赤い札へ返す。
 */
export default function BellNotifications({
  popover,
  accountId,
  onUnreadChange,
}: {
  popover: TopBarNotificationsPopover
  /** 選んでいる LINE アカウント。無いとき（統括で店を選んでいない）は案内だけ出す。 */
  accountId: string | null
  onUnreadChange: (count: number) => void
}) {
  const router = useRouter()
  const { open, onClose } = popover
  const [filter, setFilter] = useState<BellFilter>('all')
  const [data, setData] = useState<NotificationCenterData | null>(null)
  const [state, setState] = useState<BellPopoverState>('loading')
  const [error, setError] = useState<{ message: string; retryable: boolean } | null>(null)
  const requestId = useRef(0)
  const unreadRef = useRef(onUnreadChange)
  unreadRef.current = onUnreadChange

  const load = useCallback(async () => {
    const id = ++requestId.current
    if (!accountId) {
      setData(null)
      setState('no-account')
      return
    }
    setState('loading')
    setError(null)
    try {
      const { api } = await import('@/lib/api')
      const response = await api.notifications.center.list(accountId, { category: filter, limit: FETCH_LIMIT })
      if (id !== requestId.current) return
      if (!response.success) throw new Error(response.error)
      if (!isDashboardNotificationData(response.data)) throw new Error('invalid notification center response')
      setData(response.data)
      setState('ready')
      unreadRef.current(response.data.counts.unread)
    } catch (caught) {
      if (id !== requestId.current) return
      setData(null)
      setError({ message: loadFailureNotice(caught, 'お知らせ'), retryable: loadFailureCopy(caught, 'お知らせ').retryable })
      setState('error')
    }
  }, [accountId, filter])

  // 開くたび・分類を変えるたびに読み直す（閉じている間は読まない）。
  useEffect(() => {
    if (open) void load()
  }, [open, load])

  const apply = useCallback((next: NotificationCenterData) => {
    setData(next)
    unreadRef.current(next.counts.unread)
  }, [])

  const markRead = useCallback((item: NotificationCenterItem) => {
    if (!accountId || !data || item.isRead) return
    const before = data
    apply({
      ...data,
      items: data.items.map((row) => (row.id === item.id ? { ...row, isRead: true } : row)),
      counts: { ...data.counts, unread: Math.max(0, data.counts.unread - 1) },
      unreadCount: Math.max(0, data.unreadCount - 1),
    })
    runOptimistic({
      request: async () => (await import('@/lib/api')).api.notifications.center.markRead(item.id, accountId),
      revert: () => apply(before),
      failureMessage: '通知を既読にできませんでした。',
    })
  }, [accountId, apply, data])

  const markAllRead = useCallback(() => {
    if (!accountId || !data || data.counts.unread === 0) return
    const before = data
    apply({
      ...data,
      items: data.items.map((row) => ({ ...row, isRead: true })),
      counts: { ...data.counts, unread: 0 },
      unreadCount: 0,
    })
    runOptimistic({
      request: async () => (await import('@/lib/api')).api.notifications.center.markAllRead(accountId, 'all'),
      revert: () => apply(before),
      failureMessage: '通知をまとめて既読にできませんでした。',
    })
  }, [accountId, apply, data])

  const shown = useMemo(() => (data ? bellOrder(data.items).slice(0, BELL_POPOVER_LIMIT) : []), [data])
  const items: BellItem[] = shown.map((item) => ({
    id: item.id,
    title: item.title,
    body: item.body,
    category: item.category === 'error' ? 'error' : 'update',
    unread: !item.isRead,
    time: formatRelative(item.createdAt, undefined, '日時不明'),
    linkLabel: notificationLinkLabel(item),
  }))

  const select = (id: string) => {
    const item = shown.find((row) => row.id === id)
    if (!item) return
    markRead(item)
    onClose()
    router.push(notificationDestination(item))
  }

  return (
    <BellPopover
      open={open}
      onClose={onClose}
      getAnchor={popover.getAnchor}
      getPositionRect={popover.getPositionRect}
      id={popover.id}
      state={state}
      items={items}
      unreadCount={data?.counts.unread ?? 0}
      filter={filter}
      onFilterChange={setFilter}
      errorMessage={error?.message}
      onRetry={error?.retryable ? () => { void load() } : undefined}
      onSelect={select}
      onMarkAllRead={markAllRead}
      onViewAll={() => { onClose(); router.push('/notifications') }}
    />
  )
}
