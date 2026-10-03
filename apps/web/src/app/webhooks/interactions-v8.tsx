'use client'

/*
 * ★V8-B 外部連携のやり取りの記録（Pencil「★V8-B 画面の地図」の外部連携の行：
 * やり取りの記録 `Uv9AA`、やり取りの中身 `DA0Ag`）。
 *
 * v7 の記録（`webhook-interactions.tsx` の WebhookInteractions）とは別の
 * 部品として持つ。データの口（一覧・送り直し・まとめて送り直し）は同じ。
 * 違いは置き場と見せ方——タブに件数、数の帯、中身の画面が `DA0Ag` の形。
 * v7 を直す必要が出たら向こうも同じ判断を入れる（V8 完成までの二重管理）。
 *
 * 見本と今の作りが合わない所（API が無い所は作らず。今の形のまま）：
 * - 頭の「CSV で書き出す」：記録の書き出し口が無いので置かない。
 * - 札と帯の数：同じ集計（`summary`）から出すので、1件差は起きない。
 * - 行の2行目：相手の名前の口が無いので、安全のため本文を出さない旨か、
 *   やり直しの経緯を出す（`retryOfId` があるとき）。
 * - 返事の札：失敗は相手の返事、受け取りは「受け取った」、送って届いた
 *   ものは相手の返事を出す。
 * - 試した回数のかっこ（1分・5分・30分あけて）：送り直しの間隔の決まり。
 * - 送った・届いた中身の黒い枠：本文の口が無いので、きっかけと返事の
 *   安全な表示だけ出す。URL・鍵・本文はここにも出さない。
 */
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { WebhookInteraction, WebhookInteractionList } from '@line-crm/shared'
import { useAccount } from '@/contexts/account-context'
import { api, ApiError } from '@/lib/api'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import FilterChip from '@/components/shared/filter-chip'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import { notifyToast } from '@/components/shared/toast'
import Pagination from '@/components/shared/pagination'
import ListRange from '@/components/ui/list-range'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import { usePageTitle } from '@/components/shell/page-chrome'
import { formatDateTime, formatNumber } from '@/lib/format'
import { WebhooksV8Band, WebhooksV8Head, type V8KpiCell } from './outgoing-v8'
import { Inbox, Send, Undo2, Webhook } from 'lucide-react'
import styles from './interactions-v8.module.css'

type Direction = 'all' | 'outgoing' | 'incoming'
type Status = 'all' | 'succeeded' | 'failed'

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

const EVENT_LABELS: Record<string, string> = {
  'friend.added': '友だちが追加されたとき',
  'friend.tag_added': 'タグが追加されたとき',
  'message.received': 'メッセージを受け取ったとき',
  'conversion.created': '成果が認められたとき',
  'booking.created': '予約が入ったとき',
  'order.created': '注文が確定したとき',
  'inventory.low': '在庫が少なくなったとき',
  'shipment.completed': '発送が完了したとき',
}

function eventLabel(item: WebhookInteraction): string {
  if (item.eventType === 'incoming_webhook.test') return `${item.webhookName}の受け取りを試したとき`
  if (item.direction === 'incoming') return `${item.webhookName}から受け取ったとき`
  return EVENT_LABELS[item.eventType] ?? '外部サービスへ送る条件に合ったとき'
}

function formatJst(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return formatDateTime(date)
}

function directionShort(direction: WebhookInteraction['direction']): string {
  return direction === 'outgoing' ? '送る' : '受け取る'
}

function rowSub(item: WebhookInteraction): string {
  if (item.retryOfId) return '前の失敗をやり直した記録'
  if (item.status === 'failed' && item.attemptCount > 1) return `${item.attemptCount}回やり直して失敗`
  return '安全のため本文と接続情報は一覧に表示しません'
}

function replyLabel(item: WebhookInteraction): { text: string; failed: boolean } {
  if (item.status === 'failed') return { text: item.responseLabel, failed: true }
  if (item.direction === 'incoming') return { text: '受け取った', failed: false }
  return { text: item.responseLabel, failed: false }
}

/*
 * その記録をここからやり直せるかを業務の言葉で説明する（v7 と同じ定義）。
 * ボタンが無いだけでは対象の消えた失敗と区別できないので、理由を残す。
 */
