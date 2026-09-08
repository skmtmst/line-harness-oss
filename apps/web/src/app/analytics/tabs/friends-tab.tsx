'use client'

import { useMemo, useState } from 'react'
import { api, type AnalyticsFriendsOverview, type AnalyticsRoutesOverview } from '@/lib/api'
import KpiCard from '@/components/shared/kpi-card'
import { TableHeadRow, Th } from '@/components/shared/table'
import {
  AnalyticsNotice,
  MetricCell,
  OverviewState,
  metricText,
  rangeFor,
  shownValue,
  useOverview,
  weekdayOf,
} from './analytics-shared'

// 経路の内訳だけを後から読む(点検#508軽10)。概要と同時に2つの重い集計を走らせない。
// 概要が出てから描かれるので、この関数の読み込みは概要の後に始まる。
// 取得中は表の場所だけ読み込み表示にする。
function RouteBreakdown({ accountId, from, to }: { accountId: string; from: string; to: string }) {
  const routeState = useOverview<AnalyticsRoutesOverview>(
    () => api.analytics.routesOverview(accountId, { from, to }),
    `${accountId}:${from}:${to}:friends-routes`,
  )
  if (!routeState.data) return <OverviewState loading={routeState.loading} error={routeState.error} />
  return <table className="w-full table-fixed"><thead><TableHeadRow><Th>経路</Th><Th align="right">増えた友だち</Th><Th align="right">現在つながっている</Th><Th align="right">1人追加あたり費用</Th></TableHeadRow></thead><tbody className="divide-y divide-hairline">{routeState.data.data.routes.map((route) => <tr key={route.id} className="text-sm"><td className="px-4 py-3"><p className="truncate font-medium" title={route.name}>{route.name}</p><p className="mt-1 truncate text-xs text-ink-faint">{route.refCode ? `ref=${route.refCode}` : '参照コードなし'}</p></td><td className="px-4 py-3 text-right"><MetricCell metric={route.friendAdds} /></td><td className="px-4 py-3 text-right"><MetricCell metric={route.currentFriends} /></td><td className="px-4 py-3 text-right"><MetricCell metric={route.costPerFriend} currency /></td></tr>)}</tbody></table>
}

