'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { ecEventLabel, type ApiResponse } from '@line-crm/shared'
import { useMergedTab } from '@/components/layout/merged-tabs'
import Button from '@/components/shared/button'
import IconButton from '@/components/shared/icon-button'
import ActionMenu from '@/components/shared/action-menu'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import PageHeaderH2 from '@/components/layout/page-header-h2'
import Pagination from '@/components/shared/pagination'
import Select from '@/components/shared/select'
import SummaryCard from '@/components/shared/summary-card'
import KpiCollapse from '@/components/ui/kpi-collapse'
import ListRange from '@/components/ui/list-range'
import { ActionCell, DataTable, Td, Th, TableHeadRow, Tr } from '@/components/shared/table'
import { Tabs } from '@/components/shared/tabs'
import { useAccount } from '@/contexts/account-context'
import {
  ApiError,
  api,
  fetchApi,
  type EcActionExecution,
  type EcActionExecutionList,
  type EcActionExecutionStatus,
  type EcCommerceOverview,
  type EcOrder,
} from '@/lib/api'
import ConnectorPanel from './connector-panel'
import EcTabs from './ec-tabs-view'
import SubscriptionsPanel from './subscriptions-panel'
import OrderDetailDrawer from './order-detail-drawer'
import { EC_TABS } from './ec-tabs'
import { FAILURE_KIND_TEXT } from './ec-failure'
import { formatEcDateTime as dateTime } from './ec-datetime'
import styles from './ec-commerce-v6.module.css'

const ACTION_STATUS: Record<EcActionExecutionStatus, { label: string; tone: string }> = {
  pending: { label: '処理中', tone: styles.statusWarn },
  processing: { label: '処理中', tone: styles.statusWarn },
  succeeded: { label: '送信完了', tone: styles.statusGood },
  skipped: { label: '送信なし', tone: styles.statusMuted },
  retryable_failed: { label: '失敗', tone: styles.statusDanger },
  permanent_failed: { label: '失敗', tone: styles.statusDanger },
}

/*
 * 「したこと」列。worker が実際に行う処理を運用の言葉で書く。
 * IDEA-21: 発送完了では発送後の案内（NEN配信）も予約され、取り消し・返金では
 * その注文の待っている案内を止める。定期便の出来事も通知を送るので、
 * 「未対応の出来事」とは出さない。
 */
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

const ACTION_PAGE_SIZE = 20

type ActionTab = 'all' | 'succeeded' | 'processing' | 'skipped' | 'failed'
type LoadState = 'loading' | 'ready' | 'empty' | 'error' | 'forbidden'
type OverviewWithLatency = EcCommerceOverview & {
  averageDeliverySeconds: number | null
  latencySampleCount: number
}
type ImportAction = EcActionExecution & {
  eventLabel: string
  order: EcOrder | null
}
type ImportList = Omit<EcActionExecutionList, 'items'> & { items: ImportAction[] }
type ImportRecords = {
  items: ImportAction[]
  summary: EcActionExecutionList['summary'] | null
  total: number
}
/*
 * 取得した値は「どのLINEアカウントで取ったか」と必ず一体で持つ。
 * 描く前に取得元と今の選択を突き合わせ、違えば捨てる。これで
 * アカウントAの集計がBへ切り替えた画面に残ることがない(#685)。
 */
type AccountBound<T> = { accountId: string | null; state: LoadState; data: T }

const EMPTY_RECORDS: ImportRecords = { items: [], summary: null, total: 0 }

function pendingFor<T>(accountId: string | null, data: T): AccountBound<T> {
  return { accountId, state: accountId ? 'loading' : 'empty', data }
}

/*
 * 取得元が今の選択と同じときだけ、持っている値をそのまま使う。
 * 切替は再描画と同時に起きるので、消去は同期的で、待ち時間中に
 * 前のアカウントの数字が見えることはない。
 */
function boundTo<T>(slot: AccountBound<T>, accountId: string | null, empty: T): AccountBound<T> {
  return slot.accountId === accountId ? slot : pendingFor(accountId, empty)
}

/*
 * タブの絞りはサーバ側へ渡し、その後でページを切る(共通一覧契約)。
 * 「処理中」「失敗」は2状態のまとめなので statusGroup で送る。
 */
function actionServerFilter(status: ActionTab): { status?: 'succeeded' | 'skipped'; statusGroup?: 'processing' | 'failed' } {
  if (status === 'succeeded' || status === 'skipped') return { status }
  if (status === 'processing' || status === 'failed') return { statusGroup: status }
  return {}
}

