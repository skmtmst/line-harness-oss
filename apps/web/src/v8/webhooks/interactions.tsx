'use client'

/*
 * ★V8 外部連携「やり取りの記録」タブ（Pencil `Uv9AA`、中身は `DA0Ag`）。
 *
 * 型（ListPage）に、タブ・やり取りの帯・案内の帯・道具の段（探す・札4つ・
 * まとめてやり直す）・表・ページ送りをはめる。データの口は v7 と同じ
 * （一覧・送り直し・まとめて送り直し）。URL・鍵・本文は一覧にも中身にも出さない。
 * 絵と今の作りが合わない所は BEHAVIOR.md に書いた（CSV の書き出し口が無い など）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDownLeft, ArrowUpRight, CircleAlert, History, Inbox, LayoutList, RefreshCw, Send, TriangleAlert } from 'lucide-react'
import type { WebhookInteraction, WebhookInteractionList } from '@line-crm/shared'
import { api, ApiError } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { useStaffRole } from '@/lib/staff-role'
import { formatNumber } from '@/lib/format'
import { ListPage } from '@/components/templates'
import ListToolbar from '@/components/shared/list-toolbar'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import DetailPanel from '@/components/shared/detail-panel'
import FilterChip from '@/components/shared/filter-chip'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import Pagination from '@/components/shared/pagination'
import Select from '@/components/shared/select'
import { DataTable, TableHeadRow, Th, Tr, Td } from '@/components/shared/table'
import { DelayedSkeleton, Skeleton } from '@/components/shared/skeleton'
import { notifyToast } from '@/components/shared/toast'
import { withViewTransition } from '@/components/shared/view-transition'
import { ViewerBand, WEBHOOKS_DESCRIPTION, WebhookBand, WebhookTabs, useWebhookOverview, type BandCell } from './shell'
import { eventWord, shortDateTime } from './words'
import styles from './interactions.module.css'

type Direction = 'all' | 'outgoing' | 'incoming'
type Status = 'all' | 'failed'

const EMPTY: WebhookInteractionList = {
  items: [],
  total: 0,
  page: 1,
  limit: 20,
  summary: {
    total: 0, outgoing: 0, incoming: 0, succeeded: 0, failed: 0,
    resultUnknown: 0, outgoingFailed: 0, retryable: 0, averageDurationMs: null,
  },
}

/** きっかけの言葉（古い点つきの種類も読む）。 */
function triggerWord(item: WebhookInteraction): string {
  if (item.eventType === 'incoming_webhook.test') return `${item.webhookName}の受け取りを試した`
  if (item.direction === 'incoming') return `${item.webhookName}から受け取った`
  return eventWord(item.eventType)
}

/*
 * 「送った・届いた中身」の2行。口は1つの文（triggerSummary）しか返さないので、
 * 最初の「・」の前を1行目、後ろを2行目にする。何度もやり直して失敗したときは経緯を足す。
 */
function bodyLines(item: WebhookInteraction): { main: string; sub: string } {
  const [head, ...rest] = item.triggerSummary.split('・')
  const tail = rest.join('・')
  const retried = item.retryOfId
    ? '前の失敗をやり直した記録'
    : item.status === 'failed' && item.attemptCount > 1 ? `${item.attemptCount}回やり直して失敗` : ''
  return { main: head || '—', sub: [tail, retried].filter(Boolean).join('・') }
}

function replyLabel(item: WebhookInteraction): { text: string; failed: boolean } {
  if (item.status === 'failed') return { text: item.responseLabel, failed: true }
  if (item.direction === 'incoming') return { text: '受け取った', failed: false }
  return { text: item.responseLabel, failed: false }
}

function seconds(ms: number | null): string {
  return ms == null ? '—' : `${(Math.round(ms / 100) / 10).toFixed(1)} 秒`
}

