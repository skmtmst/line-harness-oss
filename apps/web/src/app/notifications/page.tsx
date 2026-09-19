'use client'

/*
 * 通知一覧（V6 1-1 ダッシュボードの通知パネルからの全件行き先）。
 *
 * パネルは先頭100件までしか読まない。ここは「さらに読み込む」で
 * 古い通知まで辿れる一覧にする。行を押すと既読にして詳しい画面へ送る
 * 動きはパネルと同じ（notification-summary の行き先判定を共有）。
 */
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import type { NotificationCenterData, NotificationCenterItem } from '@line-crm/shared'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import Card from '@/components/shared/card'
import Button from '@/components/shared/button'
import { STATE_TEXT } from '@/components/shared/not-connected'
import { Tabs } from '@/components/shared/tabs'
import {
  dashboardNotificationDestination,
  isDashboardNotificationData,
  notificationTime,
  type DashboardNotificationFilter,
} from '@/components/dashboard/notification-summary'

const PAGE_SIZE = 50

function NotificationsPageInner() {
  usePageTitle('通知')
  const router = useRouter()
  const params = useSearchParams()
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const categoryParam = params.get('category')
  const filter: DashboardNotificationFilter =
    categoryParam === 'error' || categoryParam === 'update' ? categoryParam : 'all'
  const [items, setItems] = useState<NotificationCenterItem[]>([])
  const [counts, setCounts] = useState<NotificationCenterData['counts'] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const requestId = useRef(0)

  const selectFilter = (next: DashboardNotificationFilter) => {
    const query = new URLSearchParams(params.toString())
    if (next === 'all') query.delete('category')
    else query.set('category', next)
    const text = query.toString()
    router.replace(text ? `/notifications?${text}` : '/notifications')
  }

  const load = useCallback(async (offset: number, append: boolean) => {
    const id = ++requestId.current
    if (accountLoading) return
    if (!selectedAccountId) {
      setItems([])
      setCounts(null)
      setError('LINEアカウントを選択してください')
      setLoading(false)
      return
    }
    setLoading(true)
    if (!append) setError('')
    try {
      const response = await api.notifications.center.list(selectedAccountId, {
        category: filter,
        limit: PAGE_SIZE,
        offset,
      })
      if (id !== requestId.current) return
      if (!response.success) throw new Error(response.error)
      if (!isDashboardNotificationData(response.data)) throw new Error('invalid notification center response')
      setItems((current) => append ? [...current, ...response.data.items] : response.data.items)
      setCounts(response.data.counts)
    } catch {
      if (id !== requestId.current) return
      if (!append) {
        setItems([])
        setCounts(null)
      }
      setError(`通知を${STATE_TEXT.error}`)
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [accountLoading, filter, selectedAccountId])

  useEffect(() => { void load(0, false) }, [load])

  const markRead = async (item: NotificationCenterItem) => {
    if (!selectedAccountId) return
    if (item.isRead) return
    try {
      const response = await api.notifications.center.markRead(item.id, selectedAccountId)
      if (!response.success) throw new Error(response.error)
      setItems((current) => current.map((row) => row.id === item.id ? { ...row, isRead: true } : row))
      setCounts((current) => current ? { ...current, unread: Math.max(0, current.unread - 1) } : current)
    } catch {
      setError('通知を既読にできませんでした。')
    }
  }

  const openNotification = (item: NotificationCenterItem) => {
    void markRead(item)
    router.push(dashboardNotificationDestination(item))
  }

  const markAllRead = async () => {
    if (!selectedAccountId || !counts || counts.unread === 0) return
    try {
      const response = await api.notifications.center.markAllRead(selectedAccountId, filter)
      if (!response.success) throw new Error(response.error)
      await load(0, false)
    } catch {
      setError('通知をまとめて既読にできませんでした。')
    }
  }

  const filters: Array<{ id: DashboardNotificationFilter; label: string; count: number | null }> = [
    { id: 'all', label: 'すべて', count: counts?.all ?? null },
    { id: 'error', label: 'エラー', count: counts?.error ?? null },
    { id: 'update', label: 'アップデート', count: counts?.update ?? null },
  ]
  const total = counts ? (filter === 'error' ? counts.error : filter === 'update' ? counts.update : counts.all) : 0
  const hasMore = items.length < total

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          items={filters.map((entry) => ({
            label: entry.label,
            count: entry.count ?? undefined,
            current: filter === entry.id,
            onClick: () => selectFilter(entry.id),
          }))}
        />
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => { void markAllRead() }} disabled={!counts || counts.unread === 0}>
            すべて既読にする
          </Button>
          <Link href="/line-notifications?tab=operator" className="text-action text-xs font-medium hover:underline">
            通知設定
          </Link>
        </div>
      </div>

      {error ? (
        <div className="bg-danger-bg text-danger rounded-card flex flex-wrap items-center gap-3 p-4 text-sm" role="alert">
          <span className="min-w-0 flex-1">{error}</span>
          <button type="button" onClick={() => void load(0, false)} className="shrink-0 font-medium underline">もう一度読み込む</button>
        </div>
      ) : null}

      <Card overflow="hidden">
        {items.length === 0 && !loading ? (
          <p className="text-ink-faint px-5 py-8 text-center text-sm">通知はまだありません。</p>
        ) : (
          <ul className="divide-hairline divide-y">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => openNotification(item)}
                  className="hover:bg-canvas-sunken flex w-full items-start gap-3 px-5 py-4 text-left"
                >
                  <span
                    aria-hidden="true"
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.isRead ? 'bg-hairline' : 'bg-accent'}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className={`text-ink block truncate text-sm ${item.isRead ? '' : 'font-semibold'}`}>
                      {item.title}
                      {!item.isRead ? <span className="sr-only">（未読）</span> : null}
                    </span>
                    <span className="text-ink-faint mt-0.5 block truncate text-xs">{item.body}</span>
                  </span>
                  <span className="text-ink-faint shrink-0 text-xs">{notificationTime(item.createdAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {loading ? (
          <p className="text-ink-faint px-5 py-4 text-center text-xs">{STATE_TEXT.loading}…</p>
        ) : null}
      </Card>

      {hasMore ? (
        <div className="flex justify-center">
          <Button variant="secondary" onClick={() => { void load(items.length, true) }} disabled={loading}>
            さらに読み込む（残り {total - items.length} 件）
          </Button>
        </div>
      ) : null}
    </div>
  )
}

export default function NotificationsPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={null}>
      <NotificationsPageInner />
    </Suspense>
  )
}
