'use client'

/*
 * ★V8 友だち追加時の配信の実行結果（Pencil `REIxB`）。
 *
 * 型は詳細（DetailPage）：頭（戻る・題・説明・右に3つの操作）→ 数の帯（4つ）→
 * 失敗の帯 → 実行の記録（道具の段・表・ページ送り）→ 経路ごとの内訳と二重送信を防ぐ・知らせ。
 * 並びと寸法は合格した自動応答の実行結果（`src/v8/auto-replies/runs.tsx`・`nWmLg`）と同じ。
 * 取得・操作の動き（読み直し・絞り込み・カーソルのページ送り・一時停止・CSV）は
 * `app/friend-add-settings/runs/runs-v8.tsx` から写した（import はしない）。動きの一覧は BEHAVIOR.md。
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import type {
  FriendAddEventAttributionStatus,
  FriendAddEventKind,
  FriendAddEventRoutingStatus,
} from '@line-crm/shared'
import { ArrowLeft, Download, FileText, MessageCircle, MoreHorizontal, Pause, Pencil, RotateCcw, TriangleAlert } from 'lucide-react'
import { DetailPage } from '@/components/templates'
import { usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import IconButton from '@/components/shared/icon-button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import ListState from '@/components/shared/list-state'
import Pagination from '@/components/shared/pagination'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import StatusBadge, { type StatusBadgeTone } from '@/components/shared/status-badge'
import { DataTable, TableHeadRow, Th, Tr, Td } from '@/components/shared/table'
import { useAccount } from '@/contexts/account-context'
import { api, type FriendAddRunList } from '@/lib/api'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { formatNumber } from '@/lib/format'
import { describeFriendAddFailure } from '@/v8/friend-add/failure'
import { useCursorStack } from '@/v8/friend-add/use-cursor-stack'
import { csvCell, elapsedText, formatJstDateTime, jstTime, routingAction, routingLabel } from './status'
import styles from './runs.module.css'

type KindFilter = 'all' | FriendAddEventKind
type AttributionFilter = 'all' | FriendAddEventAttributionStatus
type RoutingFilter = 'all' | FriendAddEventRoutingStatus
type RunItem = FriendAddRunList['items'][number]
type Chip = 'all' | 'failed' | 'pending' | 'returning'

const RUN_STATUSES_PARAM = new Set<FriendAddEventRoutingStatus>([
  'pending', 'completed', 'failed', 'suppressed', 'partial_failed',
])

/** CSV 書き出しの安全弁（今までと同じ：100件×50頁＝5,000件で止める）。 */
const CSV_EXPORT_MAX_PAGES = 50
const CSV_EXPORT_PAGE_SIZE = 100
const PAGE_SIZE_OPTIONS = [10, 20, 50].map((n) => ({ value: String(n), label: `${n}件表示` }))
const NO_MANAGE_NOTE = '閲覧のみで見ています。一時停止・もう一度実行はオーナーと管理者だけができます。実行結果の確認と書き出しはこのまま使えます。'

function routeNameOf(item: RunItem): string {
  return item.attribution.status === 'captured'
    ? item.attribution.routeName || item.attribution.reason || '選択した経路'
    : '経路が分からない'
}

function displayNameOf(item: RunItem): string {
  return item.friend.displayName || '名前は未取得'
}

function initialOf(name: string): string {
  const trimmed = name.trim()
  return trimmed ? Array.from(trimmed)[0].toUpperCase() : '?'
}

/** 結果の札。以前からの友だちで案内を送らなかった記録は「再追加」（絵どおり）。 */
export function resultView(item: RunItem): { label: string; tone: StatusBadgeTone } {
  if (item.friendKind === 'returning' && item.status === 'suppressed') return { label: '再追加', tone: 'neutral' }
  return routingLabel(item.status, item.errorCode)
}

