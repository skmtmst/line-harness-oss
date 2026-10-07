'use client'

/*
 * ★V8 EC連携（Pencil `GmVR5`。つなぎ先は `iLJmw`、定期便は `wqC8x`）。
 *
 * 取り込みの記録（出来事ごとの処理）の動きは今までの画面（app/ec-commerce/page.tsx の EventsPanel）と同じ：
 * アカウントと一体で持つ値（#685）・サーバ側の絞り込みとページ送り・検索の遅らせ・もう一度やる（409 の読み直し）・
 * 注文の状況のパネル。処理はここへ写した（src/v8 は @/app を読めない）。
 * 定期便・つなぎ先・注文の状況のパネルは今の部品を入口（page.tsx）から差し込む。
 * 動きの一覧は同じ場所の BEHAVIOR.md。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CircleDot, MoreHorizontal, Plug, Star } from 'lucide-react'
import { ecEventLabel, type ApiResponse } from '@line-crm/shared'
import Button from '@/components/shared/button'
import IconButton from '@/components/shared/icon-button'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import FilterChip from '@/components/shared/filter-chip'
import HelpTip from '@/components/shared/help-tip'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import ListState from '@/components/shared/list-state'
import Pagination from '@/components/shared/pagination'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import ListRange from '@/components/ui/list-range'
import { useAccount } from '@/contexts/account-context'
import {
  ApiError,
  api,
  fetchApi,
  type EcActionExecution,
  type EcActionExecutionList,
  type EcActionExecutionStatus,
  type EcCommerceOverview,
  type EcFailureKind,
  type EcOrder,
} from '@/lib/api'
import { formatDateTime, formatNumber } from '@/lib/format'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { SbSettingsScreen } from '../sb-frame/settings-screen'
import styles from './screen.module.css'

export type EcTabKey = 'events' | 'identity' | 'subscriptions' | 'connector'

const TABS: ReadonlyArray<{ key: EcTabKey; label: string; href: string }> = [
  { key: 'events', label: '取り込みの記録', href: '/ec-commerce' },
  { key: 'identity', label: '会員のつき合わせ', href: '/ec-commerce/identity-candidates' },
  { key: 'subscriptions', label: '定期便', href: '/ec-commerce?tab=subscriptions' },
  { key: 'connector', label: 'つなぎ先', href: '/ec-commerce?tab=connector' },
]

/* 失敗・見送りの分類（app/ec-commerce/ec-failure.ts の写し。表示語だけ）。 */
const FAILURE_KIND_LABEL: Record<EcFailureKind, string> = {
  unlinked: '未連携',
  not_following: 'フォロー外',
  permission: '権限・認証',
  communication: '通信の失敗',
  rejected: '送信の拒否',
  by_setting: '設定で停止',
  internal: '処理の失敗',
}

type StatusTone = 'good' | 'info' | 'muted' | 'danger'
const ACTION_STATUS: Record<EcActionExecutionStatus, { label: string; tone: StatusTone }> = {
  pending: { label: '処理中', tone: 'info' },
  processing: { label: '処理中', tone: 'info' },
  succeeded: { label: '処理完了', tone: 'good' },
  skipped: { label: '送信なし', tone: 'muted' },
  retryable_failed: { label: '失敗', tone: 'danger' },
  permanent_failed: { label: '失敗', tone: 'danger' },
}

/* 「したこと」列。worker が実際に行う処理を運用の言葉で書く（今の画面と同じ）。 */
const ACTION_LABEL: Record<string, string> = {
  'ec.order.confirmed': '注文ありがとうございますを送信',
  'ec.order.payment_received': '定期便のご案内を送信',
  'ec.order.bank_transfer_reminder': '振込期限の案内を送信',
  'ec.order.shipped': 'お荷物を送りましたを送信・発送後の案内を予約',
  'ec.order.cancelled': '注文の取り消しを反映・発送後の案内を停止',
  'ec.order.refunded': '成果を取り消し・マイルを調整・発送後の案内を停止',
  'ec.subscription.upcoming': '次回定期便の案内を送信',
  'ec.subscription.payment_failed': '決済失敗の案内を送信',
  'ec.subscription.card_updated': 'カード変更の結果を送信',
  'ec.subscription.cancelled': '定期便の解約を反映・解約の案内を送信',
  'ec.customer.profile_updated': '会員情報を更新',
}