function retryabilityText(item: WebhookInteraction, allowed: boolean): string {
  if (item.eventType === 'incoming_webhook.test') {
    return '受け取りの試しの記録です。実際の受け取りと処理の実行はしていないため、送り直す対象ではありません。'
  }
  if (item.status === 'succeeded') return '届いた記録なので、送り直す必要はありません。'
  if (item.status === 'pending') return 'いま処理の途中です。終わってから結果を確かめてください。'
  if (item.status === 'retried') return 'すでに送り直した記録です。あとから追加された新しい記録の結果を確かめてください。'
  if (item.direction === 'incoming') {
    return '受け取った記録なので、こちらからは送り直せません。相手側でもう一度送ってもらってください。'
  }
  if (item.retryBlockReason === 'webhook_deleted') {
    return '送り先は削除されました。ここからは送り直せません。必要なら連携を作り直してください。'
  }
  if (item.retryBlockReason === 'webhook_inactive') {
    return '送り先が止められています。送信の一覧で動かしてから「やり直す」を押してください。'
  }
  if (item.retryBlockReason === 'auto_retry_scheduled') {
    return `自動での送り直しが予定されています${item.autoRetryNextAt ? `（${formatJst(item.autoRetryNextAt)}頃）` : ''}。しばらく待って届かない場合は、連携先の状態を確かめてください。`
  }
  if (item.retryBlockReason === 'already_delivered') {
    return '自動の送り直しで届いています。ここから送り直す必要はありません。'
  }
  if (!item.canRetry) {
    return 'つなぎ先の設定が消えたか、送った内容が残っていないため、ここからは送り直せません。'
  }
  if (!allowed) return '送り直せるのは管理者です。'
  if (item.failureReasonCode === 'secret_unavailable') {
    return '署名に使う合言葉をこちらで確認できませんでした。相手には一度も送っていません。連携の設定を保存し直してから「やり直す」を押してください。'
  }
  if (item.failureReasonCode === 'unknown') {
    return '相手先に届いたか分かっていません。相手先の記録で同じ処理がないか確かめてから「やり直す」を押してください。'
  }
  return 'この画面の「やり直す」から、同じ届け番号でもう一度送れます。届いていた場合でも相手先で二重に処理されない仕組みです。'
}

function canRetryNow(item: WebhookInteraction, allowed: boolean): boolean {
  if (!allowed || !item.canRetry || item.direction !== 'outgoing') return false
  return item.status === 'failed'
}

export default function InteractionsV8Page() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <InteractionsV8Inner />
    </Suspense>
  )
}

