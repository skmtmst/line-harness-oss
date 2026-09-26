'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { WebhookInteraction, WebhookInteractionList } from '@line-crm/shared'

import { useAccount } from '@/contexts/account-context'
import { api, ApiError } from '@/lib/api'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import FilterChip from '@/components/shared/filter-chip'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import Notice from '@/components/shared/notice'
import Pagination from '@/components/shared/pagination'
import ListRange from '@/components/ui/list-range'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import StatusBadge from '@/components/shared/status-badge'
import SummaryCard from '@/components/shared/summary-card'
import { TableHeadRow, Th } from '@/components/shared/table'
import { ActionCell, DataTable, Td, Tr } from '@/components/shared/table'

import styles from './webhook-interactions.module.css'

type Direction = 'all' | 'outgoing' | 'incoming'
type Status = 'all' | 'succeeded' | 'failed'

const EMPTY: WebhookInteractionList = {
  items: [],
  total: 0,
  page: 1,
  limit: 20,
  summary: { total: 0, outgoing: 0, incoming: 0, succeeded: 0, failed: 0, resultUnknown: 0, averageDurationMs: null },
}

const EVENT_LABELS: Record<string, string> = {
  'friend.added': '友だちが追加されたとき',
  'friend.tag_added': 'タグが追加されたとき',
  'message.received': 'メッセージを受け取ったとき',
  'conversion.created': '成果が認められたとき',
  'booking.created': '予約が入ったとき',
  'order.created': '注文が確定したとき',
  // 目視確認の固定データが使う符号。表示は従来の日本語のまま(#506 軽)。
  'inventory.low': '在庫が少なくなったとき',
  'shipment.completed': '発送が完了したとき',
}

function eventLabel(item: WebhookInteraction): string {
  if (item.direction === 'incoming') return `${item.webhookName}から受け取ったとき`
  return EVENT_LABELS[item.eventType] ?? '外部サービスへ送る条件に合ったとき'
}

function formatJst(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
    hour12: false,
  }).format(date)
}

function directionLabel(direction: WebhookInteraction['direction']): string {
  return direction === 'outgoing' ? 'こちらから送った' : 'こちらで受け取った'
}

/*
 * IDEA-26: 失敗カードの補足。「届いたか分からない」ものは無条件に
 * 再送できないので、まとめてやり直せる数とは分けて件数を示す。
 */
function failureDetail(
  items: WebhookInteraction[],
  failed: number,
  resultUnknown: number,
): string {
  if (failed === 0) return '失敗はありません'
  const reviewNote = resultUnknown > 0
    ? `うち${resultUnknown}件は届いたか分からないため、相手先で確かめてからやり直します`
    : ''
  const visibleFailures = items.filter((item) => item.status === 'failed')
  if (visibleFailures.length === 0) return `送り直せます${reviewNote ? `。${reviewNote}` : ''}`

  const firstDestination = visibleFailures[0]?.webhookName.split('／')[0]?.trim()
  const sameDestination = firstDestination
    && visibleFailures.every((item) => item.webhookName.startsWith(firstDestination))
  const retryNote = sameDestination ? `すべて${firstDestination}。送り直せます` : '送り直せます'
  return reviewNote ? `${retryNote}。${reviewNote}` : retryNote
}

/**
 * 遅れと成功率の対象期間をカードの補足へ書く(IDEA-26)。
 * 「いつからいつまでの数字か」が分からないと、遅い・悪いの判断が付かない。
 */
function durationDetail(
  items: WebhookInteraction[],
  averageDurationMs: number | null,
  periodDays: number,
): string {
  if (averageDurationMs == null) return `この${periodDays}日は未取得`
  const durations = items.flatMap((item) => item.durationMs == null ? [] : [item.durationMs])
  if (durations.length === 0) return `この${periodDays}日の送受信の処理時間`
  return `この${periodDays}日でいちばん遅くて ${Math.round(Math.max(...durations) / 100) / 10}秒`
}

/*
 * IDEA-26: その記録をここからやり直せるかを業務の言葉で説明する。
 * 「やり直す」ボタンが出ない失敗にも、出ない理由を残す
 * （ボタンが無いだけでは、対象の消えた失敗と条件違いが区別できない）。
 */
