'use client'

/*
 * ★V8-B 外部連携の一覧・こちらから送る（板 `ZSbFY`・状態 `wWrpY`・
 * 1152 `AsfFB`・閲覧のみ `l5SRfT`）。
 *
 * v7 の器（`page.tsx` の `WebhooksPageInner`＋`webhook-overviews.tsx` の
 * `OutgoingOverview`）とは別の器。データの口は v7 と同じ口へ取りに行く。
 * 数の帯はやり取りの記録の集計（summary）と同じ元で出す。
 * 行の「…」に「鍵を作り直す」を明示する（HANDOVER-MAP の指図）。
 * v7 を直す必要が出たら `page.tsx` 側も同じ判断を入れる。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/lib/api'
import type { OutgoingWebhookOverview } from '@/lib/api'
import type { WebhookInteractionSummary } from '@line-crm/shared'
import { useAccount } from '@/contexts/account-context'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { formatNumber } from '@/lib/format'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import FilterChip from '@/components/shared/filter-chip'
import ListRange from '@/components/ui/list-range'
import Notice from '@/components/shared/notice'
import Pagination from '@/components/shared/pagination'
import { RowActions } from '@/components/shared/row-actions'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import StatusBadge from '@/components/shared/status-badge'
import StepUpPrompt, { isStepUpRequired, type StepUpRequest } from '@/components/step-up-prompt'
import { TableHeadRow, Th } from '@/components/shared/table'
import { inputClass } from '@/components/shared/form-controls'
import { MIN_SECRET_LENGTH, generateSecret } from '../secret'
import styles from './webhooks-v8-outgoing.module.css'

export type OutgoingV8Filter = 'all' | 'active' | 'paused' | 'failed'

const FILTERS: Array<{ value: OutgoingV8Filter; label: string }> = [
  { value: 'all', label: 'すべて' },
  { value: 'active', label: '動いている' },
  { value: 'paused', label: '止めている' },
  { value: 'failed', label: '失敗あり' },
]

const PAGE_SIZES = [20, 50, 100]

const EVENT_LABEL: Record<string, string> = {
  'conversion.confirmed': '注文が確定したとき',
  'friend.added': '友だちが追加されたとき',
  'form.submitted': 'フォームが送られたとき',
  'booking.created': '予約が入ったとき',
  '*': 'すべての出来事',
}

const PAYLOAD_LABEL: Record<string, string> = {
  'conversion.confirmed': '注文番号・金額・お客様名',
  'friend.added': '名前・追加日・流入元',
  'form.submitted': '回答のすべて',
  'booking.created': '予約日時・メニュー・担当',
  '*': '選んだ出来事の項目',
}

function firstEventLabel(item: OutgoingWebhookOverview): string {
  const first = item.eventTypes[0]
  if (!first) return 'まだ決めていません'
  const label = EVENT_LABEL[first] ?? first
  return item.eventTypes.length > 1 ? `${label} ほか${item.eventTypes.length - 1}件` : label
}

function payloadLabel(item: OutgoingWebhookOverview): string {
  const first = item.eventTypes[0]
  return first ? PAYLOAD_LABEL[first] ?? '選んだ出来事の項目' : 'まだ決めていません'
}

/** URLの値やqueryを一覧へ出さず、相手を見分けられる範囲だけ残す。 */
function maskedUrl(value: string): string {
  try {
    const url = new URL(value)
    const firstPath = url.pathname.split('/').filter(Boolean)[0]
    return `${url.origin}${firstPath ? `/${firstPath}` : ''}/•••`
  } catch {
    return 'URLを確かめてください'
  }
}

function matches(item: OutgoingWebhookOverview, filter: OutgoingV8Filter, query: string): boolean {
  const hit = filter === 'all'
    || (filter === 'active' && item.isActive)
    || (filter === 'paused' && !item.isActive)
    || (filter === 'failed' && item.deliverySummary.failed > 0)
  if (!hit) return false
  const needle = query.trim().toLocaleLowerCase('ja-JP')
  if (!needle) return true
  return [item.name, item.url, ...item.eventTypes].some((value) =>
    value.toLocaleLowerCase('ja-JP').includes(needle))
}

