'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { NotificationCenterData, NotificationCenterItem } from '@line-crm/shared'
import { BellPanel, isSystemNotification, notificationQueryForTab, type BellPanelItem, type BellPanelState, type NotificationTab } from '@/v8/notifications/public/bell/index'
import type { TopBarNotificationsPopover } from '@/components/shared/top-bar'
import { isDashboardNotificationData } from '@/components/dashboard/notification-summary'
import { notificationDestination, notificationLinkLabel } from '@/v8/notifications/public/destination/index'
import { loadFailureCopy, loadFailureNotice } from '@/components/shared/api-error-message'
import { formatRelative, formatYmd } from '@/lib/format'
import { runOptimistic } from '@/lib/undoable'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { notifyToast } from '@/components/shared/toast'

/** 小窓に出す最大の件数（絵 mV28V）。 */
export const BELL_POPOVER_LIMIT = 5
/** 読む件数。通知の一覧と同じ 50 件から未読を先に並べ、先頭の5件を出す。 */
const FETCH_LIMIT = 50

/** 未読が先・それぞれの中は口の順（新しい順）。通知の一覧と同じ並び。 */
export function bellOrder<T extends NotificationCenterItem>(items: T[]): T[] {
  const newestFirst = (rows: T[]) => [...rows].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  return [...newestFirst(items.filter((item) => !item.isRead)), ...newestFirst(items.filter((item) => item.isRead))]
}

type ScopedNotification = NotificationCenterItem & { sourceAccountId: string; sourceAccountName: string }
type ScopedCenterData = Omit<NotificationCenterData, 'items'> & { items: ScopedNotification[] }
type NotificationAccount = { id: string; label: string }
const NO_ACCOUNTS: NotificationAccount[] = []

/**
 * ★V8 ベルの小窓の中身（取得・既読・行き先）。見た目は `v8/notifications/bell-panel.tsx`。
 *
 * 通知の一覧（`v8/notifications/list.tsx`）と同じ口・同じ判定を使う：
 *   一覧 `api.notifications.center.list`・既読 `markRead`・まとめて既読 `markAllRead`
 *   タブ「すべて・未読・システム」（未読は口の unread=1、システムは category=error）
 *   行き先 `notificationDestination`（ダッシュボードの通知パネルと同じ判定＋EC連携）。
 * 既読は押した瞬間に反映し、失敗したら戻して「もう一度」の知らせ（runOptimistic）。
 * 未読の数が変わったら onUnreadChange でベルの赤い札へ返す。
 */
