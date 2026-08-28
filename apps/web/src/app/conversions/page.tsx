'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { api, type ConversionPointImpact, type ConversionPointWithUsage } from '@/lib/api'
import type { ConversionPoint } from '@line-crm/shared'
import KpiCard from '@/components/dashboard/kpi-card'
import ListState from '@/components/shared/list-state'
import Dialog from '@/components/shared/dialog'
import { useAccount } from '@/contexts/account-context'

/**
 * 数え方を運用者の言葉にする。既定（manual）も省略せずに出す。
 *
 * 設計は「指定ページへの到達 / EC連携からの通知」と、何が起きたら数えるのかを
 * そのまま書いている。「URL到達」だと、誰がどのURLに来たときの話なのかが
 * 読み取れない。
 */
function measureLabel(method: ConversionPoint['measureMethod']): string {
  if (method === 'url_reach') return '指定ページへの到達'
  if (method === 'webhook') return 'EC連携からの通知'
  return '手動で記録'
}

/**
 * 種別を運用者の言葉にする。
 *
 * 設計は「購入」「申込・登録」の2つでまとめている。実装の eventType は9種
 * あるので、設計の2つに寄せられるものは寄せ、残りはそのまま出す。
 */
const EVENT_TYPE_LABELS: Record<string, string> = {
  purchase: '購入',
  form_submit: '申込・登録',
  friend_add: '申込・登録',
  visit: '来店・参加',
  // 作る画面が以前に送っていた値。過去に作った行がこれで残っている。
  signup: '申込・登録',
  reserve: '来店・参加',
  other: 'その他',
  scenario_step: 'シナリオ到達',
  rich_menu_tap: 'リッチメニュー',
  url_click: 'URLクリック',
  keyword_sent: 'キーワード',
  liff_view: 'LIFF閲覧',
  custom: 'その他',
}

import { Suspense } from 'react'
import MergedTabs, { useMergedTab } from '@/components/layout/merged-tabs'
import { AffiliatorsTab, OffersTab, ApprovalQueue } from '@/app/affiliates/tabs'
import { TableHeadRow, Th } from '@/components/shared/table'
import Button from '@/components/shared/button'

interface ConversionReportItem {
  conversionPointId: string
  conversionPointName: string
  eventType: string
  totalCount: number
  totalValue: number
}

/**
 * 設計 6-1 は1画面に5タブ。並びは設計のまま、素のURLでは主役の
 * 「成果地点（CV）」を開く。
 *
 * これまでは /conversions が2タブ、その中に入れていた /affiliates が
 * さらに3タブを持つ二重構造だった。同じ ?tab= が2つの意味を持つので、
 * 「案件を開くURL」を人に送れなかった。
 */
const MERGED_TABS = [
  { key: 'affiliates', label: 'アフィリエイター' },
  { key: 'offers', label: '案件' },
  { key: 'approvals', label: '成果承認' },
  { key: 'points', label: '成果地点（CV）' },
  { key: 'report', label: 'レポート' },
]

const DEFAULT_TAB = 'points'

