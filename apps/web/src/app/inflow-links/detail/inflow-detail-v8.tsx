'use client'

/*
 * ★V8-B 流入と計測の詳細（Pencil「★V8-B 画面の地図」：詳細 `Q5le3`）。
 *
 * v7 の詳細画面（`detail/page.tsx` の `InflowLinkDetailBody`）とは別の
 * 見せ方。取ってくる口（経路・段階・友だち・注文）・編集と削除の窓・
 * QR の窓は v7 と同じものを使う。取れない数（ブロック・1人あたり金額・
 * 月別の購入金額）は「—」にする。v7 を直す必要が出たら `detail/page.tsx`
 * 側も同じ判断を入れる（V8 完成までの二重管理）。
 */
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useMemo, useState } from 'react'
import { ApiError, api, fetchApi } from '@/lib/api'
import { isPoolsFeatureAvailable } from '@/lib/pools-availability'
import type {
  ApiResponse,
  EntryRoute,
  EntryRouteFunnel,
  Scenario,
  Tag,
  TrafficPool,
} from '@line-crm/shared'
import { useAccount } from '@/contexts/account-context'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { formatDay, formatNumber } from '@/lib/format'
import Button from '@/components/shared/button'
import FilterChip from '@/components/shared/filter-chip'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import Pagination from '@/components/shared/pagination'
import SearchField from '@/components/shared/search-field'
import PageSizeSelect from '@/components/ui/page-size-select'
import TargetMissing from '@/components/shared/target-missing'
import { RowActions } from '@/components/shared/row-actions'
import { TableHeadRow, Th } from '@/components/shared/table'
import EditRouteModal from '../_components/edit-route-modal'
import InflowDeleteDialog from '../_components/inflow-delete-dialog'
import RefOrdersPanel, { type RefOrdersResult } from '../_components/ref-orders'
import ReferralQrModal from '../referral-qr-modal'
import styles from './inflow-detail-v8.module.css'

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
  firstPage?: string
  currentStatus?: string
  conversion?: string
  miles?: number
}

type FriendFilter = 'all' | 'month' | 'blocked' | 'converted'

const READONLY_REASON = 'この操作にはオーナーか管理者の権限が要ります'

function sameMonth(iso: string | null, base: Date): boolean {
  if (!iso) return false
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return false
  return date.getFullYear() === base.getFullYear() && date.getMonth() === base.getMonth()
}

function shortDay(iso: string | null): string {
  if (!iso) return '—'
  return formatDay(iso)
}

