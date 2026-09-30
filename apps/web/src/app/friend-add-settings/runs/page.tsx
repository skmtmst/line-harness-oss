'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  FriendAddEventAttributionStatus,
  FriendAddEventKind,
  FriendAddEventRoutingStatus,
} from '@line-crm/shared'
import { useAccount } from '@/contexts/account-context'
import { api, type FriendAddRunList } from '@/lib/api'
import { describeFriendAddFailure } from '../friend-add-failure'
import { usePageTitle } from '@/components/shell/page-chrome'
import { csvCell } from './csv'
import { formatJstDateTime, routingAction, routingLabel } from './run-status'
import { useCursorStack } from '../use-cursor-stack'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ListState from '@/components/shared/list-state'
import MenuPortal from '@/components/shared/menu-portal'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import StatusBadge from '@/components/shared/status-badge'
import KpiCard from '@/components/shared/kpi-card'
import StickyBar from '@/components/shared/sticky-bar'
import ListRange from '@/components/ui/list-range'
import { formatNumber } from '@/lib/format'

type KindFilter = 'all' | FriendAddEventKind
type AttributionFilter = 'all' | FriendAddEventAttributionStatus
type RoutingFilter = 'all' | FriendAddEventRoutingStatus

const RUN_STATUSES_PARAM = new Set<FriendAddEventRoutingStatus>([
  'pending', 'completed', 'failed', 'suppressed', 'partial_failed',
])

const RULE_STATUS_LABELS: Record<string, string> = {
  published: '稼働中',
  stopped: '停止中',
  draft: '下書き',
  archived: 'アーカイブ',
}

/** CSV書き出しの安全弁。100件×50頁=5,000件で止め、切れたら画面に断る。 */
const CSV_EXPORT_MAX_PAGES = 50
const CSV_EXPORT_PAGE_SIZE = 100