/* R166: LINE へ何も送らない処理が成功したときは、送ったように見せない。 */
const NON_SENDING_STATUS_LABEL: Record<string, string> = {
  'ec.customer.profile_updated': '更新完了',
  'ec.order.cancelled': '反映完了',
  'ec.order.refunded': '反映完了',
}

function actionStatusLabel(action: { status: EcActionExecutionStatus; eventType: string }): string {
  if (action.status === 'succeeded') return NON_SENDING_STATUS_LABEL[action.eventType] ?? ACTION_STATUS.succeeded.label
  return ACTION_STATUS[action.status].label
}

function actionDone(action: EcActionExecution): string {
  if (action.status === 'retryable_failed' || action.status === 'permanent_failed') {
    return action.errorMessage ?? `${action.attemptCount}回やり直しました`
  }
  if (action.status === 'skipped') {
    return action.eventType === 'ec.order.shipped' && action.errorCode === 'notification_disabled'
      ? `${action.errorMessage ?? '通知は送りませんでした'}。発送後の案内は予約しました`
      : action.errorMessage ?? '何もしていません'
  }
  return ACTION_LABEL[action.eventType] ?? `未対応の出来事（${action.eventType}）`
}

const SHORT_DATE_TIME = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
})

/** 一覧の日時（年なし・例 9/30 10:12、日本時間）。壊れた値は「—」。 */
function dateTime(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? '—' : SHORT_DATE_TIME.format(date)
}

/** 補足の日時（年なし・曜日つき）。 */
function longDateTime(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? '—' : formatDateTime(date)
}

const ACTION_PAGE_SIZE = 20

type ActionTab = 'all' | 'succeeded' | 'processing' | 'skipped' | 'failed'
type LoadState = 'loading' | 'ready' | 'empty' | 'error' | 'forbidden'
type OverviewWithLatency = EcCommerceOverview & { averageDeliverySeconds: number | null; latencySampleCount: number }
type ImportAction = EcActionExecution & { eventLabel: string; order: EcOrder | null }
type ImportList = Omit<EcActionExecutionList, 'items'> & { items: ImportAction[] }
type ImportRecords = { items: ImportAction[]; summary: EcActionExecutionList['summary'] | null; total: number }
/* 取得した値は「どのLINEアカウントで取ったか」と一体で持つ（#685）。 */
type AccountBound<T> = { accountId: string | null; state: LoadState; data: T }

const EMPTY_RECORDS: ImportRecords = { items: [], summary: null, total: 0 }

function pendingFor<T>(accountId: string | null, data: T): AccountBound<T> {
  return { accountId, state: accountId ? 'loading' : 'empty', data }
}

function boundTo<T>(slot: AccountBound<T>, accountId: string | null, empty: T): AccountBound<T> {
  return slot.accountId === accountId ? slot : pendingFor(accountId, empty)
}

function actionServerFilter(status: ActionTab): { status?: 'succeeded' | 'skipped'; statusGroup?: 'processing' | 'failed' } {
  if (status === 'succeeded' || status === 'skipped') return { status }
  if (status === 'processing' || status === 'failed') return { statusGroup: status }
  return {}
}

export type OrderDrawerRender = (props: {
  orderId: string | null
  accountId: string | null
  onClose: () => void
  onRetryAction: (action: EcActionExecution) => Promise<void>
  retryingId: string | null
}) => ReactNode

