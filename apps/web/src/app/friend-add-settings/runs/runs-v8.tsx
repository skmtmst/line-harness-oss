'use client'

/*
 * ★V8 友だち追加時の配信の実行結果（板 `REIxB`）。
 *
 * v7 の実行結果（runs/page.tsx 内の FriendAddRunsInner）とは別の部品
 * として持つ。読み・絞り込み・CSV・一時停止は同じ（口・上限・安全弁を
 * 変えない）。違いは置き場と見せ方——数の帯・失敗の帯・札の道具の段・
 * 表（日時・友だち・来た経路・結果・行ったこと・時間）・下の2枚。
 */
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  FriendAddEventAttributionStatus,
  FriendAddEventKind,
  FriendAddEventRoutingStatus,
} from '@line-crm/shared'
import { AlertCircle, Download, History, MoreHorizontal, Pause, Pencil } from 'lucide-react'
import Avatar from '@/components/shared/avatar'
import { useAccount } from '@/contexts/account-context'
import { api, type FriendAddRunList } from '@/lib/api'
import { describeFriendAddFailure } from '../friend-add-failure'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useStaffRole, canManageRole } from '@/lib/staff-role'
import { csvCell } from './csv'
import { formatJstDateTime, routingAction, routingLabel } from './run-status'
import { useCursorStack } from '../use-cursor-stack'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import FilterChip from '@/components/shared/filter-chip'
import ListState from '@/components/shared/list-state'
import PageSizeSelect from '@/components/ui/page-size-select'
import { formatNumber } from '@/lib/format'
import styles from './runs-v8.module.css'

type KindFilter = 'all' | FriendAddEventKind
type AttributionFilter = 'all' | FriendAddEventAttributionStatus
type RoutingFilter = 'all' | FriendAddEventRoutingStatus

const RUN_STATUSES_PARAM = new Set<FriendAddEventRoutingStatus>([
  'pending', 'completed', 'failed', 'suppressed', 'partial_failed',
])

/** CSV書き出しの安全弁（v7 と同じ：100件×50頁=5,000件で止める）。 */
const CSV_EXPORT_MAX_PAGES = 50
const CSV_EXPORT_PAGE_SIZE = 100

/* 結果の札の色（成功=緑・失敗=赤・待ち=黄・なし=灰）。 */
const TONE_CLASS: Record<string, string> = {
  success: 'toneSuccess',
  danger: 'toneDanger',
  warning: 'toneWarning',
  info: 'toneInfo',
  neutral: 'toneNeutral',
}

/** 行の「かかった時間」。受信から処理までの秒（v7 の平均送信と同じ数え方）。 */
function elapsedText(receivedAt: string, processedAt: string | null): string {
  if (!processedAt) return '—'
  const ms = new Date(processedAt).getTime() - new Date(receivedAt).getTime()
  if (Number.isNaN(ms) || ms < 0) return '—'
  return `${(ms / 1000).toFixed(1)}秒`
}

export default function FriendAddRunsV8() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <FriendAddRunsV8Inner />
    </Suspense>
  )
}

