'use client'

/*
 * ★V8 分析「経路と成果」（Pencil `PFe9c`）と、その中の「成果地点ごとのレポート」（`AzrZq`）の共通部分。
 * 数の帯（友だちになった・成果・かかった広告費・差し引き）→ 道具の段（期間・データの範囲・
 * Search Console・CSV）→ 左に全体の流れ、右に経路ごとの表。
 * 呼ぶ口・合計の出し方・CSV は今の画面（RoutesOverviewTab）と同じ。
 */
import { useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { ArrowRight, Download, Target, TrendingUp, UserPlus, Wallet } from 'lucide-react'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import { api, type AnalyticsMetric, type AnalyticsRoutesOverview } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { KpiMenu, RangePickerV8, dataRangeCaption } from './common'
import { MetricText } from './reactions'
import { downloadCsv, metricText, rangeFor, shownValue, useOverview, useRegisterExport } from './parts'
import styles from './analytics.module.css'

function metricSum(metrics: Array<AnalyticsMetric<number>>): number | null {
  const values = metrics.map(shownValue)
  return values.some((value) => value === null) ? null : values.reduce<number>((sum, value) => sum + (value ?? 0), 0)
}
const yen = (value: number | null, signed = false) => value === null ? undefined : `${signed && value > 0 ? '+' : ''}¥${formatNumber(value)}`

/** 経路と成果の数の帯と道具の段を読み込み、本文は呼び出し側（経路の表／成果地点のレポート）が描く。 */
export function useRoutesOverview(accountId: string, controlled?: { days: number; setDays: (days: number) => void }) {
  const [ownDays, setOwnDays] = useState(30)
  const days = controlled?.days ?? ownDays
  const setDays = controlled?.setDays ?? setOwnDays
  const range = useMemo(() => rangeFor(days - 1), [days])
  const state = useOverview<AnalyticsRoutesOverview>(
    () => api.analytics.routesOverview(accountId, range),
    `${accountId}:${range.from}:${range.to}:routes`,
  )
  return { days, setDays, range, state }
}

export function RoutesFrame({ accountId, children, exportCsv, exportDisabled, days: controlledDays, onDaysChange }: {
  accountId: string
  /** 期間を呼び出し側で持つとき（成果地点ごとのレポートは同じ期間で成果を読む）。 */
  days?: number
  onDaysChange?: (days: number) => void
  /** 道具の段より下。渡さないときは経路の表（PFe9c）。 */
  children?: (overview: AnalyticsRoutesOverview['data'] | null) => ReactNode
  exportCsv?: () => void
  exportDisabled?: boolean
}) {
  const { days, setDays, state } = useRoutesOverview(accountId, controlledDays !== undefined && onDaysChange ? { days: controlledDays, setDays: onDaysChange } : undefined)
  const overview = state.data?.data ?? null
  const exportRoutes = () => {
    if (!overview) return
    downloadCsv('analytics-routes.csv', [
      ['経路', '友だち', '反応', '成果', '売上', 'かかった費用', '差し引き'],
      ...overview.routes.map((item) => [item.name, shownValue(item.friendAdds), shownValue(item.reactionPeople), shownValue(item.conversions.approved), shownValue(item.conversions.revenue), shownValue(item.adCost), shownValue(item.profitAfterAdCost)]),
    ])
  }
  const onExport = exportCsv ?? exportRoutes
  const disabled = exportCsv ? Boolean(exportDisabled) : !overview || overview.routes.length === 0
  useRegisterExport(onExport, disabled)

  if (!state.data || !overview) {
    return <div className={styles.body} data-gap="tab">
      <div className={styles.toolbar}><RangePickerV8 days={days} onChange={setDays} /></div>
      {state.loading ? <ListState kind="loading" title="分析を読み込んでいます" /> : <ListState kind="error" description={state.error} onRetry={state.retry} />}
      {/* 成果地点のレポートは経路の集計とは別の口。経路が読めなくても下は出す。 */}
      {children ? children(null) : null}
    </div>
  }
  const clicks = metricSum(overview.routes.map((item) => item.clicks))
  const friends = metricSum(overview.routes.map((item) => item.friendAdds))
  const conversions = metricSum(overview.routes.map((item) => item.conversions.approved))
  const pending = metricSum(overview.routes.map((item) => item.conversions.pending))
  const rejected = metricSum(overview.routes.map((item) => item.conversions.rejected))
  const revenue = metricSum(overview.routes.map((item) => item.conversions.revenue))
  const adCost = metricSum(overview.routes.map((item) => item.adCost))
  const profit = metricSum(overview.routes.map((item) => item.profitAfterAdCost))
  const noCost = overview.routes.filter((item) => shownValue(item.adCost) === null).length
  const menu = (title: string) => <KpiMenu title={title} onExport={onExport} disabled={disabled} />

  return <>
    <KpiBand className={styles.band}>
      <KpiCard presentation="band" title="友だちになった" icon={<UserPlus size={13} aria-hidden="true" />} menu={menu('友だちになった')} value={friends} unit="人" detail={clicks === null ? 'クリックは未取得です' : `リンクを押した ${formatNumber(clicks)} 回から`} />
      <KpiCard presentation="band" title="成果" icon={<Target size={13} aria-hidden="true" />} menu={menu('成果')} value={conversions} unit="件" detail={pending === null || rejected === null ? '保留・却下は未取得です' : `保留 ${formatNumber(pending)}・却下 ${formatNumber(rejected)}`} />
      <KpiCard presentation="band" title="かかった広告費" icon={<Wallet size={13} aria-hidden="true" />} menu={menu('かかった広告費')} value={adCost} valueText={yen(adCost)} unit="円" detail={`費用を取れない経路 ${noCost}`} />
      <KpiCard presentation="band" title="差し引き" icon={<TrendingUp size={13} aria-hidden="true" />} menu={menu('差し引き')} value={profit} valueText={yen(profit, true)} unit="円" detail={revenue === null ? '売上は未取得です' : `売上 ${yen(revenue)} − 費用`} />
    </KpiBand>
    <div className={styles.body} data-gap="tab">
      <div className={styles.toolbar}>
        <RangePickerV8 days={days} onChange={setDays} />
        <span className={styles.caption}>{dataRangeCaption(state.data.period.from, state.data.period.to, state.data.dataCutoffAt)}</span>
        <span className={styles.spacer} />
        <Link href={overview.searchConsoleHref} className={styles.textLink}>Search Console を見る<ArrowRight size={12} aria-hidden="true" /></Link>
        <Button variant="secondary" onClick={onExport} disabled={disabled}><Download size={15} aria-hidden="true" />CSV で書き出す</Button>
      </div>
      {children ? children(overview) : <RoutesTable overview={overview} clicks={clicks} />}
    </div>
  </>
}

function RoutesTable({ overview, clicks }: { overview: AnalyticsRoutesOverview['data']; clicks: number | null }) {
  const friends = metricSum(overview.routes.map((item) => item.friendAdds))
  const reactions = metricSum(overview.routes.map((item) => item.reactionPeople))
  const conversions = metricSum(overview.routes.map((item) => item.conversions.approved))
  const stages = [
    { label: 'リンクを押した', value: clicks, unit: '回' },
    { label: '友だちになった', value: friends, unit: '人' },
    { label: '1回でも反応した', value: reactions, unit: '人' },
    { label: '成果になった', value: conversions, unit: '件' },
  ]
  return <div className={styles.routesSplit}>
    <section className={styles.flowCard} aria-labelledby="routes-flow-title">
      <h2 id="routes-flow-title" className={styles.hoursTitle}>全体の流れ</h2>
      {stages.map((stage, index) => {
        const previous = index > 0 ? stages[index - 1].value : null
        const rate = previous && stage.value !== null ? `前段の ${(stage.value / previous * 100).toFixed(1)}%` : undefined
        return <div key={stage.label} className={styles.routeRow} title={rate}>
          <div className={styles.sideRow}><span className={styles.flowLabel}>{stage.label}</span><strong className={styles.sideValue}>{stage.value === null ? '—' : `${formatNumber(stage.value)} ${stage.unit}`}</strong></div>
          <div className={styles.track} data-size="flow" aria-hidden="true"><span style={{ width: stage.value !== null && clicks ? `${Math.min(100, stage.value / clicks * 100)}%` : '0%' }} /></div>
        </div>
      })}
    </section>
    <div className={styles.routesMain}>
      <div className={styles.table} role="table" aria-label="経路ごとの成果">
        <div className={styles.thead} role="row">
          <span role="columnheader" className={styles.colMain}>経路</span>
          <span role="columnheader" className={styles.num} data-w="70">友だち</span>
          <span role="columnheader" className={styles.num} data-w="70">反応</span>
          <span role="columnheader" className={styles.num} data-w="70">成果</span>
          <span role="columnheader" className={styles.num} data-w="100">売上</span>
          <span role="columnheader" className={styles.num} data-w="100">かかった費用</span>
          <span role="columnheader" className={styles.num} data-w="100">差し引き</span>
        </div>
        {overview.routes.length === 0
          ? <div className={styles.emptyRow} role="row"><span role="cell">この期間に集計できる経路はありません</span></div>
          : overview.routes.map((item) => <div key={item.id} className={styles.trow} role="row" data-h="one">
            <span role="cell" className={styles.colMain} title={`${item.refCode ? `流入と計測 ／ ref=${item.refCode}` : '参照コードなし'} ／ クリック ${metricText(item.clicks)}`}><span className={styles.cellText}>{item.name}</span></span>
            <span role="cell" className={styles.num} data-w="70" title={`現在 ${metricText(item.currentFriends)}`}><MetricText metric={item.friendAdds} /></span>
            <span role="cell" className={styles.num} data-w="70"><MetricText metric={item.reactionPeople} /></span>
            <span role="cell" className={styles.num} data-w="70" title={`保留 ${metricText(item.conversions.pending)}・却下 ${metricText(item.conversions.rejected)}`}><MetricText metric={item.conversions.approved} /></span>
            <span role="cell" className={styles.num} data-w="100">{shownValue(item.conversions.revenue) === null ? <span className={styles.faint} title={item.conversions.revenue.reason ?? undefined}>売上は未取得</span> : <span>{yen(shownValue(item.conversions.revenue))}</span>}</span>
            <span role="cell" className={styles.num} data-w="100" title={`友だち1人 ${metricText(item.costPerFriend, { currency: true })}・成果1件 ${metricText(item.costPerConversion, { currency: true })}`}>{shownValue(item.adCost) === null ? <span className={styles.faint} title={item.adCost.reason ?? undefined}>—</span> : <span>{yen(shownValue(item.adCost))}</span>}</span>
            <span role="cell" className={styles.num} data-w="100">{shownValue(item.profitAfterAdCost) === null ? <span className={styles.faint} title={item.profitAfterAdCost.reason ?? undefined}>—</span> : <span>{yen(shownValue(item.profitAfterAdCost), true)}</span>}</span>
          </div>)}
      </div>
      <p className={styles.caption}>{`「—」は費用を取得できない経路です。広告とのつなぎで費用を取り込むと出ます。0として差し引きを計算していません（帰属は「${overview.attributionLabel}」）。`}</p>
    </div>
  </div>
}

export default function RoutesV8({ accountId }: { accountId: string }) {
  return <RoutesFrame accountId={accountId} />
}