export function FriendsOverviewTab({ accountId }: { accountId: string }) {
  const range = useMemo(() => rangeFor(29), [])
  const [selectedDate, setSelectedDate] = useState('')
  const state = useOverview<AnalyticsFriendsOverview>(
    () => api.analytics.friendsOverview(accountId, range),
    `${accountId}:${range.from}:${range.to}:friends`,
  )
  if (!state.data) return <OverviewState loading={state.loading} error={state.error} />
  const overview = state.data.data
  const addedValue = shownValue(overview.metrics.added)
  const removedValue = shownValue(overview.metrics.removed)
  // 差し引きは増加と減少から導いた値。元の2つが出せないなら、差し引きも出せない。
  // ここを道連れにしないと「増えた —／減った —／差し引き 0人」という読めない並びになる。
  const netValue = addedValue === null || removedValue === null ? null : shownValue(overview.metrics.net)
  const remainingRate = addedValue && removedValue !== null
    ? Math.max(0, ((addedValue - removedValue) / addedValue) * 100)
    : null
  const pendingReason = overview.stateReason ?? '日ごとの集計がまだありません'
  // 日ごとの表は行ごとの状態を持たない。全体の状態が「実測できた」でないときは、
  // 0 が並んだ30行を出さずに理由を1行で出す。
  const daysShown = overview.state === 'available' || overview.state === 'partial'
  const selectedDay = overview.days.find((day) => day.date === selectedDate) ?? overview.days.at(-1) ?? null
  const selectedCampaigns = overview.campaigns.filter((item) => item.date === selectedDay?.date)
  return <div data-design-node="Zxezb" className="space-y-4">
    {overview.state !== 'available' && overview.stateReason && <div className="bg-warning-bg border-warning rounded-card border px-4 py-3 text-sm">{overview.stateReason}</div>}
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <KpiCard title="現在つながっている" value={shownValue(overview.metrics.currentFriends)} unit="人" detail={overview.metrics.currentFriends.reason ?? (netValue === null ? pendingReason : `この30日の差し引き ${netValue > 0 ? '+' : ''}${netValue}人`)} />
      <KpiCard title="増えた友だち" value={addedValue} unit="人" detail={overview.metrics.added.reason ?? (addedValue === null ? pendingReason : `この30日。初回 ${metricText(overview.metrics.firstTime)}人`)} />
      <KpiCard title="減った友だち" value={removedValue} unit="人" detail={overview.metrics.removed.reason ?? (removedValue === null ? pendingReason : 'この30日。ブロック・友だち解除')} />
      <KpiCard title="差し引き" value={netValue} unit="人" detail={remainingRate === null ? pendingReason : `増加 − 減少。残っている割合 ${remainingRate.toFixed(1)}%`} />
    </div>
    <AnalyticsNotice>増えた人と減った人を日ごとに並べています。減りが増えた日に何を配信したかも、同じ日付で確かめられます。</AnalyticsNotice>
    <section className="bg-canvas rounded-card border-hairline border p-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div><h2 className="font-semibold text-ink">日ごとの増減（この30日）</h2><p className="mt-1 text-xs text-ink-faint">上が増えた人、下が減った人です。</p></div>
        <span className="text-xs tabular-nums text-ink-faint">{state.data.period.from}〜{state.data.period.to}</span>
      </div>
      {!daysShown ? <p className="p-8 text-center text-sm text-ink-faint">{pendingReason}</p> : (
        <div className="grid h-44 grid-cols-[repeat(30,minmax(0,1fr))] items-center gap-1 border-y border-hairline py-3">
          {overview.days.map((day, index) => {
            const max = Math.max(1, ...overview.days.flatMap((item) => [item.added, item.removed]))
            const campaigns = overview.campaigns.filter((item) => item.date === day.date)
            return <button type="button" key={day.date} onClick={() => setSelectedDate(day.date)} className={`relative flex h-full flex-col justify-center ${selectedDate === day.date ? 'ring-2 ring-accent ring-offset-1' : ''}`} title={`${day.date} 増加${day.added}・減少${day.removed}${campaigns.length ? `・${campaigns.map((item) => item.name).join('、')}` : ''}`}>
              <div className="flex h-1/2 items-end"><span className="block w-full rounded-t bg-accent" style={{ height: `${Math.max(3, day.added / max * 100)}%` }} /></div>
              <div className="border-t border-hairline" />
              <div className="flex h-1/2 items-start"><span className="block w-full rounded-b bg-danger" style={{ height: `${Math.max(3, day.removed / max * 100)}%` }} /></div>
              {(index === 0 || index === overview.days.length - 1 || campaigns.length > 0) && <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] text-ink-faint">{day.date.slice(5).replace('-', '/')}</span>}
            </button>
          })}
        </div>
      )}
      <div className="mt-8 flex flex-wrap gap-4 text-xs text-ink-secondary"><span>● 増えた人</span><span className="text-danger">● 減った人</span>{overview.campaigns.map((item) => <span key={item.id}>{item.date.slice(5).replace('-', '/')} {item.name}</span>)}</div>
      {selectedDay && <div className="mt-3 rounded-control bg-canvas-sunken px-3 py-2 text-xs text-ink-secondary"><strong className="text-ink">{selectedDay.date}（{weekdayOf(selectedDay.date)}）</strong>　増加 {selectedDay.added}人・減少 {selectedDay.removed}人・差し引き {selectedDay.net > 0 ? '+' : ''}{selectedDay.net}人　施策 {selectedCampaigns.length ? selectedCampaigns.map((item) => item.name).join('、') : 'なし'}</div>}
    </section>
    <section className="overflow-hidden rounded-card border border-hairline bg-canvas">
      <div className="border-b border-hairline px-4 py-3"><h2 className="font-semibold text-ink">どこから増えたか</h2><p className="mt-1 text-xs text-ink-faint">「経路と成果」に接続された経路ごとの、この30日の実測です。</p></div>
      <RouteBreakdown accountId={accountId} from={range.from} to={range.to} />
    </section>
  </div>
}