export default function WebhooksV8Outgoing({ onCounts }: { onCounts?: (total: number | null) => void }) {
  usePageTitle('外部連携')
  usePageCrumbs([{ label: 'ホーム', href: '/' }])
  const { selectedAccountId } = useAccount()
  const [items, setItems] = useState<OutgoingWebhookOverview[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [summary, setSummary] = useState<WebhookInteractionSummary | null>(null)
  const [summaryStatus, setSummaryStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [role, setRole] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<OutgoingV8Filter>('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [panelId, setPanelId] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testTarget, setTestTarget] = useState<OutgoingWebhookOverview | null>(null)
  const [rotateTarget, setRotateTarget] = useState<OutgoingWebhookOverview | null>(null)
  const [rotateSecret, setRotateSecret] = useState('')
  const [rotateBusy, setRotateBusy] = useState(false)
  const [stepUp, setStepUp] = useState<StepUpRequest | null>(null)
  const [rotateError, setRotateError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<OutgoingWebhookOverview | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null)
  const generationRef = useRef(0)
  // 送り先の変更（開始・停止・直す・合言葉・削除・複製）は統括だけ（R32）。
  const isOwner = role === 'owner'
  // 役割の確認が終わるまでは今までどおり操作を出す（v7 と同じ）。
  const readonly = role !== null && !isOwner

  const load = useCallback(async () => {
    const generation = ++generationRef.current
    const accountId = selectedAccountId
    setItems([])
    setSummary(null)
    setActionError('')
    if (!accountId) {
      setStatus('ready')
      setSummaryStatus('ready')
      return
    }
    setStatus('loading')
    setSummaryStatus('loading')
    const [outgoingResult, summaryResult] = await Promise.allSettled([
      api.webhooks.outgoing.list(accountId),
      api.webhooks.interactions.list(accountId, { periodDays: 30, page: 1, limit: 1 }),
    ])
    if (generationRef.current !== generation) return
    if (outgoingResult.status === 'fulfilled' && outgoingResult.value.success) {
      setItems(outgoingResult.value.data)
      setStatus('ready')
    } else {
      setStatus('error')
    }
    if (summaryResult.status === 'fulfilled' && summaryResult.value.success
      && summaryResult.value.data?.summary) {
      setSummary(summaryResult.value.data.summary)
      setSummaryStatus('ready')
    } else {
      setSummaryStatus('error')
    }
  }, [selectedAccountId])

  useEffect(() => {
    void load()
  }, [load])

  // 外枠のタブの件数は、この一覧と同じ取得から数える（#980）。
  useEffect(() => {
    if (onCounts) onCounts(status === 'ready' ? items.length : null)
  }, [items, onCounts, status])

  useEffect(() => {
    let cancelled = false
    void api.staff.me()
      .then((response) => {
        if (cancelled || !response.success) return
        setRole(response.data.role)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const filtered = useMemo(() => {
    const rows = items.filter((item) => matches(item, filter, query))
    return [...rows].sort((a, b) => b.deliverySummary.total - a.deliverySummary.total)
  }, [filter, items, query])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])
  useEffect(() => {
    setPage(1)
  }, [filter, query, pageSize])
  const visible = useMemo(
    () => filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize],
  )
  const panelItem = panelId ? items.find((item) => item.id === panelId) ?? null : null

  const activeCount = items.filter((item) => item.isActive).length
  const pausedCount = items.length - activeCount
  const failedCount = items.filter((item) => item.deliverySummary.failed > 0).length
  const failedNames = items
    .filter((item) => item.deliverySummary.failed > 0)
    .map((item) => item.name.split('／')[0].trim())
    .join('、')
  const successCount = summary ? Math.max(0, summary.outgoing - summary.failed) : null
  const filterCount = (value: OutgoingV8Filter): number | undefined => {
    if (status !== 'ready') return undefined
    if (value === 'all') return items.length
    if (value === 'active') return activeCount
    if (value === 'paused') return pausedCount
    return failedCount
  }

  const toggleItem = async (item: OutgoingWebhookOverview) => {
    const accountId = selectedAccountId
    if (!accountId || togglingId) return
    setTogglingId(item.id)
    setActionError('')
    try {
      const res = await api.webhooks.outgoing.update(item.id, accountId, { isActive: !item.isActive })
      if (!res.success) throw new Error(res.error)
      await load()
    } catch {
      setActionError(`「${item.name}」を切り替えできませんでした。状態は変わっていません。確かめてから、もう一度お試しください。`)
    } finally {
      setTogglingId(null)
    }
  }

  const runTest = async (item: OutgoingWebhookOverview) => {
    const accountId = selectedAccountId
    if (!accountId || testingId) return
    setTestTarget(null)
    setTestingId(item.id)
    setActionError('')
    try {
      const response = await api.webhooks.outgoing.test(item.id, accountId)
      if (response.success && response.data.delivered) {
        const deliveredStatus = response.data.responseStatus
        setNotice(`「${item.name}」への試し送信が届きました${deliveredStatus === null ? '' : `（相手の応答 ${deliveredStatus}）`}。`)
      } else {
        const failedStatus = response.success ? response.data.responseStatus : null
        setActionError(`「${item.name}」への試し送信は届きませんでした${failedStatus === null ? '' : `（相手の応答 ${failedStatus}）`}。「やり取りの記録」タブで詳しく確認できます。`)
      }
    } catch {
      setActionError(`「${item.name}」への試し送信に失敗しました。「やり取りの記録」タブで詳しく確認できます。`)
    } finally {
      setTestingId(null)
    }
  }

  const runRotate = async (stepUpToken?: string) => {
    const accountId = selectedAccountId
    if (!accountId || !rotateTarget || rotateBusy) return
    if (rotateSecret.length < MIN_SECRET_LENGTH) {
      setRotateError(`合言葉は${MIN_SECRET_LENGTH}文字以上にしてください`)
      return
    }
    setRotateBusy(true)
    setRotateError('')
    try {
      const res = await api.webhooks.outgoing.update(
        rotateTarget.id, accountId, { secret: rotateSecret }, stepUpToken,
      )
      if (!res.success) throw new Error(res.error)
      setRotateTarget(null)
      setRotateSecret('')
      setNotice(`「${rotateTarget.name}」の鍵を作り直しました。相手側の設定も新しい鍵に変えてください。`)
      await load()
    } catch (caught) {
      // 合言葉の入れ替えは本人確認が要ることがある（v7 と同じ）。
      if (!stepUpToken && isStepUpRequired(caught)) {
        setStepUp({ purpose: 'webhook.secret', action: '合言葉を作り直す', retry: (token) => runRotate(token) })
        return
      }
      setRotateError('鍵を作り直せませんでした。統括に頼んでください。')
    } finally {
      setRotateBusy(false)
    }
  }

  const runDelete = async () => {
    const accountId = selectedAccountId
    if (!accountId || !deleteTarget || deleting) return
    setDeleting(true)
    setDeleteError('')
    try {
      const res = await api.webhooks.outgoing.delete(deleteTarget.id, accountId)
      if (!res.success) throw new Error(res.error)
      setDeleteTarget(null)
      if (panelId === deleteTarget.id) setPanelId(null)
      await load()
    } catch {
      setDeleteError('この送り先を削除できませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setDeleting(false)
    }
  }

  const duplicateItem = async (item: OutgoingWebhookOverview) => {
    const accountId = selectedAccountId
    if (!accountId || duplicatingId) return
    setDuplicatingId(item.id)
    setActionError('')
    try {
      const res = await api.webhooks.outgoing.create({
        lineAccountId: accountId,
        name: `${item.name} のコピー`,
        url: item.url,
        eventTypes: [...item.eventTypes],
        secret: generateSecret(),
        maxRetries: item.maxRetries,
      })
      if (!res.success) throw new Error(res.error)
      setNotice(`「${item.name}」を複製しました。合言葉は新しいものになっています。`)
      await load()
    } catch {
      setActionError('複製できませんでした。統括に頼んでください。')
    } finally {
      setDuplicatingId(null)
    }
  }

  const clearFilter = () => {
    setQuery('')
    setFilter('all')
  }

  return (
    <>
      <ul className={styles.kpis} aria-label="数の帯">
        <li className={styles.kpi}>
          <span className={styles.kpiLabel}>送り先</span>
          <div className={styles.kpiValue}>
            {status === 'ready' ? <>{formatNumber(items.length)}<span className={styles.kpiValueSmall}> 件</span></> : '—'}
          </div>
          <div className={styles.kpiNote}>
            {status === 'ready' ? <>動いている {formatNumber(activeCount)}・止めている {formatNumber(pausedCount)}</> : '—'}
          </div>
        </li>
        <li className={styles.kpi}>
          <span className={styles.kpiLabel}>今月送った</span>
          <div className={styles.kpiValue}>
            {summary ? <>{formatNumber(summary.outgoing)}<span className={styles.kpiValueSmall}> 回</span></> : '—'}
          </div>
          <div className={styles.kpiNote}>
            {successCount === null ? '—' : <>うち成功 {formatNumber(successCount)}回</>}
          </div>
        </li>
        <li className={styles.kpi}>
          <span className={styles.kpiLabel}>失敗</span>
          <div className={styles.kpiValue}>
            {summary ? <>{formatNumber(summary.failed)}<span className={styles.kpiValueSmall}> 件</span></> : '—'}
          </div>
          <div className={styles.kpiNote}>
            {failedNames ? `${failedNames}を確認` : '「やり取りの記録」からやり直せます'}
          </div>
        </li>
        <li className={styles.kpi}>
          <span className={styles.kpiLabel}>受け取り</span>
          <div className={styles.kpiValue}>
            {summary ? <>{formatNumber(summary.incoming)}<span className={styles.kpiValueSmall}> 件</span></> : '—'}
          </div>
          <div className={styles.kpiNote}>今月 {summary ? formatNumber(summary.incoming) : '—'}回</div>
        </li>
      </ul>

      <Notice tone="info" message="友だちの動きを、決めたタイミングでほかのシステムへ送ります。送るときは秘密の鍵を付けます。鍵は「…」から作り直せます。" />
      {notice ? <Notice tone="success" message={notice} /> : null}
      {actionError ? <p className={styles.panelError} role="alert">{actionError}</p> : null}

      <div className={styles.split}>
        <div className={styles.rail}>
          {readonly ? (
            <Button type="button" variant="primary" disabled title="閲覧のみのため作れません" className={styles.createButton}>
              ＋ 送り先を作る
            </Button>
          ) : (
            <Button variant="primary" href="/webhooks/new" className={styles.createButton}>
              ＋ 送り先を作る
            </Button>
          )}
          <h2 className={styles.railTitle}>フォルダ</h2>
          <ul className={styles.railList}>
            <li>
              <span className={`${styles.railRow} ${styles.railRowActive}`} aria-current="true">
                <span className={styles.railName}>すべて</span>
                <span className={styles.railCount}>{status === 'ready' ? formatNumber(items.length) : '—'}</span>
              </span>
            </li>
          </ul>
        </div>

        <div className={styles.main}>
          <div className={styles.toolbar}>
            {readonly ? null : (
              <span className={styles.folderSelectWrap}>
                <Button variant="primary" href="/webhooks/new">
                  ＋ 送り先を作る
                </Button>
              </span>
            )}
            <span className={styles.searchWrap}>
              <SearchField
                value={query}
                onChange={setQuery}
                placeholder="つなぎ先で探す"
                aria-label="つなぎ先で探す"
              />
            </span>
            <span className={styles.chipRow}>
              {FILTERS.map((chip) => (
                <FilterChip
                  key={chip.value}
                  selected={filter === chip.value}
                  onChange={() => setFilter(chip.value)}
                  count={filterCount(chip.value)}
                >
                  {chip.label}
                </FilterChip>
              ))}
            </span>
          </div>
          <div className={styles.toolbarSecond}>
            <span className={styles.pageSizeWrap}>
              <Select
                aria-label="1ページの件数"
                value={String(pageSize)}
                options={PAGE_SIZES.map((size) => ({ value: String(size), label: `${size}件表示` }))}
                onChange={(value) => setPageSize(Number(value))}
              />
            </span>
          </div>

          {status === 'loading' ? (
            <div className={styles.tableWrap} aria-label="読み込み中">
              {[0, 1, 2, 3].map((index) => (
                <div className={styles.skeletonRow} key={index}>
                  <span className={styles.skeletonBar} style={{ width: '24%' }} />
                  <span className={styles.skeletonBar} style={{ width: '30%' }} />
                  <span className={styles.skeletonBar} style={{ width: '14%' }} />
                  <span className={styles.skeletonBar} style={{ width: '14%' }} />
                </div>
              ))}
            </div>
          ) : status === 'error' ? (
            <div className={styles.stateBox} role="alert">
              <p className={styles.stateBoxTitle}>送り先を読み込めませんでした</p>
              <p className={styles.stateBoxNote}>数の帯は「—」です。道具はそのまま使えます。</p>
              <div className={styles.stateBoxAction}>
                <Button variant="secondary" onClick={() => void load()}>
                  もう一度読む
                </Button>
              </div>
            </div>
          ) : items.length === 0 ? (
            <div className={styles.stateBox}>
              <p className={styles.stateBoxTitle}>まだ送り先がありません</p>
              <p className={styles.stateBoxNote}>うちで起きたことを、ほかのシステムに知らせられます</p>
              <div className={styles.stateBoxAction}>
                {readonly ? (
                  <Button type="button" variant="primary" disabled title="閲覧のみのため作れません">
                    ＋ 送り先を作る
                  </Button>
                ) : (
                  <Button variant="primary" href="/webhooks/new">
                    ＋ 送り先を作る
                  </Button>
                )}
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className={styles.stateBox}>
              <p className={styles.stateBoxTitle}>条件に合うものはありません</p>
              <p className={styles.stateBoxNote}>検索や絞り込みを外すと、すべて出ます</p>
              <div className={styles.stateBoxAction}>
                <Button variant="secondary" onClick={clearFilter}>
                  × 条件を外す
                </Button>
              </div>
            </div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <TableHeadRow>
                    <Th>つなぎ先</Th>
                    <Th>いつ送るか</Th>
                    <Th>送るもの</Th>
                    <Th align="right">この30日</Th>
                    <Th>ようす</Th>
                    <Th>操作</Th>
                  </TableHeadRow>
                </thead>
                <tbody>
                  {visible.map((item) => {
                    const toggling = togglingId === item.id
                    const pending = item.deliverySummary.lastResult?.status === 'pending'
                    const failed = !pending && (item.deliverySummary.lastResult?.status === 'failed'
                      || item.deliverySummary.failed > 0)
                    return (
                      <tr key={item.id} className={panelId === item.id ? styles.rowSelected : undefined}>
                        <td>
                          <button
                            type="button"
                            className={styles.cellButton}
                            onClick={() => setPanelId(panelId === item.id ? null : item.id)}
                            aria-expanded={panelId === item.id}
                            title={item.name}
                          >
                            <span className={styles.cellName}>{item.name}</span>
                          </button>
                          <span className={styles.cellSub} title={maskedUrl(item.url)}>{maskedUrl(item.url)}</span>
                        </td>
                        <td>
                          <span className={styles.cellName} title={firstEventLabel(item)}>
                            {firstEventLabel(item)}
                          </span>
                        </td>
                        <td>
                          <span title={payloadLabel(item)}>{payloadLabel(item)}</span>
                        </td>
                        <td className={styles.numeric}>
                          {formatNumber(item.deliverySummary.total)}回
                          {item.deliverySummary.pending > 0 ? (
                            <span className={styles.cellSub}>送信中 {formatNumber(item.deliverySummary.pending)}回</span>
                          ) : null}
                        </td>
                        <td>
                          <StatusBadge tone={toggling ? 'info' : failed ? 'danger' : pending ? 'neutral' : item.isActive ? 'success' : 'neutral'} size="compact">
                            {toggling ? '切り替え中' : failed ? '返事がありません' : pending ? '送信中' : item.isActive ? 'うまくいっています' : '止めています'}
                          </StatusBadge>
                          {failed && item.deliverySummary.lastResult?.completedAt ? (
                            <span className={styles.cellSub}>最終 {item.deliverySummary.lastResult.completedAt.slice(5, 16).replace('T', ' ')}</span>
                          ) : null}
                        </td>
                        <td className={styles.opCell} onClick={(event) => event.stopPropagation()}>
                          {item.deliverySummary.canRetry ? (
                            <Button variant="secondary" size="compact" href="/webhooks?tab=interactions">
                              やり直す
                            </Button>
                          ) : (
                            <Button variant="secondary" size="compact" href="/webhooks?tab=interactions">
                              中身を見る
                            </Button>
                          )}{' '}
                          <RowActions
                            menuItems={[
                              { id: 'detail', label: '中身を見る', onSelect: () => setPanelId(item.id) },
                              {
                                id: 'test',
                                label: '試しに送る',
                                disabled: !item.isActive,
                                onSelect: () => setTestTarget(item),
                              },
                              {
                                id: 'retry',
                                label: '失敗をやり直す',
                                disabled: !item.deliverySummary.canRetry,
                                onSelect: () => { window.location.href = '/webhooks?tab=interactions' },
                              },
                              {
                                id: 'rotate',
                                label: '鍵を作り直す',
                                disabled: readonly,
                                onSelect: () => {
                                  setRotateTarget(item)
                                  setRotateSecret('')
                                  setRotateError('')
                                },
                              },
                              {
                                id: 'toggle',
                                label: item.isActive ? '止める' : '動かす',
                                disabled: readonly || togglingId !== null,
                                onSelect: () => void toggleItem(item),
                              },
                              {
                                id: 'duplicate',
                                label: '複製する',
                                disabled: readonly || duplicatingId !== null,
                                onSelect: () => void duplicateItem(item),
                              },
                              {
                                id: 'delete',
                                label: '削除する',
                                disabled: readonly,
                                onSelect: () => {
                                  setDeleteTarget(item)
                                  setDeleteError('')
                                },
                              },
                            ]}
                            menuNote={readonly ? '閲覧のみのため変える操作は使えません' : undefined}
                            subjectName={item.name}
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {status === 'ready' && filtered.length > 0 ? (
            <div className={styles.pagerRow}>
              <ListRange
                className={styles.pagerCount}
                label="送り先"
                total={filtered.length}
                first={(page - 1) * pageSize + 1}
                last={Math.min(page * pageSize, filtered.length)}
              />
              {pageCount > 1 ? (
                <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {panelItem ? (
        <section className={styles.panel} aria-label="送り先の小窓">
          <h2 className={styles.panelTitle}>送り先の小窓：{panelItem.name}</h2>
          <p className={styles.panelLead}>
            {firstEventLabel(panelItem)}・{payloadLabel(panelItem)}・この30日 {formatNumber(panelItem.deliverySummary.total)}回
          </p>
          <p className={styles.panelLead}>送り先：{maskedUrl(panelItem.url)}</p>
          <div className={styles.panelButtons}>
            <Button variant="secondary" size="compact" href="/webhooks?tab=interactions">
              中身を見る
            </Button>
            <Button
              variant="secondary"
              size="compact"
              disabled={!panelItem.isActive}
              onClick={() => setTestTarget(panelItem)}
              busy={testingId === panelItem.id}
              busyLabel="試しています"
            >
              試しに送る
            </Button>
            {!readonly ? (
              <>
                <Button
                  variant="secondary"
                  size="compact"
                  disabled={togglingId !== null}
                  onClick={() => void toggleItem(panelItem)}
                  busy={togglingId === panelItem.id}
                  busyLabel="切り替えています"
                >
                  {panelItem.isActive ? '止める' : '動かす'}
                </Button>
                <Button
                  variant="secondary"
                  size="compact"
                  onClick={() => {
                    setRotateTarget(panelItem)
                    setRotateSecret('')
                    setRotateError('')
                  }}
                >
                  鍵を作り直す
                </Button>
                <Button
                  variant="secondary"
                  size="compact"
                  disabled={duplicatingId !== null}
                  onClick={() => void duplicateItem(panelItem)}
                >
                  複製する
                </Button>
                <Button
                  variant="secondary"
                  size="compact"
                  onClick={() => {
                    setDeleteTarget(panelItem)
                    setDeleteError('')
                  }}
                >
                  削除する
                </Button>
              </>
            ) : null}
            <Button
              variant="secondary"
              size="compact"
              onClick={() => setPanelId(null)}
              className={styles.panelClose}
            >
              閉じる
            </Button>
          </div>
        </section>
      ) : null}

      <ConfirmDialog
        open={testTarget !== null}
        title="試し送信をします"
        description={testTarget
          ? `「${testTarget.name}」へ、試し用のデータを1回だけ送ります。実際の連携先へ届きます。`
          : ''}
        confirmLabel="この送り先へ送る"
        cancelLabel="キャンセル"
        busy={testingId !== null}
        onConfirm={() => {
          if (testTarget) void runTest(testTarget)
        }}
        onCancel={() => setTestTarget(null)}
      >
        {testTarget ? (
          <div className={styles.secretBox}>
            <p className={styles.secretLabel}>送り先のURL</p>
            <code className={styles.secretValue}>{testTarget.url}</code>
          </div>
        ) : null}
      </ConfirmDialog>

      <Dialog
        open={rotateTarget !== null}
        title={rotateTarget ? `「${rotateTarget.name}」の鍵を作り直す` : ''}
        onCancel={() => {
          setRotateTarget(null)
          setRotateSecret('')
          setRotateError('')
        }}
      >
        <p className={styles.panelLead}>
          新しい合言葉に変えます。相手側の設定も新しい鍵に変えてください。
        </p>
        <label className={styles.reasonField}>
          <span className={styles.reasonLabel}>新しい合言葉（{MIN_SECRET_LENGTH}文字以上）</span>
          <input
            aria-label="新しい合言葉"
            className={inputClass}
            value={rotateSecret}
            onChange={(event) => setRotateSecret(event.target.value)}
          />
        </label>
        {rotateError ? <p className={styles.panelError} role="alert">{rotateError}</p> : null}
        <div className={styles.panelButtons}>
          <Button
            variant="secondary"
            onClick={() => {
              setRotateTarget(null)
              setRotateSecret('')
              setRotateError('')
            }}
          >
            キャンセル
          </Button>
          <Button
            variant="primary"
            disabled={rotateBusy}
            onClick={() => void runRotate()}
            busy={rotateBusy}
            busyLabel="作り直しています"
          >
            鍵を作り直す
          </Button>
        </div>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={`送信Webhook「${deleteTarget?.name ?? ''}」を削除しますか？`}
        description="この宛先への送信が止まり、これから起きる出来事は通知されなくなります。すでに送った記録は残ります。この操作は取り消せません。"
        confirmLabel="削除する"
        destructive
        busy={deleting}
        error={deleteError}
        onConfirm={() => void runDelete()}
        onCancel={() => {
          if (deleting) return
          setDeleteTarget(null)
          setDeleteError('')
        }}
      />
      {stepUp && <StepUpPrompt request={stepUp} onDone={() => setStepUp(null)} onClose={() => setStepUp(null)} />}
    </>
  )
}