/** 「行ったこと」の1行。 */
export function actionText(item: RunItem): string {
  if (item.status === 'failed') {
    return item.deliveryCount > 0 && item.scenario && !item.scenario.started
      ? '案内は届いた・シナリオを始められなかった'
      : routingAction(item.status, item.errorCode)
  }
  if (item.friendKind === 'returning' && item.status === 'suppressed') {
    return item.actions.total > 0 ? '以前からの友だち（再追加）→ 案内なし・処理だけ' : '以前からの友だち（再追加）→ 案内なし'
  }
  if (item.scenario?.started) return `案内＋シナリオ「${item.scenario.name ?? '名前は未取得'}」を開始`
  if (item.status === 'pending' && item.actions.total > 0) return `案内＋${item.actions.total}つの処理（テスト待ち）`
  if (item.deliveryCount > 0) return `案内を${item.deliveryCount}通送信`
  if (item.actions.total > 0) return `案内＋${item.actions.total}つの処理`
  return routingAction(item.status, item.errorCode)
}

export default function FriendAddRunsV8() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <FriendAddRunsInner />
    </Suspense>
  )
}

function FriendAddRunsInner() {
  usePageTitle('実行結果：友だち追加時の配信')
  const { selectedAccountId, accounts, loading: accountLoading } = useAccount()
  const role = useStaffRole()
  const canManage = role === null || canManageRole(role)
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
  const [search, setSearch] = useState('')
  const [csvBusy, setCsvBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [stopBusy, setStopBusy] = useState(false)
  const [stopOpen, setStopOpen] = useState(false)
  const [stopError, setStopError] = useState('')
  const [retrying, setRetrying] = useState<string | null>(null)
  const [menuId, setMenuId] = useState<string | null>(null)
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
      if (!response.success || !Array.isArray(response.data?.items)) {
        setData(null)
        setError((!response.success && response.error) || '実行結果を表示できませんでした。もう一度お試しください。')
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

  /* アカウント・設定の絞り込みが替わったら1ページ目へ。 */
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

  /* 今のページのカーソルの束を URL に残す（詳細から戻ったとき同じページに戻れる）。 */
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString())
    const trail = cursorStack.slice(1).join(',')
    if (trail) params.set('pages', trail)
    else params.delete('pages')
    const next = params.toString()
    if (next !== searchParams.toString()) router.replace(`?${next}`, { scroll: false })
  }, [cursorStack, searchParams, router])

  const applyFilter = (patch: { kind?: KindFilter; routing?: RoutingFilter }) => {
    const params = new URLSearchParams(searchParams.toString())
    if (patch.kind !== undefined) {
      if (patch.kind === 'all') params.delete('kind')
      else params.set('kind', patch.kind)
    }
    if (patch.routing !== undefined) {
      if (patch.routing === 'all') params.delete('status')
      else params.set('status', patch.routing)
    }
    params.delete('pages')
    router.replace(`?${params.toString()}`, { scroll: false })
    resetCursor()
  }

  /* 札は種類と結果を1つずつ（押すと他方を外す）。 */
  const pickChip = (chip: Chip) => {
    if (chip === 'all') applyFilter({ kind: 'all', routing: 'all' })
    else if (chip === 'failed') applyFilter({ kind: 'all', routing: 'failed' })
    else if (chip === 'pending') applyFilter({ kind: 'all', routing: 'pending' })
    else applyFilter({ kind: 'returning', routing: 'all' })
  }
  const activeChip: Chip =
    kind === 'returning' && routing === 'all' ? 'returning'
      : routing === 'failed' && kind === 'all' ? 'failed'
        : routing === 'pending' && kind === 'all' ? 'pending'
          : 'all'

  const summary = data?.summary ?? null
  const items = useMemo(() => data?.items ?? [], [data])
  const query = search.trim().toLowerCase()
  /* 検索は今のページの中だけ（口に検索が無い）。 */
  const visibleItems = items.filter((item) => !query
    || [displayNameOf(item), routeNameOf(item)].some((text) => text.toLowerCase().includes(query)))
  const routeBreakdown = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of items) counts.set(routeNameOf(item), (counts.get(routeNameOf(item)) ?? 0) + 1)
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])
  }, [items])
  const activeRuleId = ruleIdFilter ?? items.find((item) => item.rule)?.rule?.id ?? null
  const failedItems = items.filter((item) => item.status === 'failed' || item.status === 'partial_failed')

  const loadRuleState = useCallback(async () => {
    if (!selectedAccountId || !activeRuleId) {
      setRuleState(null)
      return
    }
    try {
      const detail = await api.friendAddRules.get(selectedAccountId, activeRuleId)
      setRuleState(detail.success
        ? { status: detail.data.rule.status, resendSuppressionHours: detail.data.rule.definition.resendSuppressionHours ?? null }
        : null)
    } catch {
      setRuleState(null)
    }
  }, [activeRuleId, selectedAccountId])

  useEffect(() => { void loadRuleState() }, [loadRuleState])

  const stopDelivery = async () => {
    if (!selectedAccountId || !activeRuleId || stopBusy) return
    setStopBusy(true)
    setStopError('')
    try {
      const detail = await api.friendAddRules.get(selectedAccountId, activeRuleId)
      if (!detail.success) throw new Error('rule detail missing')
      const response = await api.friendAddRules.stop(selectedAccountId, activeRuleId, detail.data.rule.version)
      if (!response.success) throw new Error('stop failed')
      setStopOpen(false)
      setMessage('配信を止めました。')
      await load()
      await loadRuleState()
    } catch {
      setStopError('配信を停止できませんでした。状態を読み直してください。')
    } finally {
      setStopBusy(false)
    }
  }

  /* もう一度実行（1件）。 */
  const retryOne = async (item: RunItem): Promise<boolean> => {
    if (!selectedAccountId) return false
    try {
      const response = await api.friendAddRules.retryRun(selectedAccountId, item.id)
      return response.success
    } catch {
      return false
    }
  }
  const retryRun = async (item: RunItem) => {
    if (retrying) return
    setRetrying(item.id)
    setMessage('')
    const ok = await retryOne(item)
    setRetrying(null)
    setMessage(ok ? '失敗した処理をもう一度実行しました。' : describeFriendAddFailure(null, '実行結果', 'retry').message)
    await load()
  }
  /* 「失敗した処理をもう一度」：今のページの失敗を順に実行する。 */
  const retryAllFailed = async () => {
    if (retrying || failedItems.length === 0) return
    setRetrying('all')
    setMessage('')
    let retried = 0
    for (const item of failedItems) {
      if (await retryOne(item)) retried += 1
    }
    setRetrying(null)
    setMessage(retried > 0 ? `失敗した処理を${retried}件もう一度実行しました。` : 'もう一度実行できる処理はありませんでした。')
    await load()
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
    setMessage('')
    try {
      const rows: RunItem[] = []
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
          setMessage('書き出す記録を読み込めませんでした。通信を確認して、もう一度お試しください。')
          return
        }
        rows.push(...response.data.items)
        exportCursor = response.data.nextCursor ?? undefined
        if (!exportCursor) break
      }
      if (rows.length === 0) {
        setMessage('書き出す記録がありません。')
        return
      }
      const header = ['受信日時', '友だち', '追加の種類', '確定した流入経路', '配信・処理', '処理日時']
      const body = rows.map((item) => [
        formatJstDateTime(item.receivedAt),
        displayNameOf(item),
        item.friendKind === 'first_time' ? 'はじめて' : '再追加・ブロック解除',
        item.attribution.status === 'captured' ? item.attribution.routeName || item.attribution.reason || '選択した経路' : '経路が分からなかった人',
        routingLabel(item.status, item.errorCode).label,
        formatJstDateTime(item.processedAt),
      ])
      const csv = `﻿${[header, ...body].map((row) => row.map(csvCell).join(',')).join('\n')}`
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'friend-add-runs.csv'
      anchor.click()
      URL.revokeObjectURL(url)
      setMessage(exportCursor
        ? `新しい順に${formatNumber(rows.length)}件まで書き出しました。それより古い記録は含まれていません。`
        : `${formatNumber(rows.length)}件を書き出しました。`)
    } catch {
      setMessage('書き出す記録を読み込めませんでした。通信を確認して、もう一度お試しください。')
    } finally {
      setCsvBusy(false)
    }
  }

  const selectedAccountExists = Boolean(selectedAccountId && accounts.some((account) => account.id === selectedAccountId))
  const failedCount = summary?.failed ?? 0
  const delivered = summary === null ? null : Math.max(0, summary.cumulativeDeliveries - summary.failed)
  const successRate = delivered === null || summary === null || summary.cumulativeDeliveries === 0
    ? '成功率 —'
    : `成功率 ${((delivered / summary.cumulativeDeliveries) * 100).toFixed(1)}%`
  const chips: Array<{ key: Chip; label: string }> = [
    { key: 'all', label: data ? `すべて ${formatNumber(data.total)}` : 'すべて' },
    { key: 'failed', label: summary ? `失敗 ${formatNumber(summary.failed)}` : '失敗' },
    { key: 'pending', label: 'テスト待ち' },
    { key: 'returning', label: '再追加' },
  ]
  const pageCount = cursorPage + (data?.nextCursor ? 1 : 0)
  const changePage = (next: number) => {
    if (next === cursorPage + 1 && data?.nextCursor) goNext(data.nextCursor)
    else if (next < cursorPage) for (let i = next; i < cursorPage; i += 1) goPrev()
  }

  const rowMenuItems = (item: RunItem): ActionMenuItem[] => {
    const list: ActionMenuItem[] = [
      { id: 'detail', label: '実行の詳細を開く', icon: <FileText size={14} aria-hidden="true" />, onSelect: () => router.push(detailHref(item.id)) },
    ]
    if (!item.friend.redacted && item.friend.id) {
      const friendId = item.friend.id
      list.push({ id: 'chat', label: 'トークを開く', icon: <MessageCircle size={14} aria-hidden="true" />, onSelect: () => router.push(`/chats?friend=${encodeURIComponent(friendId)}`) })
    }
    if (canManage && (item.status === 'failed' || item.status === 'partial_failed')) {
      list.push({ id: 'retry', label: 'もう一度実行', icon: <RotateCcw size={14} aria-hidden="true" />, disabled: retrying !== null, onSelect: () => { void retryRun(item) } })
    }
    return list
  }

  const head = {
    boardId: 'REIxB',
    title: '実行結果：友だち追加時の配信',
    description: 'だれが・どの経路から来て・何を送ったか、失敗した処理を見ます。',
    identity: <Link href="/friend-add-settings" className={styles.backLink}><ArrowLeft size={14} aria-hidden="true" />友だち追加時の配信へ</Link>,
  }

  if (!accountLoading && !loading && !selectedAccountExists) {
    return (
      <DetailPage {...head}>
        <ListState
          kind="empty"
          title={accounts.length > 0 ? 'LINE公式アカウントを選んでください' : 'LINE公式アカウントが登録されていません'}
          description={accounts.length > 0 ? '上のバーで、確認するアカウントを選んでください。' : 'アカウントを登録すると実行結果を確認できます。'}
        />
      </DetailPage>
    )
  }

  return (
    <DetailPage
      {...head}
      actions={<div className={styles.headActions}>
        {canManage ? (
          <Button onClick={() => { setStopError(''); setStopOpen(true) }} disabled={!activeRuleId || stopBusy || ruleState?.status === 'paused'}
            title={!activeRuleId ? '実行結果がまだありません' : undefined}>
            <Pause size={14} aria-hidden="true" />一時停止する
          </Button>
        ) : null}
        <Button href="/friend-add-settings">
          <Pencil size={14} aria-hidden="true" />設定の一覧へ
        </Button>
        <Button onClick={() => void exportCsv()} disabled={!items.length || csvBusy} busy={csvBusy} busyLabel="書き出しています">
          <Download size={14} aria-hidden="true" />CSVで書き出す
        </Button>
      </div>}
    >
      {!canManage ? <p className={styles.viewerBand} role="status">{NO_MANAGE_NOTE}</p> : null}
      {ruleIdFilter ? (
        <p className={styles.hint}>
          この設定の実行結果だけを表示しています。
          <Link href="/friend-add-settings/runs" className={styles.textLink}>すべての記録へ戻る</Link>
        </p>
      ) : null}

      <div className={styles.kpis}>
        <KpiBand data-design="KPIs">
          <KpiCard presentation="band" icon={null} title="直近28日の友だち追加" value={summary ? summary.recentFriends ?? null : null} unit="人"
            detail={`追加の記録 ${summary?.recentEvents == null ? '—' : formatNumber(summary.recentEvents)}件`} />
          <KpiCard presentation="band" icon={null} title="送った案内" value={summary ? summary.cumulativeDeliveries : null} unit="通" detail={successRate} />
          <KpiCard presentation="band" icon={null} title="失敗した処理" value={summary ? summary.failed : null} unit="通"
            detail={failedCount > 0 ? '理由を見て、もう一度実行できます' : '記録を始めてからの合計です'} />
          <KpiCard presentation="band" icon={null} title="シナリオを始めた" value={summary ? summary.scenarioStarts : null} unit="件" detail="直近28日" />
        </KpiBand>
      </div>

      {!loading && !error && failedCount > 0 ? (
        <div className={styles.failBand} role="alert">
          <TriangleAlert size={18} className={styles.failIcon} aria-hidden="true" />
          <div className={styles.failText}>
            <p className={styles.failTitle}>{`失敗した処理が ${formatNumber(failedCount)}件あります`}</p>
            <p className={styles.failNote}>案内は届きましたが、シナリオを始められませんでした。止まった行の理由を見て、もう一度実行できます。</p>
          </div>
          <Button onClick={() => pickChip('failed')}>失敗だけ見る</Button>
          {canManage ? (
            <Button variant="primary" onClick={() => void retryAllFailed()} disabled={failedItems.length === 0 || retrying !== null}
              busy={retrying === 'all'} busyLabel="実行しています">
              <RotateCcw size={14} aria-hidden="true" />失敗した処理をもう一度
            </Button>
          ) : null}
        </div>
      ) : null}

      <section className={styles.card} aria-label="実行の記録">
        <div className={styles.tools} role="group" aria-label="実行結果の絞り込み">
          <div className={styles.searchBox}>
            <SearchField
              placeholder="友だち・経路で探す"
              aria-label="友だち・経路で探す"
              value={search}
              onChange={(value) => setSearch(value)}
              onClear={() => setSearch('')}
            />
          </div>
          <div className={styles.chips} role="group" aria-label="結果で絞り込む">
            {chips.map((chip) => (
              <button key={chip.key} type="button" className={styles.chip} aria-pressed={activeChip === chip.key} onClick={() => pickChip(chip.key)}>
                {chip.label}
              </button>
            ))}
          </div>
          <span className={styles.toolsSpacer} aria-hidden="true" />
          <div className={styles.sizeBox}>
            <Select
              aria-label="1ページに出す件数"
              size="page-size"
              value={String(perPage)}
              onChange={(value) => { setPerPage(Number(value)); resetCursor() }}
              options={PAGE_SIZE_OPTIONS}
            />
          </div>
        </div>

        {accountLoading || loading ? (
          <ListState kind="loading" />
        ) : error ? (
          <ListState
            kind={errorStatus === 403 ? 'forbidden' : 'error'}
            title="実行結果を表示できませんでした"
            description={error}
            action={<Button onClick={() => void load()}>もう一度読み込む</Button>}
          />
        ) : visibleItems.length === 0 ? (
          <ListState kind="empty" title="条件に合う実行結果はありません" description="絞り込みを変えるか、次の友だち追加を待ってください。" />
        ) : (
          <DataTable className={styles.table}>
            <thead>
              <TableHeadRow className={styles.headRow} data-table-layout="columns">
                <Th className={styles.colWhen}>日時</Th>
                <Th className={styles.colFriend}>友だち</Th>
                <Th className={styles.colRoute}>来た経路</Th>
                <Th className={styles.colResult}>結果</Th>
                <Th className={styles.colDone}>行ったこと</Th>
                <Th className={styles.colTime}>時間</Th>
                <Th className={styles.colMenu}><span className="sr-only">操作</span></Th>
              </TableHeadRow>
            </thead>
            <tbody>
              {visibleItems.map((item) => {
                const view = resultView(item)
                const name = displayNameOf(item)
                const route = routeNameOf(item)
                const done = actionText(item)
                const kindLabel = item.friendKind === 'first_time' ? 'はじめて' : '再追加'
                return (
                  <Tr key={item.id} className={styles.row} data-table-layout="columns">
                    <Td className={styles.colWhen}>
                      <time dateTime={item.receivedAt} title={formatJstDateTime(item.receivedAt)} className={styles.when}>{jstTime(item.receivedAt)}</time>
                    </Td>
                    <Td className={styles.colFriend}>
                      <span className={styles.face} aria-hidden="true">{initialOf(name)}</span>
                      <Link className={styles.friendName} href={detailHref(item.id)} title={`${name}（${kindLabel}）`}>{name}</Link>
                    </Td>
                    <Td className={styles.colRoute}><span className={styles.route} title={route}>{route}</span></Td>
                    <Td className={styles.colResult}><StatusBadge tone={view.tone} size="compact">{view.label}</StatusBadge></Td>
                    <Td className={styles.colDone}><span className={styles.done} title={done}>{done}</span></Td>
                    <Td className={styles.colTime}><span className={styles.time}>{elapsedText(item.receivedAt, item.processedAt)}</span></Td>
                    <Td className={styles.colMenu}>
                      <div className={styles.menuBox}>
                        <IconButton
                          title={`${name}さんの記録の操作`}
                          aria-label={`${name}さんの記録の操作`}
                          aria-expanded={menuId === item.id}
                          onClick={() => setMenuId((current) => (current === item.id ? null : item.id))}
                        >
                          <MoreHorizontal size={16} aria-hidden="true" />
                        </IconButton>
                        <ActionMenu open={menuId === item.id} onClose={() => setMenuId(null)} ariaLabel={`${name}さんの記録の操作`} items={rowMenuItems(item)} />
                      </div>
                    </Td>
                  </Tr>
                )
              })}
            </tbody>
          </DataTable>
        )}
        {!loading && !error && data && items.length > 0 ? (
          <div className={styles.pager}>
            <Pagination
              page={cursorPage}
              pageCount={pageCount}
              onPageChange={changePage}
              disabled={loading}
              summary={`${formatNumber(data.total)}件中 ${(cursorPage - 1) * perPage + 1}〜${(cursorPage - 1) * perPage + items.length}件`}
            />
          </div>
        ) : null}
      </section>

      <div className={styles.bottom}>
        <section className={styles.box} aria-label="経路ごとの内訳">
          <h2 className={styles.boxTitle}>経路ごとの内訳</h2>
          {routeBreakdown.length === 0 ? (
            <ListState kind="empty" title="内訳はまだありません" description="実行結果がたまると、経路ごとの人数が分かります。" />
          ) : (
            <dl className={styles.kv}>
              {routeBreakdown.map(([route, count]) => (
                <div className={styles.kvRow} key={route}>
                  <dt>{route}</dt>
                  <dd>{`${formatNumber(count)}人（${Math.round((count / items.length) * 100)}%）`}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>

        <section className={styles.box} aria-label="二重送信を防ぐ・知らせ">
          <h2 className={styles.boxTitle}>二重送信を防ぐ・知らせ</h2>
          <dl className={styles.kv}>
            <div className={styles.kvRow}>
              <dt>二重送信を防ぐ</dt>
              <dd>{!ruleState || ruleState.resendSuppressionHours === null ? '—' : ruleState.resendSuppressionHours > 0 ? '有効' : '無効'}</dd>
            </div>
            <div className={styles.kvRow}>
              <dt>失敗の知らせ</dt>
              <dd>—</dd>
            </div>
            <div className={styles.kvRow}>
              <dt>最後に送った</dt>
              <dd>{summary?.lastDeliveryAt ? jstTime(summary.lastDeliveryAt) : '—'}</dd>
            </div>
          </dl>
          <div className={styles.boxFoot}>
            <Button variant="text" href="/inflow-links">流入リンクを見る</Button>
          </div>
        </section>
      </div>

      {message ? <p className={styles.hint} role="status">{message}</p> : null}

      <ConfirmDialog
        open={stopOpen}
        title="友だち追加時の配信を止めますか？"
        description="停止後は、新しく友だち追加された人へこの案内が送られません。設定は残るため、あとで再開できます。"
        confirmLabel="止める"
        busy={stopBusy}
        error={stopError || undefined}
        onCancel={() => { if (!stopBusy) setStopOpen(false) }}
        onConfirm={() => void stopDelivery()}
      />
    </DetailPage>
  )
}