function EventsPanel({ accountId, renderOrderDrawer }: { accountId: string | null; renderOrderDrawer?: OrderDrawerRender }) {
  const [overviewSlot, setOverviewSlot] = useState<AccountBound<OverviewWithLatency | null>>(() => pendingFor(accountId, null))
  const [recordsSlot, setRecordsSlot] = useState<AccountBound<ImportRecords>>(() => pendingFor(accountId, EMPTY_RECORDS))
  const [pageSlot, setPageSlot] = useState<{ accountId: string | null; page: number }>({ accountId, page: 1 })
  const [query, setQuery] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [status, setStatus] = useState<ActionTab>('all')
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest')
  const [retryingSlot, setRetryingSlot] = useState<{ accountId: string | null; id: string | null }>({ accountId, id: null })
  const [noticeSlot, setNoticeSlot] = useState<{ accountId: string | null; notice: { tone: 'success' | 'error'; text: string } | null }>({ accountId, notice: null })
  const [detailSlot, setDetailSlot] = useState<{ accountId: string | null; orderId: string | null }>({ accountId, orderId: null })
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const router = useRouter()
  const retryingId = retryingSlot.accountId === accountId ? retryingSlot.id : null
  const detailOrderId = detailSlot.accountId === accountId ? detailSlot.orderId : null
  const overviewLoadSeq = useRef(0)
  const listLoadSeq = useRef(0)
  const currentAccountIdRef = useRef(accountId)
  currentAccountIdRef.current = accountId
  const isFirstQueryEffect = useRef(true)

  const overviewView = boundTo(overviewSlot, accountId, null)
  const recordsView = boundTo(recordsSlot, accountId, EMPTY_RECORDS)
  const overview = overviewView.data
  const overviewState = overviewView.state
  const actions = recordsView.data.items
  const actionSummary = recordsView.data.summary
  const actionTotal = recordsView.data.total
  const listState = recordsView.state
  const page = pageSlot.accountId === accountId ? pageSlot.page : 1
  const notice = noticeSlot.accountId === accountId ? noticeSlot.notice : null
  const setPage = useCallback((next: number) => setPageSlot({ accountId, page: next }), [accountId])
  const setNotice = useCallback((next: { tone: 'success' | 'error'; text: string } | null) => {
    if (accountId !== currentAccountIdRef.current) return
    setNoticeSlot({ accountId, notice: next })
  }, [accountId])

  const loadOverview = useCallback(async (showLoading = true) => {
    if (accountId !== currentAccountIdRef.current) return
    const seq = overviewLoadSeq.current + 1
    overviewLoadSeq.current = seq
    if (!accountId) {
      setOverviewSlot({ accountId: null, state: 'empty', data: null })
      return
    }
    if (showLoading) setOverviewSlot((prev) => ({ accountId, state: 'loading', data: prev.accountId === accountId ? prev.data : null }))
    try {
      const response = await api.ecCommerce.overview(accountId) as ApiResponse<OverviewWithLatency>
      if (seq !== overviewLoadSeq.current) return
      if (!response.success) throw new Error('invalid_ec_overview')
      const data = response.data
      if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new Error('invalid_ec_overview')
      setOverviewSlot({ accountId, state: 'ready', data })
    } catch (error) {
      if (seq !== overviewLoadSeq.current) return
      setOverviewSlot((prev) => ({
        accountId,
        state: error instanceof ApiError && error.status === 403 ? 'forbidden' : 'error',
        data: prev.accountId === accountId ? prev.data : null,
      }))
    }
  }, [accountId])

  const loadRecords = useCallback(async (showLoading = true) => {
    if (accountId !== currentAccountIdRef.current) return
    const seq = listLoadSeq.current + 1
    listLoadSeq.current = seq
    if (!accountId) {
      setRecordsSlot({ accountId: null, state: 'empty', data: EMPTY_RECORDS })
      return
    }
    if (showLoading) setRecordsSlot((prev) => ({ accountId, state: 'loading', data: prev.accountId === accountId ? prev.data : EMPTY_RECORDS }))
    const params = new URLSearchParams({
      lineAccountId: accountId,
      view: 'actions',
      limit: String(ACTION_PAGE_SIZE),
      offset: String((page - 1) * ACTION_PAGE_SIZE),
      sort,
    })
    const filter = actionServerFilter(status)
    if (filter.status) params.set('status', filter.status)
    if (filter.statusGroup) params.set('statusGroup', filter.statusGroup)
    if (searchQuery) params.set('query', searchQuery)
    try {
      const response = await fetchApi<ApiResponse<ImportList>>(`/api/ec-commerce/events?${params}`)
      if (seq !== listLoadSeq.current) return
      if (!response.success || !Array.isArray(response.data?.items)) throw new Error('invalid_ec_records')
      setRecordsSlot({
        accountId,
        state: response.data.items.length ? 'ready' : 'empty',
        data: { items: response.data.items, summary: response.data.summary, total: response.data.total },
      })
    } catch (error) {
      if (seq !== listLoadSeq.current) return
      setRecordsSlot((prev) => ({
        accountId,
        state: error instanceof ApiError && error.status === 403 ? 'forbidden' : 'error',
        data: prev.accountId === accountId ? prev.data : EMPTY_RECORDS,
      }))
    }
  }, [accountId, page, searchQuery, sort, status])

  useEffect(() => { void loadOverview() }, [loadOverview])
  useEffect(() => { void loadRecords() }, [loadRecords])
  useEffect(() => {
    if (isFirstQueryEffect.current) {
      isFirstQueryEffect.current = false
      return
    }
    const timer = window.setTimeout(() => {
      setPage(1)
      setSearchQuery(query.trim())
    }, 300)
    return () => window.clearTimeout(timer)
  }, [query, setPage])

  const pageCount = Math.max(1, Math.ceil(actionTotal / ACTION_PAGE_SIZE))
  /* R599: 一覧が取れていない間は、一覧由来の状態別件数を出さない（未取得を 0 に見せない）。 */
  const listedSummary = listState === 'ready' || listState === 'empty' ? actionSummary : null
  const processingCount = listedSummary ? listedSummary.pending + listedSummary.processing : undefined
  const failedCount = listedSummary ? listedSummary.retryable_failed + listedSummary.permanent_failed : undefined
  const recordsNarrowing = searchQuery !== '' || status !== 'all'
  const clearRecordFilters = () => {
    setQuery('')
    setSearchQuery('')
    setStatus('all')
    setPage(1)
  }

  const retry = async (action: EcActionExecution) => {
    if (!accountId || !action.retryAvailable) return
    const retryAccountId = accountId
    setRetryingSlot({ accountId: retryAccountId, id: action.id })
    setNotice(null)
    try {
      const response = await api.ecCommerce.retryActionExecution(
        action.id,
        { lineAccountId: retryAccountId, expectedVersion: action.version },
        crypto.randomUUID(),
      )
      if (!response.success) throw new Error('retry_failed')
      setNotice({ tone: 'success', text: '失敗した処理だけを、もう一度行う待ち行列へ戻しました。' })
      await loadRecords(false)
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) await loadRecords(false)
      setNotice({
        tone: 'error',
        text: error instanceof ApiError && error.status === 409
          ? '別の担当者が先に更新しました。最新の状態を読み直しました。'
          : '処理をもう一度行う準備ができませんでした。時間をおいてやり直してください。',
      })
    } finally {
      setRetryingSlot((prev) => (prev.accountId === retryAccountId && prev.id === action.id ? { accountId: retryAccountId, id: null } : prev))
    }
  }

  const chips: ReadonlyArray<{ value: ActionTab; label: string; count: number | undefined }> = [
    { value: 'all', label: 'すべて', count: overview?.total },
    { value: 'succeeded', label: '処理完了', count: listedSummary?.succeeded },
    { value: 'processing', label: '処理中', count: processingCount },
    { value: 'failed', label: '失敗', count: failedCount },
    { value: 'skipped', label: '送信なし', count: listedSummary?.skipped },
  ]

  const rowMenu = (action: ImportAction): ActionMenuItem[] => {
    const order = action.order
    const friendId = action.friendId ?? order?.friendId ?? null
    return [
      friendId
        ? { id: 'friend', label: '中身を見る', onSelect: () => router.push(`/friends/detail?id=${encodeURIComponent(friendId)}`) }
        : { id: 'identity', label: 'つき合わせる', onSelect: () => router.push('/ec-commerce/identity-candidates') },
      ...(order ? [{ id: 'order', label: '注文の状況を見る', onSelect: () => setDetailSlot({ accountId, orderId: order.id }) }] : []),
      ...(action.retryAvailable
        ? [{
            id: 'retry',
            label: retryingId === action.id ? '戻しています…' : 'もう一度やる',
            disabled: retryingId === action.id,
            onSelect: () => void retry(action),
          }]
        : []),
    ]
  }

  const kpiDetailMissing = overviewState === 'error' || overviewState === 'forbidden'

  return (
    <>
      <KpiBand data-kpi-presentation="cards" gridClassName={styles.kpis}>
        <KpiCard presentation="card" icon={null} title="処理完了" value={listedSummary?.succeeded ?? null} unit="" detail="件" loading={listState === 'loading'} />
        <KpiCard presentation="card" icon={null} title="処理中" value={processingCount ?? null} unit="" detail="件" loading={listState === 'loading'} />
        <KpiCard presentation="card" icon={null} title="送信なし" value={listedSummary?.skipped ?? null} unit="" detail="件・送る設定がない" loading={listState === 'loading'} />
        <KpiCard presentation="card" icon={null} title="失敗" value={failedCount ?? null} unit="" detail="件" valueTone={failedCount ? 'warning' : 'default'} loading={listState === 'loading'} />
      </KpiBand>
      {kpiDetailMissing ? (
        <p className={styles.minor} role="status">
          {overviewState === 'forbidden'
            ? '集計を表示する権限がありません。一覧は取得できた範囲で表示しています。'
            : '集計だけを読み込めませんでした。一覧は取得できた範囲で表示しています。'}
          {overviewState === 'error' ? <button type="button" className={styles.inlineLink} onClick={() => void loadOverview(false)}>集計をもう一度読む</button> : null}
        </p>
      ) : null}
      {notice ? <p className={notice.tone === 'success' ? styles.noticeGood : styles.noticeBad} role={notice.tone === 'success' ? 'status' : 'alert'}>{notice.text}</p> : null}

      <div className={styles.toolbar}>
        <SearchField
          aria-label="取り込みの記録を探す"
          placeholder="取り込みの記録を探す"
          value={query}
          onChange={setQuery}
          className={styles.search}
        />
        {chips.map((chip) => (
          <FilterChip
            key={chip.value}
            selected={status === chip.value}
            icon={chip.value === 'all' ? <CircleDot size={13} aria-hidden="true" /> : <Star size={13} aria-hidden="true" />}
            onChange={() => {
              setPage(1)
              setStatus(chip.value)
            }}
          >
            {chip.count === undefined ? chip.label : `${chip.label} ${formatNumber(chip.count)}`}
          </FilterChip>
        ))}
        <span className={styles.spacer} />
        <span className={styles.sortBox}>
          <Select
            aria-label="取り込みの並び順"
            value={sort}
            onChange={(value) => setSort(value as typeof sort)}
            options={[
              { value: 'newest', label: '新しい順' },
              { value: 'oldest', label: '古い順' },
            ]}
          />
        </span>
      </div>

      {listState !== 'ready' ? (
        <ListState
          kind={listState}
          emptyPreset={accountId ? 'readonly' : 'createable'}
          title={listState === 'error'
            ? '取り込みの記録を読み込めませんでした'
            : listState === 'empty' && !accountId
              ? 'LINEアカウントを選択してください'
              : listState === 'empty' && recordsNarrowing
                ? '条件に合うものはありません'
                : undefined}
          description={listState === 'empty' && !accountId
            ? 'LINEアカウントを選ぶ欄で、確認するアカウントを選びます。'
            : listState === 'empty' && recordsNarrowing
              ? '札や検索を外すと、すべて出ます'
              : undefined}
          action={listState === 'empty' && accountId && recordsNarrowing
            ? <Button type="button" variant="secondary" onClick={clearRecordFilters}>条件を外す</Button>
            : undefined}
          onRetry={listState === 'error' ? () => void loadRecords(false) : undefined}
        />
      ) : (
        <div className={styles.table} role="table" aria-label="取り込みの記録">
          <div role="rowgroup">
            <div role="row" className={`${styles.row} ${styles.headRow}`}>
              <span role="columnheader">いつ・何が届いたか</span>
              <span role="columnheader">お客さま</span>
              <span role="columnheader">中身</span>
              <span role="columnheader">したこと</span>
              <span role="columnheader">状態</span>
              <span role="columnheader"><span className={styles.srOnly}>操作</span></span>
            </div>
          </div>
          <div role="rowgroup">
            {actions.map((action) => {
              const order = action.order
              const contents = order?.orderLines.length
                ? order.orderLines.map((line) => `${line.productName} × ${line.quantity}`).join('・')
                : '商品明細は未取得'
              const amount = order?.status === 'refunded' && order.refundedAmount !== null
                ? `−¥${formatNumber(order.refundedAmount)}`
                : order?.totalAmount === null || order?.totalAmount === undefined
                  ? null
                  : `¥${formatNumber(order.totalAmount)}`
              const statusInfo = ACTION_STATUS[action.status]
              const linked = Boolean(action.friendId ?? order?.friendId)
              const label = action.eventLabel || ecEventLabel(action.eventType, action.eventType)
              return (
                <div role="row" key={action.id} className={styles.row}>
                  <span role="cell" className={styles.stack}>
                    <span className={styles.main}>{dateTime(action.receivedAt)}</span>
                    <span className={styles.sub} title={action.orderNumber ? `注文 ${action.orderNumber}` : undefined}>{label}</span>
                  </span>
                  <span role="cell" className={styles.stack}>
                    <span className={styles.main}>{action.customerName ?? '見つかりません'}</span>
                    <span className={styles.sub}>{linked ? 'LINE 連携済み' : 'LINE 未連携'}</span>
                  </span>
                  <span role="cell" className={styles.text} title={amount ? `${contents}・${amount}` : contents}>
                    {amount ? `${contents}・${amount}` : contents}
                  </span>
                  <span role="cell" className={styles.done}>{actionDone(action)}</span>
                  <span role="cell" className={styles.stack}>
                    <span className={styles.status} data-tone={statusInfo.tone}>
                      <span className={styles.dot} aria-hidden="true" />
                      {actionStatusLabel(action)}
                    </span>
                    {action.failureKind && action.status !== 'succeeded'
                      ? <span className={styles.sub}>{FAILURE_KIND_LABEL[action.failureKind]}</span>
                      : null}
                  </span>
                  <span role="cell" className={styles.menuBox}>
                    <IconButton
                      title="この行のその他操作"
                      aria-label="この行のその他操作"
                      aria-expanded={openMenuId === action.id}
                      onClick={() => setOpenMenuId((current) => (current === action.id ? null : action.id))}
                    >
                      <MoreHorizontal size={16} aria-hidden="true" />
                    </IconButton>
                    <ActionMenu
                      open={openMenuId === action.id}
                      ariaLabel="この行の操作"
                      onClose={() => setOpenMenuId(null)}
                      items={rowMenu(action)}
                    />
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <p className={styles.foot}>
        <span>「会員のつき合わせ」で、ネットショップの会員と LINE の友だちを結びつけると、送信なしが減ります。</span>
        <HelpTip label="つき合わせの仕方">
          ECの注文には、LINEの友だちが誰なのかが書かれていません。メールアドレスか電話番号で結びつけています。どちらも一致しなかった注文は「会員のつき合わせ」に並びます。
        </HelpTip>
      </p>
      {listState === 'ready' ? (
        <div className={styles.pager}>
          <span className={styles.minorText}>
            <ListRange label="取り込みの記録" total={actionTotal} first={(page - 1) * ACTION_PAGE_SIZE + 1} last={(page - 1) * ACTION_PAGE_SIZE + actions.length} />
            {` 最後に届いた ${longDateTime(overview?.lastReceivedAt ?? null)}・今日 ${overview ? formatNumber(overview.last24h) : '—'}件。注文の本文や接続用の秘密値は表示しません。`}
          </span>
          {pageCount > 1 ? <Pagination page={page} pageCount={pageCount} onPageChange={setPage} /> : null}
        </div>
      ) : null}
      {renderOrderDrawer?.({
        orderId: detailOrderId,
        accountId,
        onClose: () => setDetailSlot({ accountId, orderId: null }),
        onRetryAction: retry,
        retryingId,
      })}
    </>
  )
}

/** 4つの入口と、各 API が数えた実件数（取得できない数は作らない）。 */
function EcTabsV8({ accountId, active }: { accountId: string | null; active: EcTabKey }) {
  const [counts, setCounts] = useState<Partial<Record<EcTabKey, number>>>({})
  useEffect(() => {
    let alive = true
    setCounts({})
    if (!accountId) return () => { alive = false }
    Promise.allSettled([
      api.ecCommerce.overview(accountId),
      api.ecCommerce.operationIdentityCandidates({ lineAccountId: accountId, limit: 1 }),
    ]).then(([overview, identities]) => {
      if (!alive) return
      const ov = overview.status === 'fulfilled' && overview.value.success ? overview.value.data : null
      setCounts({
        events: ov?.total,
        identity: identities.status === 'fulfilled' && identities.value.success ? identities.value.data.summary.unmatched : undefined,
        subscriptions: ov?.subscriptions,
      })
    })
    return () => { alive = false }
  }, [accountId])
  return (
    <nav className={styles.tabs} aria-label="EC連携の中の切り替え">
      {TABS.map((tab) => {
        const count = tab.key === 'connector' || tab.key === 'subscriptions' ? undefined : counts[tab.key]
        return (
          <Link
            key={tab.key}
            href={tab.href}
            className={styles.tab}
            aria-current={active === tab.key ? 'page' : undefined}
            title={tab.key === 'subscriptions' && counts.subscriptions !== undefined ? `定期便 ${formatNumber(counts.subscriptions)}件` : undefined}
          >
            {count === undefined ? tab.label : `${tab.label} ${formatNumber(count)}`}
          </Link>
        )
      })}
    </nav>
  )
}

export default function EcCommerceScreen({
  tab,
  renderSubscriptions,
  renderConnector,
  renderOrderDrawer,
}: {
  tab: EcTabKey
  renderSubscriptions?: (accountId: string | null) => ReactNode
  renderConnector?: (accountId: string | null, canEdit: boolean) => ReactNode
  renderOrderDrawer?: OrderDrawerRender
}) {
  const { selectedAccountId } = useAccount()
  const staffRole = useStaffRole()
  const canEdit = staffRole === null || canManageRole(staffRole)
  const actions = tab === 'events'
    ? <Button href="/ec-commerce?tab=connector" variant="secondary"><Plug className={styles.btnIcon} aria-hidden="true" />つなぎ先の設定</Button>
    : tab === 'subscriptions' && canEdit
      ? <Button href="/broadcasts/new" variant="primary">対象を選んで送る</Button>
      : undefined
  return (
    <SbSettingsScreen
      boardId={tab === 'subscriptions' ? 'wqC8x' : tab === 'connector' ? 'iLJmw' : 'GmVR5'}
      layout="narrow-nav"
      title="EC連携"
      description="ネットショップから注文・発送・定期便の出来事を取り込み、LINE の友だちと結びつけます。"
      actions={actions}
    >
      <EcTabsV8 accountId={selectedAccountId} active={tab} />
      {tab === 'events' ? <EventsPanel accountId={selectedAccountId} renderOrderDrawer={renderOrderDrawer} /> : null}
      {tab === 'subscriptions' ? renderSubscriptions?.(selectedAccountId) : null}
      {tab === 'connector' ? renderConnector?.(selectedAccountId, canEdit) : null}
    </SbSettingsScreen>
  )
}
