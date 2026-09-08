'use client'

import { useMemo, useState } from 'react'
import { api, type AnalyticsUrlClicksOverview } from '@/lib/api'
import Chip from '@/components/shared/chip'
import KpiCard from '@/components/shared/kpi-card'
import { TableHeadRow, Th } from '@/components/shared/table'
import {
  AnalyticsExportButton,
  AnalyticsNotice,
  DateTimeMetricCell,
  MetricCell,
  OverviewState,
  downloadCsv,
  metricSum,
  rangeFor,
  shownValue,
  useOverview,
} from './analytics-shared'

export function UrlClicksOverviewTab({ accountId }: { accountId: string }) {
  const range = useMemo(() => rangeFor(29), [])
  const [query, setQuery] = useState('')
  const state = useOverview<AnalyticsUrlClicksOverview>(
    () => api.analytics.urlClicksOverview(accountId, { ...range, limit: 200 }),
    `${accountId}:${range.from}:${range.to}:url-clicks`,
  )
  if (!state.data) return <OverviewState loading={state.loading} error={state.error} />
  const overview = state.data.data
  const visibleLinks = overview.links.filter((item) => `${item.name} ${item.originalUrl} ${item.usageLocations.join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()))
  const clicks = metricSum(overview.links.map((item) => item.clicks))
  const people = metricSum(overview.links.map((item) => item.knownClickPeople))
  const zeroLinks = overview.links.filter((item) => shownValue(item.clicks) === 0).length
  const exportRows = () => downloadCsv('analytics-url-clicks.csv', [
    ['リンク名', 'URL', '押された回数', '押した人', '使われた場所'],
    ...visibleLinks.map((item) => [item.name, item.originalUrl, shownValue(item.clicks), shownValue(item.knownClickPeople), item.usageLocations.join('、')]),
  ])
  return <div data-design-node="Fh2Qj" className="space-y-4">
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <KpiCard title="押された回数" value={clicks} unit="回" detail="この30日の中継URL" />
      <KpiCard title="押した人（URLごとの合計）" value={people} unit="人" detail="URLをまたぐ重複は除けません" />
      <KpiCard title="計測中のURL" value={overview.links.filter((item) => item.isActive).length} unit="件" detail="この画面に取得できたもの" />
      <KpiCard title="押されていないURL" value={zeroLinks} unit="件" detail="実測できたURLのうち" />
    </div>
    <AnalyticsNotice>数えているのは、こちらで作った中継URLだけです。直接貼ったURLは数えられません。同じURLを同じ人が何度押しても「押した人」は1人と数えます。</AnalyticsNotice>
    {overview.stateReason && <div className="bg-warning-bg border-warning rounded-card border px-4 py-3 text-sm">{overview.stateReason}</div>}
    {overview.hasMore && <AnalyticsNotice>200件まで表示しています。探す言葉を足して絞ってください。CSVの書き出しも、表示している範囲だけが入ります。</AnalyticsNotice>}
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor="url-click-search" className="sr-only">URL・配信名・リンク名で探す</label>
      <input id="url-click-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="URL・配信名・リンク名で探す" className="h-10 min-w-64 flex-1 rounded-control border border-hairline bg-canvas px-3 text-sm" />
      <span className="text-xs text-ink-faint">{state.data.period.from}〜{state.data.period.to}</span>
      <AnalyticsExportButton onClick={exportRows} disabled={visibleLinks.length === 0} />
    </div>
    <div className="bg-canvas rounded-card border-hairline overflow-hidden border"><table className="w-full table-fixed">
      <thead><TableHeadRow><Th>リンク名・リンク先URL</Th><Th>どこから</Th><Th align="right">押された回数</Th><Th align="right">押した人</Th><Th align="right">クリック率</Th><Th>状態</Th></TableHeadRow></thead>
      <tbody className="divide-hairline divide-y">{visibleLinks.length === 0 ? <tr><td colSpan={6} className="text-ink-faint p-8 text-center text-sm">条件に合うURLはありません</td></tr> : visibleLinks.map((item) => <tr key={item.trackedLinkId} className="text-sm"><td className="px-3 py-3"><p className="truncate font-medium" title={item.name}>{item.name}</p><p className="mt-1 truncate text-xs text-ink-faint" title={item.originalUrl}>{item.originalUrl}</p><p className="mt-1 truncate text-[11px] text-ink-faint">最初 {item.firstClickedAt ? <DateTimeMetricCell metric={item.firstClickedAt} /> : '—'} ／ 最後 {item.lastClickedAt ? <DateTimeMetricCell metric={item.lastClickedAt} /> : '—'}</p></td><td className="text-ink-secondary truncate px-3 py-3" title={item.usageLocations.join('、')}>{item.usageLocations.length ? item.usageLocations.join('、') : '—'}</td><td className="px-2 py-3 text-right"><MetricCell metric={item.clicks} /></td><td className="px-2 py-3 text-right"><MetricCell metric={item.knownClickPeople} /><p className="mt-1 text-xs text-ink-faint">届いた人数 <MetricCell metric={item.deliveredPeople} /></p></td><td className="px-2 py-3 text-right">{shownValue(item.clickRate) === null ? <span className="text-ink-faint" title={item.clickRate.reason ?? undefined}>—</span> : <span>{shownValue(item.clickRate)}%</span>}</td><td className="px-3 py-3"><Chip tone={item.isActive ? 'ok' : 'neutral'}>{item.isActive ? '計測中' : '停止中'}</Chip>{(item.actions?.tagName || item.actions?.scenarioName) && <p className="mt-1 truncate text-xs text-ink-faint" title={[item.actions.tagName, item.actions.scenarioName].filter(Boolean).join('、')}>{[item.actions.tagName, item.actions.scenarioName].filter(Boolean).join('・')}</p>}</td></tr>)}</tbody>
    </table></div>
    <p className="text-ink-faint text-xs">{overview.clickRateDefinition}</p>
  </div>
}