/* その記録をここからやり直せるかを業務の言葉で説明する（v7 と同じ定義）。 */
function retryabilityText(item: WebhookInteraction, allowed: boolean): string {
  if (item.eventType === 'incoming_webhook.test') return '受け取りの試しの記録です。実際の受け取りと処理の実行はしていないため、送り直す対象ではありません。'
  if (item.status === 'succeeded') return '届いた記録なので、送り直す必要はありません。'
  if (item.status === 'pending') return 'いま処理の途中です。終わってから結果を確かめてください。'
  if (item.status === 'retried') return 'すでに送り直した記録です。あとから追加された新しい記録の結果を確かめてください。'
  if (item.direction === 'incoming') return '受け取った記録なので、こちらからは送り直せません。相手側でもう一度送ってもらってください。'
  if (item.retryBlockReason === 'webhook_deleted') return '送り先は削除されました。ここからは送り直せません。必要なら連携を作り直してください。'
  if (item.retryBlockReason === 'webhook_inactive') return '送り先が止められています。送る一覧で動かしてから「やり直す」を押してください。'
  if (item.retryBlockReason === 'auto_retry_scheduled') return `自動での送り直しが予定されています${item.autoRetryNextAt ? `（${shortDateTime(item.autoRetryNextAt)}頃）` : ''}。しばらく待って届かない場合は、連携先の状態を確かめてください。`
  if (item.retryBlockReason === 'already_delivered') return '自動の送り直しで届いています。ここから送り直す必要はありません。'
  if (!item.canRetry) return 'つなぎ先の設定が消えたか、送った内容が残っていないため、ここからは送り直せません。'
  if (!allowed) return '送り直せるのは統括と管理者です。'
  if (item.failureReasonCode === 'secret_unavailable') return '署名に使う合言葉をこちらで確認できませんでした。相手には一度も送っていません。連携の設定を保存し直してから「やり直す」を押してください。'
  if (item.failureReasonCode === 'unknown') return '相手先に届いたか分かっていません。相手先の記録で同じ処理がないか確かめてから「やり直す」を押してください。'
  return 'この画面の「やり直す」から、同じ届け番号でもう一度送れます。届いていた場合でも相手先で二重に処理されない仕組みです。'
}

function canRetryNow(item: WebhookInteraction, allowed: boolean): boolean {
  return allowed && item.canRetry && item.direction === 'outgoing' && item.status === 'failed'
}