function retryabilityText(item: WebhookInteraction, allowed: boolean): string {
  if (item.status === 'succeeded') return '届いた記録なので、送り直す必要はありません。'
  if (item.status === 'pending') return 'いま処理の途中です。終わってから結果を確かめてください。'
  if (item.status === 'retried') return 'すでに送り直した記録です。あとから追加された新しい記録の結果を確かめてください。'
  if (item.direction === 'incoming') {
    return '受け取った記録なので、こちらからは送り直せません。相手側でもう一度送ってもらってください。'
  }
  if (!item.canRetry) {
    return 'つなぎ先の設定が消えたか、送った内容が残っていないため、ここからは送り直せません。'
  }
  if (!allowed) return '送り直せるのは管理者です。'
  if (item.failureReasonCode === 'unknown') {
    return '相手先に届いたか分かっていません。相手先の記録で同じ処理がないか確かめてから「やり直す」を押してください。'
  }
  return 'この画面の「やり直す」から、同じ届け番号でもう一度送れます。届いていた場合でも相手先で二重に処理されない仕組みです。'
}

export default function WebhookInteractions() {
  const { selectedAccountId } = useAccount()
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
  const [retrying, setRetrying] = useState<string | null>(null)
  const [bulkRetrying, setBulkRetrying] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)
  const [canRetry, setCanRetry] = useState(false)
  /*
   * 「届いたか分からない」失敗の送り直し確認(IDEA-26)。
   * 結果不明のまま無条件に再送すると、届いていた処理を二重に送る恐れが
   * ある。先に相手先で確かめた、という確認を挟んでから送る。
   */
  const [confirmingRetry, setConfirmingRetry] = useState<WebhookInteraction | null>(null)

  /*
   * やり直し可否は手元の保存値ではなく、入り直した本人の役割で決める(#506 軽)。
   *
   * `localStorage` は書き換え可能で、別端末の表示とずれることがある。
   * 最終判断は口側なので脆弱性ではないが、押せる表示と結果を合わせる。
   */
  useEffect(() => {
    let cancelled = false
    void api.staff.me()
      .then((response) => {
        if (cancelled || !response.success) return
        const role = response.data.role
        setCanRetry(role === 'owner' || role === 'admin')
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const load = useCallback(async () => {
    const requestAccountId = selectedAccountId
    const requestGeneration = ++loadGenerationRef.current
    setData(EMPTY)
    setLoadedAccountId(null)
    setSelected(null)
    setNotice(null)
    setRetrying(null)
    setBulkRetrying(false)
    setConfirmingRetry(null)
    if (!requestAccountId) {
      setData(EMPTY)
      setLoading(false)
      setError(false)
      return
    }
    setData(EMPTY)
    setSelected(null)
    setLoading(true)
    setError(false)
    try {
      const response = await api.webhooks.interactions.list(requestAccountId, {
        periodDays,
        direction: direction === 'all' ? undefined : direction,
        status: status === 'all' ? undefined : status,
        search: search || undefined,
        page,
        limit,
      })
      if (!response.success) throw new Error(response.error)
      if (
        loadGenerationRef.current !== requestGeneration
        || selectedAccountIdRef.current !== requestAccountId
      ) return
      setData(response.data)
      setLoadedAccountId(requestAccountId)
    } catch {
      if (
        loadGenerationRef.current !== requestGeneration
        || selectedAccountIdRef.current !== requestAccountId
      ) return
      setData(EMPTY)
      setLoadedAccountId(requestAccountId)
      setError(true)
    } finally {
      if (
        loadGenerationRef.current !== requestGeneration
        || selectedAccountIdRef.current !== requestAccountId
      ) return
      setLoading(false)
    }
  }, [selectedAccountId, periodDays, direction, status, search, page, limit])

  useEffect(() => { void load() }, [load])

  const successRate = data.summary.total > 0
    ? Math.round((data.summary.succeeded / data.summary.total) * 1000) / 10
    : 0
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
      setNotice({
        tone: response.data.status === 'succeeded' ? 'success' : 'error',
        message: response.data.status === 'succeeded'
          ? `「${item.webhookName}」へもう一度送り、届いたことを確認しました。`
          : `「${item.webhookName}」へ送り直しましたが、まだ届きませんでした。`,
      })
      await load()
    } catch (error) {
      if (selectedAccountIdRef.current !== requestAccountId) return
      /*
        口側が「結果不明なので確認なしでは送らない」と止めた場合は、
        確認の窓へ回す（画面が古いまま操作したときでも無条件の再送に
        ならないようにする IDEA-26）。
      */
      if (error instanceof ApiError && error.code === 'result_unknown_needs_check') {
        setConfirmingRetry(item)
      } else {
        setNotice({ tone: 'error', message: '送り直しを受け付けられませんでした。状態を読み直してからお試しください。' })
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
      // N-387: 1回に送り直せる件数には上限がある。残った分は黙って置き去りに
      // せず、残件数と「もう一度押すと続きをやり直す」ことを明示する。
      const remainingNote = response.data.remaining > 0
        ? `まだ失敗のまま残っているものが${response.data.remaining}件あります。もう一度押すと続きをやり直します。`
        : ''
      // IDEA-26: 届いたか分からないものはまとめて送らない。件数と、
      // 相手先で確かめてから1件ずつやり直すことを明示する。
      const reviewNote = response.data.needsReview > 0
        ? `届いたか分からないものが${response.data.needsReview}件あります。相手先の記録で同じ処理がないか確かめてから、一覧で1件ずつやり直してください。`
        : ''
      setNotice({
        tone: response.data.failed > 0 || response.data.skipped > 0 || response.data.remaining > 0 || response.data.needsReview > 0 ? 'error' : 'success',
        message: `${response.data.requested}件を確認し、${response.data.succeeded}件が届きました。届かなかったもの ${response.data.failed}件、対象外 ${response.data.skipped}件です。${remainingNote}${reviewNote}`,
      })
      await load()
    } catch {
      if (selectedAccountIdRef.current !== requestAccountId) return
      setNotice({ tone: 'error', message: 'まとめて送り直せませんでした。状態を読み直してからお試しください。' })
    } finally {
      if (selectedAccountIdRef.current === requestAccountId) setBulkRetrying(false)
    }
  }

  if (!selectedAccountId) {
    return <ListState kind="empty" title="LINEアカウントを選択してください" description="やり取りはLINEアカウントごとに分けて記録します。" />
  }

  if (loadedAccountId !== selectedAccountId && !error) {
    return <ListState kind="loading" title="やり取りの記録を読み込んでいます" />
  }

  return (
    <div className={styles.page} data-design-node="KNG00">
      {canRetry ? <div className={styles.topActions}>
        <Button
          onClick={() => void retryFailed()}
          disabled={loading || bulkRetrying || data.summary.failed === 0}
          title={data.summary.failed === 0 ? '送り直す失敗はありません' : undefined}
        >
          <RefreshCw size={16} aria-hidden="true" />
          {bulkRetrying ? '失敗したものを確認中' : '失敗したものをまとめてやり直す'}
        </Button>
      </div> : null}

      {notice ? <Notice tone={notice.tone} message={notice.message} onClose={() => setNotice(null)} /> : null}

      {loading && data.items.length === 0 ? (
        <ListState kind="loading" title="やり取りの記録を読み込んでいます" />
      ) : error ? (
        <ListState
          kind="error"
          title="やり取りの記録を表示できませんでした"
          description="記録は消えていません。再読み込みしても直らない場合はエラー報告へ。"
          action={<Button onClick={() => void load()}>やり取りの記録を再読み込み</Button>}
        />
      ) : (
        <>
          <div className={styles.cards}>
            <SummaryCard variant="v6" title={`この${periodDays}日`} value={data.summary.total} unit="回" detail={`送った ${data.summary.outgoing.toLocaleString('ja-JP')}・受け取った ${data.summary.incoming.toLocaleString('ja-JP')}`} />
            <SummaryCard variant="v6" title="成功" value={data.summary.succeeded} unit="回" detail={`この${periodDays}日で ${successRate.toLocaleString('ja-JP')}%`} />
            <SummaryCard variant="v6" title="失敗" value={data.summary.failed} unit="回" detail={failureDetail(data.items, data.summary.failed, data.summary.resultUnknown)} badge={data.summary.failed > 0 ? 'やり直す' : undefined} badgeTone="danger" />
            <SummaryCard variant="v6" title="返事までの時間" value={data.summary.averageDurationMs == null ? null : Math.round(data.summary.averageDurationMs / 100) / 10} unit="秒" detail={durationDetail(data.items, data.summary.averageDurationMs, periodDays)} />
          </div>

          <NoteBar>送った・受け取ったやり取りの記録です。失敗したものはここからやり直せます。</NoteBar>

          <div className={styles.tools}>
            <SearchField
              aria-label="つなぎ先・きっかけで検索"
              placeholder="つなぎ先・きっかけで検索"
              value={search}
              onChange={(value) => { setSearch(value); setPage(1) }}
              onClear={() => { setSearch(''); setPage(1) }}
              className={styles.search}
            />
            <div className={styles.selects}>
              <Select aria-label="期間" value={String(periodDays)} options={[{ value: '7', label: 'この7日' }, { value: '30', label: 'この30日' }, { value: '90', label: 'この90日' }]} onChange={(value) => { setPeriodDays(Number(value)); setPage(1) }} />
              <Select aria-label="表示件数" size="page-size" value={String(limit)} options={[{ value: '10', label: '10件表示' }, { value: '20', label: '20件表示' }, { value: '50', label: '50件表示' }]} onChange={(value) => { setLimit(Number(value)); setPage(1) }} />
            </div>
          </div>

          <div className={styles.filters} aria-label="やり取りの絞り込み">
            <FilterChip selected={direction === 'all' && status === 'all'} onChange={() => { setDirection('all'); setStatus('all'); setPage(1) }} count={data.summary.total.toLocaleString('ja-JP')}>すべて</FilterChip>
            <FilterChip selected={direction === 'outgoing'} onChange={() => { setDirection('outgoing'); setStatus('all'); setPage(1) }} count={data.summary.outgoing.toLocaleString('ja-JP')}>送った</FilterChip>
            <FilterChip selected={direction === 'incoming'} onChange={() => { setDirection('incoming'); setStatus('all'); setPage(1) }} count={data.summary.incoming.toLocaleString('ja-JP')}>受け取った</FilterChip>
            <FilterChip selected={status === 'failed'} onChange={() => { setDirection('all'); setStatus('failed'); setPage(1) }} count={data.summary.failed.toLocaleString('ja-JP')}>失敗</FilterChip>
          </div>

          {data.items.length === 0 ? (
            <ListState kind="empty" title="条件に合うやり取りはありません" description="期間や絞り込みを変えて確認してください。" />
          ) : (
            /*
              N-386: 狭い幅では重要度の低い列を隠す。隠した列の中身は
              「中身を見る」の詳細ダイアログで全部見られるので情報は失われない。
                - 1180px以下: 「かかった時間」を隠す（詳細で見られる）
                - 760px以下:  さらに「送った・届いた中身」を隠す
            */
            <DataTable className={styles.table}>
              <colgroup><col /><col /><col /><col /><col /><col /></colgroup>
              <thead><TableHeadRow><Th>いつ・どちら向き</Th><Th>つなぎ先</Th><Th>送った・届いた中身</Th><Th>返事</Th><Th>かかった時間</Th><Th><span className="sr-only">操作</span></Th></TableHeadRow></thead>
              <tbody>
                {data.items.map((item) => (
                  <Tr key={item.id}>
                    <Td><div className={styles.primary}>{formatJst(item.startedAt)} ／ {directionLabel(item.direction)}</div><div className={styles.secondary} title={eventLabel(item)}>{eventLabel(item)}</div></Td>
                    <Td>
                      <div className={`${styles.primary} ${item.status === 'failed' ? styles.danger : ''}`} title={item.webhookName}>{item.webhookName}</div>
                      {/* IDEA-26: やり直しで増えた記録を元の失敗と区別し、受理からの流れを追えるようにする */}
                      {item.retryOfId ? <div className={styles.secondary}>前の失敗をやり直した記録</div> : null}
                    </Td>
                    <Td><div className={styles.primary} title={item.triggerSummary}>{item.triggerSummary}</div><div className={styles.secondary}>安全のため本文と接続情報は一覧に表示しません</div></Td>
                    <Td><StatusBadge tone={item.status === 'succeeded' ? 'success' : item.status === 'failed' ? 'danger' : 'info'}>{item.responseLabel}</StatusBadge></Td>
                    <Td>{item.durationMs == null ? '—' : `${Math.round(item.durationMs / 100) / 10}秒`}</Td>
                    <ActionCell><div className={styles.rowActions}><Button onClick={() => setSelected(item)}>中身を見る</Button>{canRetry && item.canRetry ? <Button onClick={() => item.failureReasonCode === 'unknown' ? setConfirmingRetry(item) : void retry(item)} disabled={retrying === item.id}>{retrying === item.id ? 'やり直し中' : 'やり直す'}</Button> : null}</div></ActionCell>
                  </Tr>
                ))}
              </tbody>
            </DataTable>
          )}

          <div className={styles.pagination}>
            <ListRange label="やり取り" total={data.total} first={rangeFirst} last={rangeLast} />
            <Pagination page={data.page} pageCount={pageCount} onPageChange={setPage} disabled={loading} />
          </div>
        </>
      )}

      <Dialog open={Boolean(selected)} title="やり取りの中身" description="接続先URL、シークレット、本文は安全のため表示しません。" onCancel={() => setSelected(null)}>
        {selected ? (
          <>
            <dl className={styles.details}><div className={styles.detailsRow}><dt>日時</dt><dd>{formatJst(selected.startedAt)}</dd></div><div className={styles.detailsRow}><dt>向き</dt><dd>{directionLabel(selected.direction)}</dd></div><div className={styles.detailsRow}><dt>つなぎ先</dt><dd>{selected.webhookName}</dd></div><div className={styles.detailsRow}><dt>きっかけ</dt><dd>{eventLabel(selected)}</dd></div><div className={styles.detailsRow}><dt>結果</dt><dd>{selected.responseLabel}</dd></div><div className={styles.detailsRow}><dt>試した回数</dt><dd>{selected.attemptCount}回</dd></div><div className={styles.detailsRow}><dt>かかった時間</dt><dd>{selected.durationMs == null ? '—' : `${Math.round(selected.durationMs / 100) / 10}秒`}</dd></div>{selected.failureReason ? <div className={styles.detailsRow}><dt>失敗した理由</dt><dd>{selected.failureReason}</dd></div> : null}{selected.retryOfId ? <div className={styles.detailsRow}><dt>記録のつながり</dt><dd>前の失敗をやり直した記録です。同じ届け番号で送るので、届いていた場合でも相手先で二重に処理されません。</dd></div> : null}<div className={styles.detailsRow}><dt>やり直せるか</dt><dd>{retryabilityText(selected, canRetry)}</dd></div></dl>
            {/*
              IDEA-26: 技術的な記録は普段は畳んでおき、必要なときだけ開く。
              理由を隠すために消すのではなく、一覧の業務の言葉とは分けて
              ここへ残す。本文・URL・シークレットはここにも出さない。
            */}
            <details className={styles.tech}>
              <summary className={styles.techSummary}>技術的な記録を開く</summary>
              <dl className={styles.details}>
                <div className={styles.detailsRow}><dt>記録の番号</dt><dd>{selected.id}</dd></div>
                <div className={styles.detailsRow}><dt>出来事の種類</dt><dd>{selected.eventType}</dd></div>
                <div className={styles.detailsRow}><dt>状態の記号</dt><dd>{selected.status}</dd></div>
                <div className={styles.detailsRow}><dt>相手の応答番号</dt><dd>{selected.responseStatus ?? '—'}</dd></div>
                <div className={styles.detailsRow}><dt>やり直し元の記録</dt><dd>{selected.retryOfId ?? '—'}</dd></div>
              </dl>
            </details>
          </>
        ) : null}
      </Dialog>

      {/* IDEA-26: 「届いたか分からない」失敗は、相手先で確かめた上で送り直す */}
      <ConfirmDialog
        open={Boolean(confirmingRetry)}
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
