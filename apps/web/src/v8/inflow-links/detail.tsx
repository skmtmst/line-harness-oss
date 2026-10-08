'use client'

/*
 * ★V8 流入と計測の詳細（Pencil `Q5le3`）。
 *
 * 型は詳細（DetailPage）：頭（戻る・題・説明・右に3つの操作）→ 数の帯（4つ）→ その後（この経路から来た人）→
 * 友だちになったときの帯 → この経路から来た友だちの表（道具の段・表・ページ送り）→ 下の2つの箱。
 *
 * 呼ぶ口・権限・失敗の扱いは今の詳細（app/inflow-links/detail/page.tsx）と同じ（BEHAVIOR.md の「詳細」）。
 * 違うのは見せ方だけ：
 * - 受付を止める・別リンクへ送る・削除するは「その後」の段の右上の「…」から（今は段の題の右）
 * - 閲覧のみ（owner・admin 以外）には、リンクを編集・止める・することを変える・「…」を出さず、閲覧のみの帯を出す
 */
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Copy, Eye, Info, Pause, Pencil, QrCode } from 'lucide-react'
import type { ApiResponse, EntryRoute, EntryRouteFunnel, Scenario, Tag, TrafficPool } from '@line-crm/shared'
import { ApiError, api, fetchApi } from '@/lib/api'
import { isPoolsFeatureAvailable } from '@/lib/pools-availability'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { canEditFeature } from '@/lib/staff-capability'
import { formatNumber } from '@/lib/format'
import { useAccount } from '@/contexts/account-context'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { DetailPage } from '@/components/templates'
import { type ActionMenuItem } from '@/components/shared/action-menu'
import { RowMenu } from '@/components/shared/row-actions'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import Pagination from '@/components/shared/pagination'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import StatusBadge from '@/components/shared/status-badge'
import TargetMissing from '@/components/shared/target-missing'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import EditRouteModal from './edit-route-dialog'
import QrDialog from './qr-dialog'
import RefOrdersPanel, { type RefOrdersResult } from './ref-orders'
import styles from './detail.module.css'

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
  // #514-8: 口が返すのは currentStatus(いまの状態)だけ。無い欄は「—」にする。
  firstPage?: string
  currentStatus?: string
  conversion?: string
  miles?: number
}

type FriendChip = 'all' | 'month' | 'blocked' | 'converted'
type FriendPeriod = 'all' | 'this' | 'last'
type DeleteChoice = 'stop' | 'redirect' | 'delete'

const PERIOD_OPTIONS: Array<{ value: FriendPeriod; label: string }> = [
  { value: 'all', label: 'すべて' },
  { value: 'this', label: '今月' },
  { value: 'last', label: '先月' },
]
const PAGE_SIZE_OPTIONS = [10, 20, 50].map((n) => ({ value: String(n), label: `${n}件表示` }))

const DELETE_CHOICES: ReadonlyArray<readonly [DeleteChoice, string, string]> = [
  ['stop', '新しい人を受けるのをやめる（おすすめ）', 'URLは残し、「受付を終了しました」と表示します。'],
  ['redirect', '別の流入リンクへ送るようにする', '印刷ずみのQRコードを別の経路へつなぎます。'],
  ['delete', 'このまま削除する', '利用履歴がない経路だけ完全に削除できます。元には戻せません。'],
]

/** WEB038：月の区切りは日本時間（今月・先月の鍵と同じ）。ブラウザの時計の地域に寄らない。 */
export function monthKeyOf(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return new Date(d.getTime() + 9 * 60 * 60_000).toISOString().slice(0, 7)
}

function InflowDetailContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const id = searchParams.get('id') ?? ''
  const requestedRefCode = searchParams.get('ref') ?? ''
  const role = useStaffRole()
  // WEB034：「流入」を任された staff も、経路の編集・止める／再開ができる（口と同じ条件）。完全削除は管理者だけ。
  const readonly = role !== null && !canManageRole(role) && !canEditFeature('/inflow-links')

  const [routes, setRoutes] = useState<EntryRoute[]>([])
  const [route, setRoute] = useState<EntryRoute | null>(null)
  const [funnel, setFunnel] = useState<EntryRouteFunnel | null>(null)
  const [funnelError, setFunnelError] = useState(false)
  const [funnelAttempt, setFunnelAttempt] = useState(0)
  const [friends, setFriends] = useState<AttributedFriend[]>([])
  /* WEB036：来た友だちの読み込みは別に持つ。失敗を「まだいません」にしない。 */
  const [friendsState, setFriendsState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [friendsAttempt, setFriendsAttempt] = useState(0)
  // IDEA-18: 購入・返金の値は注文明細パネルが取った集計と同じ値を使う。未取得は null。
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
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [deleteChoice, setDeleteChoice] = useState<DeleteChoice>('stop')
  const [deleteConfirmationName, setDeleteConfirmationName] = useState('')
  const [canPermanentlyDelete, setCanPermanentlyDelete] = useState(false)
  // 「別の流入リンクへ送る」の転送先。先頭を自動採用しない（#514 重大4）。
  const [redirectTargetId, setRedirectTargetId] = useState('')
  const [qrOpen, setQrOpen] = useState(false)
  const [showOrders, setShowOrders] = useState(false)
  const [afterMenuOpen, setAfterMenuOpen] = useState(false)
  const [openFriendMenuId, setOpenFriendMenuId] = useState<string | null>(null)
  const [friendSearch, setFriendSearch] = useState('')
  const [friendChip, setFriendChip] = useState<FriendChip>('all')
  const [friendPeriod, setFriendPeriod] = useState<FriendPeriod>('all')
  const [friendPage, setFriendPage] = useState(1)
  const [friendPageSize, setFriendPageSize] = useState(20)
  const { accounts = [] } = useAccount()

  usePageTitle(route?.name ?? '流入と計測')
  usePageCrumbs([{ label: 'ホーム', href: '/' }, { label: '流入と計測', href: '/inflow-links' }])

  const selectedId = id || routes.find((entryRoute) => entryRoute.refCode === requestedRefCode)?.id || ''

  // リンク一覧（ref 指定の解決と転送先の候補）・プール・自分の役割。
  useEffect(() => {
    let cancelled = false
    // プールは補助データ。有効と分からない限り口を発行しない（#703）。
    const poolsRequest: Promise<ApiResponse<TrafficPool[]>> = isPoolsFeatureAvailable().then((ok) =>
      ok
        ? api.pools.list({ suppressFeatureDisabledEvent: true })
        : { success: false as const, error: 'feature_disabled' },
    )
    void Promise.allSettled([api.entryRoutes.list(), poolsRequest, api.staff.me()]).then(([r, p, me]) => {
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

  /* R23横展開: 名前の解決・編集窓の候補は、この経路のアカウントだけ。 */
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
      if (tp.status === 'fulfilled' && tp.value.success) setTemplates(tp.value.data as unknown as MessageTemplate[])
    })
    return () => {
      cancelled = true
    }
  }, [route, routeAccountId])

  // 経路・段階・来た友だち。選び直すたびに引き直す。
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
    void Promise.allSettled([api.entryRoutes.get(selectedId), api.entryRoutes.funnel(selectedId)]).then(([r, f]) => {
      if (cancelled) return
      // WEB035：数（段階）は友だちの読み込みを待たずに、今の経路のものだけを書く。
      if (f.status === 'fulfilled' && f.value.success) setFunnel(f.value.data)
      else setFunnelError(true)
      if (r.status === 'fulfilled' && r.value.success) {
        setRoute(r.value.data)
      } else if (r.status === 'rejected' && r.reason instanceof ApiError && r.reason.status === 404) {
        setRouteMissing(true)
      } else setError('リンクの取得に失敗しました。もう一度読み込んでください。')
      setRouteLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [selectedId, funnelAttempt])

  // WEB036：この経路から来た友だち。経路が決まってから別に読み、失敗は失敗として出す。
  const routeRefCode = route && route.id === selectedId ? route.refCode : null
  useEffect(() => {
    setFriends([])
    if (!routeRefCode) {
      setFriendsState('loading')
      return
    }
    let cancelled = false
    setFriendsState('loading')
    void fetchApi<{ success: boolean; data: { friends: AttributedFriend[] } }>(
      `/api/analytics/ref/${encodeURIComponent(routeRefCode)}`,
    ).then((result) => {
      if (cancelled) return
      if (result.success && Array.isArray(result.data?.friends)) {
        setFriends(result.data.friends)
        setFriendsState('ready')
      } else {
        setFriendsState('error')
      }
    }).catch(() => {
      if (!cancelled) setFriendsState('error')
    })
    return () => { cancelled = true }
  }, [routeRefCode, friendsAttempt])

  const workerBase = process.env.NEXT_PUBLIC_API_URL ?? ''
  const url = route ? `${workerBase}/r/${encodeURIComponent(route.refCode)}` : null

  /** コピーできなかったとき、選んでコピーできる欄をその場に出す（ブラウザの入力窓は使わない。V6R-S3-f）。 */
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
  const scenarioName = route?.scenarioId ? (scenarios.find((s) => s.id === route.scenarioId)?.name ?? null) : null
  const introTemplateName = route?.introTemplateId
    ? (templates.find((t) => t.id === route.introTemplateId)?.name ?? null)
    : null

  const addRate = useMemo(() => {
    if (!funnel || funnel.click_count === 0) return null
    return Math.round((funnel.friend_add_count / funnel.click_count) * 1000) / 10
  }, [funnel])

  const nowDate = new Date(Date.now() + 9 * 60 * 60_000)
  const thisMonthKey = nowDate.toISOString().slice(0, 7)
  const lastMonthKey = new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth() - 1, 1)).toISOString().slice(0, 7)
  const isBlockedFriend = (friend: AttributedFriend) => (friend.currentStatus ?? '').includes('ブロック')
  const monthFriends = friends.filter((friend) => monthKeyOf(friend.trackedAt) === thisMonthKey)
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
  const createdDate = route ? `${Number(route.createdAt.slice(5, 7))}月${Number(route.createdAt.slice(8, 10))}日` : ''
  const yen = (amount: number | null | undefined) => (amount == null ? '—' : `¥${formatNumber(amount)}`)

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
  const friendSummary = `${formatNumber(friendRows.length)}人中 ${(friendPage - 1) * friendPageSize + 1}〜${Math.min(friendPage * friendPageSize, friendRows.length)}人`

  // 削除の窓を開く。「…」と帯の「止める」から、選ぶ内容だけ変える。
  const openDelete = (choice: DeleteChoice) => {
    setDeleteError('')
    setDeleteChoice(choice)
    setDeleteConfirmationName('')
    setRedirectTargetId('')
    setAfterMenuOpen(false)
    setDeleteOpen(true)
  }

  // 受付を再開する（止まっているときの帯）。
  const reopenRoute = async () => {
    if (!route) return
    try {
      const res = await api.entryRoutes.update(route.id, { isActive: true })
      if (res.success) setRoute({ ...route, isActive: true })
    } catch {
      // 失敗しても画面はそのまま。止まったままなのが分かる。
    }
  }

  const afterMenuItems: ActionMenuItem[] = [
    { id: 'stop', label: '受付を止める', onSelect: () => openDelete('stop') },
    { id: 'redirect', label: '別リンクへ送る', onSelect: () => openDelete('redirect') },
    ...(canPermanentlyDelete ? [{ id: 'delete', label: '削除する', tone: 'danger' as const, onSelect: () => openDelete('delete') }] : []),
  ]

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

  const qrDownloadUrl = url
    ? `${workerBase.replace(/\/$/, '')}/api/qr?size=320x320&data=${encodeURIComponent(url)}&download=1&filename=${encodeURIComponent(`referral-${route?.refCode ?? ''}`)}`
    : undefined
  const back = <Link href="/inflow-links" className={styles.backLink}><ArrowLeft size={14} aria-hidden="true" />流入と計測へ</Link>

  return (
    <DetailPage
      boardId="Q5le3"
      title={route?.name ?? '読み込み中…'}
      description={route ? `${route.genre || '未分類'}・${url}・${accountName}・作った日 ${createdDate}` : undefined}
      identity={back}
      actions={route ? (
        <div className={styles.headActions}>
          <Button onClick={() => setQrOpen(true)}><QrCode size={15} aria-hidden="true" />QR コードを表示</Button>
          <Button onClick={() => void copyUrl()}><Copy size={15} aria-hidden="true" />{copied ? 'コピーしました' : 'URL をコピー'}</Button>
          {readonly ? null : (
            <Button onClick={() => setEditingRoute(true)}><Pencil size={15} aria-hidden="true" />リンクを編集</Button>
          )}
        </div>
      ) : undefined}
    >
      {readonly ? (
        <p className={styles.viewerBand} role="status"><Eye size={16} aria-hidden="true" />閲覧のみで見ています。変える操作は管理者に頼んでください。</p>
      ) : null}
      {copyFailed && url ? (
        <div role="alert" className={styles.copyFallback}>
          <p className={styles.note}>コピーできませんでした。下の欄を選んでコピーしてください。</p>
          <input
            readOnly
            autoFocus
            value={url}
            aria-label="流入経路のURL"
            onFocus={(e) => e.currentTarget.select()}
            className={styles.fieldInput}
          />
        </div>
      ) : null}

      {!route ? (
        <ListState kind="loading" />
      ) : <>
        <div className={styles.kpis}>
          <KpiBand aria-label={`${route.name}の概要`}>
            <KpiCard presentation="band" icon={null} title="今月 友だちになった" value={monthTotal} unit="人"
              detail={`先月より ${monthDelta == null ? '—' : `${monthDelta >= 0 ? '+' : ''}${formatNumber(monthDelta)}`}`} />
            <KpiCard presentation="band" icon={null} title="累計" value={funnel ? funnel.friend_add_count : null} unit="人"
              detail={`${createdDate}から・いま残っている ${funnel?.remainingCount == null ? '—' : formatNumber(funnel.remainingCount)}人`} />
            <KpiCard presentation="band" icon={null} title="ブロック" value={funnel?.blockedCount ?? null} unit="人"
              detail={blockRate == null ? '割合は集計できません' : `友だちになった人の ${blockRate}%`} />
            <KpiCard presentation="band" icon={null} title="成果（コンバージョン）" value={funnel ? funnel.cv_count : null} unit="件"
              detail={`累計・1人あたり ${funnel?.valuePerFriend == null ? '—' : yen(Math.round(funnel.valuePerFriend))}`} />
          </KpiBand>
        </div>

        <div className={styles.afterWrap}>
          <section className={styles.afterCard} aria-labelledby="inflow-after-title">
            <div className={styles.afterHead}>
              <h2 className={styles.afterTitle} id="inflow-after-title">その後（この経路から来た人）</h2>
              {readonly ? null : (
                <div className={styles.menuBox}>
                  <RowMenu
                    label="この経路の操作（受付を止める・別リンクへ送る・削除する）"
                    menuLabel="この経路の操作"
                    items={afterMenuItems}
                    open={afterMenuOpen}
                    onOpenChange={setAfterMenuOpen}
                  />
                </div>
              )}
            </div>
            <p className={styles.afterNote}>
              {readonly
                ? 'クリックから友だち追加・フォーム・購入までの人数です'
                : '右上の「…」から：受付を止める・別リンクへ送る・削除する'}
            </p>
            {funnel ? (
              <div className={styles.minis}>
                <div className={styles.mini}>
                  <span className={styles.miniTitle}>クリック</span>
                  <span className={styles.miniValue}>{formatNumber(funnel.click_count)}</span>
                  <span className={styles.miniSub}>{' '}</span>
                </div>
                <div className={styles.mini}>
                  <span className={styles.miniTitle}>友だち追加</span>
                  <span className={styles.miniValue}>{formatNumber(funnel.friend_add_count)}</span>
                  <span className={styles.miniSub}>{`追加率 ${addRate ?? '—'}%`}</span>
                </div>
                <div className={styles.mini}>
                  <span className={styles.miniTitle}>フォーム</span>
                  <span className={styles.miniValue}>{formatNumber(funnel.form_submission_count)}</span>
                  <span className={styles.miniSub}>{' '}</span>
                </div>
                <div className={styles.mini}>
                  <span className={styles.miniTitle}>購入</span>
                  <span className={styles.miniValue}>{ordersSummary ? formatNumber(ordersSummary.total) : '—'}</span>
                  <span className={styles.miniSub}>{ordersSummary ? yen(ordersSummary.totalAmount) : '集計を取得できていません'}</span>
                </div>
                <div className={styles.mini}>
                  <span className={styles.miniTitle}>返金・取消</span>
                  <span className={styles.miniValue}>{ordersSummary ? formatNumber(ordersSummary.refunded + ordersSummary.cancelled) : '—'}</span>
                  <span className={styles.miniSub}>
                    {ordersSummary
                      ? (ordersSummary.refundedAmount == null ? '—' : `−${yen(ordersSummary.refundedAmount)}`)
                      : '集計を取得できていません'}
                  </span>
                </div>
              </div>
            ) : funnelError ? (
              <div className={styles.funnelError}>
                <p className={styles.note}>段階を読み込めませんでした。集計データは消えていません。</p>
                <Button onClick={() => setFunnelAttempt((n) => n + 1)}>段階を再読み込み</Button>
              </div>
            ) : (
              <ListState kind="loading" />
            )}
            {funnel?.monthly && funnel.monthly.length > 0 ? (
              <section aria-label="月別内訳">
              <details className={styles.monthly}>
                <summary>月別内訳（友だちになった月）</summary>
                <DataTable className={styles.monthlyTable}>
                  <thead><TableHeadRow><Th>月</Th><Th>友だち追加</Th><Th>いま残っている</Th><Th>ブロック</Th><Th>成果</Th><Th>金額</Th></TableHeadRow></thead>
                  <tbody>{funnel.monthly.map((month) => (
                    <Tr key={month.month}>
                      <Td>{month.month}</Td><Td>{`${formatNumber(month.friendAddCount)}人`}</Td>
                      <Td>{`${formatNumber(month.remainingCount)}人`}</Td><Td>{`${formatNumber(month.blockedCount)}人`}</Td>
                      <Td>{`${formatNumber(month.conversionCount)}件`}</Td><Td>{yen(month.conversionValueSum)}</Td>
                    </Tr>
                  ))}</tbody>
                </DataTable>
              </details>
              </section>
            ) : null}
            <div className={styles.ordersRow}>
              <h3 className={styles.ordersTitle}>{`注文の明細 ${ordersSummary ? formatNumber(ordersSummary.total) : '—'}件`}</h3>
              <Button onClick={() => setShowOrders((current) => !current)} aria-expanded={showOrders}>注文を見る</Button>
            </div>
            {showOrders ? <RefOrdersPanel refCode={route.refCode} onSummaryChange={setOrdersSummary} /> : null}
          </section>
        </div>

        <div className={styles.happenBand}>
          <Info size={18} className={styles.happenIcon} aria-hidden="true" />
          <div className={styles.happenText}>
            <p className={styles.happenTitle} title={happenTitle}>{happenTitle}</p>
            <p className={styles.happenNote}>何も決めないと「動きが未設定」になります。変えると、これから友だちになる人に効きます（もういる人には効きません）</p>
          </div>
          {readonly ? null : <>
            {route.isActive ? (
              <Button onClick={() => openDelete('stop')}><Pause size={15} aria-hidden="true" />止める</Button>
            ) : (
              <Button onClick={() => void reopenRoute()}>受付を再開する</Button>
            )}
            <Button variant="primary" onClick={() => setEditingRoute(true)}>
              <Pencil size={15} aria-hidden="true" />{happenParts.length > 0 ? 'することを変える' : 'することを決める'}
            </Button>
          </>}
        </div>

        <section className={styles.card} aria-label="この経路から来た友だち">
          <div className={styles.tools}>
            <div className={styles.searchBox}>
              <SearchField
                aria-label="友だちの名前で探す"
                placeholder="友だちの名前で探す"
                value={friendSearch}
                onChange={(value) => { setFriendSearch(value); setFriendPage(1) }}
                onClear={() => { setFriendSearch(''); setFriendPage(1) }}
              />
            </div>
            <div className={styles.chips} role="group" aria-label="友だちを絞り込む">
              {([
                ['all', `すべて ${formatNumber(friends.length)}`],
                ['month', `今月 ${formatNumber(monthFriends.length)}`],
                ['blocked', `ブロック ${formatNumber(blockedFriends.length)}`],
                ['converted', `成果あり ${formatNumber(convertedFriends.length)}`],
              ] as Array<[FriendChip, string]>).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={styles.chip}
                  aria-pressed={friendChip === value}
                  onClick={() => { setFriendChip(friendChip === value && value !== 'all' ? 'all' : value); setFriendPage(1) }}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className={styles.toolsSpacer} aria-hidden="true" />
            <div className={styles.periodBox}>
              <Select
                aria-label="期間"
                value={friendPeriod}
                options={PERIOD_OPTIONS}
                onChange={(value) => { setFriendPeriod(value as FriendPeriod); setFriendPage(1) }}
              />
            </div>
            <div className={styles.sizeBox}>
              <Select
                aria-label="表示件数"
                size="page-size"
                value={String(friendPageSize)}
                options={PAGE_SIZE_OPTIONS}
                onChange={(value) => { setFriendPageSize(Number(value)); setFriendPage(1) }}
              />
            </div>
          </div>
          {friendsState === 'error' ? (
            <ListState
              kind="error"
              title="この経路から来た友だちを読み込めませんでした"
              onRetry={() => setFriendsAttempt((n) => n + 1)}
            />
          ) : friendsState === 'loading' ? (
            <ListState kind="loading" title="この経路から来た友だちを読み込んでいます" />
          ) : friendRows.length === 0 ? (
            <ListState
              kind="empty"
              title={friends.length > 0 ? '条件に合う友だちがいません' : 'この経路から来た友だちは、まだいません'}
              description={friends.length > 0 ? '検索や絞り込みを変えてください。' : '友だちになった人がここに並びます。'}
            />
          ) : (
            <DataTable className={styles.table}>
              <thead>
                <TableHeadRow className={styles.headRow} data-table-layout="columns">
                  <Th className={styles.colWhen}>日時</Th>
                  <Th className={styles.colFriend}>友だち</Th>
                  <Th className={styles.colAccount}>入った LINE アカウント</Th>
                  <Th className={styles.colState}>今の状態</Th>
                  <Th className={styles.colTags}>付いたタグ・その後</Th>
                  <Th className={styles.colResult}>成果</Th>
                  <Th className={styles.colMenu}><span className="sr-only">操作</span></Th>
                </TableHeadRow>
              </thead>
              <tbody>
                {friendPageRows.map((friend) => {
                  const blocked = isBlockedFriend(friend)
                  return (
                    <Tr key={friend.id} className={styles.row} data-table-layout="columns">
                      <Td className={styles.colWhen}>
                        <span className={styles.when}>
                          {friend.trackedAt ? friend.trackedAt.slice(5, 16).replace('T', ' ').replaceAll('-', '/').replace(/^0/, '') : '日時不明'}
                        </span>
                      </Td>
                      <Td className={styles.colFriend}>
                        <span className={styles.face} aria-hidden="true">{friend.displayName.slice(0, 1)}</span>
                        <Link className={styles.friendName} href={`/friends/detail?id=${encodeURIComponent(friend.id)}`} title={friend.displayName}>
                          {friend.displayName}
                        </Link>
                      </Td>
                      <Td className={styles.colAccount}><span className={styles.cellText} title={accountName}>{accountName}</span></Td>
                      <Td className={styles.colState}>
                        {blocked ? (
                          <StatusBadge tone="neutral" size="compact">ブロック</StatusBadge>
                        ) : friend.currentStatus === '友だち中' ? (
                          <StatusBadge tone="success" size="compact">友だち</StatusBadge>
                        ) : (
                          <span className={styles.cellSub}>{friend.currentStatus ?? '—'}</span>
                        )}
                      </Td>
                      {/* 経路の設定タグは、個々の友だちへ付いたタグの実績ではない。口が返すまで代用しない。 */}
                      <Td className={styles.colTags}><span className={styles.cellSub}>—</span></Td>
                      <Td className={styles.colResult}><span className={styles.cellFaint}>{friend.conversion ?? '—'}</span></Td>
                      <Td className={styles.colMenu}>
                        <div className={styles.menuBox}>
                          <RowMenu
                            label={`「${friend.displayName}」の操作`}
                            open={openFriendMenuId === friend.id}
                            onOpenChange={(next) => setOpenFriendMenuId(next ? friend.id : null)}
                            items={[
                              { id: 'view', label: '友だちを見る', onSelect: () => { setOpenFriendMenuId(null); router.push(`/friends/detail?id=${encodeURIComponent(friend.id)}`) } },
                              { id: 'chat', label: 'チャットを開く', onSelect: () => { setOpenFriendMenuId(null); router.push(`/chats?friend=${encodeURIComponent(friend.id)}`) } },
                            ]}
                          />
                        </div>
                      </Td>
                    </Tr>
                  )
                })}
              </tbody>
            </DataTable>
          )}
          {friendRows.length > 0 ? (
            <div className={styles.pager}>
              {/* 1ページだけのときは送りの部品が出ないので、件数の行だけ出す（絵は件数とページ送りの1行）。 */}
              {friendPageCount > 1 ? (
                <Pagination page={friendPage} pageCount={friendPageCount} onPageChange={setFriendPage} summary={friendSummary} />
              ) : (
                <p className={styles.pagerSummary}>{friendSummary}</p>
              )}
            </div>
          ) : null}
        </section>

        <div className={styles.bottom}>
          <section className={styles.box} aria-labelledby="inflow-links-to">
            <h2 className={styles.boxTitle} id="inflow-links-to">この経路のつながる先</h2>
            <dl className={styles.kv}>
              <div className={styles.kvRow}><dt>コンバージョン</dt><dd>{funnel ? `${formatNumber(funnel.cv_count)}件` : '—'}</dd></div>
              <div className={styles.kvRow}><dt>シナリオ配信</dt><dd>{scenarioName ?? 'なし'}</dd></div>
              <div className={styles.kvRow}><dt>マイル</dt><dd>なし</dd></div>
            </dl>
          </section>
          <section className={styles.box} aria-labelledby="inflow-qr">
            <h2 className={styles.boxTitle} id="inflow-qr">QR コード</h2>
            <dl className={styles.kv}>
              <div className={styles.kvRow}><dt>大きさ</dt><dd className={styles.kvAccent}>320 × 320</dd></div>
              <div className={styles.kvRow}><dt>形式</dt><dd>PNG・印刷用 PDF</dd></div>
              <div className={styles.kvRow}><dt>作った日</dt><dd>{createdDate}</dd></div>
            </dl>
            <div className={styles.boxFoot}>
              <Button variant="text" href={qrDownloadUrl} download={`referral-${route.refCode}.png`}>→ QR コードを保存</Button>
            </div>
          </section>
        </div>
      </>}

      {qrOpen && route ? (
        <QrDialog
          route={{ refCode: route.refCode, name: route.name, genre: route.genre, isActive: route.isActive, id: route.id }}
          onClose={() => setQrOpen(false)}
        />
      ) : null}
      {editingRoute && route ? (
        <EditRouteModal
          route={route}
          pools={pools}
          scenarios={scenarios}
          templates={templates}
          tags={tags}
          existingGenres={[...new Set(routes.map((entryRoute) => entryRoute.genre).filter((genre): genre is string => !!genre))]}
          onClose={() => setEditingRoute(false)}
          onSaved={(savedRoute) => {
            setRoutes((current) => current.map((entryRoute) => (entryRoute.id === savedRoute.id ? savedRoute : entryRoute)))
            setRoute(savedRoute)
            setEditingRoute(false)
          }}
        />
      ) : null}
      {route ? (
        <Dialog
          open={deleteOpen}
          title={`「${route.name}」を削除しますか？`}
          description={`このURLは ${route.createdAt.slice(5, 10).replace('-', '/')} から使われています。削除すると同じURLは開けなくなります。`}
          tone="destructive"
          designNode="UIaM7"
          designWidth={840}
          busy={deleting}
          error={deleteError || undefined}
          confirmLabel={deleteChoice === 'stop' ? '受けるのをやめる' : deleteChoice === 'redirect' ? '別のリンクへ送る' : 'この経路を削除する'}
          onConfirm={() => {
            if (deleteChoice === 'delete' && deleteConfirmationName !== route.name) return
            void applyDeleteChoice()
          }}
          onCancel={() => { if (!deleting) setDeleteOpen(false) }}
        >
          <div className={styles.deleteBody}>
            <Notice tone="danger" message="削除すると、次のことが起きます">
              <ul className={styles.deleteEffects}>
                <li>貼り付けたURL・QRコード：このURLを置いた投稿や広告から開けなくなります（差し替えが必要）</li>
                <li>{`この経路から来た記録：${formatNumber(funnel?.friend_add_count ?? 0)}人の流入元と成果は過去の記録として残ります`}</li>
                <li>追加時の動き：新しい友だちへのタグ付けとシナリオ開始が止まります</li>
              </ul>
            </Notice>
            <p className={styles.deleteSafe}>この経路から来た友だちと、付いたタグ・進んでいるシナリオは消えません。</p>
            <RadioCardGroup legend="どうしますか？" legendVisible className={styles.deleteChoices}>
              {DELETE_CHOICES.filter(([value]) => value !== 'delete' || canPermanentlyDelete).map(([value, title, description]) => (
                <RadioCard
                  key={value}
                  name="inflow-delete-choice"
                  value={value}
                  checked={deleteChoice === value}
                  disabled={deleting}
                  onChange={() => { setDeleteChoice(value); setDeleteError('') }}
                  title={title}
                  note={description}
                />
              ))}
            </RadioCardGroup>
            {deleteChoice === 'redirect' ? (
              <div className={styles.deleteField}>
                <span className={styles.deleteChoiceTitle}>転送先のリンク</span>
                <Select
                  aria-label="転送先のリンク"
                  id="inflow-redirect-target"
                  value={redirectTargetId}
                  disabled={deleting}
                  onChange={setRedirectTargetId}
                  size="full"
                  options={[
                    { value: '', label: '選んでください' },
                    ...routes.filter((candidate) => candidate.id !== route.id).map((candidate) => ({ value: candidate.id, label: `${candidate.name}（${candidate.refCode}）` })),
                  ]}
                />
                <span className={styles.note}>先頭を自動で選ぶことはしません。必ず選んでください。</span>
              </div>
            ) : null}
            {deleteChoice === 'delete' ? (
              <label className={styles.deleteField}>
                <span className={styles.deleteChoiceTitle}>{`完全削除するには「${route.name}」と入力`}</span>
                <input
                  value={deleteConfirmationName}
                  disabled={deleting}
                  onChange={(event) => setDeleteConfirmationName(event.target.value)}
                  autoComplete="off"
                  className={styles.fieldInput}
                />
                <span className={styles.note}>空白や大文字・小文字も含め、現在の経路名と同じ入力が必要です。</span>
              </label>
            ) : null}
          </div>
        </Dialog>
      ) : null}
    </DetailPage>
  )
}

export default function InflowDetailV8() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <InflowDetailContent />
    </Suspense>
  )
}
