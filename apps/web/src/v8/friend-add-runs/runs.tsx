'use client'
import TruncatedText from '@/components/shared/truncated-text'
import Card from '@/components/shared/card'
import { CreateSummaryCard } from '@/components/templates/create-parts'
import { DashboardColumns } from '@/components/templates/dashboard-page'
import PageSizeSelect from '@/components/shared/page-size-select'
import { ListToolbarFrame, ListToolbarRow } from '@/components/shared/list-toolbar'
import { canManageRole, useStaffRole } from '@/lib/staff-role';

import { RowNameLink } from '@/components/shared/table';

import SegmentedControl from '@/components/shared/segmented'
import { runCounts } from './run-counts'
import { useFeatureAccess } from '@/lib/use-feature-access';
import { useListUrlValue } from '@/components/shared/list-url-state';
import { useSamePageUrl } from '@/lib/use-same-page-url';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { FriendAddEventAttributionStatus, FriendAddEventKind, FriendAddEventRoutingStatus } from '@line-crm/shared';
import { UserPlus, Send, Play, Download, FileText, MessageCircle, Pause, Pencil, RotateCcw } from 'lucide-react';
import Link from '@/components/shared/list-navigation'

import { useListNavigationRouter as useRouter } from '@/components/shared/list-navigation';

import { TriangleAlert } from 'lucide-react';
import { DetailPage } from '@/components/templates';
import { usePageTitle } from '@/components/shell/page-chrome';
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { type ActionMenuItem } from '@/components/shared/action-menu';
import { RowMenu } from '@/components/shared/row-actions';
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import ListState from '@/components/shared/list-state'
import Pagination from '@/components/shared/pagination'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import StatusBadge, { type StatusBadgeTone } from '@/components/shared/status-badge';
import { DataTable, TableHeadRow, Th, Tr, Td, PersonCell, ActionCell } from '@/components/shared/table';
import { useAccount } from '@/contexts/account-context';
import { api, type FriendAddRunList } from '@/lib/api';
import { formatNumber } from '@/lib/format';
import { describeFriendAddFailure } from '@/v8/friend-add/public/failure/index'
import { useCursorStack } from '@/v8/friend-add/public/use-cursor-stack/index'
import { csvCell, elapsedText, formatJstDateTime, jstTime, routingAction, routingLabel } from './status';
import styles from './runs.module.css'
import { csvFileName } from '@/lib/csv-file-name';
import { emptyValue } from '@/components/shared/empty-value';
import { SaveErrorField } from '@/components/shared/save-form-errors';
import ReadOnlyNotice from '@/components/shared/read-only-notice'
import Notice from '@/components/shared/notice'

/*
 * ★V8 友だち追加時の配信の実行結果（Pencil ）。
 *
 * 型は詳細（DetailPage）：頭（戻る・題・説明・右に3つの操作）→ 数の帯（4つ）→
 * 失敗の帯 → 実行の記録（道具の段・表・ページ送り）→ 経路ごとの内訳と二重送信を防ぐ・知らせ。
 * 並びと寸法は合格した自動応答の実行結果（`src/v8/auto-replies/runs.tsx`・）と同じ。
 * 取得・操作の動き（読み直し・絞り込み・カーソルのページ送り・一時停止・CSV）は
 * `app/friend-add-settings/runs/runs-v8.tsx` から写した（import はしない）。動きの一覧は BEHAVIOR.md。
 */

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
const NO_MANAGE_NOTE = '閲覧のみで見ています。一時停止・もう一度実行はオーナーと管理者だけができます。実行結果の確認と書き出しはこのまま使えます。'

function routeNameOf(item: RunItem): string {
  return item.attribution.status === 'captured'
    ? item.attribution.routeName || item.attribution.reason || '選択した経路'
    : '経路が分からない'
}