function createdDay(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

function hostOf(url: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

function InflowDetailV8Inner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const id = searchParams.get('id') ?? ''
  const requestedRefCode = searchParams.get('ref') ?? ''
  usePageTitle('流入と計測の詳細')
  usePageCrumbs([
    { label: 'ホーム', href: '/' },
    { label: '流入と計測', href: '/inflow-links' },
  ])
  const role = useStaffRole()
  const canEdit = canManageRole(role)
  const { selectedAccountId } = useAccount()

  const [routes, setRoutes] = useState<EntryRoute[]>([])
  const [route, setRoute] = useState<EntryRoute | null>(null)
  const [funnel, setFunnel] = useState<EntryRouteFunnel | null>(null)
  const [funnelError, setFunnelError] = useState(false)
  const [funnelAttempt, setFunnelAttempt] = useState(0)
  const [friends, setFriends] = useState<AttributedFriend[]>([])
  const [ordersSummary, setOrdersSummary] = useState<RefOrdersResult | null>(null)
  const [tags, setTags] = useState<Tag[]>([])
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [pools, setPools] = useState<TrafficPool[]>([])
  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [editingRoute, setEditingRoute] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [routeLoading, setRouteLoading] = useState(false)
  const [routeMissing, setRouteMissing] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteChoice, setDeleteChoice] = useState<'stop' | 'redirect' | 'delete'>('stop')
  const [canPermanentlyDelete, setCanPermanentlyDelete] = useState(false)
  const [qrOpen, setQrOpen] = useState(false)
  // 友だちの表の絞り込みとページ送り。
  const [friendSearch, setFriendSearch] = useState('')
  const [friendFilter, setFriendFilter] = useState<FriendFilter>('all')
  const [friendPage, setFriendPage] = useState(1)
  const [friendPageSize, setFriendPageSize] = useState(20)
  // 追加時の動きを止める（タグ・メッセージ・シナリオを外す）。
  const [stopBusy, setStopBusy] = useState(false)
  const [stopError, setStopError] = useState('')

  const selectedId =
    id || routes.find((entryRoute) => entryRoute.refCode === requestedRefCode)?.id || ''

  useEffect(() => {
    let cancelled = false
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

  const routeAccountId = route?.lineAccountId ?? null
  useEffect(() => {
    let cancelled = false
    if (!route) return () => { cancelled = true }
    const accountParams = routeAccountId ? { accountId: routeAccountId } : undefined
    void Promise.allSettled([
      api.tags.list(accountParams),
      api.scenarios.list(accountParams),
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

  const tagName = route?.tagId ? (tags.find((t) => t.id === route.tagId)?.name ?? null) : null
  const scenarioName = route?.scenarioId
    ? (scenarios.find((s) => s.id === route.scenarioId)?.name ?? null)
    : null
  const poolName = route?.poolId ? (pools.find((p) => p.id === route.poolId)?.name ?? null) : null
  const introTemplateName = route?.introTemplateId
    ? (templates.find((t) => t.id === route.introTemplateId)?.name ?? null)
    : null
  const hasActions = Boolean(route?.tagId || route?.scenarioId || route?.introTemplateId)

  const addRate = useMemo(() => {
    if (!funnel || funnel.click_count === 0) return null
    return Math.round((funnel.friend_add_count / funnel.click_count) * 1000) / 10
  }, [funnel])

  const now = useMemo(() => new Date(), [])
  const monthFriends = useMemo(
    () => friends.filter((friend) => sameMonth(friend.trackedAt, now)),
    [friends, now],
  )
  const blockedFriends = useMemo(
    () => friends.filter((friend) => friend.currentStatus?.includes('ブロック')),
    [friends],
  )
  const convertedFriends = useMemo(
    () => friends.filter((friend) => friend.conversion && friend.conversion !== '—'),
    [friends],
  )

  const normalizedSearch = friendSearch.trim().toLocaleLowerCase('ja')
  const searchedFriends = normalizedSearch
    ? friends.filter((friend) =>
        friend.displayName.toLocaleLowerCase('ja').includes(normalizedSearch),
      )
    : friends
  const filteredFriends = searchedFriends.filter((friend) => {
    if (friendFilter === 'month') return sameMonth(friend.trackedAt, now)
    if (friendFilter === 'blocked') return friend.currentStatus?.includes('ブロック') ?? false
    if (friendFilter === 'converted') return Boolean(friend.conversion && friend.conversion !== '—')
    return true
  })
  const friendPageCount = Math.max(1, Math.ceil(filteredFriends.length / friendPageSize))
  const shownFriends = filteredFriends.slice(
    (friendPage - 1) * friendPageSize,
    friendPage * friendPageSize,
  )
  useEffect(() => {
    if (friendPage > friendPageCount) setFriendPage(friendPageCount)
  }, [friendPage, friendPageCount])

  /** 追加時の動きを止める（板 `Q5le3` の青い帯の「止める」）。 */
  const stopActions = async () => {
    if (!route || stopBusy) return
    setStopBusy(true)
    setStopError('')
    try {
      const res = await api.entryRoutes.update(route.id, {
        tagId: null,
        scenarioId: null,
        introTemplateId: null,
      })
      if (!res.success) throw new Error(res.error)
      const fresh = await api.entryRoutes.get(route.id)
      if (fresh.success) setRoute(fresh.data)
    } catch (cause) {
      setStopError(
        cause instanceof ApiError && cause.status === 403
          ? 'この操作を行う権限がありません'
          : '止められませんでした。もう一度押してください。',
      )
    } finally {
      setStopBusy(false)
    }
  }

  const openDelete = (choice: 'stop' | 'redirect' | 'delete') => {
    setDeleteChoice(choice)
    setDeleteOpen(true)
  }

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

  if (!route) {
    return <ListState kind="loading" title="流入経路を読み込んでいます" />
  }

  const redirectHost = hostOf(route.redirectUrl)
  const actionSummary = hasActions
    ? [
        tagName ? `タグ「${tagName}」を付けて` : null,
        introTemplateName ? `メッセージ「${introTemplateName}」を送ります` : null,
        scenarioName ? `シナリオ「${scenarioName}」を始めます` : null,
      ]
        .filter(Boolean)
        .join('、')
    : null

  return (
    <div className={styles.board} data-design-node="Q5le3">
      <div className={styles.head}>
        <div className={styles.headText}>
          <p className={styles.headBack}>
            <Link href="/inflow-links" className={styles.headBackLink}>
              ← 流入と計測へ
            </Link>
          </p>
          <h1 className={styles.headTitle}>{route.name}</h1>
          <p className={styles.headSub} title={url ?? undefined}>
            {route.genre || '未分類'}・{url ?? '—'}
            {redirectHost ? ` → ${redirectHost}` : ''}・友だちの追加先 {poolName ?? '—'}・作った日{' '}
            {createdDay(route.createdAt)}
          </p>
        </div>
        <div className={styles.headActions}>
          <Button variant="secondary" onClick={() => setQrOpen(true)}>
            QRコードを表示
          </Button>
          <Button variant="secondary" onClick={() => void copyUrl()}>
            {copied ? 'コピーしました' : 'URLをコピー'}
          </Button>
          <Button
            variant="secondary"
            disabled={!canEdit}
            title={!canEdit ? READONLY_REASON : undefined}
            onClick={() => setEditingRoute(true)}
          >
            リンクを編集
          </Button>
        </div>
      </div>

      {!canEdit ? (
        <Notice tone="info" message="閲覧のみで見ています。変える操作は管理者に頼んでください。" />
      ) : null}
      {copyFailed && url ? (
        <Notice tone="warn" message="コピーできませんでした。下の欄を選んでコピーしてください。">
          <input
            readOnly
            value={url}
            aria-label="流入経路のURL"
            onFocus={(e) => e.currentTarget.select()}
            className="mt-2 w-full rounded-control border border-hairline bg-canvas px-3 py-2 font-mono text-xs"
          />
        </Notice>
      ) : null}
      {stopError ? <Notice tone="error" message={stopError} /> : null}

      <ul className={styles.kpis} aria-label="この経路の概要">
        <li className={styles.kpi}>
          <span className={styles.kpiLabel}>今月友だちになった</span>
          <p className={styles.kpiValue}>
            {funnel ? (
              <>{formatNumber(monthFriends.length)}<span className={styles.kpiUnit}>人</span></>
            ) : (
              '—'
            )}
          </p>
          <p className={styles.kpiDetail}>{funnel ? `累計 ${formatNumber(funnel.friend_add_count)}人` : '読み込んでいます'}</p>
        </li>
        <li className={styles.kpi}>
          <span className={styles.kpiLabel}>累計</span>
          <p className={styles.kpiValue}>
            {funnel ? (
              <>{formatNumber(funnel.friend_add_count)}<span className={styles.kpiUnit}>人</span></>
            ) : (
              '—'
            )}
          </p>
          <p className={styles.kpiDetail}>{createdDay(route.createdAt)}から</p>
        </li>
        <li className={styles.kpi}>
          <span className={styles.kpiLabel}>ブロック</span>
          <p className={styles.kpiValue}>
            —<span className={styles.kpiUnit}>人</span>
          </p>
          <p className={styles.kpiDetail}>友だちになった人の1%（集計は未接続です）</p>
        </li>
        <li className={styles.kpi}>
          <span className={styles.kpiLabel}>成果（コンバージョン）</span>
          <p className={styles.kpiValue}>
            {funnel ? (
              <>{formatNumber(funnel.cv_count)}<span className={styles.kpiUnit}>件</span></>
            ) : (
              '—'
            )}
          </p>
          <p className={styles.kpiDetail}>累計</p>
        </li>
      </ul>

      <section className={styles.card} aria-labelledby="inflow-v8-after">
        <h2 className={styles.cardTitle} id="inflow-v8-after">
          その後（この経路から来た人）
        </h2>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <RowActions
            menuItems={[
              { id: 'stop', label: '受付を止める', disabled: !canEdit, onSelect: () => openDelete('stop') },
              { id: 'redirect', label: '別リンクへ送る', disabled: !canEdit, onSelect: () => openDelete('redirect') },
              ...(canPermanentlyDelete
                ? [{ id: 'delete', label: '削除する', disabled: !canEdit, onSelect: () => openDelete('delete') } as const]
                : []),
            ]}
            menuNote={canEdit ? undefined : READONLY_REASON}
            subjectName={route.name}
          />
        </div>
        {funnel ? (
          <ul className={styles.miniStats}>
            <li className={styles.miniStat}>
              <span className={styles.miniStatLabel}>クリック</span>
              <span className={styles.miniStatValue}>{formatNumber(funnel.click_count)}</span>
            </li>
            <li className={styles.miniStat}>
              <span className={styles.miniStatLabel}>友だち追加</span>
              <span className={styles.miniStatValue}>{formatNumber(funnel.friend_add_count)}</span>
              <span className={styles.miniStatSub}>追加率 {addRate ?? '—'}%</span>
            </li>
            <li className={styles.miniStat}>
              <span className={styles.miniStatLabel}>フォーム</span>
              <span className={styles.miniStatValue}>{formatNumber(funnel.form_submission_count)}</span>
            </li>
            <li className={styles.miniStat}>
              <span className={styles.miniStatLabel}>購入</span>
              <span className={styles.miniStatValue}>
                {ordersSummary ? formatNumber(ordersSummary.total) : '—'}
              </span>
              {ordersSummary?.totalAmount != null ? (
                <span className={styles.miniStatSub}>¥{formatNumber(ordersSummary.totalAmount)}</span>
              ) : null}
            </li>
            <li className={styles.miniStat}>
              <span className={styles.miniStatLabel}>返金・取消</span>
              <span className={styles.miniStatValue}>
                {ordersSummary ? formatNumber(ordersSummary.refunded + ordersSummary.cancelled) : '—'}
              </span>
              {ordersSummary?.refundedAmount != null ? (
                <span className={styles.miniStatSub}>−¥{formatNumber(ordersSummary.refundedAmount)}</span>
              ) : null}
            </li>
          </ul>
        ) : funnelError ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 12 }}>
            <p className={styles.cardNote}>段階を読み込めませんでした。集計データは消えていません。</p>
            <Button variant="secondary" onClick={() => setFunnelAttempt((n) => n + 1)}>
              段階を再読み込み
            </Button>
          </div>
        ) : (
          <p className={styles.cardNote}>読み込み中…</p>
        )}
        <div className={styles.orderLine}>
          <p className={styles.orderLineTitle}>
            注文の明細 {ordersSummary ? formatNumber(ordersSummary.total) : '—'}件
          </p>
          <Button variant="secondary" href="#inflow-v8-orders">
            注文を見る
          </Button>
        </div>
      </section>

      <Notice
        tone="info"
        message={
          actionSummary
            ? `友だちになったとき：${actionSummary}`
            : '友だちになったときの動きはまだ決まっていません（「動きが未設定」です）'
        }
        action={(
          <span style={{ display: 'inline-flex', gap: 8 }}>
            <Button
              variant="secondary"
              disabled={!canEdit || !hasActions || stopBusy}
              title={!canEdit ? READONLY_REASON : !hasActions ? '止める動きがありません' : undefined}
              onClick={() => void stopActions()}
            >
              止める
            </Button>
            <Button
              variant="primary"
              disabled={!canEdit}
              title={!canEdit ? READONLY_REASON : undefined}
              onClick={() => setEditingRoute(true)}
            >
              することを変える
            </Button>
          </span>
        )}
      />

      <section className={styles.card} aria-labelledby="inflow-v8-friends">
        <h2 className={styles.cardTitle} id="inflow-v8-friends">
          この経路から来た友だち
        </h2>
        <div className={styles.toolbar}>
          <span className={styles.searchWrap}>
            <SearchField
              value={friendSearch}
              onChange={(value) => {
                setFriendSearch(value)
                setFriendPage(1)
              }}
              placeholder="友だちの名前で探す"
              aria-label="友だちの名前で探す"
            />
          </span>
          <span className={styles.chipRow}>
            <FilterChip
              selected={friendFilter === 'all'}
              count={friends.length}
              onChange={() => {
                setFriendFilter('all')
                setFriendPage(1)
              }}
            >
              すべて
            </FilterChip>
            <FilterChip
              selected={friendFilter === 'month'}
              count={monthFriends.length}
              onChange={() => {
                setFriendFilter(friendFilter === 'month' ? 'all' : 'month')
                setFriendPage(1)
              }}
            >
              今月
            </FilterChip>
            <FilterChip
              selected={friendFilter === 'blocked'}
              count={blockedFriends.length}
              onChange={() => {
                setFriendFilter(friendFilter === 'blocked' ? 'all' : 'blocked')
                setFriendPage(1)
              }}
            >
              ブロック
            </FilterChip>
            <FilterChip
              selected={friendFilter === 'converted'}
              count={convertedFriends.length}
              onChange={() => {
                setFriendFilter(friendFilter === 'converted' ? 'all' : 'converted')
                setFriendPage(1)
              }}
            >
              成果あり
            </FilterChip>
          </span>
          <span className={styles.toolbarSpacer} />
          <PageSizeSelect
            value={friendPageSize}
            options={[10, 20, 50]}
            onChange={(value) => {
              setFriendPageSize(value)
              setFriendPage(1)
            }}
          />
        </div>

        {shownFriends.length === 0 ? (
          <ListState
            kind="empty"
            title={friends.length > 0 ? '条件に合う友だちがいません' : 'この経路から来た友だちは、まだ記録されていません'}
            description={friends.length > 0 ? '検索や絞り込みの条件を変えてください。' : undefined}
          />
        ) : (
          <>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <colgroup>
                  <col style={{ width: 110 }} />
                  <col />
                  <col style={{ width: 130 }} />
                  <col style={{ width: 110 }} />
                  <col style={{ width: 190 }} />
                  <col style={{ width: 110 }} />
                  <col style={{ width: 56 }} />
                </colgroup>
                <thead>
                  <TableHeadRow>
                    <Th>日時</Th>
                    <Th>友だち</Th>
                    <Th>入ったLINEアカウント</Th>
                    <Th>今の状態</Th>
                    <Th>付いたタグ・その後</Th>
                    <Th>成果</Th>
                    <Th>
                      <span className="sr-only">操作</span>
                    </Th>
                  </TableHeadRow>
                </thead>
                <tbody>
                  {shownFriends.map((friend) => (
                    <tr key={friend.id}>
                      <td>
                        <span className={styles.cellMuted}>
                          {friend.trackedAt
                            ? friend.trackedAt.slice(5, 16).replace('T', ' ').replaceAll('-', '/')
                            : '日時不明'}
                        </span>
                      </td>
                      <td>
                        <span className={styles.cellMain} title={friend.displayName}>
                          {friend.displayName}
                        </span>
                        <span className={styles.cellSub}>
                          はじめて見たページ {friend.firstPage ?? '—'}
                        </span>
                      </td>
                      <td>
                        <span className={styles.cellEllipsis} title={poolName ?? '追加先が設定されていません'}>
                          {poolName ?? '—'}
                        </span>
                      </td>
                      <td>
                        {friend.currentStatus?.includes('ブロック') ? (
                          <span className={`${styles.statePill} ${styles.statePillMuted}`}>
                            <span className={styles.statePillDot} aria-hidden="true" />
                            ブロック
                          </span>
                        ) : (
                          <span className={`${styles.statePill} ${styles.statePillActive}`}>
                            <span className={styles.statePillDot} aria-hidden="true" />
                            {friend.currentStatus ?? '友だち'}
                          </span>
                        )}
                      </td>
                      <td>
                        <span
                          className={styles.cellEllipsis}
                          title={tagName ? `タグ「${tagName}」・${introTemplateName ? 'あいさつ済み' : 'あいさつなし'}` : '—'}
                        >
                          {tagName ? `タグ「${tagName}」・${introTemplateName ? 'あいさつ済み' : 'あいさつなし'}` : '—'}
                        </span>
                      </td>
                      <td>
                        <span className={styles.cellEllipsis} title={friend.conversion ?? undefined}>
                          {friend.conversion ?? '—'}
                        </span>
                      </td>
                      <td>
                        <RowActions
                          detail={{
                            label: '友だちを見る',
                            href: `/friends/detail?id=${encodeURIComponent(friend.id)}`,
                          }}
                          subjectName={friend.displayName}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={styles.pagerRow}>
              <span className={styles.pagerCount}>
                {formatNumber(filteredFriends.length)}人中{' '}
                {formatNumber((friendPage - 1) * friendPageSize + 1)}〜
                {formatNumber(Math.min(friendPage * friendPageSize, filteredFriends.length))}人
              </span>
              <Pagination
                page={friendPage}
                pageCount={friendPageCount}
                onPageChange={setFriendPage}
              />
            </div>
          </>
        )}
      </section>

      <section className={styles.card} id="inflow-v8-orders" aria-labelledby="inflow-v8-orders-title">
        <h2 className={styles.cardTitle} id="inflow-v8-orders-title">
          この経路からの注文
        </h2>
        <p className={styles.cardNote}>
          上の「購入」の数と同じ条件の明細です。返金・取り消しは状態に出ます。
        </p>
        <RefOrdersPanel refCode={route.refCode} onSummaryChange={setOrdersSummary} />
      </section>

      <div className={styles.bottomCards}>
        <section className={styles.card} aria-labelledby="inflow-v8-links">
          <h2 className={styles.cardTitle} id="inflow-v8-links">
            この経路のつながる先
          </h2>
          <ul className={styles.defList}>
            <li className={styles.defRow}>
              <span>シナリオ配信</span>
              <span className={styles.defValue}>{scenarioName ?? 'なし'}</span>
            </li>
            <li className={styles.defRow}>
              <span>タグ</span>
              <span className={styles.defValue}>{tagName ? `「${tagName}」` : 'なし'}</span>
            </li>
            <li className={styles.defRow}>
              <span>コンバージョン</span>
              <Link href="/conversions" className={styles.cardLink} style={{ marginTop: 0 }}>
                成果地点で見る
              </Link>
            </li>
            <li className={styles.defRow}>
              <span>分析</span>
              <Link href="/analytics" className={styles.cardLink} style={{ marginTop: 0 }}>
                分析で見る
              </Link>
            </li>
          </ul>
        </section>
        <section className={styles.card} aria-labelledby="inflow-v8-qr">
          <h2 className={styles.cardTitle} id="inflow-v8-qr">
            QRコード
          </h2>
          <ul className={styles.defList}>
            <li className={styles.defRow}>
              <span>大きさ</span>
              <span className={styles.defValueAccent}>512 × 512</span>
            </li>
            <li className={styles.defRow}>
              <span>形式</span>
              <span className={styles.defValue}>PNG・印刷用PDF</span>
            </li>
            <li className={styles.defRow}>
              <span>作った日</span>
              <span className={styles.defValue}>{createdDay(route.createdAt)}</span>
            </li>
          </ul>
          <button type="button" onClick={() => setQrOpen(true)} className={styles.cardLink}>
            → QRコードを保存
          </button>
        </section>
      </div>

      {editingRoute ? (
        <EditRouteModal
          route={route}
          pools={pools}
          scenarios={scenarios}
          templates={templates}
          tags={tags}
          existingGenres={[
            ...new Set(
              routes.map((entryRoute) => entryRoute.genre).filter((g): g is string => !!g),
            ),
          ]}
          poolMemberNames={{}}
          onClose={() => setEditingRoute(false)}
          onSaved={(savedRoute) => {
            setRoutes((current) =>
              current.map((entryRoute) => (entryRoute.id === savedRoute.id ? savedRoute : entryRoute)),
            )
            setRoute(savedRoute)
            setEditingRoute(false)
          }}
        />
      ) : null}
      {qrOpen ? (
        <ReferralQrModal
          route={{
            refCode: route.refCode,
            name: route.name,
            genre: route.genre,
            isActive: route.isActive,
            id: route.id,
          }}
          onClose={() => setQrOpen(false)}
        />
      ) : null}
      {deleteOpen ? (
        <InflowDeleteDialog
          route={route}
          routes={routes}
          funnelFriendCount={funnel?.friend_add_count ?? 0}
          workerBase={workerBase}
          canPermanentlyDelete={canPermanentlyDelete}
          initialChoice={deleteChoice}
          onDeleted={() => {
            setDeleteOpen(false)
            router.replace('/inflow-links')
          }}
          onClose={() => setDeleteOpen(false)}
        />
      ) : null}
    </div>
  )
}

export default function InflowDetailV8() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<ListState kind="loading" title="流入経路を読み込んでいます" />}>
      <InflowDetailV8Inner />
    </Suspense>
  )
}