function ConversionsPageInner() {
  const { selectedAccountId } = useAccount()
  const [points, setPoints] = useState<ConversionPointWithUsage[]>([])
  const [report, setReport] = useState<ConversionReportItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'active' | 'stopped' | 'unused'>('all')
  const [reload, setReload] = useState(0)
  const [stopTarget, setStopTarget] = useState<ConversionPointWithUsage | null>(null)
  const [stopImpact, setStopImpact] = useState<ConversionPointImpact | null>(null)
  const [impactLoading, setImpactLoading] = useState(false)
  const [stopBusy, setStopBusy] = useState(false)
  const [stopError, setStopError] = useState('')

  useEffect(() => {
    let cancelled = false
    setPoints([])
    setReport([])
    setLoadError('')
    if (!selectedAccountId) {
      setLoading(false)
      return () => { cancelled = true }
    }
    setLoading(true)
    const startDate = new Date(Date.now() - 30 * 24 * 3600_000).toISOString()
    void Promise.all([
      api.conversions.points({ lineAccountId: selectedAccountId }),
      api.conversions.report({ lineAccountId: selectedAccountId, startDate }),
    ]).then(([pointsRes, reportRes]) => {
      if (cancelled) return
      if (!pointsRes.success || !reportRes.success) throw new Error('成果地点を取得できませんでした')
      setPoints(pointsRes.data)
      setReport(reportRes.data)
    }).catch((error: unknown) => {
      if (!cancelled) setLoadError(error instanceof Error ? error.message : '成果地点を取得できませんでした')
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [selectedAccountId, reload])

  const openStopDialog = async (point: ConversionPointWithUsage) => {
    setStopTarget(point)
    setStopImpact(null)
    setStopError('')
    setImpactLoading(true)
    try {
      const response = await api.conversions.pointImpact(point.id)
      if (!response.success) throw new Error(response.error || '影響を確認できませんでした')
      setStopImpact(response.data)
    } catch (error) {
      setStopError(error instanceof Error ? error.message : '影響を確認できませんでした')
    } finally {
      setImpactLoading(false)
    }
  }

  const closeStopDialog = () => {
    if (stopBusy) return
    setStopTarget(null)
    setStopImpact(null)
    setStopError('')
  }

  const confirmStop = async () => {
    if (!stopTarget || !stopImpact) return
    setStopBusy(true)
    setStopError('')
    try {
      const response = await api.conversions.stopPoint(stopTarget.id)
      if (!response.success) throw new Error(response.error || '計測を停止できませんでした')
      setStopTarget(null)
      setStopImpact(null)
      setStopError('')
      setReload((value) => value + 1)
    } catch (error) {
      setStopError(error instanceof Error ? error.message : '計測を停止できませんでした')
    } finally {
      setStopBusy(false)
    }
  }

  // 成果地点ごとのCV数。レポートは成果地点IDで返る。
  const countByPoint = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of report) m.set(r.conversionPointId, r.totalCount)
    return m
  }, [report])

  const kpi = useMemo(() => ({
    active: points.filter((point) => point.status !== 'stopped').length,
    resultCount: report.reduce((sum, row) => sum + row.totalCount, 0),
    totalValue: report.reduce((sum, row) => sum + row.totalValue, 0),
    zeroCount: points.filter((point) => point.status !== 'stopped' && (countByPoint.get(point.id) ?? 0) === 0).length,
  }), [countByPoint, points, report])

  const filterCounts = useMemo(() => ({
    all: points.length,
    active: points.filter((point) => point.status !== 'stopped').length,
    stopped: points.filter((point) => point.status === 'stopped').length,
    unused: points.filter((point) => point.usedIn.length === 0).length,
  }), [points])

  const shown = useMemo(() => {
    const q = query.trim()
    return points.filter((point) => {
      if (q && !point.name.includes(q)) return false
      if (filter === 'active' && point.status === 'stopped') return false
      if (filter === 'stopped' && point.status !== 'stopped') return false
      if (filter === 'unused' && point.usedIn.length > 0) return false
      return true
    })
  }, [filter, points, query])

  return (
    <div data-conversions-design="v6" data-design-node="ZrpKn">
      <div data-design="KPIs" className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title="決めてある成果地点"
          value={points.length}
          unit="個"
          detail={`動いているもの ${kpi.active}個`}
          loading={loading}
        />
        <KpiCard
          title="この30日の成果"
          value={kpi.resultCount}
          unit="件"
          detail="成果地点をまたいだ合計"
          loading={loading}
        />
        <KpiCard
          title="金額がついた成果"
          value={kpi.totalValue}
          unit="円"
          detail="発生時点の金額を合計"
          loading={loading}
        />
        <KpiCard
          title="1件も起きていない"
          value={kpi.zeroCount}
          unit="個"
          detail="決めたのに成果が起きていません"
          badge={kpi.zeroCount > 0 ? '確認が必要' : undefined}
          badgeTone={kpi.zeroCount > 0 ? 'danger' : 'neutral'}
          loading={loading}
        />
      </div>

      <div
        data-design="Bar"
        className="bg-canvas rounded-card border-hairline mb-3 flex flex-wrap items-center gap-2 border p-3"
      >
        {([
          ['all', 'すべて'],
          ['active', '動いている'],
          ['stopped', '止めている'],
          ['unused', 'どこからも使われていない'],
        ] as const).map(([key, label]) => (
          <Button
            key={key}
            type="button"
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
            variant={filter === key ? 'primary' : 'secondary'}
          >
            {label} {filterCounts[key]}
          </Button>
        ))}
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="成果地点名で検索"
          aria-label="成果地点名で検索"
          className="border-hairline rounded-control focus:ring-accent ml-auto w-56 border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
        />
      </div>

      {!selectedAccountId ? (
        <ListState
          kind="empty"
          title="LINEアカウントを選んでください"
          description="上のバーで対象を選ぶと、そのアカウントの成果地点だけを表示します。"
        />
      ) : loading ? (
        <ListState kind="loading" title="成果地点を読み込んでいます" />
      ) : loadError ? (
        <ListState
          kind="error"
          title="成果地点を表示できませんでした"
          description={loadError}
          action={<Button onClick={() => setReload((value) => value + 1)} variant="secondary">もう一度読み込む</Button>}
        />
      ) : shown.length === 0 ? (
        <ListState
          kind="empty"
          title={query || filter !== 'all' ? '条件に合う成果地点はありません' : 'まだ成果地点がありません'}
          description={query || filter !== 'all' ? '検索や絞り込みを変えてください。' : '成果として数えたい行動を登録してください。'}
        />
      ) : (
        <div data-design="Table" className="bg-canvas rounded-card border-hairline border">
          <table className="w-full table-fixed">
            <thead>
              <TableHeadRow>
                <Th>成果地点名</Th>
                <Th>何を数えるか</Th>
                <Th align="right">この30日の成果</Th>
                <Th>使われている場所</Th>
                <Th>状態</Th>
                <Th align="right">操作</Th>
              </TableHeadRow>
            </thead>
            <tbody className="divide-hairline divide-y">
              {shown.map((point) => (
                <tr key={point.id} className="hover:bg-canvas-sunken">
                  <td className="text-ink px-4 py-3 text-sm font-medium">
                    <span className="block truncate" title={point.name}>{point.name}</span>
                    {point.targetUrl && (
                      <p className="text-ink-faint mt-0.5 truncate text-caption" title={point.targetUrl}>
                        {point.targetUrl}
                      </p>
                    )}
                  </td>
                  <td className="text-ink-secondary px-4 py-3 text-sm">
                    <p className="text-ink text-xs font-medium">{EVENT_TYPE_LABELS[point.eventType] ?? point.eventType}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <span className="bg-canvas-sunken text-ink-secondary rounded-pill px-2 py-0.5 text-caption whitespace-nowrap">
                        {measureLabel(point.measureMethod)}
                      </span>
                      {point.countRepeat === false && (
                        <span className="bg-canvas-sunken text-ink-secondary rounded-pill px-2 py-0.5 text-caption whitespace-nowrap">
                          一人一回
                        </span>
                      )}
                      {point.attributionDays != null && (
                        <span className="bg-canvas-sunken text-ink-secondary rounded-pill px-2 py-0.5 text-caption whitespace-nowrap tabular-nums">
                          {point.attributionDays}日
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="text-ink px-4 py-3 text-right text-sm tabular-nums">
                    <p className="font-semibold">{countByPoint.get(point.id) ?? 0}件</p>
                    <p className="text-ink-faint mt-0.5 text-caption">
                      {point.value !== null ? `1件 ¥${point.value.toLocaleString()}` : '金額なし'}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {point.usedIn.length === 0 ? (
                      <span className="text-warning text-xs">どこからも使われていません</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {point.usedIn.slice(0, 2).map((usage) => (
                          <Link
                            key={`${usage.kind}:${usage.consumerId}`}
                            href={usage.href}
                            className="bg-canvas-sunken text-ink-secondary rounded-pill max-w-full truncate px-2 py-0.5 text-caption"
                            title={`分析：${usage.consumerName}`}
                          >
                            分析：{usage.consumerName}
                          </Link>
                        ))}
                        {point.usedIn.length > 2 ? <span className="text-ink-faint text-caption">ほか{point.usedIn.length - 2}件</span> : null}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <span className={`rounded-pill px-2 py-0.5 text-caption ${
                      point.status === 'stopped'
                        ? 'bg-canvas-sunken text-ink-faint'
                        : 'bg-success-bg text-success'
                    }`}>
                      {point.status === 'stopped' ? '止めている' : '動いている'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {point.status === 'stopped' ? (
                      <span className="text-ink-faint text-xs">過去実績を保持</span>
                    ) : (
                      <Button
                        onClick={() => void openStopDialog(point)}
                        variant="secondary"
                      >
                        数えるのをやめる
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div data-design="tf" className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-ink-faint text-xs">
          成果地点は「何を1件として数えるか」の決めごとです。止めても過去の成果と金額は残ります。
        </p>
        <span className="text-ink-faint text-xs tabular-nums">全 {shown.length} 件</span>
      </div>

      <div data-design-node="d8d3Mz">
        <Dialog
          open={stopTarget !== null}
          title={stopTarget ? `「${stopTarget.name}」の計測を停止しますか？` : '成果地点の計測を停止しますか？'}
          description="新しい成果は数えなくなります。過去の成果・金額・分析結果は削除しません。"
          tone="destructive"
          busy={stopBusy}
          error={stopError || undefined}
          confirmLabel="数えるのをやめる"
          cancelLabel="一覧へ戻る"
          onCancel={closeStopDialog}
          onConfirm={stopImpact ? () => void confirmStop() : undefined}
        >
          {impactLoading ? (
            <ListState kind="loading" title="影響を確認しています" />
          ) : stopImpact ? (
            <div className="space-y-3 text-sm">
              <div className="bg-canvas-sunken rounded-control p-3">
                <p className="text-ink font-medium">そのまま残るもの</p>
                <p className="text-ink-secondary mt-1">
                  過去の成果 {stopImpact.eventCount.toLocaleString()}件・金額 ¥{stopImpact.totalValue.toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-ink font-medium">使われている場所</p>
                {stopImpact.usedIn.length === 0 ? (
                  <p className="text-ink-faint mt-1">どこからも使われていません。</p>
                ) : (
                  <ul className="text-ink-secondary mt-1 space-y-1">
                    {stopImpact.usedIn.map((usage) => (
                      <li key={`${usage.kind}:${usage.consumerId}`}>・分析「{usage.consumerName}」は、停止した成果地点として残ります</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : null}
        </Dialog>
      </div>
    </div>
  )
}

/**
 * レポートのタブ。
 *
 * 成果地点ごとの件数と金額をそのまま出す。一覧の表にもCV数はあるが、
 * あちらは「どう数えるか」を確かめる画面で、こちらは「いくらになったか」を
 * 見る画面なので、金額を主にしている。
 */
function ReportTab() {
  const { selectedAccountId } = useAccount()
  const [rows, setRows] = useState<ConversionReportItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setRows([])
    setError('')
    if (!selectedAccountId) {
      setLoading(false)
      return () => { cancelled = true }
    }
    setLoading(true)
    void api.conversions
      .report({ lineAccountId: selectedAccountId })
      .then((r) => {
        if (cancelled) return
        if (!r.success) throw new Error(r.error || 'レポートを取得できませんでした')
        setRows(r.data)
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'レポートを取得できませんでした')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedAccountId])

  const total = rows.reduce((s, r) => s + r.totalValue, 0)

  if (!selectedAccountId) {
    return <ListState kind="empty" title="LINEアカウントを選んでください" description="上のバーで対象を選ぶと、そのアカウントの成果だけを表示します。" />
  }

  if (loading) {
    return <ListState kind="loading" title="成果レポートを読み込んでいます" />
  }

  if (error) {
    return <ListState kind="error" title="成果レポートを表示できませんでした" description={error} />
  }

  if (rows.length === 0) {
    return <ListState kind="empty" title="まだ成果の記録がありません" description="成果地点を作って計測が始まると、ここに出ます。" />
  }

  return (
    <div data-design-node="GUxsj" className="bg-canvas rounded-card border-hairline overflow-x-auto border">
      <table className="w-full min-w-[560px]">
        <thead>
          <TableHeadRow>
            <Th>成果地点（CV）名</Th>
            <Th>種別</Th>
            <Th align="right">CV数</Th>
            <Th align="right">金額</Th>
          </TableHeadRow>
        </thead>
        <tbody className="divide-hairline divide-y">
          {rows.map((r) => (
            <tr key={r.conversionPointId} className="hover:bg-canvas-sunken">
              <td className="text-ink px-4 py-3 text-sm font-medium">{r.conversionPointName}</td>
              <td className="text-ink-secondary px-4 py-3 text-sm">
                {EVENT_TYPE_LABELS[r.eventType] ?? r.eventType}
              </td>
              <td className="text-ink px-4 py-3 text-right text-sm tabular-nums">{r.totalCount}</td>
              <td className="text-ink-secondary px-4 py-3 text-right text-sm tabular-nums">
                {r.totalValue > 0 ? `¥${r.totalValue.toLocaleString()}` : '—'}
              </td>
            </tr>
          ))}
          <tr className="bg-canvas-sunken">
            <td className="text-ink-secondary px-4 py-3 text-sm font-medium" colSpan={3}>
              合計
            </td>
            <td className="text-ink px-4 py-3 text-right text-sm font-semibold tabular-nums">
              ¥{total.toLocaleString()}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function ConversionsPageHost() {
  const tab = useMergedTab(MERGED_TABS, 'tab', DEFAULT_TAB)
  return (
    <div data-design-node={tab === 'report' ? 'GUxsj' : tab === 'points' ? 'ZrpKn' : undefined}>
      <div data-design="MergedTabs">
        <MergedTabs
          basePath="/conversions"
          paramName="tab"
          tabs={MERGED_TABS}
          active={tab}
          defaultKey={DEFAULT_TAB}
          actions={tab === 'points'
            ? <Button href="/conversions/new" variant="primary">成果地点を作る</Button>
            : undefined}
        />
      </div>
      {tab === 'points' && <ConversionsPageInner />}
      {tab === 'affiliates' && <AffiliatorsTab />}
      {tab === 'offers' && <OffersTab />}
      {tab === 'approvals' && <ApprovalQueue />}
      {tab === 'report' && <ReportTab />}
    </div>
  )
}

export default function ConversionsPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <ConversionsPageHost />
    </Suspense>
  )
}