function displayNameOf(item: RunItem): string {
  return item.friend.displayName || '名前は未取得'
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
  if (item.deliveryCount > 0) return `案内を${item.deliveryCount} 通送信`
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
  const canManage = useFeatureAccess('friendAdd')
  const searchParams = useSearchParams()
  const router = useRouter()
  const samePageUrl = useSamePageUrl()
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
  const [perPage, setPerPage] = useListUrlValue('perPage', 20)
  const [data, setData] = useState<FriendAddRunList | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [errorStatus, setErrorStatus] = useState<number | null>(null)
  const [search, setSearch] = useListUrlValue('q', '')
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
    if (next !== searchParams.toString()) samePageUrl.replace(`?${next}`)
  }, [cursorStack, searchParams, samePageUrl])

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
    samePageUrl.replace(`?${params.toString()}`)
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
    const failed = failedItems.length - retried
    setMessage(failed > 0
      ? `${retried > 0 ? `失敗した処理を${retried} 件もう一度実行しました。` : ''}${failed} 件をもう一度実行できませんでした。時間を置いてお試しください。`
      : `失敗した処理を${retried} 件もう一度実行しました。`)
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
      anchor.download = csvFileName("友だち追加の実行履歴")
      anchor.click()
      URL.revokeObjectURL(url)
      setMessage(exportCursor
        ? `新しい順に${formatNumber(rows.length)} 件まで書き出しました。それより古い記録は含まれていません。`
        : `${formatNumber(rows.length)} 件を書き出しました。`)
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
  const counts = runCounts(kind, routing, data?.total, summary)
  const chips: Array<{ key: Chip; label: string; count?: number }> = [
    { key: 'all', label: 'すべて', count: counts.all },
    { key: 'failed', label: '失敗', count: counts.failed },
    { key: 'pending', label: 'テスト待ち', count: counts.pending },
    { key: 'returning', label: '再追加', count: counts.returning },
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
    help: 'だれが・どの経路から来て・何を送ったか、失敗した処理を見ます。',
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
      {!canManage ? <div className={styles.viewerBand}><ReadOnlyNotice role="status">{NO_MANAGE_NOTE}</ReadOnlyNotice></div> : null}
      {ruleIdFilter ? (
        <p className={styles.hint}>
          この設定の実行結果だけを表示しています。
          <Link href="/friend-add-settings/runs" className={styles.textLink}>すべての記録へ戻る</Link>
        </p>
      ) : null}

      <div className={styles.kpis}>
        <KpiBand data-design="KPIs">
          <KpiCard presentation="band" icon={<UserPlus size={14} aria-hidden="true" />} title="直近28日の友だち追加" value={summary ? summary.recentFriends ?? null : null} unit="人"
            detail={`追加の記録 ${summary?.recentEvents == null ? emptyValue('unknown') : formatNumber(summary.recentEvents)}件`} />
          <KpiCard presentation="band" icon={<Send size={14} aria-hidden="true" />} title="送った案内" value={summary ? summary.cumulativeDeliveries : null} unit="通" detail={successRate} />
          <KpiCard presentation="band" icon={<TriangleAlert size={14} aria-hidden="true" />} title="失敗した処理" value={summary ? summary.failed : null} unit="通"
            detail={failedCount > 0 ? '理由を見て、もう一度実行できます' : '記録を始めてからの合計です'} />
          <KpiCard presentation="band" icon={<Play size={14} aria-hidden="true" />} title="シナリオを始めた" value={summary ? summary.scenarioStarts : null} unit="件" detail="直近28日" />
        </KpiBand>
      </div>

      {!loading && !error && failedCount > 0 ? (
        <Notice tone="danger" heading={<> {`失敗した処理が ${formatNumber(failedCount)} 件あります`} </>} action={<> <Button onClick={() => pickChip('failed')}>失敗だけ見る</Button>{canManage ? (
            <Button variant="primary" onClick={() => void retryAllFailed()} disabled={failedItems.length === 0 || retrying !== null}
              busy={retrying === 'all'} busyLabel="実行しています">
              <RotateCcw size={14} aria-hidden="true" />失敗した処理をもう一度
            </Button>
          ) : null} </>} >案内は届きましたが、シナリオを始められませんでした。止まった行の理由を見て、もう一度実行できます。</Notice>
      ) : null}

      <Card padding="none" aria-label="実行の記録">
        <ListToolbarFrame role="group" aria-label="実行結果の絞り込み"><ListToolbarRow>

            <SearchField
              placeholder="友だち・経路で探す"
              aria-label="友だち・経路で探す"
              value={search}
              onChange={(value) => setSearch(value)}
              onClear={() => setSearch('')}
            />

          <SegmentedControl aria-label="結果で絞り込む" value={activeChip} onChange={pickChip} options={chips.map(chip=>({value:chip.key,label:chip.label,count:chip.count}))} />


            <SaveErrorField names={["perPage","limit","per_page"]}><PageSizeSelect label={null} value={perPage} onChange={(value) => { setPerPage(value); resetCursor() }} /></SaveErrorField>

        </ListToolbarRow></ListToolbarFrame>

        {accountLoading || loading ? (
          <ListState kind="loading" />
        ) : error ? (
          <ListState
            kind={errorStatus === 403 ? 'forbidden' : 'error'}
            title="実行結果を表示できませんでした"
            description={error}
            onRetry={() => void load()}
          />
        ) : visibleItems.length === 0 ? (
          <ListState kind="empty" title="条件に合う実行結果はありません" description="絞り込みを変えるか、次の友だち追加を待ってください。" />
        ) : (
          <DataTable columnLayout={{ headHeight: 'var(--polish-table-head)', rowHeight: 'var(--polish-table-row)', gap: 'var(--polish-space-card)', padding: '0 var(--tpl-list-inset)', collapseScope: 'page' }}>
            <thead>
              <TableHeadRow data-table-layout="columns">
                <Th className={styles.colWhen}>日時</Th>
                <Th className={styles.colFriend}>友だち</Th>
                <Th className={styles.colRoute}>来た経路</Th>
                <Th className={styles.colResult}>結果</Th>
                <Th grow className={styles.colDone}>行ったこと</Th>
                <Th collapseAt="narrow" className={styles.colTime}>時間</Th>
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
                  <Tr key={item.id} data-table-layout="columns" data-row-id={item.id}>
                    <Td className={styles.colWhen}>
                      <time dateTime={item.receivedAt} title={formatJstDateTime(item.receivedAt)} className={styles.when}>{jstTime(item.receivedAt)}</time>
                    </Td>
                    <PersonCell className={styles.colFriend} avatarName={name} name={
                      <RowNameLink href={detailHref(item.id)} title={`${name}（${kindLabel}）`}>{name}</RowNameLink>
                    } />
                    <Td className={styles.colRoute}><span className={styles.route} title={route}>{route}</span></Td>
                    <Td className={styles.colResult}><StatusBadge tone={view.tone} size="compact">{view.label}</StatusBadge></Td>
                    <Td grow className={styles.colDone}><TruncatedText value={done} /></Td>
                    <Td collapseAt="narrow" className={styles.colTime}><span className={styles.time}>{elapsedText(item.receivedAt, item.processedAt)}</span></Td>
                    <ActionCell>
                      <div className={styles.menuBox}>
                        <RowMenu
                          size="row" label={`${name}さんの記録の操作`}
                          items={rowMenuItems(item)}
                          open={menuId === item.id}
                          onOpenChange={(next) => setMenuId(next ? item.id : null)}
                        />
                      </div>
                    </ActionCell>
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
              range={{ total: data.total, first: (cursorPage - 1) * perPage + 1, last: (cursorPage - 1) * perPage + items.length }}
            />
          </div>
        ) : null}
      </Card>

      <DashboardColumns layout="cards">{[
        <CreateSummaryCard key="routes" title="経路ごとの内訳" variant="record" rows={routeBreakdown.map(([route, count]) => ({ key: route, label: route, value: `${formatNumber(count)} 人（${Math.round((count / items.length) * 100)}%）` }))}>
          {routeBreakdown.length === 0 ? <ListState kind="empty" title="内訳はまだありません" description="実行結果がたまると、経路ごとの人数が分かります。" /> : null}
        </CreateSummaryCard>,
        <CreateSummaryCard key="suppression" title="二重送信を防ぐ・知らせ" variant="record" rows={[
          { label: '二重送信を防ぐ', value: !ruleState || ruleState.resendSuppressionHours === null ? emptyValue('unknown') : ruleState.resendSuppressionHours > 0 ? '有効' : '無効' },
          { label: '失敗の知らせ', value: emptyValue('unknown') },
          { label: '最後に送った', value: <span title={summary?.lastDeliveryAt ? formatJstDateTime(summary.lastDeliveryAt) : undefined}>{summary?.lastDeliveryAt ? jstTime(summary.lastDeliveryAt) : emptyValue('unknown')}</span> },
        ]}><Button variant="text" href="/inflow-links">流入リンクを見る</Button></CreateSummaryCard>
      ]}</DashboardColumns>

      {message ? <p className={styles.hint} role="status">{message}</p> : null}

      <ConfirmDialog
        open={stopOpen}
        title="友だち追加時の配信を止めますか？"
        description="停止後は、新しく友だち追加された人へこの案内が送られません。設定は残るため、あとで再開できます。"
        confirmLabel="止める"
        busy={stopBusy}
        error={stopError || undefined}
        onCancel={() => { if (!stopBusy) setStopOpen(false) }}
        onConfirm={() => stopDelivery()}
      />
    </DetailPage>
  )
}
