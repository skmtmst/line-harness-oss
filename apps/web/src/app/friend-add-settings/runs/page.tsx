'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  FriendAddEventAttributionStatus,
  FriendAddEventKind,
  FriendAddEventRoutingStatus,
} from '@line-crm/shared'
import { useAccount } from '@/contexts/account-context'
import { api, type FriendAddRunList } from '@/lib/api'
import { usePageTitle } from '@/components/shell/page-chrome'
import { csvCell } from './csv'
import { useCursorStack } from '../use-cursor-stack'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ListState from '@/components/shared/list-state'
import Select from '@/components/shared/select'
import StatusBadge, { type StatusBadgeTone } from '@/components/shared/status-badge'
import SummaryCard from '@/components/shared/summary-card'
import StickyBar from '@/components/shared/sticky-bar'

type KindFilter = 'all' | FriendAddEventKind
type AttributionFilter = 'all' | FriendAddEventAttributionStatus
type RoutingFilter = 'all' | FriendAddEventRoutingStatus

const ROUTING_LABELS: Record<FriendAddEventRoutingStatus, { label: string; tone: StatusBadgeTone }> = {
  pending: { label: 'テスト待ち', tone: 'info' },
  completed: { label: '成功', tone: 'success' },
  failed: { label: 'エラー', tone: 'danger' },
  suppressed: { label: '配信なし', tone: 'neutral' },
  partial_failed: { label: '再送待ち', tone: 'warning' },
}

const ROUTING_ACTIONS: Record<FriendAddEventRoutingStatus, string> = {
  pending: '配信・処理を確認中',
  completed: '初回案内を実行',
  failed: '配信・処理に失敗',
  suppressed: '配信・処理なし',
  partial_failed: '送れず再送待ち',
}

/** 将来の状態が来ても描画を落とさない受け皿。 */
const UNKNOWN_ROUTING_LABEL = { label: '不明', tone: 'neutral' } as const
const UNKNOWN_ROUTING_ACTION = '状態を確認中'

/*
 * 送達不明。送信は試したが、届いたかどうか分からない実行。
 * **自動では送り直さない**（送り直すと二重に届く）。「再送待ち」と同じ
 * 見た目にすると、放っておけばそのうち届くと読めてしまう。分けて出す。
 */
const DELIVERY_UNKNOWN_CODE = 'delivery_unknown'
const DELIVERY_UNKNOWN_LABEL = { label: '送達不明', tone: 'danger' } as const
const DELIVERY_UNKNOWN_ACTION = '送達不明・要確認（自動では送り直しません）'

function routingLabel(
  status: FriendAddEventRoutingStatus,
  errorCode: string | null,
): { label: string; tone: StatusBadgeTone } {
  if (errorCode === DELIVERY_UNKNOWN_CODE) return DELIVERY_UNKNOWN_LABEL
  return ROUTING_LABELS[status] ?? UNKNOWN_ROUTING_LABEL
}

function routingAction(status: FriendAddEventRoutingStatus, errorCode: string | null): string {
  if (errorCode === DELIVERY_UNKNOWN_CODE) return DELIVERY_UNKNOWN_ACTION
  return ROUTING_ACTIONS[status] ?? UNKNOWN_ROUTING_ACTION
}

/** DBにはJSTの時刻をオフセットなしで保存した古い行がある。UTCへ読み替えず、そのままJSTとして表示する。 */
function formatJstDateTime(value: string | null): string {
  if (!value) return '—'
  const bare = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/)
  if (bare && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)) {
    return `${bare[1]}/${bare[2]}/${bare[3]} ${bare[4]}:${bare[5]}`
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(parsed)
}

function formatJstTime(value: string | null): string {
  const dateTime = formatJstDateTime(value)
  return dateTime === '—' ? dateTime : dateTime.slice(-5)
}

const RULE_STATUS_LABELS: Record<string, string> = {
  published: '稼働中',
  stopped: '停止中',
  draft: '下書き',
  archived: 'アーカイブ',
}

