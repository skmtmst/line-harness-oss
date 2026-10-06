'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { Info, MoreHorizontal, X } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ApiError, api, fetchApi } from '@/lib/api'
import { isPoolsFeatureAvailable } from '@/lib/pools-availability'
import { useAccount } from '@/contexts/account-context'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import TargetMissing from '@/components/shared/target-missing'
import EditRouteModal from '../_components/edit-route-modal'
import RefOrdersPanel, { type RefOrdersResult } from '../_components/ref-orders'
import ReferralQrModal from '../referral-qr-modal'
import Select from '@/components/shared/select'
import SearchField from '@/components/shared/search-field'
import PageSizeSelect from '@/components/ui/page-size-select'
import FilterChip from '@/components/shared/filter-chip'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import Pagination from '@/components/shared/pagination'
import { TableHeadRow, Th } from '@/components/shared/table'
import { useOverlayFocus } from '@/components/shared/overlay-utils'
import styles from './inflow-detail-v8.module.css'
import type {
  ApiResponse,
  EntryRoute,
  EntryRouteFunnel,
  Scenario,
  Tag,
  TrafficPool,
} from '@line-crm/shared'
import { useAdminTheme } from '@/lib/use-admin-theme'
import { formatNumber } from '@/lib/format'

/** 選んだ流入元の人数、成果、友だち、追加時の動きをまとめて表示する。 */

interface MessageTemplate {
  id: string
  name: string
  messageType: string
  messageContent: string
}

interface AttributedFriend {
  id: string
  displayName: string
  trackedAt: string | null
  // #514-8: 口が返すのは currentStatus(いまの状態)だけ。はじめて見た
  // ページ・成果・マイルの集計口は無いので、無い欄は「—」にする。
  firstPage?: string
  currentStatus?: string
  conversion?: string
  miles?: number
}

