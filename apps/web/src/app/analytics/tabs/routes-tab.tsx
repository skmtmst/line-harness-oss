'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { api, type AnalyticsRoutesOverview } from '@/lib/api'
import KpiCard from '@/components/shared/kpi-card'
import { TableHeadRow, Th } from '@/components/shared/table'
import {
  AnalyticsNotice,
  MetricCell,
  OverviewState,
  metricSum,
  rangeFor,
  shownValue,
  useOverview,
} from './analytics-shared'

export function RoutesOverviewTab({ accountId }: { accountId: string }) {
  const range = useMemo(() => rangeFor(29), [])
  const state = useOverview<AnalyticsRoutesOverview>(
    () => api.analytics.routesOverview(accountId, range),
    `${accountId}:${range.from}:${range.to}:routes`,
  )
  if (!state.data) return <OverviewState loading={state.loading} error={state.error} />
  const overview = state.data.data
  const clicks = metricSum(overview.routes.map((item) => item.clicks))
  const friends = metricSum(overview.routes.map((item) => item.friendAdds))
  const reactions = metricSum(overview.routes.map((item) => item.reactionPeople))
  const conversions = metricSum(overview.routes.map((item) => item.conversions.approved))
  const revenue = metricSum(overview.routes.map((item) => item.conversions.revenue))
  const adCost = metricSum(overview.routes.map((item) => item.adCost))
  const profit = metricSum(overview.routes.map((item) => item.profitAfterAdCost))
  const stages = [
    { label: 'リンクを見た', value: clicks },
    { label: '友だちになった', value: friends },
    { label: '1回でも反応した', value: reactions },
    { label: '成果になった', value: conversions },
  ]
  return <div data-design-node="YBGtm" className="space-y-4">
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <KpiCard title="この30日の成果" value={conversions} unit="件" detail={revenue === null ? '売上は取得できません' : `売上 ${revenue.toLocaleString('ja-JP')}円`} />
      <KpiCard title="かかった広告費" value={adCost} unit="円" detail="接続済みの経路を合計" />
      <KpiCard title="差し引き" value={profit} unit="円" detail="売上から広告費を引いた残り" />
      <KpiCard title="費用を取得できない経路" value={overview.routes.filter((item) => shownValue(item.adCost) === null).length} unit="件" detail="0円として計算しません" />
    </div>
    <AnalyticsNotice><span>経路ごとに、かかった費用と出た成果を差し引きまで出します。帰属方式は「{overview.attributionLabel}」です。</span> <Link href={overview.searchConsoleHref} className="font-medium text-accent hover:underline">Search Consoleを見る</Link></AnalyticsNotice>
    <div className="grid grid-cols-4 overflow-hidden rounded-card border border-hairline bg-canvas">{stages.map((stage, index) => {
      const previous = index > 0 ? stages[index - 1].value : null
      const rate = previous && stage.value !== null ? stage.value / previous * 100 : null
      return <div key={stage.label} className="border-r border-hairline px-4 py-3 last:border-r-0"><p className="text-xs text-ink-faint">{stage.label}</p><p className="mt-1 text-lg font-bold text-ink">{stage.value === null ? '—' : stage.value.toLocaleString('ja-JP')}<span className="ml-1 text-xs font-normal">{index === 0 ? '回' : index === 3 ? '件' : '人'}</span></p>{index > 0 && <p className="text-xs text-ink-secondary">前段の {rate === null ? '—' : `${rate.toFixed(1)}%`}</p>}</div>
    })}</div>
    <div className="bg-canvas rounded-card border-hairline overflow-hidden border"><table className="w-full table-fixed">
      <thead><TableHeadRow><Th>経路</Th><Th align="right">友だち</Th><Th align="right">反応</Th><Th align="right">成果</Th><Th align="right">売上</Th><Th align="right">かかった費用</Th><Th align="right">差し引き</Th></TableHeadRow></thead>
      <tbody className="divide-hairline divide-y">{overview.routes.length === 0 ? <tr><td colSpan={7} className="text-ink-faint p-8 text-center text-sm">この期間に集計できる経路はありません</td></tr> : overview.routes.map((item) => <tr key={item.id} className="text-sm"><td className="px-3 py-3 font-medium"><p className="truncate" title={item.name}>{item.name}</p><p className="mt-1 truncate text-xs font-normal text-ink-faint">{item.refCode ? `流入と計測 ／ ref=${item.refCode}` : '参照コードなし'} ／ クリック <MetricCell metric={item.clicks} /></p></td><td className="px-2 py-3 text-right"><MetricCell metric={item.friendAdds} /><p className="mt-1 text-xs text-ink-faint">現在 <MetricCell metric={item.currentFriends} /></p></td><td className="px-2 py-3 text-right"><MetricCell metric={item.reactionPeople} /></td><td className="px-2 py-3 text-right"><MetricCell metric={item.conversions.approved} /><p className="mt-1 text-xs text-ink-faint">保留 <MetricCell metric={item.conversions.pending} />・却下 <MetricCell metric={item.conversions.rejected} /></p></td><td className="px-2 py-3 text-right"><MetricCell metric={item.conversions.revenue} currency /></td><td className="px-2 py-3 text-right"><MetricCell metric={item.adCost} currency /><p className="mt-1 text-xs text-ink-faint">友だち1人 <MetricCell metric={item.costPerFriend} currency />・成果1件 <MetricCell metric={item.costPerConversion} currency /></p></td><td className="px-2 py-3 text-right"><MetricCell metric={item.profitAfterAdCost} currency /></td></tr>)}</tbody>
    </table></div>
  </div>
}