export default function FriendAddRunsPage() {
  usePageTitle('新規友だち初回案内・実行結果')
  const { selectedAccountId, accounts, loading: accountLoading } = useAccount()
  const [kind, setKind] = useState<KindFilter>('all')
  const [attribution, setAttribution] = useState<AttributionFilter>('all')
  const [routing, setRouting] = useState<RoutingFilter>('all')
  const { cursor, page: cursorPage, canPrev, reset: resetCursor, goPrev, goNext } = useCursorStack()
  const [data, setData] = useState<FriendAddRunList | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
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
    try {
      // 種類・経路の絞り込みはサーバ側へ送る。取得済み20件への表示絞りでは
      // 2ページ目以降が漏れる。
      const response = await api.friendAddRules.runs(selectedAccountId, {
        limit: 20,
        cursor: cursor ?? undefined,
        status: routing === 'all' ? undefined : routing,
        kind: kind === 'all' ? undefined : kind,
        attribution: attribution === 'all' ? undefined : attribution,
      })
      if (requestId !== requestSequence.current) return
      if (!response.success) {
        setData(null)
        setError('実行結果を表示できませんでした。通信を確認して、もう一度お試しください。')
        return
      }
      setData(response.data)
    } catch {
      if (requestId !== requestSequence.current) return
      setData(null)
      setError('実行結果を表示できませんでした。通信を確認して、もう一度お試しください。')
    } finally {
      if (requestId === requestSequence.current) setLoading(false)
    }
  }, [attribution, cursor, kind, routing, selectedAccountId])

  useEffect(() => {
    if (!accountLoading) void load()
  }, [accountLoading, load])

  // アカウントを変えたら古いカーソルで読まないよう巻き戻す。
  useEffect(() => {
    resetCursor()
  }, [selectedAccountId, resetCursor])

  /*
   * 絞りの変更はカーソルの巻き戻しと同時に1回だけ読み直す。巻き戻しと取得を
   * 別の effect に分けると、絞り変更のたびに無駄な再取得が起きる。
   */
  const applyFilter = (patch: { kind?: KindFilter; attribution?: AttributionFilter; routing?: RoutingFilter }) => {
    if (patch.kind !== undefined) setKind(patch.kind)
    if (patch.attribution !== undefined) setAttribution(patch.attribution)
    if (patch.routing !== undefined) setRouting(patch.routing)
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
  const latestProcessedAt = data?.items.find((item) => item.processedAt)?.processedAt ?? null
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

  const exportCsv = () => {
    if (!data?.items.length) return
    const header = ['受信日時', '友だち', '追加の種類', '確定した流入経路', '配信・処理', '処理日時']
    const rows = data.items.map((item) => {
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
  }

  return (
    <div data-design-node="P2J0Te" className="space-y-4 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link className="text-sm font-bold text-accent hover:underline" href="/friend-add-settings">← 友だち追加時の配信</Link>
        <div className="flex gap-2">
          <details className="relative">
            <summary className="cursor-pointer list-none rounded-control border border-hairline bg-canvas px-3 py-2 text-sm font-bold">絞り込み</summary>
            <div className="absolute right-0 z-20 mt-2 flex w-screen max-w-3xl flex-wrap items-end gap-3 rounded-card border border-hairline bg-canvas p-4 shadow-panel">
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
              <Button onClick={() => void load()} disabled={loading}>一覧を更新</Button>
            </div>
          </details>
          <Button onClick={exportCsv} disabled={!data?.items.length}>実行結果をCSVで書き出す</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <SummaryCard variant="v6" title="直近28日の追加" value={summary?.totalRuns ?? null} unit="人" detail="友だち追加の合計" loading={loading} />
        <SummaryCard variant="v6" title="累計配信" value={summary?.cumulativeDeliveries ?? null} unit="通" detail="実際に送った通数" loading={loading} />
        <SummaryCard variant="v6" title="シナリオ開始" value={summary?.scenarioStarts ?? null} unit="件" detail="登録できた件数" loading={loading} />
        <SummaryCard variant="v6" title="エラー" value={summary?.failed ?? null} unit="件" detail="処理できなかった記録" loading={loading} badge={summary && summary.failed > 0 ? '要確認' : undefined} badgeTone="danger" />
      </div>

      <div className="flex flex-col items-start gap-4 xl:flex-row">
        <main className="min-w-0 flex-1">
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
          kind="error"
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
              <p className="mt-1 text-xs text-ink-faint">何をきっかけに、何が実行されたかを確認できます。絞り込みはすべての記録に効きます。CSVの書き出しもこのページに表示中の記録だけです。</p>
            </div>
            <div className="divide-y divide-hairline px-4">
              {visibleItems.map((item) => {
                const status = routingLabel(item.status, item.errorCode)
                const routeName = item.attribution.status === 'captured'
                  ? item.attribution.routeName || item.attribution.reason || '選択した経路'
                  : '経路は取得できません'
                const displayName = item.friend.displayName || '名前は未取得'
                const action = item.scenario?.started
                  ? `シナリオ「${item.scenario.name ?? '名前は未取得'}」を開始`
                  : item.deliveryCount > 0
                    ? `初回案内を${item.deliveryCount}通送信`
                    : item.actions.total > 0
                      ? `${item.actions.total}件の処理を実行`
                      : routingAction(item.status, item.errorCode)
                return (
                  <div key={item.id} className="flex min-w-0 items-center gap-3 py-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-status-success-soft text-xs font-bold text-status-success-deep" aria-hidden="true">
                      {displayName.slice(0, 1)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <Link className="block truncate text-sm font-bold hover:underline" href={`/friends/detail?id=${encodeURIComponent(item.friend.id)}`} title={displayName}>{displayName}</Link>
                      <p className="truncate text-xs text-ink-faint" title={`流入：${routeName}`}>流入：{routeName}</p>
                      {item.rule && <p className="truncate text-xs text-ink-faint" title={`${item.rule.name ?? '名前は未取得'} 第${item.rule.versionNumber ?? '—'}版`}>{item.rule.name ?? '名前は未取得'}・第{item.rule.versionNumber ?? '—'}版</p>}
                    </div>
                    <div className="hidden min-w-0 flex-1 text-right text-sm font-bold lg:block">{action}</div>
                    <StatusBadge tone={status.tone} size="compact">{status.label}</StatusBadge>
                    <time className="w-12 shrink-0 text-right text-xs text-ink-secondary" dateTime={item.receivedAt} title={formatJstDateTime(item.receivedAt)}>{formatJstTime(item.receivedAt)}</time>
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

          {(canPrev || Boolean(data.nextCursor)) && <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-ink-faint">{cursorPage}ページ目・このページは{data.items.length}件</p>
            <div className="flex gap-2">
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
          </div>}
        </div>
      )}
        </main>

        <aside className="grid w-full shrink-0 gap-4 xl:w-96">
          <section className="rounded-card border border-hairline bg-canvas p-4">
            <h2 className="font-bold">稼働状況</h2>
            <p className="mt-1 text-xs text-ink-faint">現在取得できる初回案内の状態です。</p>
            <dl className="mt-4 divide-y divide-hairline text-sm">
              <div className="flex justify-between gap-3 py-3"><dt>状態</dt><dd className="font-bold">{ruleStatusLabel}</dd></div>
              <div className="flex justify-between gap-3 py-3"><dt>二重送信防止</dt><dd className="font-bold">{suppressionLabel}</dd></div>
              <div className="flex justify-between gap-3 py-3"><dt>最終配信</dt><dd className="font-bold">{formatJstTime(latestProcessedAt)}</dd></div>
              <div className="flex justify-between gap-3 py-3"><dt>平均送信</dt><dd className="font-bold">{summary?.averageSendTimeMs === null || summary?.averageSendTimeMs === undefined ? '未取得' : `${(summary.averageSendTimeMs / 1000).toFixed(1)}秒`}</dd></div>
            </dl>
          </section>
          <section className="rounded-card border border-hairline bg-canvas p-4">
            <h2 className="font-bold">要テスト</h2>
            <p className="mt-1 text-xs text-ink-faint">未処理の問題だけ表示します。</p>
            <div className="mt-4 rounded-control bg-status-danger-soft p-3 text-sm text-status-danger-deep">
              <strong>未送信 {summary?.failed ?? '—'}件</strong>
              <p className="mt-1 text-xs">失敗した記録は使用ルール・版・処理結果と一緒に一覧で確認できます。</p>
            </div>
            {(() => {
              const href = editHref('preview')
              return href
                ? <Button className="mt-3 w-full" href={href}>友だち追加時配信をテスト</Button>
                : <Button className="mt-3 w-full" disabled title="実行結果がまだありません">友だち追加時配信をテスト</Button>
            })()}
          </section>
          <section className="rounded-card border border-hairline bg-canvas p-4">
            <h2 className="font-bold">担当者シナリオ開始</h2>
            <p className="mt-1 text-xs text-ink-faint">{summary?.staffHandoffs.reason ?? '担当者への引き継ぎ結果を集計します。'}</p>
            <dl className="mt-4 divide-y divide-hairline text-sm">
              <div className="flex justify-between gap-3 py-3"><dt>実行結果</dt><dd className="font-bold">{summary?.staffHandoffs.value ?? '未取得'}</dd></div>
            </dl>
          </section>
        </aside>
      </div>

      <StickyBar status={stopMessage || undefined} actions={<><Button disabled={!activeRuleId || stopBusy} onClick={() => setStopDialogOpen(true)}>{stopBusy ? '停止中…' : '配信を一時停止'}</Button>{(() => {
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