function InflowLinkDetailPageContent() {
  const theme = useAdminTheme()
  const router = useRouter()
  const searchParams = useSearchParams()
  const id = searchParams.get('id') ?? ''
  const requestedRefCode = searchParams.get('ref') ?? ''

  const [routes, setRoutes] = useState<EntryRoute[]>([])
  const [route, setRoute] = useState<EntryRoute | null>(null)
  const [funnel, setFunnel] = useState<EntryRouteFunnel | null>(null)
  // #514-12: 段階の取得失敗を読込中と混ぜない。失敗したら文と再読み込みを出す。
  const [funnelError, setFunnelError] = useState(false)
  const [funnelAttempt, setFunnelAttempt] = useState(0)
  const [friends, setFriends] = useState<AttributedFriend[]>([])
  // IDEA-18: 購入・返金のカード値は注文明細パネルが取った集計と同じ値を使う
  // （集計と明細が同じ条件であることを画面内で一致させる）。未取得は null。
  const [ordersSummary, setOrdersSummary] = useState<RefOrdersResult | null>(null)
  const [tags, setTags] = useState<Tag[]>([])
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [pools, setPools] = useState<TrafficPool[]>([])
  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  // #514-13: 「この経路を編集」は編集窓を開く(押しても何も起きない状態を直す)。
  const [editingRoute, setEditingRoute] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  /** 右の内訳を取りに行っている間。 */
  const [routeLoading, setRouteLoading] = useState(false)
  /** 404・空で見つからないとき。取得の失敗（error）とは分ける。 */
  const [routeMissing, setRouteMissing] = useState(false)
  const [copied, setCopied] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [deleteChoice, setDeleteChoice] = useState<'stop' | 'redirect' | 'delete'>('stop')
  const [deleteConfirmationName, setDeleteConfirmationName] = useState('')
  const [canPermanentlyDelete, setCanPermanentlyDelete] = useState(false)
  // 「別の流入リンクへ送る」の転送先。先頭を自動採用しない（#514 重大4）。
  const [redirectTargetId, setRedirectTargetId] = useState('')
  const deleteDialogRef = useOverlayFocus(
    deleteOpen,
    () => setDeleteOpen(false),
    deleting,
  )
  const selectedId =
    id || routes.find((entryRoute) => entryRoute.refCode === requestedRefCode)?.id || ''

  // 左のリンク一覧。流入件数を添えるので、集計も一緒に引く。
  useEffect(() => {
    let cancelled = false
    // プールは補助データ。機能がオフでもリンク詳細画面そのものは止めない。
    // 403 の応答自体が console error になるため、有効と分からない限り
    // 口を発行しない（#703）。
    const poolsRequest: Promise<ApiResponse<TrafficPool[]>> = isPoolsFeatureAvailable().then((ok) =>
      ok
        ? api.pools.list({ suppressFeatureDisabledEvent: true })
        : { success: false as const, error: 'feature_disabled' },
    )
    void Promise.allSettled([
      api.entryRoutes.list(),
      poolsRequest,
      api.staff.me(),
    ]).then(([r, p, me]) => {
      if (cancelled) return
      if (r.status === 'fulfilled' && r.value.success) setRoutes(r.value.data)
      if (p.status === 'fulfilled' && p.value.success) setPools(p.value.data)
      if (me.status === 'fulfilled' && me.value.success) {
        setCanPermanentlyDelete(me.value.data.role === 'owner' || me.value.data.role === 'admin')
      }
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  /*
   * R23横展開: 名前の解決・編集窓の候補は、この経路のアカウントだけ。
   * 経路が変わったら取り直す。別アカウントの同名タグ混入防止。
   */
  const routeAccountId = route?.lineAccountId ?? null
  useEffect(() => {
    let cancelled = false
    if (!route) return () => { cancelled = true }
    const accountParams = routeAccountId ? { accountId: routeAccountId } : undefined
    void Promise.allSettled([
      api.tags.list(accountParams),
      api.scenarios.list(accountParams),
      // 編集窓の「追加直後に送るメッセージ」選択肢に使う。
      api.templates.list(undefined, routeAccountId ?? undefined),
    ]).then(([t, sc, tp]) => {
      if (cancelled) return
      if (t.status === 'fulfilled' && t.value.success) setTags(t.value.data)
      if (sc.status === 'fulfilled' && sc.value.success) setScenarios(sc.value.data)
      if (tp.status === 'fulfilled' && tp.value.success) {
        setTemplates(tp.value.data as unknown as MessageTemplate[])
      }
    })
    return () => {
      cancelled = true
    }
  }, [route, routeAccountId])

  // 右の内訳。リンクを選び直すたびに引き直す。
  useEffect(() => {
    if (!selectedId) {
      setRoute(null)
      setFunnel(null)
      setFunnelError(false)
      setFriends([])
      setOrdersSummary(null)
      setRouteMissing(false)
      setError('')
      return
    }
    let cancelled = false
    setError('')
    setRouteMissing(false)
    setRouteLoading(true)
    // #514-12: 段階の失敗を読込中のままにしない。再読み込みは funnelAttempt で引き直す。
    setFunnel(null)
    setFunnelError(false)
    setOrdersSummary(null)
    void Promise.allSettled([
      api.entryRoutes.get(selectedId),
      api.entryRoutes.funnel(selectedId),
    ]).then(async ([r, f]) => {
      if (cancelled) return
      if (r.status === 'fulfilled' && r.value.success) {
        setRoute(r.value.data)
        try {
          const result = await fetchApi<{
            success: boolean
            data: { friends: AttributedFriend[] }
          }>(`/api/analytics/ref/${encodeURIComponent(r.value.data.refCode)}`)
          if (!cancelled && result.success && Array.isArray(result.data?.friends)) {
            setFriends(result.data.friends)
          }
        } catch {
          if (!cancelled) setFriends([])
        }
      } else if (r.status === 'rejected' && r.reason instanceof ApiError && r.reason.status === 404) {
        setRouteMissing(true)
      } else setError('リンクの取得に失敗しました。もう一度読み込んでください。')
      if (f.status === 'fulfilled' && f.value.success) setFunnel(f.value.data)
      else if (!cancelled) setFunnelError(true)
      if (!cancelled) setRouteLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [selectedId, funnelAttempt])

  const workerBase = process.env.NEXT_PUBLIC_API_URL ?? ''
  const url = route ? `${workerBase}/r/${encodeURIComponent(route.refCode)}` : null

  /** コピーできなかったとき、選んでコピーできる欄をその場に出す（ブラウザの入力窓は使わない。V6R-S3-f）。 */
  const [copyFailed, setCopyFailed] = useState(false)
  const { accounts = [] } = useAccount()
  // 板 Q5le3 の操作の口。
  const [qrOpen, setQrOpen] = useState(false)
  const [showOrders, setShowOrders] = useState(false)
  const [afterMenuOpen, setAfterMenuOpen] = useState(false)
  const [openFriendMenuId, setOpenFriendMenuId] = useState<string | null>(null)
  const [friendSearch, setFriendSearch] = useState('')
  const [friendChip, setFriendChip] = useState<'all' | 'month' | 'blocked' | 'converted'>('all')
  const [friendPeriod, setFriendPeriod] = useState<'all' | 'this' | 'last'>('all')
  const [friendPage, setFriendPage] = useState(1)
  const [friendPageSize, setFriendPageSize] = useState(20)

  async function copyUrl() {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setCopyFailed(false)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopyFailed(true)
    }
  }

  async function applyDeleteChoice() {
    if (!route || deleting) return
    if (deleteChoice === 'delete' && !canPermanentlyDelete) {
      setDeleteChoice('stop')
      setDeleteError('完全削除には管理者権限が必要です。受付停止を選んでください。')
      return
    }
    setDeleting(true)
    setDeleteError('')
    try {
      if (deleteChoice === 'redirect') {
        // 転送先は必ず利用者に選ばせる。選ばずに進ませない。
        const redirectTarget = routes.find((candidate) => candidate.id === redirectTargetId && candidate.id !== route.id)
        if (!redirectTarget) {
          setDeleteError('転送先のリンクを選んでください')
          return
        }
        const result = await api.entryRoutes.update(route.id, {
          redirectUrl: `${workerBase}/r/${encodeURIComponent(redirectTarget.refCode)}`,
        })
        if (!result.success) throw new Error(result.error)
      } else {
        const result = deleteChoice === 'delete'
          ? await fetchApi<{ success: boolean; error?: string }>(`/api/entry-routes/${encodeURIComponent(route.id)}`, {
              method: 'DELETE',
              body: JSON.stringify({ confirmationName: deleteConfirmationName }),
            })
          : await api.entryRoutes.update(route.id, { isActive: false })
        if (!result.success) throw new Error(result.error)
      }
      setDeleteOpen(false)
      router.replace('/inflow-links')
    } catch (cause) {
      setDeleteError(cause instanceof ApiError && (
        cause.code === 'ENTRY_ROUTE_IN_USE'
        || cause.code === 'ENTRY_ROUTE_NAME_CONFIRMATION_MISMATCH'
      )
        ? cause.message
        : '選んだ処理を完了できませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setDeleting(false)
    }
  }

  const tagName = route?.tagId ? (tags.find((t) => t.id === route.tagId)?.name ?? null) : null
  const scenarioName = route?.scenarioId
    ? (scenarios.find((s) => s.id === route.scenarioId)?.name ?? null)
    : null
  const poolName = route?.poolId ? (pools.find((p) => p.id === route.poolId)?.name ?? null) : null
  // R269: 追加直後に送るメッセージも実際の設定から組み立てる。口に
  // マイル付与の欄は無いので、設計見本の値は実動作として出さない。
  const introTemplateName = route?.introTemplateId
    ? (templates.find((t) => t.id === route.introTemplateId)?.name ?? null)
    : null

  const addRate = useMemo(() => {
    if (!funnel || funnel.click_count === 0) return null
    return Math.round((funnel.friend_add_count / funnel.click_count) * 1000) / 10
  }, [funnel])

  // 板 Q5le3 の月別の数。trackedAt（来た日時）から今月・先月に分ける。
  const monthKeyOf = (iso: string | null): string | null => {
    if (!iso) return null
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return null
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }
  const nowDate = new Date(Date.now() + 9 * 60 * 60_000)
  const thisMonthKey = nowDate.toISOString().slice(0, 7)
  const lastMonthDate = new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth() - 1, 1))
  const lastMonthKey = lastMonthDate.toISOString().slice(0, 7)
  const isBlockedFriend = (friend: AttributedFriend) => (friend.currentStatus ?? '').includes('ブロック')
  const monthFriends = friends.filter((friend) => monthKeyOf(friend.trackedAt) === thisMonthKey)
  const lastMonthFriends = friends.filter((friend) => monthKeyOf(friend.trackedAt) === lastMonthKey)
  const blockedFriends = friends.filter(isBlockedFriend)
  const convertedFriends = friends.filter((friend) => !!friend.conversion)
  const monthTotal = funnel?.monthly?.find((m) => m.month === thisMonthKey)?.friendAddCount ?? (funnel?.monthly ? 0 : null)
  const previousMonthTotal = funnel?.monthly?.find((m) => m.month === lastMonthKey)?.friendAddCount ?? (funnel?.monthly ? 0 : null)
  const monthDelta = monthTotal != null && previousMonthTotal != null ? monthTotal - previousMonthTotal : null
  const blockRate = funnel && funnel.friend_add_count > 0 && funnel.blockedCount != null
    ? Math.round((funnel.blockedCount / funnel.friend_add_count) * 100)
    : null

  const accountName = route?.lineAccountId
    ? (accounts.find((account) => account.id === route.lineAccountId)?.name ?? route.lineAccountId)
    : '—'
  const createdDate = route
    ? `${Number(route.createdAt.slice(5, 7))}月${Number(route.createdAt.slice(8, 10))}日`
    : ''
  const yen = (amount: number | null | undefined) =>
    amount == null ? '—' : `¥${formatNumber(amount)}`

  // 友だち表の絞り込み。検索・札・期間の3つを重ねる。
  const normalizedFriendSearch = friendSearch.trim().toLocaleLowerCase('ja')
  const friendRows = friends.filter((friend) => {
    if (normalizedFriendSearch && !friend.displayName.toLocaleLowerCase('ja').includes(normalizedFriendSearch)) return false
    if (friendChip === 'month' && monthKeyOf(friend.trackedAt) !== thisMonthKey) return false
    if (friendChip === 'blocked' && !isBlockedFriend(friend)) return false
    if (friendChip === 'converted' && !friend.conversion) return false
    if (friendPeriod === 'this' && monthKeyOf(friend.trackedAt) !== thisMonthKey) return false
    if (friendPeriod === 'last' && monthKeyOf(friend.trackedAt) !== lastMonthKey) return false
    return true
  })
  const friendPageCount = Math.max(1, Math.ceil(friendRows.length / friendPageSize))
  const friendPageRows = friendRows.slice((friendPage - 1) * friendPageSize, friendPage * friendPageSize)
  const resetFriendPage = () => setFriendPage(1)

  // 削除の窓を開く。板の頭の「…」と青い帯の「止める」から、選ぶ内容だけ変える。
  const openDelete = (choice: 'stop' | 'redirect' | 'delete') => {
    setDeleteError('')
    setDeleteChoice(choice)
    setDeleteConfirmationName('')
    setRedirectTargetId('')
    setAfterMenuOpen(false)
    setDeleteOpen(true)
  }

  // 受付を再開する（止まっているときの青い帯）。
  const reopenRoute = async () => {
    if (!route) return
    try {
      const res = await api.entryRoutes.update(route.id, { isActive: true })
      if (res.success) setRoute({ ...route, isActive: true })
    } catch {
      // 失敗しても画面はそのまま。止まったままなのが分かる。
    }
  }

  const afterMenuItems: ActionMenuItem[] = route ? [
    {
      id: 'stop',
      label: '受付を止める',
      onSelect: () => openDelete('stop'),
    },
    {
      id: 'redirect',
      label: '別リンクへ送る',
      onSelect: () => openDelete('redirect'),
    },
    {
      id: 'delete',
      label: '削除する',
      tone: 'danger' as const,
      onSelect: () => openDelete('delete'),
    },
  ] : []

  if (!selectedId) {
    return (
      <TargetMissing
        kind="unspecified"
        title="見る流入経路が指定されていません"
        description="一覧から、見たい流入経路を選び直してください。"
        backHref="/inflow-links"
        backLabel="流入経路の一覧へ戻る"
      />
    )
  }

  if (error) {
    return (
      <TargetMissing
        kind="error"
        title="流入経路を読み込めませんでした"
        description="通信が切れたか、サーバが応えませんでした。しばらくしてから、もう一度読み込んでください。"
        onRetry={() => setFunnelAttempt((n) => n + 1)}
      />
    )
  }

  if (routeMissing || (!loading && !routeLoading && !route)) {
    return (
      <TargetMissing
        kind="not-found"
        title="この流入経路は見つかりません"
        description="削除されたか、リンクが古くなっています。一覧から選び直してください。"
        backHref="/inflow-links"
        backLabel="流入経路の一覧へ戻る"
      />
    )
  }

  const happenParts: string[] = []
  if (tagName) happenParts.push(`タグ「${tagName}」を付けて`)
  if (scenarioName) happenParts.push(`シナリオ「${scenarioName}」を始めて`)
  if (introTemplateName) happenParts.push(`メッセージ「${introTemplateName}」を送ります`)
  const happenTitle = happenParts.length > 0
    ? `友だちになったとき：${happenParts.join('、')}`
    : '友だちになったときの動きは、まだ何も決めていません'
  const qrDownloadUrl = route && url
    ? `${workerBase.replace(/\/$/, '')}/api/qr?size=320x320&data=${encodeURIComponent(url)}&download=1&filename=${encodeURIComponent(`referral-${route.refCode}`)}`
    : null

  return (
    <div data-design-node="Q5le3" data-design="Body" className={styles.board}>
      <nav data-design="Crumb" aria-label="パンくず">
        <Link href="/inflow-links" className={styles.backLink}>
          ← 流入と計測へ
        </Link>
      </nav>

      {!route ? (
        <div className="rounded-card border border-hairline bg-canvas p-12 text-center text-sm text-ink-faint">
          読み込み中…
        </div>
      ) : <>
        <div data-design="Head" className={styles.head}>
          <div className="min-w-0">
            <h2 className={styles.title}>{route.name}</h2>
            <p className={styles.sub}>
              {route.genre || '未分類'}・{url}・{accountName}・作った日 {createdDate}
            </p>
          </div>
          <div className={styles.headActions}>
            <Button variant="secondary" onClick={() => setQrOpen(true)}>QRコードを表示</Button>
            <Button variant="secondary" onClick={() => void copyUrl()}>{copied ? 'コピーしました' : 'URLをコピー'}</Button>
            <Button variant="secondary" onClick={() => setEditingRoute(true)}>リンクを編集</Button>
          </div>
        </div>
        {copyFailed && url && (
          <div role="alert" className="mb-4 space-y-2 rounded-control border border-hairline bg-canvas-sunken p-3 text-sm text-ink-secondary">
            <p>コピーできませんでした。下の欄を選んでコピーしてください。</p>
            <input
              readOnly
              autoFocus
              value={url}
              aria-label="流入経路のURL"
              onFocus={(e) => e.currentTarget.select()}
              className="w-full rounded-control border border-hairline bg-canvas px-3 py-2 font-mono text-xs"
            />
          </div>
        )}
        {/*
          板 Q5le3 の数の帯。左の2枚は月で分けられる実績（来た日時を持つ）、
          累計・成果は funnel の累計。ブロックは状態が分かる行だけ数える。
        */}
        <div className={styles.band} role="group" aria-label={`${route.name}の概要`}>
          <div className={styles.tile}>
            <div className={styles.tileTitle}>今月友だちになった</div>
            <div className={styles.tileValue}>
              {monthTotal == null ? '—' : formatNumber(monthTotal)}
              <span className={styles.tileUnit}>人</span>
            </div>
            <div className={styles.tileSub}>
              先月より {monthDelta == null ? '—' : `${monthDelta >= 0 ? '+' : ''}${formatNumber(monthDelta)}`}
            </div>
          </div>
          <div className={styles.tile}>
            <div className={styles.tileTitle}>累計</div>
            <div className={styles.tileValue}>
              {funnel ? formatNumber(funnel.friend_add_count) : '—'}
              <span className={styles.tileUnit}>人</span>
            </div>
            <div className={styles.tileSub}>{createdDate}から{theme === 'v8' && <>・いま残っている {funnel?.remainingCount == null ? '—' : formatNumber(funnel.remainingCount)}人</>}</div>
          </div>
          <div className={styles.tile}>
            <div className={styles.tileTitle}>ブロック</div>
            <div className={styles.tileValue}>
              {funnel?.blockedCount == null ? '—' : formatNumber(funnel.blockedCount)}
              <span className={styles.tileUnit}>人</span>
            </div>
            <div className={styles.tileSub}>
              {blockRate == null ? '割合は集計できません' : `友だちになった人の ${blockRate}%`}
            </div>
          </div>
          <div className={styles.tile}>
            <div className={styles.tileTitle}>成果（コンバージョン）</div>
            <div className={styles.tileValue}>
              {funnel ? formatNumber(funnel.cv_count) : '—'}
              <span className={styles.tileUnit}>件</span>
            </div>
            <div className={styles.tileSub}>累計{theme === 'v8' && <>・1人あたり {funnel?.valuePerFriend == null ? '—' : yen(Math.round(funnel.valuePerFriend))}</>}</div>
          </div>
        </div>

        <div data-design="Left">
          <section className={styles.afterCard} aria-label="その後（この経路から来た人）">
            <div className={styles.afterHead}>
              <h2 className={styles.afterTitle}>その後（この経路から来た人）</h2>
              <div className={styles.moreCell}>
                <button
                  type="button"
                  className={styles.moreButton}
                  title="板の頭の操作（受付を止める・別リンクへ送る・削除する）"
                  aria-label="板の頭の操作（受付を止める・別リンクへ送る・削除する）"
                  aria-expanded={afterMenuOpen}
                  onClick={() => setAfterMenuOpen((current) => !current)}
                >
                  <MoreHorizontal size={16} aria-hidden="true" />
                </button>
                <ActionMenu
                  open={afterMenuOpen}
                  onClose={() => setAfterMenuOpen(false)}
                  ariaLabel="板の頭の操作"
                  items={afterMenuItems}
                />
              </div>
            </div>
            {funnel ? (
              <div className={styles.miniGrid}>
                <div className={styles.mini}>
                  <div className={styles.miniTitle}>クリック</div>
                  <div className={styles.miniValue}>{formatNumber(funnel.click_count)}</div>
                </div>
                <div className={styles.mini}>
                  <div className={styles.miniTitle}>友だち追加</div>
                  <div className={styles.miniValue}>{formatNumber(funnel.friend_add_count)}</div>
                  <div className={styles.miniSub}>追加率 {addRate ?? '—'}%</div>
                </div>
                <div className={styles.mini}>
                  <div className={styles.miniTitle}>フォーム</div>
                  <div className={styles.miniValue}>{formatNumber(funnel.form_submission_count)}</div>
                </div>
                <div className={styles.mini}>
                  <div className={styles.miniTitle}>購入</div>
                  <div className={styles.miniValue}>{ordersSummary ? formatNumber(ordersSummary.total) : '—'}</div>
                  <div className={styles.miniSub}>{ordersSummary ? yen(ordersSummary.totalAmount) : '集計を取得できていません'}</div>
                </div>
                <div className={styles.mini}>
                  <div className={styles.miniTitle}>返金・取消</div>
                  <div className={styles.miniValue}>
                    {ordersSummary ? formatNumber(ordersSummary.refunded + ordersSummary.cancelled) : '—'}
                  </div>
                  <div className={styles.miniSub}>
                    {ordersSummary
                      ? (ordersSummary.refundedAmount == null
                        ? '—'
                        : `-${yen(ordersSummary.refundedAmount)}`)
                      : '集計を取得できていません'}
                  </div>
                </div>
              </div>
            ) : funnelError ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-ink-secondary">段階を取得できませんでした。集計データは消えていません。</p>
                <Button variant="secondary" onClick={() => setFunnelAttempt((n) => n + 1)}>段階を再読み込み</Button>
              </div>
            ) : (
              <p className="mt-3 text-xs text-ink-faint">読み込み中…</p>
            )}
            {theme === 'v8' && funnel?.monthly && (
              <section aria-label="月別内訳">
                <h3 className={styles.ordersTitle}>月別内訳（友だちになった月）</h3>
                <table className="w-full text-sm">
                  <thead><TableHeadRow><Th>月</Th><Th>友だち追加</Th><Th>いま残っている</Th><Th>ブロック</Th><Th>成果</Th><Th>金額</Th></TableHeadRow></thead>
                  <tbody>{funnel.monthly.map((month) => <tr key={month.month}>
                    <td>{month.month}</td><td>{formatNumber(month.friendAddCount)}人</td>
                    <td>{formatNumber(month.remainingCount)}人</td><td>{formatNumber(month.blockedCount)}人</td>
                    <td>{formatNumber(month.conversionCount)}件</td><td>{yen(month.conversionValueSum)}</td>
                  </tr>)}</tbody>
                </table>
              </section>
            )}
            <div className={styles.ordersRow}>
              <h3 className={styles.ordersTitle}>
                注文の明細 {ordersSummary ? formatNumber(ordersSummary.total) : '—'}件
              </h3>
              <Button variant="secondary" onClick={() => setShowOrders((current) => !current)} aria-expanded={showOrders}>
                注文を見る
              </Button>
            </div>
            {showOrders && route ? (
              <div className={styles.ordersPanel}>
                <RefOrdersPanel refCode={route.refCode} onSummaryChange={setOrdersSummary} />
              </div>
            ) : null}
          </section>

          <div className={styles.happenBand}>
            <span className={styles.happenIcon} aria-hidden="true"><Info size={16} /></span>
            <div className={styles.happenText}>
              <p className={styles.happenTitle}>{happenTitle}</p>
              <p className={styles.happenSub}>
                何も決めないと「動きが未設定」になります。変えると、これから友だちになる人に効きます（もういる人には効きません）
              </p>
            </div>
            <div className={styles.happenActions}>
              {route.isActive ? (
                <Button variant="secondary" onClick={() => openDelete('stop')}>止める</Button>
              ) : (
                <Button variant="secondary" onClick={() => void reopenRoute()}>受付を再開する</Button>
              )}
              <Button variant="primary" onClick={() => setEditingRoute(true)}>
                {happenParts.length > 0 ? 'することを変える' : 'ことを決める'}
              </Button>
            </div>
          </div>

          <section aria-label="この経路から来た友だち">
            <h2 className="sr-only">この経路から来た友だち</h2>
            <div className={styles.friendTools}>
              <div className={styles.friendSearch}>
                <SearchField
                  aria-label="友だちの名前で探す"
                  placeholder="友だちの名前で探す"
                  value={friendSearch}
                  onChange={(value) => {
                    setFriendSearch(value)
                    resetFriendPage()
                  }}
                />
              </div>
              {([
                ['all', `すべて ${friends.length}`, friends.length],
                ['month', `今月 ${monthFriends.length}`, monthFriends.length],
                ['blocked', `ブロック ${blockedFriends.length}`, blockedFriends.length],
                ['converted', `成果あり ${convertedFriends.length}`, convertedFriends.length],
              ] as Array<['all' | 'month' | 'blocked' | 'converted', string, number]>).map(([value, label, total]) => (
                <FilterChip
                  key={value}
                  selected={friendChip === value}
                  count={total}
                  onChange={() => {
                    setFriendChip(friendChip === value && value !== 'all' ? 'all' : value)
                    resetFriendPage()
                  }}
                >
                  {label}
                </FilterChip>
              ))}
              <div className={styles.friendRight}>
                <Select
                  aria-label="期間"
                  value={friendPeriod}
                  options={[
                    { value: 'all', label: 'すべて' },
                    { value: 'this', label: '今月' },
                    { value: 'last', label: '先月' },
                  ]}
                  onChange={(value) => {
                    setFriendPeriod(value as 'all' | 'this' | 'last')
                    resetFriendPage()
                  }}
                />
                <PageSizeSelect
                  value={friendPageSize}
                  options={[10, 20, 50]}
                  onChange={(value) => {
                    setFriendPageSize(value)
                    resetFriendPage()
                  }}
                  aria-label="表示件数"
                />
              </div>
            </div>
            {friendRows.length === 0 ? (
              <p className="mt-3 text-xs text-ink-faint">
                {friends.length > 0
                  ? '条件に合う友だちがいません。検索や絞り込みを変えてください。'
                  : 'この経路から来た友だちは、まだ記録されていません。'}
              </p>
            ) : (
              <div className={`${styles.tableShell} mt-3`} data-scroll-x style={{ '--scroll-min': '900px' } as CSSProperties}>
                <table>
                  <thead>
                    <TableHeadRow>
                      <Th>日時</Th>
                      <Th>友だち</Th>
                      <Th>入ったLINEアカウント</Th>
                      <Th>今の状態</Th>
                      <Th>付いたタグ・その後</Th>
                      <Th align="right">成果</Th>
                      <Th aria-label="操作"><span className="sr-only">操作</span></Th>
                    </TableHeadRow>
                  </thead>
                  <tbody className="divide-y divide-hairline">
                    {friendPageRows.map((friend) => {
                      const blocked = isBlockedFriend(friend)
                      return (
                        <tr key={friend.id} className="hover:bg-canvas-sunken">
                          <td className="whitespace-nowrap px-3 py-3 text-ink-faint">
                            {friend.trackedAt ? friend.trackedAt.slice(5, 16).replace('T', ' ').replaceAll('-', '/') : '日時不明'}
                          </td>
                          <td className="px-3 py-3">
                            <span className={styles.friendCell}>
                              <span className={styles.avatar} aria-hidden="true">
                                {friend.displayName.slice(0, 1)}
                              </span>
                              <Link
                                href={`/friends/detail?id=${encodeURIComponent(friend.id)}`}
                                className={styles.friendName}
                                title={friend.displayName}
                              >
                                {friend.displayName}
                              </Link>
                            </span>
                          </td>
                          <td className="px-3 py-3 text-ink-secondary">
                            <span className="block truncate whitespace-nowrap" title={accountName}>{accountName}</span>
                          </td>
                          <td className="px-3 py-3">
                            {blocked ? (
                              <span className={`${styles.stateChip} ${styles.stateBlocked}`}>
                                <span className={styles.stateDot} aria-hidden="true" />
                                ブロック
                              </span>
                            ) : friend.currentStatus === '友だち中' ? (
                              <span className={`${styles.stateChip} ${styles.stateFriend}`}>
                                <span className={styles.stateDot} aria-hidden="true" />
                                友だち
                              </span>
                            ) : (
                              <span className="text-ink-secondary">{friend.currentStatus ?? '—'}</span>
                            )}
                          </td>
                          <td className="px-3 py-3 text-ink-secondary">
                            <span className="block truncate whitespace-nowrap">
                              {tagName ? `タグ「${tagName}」` : '—'}
                            </span>
                            <span className="block truncate whitespace-nowrap text-xs">
                              {friend.conversion ?? '—'}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 text-right text-ink-secondary">
                            {friend.conversion ?? '—'}
                          </td>
                          <td className={`px-3 py-3 ${styles.moreCell}`}>
                            <button
                              type="button"
                              className={styles.moreButton}
                              title={`「${friend.displayName}」の操作`}
                              aria-label={`「${friend.displayName}」の操作`}
                              aria-expanded={openFriendMenuId === friend.id}
                              onClick={() => setOpenFriendMenuId((current) => (current === friend.id ? null : friend.id))}
                            >
                              <MoreHorizontal size={16} aria-hidden="true" />
                            </button>
                            <ActionMenu
                              open={openFriendMenuId === friend.id}
                              onClose={() => setOpenFriendMenuId(null)}
                              ariaLabel={`「${friend.displayName}」の操作`}
                              items={[
                                {
                                  id: 'view',
                                  label: '友だちを見る',
                                  onSelect: () => {
                                    setOpenFriendMenuId(null)
                                    router.push(`/friends/detail?id=${encodeURIComponent(friend.id)}`)
                                  },
                                },
                                {
                                  id: 'chat',
                                  label: 'チャットを開く',
                                  onSelect: () => {
                                    setOpenFriendMenuId(null)
                                    router.push(`/chats?friend=${encodeURIComponent(friend.id)}`)
                                  },
                                },
                              ]}
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className={`${styles.pager} mt-3`}>
              <span className="tabular-nums">
                {friendRows.length}人中 {friendRows.length === 0 ? 0 : (friendPage - 1) * friendPageSize + 1}〜
                {Math.min(friendPage * friendPageSize, friendRows.length)}人
              </span>
              <Pagination page={friendPage} pageCount={friendPageCount} onPageChange={setFriendPage} />
            </div>
          </section>
        </div>

        <div data-design="Right" className={styles.bottomGrid}>
          <section className={styles.linkCard} aria-label="この経路のつながる先">
            <h2 className={styles.linkCardTitle}>この経路のつながる先</h2>
            <div className={styles.linkRow}>
              <span>コンバージョン</span>
              <span className={styles.linkRowValue}>
                {funnel ? `${formatNumber(funnel.cv_count)}件` : '—'}
              </span>
            </div>
            <div className={styles.linkRow}>
              <span>シナリオ配信</span>
              <span className={styles.linkRowValue}>{scenarioName ?? 'なし'}</span>
            </div>
            <div className={styles.linkRow}>
              <span>マイル</span>
              <span className={styles.linkRowValue}>なし</span>
            </div>
          </section>
          <section className={styles.linkCard} aria-label="QRコード">
            <h2 className={styles.linkCardTitle}>QRコード</h2>
            <div className={styles.linkRow}>
              <span>大きさ</span>
              <span className={styles.linkRowValue}>320 × 320</span>
            </div>
            <div className={styles.linkRow}>
              <span>形式</span>
              <span className={styles.linkRowValue}>PNG</span>
            </div>
            <div className={styles.linkRow}>
              <span>作った日</span>
              <span className={styles.linkRowValue}>{createdDate}</span>
            </div>
            {qrDownloadUrl ? (
              <a className={styles.qrSave} href={qrDownloadUrl} download={`referral-${route.refCode}.png`}>
                → QRコードを保存
              </a>
            ) : null}
          </section>
        </div>
      </>}
      {qrOpen && route && url ? (
        <ReferralQrModal
          route={{ refCode: route.refCode, name: route.name, genre: route.genre, isActive: route.isActive }}
          onClose={() => setQrOpen(false)}
        />
      ) : null}
      {editingRoute && route && <EditRouteModal
        route={route}
        pools={pools}
        scenarios={scenarios}
        templates={templates}
        tags={tags}
        existingGenres={[...new Set(routes.map((entryRoute) => entryRoute.genre).filter((genre): genre is string => !!genre))]}
        onClose={() => setEditingRoute(false)}
        onSaved={(savedRoute) => {
          setRoutes((current) => current.map((entryRoute) => entryRoute.id === savedRoute.id ? savedRoute : entryRoute))
          setRoute(savedRoute)
          setEditingRoute(false)
        }}
      />}
      {deleteOpen && route && <div className="fixed inset-0 z-70 flex items-center justify-center bg-ink/35 p-4" data-design-node="UIaM7" role="dialog" aria-modal="true" aria-labelledby="inflow-delete-title">
        <div ref={deleteDialogRef} tabIndex={-1} className="w-full overflow-hidden rounded-card bg-canvas shadow-overlay" style={{ maxWidth: 840 }}>
          <div className="flex items-start gap-3 border-b border-hairline px-6 py-5" style={{ minHeight: 96 }}><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-pill bg-danger-bg text-xl font-bold text-danger">!</span><div className="min-w-0 flex-1"><h2 id="inflow-delete-title" className="text-xl font-bold text-ink">「{route.name}」を削除しますか？</h2><p className="mt-1 text-sm text-ink-faint">このURLは {route.createdAt.slice(5, 10).replace('-', '/')} から使われています。削除すると同じURLは開けなくなります。</p></div><button type="button" onClick={() => setDeleteOpen(false)} disabled={deleting} aria-label="閉じる" className="rounded-mini shrink-0 p-1 text-ink-secondary hover:bg-canvas-sunken disabled:opacity-50"><X aria-hidden="true" className="h-5 w-5" /></button></div>
          <div className="space-y-4 p-6">
            <Notice tone="danger"><h3 className="text-sm font-bold">削除すると、次のことが起きます</h3><div className="mt-3 divide-y divide-danger/15"><div className="flex items-center justify-between gap-4 py-2"><div><p className="text-sm font-bold">貼り付けたURL・QRコード</p><p className="mt-0.5 text-xs">このURLを置いた投稿や広告から開けなくなります。</p></div><span className="rounded-pill bg-canvas px-3 py-1 text-xs font-bold">差し替えが必要</span></div><div className="flex items-center justify-between gap-4 py-2"><div><p className="text-sm font-bold">この経路から来た記録</p><p className="mt-0.5 text-xs">{funnel?.friend_add_count ?? 0}人の流入元と成果は過去の記録として残ります。</p></div><span className="rounded-pill bg-canvas px-3 py-1 text-xs font-bold">記録は残る</span></div><div className="flex items-center justify-between gap-4 py-2"><div><p className="text-sm font-bold">追加時の動き</p><p className="mt-0.5 text-xs">新しい友だちへのタグ付けとシナリオ開始が止まります。</p></div><span className="rounded-pill bg-canvas px-3 py-1 text-xs font-bold">受付を停止</span></div></div></Notice>
            <p className="rounded-control bg-success-bg px-4 py-3 text-xs font-semibold text-success">この経路から来た友だちと、付いたタグ・進んでいるシナリオは消えません。</p>
            <div><h3 className="text-sm font-bold text-ink">どうしますか？</h3><div className="mt-2 grid gap-2">{([['stop','新しい人を受けるのをやめる（おすすめ）','URLは残し、「受付を終了しました」と表示します。','休'],['redirect','別の流入リンクへ送るようにする','印刷ずみのQRコードを別の経路へつなぎます。','→'],['delete','このまま削除する','利用履歴がない経路だけ完全に削除できます。元には戻せません。','×']] as const).filter(([value]) => value !== 'delete' || canPermanentlyDelete).map(([value,title,description,icon]) => <button key={value} type="button" disabled={deleting} onClick={() => { setDeleteChoice(value); setDeleteError('') }} className={`flex w-full items-center gap-3 rounded-control border p-3 text-left ${deleteChoice === value ? 'border-accent bg-accent-soft' : 'border-hairline bg-canvas'}`}><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-pill border text-xs font-bold ${deleteChoice === value ? 'border-accent-deep bg-accent-deep text-on-accent' : 'border-hairline text-ink-faint'}`}>{icon}</span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-ink">{title}</span><span className="mt-0.5 block text-xs text-ink-faint">{description}</span></span><span className="text-ink-faint">›</span></button>)}</div></div>
            {deleteChoice === 'redirect' && <div><p className="text-sm font-semibold text-ink">転送先のリンク</p><Select aria-label="転送先のリンク" id="inflow-redirect-target" value={redirectTargetId} disabled={deleting} onChange={setRedirectTargetId} size="full" options={[{ value: '', label: '選んでください' }, ...routes.filter((candidate) => candidate.id !== route.id).map((candidate) => ({ value: candidate.id, label: `${candidate.name}（#${candidate.refCode}）` }))]} /><p className="text-ink-faint mt-1 text-xs">先頭を自動で選ぶことはしません。必ず選んでください。</p></div>}
            {deleteChoice === 'delete' && <div className="rounded-control border border-status-danger bg-danger-bg p-4"><label htmlFor="inflow-delete-confirmation" className="text-sm font-medium text-danger">完全削除するには「{route.name}」と入力</label><input id="inflow-delete-confirmation" value={deleteConfirmationName} disabled={deleting} onChange={(event) => setDeleteConfirmationName(event.target.value)} autoComplete="off" className="mt-2 w-full rounded-control border border-hairline bg-canvas px-3 py-2 text-sm text-ink" /><p className="mt-1 text-xs text-danger">空白や大文字・小文字も含め、現在の経路名と同じ入力が必要です。</p></div>}
            {deleteError && <Notice tone="danger" message={deleteError} />}
          </div>
          <div className="flex items-center justify-between border-t border-hairline px-6 py-4" style={{ minHeight: 82 }}><p className="max-w-md text-xs text-ink-faint">選んだ方法を確認してから進みます。過去の友だち・タグ・分析記録は消えません。</p><div className="flex gap-2"><Button variant="secondary" disabled={deleting} onClick={() => setDeleteOpen(false)}>キャンセル</Button><Button onClick={() => void applyDeleteChoice()} disabled={deleting || (deleteChoice === 'delete' && deleteConfirmationName !== route.name)}>{deleteChoice === 'stop' ? '受けるのをやめる' : deleteChoice === 'redirect' ? '別のリンクへ送る' : 'この経路を削除する'}</Button></div></div>
        </div>
      </div>}
    </div>
  )
}

export default function InflowLinkDetailPage() {
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <InflowLinkDetailPageContent />
    </Suspense>
  )
}
