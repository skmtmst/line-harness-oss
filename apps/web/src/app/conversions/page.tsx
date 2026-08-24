'use client'

import { useState, useEffect, useMemo } from 'react'
import { api, type ConversionApprovalItem } from '@/lib/api'
import type { ConversionPoint } from '@line-crm/shared'
import KpiCard from '@/components/dashboard/kpi-card'

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

/** 過去28日ぶんに絞る。設計のKPIはどれも「過去28日」で数えている。 */
function within28Days(iso: string): boolean {
  return Date.now() - new Date(iso).getTime() <= 28 * 24 * 3600_000
}
import Header from '@/components/layout/header'
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
  const [points, setPoints] = useState<ConversionPoint[]>([])
  const [report, setReport] = useState<ConversionReportItem[]>([])
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState<ConversionApprovalItem[]>([])
  const [approved, setApproved] = useState<ConversionApprovalItem[]>([])
  const [openOffers, setOpenOffers] = useState(0)
  const [query, setQuery] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      // 上のKPIは成果地点だけでは出ない。承認の待ち・確定と、公開中の案件を
      // 一緒に引く。1つ落ちても他は出せるよう allSettled。
      const [pointsRes, reportRes, pendingRes, approvedRes, offersRes] = await Promise.allSettled([
        api.conversions.points(),
        api.conversions.report(),
        api.conversionApprovals.list({ status: 'pending', limit: 200 }),
        api.conversionApprovals.list({ status: 'approved', limit: 200 }),
        api.affiliateOffers.list({ activeOnly: true }),
      ])
      if (pointsRes.status === 'fulfilled' && pointsRes.value.success) setPoints(pointsRes.value.data)
      if (reportRes.status === 'fulfilled' && reportRes.value.success) setReport(reportRes.value.data)
      if (pendingRes.status === 'fulfilled' && pendingRes.value.success) setPending(pendingRes.value.data)
      if (approvedRes.status === 'fulfilled' && approvedRes.value.success) setApproved(approvedRes.value.data)
      if (offersRes.status === 'fulfilled' && offersRes.value.success) {
        setOpenOffers(offersRes.value.data.length)
      }
    } catch {}
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleDelete = async (id: string) => {
    if (!confirm('このCVポイントを削除しますか？')) return
    await api.conversions.deletePoint(id)
    load()
  }

  // 成果地点ごとのCV数。レポートは成果地点IDで返る。
  const countByPoint = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of report) m.set(r.conversionPointId, r.totalCount)
    return m
  }, [report])

  const kpi = useMemo(() => {
    const approvedRecent = approved.filter((a) => within28Days(a.createdAt))
    return {
      confirmed: approvedRecent.length,
      confirmedYen: approvedRecent.reduce((s, a) => s + (a.value ?? 0), 0),
      pendingCount: pending.length,
      pendingYen: pending.reduce((s, a) => s + (a.value ?? 0), 0),
    }
  }, [approved, pending])

  const shown = useMemo(() => {
    const q = query.trim()
    return q ? points.filter((p) => p.name.includes(q)) : points
  }, [points, query])

  return (
    <div>
      <div data-design="Head">
        <Header
          title="成果とアフィリエイト"
          description="何を成果として数えるか、誰の紹介か、いくら払うかを1か所でまとめて扱います。成果地点の定義と、出た成果の承認が同じ画面で完結します。"
          action={
            <div className="flex flex-wrap gap-2">
              <Button
                disabled
                title="マニュアルは準備中です"
              >
                マニュアル
              </Button>
              <Button
                href="/conversions?tab=affiliates"
              >
                アフィリエイターを追加
              </Button>
              <Button
                href="/conversions/new"
                variant="primary"
              >
                成果地点を追加
              </Button>
            </div>
          }
        />
      </div>

      <div data-design="KPIs" className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title="確定した成果"
          value={kpi.confirmed}
          unit="件"
          detail="過去28日"
          loading={loading}
        />
        <KpiCard
          title="承認待ち"
          value={kpi.pendingCount}
          unit="件"
          detail={`合計 ¥${kpi.pendingYen.toLocaleString()}`}
          action={{ label: '成果承認', href: '/conversions?tab=approvals' }}
          loading={loading}
        />
        {/* 設計は「確定報酬」。報酬そのものを持つ列が無いので、確定した成果の
            金額を出している。案件の料率で計算した額とは一致しない。 */}
        <KpiCard
          title="確定報酬"
          value={kpi.confirmedYen}
          unit="円"
          detail="過去28日・成果の金額"
          loading={loading}
        />
        <KpiCard
          title="公開中の案件"
          value={openOffers}
          unit="件"
          detail="紹介できる案件"
          action={{ label: '案件', href: '/conversions?tab=offers' }}
          loading={loading}
        />
      </div>

      <div
        data-design="Bar"
        className="bg-canvas rounded-card border-hairline mb-3 flex flex-wrap items-center gap-2 border p-3"
      >
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="CV名で検索"
          aria-label="CV名で検索"
          className="border-hairline rounded-control focus:ring-accent min-w-0 flex-1 border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
        />
        <span className="text-ink-faint text-xs whitespace-nowrap">並び順</span>
        <select
          disabled
          title="並び替えは準備中です"
          className="border-hairline rounded-control border px-2 py-2 text-sm opacity-50"
        >
          <option>CV数が多い順</option>
        </select>
        <span className="text-ink-faint text-xs whitespace-nowrap">期間</span>
        <select
          disabled
          title="期間の切り替えは準備中です"
          className="border-hairline rounded-control border px-2 py-2 text-sm opacity-50"
        >
          <option>今月</option>
        </select>
        <Button
          disabled
          title="書き出しは準備中です"
        >
          CSVで書き出す
        </Button>
      </div>

      {/* 設計の表は7列。報酬と状態は持っている列が無いので「—」を出す。
          列ごと消すと、その考え方が無い画面に見えてしまう。 */}
      {loading ? (
        <div className="bg-canvas rounded-card border-hairline border p-8 text-center text-sm text-ink-faint">
          読み込み中...
        </div>
      ) : shown.length === 0 ? (
        <div className="bg-canvas rounded-card border-hairline border p-8 text-center text-sm text-ink-faint">
          {query ? '検索に合う成果地点はありません。' : 'まだ成果地点がありません。右上の「成果地点を追加」から登録してください。'}
        </div>
      ) : (
        <div data-design="Table" className="bg-canvas rounded-card border-hairline overflow-x-auto border">
          <table className="w-full min-w-[880px]">
            <thead>
              <TableHeadRow>
                <Th>成果地点（CV）名</Th>
                <Th>種別</Th>
                <Th>計測方法</Th>
                <Th align="right">成果単価</Th>
                <Th align="right">CV数</Th>
                <Th>報酬</Th>
                <Th>状態</Th>
                <Th align="right">操作</Th>
              </TableHeadRow>
            </thead>
            <tbody className="divide-hairline divide-y">
              {shown.map((point) => (
                <tr key={point.id} className="hover:bg-canvas-sunken">
                  <td className="text-ink px-4 py-3 text-sm font-medium">
                    {point.name}
                    {point.targetUrl && (
                      <p className="text-ink-faint mt-0.5 max-w-[22rem] truncate text-[11px]" title={point.targetUrl}>
                        {point.targetUrl}
                      </p>
                    )}
                  </td>
                  <td className="text-ink-secondary px-4 py-3 text-sm">
                    {EVENT_TYPE_LABELS[point.eventType] ?? point.eventType}
                  </td>
                  <td className="text-ink-secondary px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="bg-canvas-sunken text-ink-secondary rounded-pill px-2 py-0.5 text-[11px] whitespace-nowrap">
                        {measureLabel(point.measureMethod)}
                      </span>
                      {point.countRepeat === false && (
                        <span className="bg-canvas-sunken text-ink-secondary rounded-pill px-2 py-0.5 text-[11px] whitespace-nowrap">
                          一人一回
                        </span>
                      )}
                      {point.attributionDays != null && (
                        <span className="bg-canvas-sunken text-ink-secondary rounded-pill px-2 py-0.5 text-[11px] whitespace-nowrap tabular-nums">
                          {point.attributionDays}日
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="text-ink-secondary px-4 py-3 text-right text-sm tabular-nums">
                    {point.value !== null ? `¥${point.value.toLocaleString()}` : '—'}
                  </td>
                  <td className="text-ink px-4 py-3 text-right text-sm tabular-nums">
                    {countByPoint.get(point.id) ?? 0}
                  </td>
                  {/* 報酬は案件ごとの料率で決まる。成果地点と案件を結ぶ列が無いので出せない。 */}
                  <td className="text-ink-faint px-4 py-3 text-sm">—</td>
                  {/* 計測を止める仕組みが無い。作った成果地点は常に計測中。 */}
                  <td className="px-4 py-3 text-sm">
                    <span className="bg-success-bg text-success rounded-pill px-2 py-0.5 text-[11px]">計測中</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleDelete(point.id)}
                      className="text-danger text-sm hover:underline"
                    >
                      削除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div data-design="tf" className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-ink-faint text-xs">
          成果が出たあとの承認は「成果承認」タブで行います。旧デザインではCV計測とアフィリエイトが別ページに分かれていて、定義と承認の間で画面を往復する必要がありました。
        </p>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-ink-faint tabular-nums">全 {shown.length} 件</span>
          <button disabled title="ページの切り替えは準備中です" className="border-hairline text-ink-faint rounded-control border px-2 py-1 opacity-50">
            前へ
          </button>
          <button disabled title="ページの切り替えは準備中です" className="border-hairline text-ink-faint rounded-control border px-2 py-1 opacity-50">
            次へ
          </button>
        </div>
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
  const [rows, setRows] = useState<ConversionReportItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void api.conversions
      .report()
      .then((r) => {
        if (!cancelled && r.success) setRows(r.data)
      })
      .catch(() => {
        // レポートが引けなくても、他のタブは使える。
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const total = rows.reduce((s, r) => s + r.totalValue, 0)

  if (loading) {
    return (
      <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
        読み込み中...
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
        まだ成果の記録がありません。成果地点を作って計測が始まると、ここに出ます。
      </div>
    )
  }

  return (
    <div className="bg-canvas rounded-card border-hairline overflow-x-auto border">
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
    <div>
      <MergedTabs
        basePath="/conversions"
        paramName="tab"
        tabs={MERGED_TABS}
        active={tab}
        defaultKey={DEFAULT_TAB}
      />
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
