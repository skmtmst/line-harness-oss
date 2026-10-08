'use client'

/*
 * ★V8 通知（Pencil `y8QQV`）。ダッシュボードの通知パネルからの全件の行き先。
 *
 * 動き（呼ぶ API・既読・まとめて既読・さらに読み込む・失敗の扱い・URL の指定）は
 * 今の画面（app/notifications/page.tsx）と同じ。見た目だけを型（ListPage）と部品で組み直した。
 * 動きの一覧は同じ場所の BEHAVIOR.md。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { CheckCheck, Sparkles, TriangleAlert } from 'lucide-react'
import type { NotificationCenterData, NotificationCenterItem } from '@line-crm/shared'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import { ListPage } from '@/components/templates'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import ListState from '@/components/shared/list-state'
import { Tabs } from '@/components/shared/tabs'
import { STATE_TEXT } from '@/components/shared/not-connected'
import { loadFailureCopy, loadFailureNotice } from '@/components/shared/api-error-message'
import { runOptimistic } from '@/lib/undoable'
import {
  isDashboardNotificationData,
  notificationTime,
  type DashboardNotificationFilter,
} from '@/components/dashboard/notification-summary'
import { notificationDestination, notificationLinkLabel } from './destination'
import styles from './list.module.css'

const PAGE_SIZE = 50

export default function NotificationsV8() {
  usePageTitle('通知')
  const router = useRouter()
  const params = useSearchParams()
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const categoryParam = params.get('category')
  const filter: DashboardNotificationFilter =
    categoryParam === 'error' || categoryParam === 'update' ? categoryParam : 'all'
  const [items, setItems] = useState<NotificationCenterItem[]>([])
  // 未読が先・新しい順。口が作成日の新しい順で返すので、未読と既読に分けるだけ（それぞれの中は口の順のまま）。
  const orderedItems = useMemo(
    () => [...items.filter((row) => !row.isRead), ...items.filter((row) => row.isRead)],
    [items],
  )
  const [counts, setCounts] = useState<NotificationCenterData['counts'] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState<unknown>(null)
  const lastListFailure = useRef<string | null>(null)
  const requestId = useRef(0)
  const viewKeyRef = useRef('')

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
      setLoadError(null)
      if (!append) setError('')
      else setError((current) => current === lastListFailure.current ? '' : current)
    } catch (caught) {
      if (id !== requestId.current) return
      if (!append) {
        setItems([])
        setCounts(null)
      }
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
   * WEB071：既読の楽観更新の「戻す」「読み直す」は、押したときのアカウント・分類に結ぶ。
   * 失敗が届くまでに別のアカウントへ移っていたら、前の一覧・数で今の一覧を巻き戻さない。
   */
  viewKeyRef.current = `${selectedAccountId ?? ''}|${filter}`
  const sameView = (key: string) => viewKeyRef.current === key

  /* 既読は押した瞬間に画面へ反映し、裏で保存する。失敗したら未読へ戻してやり直せる知らせ。 */
  const markRead = (item: NotificationCenterItem) => {
    if (!selectedAccountId || item.isRead) return
    const accountId = selectedAccountId
    const accountKey = `${accountId}|`
    const apply = (isRead: boolean) => {
      if (!viewKeyRef.current.startsWith(accountKey)) return
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
    router.push(notificationDestination(item))
  }

  const markAllRead = () => {
    if (!selectedAccountId || !counts || counts.unread === 0) return
    const accountId = selectedAccountId
    const viewKey = viewKeyRef.current
    const beforeItems = items
    const beforeCounts = counts
    setItems((current) => current.map((row) => ({ ...row, isRead: true })))
    setCounts((current) => (current ? { ...current, unread: 0 } : current))
    runOptimistic({
      request: () => api.notifications.center.markAllRead(accountId, filter),
      revert: () => {
        if (!sameView(viewKey)) return
        setItems(beforeItems)
        setCounts(beforeCounts)
      },
      failureMessage: '通知をまとめて既読にできませんでした。',
      retry: markAllRead,
      onSuccess: () => { if (sameView(viewKey)) void load(0, false) },
    })
  }

  const filters: Array<{ id: DashboardNotificationFilter; label: string; count: number | null }> = [
    { id: 'all', label: 'すべて', count: counts?.all ?? null },
    { id: 'error', label: 'エラー', count: counts?.error ?? null },
    { id: 'update', label: 'アップデート', count: counts?.update ?? null },
  ]
  const total = counts ? (filter === 'error' ? counts.error : filter === 'update' ? counts.update : counts.all) : 0
  const hasMore = items.length < total
  const listFailed = loadError !== null && items.length === 0
  const listFailure = loadError !== null ? loadFailureCopy(loadError, '通知') : null

  return (
    <ListPage
      boardId="y8QQV"
      title="通知"
      description="musubo からのお知らせです。エラーやメンテナンス、新しい版のお知らせが届きます。"
      actions={(
        <Button variant="secondary" onClick={() => { void markAllRead() }} disabled={!counts || counts.unread === 0}>
          <CheckCheck aria-hidden="true" className={styles.buttonIcon} />
          {filter !== 'all' ? 'この分類をすべて既読にする' : 'すべて既読にする'}
        </Button>
      )}
    >
      <div className={styles.body}>
        <Tabs
          className={styles.tabs}
          label="通知の種類"
          items={filters.map((entry) => ({
            // 絵は「すべて 6」を1つの文字で描く。数が取れないうちは名前だけ。
            label: entry.count === null ? entry.label : `${entry.label} ${entry.count}`,
            current: filter === entry.id,
            onClick: () => selectFilter(entry.id),
          }))}
        />

        {error && !listFailed ? (
          <Notice
            tone="danger"
            message={error}
            action={loadError !== null && listFailure?.retryable ? (
              <button type="button" onClick={() => void load(0, false)} className={styles.retry}>もう一度読み込む</button>
            ) : undefined}
          />
        ) : null}

        <div className={styles.box}>
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
            <ul className={styles.list}>
              {orderedItems.map((item) => (
                <li key={item.id} className={styles.item} data-unread={!item.isRead}>
                  <button
                    type="button"
                    className={styles.row}
                    onClick={() => openNotification(item)}
                    title={item.body || undefined}
                  >
                    <span className={styles.icon} data-category={item.category} aria-hidden="true">
                      {item.category === 'error' ? <TriangleAlert /> : <Sparkles />}
                    </span>
                    <span className={styles.text}>
                      <span className={styles.titleLine}>
                        <span className={styles.title}>{item.title}</span>
                        {!item.isRead ? <span className={styles.dot} aria-hidden="true" /> : null}
                        {!item.isRead ? <span className="sr-only">（未読）</span> : null}
                      </span>
                      <span className={styles.time}>{notificationTime(item.createdAt)}</span>
                    </span>
                    <span className={styles.go}>{`${notificationLinkLabel(item)} →`}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {loading ? <p className={styles.loading}>{STATE_TEXT.loading}…</p> : null}
        </div>

        <div className={styles.foot}>
          <p className={styles.note}>
            {counts?.unread === 0 && !loading && !listFailed
              ? '未読のお知らせはありません。'
              : '未読は青い点と太字。押すと既読になり、行の右から関係する画面へ移れます'}
          </p>
          <Link href="/line-notifications?tab=operator" className={styles.settingsLink}>通知設定</Link>
        </div>

        {hasMore ? (
          <div className={styles.more}>
            <Button variant="secondary" onClick={() => { void load(items.length, true) }} disabled={loading}>
              さらに読み込む（残り {total - items.length} 件）
            </Button>
          </div>
        ) : null}
      </div>
    </ListPage>
  )
}