export default function BellNotifications({
  popover,
  accountId,
  accounts = NO_ACCOUNTS,
  onAccountChange,
  onUnreadChange,
}: {
  popover: TopBarNotificationsPopover
  /** 選んでいる LINE アカウント。統括で未選択のときは一覧の全アカウントを読む。 */
  accountId: string | null
  /** 統括で使えるアカウント一覧。個別アカウント画面では選択中だけ読む。 */
  accounts?: NotificationAccount[]
  onAccountChange: (accountId: string, after?: () => void) => void
  onUnreadChange: (count: number) => void
}) {
  const router = useRouter()
  const role = useStaffRole()
  const canMarkRead = role === 'owner' || role === 'admin' || role === 'staff'
  const destinationContext = { accountId, canManage: canManageRole(role) }
  const { open, onClose } = popover
  const [tab, setTab] = useState<NotificationTab>('all')
  const [data, setData] = useState<ScopedCenterData | null>(null)
  const [state, setState] = useState<BellPanelState>('loading')
  const [error, setError] = useState<{ message: string; retryable: boolean } | null>(null)
  const requestId = useRef(0)
  const unreadRef = useRef(onUnreadChange)
  unreadRef.current = onUnreadChange

  const load = useCallback(async () => {
    const id = ++requestId.current
    const targets = accountId
      ? [accounts.find((account) => account.id === accountId) ?? { id: accountId, label: '' }]
      : accounts
    if (targets.length === 0) {
      setData(null)
      setState('no-account')
      return
    }
    setState('loading')
    setError(null)
    try {
      const { api } = await import('@/lib/api')
      const responses = await Promise.all(targets.map(async (account) => {
        const response = await api.notifications.center.list(account.id, { ...notificationQueryForTab(tab), limit: FETCH_LIMIT })
        if (!response.success) throw new Error(response.error)
        if (!isDashboardNotificationData(response.data)) throw new Error('invalid notification center response')
        return { account, data: response.data }
      }))
      if (id !== requestId.current) return
      const mergedItems = responses.flatMap(({ account, data: result }) => result.items.map((item) => ({
        ...item,
        sourceAccountId: account.id,
        sourceAccountName: account.label,
      })))
      const counts = responses.reduce((sum, { data: result }) => ({
        all: sum.all + result.counts.all,
        error: sum.error + result.counts.error,
        update: sum.update + result.counts.update,
        unread: sum.unread + result.counts.unread,
      }), { all: 0, error: 0, update: 0, unread: 0 })
      setData({ items: mergedItems, counts, unreadCount: counts.unread })
      setState('ready')
      unreadRef.current(counts.unread)
    } catch (caught) {
      if (id !== requestId.current) return
      setData(null)
      setError({ message: loadFailureNotice(caught, '通知'), retryable: loadFailureCopy(caught, '通知').retryable })
      setState('error')
    }
  }, [accountId, accounts, tab])

  // 開くたび・タブを変えるたびに読み直す（閉じている間は読まない）。
  useEffect(() => {
    if (open) void load()
    return () => { requestId.current += 1 }
  }, [open, load])

  const apply = useCallback((next: ScopedCenterData) => {
    setData(next)
    unreadRef.current(next.counts.unread)
  }, [])

  const markRead = useCallback((item: ScopedNotification) => {
    if (!canMarkRead || !data || item.isRead) return
    const generation = requestId.current
    const before = data
    apply({
      ...data,
      items: data.items.map((row) => (row.id === item.id && row.sourceAccountId === item.sourceAccountId ? { ...row, isRead: true } : row)),
      counts: { ...data.counts, unread: Math.max(0, data.counts.unread - 1) },
      unreadCount: Math.max(0, data.unreadCount - 1),
    })
    runOptimistic({
      isCurrent: () => generation === requestId.current,
      request: async () => (await import('@/lib/api')).api.notifications.center.markRead(item.id, item.sourceAccountId),
      revert: () => apply(before),
      failureMessage: '通知を既読にできませんでした。',
    })
  }, [apply, canMarkRead, data])

  const markAllRead = useCallback(() => {
    if (!canMarkRead || !data || data.counts.unread === 0) return
    const generation = requestId.current
    const before = data
    apply({
      ...data,
      items: data.items.map((row) => ({ ...row, isRead: true })),
      counts: { ...data.counts, unread: 0 },
      unreadCount: 0,
    })
    runOptimistic({
      isCurrent: () => generation === requestId.current,
      request: async () => {
        const { api } = await import('@/lib/api')
        const results = await Promise.all((accountId ? [accountId] : accounts.map((account) => account.id))
          .map((id) => api.notifications.center.markAllRead(id, 'all')))
        const failure = results.find((result) => !result.success)
        if (failure && !failure.success) throw new Error(failure.error)
      },
      revert: () => apply(before),
      failureMessage: '通知をまとめて既読にできませんでした。',
    })
  }, [accountId, accounts, apply, canMarkRead, data])

  const shown = useMemo(() => (data ? bellOrder(data.items).slice(0, BELL_POPOVER_LIMIT) : []), [data])
  const today = formatYmd(new Date())
  const items: BellPanelItem[] = shown.map((item) => {
    const day = formatYmd(item.createdAt)
    return {
      id: `${item.sourceAccountId}:${item.id}`,
      title: accountId ? item.title : `${item.sourceAccountName}：${item.title}`,
      body: item.body,
      kind: isSystemNotification(item) ? 'system' : 'other',
      unread: !item.isRead,
      time: formatRelative(item.createdAt, undefined, '日時不明'),
      period: day === '' ? 'unknown' : day === today ? 'today' : 'earlier',
      linkLabel: notificationLinkLabel(item, { accountId: item.sourceAccountId, canManage: destinationContext.canManage }),
    }
  })

  const select = (id: string) => {
    const item = shown.find((row) => `${row.sourceAccountId}:${row.id}` === id)
    if (!item) return
    markRead(item)
    onClose()
    const nextContext = { accountId: item.sourceAccountId, canManage: destinationContext.canManage }
    const destination = notificationDestination(item, nextContext)
    if (item.sourceAccountId !== accountId) {
      onAccountChange(item.sourceAccountId, () => {
        notifyToast(`${item.sourceAccountName} に切り替えました`, { tone: 'info' })
        router.push(destination)
      })
    } else router.push(destination)
  }

  return (
    <BellPanel
      open={open}
      onClose={onClose}
      getAnchor={popover.getAnchor}
      id={popover.id}
      state={state}
      items={items}
      unreadCount={data?.counts.unread ?? 0}
      tab={tab}
      onTabChange={setTab}
      errorMessage={error?.message}
      onRetry={error?.retryable ? () => { void load() } : undefined}
      onSelect={select}
      onMarkAllRead={canMarkRead ? markAllRead : undefined}
      onViewAll={() => { onClose(); router.push('/notifications') }}
    />
  )
}
