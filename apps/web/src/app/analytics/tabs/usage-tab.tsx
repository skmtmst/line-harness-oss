'use client'

import { useEffect, useMemo, useState } from 'react'
import { api, type AnalyticsUsageOverview } from '@/lib/api'
import Button from '@/components/shared/button'
import KpiCard from '@/components/shared/kpi-card'
import { TableHeadRow, Th } from '@/components/shared/table'
import { formatAnalyticsDateTime } from '../analytics-time'
import {
  AnalyticsNotice,
  DateTimeMetricCell,
  MetricCell,
  OverviewState,
  rangeFor,
  shownValue,
  useOverview,
} from './analytics-shared'
import { canTidyUsage, summarizeMenuFeatures, usageObservation } from '../analytics-usage'

export function UsageOverviewTab({ accountId }: { accountId: string }) {
  const range = useMemo(() => rangeFor(29), [])
  const [menuFeatures, setMenuFeatures] = useState<{ enabled: number; total: number } | null>(null)
  const [menuFeaturesError, setMenuFeaturesError] = useState('')
  const state = useOverview<AnalyticsUsageOverview>(
    () => api.analytics.usageOverview(accountId, range),
    `${accountId}:${range.from}:${range.to}:usage`,
  )
  useEffect(() => {
    let active = true
    setMenuFeatures(null)
    setMenuFeaturesError('')
    void api.featureSettings.get(accountId).then((response) => {
      if (!active) return
      if (!response.success) {
        setMenuFeaturesError('メニューに出している機能を確認できません')
        return
      }
      setMenuFeatures(summarizeMenuFeatures(response.data))
    }).catch(() => {
      if (active) setMenuFeaturesError('メニューに出している機能を確認できません')
    })
    return () => { active = false }
  }, [accountId])
  if (!state.data) return <OverviewState loading={state.loading} error={state.error} />
  const overview = state.data.data
  const estimatedHoursSavedValue = overview.summary.estimatedHoursSaved.state === 'available'
    || overview.summary.estimatedHoursSaved.state === 'partial'
    ? overview.summary.estimatedHoursSaved.value
    : null
  return <div data-design-node="QQ1SR" className="space-y-4">
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <KpiCard
        title="使っている機能"
        value={menuFeatures?.enabled ?? null}
        unit={menuFeatures ? ` / ${menuFeatures.total}` : ''}
        detail={menuFeaturesError || 'メニューに出している機能のうち'}
      />
      <KpiCard
        title="作ったのに使っていない"
        value={shownValue(overview.summary.unusedItems)}
        unit="個"
        detail={overview.summary.unusedItems.reason ?? '8分類の利用状況から集計'}
        action={(shownValue(overview.summary.unusedItems) ?? 0) > 0 ? { label: '片づける', href: '#usage-items' } : undefined}
      />
      <KpiCard
        title="自動で動いた回数"
        value={shownValue(overview.summary.automaticRuns)}
        unit="回"
        detail={`この30日。${overview.summary.automaticRuns.reason ?? '実行記録から集計'}。手で送ったのは${overview.summary.manualSends.value?.toLocaleString('ja-JP') ?? '—'}回`}
      />
      <KpiCard
        title="手作業が減った時間"
        value={estimatedHoursSavedValue}
        unit="時間"
        detail={overview.summary.estimatedHoursSaved.reason ?? '1件30秒として試算'}
      />
    </div>
    {overview.stateReason ? <div className="bg-warning-bg border-warning rounded-card border px-4 py-3 text-sm">{overview.stateReason}</div> : <AnalyticsNotice>項目が多いほど良い、ではありません。使っていないものは使用先を確かめてから、下の「片づける」で整理できます。</AnalyticsNotice>}
    <div id="usage-items" className="bg-canvas rounded-card border-hairline overflow-hidden border"><table className="w-full table-fixed">
      <thead><TableHeadRow><Th>機能</Th><Th align="right">作成</Th><Th align="right">利用中</Th><Th align="right">未使用</Th><Th>気づいたこと</Th><Th align="right">操作</Th></TableHeadRow></thead>
      <tbody className="divide-hairline divide-y">{overview.categories.map((item) => {
        const observation = usageObservation(item)
        return <tr key={item.key} className="text-sm"><td className="px-4 py-3"><p className="font-medium">{item.label}</p><p className="text-ink-faint mt-1 truncate text-xs">最終利用 <DateTimeMetricCell metric={item.lastUsedAt} /></p></td><td className="px-3 py-3 text-right"><MetricCell metric={item.created} /></td><td className="px-3 py-3 text-right"><MetricCell metric={item.inUse} /></td><td className="px-3 py-3 text-right"><MetricCell metric={item.unused} /></td><td className="px-3 py-3"><p className={`truncate ${observation.tone === 'warning' ? 'text-warning' : observation.tone === 'unknown' ? 'text-ink-faint' : 'text-success'}`} title={observation.text}>{observation.text}</p><p className="text-ink-faint mt-1 text-xs">参照切れ <MetricCell metric={item.brokenReferences} /></p></td><td className="px-3 py-2"><div className="flex justify-end gap-2 whitespace-nowrap"><Button href={item.href} variant="secondary">中身を見る</Button>{canTidyUsage(item) && <Button href={item.href} variant="secondary" className="border-warning text-warning">片づける</Button>}</div></td></tr>
      })}</tbody>
    </table></div>
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
      <p className="text-ink-faint">未使用の項目は自動で削除しません。各機能の使用先を確認してから停止・削除します。</p>
      <p className="text-ink-faint">利用関係を最後に確認: {formatAnalyticsDateTime(overview.checkedAt)}</p>
    </div>
  </div>
}