function InteractionsV8Inner() {
  usePageTitle('外部連携')
  const { selectedAccountId, accounts } = useAccount()
  const selectedAccountIdRef = useRef(selectedAccountId)
  selectedAccountIdRef.current = selectedAccountId
  const loadGenerationRef = useRef(0)
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
  const [notice, setNotice] = useState<{ tone: 'danger'; message: string } | null>(null)
  const [canRetry, setCanRetry] = useState(false)
  const [confirmingRetry, setConfirmingRetry] = useState<WebhookInteraction | null>(null)
  const [outgoingCount, setOutgoingCount] = useState<number | null>(null)
  const [incomingCount, setIncomingCount] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    void api.staff.me()
      .then((response) => {
        if (cancelled || !response.success) return
        const role = response.data.role
        setCanRetry(role === 'owner' || role === 'admin')
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const load = useCallback(async () => {
    const requestAccountId = selectedAccountId
    const requestGeneration = ++loadGenerationRef.current
    setData(EMPTY)
    setLoadedAccountId(null)
    setSelected(null)
    setTechOpen(false)
    setRetrying(null)
    setBulkRetrying(false)
    setConfirmingRetry(null)
    if (!requestAccountId) {
      setData(EMPTY)
      setLoading(false)
      setError(false)
      return
    }
    setLoading(true)
    setError(false)
    try {
      const [response, outgoingResult, incomingResult] = await Promise.all([
        api.webhooks.interactions.list(requestAccountId, {
          periodDays,
          direction: direction === 'all' ? undefined : direction,
          status: status === 'all' ? undefined : status,
          search: search || undefined,
          page,
          limit,
        }),
        api.webhooks.outgoing.list(requestAccountId),
        api.webhooks.incoming.list(requestAccountId),
      ])
      if (!response.success) throw new Error(response.error)
      if (loadGenerationRef.current !== requestGeneration || selectedAccountIdRef.current !== requestAccountId) return
      setData(response.data)
      setLoadedAccountId(requestAccountId)
      if (outgoingResult.success) setOutgoingCount(outgoingResult.data.length)
      if (incomingResult.success) setIncomingCount(incomingResult.data.length)
    } catch {
      if (loadGenerationRef.current !== requestGeneration || selectedAccountIdRef.current !== requestAccountId) return
      setData(EMPTY)
      setLoadedAccountId(requestAccountId)
      setError(true)
    } finally {
      if (loadGenerationRef.current !== requestGeneration || selectedAccountIdRef.current !== requestAccountId) return
      setLoading(false)
    }
  }, [selectedAccountId, periodDays, direction, status, search, page, limit])

  useEffect(() => { void load() }, [load])

  const pageCount = Math.max(1, Math.ceil(data.total / data.limit))
  const rangeFirst = data.total === 0 ? 0 : (data.page - 1) * data.limit + 1
  const rangeLast = data.total === 0 ? 0 : Math.min(data.total, rangeFirst + data.items.length - 1)

  const retry = async (item: WebhookInteraction, confirmed = false) => {
    const requestAccountId = selectedAccountId
    if (!requestAccountId || loadedAccountId !== requestAccountId) return
    setConfirmingRetry(null)
    setRetrying(item.id)
    setNotice(null)
    try {
      const response = await api.webhooks.interactions.retry(item.id, requestAccountId, { confirmed })
      if (selectedAccountIdRef.current !== requestAccountId) return
      if (!response.success) throw new Error(response.error)
      if (response.data.status === 'succeeded') {
        notifyToast(`「${item.webhookName}」へもう一度送り、届いたことを確認しました。`)
      } else {
        setNotice({ tone: 'danger', message: `「${item.webhookName}」へ送り直しましたが、まだ届きませんでした。` })
      }
      await load()
    } catch (err) {
      if (selectedAccountIdRef.current !== requestAccountId) return
      if (err instanceof ApiError && err.code === 'result_unknown_needs_check') {
        setConfirmingRetry(item)
      } else if (err instanceof ApiError && err.code === 'webhook_not_found') {
        setNotice({ tone: 'danger', message: '送り先は削除されています。一覧の表示を最新にしました。' })
        void load()
      } else if (err instanceof ApiError && err.code === 'auto_retry_scheduled') {
        setNotice({ tone: 'danger', message: 'この通知は自動での送り直しが予定されています。しばらく待っても届かない場合は、連携先の設定を確かめてください。' })
      } else if (err instanceof ApiError && err.code === 'already_delivered') {
        setNotice({ tone: 'danger', message: 'この通知は自動の送り直しで届いています。一覧の表示を最新にしました。' })
        void load()
      } else if (err instanceof ApiError && err.code === 'webhook_inactive') {
        setNotice({ tone: 'danger', message: '送り先が止められています。送信の一覧で動かしてからやり直してください。' })
      } else if (err instanceof ApiError && err.status === 503) {
        setNotice({ tone: 'danger', message: '署名に使う合言葉を確認できないため、まだ送っていません。連携の設定を保存し直してからやり直してください。' })
      } else {
        setNotice({ tone: 'danger', message: '送り直しを受け付けられませんでした。状態を読み直してからお試しください。' })
      }
    } finally {
      if (selectedAccountIdRef.current === requestAccountId) setRetrying(null)
    }
  }

  const retryFailed = async () => {
    const requestAccountId = selectedAccountId
    if (!requestAccountId || loadedAccountId !== requestAccountId) return
    setBulkRetrying(true)
    setNotice(null)
    try {
      const response = await api.webhooks.interactions.retryFailed(requestAccountId)
      if (selectedAccountIdRef.current !== requestAccountId) return
      if (!response.success) throw new Error(response.error)
      const remainingNote = response.data.remaining > 0
        ? `まだ失敗のまま残っているものが${response.data.remaining}件あります。もう一度押すと続きをやり直します。`
        : ''
      const reviewNote = response.data.needsReview > 0
        ? `届いたか分からないものが${response.data.needsReview}件あります。相手先の記録で同じ処理がないか確かめてから、一覧で1件ずつやり直してください。`
        : ''
      const excludedNote = response.data.excluded > 0
        ? `送り先が消えた・止まっている・自動の送り直し中などで、対象外のものが${response.data.excluded}件あります。`
        : ''
      const bulkMessage = `${response.data.requested}件を確認し、${response.data.succeeded}件が届きました。届かなかったもの ${response.data.failed}件、対象外 ${response.data.skipped}件です。${remainingNote}${reviewNote}${excludedNote}`
      if (response.data.failed > 0 || response.data.skipped > 0 || response.data.remaining > 0 || response.data.needsReview > 0 || response.data.excluded > 0) {
        setNotice({ tone: 'danger', message: bulkMessage })
      } else {
        notifyToast(bulkMessage)
      }
      await load()
    } catch {
      if (selectedAccountIdRef.current !== requestAccountId) return
      setNotice({ tone: 'danger', message: 'まとめて送り直せませんでした。状態を読み直してからお試しください。' })
    } finally {
      if (selectedAccountIdRef.current === requestAccountId) setBulkRetrying(false)
    }
  }

  const openDetail = (item: WebhookInteraction) => {
    setSelected(item)
    setTechOpen(false)
  }

  const summary = data.summary
  const loaded = loadedAccountId === selectedAccountId && !error
  const bandCells: V8KpiCell[] = (() => {
    const num = (value: number | null) => (value === null ? '—' : formatNumber(value))
    const known = loaded ? summary : null
    const sent = known?.outgoing ?? null
    const received = known?.incoming ?? null
    const failed = known?.failed ?? null
    const retryable = known?.retryable ?? null
    return [
      {
        key: 'sent', icon: <Send size={14} />, label: '送った',
        value: num(sent), unit: '回',
        sub: sent === null ? ' ' : `成功 ${num(known!.outgoing - known!.failed)}回`,
      },
      {
        key: 'received', icon: <Inbox size={14} />, label: '受け取った',
        value: num(received), unit: '回',
        sub: received === null ? ' ' : `成功 ${num(received)}回`,
      },
      {
        key: 'failed', icon: <Webhook size={14} />, label: '失敗',
        value: num(failed), unit: '件',
        sub: retryable === null ? ' ' : `やり直せるもの ${num(retryable)}`,
      },
      {
        key: 'all', icon: <Undo2 size={14} />, label: 'すべて',
        value: num(known?.total ?? null), unit: '回',
        sub: known === null ? ' ' : `この${periodDays}日`,
      },
    ]
  })()

  const listBody = (() => {
    if (!selectedAccountId) {
      return (
        <ListState
          kind="empty"
          title={accounts.length > 0 ? '上のバーでLINE公式アカウントを選んでください' : 'LINE公式アカウントが登録されていません'}
        />
      )
    }
    if (loading && data.items.length === 0) return <ListState kind="loading" title="やり取りの記録を読み込んでいます" />
    if (error) {
      return (
        <ListState
          kind="error"
          title="やり取りの記録を表示できませんでした"
          description="記録は消えていません。通信の状態を確認して、もう一度お試しください。"
          action={<Button onClick={() => void load()}>もう一度読み込む</Button>}
        />
      )
    }
    if (data.items.length === 0) {
      return (
        <ListState
          kind="empty"
          title="条件に合うやり取りはありません"
          description="期間や絞り込みを変えて確認してください。"
        />
      )
    }
    return (
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">いつ・どちら向き</th>
              <th scope="col">つなぎ先</th>
              <th scope="col">送った・届いた中身</th>
              <th scope="col">返事</th>
              <th scope="col">かかった時間</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((item) => {
              const reply = replyLabel(item)
              return (
                <tr key={item.id}>
                  <td className={styles.whenCell}>
                    <div>{formatJst(item.startedAt)}</div>
                    <div>{directionShort(item.direction)}</div>
                  </td>
                  <td className={styles.nameCell}>
                    <span className={styles.nameText} title={item.webhookName}>{item.webhookName}</span>
                    <span className={styles.nameSub} title={eventLabel(item)}>{eventLabel(item)}</span>
                  </td>
                  <td className={styles.bodyCell}>
                    <span className={styles.nameText} title={item.triggerSummary}>{item.triggerSummary}</span>
                    <span className={styles.nameSub}>{rowSub(item)}</span>
                  </td>
                  <td>
                    <span className={`${styles.pill} ${reply.failed ? styles.pillDanger : styles.pillActive}`}>● {reply.text}</span>
                  </td>
                  <td className={styles.durationCell}>{item.durationMs == null ? '—' : `${Math.round(item.durationMs / 100) / 10}秒`}</td>
                  <td className={styles.opsCell}>
                    <Button onClick={() => openDetail(item)}>中身を見る</Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  })()

  return (
    <div className={styles.board} data-design-node="Uv9AA">
      <WebhooksV8Head activeTab="interactions" outgoingCount={outgoingCount} incomingCount={incomingCount} />
      <WebhooksV8Band cells={bandCells} label="やり取りの数の帯" />

      <Notice tone="info">
        失敗したものは「もう一度送る」でやり直せます。相手が止まっていたときは、自動で3回までやり直します。
      </Notice>
      {notice ? <Notice tone="danger" message={notice.message} onClose={() => setNotice(null)} /> : null}

      <div className={styles.main}>
        <div className={styles.toolbar}>
          <span className={styles.searchWrap}>
            <SearchField
              value={search}
              onChange={(value) => { setSearch(value); setPage(1) }}
              onClear={() => { setSearch(''); setPage(1) }}
              placeholder="送り先・友だちで探す"
              aria-label="送り先・友だちで探す"
            />
          </span>
          <FilterChip selected={direction === 'all' && status === 'all'} onChange={() => { setDirection('all'); setStatus('all'); setPage(1) }} count={formatNumber(summary.total)}>すべて</FilterChip>
          <FilterChip selected={direction === 'outgoing' && status === 'all'} onChange={() => { setDirection('outgoing'); setStatus('all'); setPage(1) }} count={formatNumber(summary.outgoing)}>送った</FilterChip>
          <FilterChip selected={direction === 'incoming' && status === 'all'} onChange={() => { setDirection('incoming'); setStatus('all'); setPage(1) }} count={formatNumber(summary.incoming)}>受け取った</FilterChip>
          <FilterChip selected={status === 'failed'} onChange={() => { setDirection('all'); setStatus('failed'); setPage(1) }} count={formatNumber(summary.failed)}>失敗</FilterChip>
          <span className={styles.toolbarRight}>
            {canRetry ? (
              <Button
                variant="primary"
                onClick={() => void retryFailed()}
                disabled={loading || bulkRetrying || summary.retryable === 0}
                title={summary.retryable === 0 ? '今ここから送り直せる失敗はありません' : undefined}
                busy={bulkRetrying}
                busyLabel="失敗したものを確認中"
              >
                失敗したものをまとめてやり直す
              </Button>
            ) : null}
            <Select
              aria-label="よく使う絞り込み"
              value={String(periodDays)}
              onChange={(value) => { setPeriodDays(Number(value)); setPage(1) }}
              options={[
                { value: '7', label: 'この7日' },
                { value: '30', label: 'この30日' },
                { value: '90', label: 'この90日' },
              ]}
            />
            <Select
              aria-label="表示件数"
              value={String(limit)}
              onChange={(value) => { setLimit(Number(value)); setPage(1) }}
              options={[
                { value: '10', label: '10件表示' },
                { value: '20', label: '20件表示' },
                { value: '50', label: '50件表示' },
              ]}
            />
          </span>
        </div>

        {listBody}

        {loadedAccountId === selectedAccountId && !error && data.total > 0 ? (
          <div className={styles.pagerRow}>
            <span className={styles.rangeText}>
              <ListRange label="やり取り" total={data.total} first={rangeFirst} last={rangeLast} />
            </span>
            <Pagination page={data.page} pageCount={pageCount} onPageChange={setPage} ariaLabel="やり取りの記録のページ送り" />
          </div>
        ) : null}
        <p className={styles.footNote}>行の「中身を見る」から 送った中身と返事・もう一度送る（失敗のとき）。</p>
      </div>

      <Dialog open={selected !== null} title="やり取りの中身" description="接続先URL、シークレット、本文は安全のため表示しません。" onCancel={() => setSelected(null)}>
        {selected ? (
          <InteractionDetailV8
            item={selected}
            techOpen={techOpen}
            setTechOpen={setTechOpen}
            canRetry={canRetry}
            retrying={retrying === selected.id}
            onRetry={() => {
              if (selected.failureReasonCode === 'unknown') setConfirmingRetry(selected)
              else void retry(selected)
            }}
            onClose={() => setSelected(null)}
          />
        ) : null}
      </Dialog>

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
    </div>
  )
}

function InteractionDetailV8({ item, techOpen, setTechOpen, canRetry, retrying, onRetry, onClose }: {
  item: WebhookInteraction
  techOpen: boolean
  setTechOpen: (open: boolean) => void
  canRetry: boolean
  retrying: boolean
  onRetry: () => void
  onClose: () => void
}) {
  const retryable = canRetryNow(item, canRetry)
  const failed = item.status === 'failed'
  return (
    <div data-design-node="DA0Ag">
      <p>
        <span className={`${styles.pill} ${failed ? styles.pillDanger : styles.pillActive}`}>● {failed ? '失敗' : item.status === 'succeeded' ? '成功' : '処理中'}</span>
      </p>
      <p className={styles.nameSub}>{formatJst(item.startedAt)}・{item.direction === 'outgoing' ? '送った' : '受け取った'}・{item.webhookName}</p>
      <dl className={styles.detailList}>
        <div className={styles.detailRow}><dt>きっかけ</dt><dd>{eventLabel(item)}{item.direction === 'outgoing' ? '' : ''}</dd></div>
        <div className={styles.detailRow}><dt>出来事の種類</dt><dd>{item.eventType}</dd></div>
        <div className={styles.detailRow}><dt>返事</dt><dd>{item.responseLabel}{item.responseStatus !== null ? `（相手の応答番号 ${item.responseStatus}）` : ''}</dd></div>
        {item.failureReason ? <div className={styles.detailRow}><dt>失敗した理由</dt><dd className={styles.detailDanger}>{item.failureReason}</dd></div> : null}
        <div className={styles.detailRow}><dt>試した回数</dt><dd>{item.attemptCount}回（1分・5分・30分あけて）</dd></div>
        <div className={styles.detailRow}><dt>かかった時間</dt><dd>{item.durationMs == null ? '—' : `返事まで ${Math.round(item.durationMs / 100) / 10}秒`}</dd></div>
        <div className={styles.detailRow}><dt>記録の番号</dt><dd>{item.id}</dd></div>
        <div className={styles.detailRow}><dt>やり直せるか</dt><dd>
          <span className={`${styles.pill} ${retryable ? styles.pillActive : styles.pillNeutral}`}>● {retryable ? 'やり直せる' : 'やり直せない'}</span>
        </dd></div>
      </dl>
      <div className={styles.payloadBox}>
        {item.triggerSummary}{'\n'}{item.responseLabel}
      </div>
      <p className={styles.payloadNote}>接続先URL、シークレット、本文のうち個人が分かる部分は、安全のため伏せています。</p>
      {techOpen ? (
        <dl className={styles.detailList}>
          <div className={styles.detailRow}><dt>出来事の種類</dt><dd>{item.eventType}</dd></div>
          <div className={styles.detailRow}><dt>状態の記号</dt><dd>{item.status}</dd></div>
          <div className={styles.detailRow}><dt>相手の応答番号</dt><dd>{item.responseStatus ?? '—'}</dd></div>
          <div className={styles.detailRow}><dt>やり直し元の記録</dt><dd>{item.retryOfId ?? '—'}</dd></div>
        </dl>
      ) : null}
      <p className={styles.payloadNote}>{retryabilityText(item, canRetry)}</p>
      <div className={styles.detailActions}>
        <Button onClick={() => setTechOpen(!techOpen)}>{techOpen ? '技術的な記録を閉じる' : '技術的な記録を開く'}</Button>
        <Button onClick={onClose}>閉じる</Button>
        {retryable ? (
          <Button variant="primary" onClick={onRetry} busy={retrying} busyLabel="やり直し中">届いたか確かめてから送り直す</Button>
        ) : null}
      </div>
    </div>
  )
}