function FriendAddRunsV8Inner() {
  usePageTitle('実行結果：友だち追加時の配信')
  const { selectedAccountId, accounts, loading: accountLoading } = useAccount()
  const role = useStaffRole()
  const canEdit = canManageRole(role)
  const searchParams = useSearchParams()
  const router = useRouter()
  const ruleIdFilter = searchParams.get('rule_id')
  const kindParam = searchParams.get('kind')
  const kind: KindFilter = kindParam === 'first_time' || kindParam === 'returning' ? kindParam : 'all'
  const attributionParam = searchParams.get('attribution')
  const attribution: AttributionFilter = attributionParam === 'captured' || attributionParam === 'unavailable' ? attributionParam : 'all'
  const routingParam = searchParams.get('status')
  const routing: RoutingFilter = routingParam && RUN_STATUSES_PARAM.has(routingParam as FriendAddEventRoutingStatus) ? routingParam as RoutingFilter : 'all'
  const pagesParam = searchParams.get('pages')
  const { stack: cursorStack, cursor, page: cursorPage, canPrev, reset: resetCursor, goPrev, goNext } =
    useCursorStack(pagesParam ? [null, ...pagesParam.split(',').filter(Boolean)] : undefined)
  const [perPage, setPerPage] = useState(20)
  const [data, setData] = useState<FriendAddRunList | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [errorStatus, setErrorStatus] = useState<number | null>(null)
  const [csvBusy, setCsvBusy] = useState(false)
  const [csvNote, setCsvNote] = useState('')
  const [stopBusy, setStopBusy] = useState(false)
  const [stopDialogOpen, setStopDialogOpen] = useState(false)
  const [stopMessage, setStopMessage] = useState('')
  const [ruleState, setRuleState] = useState<{ status: string; resendSuppressionHours: number | null } | null>(null)
  const requestSequence = useRef(0)

  const load = useCallback(async () => {
    const requestId = ++requestSequence.current
    if (!selectedAccountId) {
      setData(null)
      setError('')
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    setErrorStatus(null)
    try {
      const response = await api.friendAddRules.runs(selectedAccountId, {
        limit: perPage,
        cursor: cursor ?? undefined,
        status: routing === 'all' ? undefined : routing,
        kind: kind === 'all' ? undefined : kind,
        attribution: attribution === 'all' ? undefined : attribution,
        ruleId: ruleIdFilter ?? undefined,
      })
      if (requestId !== requestSequence.current) return
      if (!response.success) {
        setData(null)
        setError(response.error || '実行結果を表示できませんでした。もう一度お試しください。')
        setErrorStatus(null)
        return
      }
      setData(response.data)
    } catch (caught) {
      if (requestId !== requestSequence.current) return
      const failure = describeFriendAddFailure(caught, '実行結果', 'load')
      setData(null)
      setError(failure.message)
      setErrorStatus(failure.status)
    } finally {
      if (requestId === requestSequence.current) setLoading(false)
    }
  }, [attribution, cursor, kind, perPage, routing, ruleIdFilter, selectedAccountId])

  useEffect(() => {
    if (!accountLoading) void load()
  }, [accountLoading, load])

  const lastScope = useRef<string | null>(null)
  useEffect(() => {
    const scope = `${selectedAccountId ?? ''}:${ruleIdFilter ?? ''}`
    if (lastScope.current === null) {
      lastScope.current = scope
      return
    }
    if (lastScope.current !== scope) {
      lastScope.current = scope
      resetCursor()
    }
  }, [selectedAccountId, ruleIdFilter, resetCursor])

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString())
    const trail = cursorStack.slice(1).join(',')
    if (trail) params.set('pages', trail)
    else params.delete('pages')
    const next = params.toString()
    if (next !== searchParams.toString()) router.replace(`?${next}`, { scroll: false })
  }, [cursorStack, searchParams, router])

  const applyFilter = (patch: { kind?: KindFilter; attribution?: AttributionFilter; routing?: RoutingFilter }) => {
    const params = new URLSearchParams(searchParams.toString())
    if (patch.kind !== undefined) {
      if (patch.kind === 'all') params.delete('kind')
      else params.set('kind', patch.kind)
    }
    if (patch.attribution !== undefined) {
      if (patch.attribution === 'all') params.delete('attribution')
      else params.set('attribution', patch.attribution)
    }
    if (patch.routing !== undefined) {
      if (patch.routing === 'all') params.delete('status')
      else params.set('status', patch.routing)
    }
    params.delete('pages')
    router.replace(`?${params.toString()}`, { scroll: false })
    resetCursor()
  }

  /* 板の札は種類と結果を1つずつ（押すと他方を外す）。 */
  const pickChip = (chip: 'all' | 'failed' | 'pending' | 'returning') => {
    if (chip === 'all') applyFilter({ kind: 'all', routing: 'all' })
    else if (chip === 'failed') applyFilter({ kind: 'all', routing: 'failed' })
    else if (chip === 'pending') applyFilter({ kind: 'all', routing: 'pending' })
    else applyFilter({ kind: 'returning', routing: 'all' })
  }
  const activeChip: 'all' | 'failed' | 'pending' | 'returning' =
    kind === 'returning' && routing === 'all' ? 'returning'
      : routing === 'failed' && kind === 'all' ? 'failed'
        : routing === 'pending' && kind === 'all' ? 'pending'
          : 'all'

  const summary = data?.summary ?? null
  const selectedAccountExists = selectedAccountId && accounts.some((account) => account.id === selectedAccountId)
  const routeBreakdown = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of data?.items ?? []) {
      const route = item.attribution.status === 'captured'
        ? item.attribution.routeName || item.attribution.reason || '選択した経路'
        : '経路が分からなかった人'
      counts.set(route, (counts.get(route) ?? 0) + 1)
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])
  }, [data])
  const visibleItems = useMemo(() => data?.items ?? [], [data])
  const activeRuleId = data?.items.find((item) => item.rule)?.rule?.id ?? null
  const failedItems = useMemo(() => visibleItems.filter((item) => item.status === 'failed'), [visibleItems])

  const loadRuleState = useCallback(async () => {
    if (!selectedAccountId || !activeRuleId) {
      setRuleState(null)
      return
    }
    try {
      const detail = await api.friendAddRules.get(selectedAccountId, activeRuleId)
      if (!detail.success) {
        setRuleState(null)
        return
      }
      setRuleState({
        status: detail.data.rule.status,
        resendSuppressionHours: detail.data.rule.definition.resendSuppressionHours ?? null,
      })
    } catch {
      setRuleState(null)
    }
  }, [activeRuleId, selectedAccountId])

  useEffect(() => {
    void loadRuleState()
  }, [loadRuleState])

  const stopDelivery = async () => {
    if (!selectedAccountId || !activeRuleId || stopBusy) return
    setStopBusy(true)
    setStopMessage('')
    try {
      const detail = await api.friendAddRules.get(selectedAccountId, activeRuleId)
      if (!detail.success) throw new Error('rule detail missing')
      const response = await api.friendAddRules.stop(selectedAccountId, activeRuleId, detail.data.rule.version)
      setStopMessage(response.success ? '配信を止めました。' : '配信を止められませんでした。')
      if (response.success) {
        setStopDialogOpen(false)
        await load()
        await loadRuleState()
      }
    } catch {
      setStopMessage('配信を停止できませんでした。状態を読み直してください。')
    } finally {
      setStopBusy(false)
    }
  }

  const detailHref = (id: string) => {
    const params = new URLSearchParams()
    params.set('id', id)
    if (kind !== 'all') params.set('kind', kind)
    if (attribution !== 'all') params.set('attribution', attribution)
    if (routing !== 'all') params.set('status', routing)
    if (ruleIdFilter) params.set('rule_id', ruleIdFilter)
    const trail = cursorStack.slice(1).join(',')
    if (trail) params.set('pages', trail)
    return `/friend-add-settings/runs/detail?${params.toString()}`
  }

  const exportCsv = async () => {
    if (!selectedAccountId || csvBusy) return
    setCsvBusy(true)
    setCsvNote('')
    try {
      const items: FriendAddRunList['items'] = []
      let exportCursor: string | undefined
      for (let page = 0; page < CSV_EXPORT_MAX_PAGES; page += 1) {
        const response = await api.friendAddRules.runs(selectedAccountId, {
          limit: CSV_EXPORT_PAGE_SIZE,
          cursor: exportCursor,
          status: routing === 'all' ? undefined : routing,
          kind: kind === 'all' ? undefined : kind,
          attribution: attribution === 'all' ? undefined : attribution,
          ruleId: ruleIdFilter ?? undefined,
        })
        if (!response.success) {
          setCsvNote('書き出す記録を読み込めませんでした。通信を確認して、もう一度お試しください。')
          return
        }
        items.push(...response.data.items)
        exportCursor = response.data.nextCursor ?? undefined
        if (!exportCursor) break
      }
      if (items.length === 0) {
        setCsvNote('書き出す記録がありません。')
        return
      }
      const truncated = Boolean(exportCursor)
      const header = ['受信日時', '友だち', '追加の種類', '確定した流入経路', '配信・処理', '処理日時']
      const rows = items.map((item) => {
        const routeName = item.attribution.status === 'captured'
          ? item.attribution.routeName || item.attribution.reason || '選択した経路'
          : '経路が分からなかった人'
        return [
          formatJstDateTime(item.receivedAt),
          item.friend.displayName || '名前は未取得',
          item.friendKind === 'first_time' ? 'はじめて' : '再追加・ブロック解除',
          routeName,
          routingLabel(item.status, item.errorCode).label,
          formatJstDateTime(item.processedAt),
        ]
      })
      const csv = `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')}`
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'friend-add-runs.csv'
      anchor.click()
      URL.revokeObjectURL(url)
      setCsvNote(truncated
        ? `新しい順に${formatNumber(items.length)}件まで書き出しました。それより古い記録は含まれていません。`
        : `${formatNumber(items.length)}件を書き出しました。`)
    } catch {
      setCsvNote('書き出す記録を読み込めませんでした。通信を確認して、もう一度お試しください。')
    } finally {
      setCsvBusy(false)
    }
  }

  /* 数の帯の4つ（板 `REIxB`）。無い数は「—」。 */
  const delivered = summary === null ? null : Math.max(0, summary.cumulativeDeliveries - summary.failed)
  const successRate = delivered === null || summary === null || summary.cumulativeDeliveries === 0
    ? '成功率 —'
    : `成功率 ${((delivered / summary.cumulativeDeliveries) * 100).toFixed(1)}%`
  const showFailureBand = !loading && !error && summary !== null && summary.failed > 0

  if (accountLoading || loading) return <ListState kind="loading" title="実行結果を読み込んでいます" />
  if (!selectedAccountExists) {
    return (
      <div className={styles.board} data-design-node="REIxB">
        <ListState
          kind="empty"
          title={accounts.length > 0 ? 'LINE公式アカウントを選んでください' : 'LINE公式アカウントが登録されていません'}
          description={accounts.length > 0 ? '上のバーで、確認するアカウントを選んでください。' : 'アカウントを登録すると実行結果を確認できます。'}
        />
      </div>
    )
  }
  if (error) {
    return (
      <div className={styles.board} data-design-node="REIxB">
        <ListState
          kind={errorStatus === 403 ? 'forbidden' : 'error'}
          title="実行結果を表示できませんでした"
          description={error}
          action={<Button onClick={() => void load()}>もう一度読み込む</Button>}
        />
      </div>
    )
  }

  return (
    <div className={styles.board} data-design-node="REIxB">
      <div className={styles.head}>
        <div className={styles.headText}>
          <Link className={styles.backLink} href="/friend-add-settings">← 友だち追加時の配信へ</Link>
          <h2 className={styles.headTitle}>実行結果：友だち追加時の配信</h2>
          <p className={styles.headDescription}>だれが・どの経路から来て・何を送ったか、失敗した処理を見ます。</p>
        </div>
        <div className={styles.headActions}>
          <Button
            variant="secondary"
            disabled={!canEdit || !activeRuleId || stopBusy}
            title={!canEdit ? 'この操作にはオーナーか管理者の権限が要ります' : !activeRuleId ? '実行結果がまだありません' : undefined}
            onClick={() => setStopDialogOpen(true)}
          >
            <Pause size={14} aria-hidden="true" />
            一時停止する
          </Button>
          <Button href="/friend-add-settings" variant="secondary">
            <Pencil size={14} aria-hidden="true" />
            設定の一覧へ
          </Button>
          <Button
            variant="secondary"
            disabled={!data?.items.length || csvBusy}
            busy={csvBusy}
            busyLabel="書き出し中…"
            onClick={() => void exportCsv()}
          >
            <Download size={14} aria-hidden="true" />
            CSVで書き出す
          </Button>
        </div>
      </div>

      {ruleIdFilter ? (
        <p className={styles.scopeNote}>
          この設定の実行結果だけを表示しています。
          <Link href="/friend-add-settings/runs" className={styles.textLink}>すべての記録へ戻る</Link>
        </p>
      ) : null}

      <div className={styles.kpis} aria-label="直近28日の実行結果">
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>直近28日の友だち追加</span>
          <p className={styles.kpiValue}>{summary === null ? '—' : formatNumber(summary.recentFriends)}<span className={styles.kpiUnit}>{summary === null ? '' : '人'}</span></p>
          <p className={styles.kpiDetail}>経路が取れた —人</p>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>送った案内</span>
          <p className={styles.kpiValue}>{summary === null ? '—' : formatNumber(summary.cumulativeDeliveries)}<span className={styles.kpiUnit}>{summary === null ? '' : '通'}</span></p>
          <p className={styles.kpiDetail}>{successRate}</p>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>失敗した処理</span>
          <p className={styles.kpiValue}>{summary === null ? '—' : formatNumber(summary.failed)}<span className={styles.kpiUnit}>{summary === null ? '' : '通'}</span></p>
          <p className={styles.kpiDetail}>理由を見て、もう一度実行できます</p>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>シナリオを始めた</span>
          <p className={styles.kpiValue}>{summary === null ? '—' : formatNumber(summary.scenarioStarts)}<span className={styles.kpiUnit}>{summary === null ? '' : '件'}</span></p>
          <p className={styles.kpiDetail}>直近28日</p>
        </div>
      </div>

      {showFailureBand ? (
        <div className={styles.failureBand} role="alert">
          <span className={styles.failureText}>
            <AlertCircle size={15} aria-hidden="true" />
            <span>
              <strong>失敗した処理が {formatNumber(summary?.failed ?? 0)}件あります</strong>
              <small>案内は届きましたが、シナリオを始められませんでした。</small>
            </span>
          </span>
          <span className={styles.failureActions}>
            <Button variant="secondary" onClick={() => pickChip('failed')}>失敗だけ見る</Button>
            <Button
              variant="primary"
              disabled={failedItems.length === 0}
              onClick={() => { if (failedItems[0]) router.push(detailHref(failedItems[0].id)) }}
            >
              失敗した処理をもう一度
            </Button>
          </span>
        </div>
      ) : null}

      <div className={styles.toolbar} role="group" aria-label="実行結果の絞り込み">
        <span className={styles.chips}>
          <FilterChip selected={activeChip === 'all'} onChange={() => pickChip('all')}>
            すべて{data ? ` ${formatNumber(data.total)}` : ''}
          </FilterChip>
          <FilterChip selected={activeChip === 'failed'} onChange={() => pickChip('failed')}>
            失敗{summary === null ? '' : ` ${formatNumber(summary.failed)}`}
          </FilterChip>
          <FilterChip selected={activeChip === 'pending'} onChange={() => pickChip('pending')}>
            テスト待ち
          </FilterChip>
          <FilterChip selected={activeChip === 'returning'} onChange={() => pickChip('returning')}>
            再追加
          </FilterChip>
        </span>
        <span className={styles.toolbarSpacer} />
        <PageSizeSelect value={perPage} onChange={(next) => { setPerPage(next); resetCursor() }} />
      </div>
      {csvNote ? <p className={styles.csvNote} role="status">{csvNote}</p> : null}

      {!data || visibleItems.length === 0 ? (
        <div className={styles.stateCard}>
          <span className={styles.stateIcon}>
            <History size={18} aria-hidden="true" />
          </span>
          <p className={styles.stateTitle}>条件に合う実行結果はありません</p>
          <p className={styles.stateDesc}>絞り込みを変えるか、次の友だち追加を待ってください。</p>
        </div>
      ) : (
        <>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <colgroup>
                <col style={{ width: 64 }} />
                <col />
                <col style={{ width: 170 }} />
                <col style={{ width: 92 }} />
                <col style={{ width: 220 }} />
                <col style={{ width: 64 }} />
                <col style={{ width: 44 }} />
              </colgroup>
              <thead>
                <tr>
                  <th>日時</th>
                  <th>友だち</th>
                  <th>来た経路</th>
                  <th>結果</th>
                  <th>行ったこと</th>
                  <th>時間</th>
                  <th aria-label="操作" />
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((item) => {
                  const status = routingLabel(item.status, item.errorCode)
                  /* 板 `REIxB` の札の言葉と色（口の「エラー」「青の待ち」はV8では出さない）。 */
                  const pillLabel = status.label === 'エラー' ? '失敗' : status.label
                  const pillTone = status.label === 'テスト待ち'
                    ? 'toneWarning'
                    : TONE_CLASS[status.tone] ?? 'toneNeutral'
                  const routeName = item.attribution.status === 'captured'
                    ? item.attribution.routeName || item.attribution.reason || '選択した経路'
                    : '経路が分からなかった人'
                  const displayName = item.friend.displayName || '名前は未取得'
                  const action = item.status === 'failed'
                    ? routingAction(item.status, item.errorCode)
                    : item.scenario?.started
                      ? `案内＋シナリオ「${item.scenario.name ?? '名前は未取得'}」を開始`
                      : item.deliveryCount > 0
                        ? `案内を${item.deliveryCount}通送信`
                        : item.actions.total > 0
                          ? `案内＋${item.actions.total}つの処理`
                          : routingAction(item.status, item.errorCode)
                  const kindLabel = item.friendKind === 'first_time' ? 'はじめて' : '再追加'
                  return (
                    <tr key={item.id}>
                      <td className={styles.timeCell}>{formatJstDateTime(item.receivedAt).slice(5)}</td>
                      <td>
                        <span className="flex min-w-0 items-center gap-2">
                          <Avatar name={displayName} size={24} />
                          <Link href={detailHref(item.id)} title={`${displayName}（${kindLabel}）`} className={styles.cellTitle}>
                            {displayName}
                          </Link>
                        </span>
                      </td>
                      <td>
                        <span className={styles.cellSub} title={routeName}>{routeName}</span>
                      </td>
                      <td>
                        <span className={`${styles.resultPill} ${styles[pillTone]}`}>
                          <span className={styles.resultDot} aria-hidden="true" />
                          {pillLabel}
                        </span>
                      </td>
                      <td>
                        <span className={styles.cellSub} title={action}>{action}</span>
                      </td>
                      <td className={styles.countCell}>{elapsedText(item.receivedAt, item.processedAt)}</td>
                      <td className="text-right">
                        <Link
                          href={detailHref(item.id)}
                          className={styles.menuButton}
                          title={`${displayName}の実行の詳細`}
                          aria-label={`${displayName}の実行の詳細`}
                        >
                          <MoreHorizontal size={16} aria-hidden="true" />
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className={styles.pagerRow}>
            <span className="text-ink-faint text-xs">
              {formatNumber(data.total)}件中 {(cursorPage - 1) * perPage + 1}〜{(cursorPage - 1) * perPage + data.items.length}件
            </span>
            {(canPrev || Boolean(data.nextCursor)) && (
              <div className="flex gap-2" aria-label="実行結果のページ送り">
                <Button disabled={!canPrev || loading} onClick={() => goPrev()}>前へ</Button>
                <Button disabled={!data.nextCursor || loading} onClick={() => data.nextCursor && goNext(data.nextCursor)}>次へ</Button>
              </div>
            )}
          </div>
        </>
      )}

      <div className={styles.bottomCards}>
        <section className={styles.card} aria-label="経路ごとの内訳">
          <h3 className={styles.cardTitle}>経路ごとの内訳</h3>
          <dl className={styles.bottomRows}>
            {routeBreakdown.map(([route, count]) => (
              <div key={route} className={styles.bottomRow}>
                <dt>{route}</dt>
                <dd>{formatNumber(count)}人（{data && data.items.length > 0 ? Math.round((count / data.items.length) * 1000) / 10 : 0}%）</dd>
              </div>
            ))}
          </dl>
        </section>
        <section className={styles.card} aria-label="二重送信を防ぐ・知らせ">
          <h3 className={styles.cardTitle}>二重送信を防ぐ・知らせ</h3>
          <dl className={styles.bottomRows}>
            <div className={styles.bottomRow}>
              <dt>二重送信を防ぐ</dt>
              <dd>{!ruleState || ruleState.resendSuppressionHours === null ? '—' : ruleState.resendSuppressionHours > 0 ? '有効' : '無効'}</dd>
            </div>
            <div className={styles.bottomRow}>
              <dt>失敗の知らせ</dt>
              <dd>—</dd>
            </div>
            <div className={styles.bottomRow}>
              <dt>最後に送った</dt>
              <dd>{summary?.lastDeliveryAt ? formatJstDateTime(summary.lastDeliveryAt).slice(5) : '—'}</dd>
            </div>
          </dl>
          <Link href="/inflow-links" className={styles.bottomLink}>→ 流入リンクを見る</Link>
        </section>
      </div>

      <ConfirmDialog
        open={stopDialogOpen}
        title="友だち追加時の配信を止めますか？"
        description="停止後は、新しく友だち追加された人へこの案内が送られません。設定は残るため、あとで再開できます。"
        confirmLabel="止める"
        busy={stopBusy}
        error={stopMessage.includes('できませんでした') ? stopMessage : undefined}
        onCancel={() => {
          if (!stopBusy) setStopDialogOpen(false)
        }}
        onConfirm={() => void stopDelivery()}
      />
    </div>
  )
}
