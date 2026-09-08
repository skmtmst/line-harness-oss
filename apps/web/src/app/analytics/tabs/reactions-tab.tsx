'use client'

import { useMemo } from 'react'
import { api, type AnalyticsReactionsOverview } from '@/lib/api'
import KpiCard from '@/components/shared/kpi-card'
import { TableHeadRow, Th } from '@/components/shared/table'
import {
  AnalyticsNotice,
  MetricCell,
  OverviewState,
  rangeFor,
  shownValue,
  useOverview,
} from './analytics-shared'

export function ReactionsOverviewTab({ accountId }: { accountId: string }) {
  const range = useMemo(() => rangeFor(29), [])
  const state = useOverview<AnalyticsReactionsOverview>(
    () => api.analytics.reactionsOverview(accountId, range),
    `${accountId}:${range.from}:${range.to}:reactions`,
  )
  if (!state.data) return <OverviewState loading={state.loading} error={state.error} />
  const overview = state.data.data
  const delivered = shownValue(overview.metrics.delivered)
  const clicked = shownValue(overview.metrics.lineClicked)
  const clickRate = delivered && clicked !== null ? clicked / delivered * 100 : null
  const maxHourly = Math.max(1, ...overview.trackedClickHours.map((item) => item.clicks))
  return <div data-design-node="J6Inc" className="space-y-4">
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <KpiCard title="この30日に送った" value={overview.campaigns.length} unit="回" detail="一覧に取得できた配信" />
      <KpiCard title="届いた人" value={delivered} unit="人" detail={overview.metrics.delivered.reason ?? '配信ごとの到達数の合計'} />
      <KpiCard title="押された割合" value={clickRate} unit="%" detail="LINEクリック ÷ 届いた人" />
      <KpiCard title="取得できない配信" value={shownValue(overview.metrics.unavailableCampaigns)} unit="件" detail={overview.metrics.unavailableCampaigns.reason ?? '開封などを取得できない配信'} />
    </div>
    <AnalyticsNotice>配信ごとの開かれ方・押され方です。20人未満など取得できない数は、0ではなく「—」と理由で示します。</AnalyticsNotice>
    <section className="bg-canvas rounded-card border-hairline border p-4">
      <h2 className="font-semibold text-ink">送った時間ごとの「押された回数」</h2>
      <p className="mt-1 text-xs text-ink-faint">こちらで作った中継URLのクリックを、時間帯ごとに並べています。</p>
      <div className="mt-4 flex h-28 items-end gap-2">
        {Array.from({ length: 24 }, (_, hour) => {
          const clicks = overview.trackedClickHours.find((item) => item.hour === hour)?.clicks ?? 0
          return <div key={hour} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`${hour}時台 ${clicks}回`}><span className="w-full rounded-t bg-accent" style={{ height: `${Math.max(2, clicks / maxHourly * 96)}px` }} />{hour % 3 === 0 && <span className="whitespace-nowrap text-[10px] text-ink-faint">{hour}時</span>}</div>
        })}
      </div>
    </section>
    <div className="bg-canvas rounded-card border-hairline overflow-hidden border"><table className="w-full table-fixed">
      <thead><TableHeadRow><Th>配信</Th><Th>種類・日時</Th><Th align="right">対象</Th><Th align="right">到達</Th><Th align="right">開封</Th><Th align="right">LINEクリック</Th><Th align="right">成果</Th></TableHeadRow></thead>
      <tbody className="divide-hairline divide-y">{overview.campaigns.length === 0 ? <tr><td colSpan={7} className="text-ink-faint p-8 text-center text-sm">この期間の配信はありません</td></tr> : overview.campaigns.map((item) => <tr key={`${item.kind}:${item.id}`} className="text-sm"><td className="truncate px-4 py-3 font-medium" title={item.name}>{item.name}</td><td className="text-ink-secondary px-3 py-3">{item.kind === 'broadcast' ? '一斉配信' : 'シナリオ'}<br /><span className="text-xs tabular-nums">{item.sentAt.slice(0, 16).replace('T', ' ')}</span></td><td className="px-3 py-3 text-right"><MetricCell metric={item.targetPeople} /></td><td className="px-3 py-3 text-right"><MetricCell metric={item.delivered} /></td><td className="px-3 py-3 text-right"><MetricCell metric={item.opened} /></td><td className="px-3 py-3 text-right"><MetricCell metric={item.lineClicked} /></td><td className="px-3 py-3 text-right"><MetricCell metric={item.outcomes} /></td></tr>)}</tbody>
    </table></div>
  </div>
}
