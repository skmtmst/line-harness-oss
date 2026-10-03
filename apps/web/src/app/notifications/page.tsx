'use client'

import '@/app/notifications/readonly-v8.css'
import ReadonlyHeaderV8 from '@/app/notifications/readonly-header-v8'
import { useAdminTheme } from '@/lib/use-admin-theme'

/*
 * 通知一覧（V6 1-1 ダッシュボードの通知パネルからの全件行き先）。
 *
 * パネルは先頭100件までしか読まない。ここは「さらに読み込む」で
 * 古い通知まで辿れる一覧にする。行を押すと既読にして詳しい画面へ送る
 * 動きはパネルと同じ（notification-summary の行き先判定を共有）。
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlertTriangle, Download } from 'lucide-react'
import type { NotificationCenterData, NotificationCenterItem } from '@line-crm/shared'
import { api } from '@/lib/api'
import {
  loadFailureCopy,
  loadFailureNotice,
} from '@/components/shared/api-error-message'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import Card from '@/components/shared/card'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import { STATE_TEXT } from '@/components/shared/not-connected'
import { Tabs } from '@/components/shared/tabs'
import ListState from '@/components/shared/list-state'
import { runOptimistic } from '@/lib/undoable'
import {
  dashboardNotificationDestination,
  isDashboardNotificationData,
  notificationTime,
  type DashboardNotificationFilter,
} from '@/components/dashboard/notification-summary'

const PAGE_SIZE = 50

function NotificationsPageInner() {
  const theme = useAdminTheme()
  usePageTitle('通知')
  const router = useRouter()
  const params = useSearchParams()
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const categoryParam = params.get('category')
  const filter: DashboardNotificationFilter =
    categoryParam === 'error' || categoryParam === 'update' ? categoryParam : 'all'
  const [items, setItems] = useState<NotificationCenterItem[]>([])
  // R16: 未読・未対応を扱う一覧は「未読が先・新しい順」。口は作成日降順のみの
  // ため、読んだ分はここで並べ替える（Workerの口は数の直し以外触らない）。
  const orderedItems = useMemo(
    () => [...items].sort((a, b) => {
      if (a.isRead !== b.isRead) return a.isRead ? 1 : -1
      return b.createdAt.localeCompare(a.createdAt)
    }),
    [items],
  )
  const [counts, setCounts] = useState<NotificationCenterData['counts'] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // M037: 捕まえた一覧の読み込み失敗。403・429の言い分けと再試行の有無に使う。
  const [loadError, setLoadError] = useState<unknown>(null)
  // 一覧の失敗で帯に出した文。取り直しが通ったら同じ文だけ消す。
  const lastListFailure = useRef<string | null>(null)
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
      setLoadError(null)
      setLoading(false)
      return
    }
    setLoading(true)
    if (!append) {
      setError('')
      setLoadError(null)
    }
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
      // M037: 直ったので失敗の控えを消す。追加読み込みの失敗文も消える。
      setLoadError(null)
      if (!append) setError('')
      else setError((current) => current === lastListFailure.current ? '' : current)
    } catch (caught) {
      if (id !== requestId.current) return
      if (!append) {
        setItems([])
        setCounts(null)
      }
      // M037: 生の `API error: NNN` を出さず、原因どおりに言い分ける。
      const message = loadFailureNotice(caught, '通知')
      lastListFailure.current = message
      setLoadError(caught)
      setError(message)
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [accountLoading, filter, selectedAccountId])

  useEffect(() => { void load(0, false) }, [load])

  /*
   * 既読は取り消せる軽い操作なので、押した瞬間に画面へ反映して裏で
   * 保存する（★V7 sTJsh §1）。失敗したら未読へ戻してやり直せる
   * 知らせを出す。
   */
  const markRead = (item: NotificationCenterItem) => {
    if (!selectedAccountId) return
    if (item.isRead) return
    const accountId = selectedAccountId
    const apply = (isRead: boolean) => {
      setItems((current) => current.map((row) => (row.id === item.id ? { ...row, isRead } : row)))
      setCounts((current) =>
        current ? { ...current, unread: Math.max(0, current.unread + (isRead ? -1 : 1)) } : current,
      )
    }
    apply(true)
    runOptimistic({
      request: () => api.notifications.center.markRead(item.id, accountId),
      revert: () => apply(false),
      failureMessage: '通知を既読にできませんでした。',
      retry: () => markRead(item),
    })
  }

  const openNotification = (item: NotificationCenterItem) => {
    markRead(item)
    router.push(dashboardNotificationDestination(item))
  }

  const markAllRead = () => {
    if (!selectedAccountId || !counts || counts.unread === 0) return
    const accountId = selectedAccountId
    const beforeItems = items
    const beforeCounts = counts
    setItems((current) => current.map((row) => ({ ...row, isRead: true })))
    setCounts((current) => (current ? { ...current, unread: 0 } : current))
    runOptimistic({
      request: () => api.notifications.center.markAllRead(accountId, filter),
      revert: () => {
        setItems(beforeItems)
        setCounts(beforeCounts)
      },
      failureMessage: '通知をまとめて既読にできませんでした。',
      retry: markAllRead,
      onSuccess: () => void load(0, false),
    })
  }

  const filters: Array<{ id: DashboardNotificationFilter; label: string; count: number | null }> = [
    { id: 'all', label: 'すべて', count: counts?.all ?? null },
    { id: 'error', label: 'エラー', count: counts?.error ?? null },
    { id: 'update', label: 'アップデート', count: counts?.update ?? null },
  ]
  const total = counts ? (filter === 'error' ? counts.error : filter === 'update' ? counts.update : counts.all) : 0
  const hasMore = items.length < total
  // M037: 一覧自体が取れなかったときは空と混ぜない。共通の失敗の1枚にする。
  // 403は押しても直らないので再試行なし、429と通信失敗は同じ画面から取り直せる。
  const listFailed = loadError !== null && items.length === 0
  const listFailure = loadError !== null ? loadFailureCopy(loadError, '通知') : null

  /* ★V7: 画面側で狭い中央寄せをしない。中身の幅は共通の枠が持つ。 */
  return (
    <div className="space-y-4 v8-ro-notifications-page" data-design-node={theme === 'v8' ? 'y8QQV' : undefined}>
      {theme === 'v8' && <ReadonlyHeaderV8 title="通知" description="配信のエラーやアップデートのお知らせです。未読のお知らせから確認できます。" />}
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
            {theme === 'v8' && filter !== 'all' ? 'この分類をすべて既読にする' : 'すべて既読にする'}
          </Button>
          <Button variant="secondary" href="/line-notifications?tab=operator">
            通知設定
          </Button>
        </div>
      </div>

      {error && !listFailed ? (
        <Notice
          tone="danger"
          message={error}
          action={loadError !== null && listFailure?.retryable ? (
            <button type="button" onClick={() => void load(0, false)} className="shrink-0 font-medium underline">もう一度読み込む</button>
          ) : undefined}
        />
      ) : null}

      <Card overflow="hidden" className="v8-ro-notifications-noticeList">
        {listFailed ? (
          <ListState
            kind="error"
            error={loadError ?? undefined}
            onRetry={listFailure?.retryable ? () => void load(0, false) : undefined}
          />
        ) : items.length === 0 && !loading ? (
          <ListState
            kind="empty"
            title="通知はまだありません"
            description="お知らせが届くと、ここに並びます。"
          />
        ) : (
          <ul className="divide-hairline divide-y">
            {orderedItems.map((item) => (
              <li key={item.id} data-unread={!item.isRead}>
                <button
                  type="button"
                  onClick={() => openNotification(item)}
                  className="hover:bg-canvas-sunken flex w-full items-start gap-3 px-5 py-4 text-left"
                >
                  {item.category === 'error' ? (
                    <AlertTriangle aria-hidden="true" className="text-danger mt-0.5 h-4 w-4 shrink-0" />
                  ) : item.category === 'update' ? (
                    <Download aria-hidden="true" className="text-ink-faint mt-0.5 h-4 w-4 shrink-0" />
                  ) : null}
                  {item.isRead ? (
                    <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0" />
                  ) : (
                    <span aria-hidden="true" className="bg-action mt-1.5 h-2 w-2 shrink-0 rounded-pill" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className={item.isRead ? 'text-ink block truncate text-sm' : 'text-ink block truncate text-sm font-semibold'}>
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

      {theme === 'v8' && counts?.unread === 0 && !loading && !listFailed ? <p className="v8-ro-notifications-readNotice" role="status">未読のお知らせはありません。</p> : null}
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