function FriendAddRunsInner() {
  usePageTitle('新規友だち初回案内・実行結果')
  const { selectedAccountId, accounts, loading: accountLoading } = useAccount()
  const searchParams = useSearchParams()
  const router = useRouter()
  // 一覧の「この設定の実行結果」から来たとき、その設定の記録だけを見せる。
  const ruleIdFilter = searchParams.get('rule_id')
  /*
   * 絞り込みとページ位置は URL が持つ（R268）。詳細から戻ったときに
   * 同じ条件・同じページへ戻れるよう、URLの値をそのまま使う。
   */
  const kindParam = searchParams.get('kind')
  const kind: KindFilter = kindParam === 'first_time' || kindParam === 'returning' ? kindParam : 'all'
  const attributionParam = searchParams.get('attribution')
  const attribution: AttributionFilter = attributionParam === 'captured' || attributionParam === 'unavailable' ? attributionParam : 'all'
  const routingParam = searchParams.get('status')
  const routing: RoutingFilter = routingParam && RUN_STATUSES_PARAM.has(routingParam as FriendAddEventRoutingStatus) ? routingParam as RoutingFilter : 'all'
  /*
   * ページ位置はURLの `pages` が持つ。カーソルの束を丸ごと入れるので、
   * 詳細から3ページ目へ戻っても表示中の記録とページ番号が一致し、
   * 「前へ」も正しくたどれる（R268）。
   */
  const pagesParam = searchParams.get('pages')
  const { stack: cursorStack, cursor, page: cursorPage, canPrev, reset: resetCursor, goPrev, goNext } =
    useCursorStack(pagesParam ? [null, ...pagesParam.split(',').filter(Boolean)] : undefined)
  const [data, setData] = useState<FriendAddRunList | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // M009: 403 は共通部品の forbidden で出す。HTTP の状態をそのまま渡す。
  const [errorStatus, setErrorStatus] = useState<number | null>(null)
  const [csvBusy, setCsvBusy] = useState(false)
  const [csvNote, setCsvNote] = useState('')
  const [filterOpen, setFilterOpen] = useState(false)
  const filterAnchorRef = useRef<HTMLSpanElement>(null)
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
      // 種類・経路の絞り込みはサーバ側へ送る。取得済み20件への表示絞りでは
      // 2ページ目以降が漏れる。
      const response = await api.friendAddRules.runs(selectedAccountId, {
        limit: 20,
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
      // M009: 403 は権限、404 は選び直し。「通信を確認」は通信断だけ。
      const failure = describeFriendAddFailure(caught, '実行結果', 'load')
      setData(null)
      setError(failure.message)
      setErrorStatus(failure.status)
    } finally {
      if (requestId === requestSequence.current) setLoading(false)
    }
  }, [attribution, cursor, kind, routing, ruleIdFilter, selectedAccountId])

  useEffect(() => {
    if (!accountLoading) void load()
  }, [accountLoading, load])

  /*
   * アカウントや設定の絞りを変えたら古いカーソルで読まないよう巻き戻す。
   * 初回（URLのカーソルで復元した直後）は巻き戻さない。ここで消すと
   * 詳細からの戻りが先頭ページへ飛んでしまう（R268）。
   */
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

  /*
   * 今のページ位置（カーソルの束）をURLへ写す。詳細へのリンクがこのURLを
   * 引き継ぐので、戻ると同じページ・同じ絞り込みへ戻れる（R268）。
   */
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString())
    const trail = cursorStack.slice(1).join(',')
    if (trail) params.set('pages', trail)
    else params.delete('pages')
    const next = params.toString()
    if (next !== searchParams.toString()) router.replace(`?${next}`, { scroll: false })
  }, [cursorStack, searchParams, router])

  /*
   * 絞りの変更はカーソルの巻き戻しと同時に1回だけ読み直す。巻き戻しと取得を
   * 別の effect に分けると、絞り変更のたびに無駄な再取得が起きる。
   */
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

  const summary = data?.summary ?? null
  const selectedAccountExists = selectedAccountId && accounts.some((account) => account.id === selectedAccountId)
  const routeBreakdown = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of data?.items ?? []) {
      const route = item.attribution.status === 'captured'
        ? item.attribution.routeName || item.attribution.reason || '選択した経路'
        : '経路は取得できません'
      counts.set(route, (counts.get(route) ?? 0) + 1)
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])
  }, [data])
  // 絞り込みはサーバ側で済んでいるため、ここでは表示絞りをしない。
  const visibleItems = useMemo(() => data?.items ?? [], [data])
  const activeRuleId = data?.items.find((item) => item.rule)?.rule?.id ?? null

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
      setStopMessage(response.success ? '配信を一時停止しました。' : '配信を停止できませんでした。')
      if (response.success) {
        setStopDialogOpen(false)
        // 停止後の状態を読み直す。読み直さないと停止中も稼働中に見える。
        await load()
        await loadRuleState()
      }
    } catch {
      setStopMessage('配信を停止できませんでした。状態を読み直してください。')
    } finally {
      setStopBusy(false)
    }
  }

  const ruleStatusLabel = ruleState ? RULE_STATUS_LABELS[ruleState.status] ?? ruleState.status : '—'
  const suppressionLabel = !ruleState || ruleState.resendSuppressionHours === null
    ? '—'
    : ruleState.resendSuppressionHours > 0 ? '有効' : '無効'
  const editHref = (step: 'basic' | 'preview') => activeRuleId
    ? `/friend-add-settings?view=edit&id=${encodeURIComponent(activeRuleId)}&step=${step}`
    : null

  /*
   * 詳細へのリンクは今の絞り込み・ページ位置を引き継ぐ。詳細側の
   * 「実行結果へ戻る」がそのまま返すので、絞り込みが解除されない（R268）。
   */
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

  /*
   * CSVは表示中の20件ではなく、今の絞り込み（種類・経路・結果・設定）に
   * 合う記録を新しい順にすべて書き出す。カーソルを辿って全頁を読み、
   * 安全弁（5,000件）で切れたときは画面に断る(#946 N-111)。
   */
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
          setCsvNote('書き出す記録を取得できませんでした。通信を確認して、もう一度お試しください。')
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
          : '経路は取得できません'
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
      setCsvNote('書き出す記録を取得できませんでした。通信を確認して、もう一度お試しください。')
    } finally {
      setCsvBusy(false)
    }
  }

  return (
    <div data-design-node="P2J0Te" className="space-y-4 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link className="text-sm font-bold text-action hover:underline" href="/friend-add-settings">← 友だち追加時の配信</Link>
        <div className="flex gap-2">
          <span ref={filterAnchorRef} className="relative inline-flex">
            <Button
              aria-expanded={filterOpen}
              onClick={() => setFilterOpen((current) => !current)}
            >
              絞り込み
            </Button>
            <MenuPortal
              open={filterOpen}
              align="end"
              getAnchor={() => filterAnchorRef.current}
              onClose={() => setFilterOpen(false)}
            >
            <div
              className="flex max-w-3xl flex-wrap items-end gap-3 rounded-card border border-hairline bg-canvas p-4 shadow-panel"
              // 最上層では absolute 指定を無効にする（位置は器が決める）。
              // 幅の上限は style へ（任意値記法の直書きにしない）。
              style={{ position: 'static', width: 'min(48rem, calc(100vw - 16px))' }}
            >
              <Select
                aria-label="追加の種類"
                label="追加の種類"
                value={kind}
                onChange={(value) => applyFilter({ kind: value as KindFilter })}
                options={[
                  { value: 'all', label: 'すべての追加' },
                  { value: 'first_time', label: 'はじめて' },
                  { value: 'returning', label: '再追加・ブロック解除' },
                ]}
              />
              <Select
                aria-label="流入経路"
                label="流入経路"
                value={attribution}
                onChange={(value) => applyFilter({ attribution: value as AttributionFilter })}
                options={[
                  { value: 'all', label: 'すべての経路' },
                  { value: 'captured', label: '経路を取得できた' },
                  { value: 'unavailable', label: '経路を取得できない' },
                ]}
              />
              <Select
                aria-label="配信・処理"
                label="配信・処理"
                value={routing}
                onChange={(value) => applyFilter({ routing: value as RoutingFilter })}
                options={[
                  { value: 'all', label: 'すべての結果' },
                  { value: 'completed', label: '成功' },
                  { value: 'pending', label: 'テスト待ち' },
                  { value: 'failed', label: 'エラー' },
                  { value: 'suppressed', label: '配信なし' },
                  { value: 'partial_failed', label: '再送待ち' },
                ]}
              />
              <Button onClick={() => void load()} disabled={loading}>一覧を更新する</Button>
            </div>
            </MenuPortal>
          </span>
          <Button onClick={() => void exportCsv()} disabled={!data?.items.length || csvBusy} busy={csvBusy} busyLabel="書き出し中…">実行結果をCSVで書き出す</Button>
        </div>
      </div>

      {ruleIdFilter ? (
        <p className="rounded-control border border-hairline bg-canvas-sunken px-3 py-2 text-xs text-ink-secondary">
          この設定の実行結果だけを表示しています。
          <Link href="/friend-add-settings/runs" className="ml-2 font-bold text-action hover:underline">すべての記録へ戻る</Link>
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard
          variant="v6"
          title="直近28日の追加"
          value={summary?.recentFriends ?? null}
          unit="人"
          detail={summary ? `追加記録 ${summary.recentEvents}件` : ''}
          help="直近28日に追加された人数です。同じ人の再追加は1人として数え、追加の回数は「追加記録」の件数で確認できます。"
          loading={loading}
        />
        <KpiCard variant="v6" title="累計配信" value={summary?.cumulativeDeliveries ?? null} unit="通" detail="" help="実際に送った通数です" loading={loading} />
        <KpiCard variant="v6" title="シナリオ開始" value={summary?.scenarioStarts ?? null} unit="件" detail="" help="登録できた件数です" loading={loading} />
        <KpiCard variant="v6" title="エラー" value={summary?.failed ?? null} unit="件" detail="処理できなかった記録" loading={loading} badge={summary && summary.failed > 0 ? '要確認' : undefined} badgeTone="danger" />
      </div>
      {kind !== 'all' || attribution !== 'all' || routing !== 'all' || ruleIdFilter ? (
        <p className="mt-2 text-xs text-ink-faint">上の集計は、今の絞り込みに合う記録だけを対象にしています。</p>
      ) : null}

      <div className="flex flex-col items-start gap-4 xl:flex-row">
        <div className="min-w-0 flex-1">
      {accountLoading || loading ? (
        <ListState kind="loading" title="実行結果を読み込んでいます" />
      ) : !selectedAccountExists ? (
        <ListState
          kind="empty"
          title={accounts.length > 0 ? 'LINE公式アカウントを選んでください' : 'LINE公式アカウントが登録されていません'}
          description={accounts.length > 0 ? '上のバーで、確認するアカウントを選んでください。' : 'アカウントを登録すると実行結果を確認できます。'}
        />
      ) : error ? (
        <ListState
          kind={errorStatus === 403 ? 'forbidden' : 'error'}
          title="実行結果を表示できませんでした"
          description={error}
          action={<Button onClick={() => void load()}>もう一度読み込む</Button>}
        />
      ) : !data || visibleItems.length === 0 ? (
        <ListState
          kind="empty"
          title="条件に合う実行結果はありません"
          description="絞り込みを変えるか、次の友だち追加を待ってください。"
        />
      ) : (
        <div className="space-y-4">
          <section className="overflow-hidden rounded-card border border-hairline bg-canvas">
            <div className="border-b border-hairline px-4 py-3">
              <h2 className="font-bold">最近の友だち追加</h2>
              <p className="mt-1 text-xs text-ink-faint">何をきっかけに、何が実行されたかを確認できます。絞り込みはすべての記録に効き、CSVは絞り込みに合う記録を新しい順にすべて書き出します（上限{formatNumber((CSV_EXPORT_MAX_PAGES * CSV_EXPORT_PAGE_SIZE))}件）。</p>
              {csvNote ? <p className="mt-1 text-xs text-ink-faint">{csvNote}</p> : null}
            </div>
            <div className="divide-y divide-hairline px-4">
              {visibleItems.map((item) => {
                const status = routingLabel(item.status, item.errorCode)
                const routeName = item.attribution.status === 'captured'
                  ? item.attribution.routeName || item.attribution.reason || '選択した経路'
                  : '経路は取得できません'
                const displayName = item.friend.displayName || '名前は未取得'
                /*
                  m22d: 失敗した実行の行に「○件の処理を実行」と出すと、
                  成功したように読める。失敗は理由の文にし、同じ「1件」が
                  3回出るのもやめる（内訳の2行と合わせても2回まで）。
                */
                const action = item.status === 'failed'
                  ? routingAction(item.status, item.errorCode)
                  : item.scenario?.started
                    ? `シナリオ「${item.scenario.name ?? '名前は未取得'}」を開始`
                    : item.deliveryCount > 0
                      ? `初回案内を${item.deliveryCount}通送信`
                      : item.actions.total > 0
                        ? `${item.actions.total}件の処理を実行`
                        : routingAction(item.status, item.errorCode)
                return (
                  // #973 U045: 1行目は名前と結果、2行目は時刻と詳細。1行に
                  // すべて並べると狭い幅で右端が切れる。
                  <div key={item.id} className="min-w-0 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid size-9 shrink-0 place-items-center rounded-pill bg-status-success-soft text-xs font-medium text-status-success-deep" aria-hidden="true">
                        {displayName.slice(0, 1)}
                      </span>
                      <div className="min-w-0 flex-1">
                        {item.friend.redacted ? (
                          <span className="block truncate text-sm font-bold" title={displayName}>{displayName}</span>
                        ) : (
                          <Link className="block truncate text-sm font-bold hover:underline" href={`/friends/detail?id=${encodeURIComponent(item.friend.id)}`} title={displayName}>{displayName}</Link>
                        )}
                        <p className="truncate text-xs text-ink-faint" title={`流入：${routeName}`}>流入：{routeName}</p>
                        {item.rule && <p className="truncate text-xs text-ink-faint" title={`${item.rule.name ?? '名前は未取得'} 第${item.rule.versionNumber ?? '—'}版`}>{item.rule.name ?? '名前は未取得'}・第{item.rule.versionNumber ?? '—'}版</p>}
                      </div>
                      <div className="hidden min-w-0 flex-1 text-right text-sm font-bold lg:block">{action}</div>
                      <StatusBadge tone={status.tone} size="compact">{status.label}</StatusBadge>
                    </div>
                    <div className="mt-1.5 flex items-center justify-between gap-3 pl-12">
                      <time className="min-w-0 text-xs text-ink-secondary" dateTime={item.receivedAt}>{formatJstDateTime(item.receivedAt)}</time>
                      <Link
                        className="shrink-0 text-xs font-medium text-action hover:underline"
                        href={detailHref(item.id)}
                      >
                        詳細
                      </Link>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          <section className="rounded-card border border-hairline bg-canvas p-4">
            <h2 className="font-bold">流入経路別の内訳</h2>
            <p className="mt-1 text-xs text-ink-faint">このページに表示中の記録を、流入経路ごとに確認できます。</p>
            <div className="mt-3 divide-y divide-hairline">
              {routeBreakdown.map(([route, count]) => (
                <div key={route} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <strong className="truncate" title={route}>{route}</strong>
                  <span className="whitespace-nowrap text-ink-secondary">{count}件・{Math.round((count / data.items.length) * 1000) / 10}%</span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-ink-faint">通常URLや公式QRから追加された記録は0件にせず「経路は取得できません」と表示します。</p>
          </section>

          <div className="flex items-center justify-between gap-3">
            <ListRange total={data.total} first={data.total === 0 ? 0 : (cursorPage - 1) * 20 + 1} last={(cursorPage - 1) * 20 + data.items.length} />
            {(canPrev || Boolean(data.nextCursor)) && (
              <div className="flex gap-2" aria-label="実行結果のページ送り">
                <Button
                  onClick={() => goPrev()}
                  disabled={!canPrev || loading}
                >
                  前へ
                </Button>
                <Button
                  onClick={() => goNext(data.nextCursor)}
                  disabled={!data.nextCursor || loading}
                >
                  次へ
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
        </div>

        <aside className="grid w-full shrink-0 gap-4 xl:w-96">
          <section className="rounded-card border border-hairline bg-canvas p-4">
            <h2 className="font-bold">稼働状況</h2>
            <p className="mt-1 text-xs text-ink-faint">現在取得できる初回案内の状態です。</p>
            <dl className="mt-4 divide-y divide-hairline text-sm">
              <div className="flex justify-between gap-3 py-3"><dt>状態</dt><dd className="font-medium">{ruleStatusLabel}</dd></div>
              <div className="flex justify-between gap-3 py-3"><dt>二重送信防止</dt><dd className="font-medium">{suppressionLabel}</dd></div>
              <div className="flex justify-between gap-3 py-3"><dt>最終配信</dt><dd className="font-medium">{summary === null ? '—' : summary.lastDeliveryAt ? formatJstDateTime(summary.lastDeliveryAt) : 'まだありません'}</dd></div>
              <div className="flex justify-between gap-3 py-3"><dt>平均送信</dt><dd className="font-medium">{summary?.averageSendTimeMs === null || summary?.averageSendTimeMs === undefined ? '未取得' : `${(summary.averageSendTimeMs / 1000).toFixed(1)}秒`}</dd></div>
            </dl>
          </section>
          <section className="rounded-card border border-hairline bg-canvas p-4">
            <h2 className="font-bold">要テスト</h2>
            <p className="mt-1 text-xs text-ink-faint">未処理の問題だけ表示します。</p>
            <Notice tone="danger" className="mt-4">
              <strong>未送信 {summary?.failed ?? '—'}件</strong>
              <p className="mt-1 text-xs">失敗した記録は使用ルール・版・処理結果と一緒に一覧で確認できます。</p>
            </Notice>
            {(() => {
              const href = editHref('preview')
              return href
                ? <Button className="mt-3 w-full" href={href}>友だち追加時配信をテストする</Button>
                : <Button className="mt-3 w-full" disabled title="実行結果がまだありません">友だち追加時配信をテストする</Button>
            })()}
          </section>
          <section className="rounded-card border border-hairline bg-canvas p-4">
            <h2 className="font-bold">担当者シナリオ開始</h2>
            <p className="mt-1 text-xs text-ink-faint">{summary?.staffHandoffs.reason ?? '担当者への引き継ぎ結果を集計します。'}</p>
            <dl className="mt-4 divide-y divide-hairline text-sm">
              <div className="flex justify-between gap-3 py-3"><dt>実行結果</dt><dd className="font-medium">{summary?.staffHandoffs.value ?? '未取得'}</dd></div>
            </dl>
          </section>
        </aside>
      </div>

      <StickyBar status={stopMessage || undefined} actions={<><Button disabled={!activeRuleId || stopBusy} onClick={() => setStopDialogOpen(true)} busy={stopBusy} busyLabel="停止中…">配信を一時停止</Button>{(() => {
        const href = editHref('basic')
        return href
          ? <Button href={href} variant="primary">友だち追加時の設定を編集</Button>
          : <Button disabled title="実行結果がまだありません" variant="primary">友だち追加時の設定を編集</Button>
      })()}</>} />
      <ConfirmDialog
        open={stopDialogOpen}
        title="友だち追加時の配信を一時停止しますか？"
        description="停止後は、新しく友だち追加された人へこの案内が送られません。設定は残るため、あとで再開できます。"
        confirmLabel="一時停止する"
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

export default function FriendAddRunsPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <FriendAddRunsInner />
    </Suspense>
  )
}