export default function WebhooksInteractionsV8() {
  usePageTitle('外部連携')
  usePageCrumbs([{ label: 'ホーム', href: '/' }])
  const { selectedAccountId, accounts } = useAccount()
  const accountRef = useRef(selectedAccountId)
  accountRef.current = selectedAccountId
  const generationRef = useRef(0)
  const staffRole = useStaffRole()
  /* 送り直しは統括と管理者（v7 と同じ）。確認が終わるまでは出す。 */
  const canRetry = staffRole === null || staffRole === 'owner' || staffRole === 'admin'
  const isOwner = staffRole === null || staffRole === 'owner'
  const overview = useWebhookOverview()

  const [data, setData] = useState<WebhookInteractionList>(EMPTY)
  const [loadedAccountId, setLoadedAccountId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [search, setSearch] = useState('')
  const [direction, setDirection] = useState<Direction>('all')
  const [status, setStatus] = useState<Status>('all')
  const [periodDays, setPeriodDays] = useState(30)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(20)
  const [selected, setSelected] = useState<WebhookInteraction | null>(null)
  const [techOpen, setTechOpen] = useState(false)
  const [retrying, setRetrying] = useState<string | null>(null)
  const [bulkRetrying, setBulkRetrying] = useState(false)
  const [notice, setNotice] = useState('')
  const [confirmingRetry, setConfirmingRetry] = useState<WebhookInteraction | null>(null)

  const load = useCallback(async () => {
    const accountId = selectedAccountId
    const generation = ++generationRef.current
    setData(EMPTY)
    setLoadedAccountId(null)
    setSelected(null)
    setTechOpen(false)
    setRetrying(null)
    setBulkRetrying(false)
    setConfirmingRetry(null)
    if (!accountId) {
      setLoading(false)
      setError(false)
      return
    }
    setLoading(true)
    setError(false)
    try {
      const response = await api.webhooks.interactions.list(accountId, {
        periodDays,
        direction: direction === 'all' ? undefined : direction,
        status: status === 'all' ? undefined : status,
        search: search || undefined,
        page,
        limit,
      })
      if (!response.success) throw new Error(response.error)
      if (generationRef.current !== generation || accountRef.current !== accountId) return
      setData(response.data)
      setLoadedAccountId(accountId)
    } catch {
      if (generationRef.current !== generation || accountRef.current !== accountId) return
      setData(EMPTY)
      setLoadedAccountId(accountId)
      setError(true)
    } finally {
      if (generationRef.current === generation && accountRef.current === accountId) setLoading(false)
    }
  }, [selectedAccountId, periodDays, direction, status, search, page, limit])

  useEffect(() => { void load() }, [load])

  const pageCount = Math.max(1, Math.ceil(data.total / data.limit))
  const rangeFirst = data.total === 0 ? 0 : (data.page - 1) * data.limit + 1
  const rangeLast = data.total === 0 ? 0 : Math.min(data.total, rangeFirst + data.items.length - 1)

  const retry = async (item: WebhookInteraction, confirmed = false) => {
    const accountId = selectedAccountId
    if (!accountId || loadedAccountId !== accountId) return
    setConfirmingRetry(null)
    setRetrying(item.id)
    setNotice('')
    try {
      const response = await api.webhooks.interactions.retry(item.id, accountId, { confirmed })
      if (accountRef.current !== accountId) return
      if (!response.success) throw new Error(response.error)
      if (response.data.status === 'succeeded') notifyToast(`「${item.webhookName}」へもう一度送り、届いたことを確認しました。`)
      else setNotice(`「${item.webhookName}」へ送り直しましたが、まだ届きませんでした。`)
      await load()
    } catch (err) {
      if (accountRef.current !== accountId) return
      if (err instanceof ApiError && err.code === 'result_unknown_needs_check') setConfirmingRetry(item)
      else if (err instanceof ApiError && err.code === 'webhook_not_found') { setNotice('送り先は削除されています。一覧の表示を最新にしました。'); void load() }
      else if (err instanceof ApiError && err.code === 'auto_retry_scheduled') setNotice('この知らせは自動での送り直しが予定されています。しばらく待っても届かない場合は、連携先の設定を確かめてください。')
      else if (err instanceof ApiError && err.code === 'already_delivered') { setNotice('この知らせは自動の送り直しで届いています。一覧の表示を最新にしました。'); void load() }
      else if (err instanceof ApiError && err.code === 'webhook_inactive') setNotice('送り先が止められています。送る一覧で動かしてからやり直してください。')
      else if (err instanceof ApiError && err.status === 503) setNotice('署名に使う合言葉を確認できないため、まだ送っていません。連携の設定を保存し直してからやり直してください。')
      else setNotice('送り直しを受け付けられませんでした。状態を読み直してからお試しください。')
    } finally {
      if (accountRef.current === accountId) setRetrying(null)
    }
  }

  const retryFailed = async () => {
    const accountId = selectedAccountId
    if (!accountId || loadedAccountId !== accountId) return
    setBulkRetrying(true)
    setNotice('')
    try {
      const response = await api.webhooks.interactions.retryFailed(accountId)
      if (accountRef.current !== accountId) return
      if (!response.success) throw new Error(response.error)
      const d = response.data
      const remainingNote = d.remaining > 0 ? `まだ失敗のまま残っているものが${d.remaining}件あります。もう一度押すと続きをやり直します。` : ''
      const reviewNote = d.needsReview > 0 ? `届いたか分からないものが${d.needsReview}件あります。相手先の記録で同じ処理がないか確かめてから、一覧で1件ずつやり直してください。` : ''
      const excludedNote = d.excluded > 0 ? `送り先が消えた・止まっている・自動の送り直し中などで、対象外のものが${d.excluded}件あります。` : ''
      const message = `${d.requested}件を確認し、${d.succeeded}件が届きました。届かなかったもの ${d.failed}件、対象外 ${d.skipped}件です。${remainingNote}${reviewNote}${excludedNote}`
      if (d.failed > 0 || d.skipped > 0 || d.remaining > 0 || d.needsReview > 0 || d.excluded > 0) setNotice(message)
      else notifyToast(message)
      await load()
    } catch {
      if (accountRef.current !== accountId) return
      setNotice('まとめて送り直せませんでした。状態を読み直してからお試しください。')
    } finally {
      if (accountRef.current === accountId) setBulkRetrying(false)
    }
  }

  const openDetail = (item: WebhookInteraction) => withViewTransition(() => { setSelected(item); setTechOpen(false) })
  const selectedIndex = selected ? data.items.findIndex((item) => item.id === selected.id) : -1
  const stepDetail = (delta: -1 | 1) => {
    const target = selectedIndex === -1 ? undefined : data.items[selectedIndex + delta]
    if (target) openDetail(target)
  }

  const summary = data.summary
  const loaded = loadedAccountId === selectedAccountId && !error && Boolean(selectedAccountId)
  const known = loaded ? summary : null
  const bandCells: BandCell[] = [
    {
      key: 'sent', title: '今月送った', icon: <History size={13} aria-hidden="true" />,
      value: known ? known.outgoing : null, unit: '回',
      detail: known ? `成功 ${formatNumber(Math.max(0, known.outgoing - known.outgoingFailed))}` : '集計を読み込めませんでした',
    },
    {
      key: 'received', title: '受け取った', icon: <Inbox size={13} aria-hidden="true" />,
      value: known ? known.incoming : null, unit: '回',
      detail: known ? `成功 ${formatNumber(Math.max(0, known.incoming - (known.failed - known.outgoingFailed)))}` : '集計を読み込めませんでした',
    },
    {
      key: 'failed', title: '失敗', icon: <TriangleAlert size={13} aria-hidden="true" />,
      value: known ? known.failed : null, unit: '件',
      detail: known ? `やり直せるもの ${formatNumber(known.retryable)}` : '集計を読み込めませんでした',
    },
    {
      key: 'all', title: 'すべて', icon: <LayoutList size={13} aria-hidden="true" />,
      value: known ? known.total : null, unit: '回',
      detail: known ? `この${periodDays}日` : '集計を読み込めませんでした',
    },
  ]

  const chip = (label: string, count: number, on: boolean, select: () => void, icon: React.ReactNode) => (
    <FilterChip selected={on} onChange={() => { select(); setPage(1) }} icon={icon}>
      {loaded ? `${label} ${formatNumber(count)}` : label}
    </FilterChip>
  )
  const chips = (
    <div role="group" aria-label="向きと結果で絞り込む" className={styles.chips}>
      {chip('すべて', summary.total, direction === 'all' && status === 'all', () => { setDirection('all'); setStatus('all') }, <RefreshCw size={13} aria-hidden="true" />)}
      {chip('送った', summary.outgoing, direction === 'outgoing' && status === 'all', () => { setDirection('outgoing'); setStatus('all') }, <ArrowUpRight size={13} aria-hidden="true" />)}
      {chip('受け取った', summary.incoming, direction === 'incoming' && status === 'all', () => { setDirection('incoming'); setStatus('all') }, <ArrowDownLeft size={13} aria-hidden="true" />)}
      {chip('失敗', summary.failed, status === 'failed', () => { setDirection('all'); setStatus('failed') }, <CircleAlert size={13} aria-hidden="true" />)}
    </div>
  )
  /* 期間は絵に無い。消さずに、道具の段の右の空いた所へ小さく置く（件数はページ送りの段へ）。 */
  const trailing = (
    <>
      <div className={styles.smallSelect}>
        <Select
          aria-label="期間"
          value={String(periodDays)}
          onChange={(value) => { setPeriodDays(Number(value)); setPage(1) }}
          options={[{ value: '7', label: 'この7日' }, { value: '30', label: 'この30日' }, { value: '90', label: 'この90日' }]}
        />
      </div>
      {/* 閲覧のみには押せない「まとめてやり直す」を置かない。 */}
      {canRetry ? (
        <Button
          variant="primary"
          onClick={() => void retryFailed()}
          disabled={loading || bulkRetrying || summary.retryable === 0}
          title={summary.retryable === 0 ? '今ここから送り直せる失敗はありません' : undefined}
          busy={bulkRetrying}
          busyLabel="失敗したものを確認中"
        >
          <RefreshCw size={15} aria-hidden="true" />失敗したものをまとめてやり直す
        </Button>
      ) : null}
    </>
  )

  let listBody
  if (!selectedAccountId) {
    listBody = <ListState kind="empty" title={accounts.length > 0 ? '上のバーでLINE公式アカウントを選んでください' : 'LINE公式アカウントが登録されていません'} />
  } else if (loading && data.items.length === 0) {
    listBody = (
      <div aria-busy="true" aria-label="やり取りの記録を読み込んでいます">
        <DelayedSkeleton
          loading
          skeleton={(
            <div aria-hidden="true">
              {[0, 1, 2, 3].map((row) => (
                <div key={row} className={styles.skeletonRow}>
                  <Skeleton className={styles.skeletonDot} />
                  <Skeleton className={styles.skeletonBar} />
                  <Skeleton className={styles.skeletonBar} />
                  <Skeleton className={styles.skeletonBar} />
                </div>
              ))}
            </div>
          )}
        />
      </div>
    )
  } else if (error) {
    listBody = (
      <ListState
        kind="error"
        title="やり取りの記録を表示できませんでした"
        description="記録は消えていません。通信の状態を確認して、もう一度お試しください。"
        action={<Button onClick={() => void load()}>もう一度読み込む</Button>}
      />
    )
  } else if (data.items.length === 0) {
    listBody = <ListState kind="empty" title="条件に合うやり取りはありません" description="期間や絞り込みを変えて確認してください。" />
  } else {
    listBody = (
      <div className={styles.tableWrap}>
        <DataTable className={styles.table}>
          <thead>
            <TableHeadRow className={styles.headRow} data-table-layout="columns">
              <Th className={styles.colWhen}>いつ・どちら向き</Th>
              <Th className={styles.colName}>つなぎ先</Th>
              <Th className={styles.colBody}>送った・届いた中身</Th>
              <Th className={styles.colReply}>返事</Th>
              <Th className={styles.colTime}>かかった時間</Th>
              <Th className={styles.colOps}>操作</Th>
            </TableHeadRow>
          </thead>
          <tbody>
            {data.items.map((item) => {
              const reply = replyLabel(item)
              const lines = bodyLines(item)
              return (
                <Tr key={item.id} className={styles.row} data-table-layout="columns" data-row-id={item.id}>
                  <Td className={styles.colWhen}>
                    <span className={styles.main}>{shortDateTime(item.startedAt)}</span>
                    <span className={styles.sub}>{item.direction === 'outgoing' ? '送る' : '受け取る'}</span>
                  </Td>
                  <Td className={styles.colName}>
                    <span className={styles.main} title={`${item.webhookName}（${triggerWord(item)}）`}>{item.webhookName}</span>
                  </Td>
                  <Td className={styles.colBody}>
                    <span className={styles.main} title={item.triggerSummary}>{lines.main}</span>
                    {lines.sub ? <span className={styles.sub} title={lines.sub}>{lines.sub}</span> : null}
                  </Td>
                  <Td className={styles.colReply}>
                    <span className={styles.pill} data-tone={reply.failed ? 'danger' : 'active'}>
                      <span className={styles.pillDot} aria-hidden="true" />
                      {reply.text}
                    </span>
                  </Td>
                  <Td className={styles.colTime}><span className={styles.main}>{seconds(item.durationMs)}</span></Td>
                  <Td className={styles.colOps}>
                    <Button onClick={() => openDetail(item)}>中身を見る</Button>
                  </Td>
                </Tr>
              )
            })}
          </tbody>
        </DataTable>
      </div>
    )
  }

  /* ページ送りは表のすぐ下・注はその下（絵 Uv9AA）。型の pagination 枠は本文の後ろに来るので、本文の中に置く。 */
  const pager = loaded && data.total > 0 ? (
    <div className={styles.pagerRow}>
      <span className={styles.pagerLead}>
        <span className={styles.pagerCount}>{`${formatNumber(data.total)}件中 ${rangeFirst}〜${rangeLast}件`}</span>
        <span className={styles.smallSelect}>
          <Select
            aria-label="1ページに出す件数"
            value={String(limit)}
            onChange={(value) => { setLimit(Number(value)); setPage(1) }}
            options={[{ value: '10', label: '10件表示' }, { value: '20', label: '20件表示' }, { value: '50', label: '50件表示' }]}
          />
        </span>
      </span>
      <Pagination page={data.page} pageCount={pageCount} onPageChange={setPage} ariaLabel="やり取りの記録のページ送り" />
    </div>
  ) : null

  return (
    <ListPage
      boardId="Uv9AA"
      headingSize="regular"
      title="外部連携"
      description={WEBHOOKS_DESCRIPTION}
      tabs={<WebhookTabs active="interactions" outgoingCount={overview.outgoingCount} incomingCount={overview.incomingCount} />}
      stats={<>
        {!isOwner && !canRetry ? <ViewerBand /> : null}
        <WebhookBand cells={bandCells} />
      </>}
      toolbar={<>
        <div className={styles.noticeRow}>
          <Notice tone="info">失敗したものは「もう一度送る」でやり直せます。相手が止まっていたときは、自動で3回までやり直します。</Notice>
        </div>
        {notice ? <div className={styles.noticeRow}><Notice tone="danger" message={notice} onClose={() => setNotice('')} /></div> : null}
        <ListToolbar
          search={{ placeholder: '送り先・友だちで探す', label: '送り先・友だちで探す', width: 240, value: search, onChange: (value) => { setSearch(value); setPage(1) } }}
          filters={chips}
          trailing={trailing}
        />
      </>}
      overlays={<>
        {selected ? (
          <DetailPanel
            open
            title="やり取りの中身"
            description="接続先URL、シークレット、本文は安全のため表示しません。"
            onClose={() => setSelected(null)}
            onPrev={() => stepDetail(-1)}
            onNext={() => stepDetail(1)}
            hasPrev={selectedIndex > 0}
            hasNext={selectedIndex >= 0 && selectedIndex < data.items.length - 1}
            busy={retrying !== null}
          >
            <InteractionDetail
              item={selected}
              techOpen={techOpen}
              setTechOpen={setTechOpen}
              canRetry={canRetry}
              retrying={retrying === selected.id}
              onRetry={() => {
                if (selected.failureReasonCode === 'unknown') setConfirmingRetry(selected)
                else void retry(selected)
              }}
            />
          </DetailPanel>
        ) : null}
        <ConfirmDialog
          open={confirmingRetry !== null}
          title="届いたか確かめてから送り直します"
          description={confirmingRetry ? `「${confirmingRetry.webhookName}」へ届いたかどうか分かっていません。無条件に送り直すと、届いていた処理を二重に送ることがあります。相手先の記録で同じ処理がないか確かめましたか。` : ''}
          confirmLabel="確かめたので送り直す"
          cancelLabel="まだ確かめていない"
          busy={retrying === confirmingRetry?.id}
          onConfirm={() => { if (confirmingRetry) void retry(confirmingRetry, true) }}
          onCancel={() => setConfirmingRetry(null)}
        />
      </>}
    >
      {listBody}
      {pager}
      <p className={styles.footNote}>行の「中身を見る」から 送った中身と返事・もう一度送る（失敗のとき）。</p>
    </ListPage>
  )
}

function InteractionDetail({ item, techOpen, setTechOpen, canRetry, retrying, onRetry }: {
  item: WebhookInteraction
  techOpen: boolean
  setTechOpen: (open: boolean) => void
  canRetry: boolean
  retrying: boolean
  onRetry: () => void
}) {
  const retryable = canRetryNow(item, canRetry)
  const failed = item.status === 'failed'
  return (
    <div data-design-node="DA0Ag" className={styles.detail}>
      <span className={styles.pill} data-tone={failed ? 'danger' : item.status === 'succeeded' ? 'active' : 'neutral'}>
        <span className={styles.pillDot} aria-hidden="true" />
        {failed ? '失敗' : item.status === 'succeeded' ? '成功' : '処理中'}
      </span>
      <p className={styles.sub}>{`${shortDateTime(item.startedAt)}・${item.direction === 'outgoing' ? '送った' : '受け取った'}・${item.webhookName}`}</p>
      <dl className={styles.detailList}>
        <div className={styles.detailRow}><dt>きっかけ</dt><dd>{triggerWord(item)}</dd></div>
        <div className={styles.detailRow}><dt>返事</dt><dd>{item.responseLabel}{item.responseStatus !== null ? `（相手の応答番号 ${item.responseStatus}）` : ''}</dd></div>
        {item.failureReason ? <div className={styles.detailRow}><dt>失敗した理由</dt><dd className={styles.danger}>{item.failureReason}</dd></div> : null}
        <div className={styles.detailRow}><dt>試した回数</dt><dd>{item.attemptCount}回（1分・5分・30分あけて）</dd></div>
        <div className={styles.detailRow}><dt>かかった時間</dt><dd>{item.durationMs == null ? '—' : `返事まで ${seconds(item.durationMs)}`}</dd></div>
        <div className={styles.detailRow}><dt>やり直せるか</dt><dd>{retryable ? 'やり直せる' : 'やり直せない'}</dd></div>
      </dl>
      <div className={styles.payloadBox}>{`${item.triggerSummary}\n${item.responseLabel}`}</div>
      <p className={styles.sub}>接続先URL、シークレット、本文のうち個人が分かる部分は、安全のため伏せています。</p>
      {techOpen ? (
        <dl className={styles.detailList}>
          <div className={styles.detailRow}><dt>出来事の種類</dt><dd>{item.eventType}</dd></div>
          <div className={styles.detailRow}><dt>状態の記号</dt><dd>{item.status}</dd></div>
          <div className={styles.detailRow}><dt>記録の番号</dt><dd>{item.id}</dd></div>
          <div className={styles.detailRow}><dt>やり直し元の記録</dt><dd>{item.retryOfId ?? '—'}</dd></div>
        </dl>
      ) : null}
      <p className={styles.sub}>{retryabilityText(item, canRetry)}</p>
      <div className={styles.detailActions}>
        <Button onClick={() => setTechOpen(!techOpen)}>{techOpen ? '技術的な記録を閉じる' : '技術的な記録を開く'}</Button>
        {retryable ? (
          <Button variant="primary" onClick={onRetry} busy={retrying} busyLabel="やり直し中"><Send size={15} aria-hidden="true" />やり直す</Button>
        ) : null}
      </div>
    </div>
  )
}