function EventsPanel({ accountId }: { accountId: string | null }) {
  const [overviewSlot, setOverviewSlot] = useState<AccountBound<OverviewWithLatency | null>>(() => pendingFor(accountId, null))
  const [recordsSlot, setRecordsSlot] = useState<AccountBound<ImportRecords>>(() => pendingFor(accountId, EMPTY_RECORDS))
  const [pageSlot, setPageSlot] = useState<{ accountId: string | null; page: number }>({ accountId, page: 1 })
  const [query, setQuery] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [status, setStatus] = useState<ActionTab>('all')
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest')
  const [retryingSlot, setRetryingSlot] = useState<{ accountId: string | null; id: string | null }>({ accountId, id: null })
  const [noticeSlot, setNoticeSlot] = useState<{ accountId: string | null; notice: { tone: 'success' | 'error'; text: string } | null }>({ accountId, notice: null })
  /*
   * 「この注文の状況」パネル。一覧の他の値と同じく、開いた対象は必ず
   * 「どのアカウントで開いたか」と一体で持つ。アカウントを切り替えた
   * 描画では不一致＝閉じる、に倒れるので別アカウントの注文が残らない。
   */
  const [detailSlot, setDetailSlot] = useState<{ accountId: string | null; orderId: string | null }>({ accountId, orderId: null })
  // 行の「その他」メニューの開き先（#641）
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const retryingId = retryingSlot.accountId === accountId ? retryingSlot.id : null
  const detailOrderId = detailSlot.accountId === accountId ? detailSlot.orderId : null
  /* 絞りとページを同時に変えたとき、古い読み込みの返事で上書きしない。 */
  const overviewLoadSeq = useRef(0)
  const listLoadSeq = useRef(0)
  /*
   * 常に「今どのアカウントが選ばれているか」を持つ。retry() のような
   * awaitをまたぐ処理は、開始時のaccountIdをクロージャで抱えたまま切替後も
   * 動き続けるので、この ref と突き合わせて古い方を弾く(#685再差し戻し)。
   * 効果(useEffect)ではなく描画本体で直接更新し、次のawait再開までに必ず最新化する。
   */
  const currentAccountIdRef = useRef(accountId)
  currentAccountIdRef.current = accountId
  /*
   * 検索debounceのuseEffect([query, setPage])は、マウント直後のqueryの
   * 初期値('')でも必ず1回実行される。ここをスキップしないと、一覧が出た
   * 直後にページ送りしたユーザーが、300ms後の無条件setPage(1)で黙って
   * 1ページ目へ戻される(#685、司令塔切り分け2026-09-10、列車229で実証)。
   * queryが実際に変わったときだけページを1へ戻す、が本来の意図。
   */
  const isFirstQueryEffect = useRef(true)

  /*
   * ここが「同期的な消去」。アカウントが変わった描画では、取得元の違う値は
   * 一度も画面に出ないまま読み込み中へ戻る。効果(useEffect)を待たない。
   */
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
  const setNotice = useCallback(
    (next: { tone: 'success' | 'error'; text: string } | null) => {
      /* retry() が抱えた古い accountId のクロージャから呼ばれたら、通知も出さない。 */
      if (accountId !== currentAccountIdRef.current) return
      setNoticeSlot({ accountId, notice: next })
    },
    [accountId],
  )

  const loadOverview = useCallback(async (showLoading = true) => {
    /*
     * retry() が抱えた古い accountId のクロージャから呼ばれた場合はここで止める。
     * 共有の overviewLoadSeq を進めてしまうと、あとから来る新アカウントの
     * 正常な返事がその進んだ seq と食い違って捨てられ、読み込み中のまま固まる。
     */
    if (accountId !== currentAccountIdRef.current) return
    const seq = overviewLoadSeq.current + 1
    overviewLoadSeq.current = seq
    if (!accountId) {
      setOverviewSlot({ accountId: null, state: 'empty', data: null })
      return
    }
    /*
     * 取り直しの間に前の値を残すのは、同じアカウントの取り直しだけ。
     * 取得元が違えば null から始める。
     */
    if (showLoading) setOverviewSlot((prev) => ({ accountId, state: 'loading', data: prev.accountId === accountId ? prev.data : null }))
    try {
      const overviewResponse = await api.ecCommerce.overview(accountId) as ApiResponse<OverviewWithLatency>
      if (seq !== overviewLoadSeq.current) return
      if (!overviewResponse.success) throw new Error('invalid_ec_overview')
      const overviewData = overviewResponse.data
      const hasOverview = typeof overviewData === 'object'
        && overviewData !== null
        && !Array.isArray(overviewData)
      if (!hasOverview) throw new Error('invalid_ec_overview')
      setOverviewSlot({ accountId, state: 'ready', data: overviewData })
    } catch (error) {
      if (seq !== overviewLoadSeq.current) return
      setOverviewSlot((prev) => ({
        accountId,
        state: error instanceof ApiError && error.status === 403 ? 'forbidden' : 'error',
        /* 失敗時に数字を残すのは、同じアカウントで一度取れているときだけ。 */
        data: prev.accountId === accountId ? prev.data : null,
      }))
    }
  }, [accountId])

  const loadRecords = useCallback(async (showLoading = true) => {
    /* 同上。古いアカウントのretry()が共有listLoadSeqを進めて新アカウントの一覧取得を無効化しない。 */
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
  /* ページ・お知らせもアカウントと一体で持つので、切替の効果で戻す必要はない。 */

  const pageCount = Math.max(1, Math.ceil(actionTotal / ACTION_PAGE_SIZE))

  /*
   * 絞り込みで0件のときの「元に戻す」動線（#635）。検索語と状態タブを
   * まとめて初期へ戻す。sort は「絞り込み」ではなく並びなので触らない。
   */
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
      /*
       * APIの応答を待つ間にBへ切り替えられていても、ここでは弾かない。
       * setNotice・loadRecordsのそれぞれが呼び出し先でaccountId不一致を
       * 自己判定して戻る(フェンスは呼び出し先1箇所に一本化する)。
       */
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
      /* 別のretryが同じアカウントで既に始まっていたら、それを消さない。 */
      setRetryingSlot((prev) => (prev.accountId === retryAccountId && prev.id === action.id ? { accountId: retryAccountId, id: null } : prev))
    }
  }

  return (
    <>
      {/* #975 U060: 390pxでは先頭2件だけ出し、残りは「集計を見る」で開く。 */}
      <KpiCollapse gridClassName={styles.kpis}>
        <SummaryCard variant="v6" title="今日 取り込んだ" value={overview?.last24h ?? null} unit="件" detail={overview?.byType.map((item) => `${item.label} ${item.count.toLocaleString('ja-JP')}`).join('・') ?? '内訳は未取得'} />
        <SummaryCard variant="v6" title="つながっていない注文" value={overview?.identityPending ?? null} unit="件" detail="LINEの友だちが見つかりません" badge="つき合わせ" badgeTone="neutral" />
        <SummaryCard variant="v6" title="取り込みに失敗" value={overview?.failed ?? null} unit="件" detail="3回やり直しても入りませんでした" badge="確認" badgeTone="neutral" />
        <div className="min-w-0 rounded-card border border-hairline bg-canvas p-4">
          <p className="text-xs font-semibold text-ink-faint">最後に届いた</p>
          <p className="mt-1 text-2xl font-bold text-ink tabular-nums">{dateTime(overview?.lastReceivedAt ?? null)}</p>
          <p className="mt-1 text-xs text-ink-faint">{overview?.averageDeliverySeconds == null
            ? '到着時間は測定できません'
            : `直近24時間の平均 ${overview.averageDeliverySeconds.toLocaleString('ja-JP')}秒（${overview.latencySampleCount.toLocaleString('ja-JP')}件）`}</p>
        </div>
      </KpiCollapse>
      {/*
        ★V7 `x63W5x`：補助のデータ（集計）だけ取れないときは、その場所に
        小さく1行だけ。ピンクの帯にしない。一覧は普通に出す。文言と読み直す口
        は契約試験が守る。
      */}
      {overviewState === 'error' || overviewState === 'forbidden' ? (
        <p className="text-ink-secondary mb-4 text-xs" role="status">
          {overviewState === 'forbidden'
            ? '集計を表示する権限がありません。一覧は取得できた範囲で表示しています。'
            : '集計だけを読み込めませんでした。一覧は取得できた範囲で表示しています。'}
          {overviewState === 'error' ? <button type="button" className="text-action ml-2 font-semibold hover:underline" onClick={() => void loadOverview(false)}>集計をもう一度読む</button> : null}
        </p>
      ) : null}
      <NoteBar>ECの注文には、LINEの友だちが誰なのかが書かれていません。メールアドレスか電話番号で結びつけています。どちらも一致しなかった注文は「会員のつき合わせ」に並びます。</NoteBar>
      {notice ? <div className={notice.tone === 'success' ? styles.noticeSuccess : styles.noticeError} role="status">{notice.text}</div> : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          type="search"
          className="min-w-80 flex-1 rounded-control border border-hairline bg-canvas px-3 py-2 text-sm text-ink"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="注文番号・お名前・出来事で検索"
          aria-label="取り込みの記録を検索"
        />
        <div className="w-full sm:w-64">
          <Select
            aria-label="取り込みの並び順"
            size="full"
            value={sort}
            onChange={(value) => setSort(value as typeof sort)}
            options={[
              { value: 'newest', label: '取り込みが新しい順' },
              { value: 'oldest', label: '取り込みが古い順' },
            ]}
          />
        </div>
      </div>
      <Tabs items={([
          ['all', 'すべて', overview?.total],
          ['succeeded', '送信完了', actionSummary?.succeeded],
          ['processing', '処理中', (actionSummary?.pending ?? 0) + (actionSummary?.processing ?? 0)],
          ['skipped', '送信なし', actionSummary?.skipped],
          ['failed', '失敗', (actionSummary?.retryable_failed ?? 0) + (actionSummary?.permanent_failed ?? 0)],
        ] as const).map(([value, label, count]) => ({
          label,
          count,
          current: status === value,
          onClick: () => {
            setPage(1)
            setStatus(value)
          },
        }))} />
      {listState !== 'ready' ? (
        <ListState
          kind={listState}
          emptyPreset={accountId ? 'readonly' : 'createable'}
          title={listState === 'error'
            ? '取り込みの記録を読み込めませんでした'
            : listState === 'empty' && !accountId
              ? 'LINEアカウントを選択してください'
              : listState === 'empty' && recordsNarrowing
                ? '条件に合う取り込みの記録はありません'
                : undefined}
          description={listState === 'empty' && !accountId
            ? '左のメニュー上部で、確認するLINEアカウントを選びます。'
            : listState === 'empty' && recordsNarrowing
              ? '検索語や表示条件を変えてください。'
              : undefined}
          action={listState === 'empty' && accountId && recordsNarrowing
            ? <Button type="button" variant="secondary" onClick={clearRecordFilters}>検索と絞り込みを解除</Button>
            : undefined}
          onRetry={listState === 'error' ? () => void loadRecords(false) : undefined}
        />
      ) : <DataTable>
        <thead><TableHeadRow><Th>いつ・何が届いたか</Th><Th>お客様</Th><Th>中身</Th><Th>したこと</Th><Th>状態</Th><Th align="right">操作</Th></TableHeadRow></thead>
        <tbody>
          {actions.map((action) => {
            const order = action.order
            const contents = order?.orderLines.length
              ? order.orderLines.map((line) => `${line.productName} × ${line.quantity}`).join('・')
              : '商品明細は未取得'
            const amount = order?.status === 'refunded' && order.refundedAmount !== null
              ? `−¥${order.refundedAmount.toLocaleString('ja-JP')}`
              : order?.totalAmount === null || order?.totalAmount === undefined
                ? null
                : `¥${order.totalAmount.toLocaleString('ja-JP')}`
            const statusInfo = ACTION_STATUS[action.status]
            return <Tr key={action.id}>
              <Td><span className={styles.cellStack}><span className={styles.cellMain}>{dateTime(action.receivedAt)} ／ {action.eventLabel || ecEventLabel(action.eventType, action.eventType)}</span><span className={styles.cellSub}>{action.orderNumber ? `注文 ${action.orderNumber}${amount ? ` ／ ${amount}` : ''}` : '注文番号 —'}</span></span></Td>
              <Td>{action.customerName ?? <span className="text-xs text-ink-faint">見つかりません</span>}</Td>
              <Td><span className={order?.orderLines.length ? undefined : 'text-xs text-ink-faint'}>{contents}</span></Td>
              <Td>{action.status === 'retryable_failed' || action.status === 'permanent_failed'
                ? action.errorMessage ?? `${action.attemptCount}回やり直しました`
                : action.status === 'skipped'
                  /*
                   * 発送完了が通知停止（notification_disabled）で弾かれたときも、
                   * worker は通知設定を見る前に発送後の案内を予約している。
                   * 「何もしていません」と出すと届く案内の理由が追えないので、
                   * その場合だけ予約したことを添える。友だち未解決など予約に
                   * 届かない止まり方では errorMessage だけを出す。
                   */
                  ? action.eventType === 'ec.order.shipped' && action.errorCode === 'notification_disabled'
                    ? `${action.errorMessage ?? '通知は送りませんでした'}。発送後の案内は予約しました`
                    : action.errorMessage ?? '何もしていません'
                  : ACTION_LABEL[action.eventType] ?? `未対応の出来事（${action.eventType}）`}</Td>
              <Td>
                <span className={styles.cellStack}>
                  <span className={`${styles.status} ${statusInfo.tone}`}>{statusInfo.label}</span>
                  {/* IDEA-23: 失敗・見送りの分類（未連携／権限・認証／通信の失敗など）を状態の下へ添える。 */}
                  {action.failureKind && action.status !== 'succeeded'
                    ? <span className={styles.cellSub}>{FAILURE_KIND_TEXT[action.failureKind].label}</span>
                    : null}
                </span>
              </Td>
              <ActionCell>
                {/* #641: 主操作は枠つきボタン、残りは「その他（…）」へ集約。 */}
                {/* 友だち詳細は静的書き出しのため /friends/detail?id= 形。/friends/<id> は存在しない（IDEA-21 で修正）。 */}
                {(action.friendId ?? order?.friendId)
                  ? <Button href={`/friends/detail?id=${encodeURIComponent(action.friendId ?? order?.friendId ?? '')}`} variant="secondary">中身を見る</Button>
                  : <Button href="/ec-commerce/identity-candidates" variant="secondary">つき合わせる</Button>}
                {order || action.retryAvailable ? (
                  <>
                    <IconButton
                      aria-label="この行のその他操作"
                      aria-expanded={openMenuId === action.id}
                      onClick={() => setOpenMenuId((current) => (current === action.id ? null : action.id))}
                    >
                      <MoreHorizontal aria-hidden />
                    </IconButton>
                    <ActionMenu
                      open={openMenuId === action.id}
                      ariaLabel="この行の操作"
                      onClose={() => setOpenMenuId(null)}
                      items={[
                        /*
                         * IDEA-23: 注文がある行は「注文の状況を見る」から出来事→通知→成果まで辿れる。
                         * #670 23: 隣の「中身を見る」と並んだときに「注文の状況中身を見る」と
                         * 繋がって読めたため、動詞を付けて「〜を見る」同士の並びに直す。
                         */
                        ...(order
                          ? [{ id: 'order', label: '注文の状況を見る', onSelect: () => setDetailSlot({ accountId, orderId: order.id }) }]
                          : []),
                        ...(action.retryAvailable
                          ? [{
                              id: 'retry',
                              label: retryingId === action.id ? '戻しています…' : 'もう一度やる',
                              disabled: retryingId === action.id,
                              onSelect: () => void retry(action),
                            }]
                          : []),
                      ]}
                    />
                  </>
                ) : null}
              </ActionCell>
            </Tr>
          })}
        </tbody>
      </DataTable>}
      {listState === 'ready' ? (
        <div className={styles.footer}>
          <p><ListRange label="取り込みの記録" total={actionTotal} first={actions.length === 0 ? 0 : 1} last={actions.length} /> 古い記録はページを進んで確認できます。</p>
          <p>注文の本文や接続用の秘密値は表示しません。もう一度行うときも、成功済みの処理は重ねません。</p>
        </div>
      ) : null}
      {listState === 'ready' && pageCount > 1 ? <Pagination page={page} pageCount={pageCount} onPageChange={setPage} /> : null}
      <OrderDetailDrawer
        orderId={detailOrderId}
        accountId={accountId}
        onClose={() => setDetailSlot({ accountId, orderId: null })}
        onRetryAction={retry}
        retryingId={retryingId}
      />
    </>
  )
}

function EcCommercePageInner() {
  const tab = useMergedTab(EC_TABS, 'tab', 'events')
  const { selectedAccountId } = useAccount()

  return (
    <div className={styles.root} data-design="Head">
      {/* マニュアルは共通トップバーに置く。本文に「ECの注文・定期便を取り込み、LINEの配信や成果へつなげます。」という重複説明は置かない。 */}
      <PageHeaderH2
        /* 1段だけのパンくずは上の帯の画面名と重複するので出さない。 */
        breadcrumb={[]}
        title="EC連携"
        description=""
        actions={tab === 'events'
          ? <Button href="/ec-commerce?tab=connector" variant="secondary">つなぎ先の設定</Button>
          : tab === 'subscriptions'
            ? <Button href="/broadcasts/new" variant="primary">対象を選んで配信</Button>
            : undefined}
      />
      <EcTabs accountId={selectedAccountId} active={tab as typeof EC_TABS[number]['key']} />
      {tab === 'events' ? <EventsPanel accountId={selectedAccountId} /> : null}
      {tab === 'subscriptions' ? <SubscriptionsPanel accountId={selectedAccountId} /> : null}
      {tab === 'connector' ? <ConnectorPanel accountId={selectedAccountId} /> : null}
    </div>
  )
}

export default function EcCommercePage() {
  return <Suspense fallback={<ListState kind="loading" />}><EcCommercePageInner /></Suspense>
}
