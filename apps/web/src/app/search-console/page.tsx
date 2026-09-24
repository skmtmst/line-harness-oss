'use client'

import { useEffect, useState } from 'react'
import MergedTabs from '@/components/layout/merged-tabs'
import StatusBadge from '@/components/shared/status-badge'
import { api } from '@/lib/api'
import type {
  SearchConsoleMetric,
  SearchConsoleMetricRow,
  SearchConsolePerformance,
  SearchConsoleSetup,
} from '@/lib/api'
import { usePageTitle } from '@/components/shell/page-chrome'

/**
 * Google検索の分析画面（設計 V2 6-11）。タブ表記は利用者指定のGoogle Analytics。
 *
 * 設計では「分析」の5タブのうちの1枚。実体だけ別ルートに残っているので、
 * 同じタブの帯をここにも出して、行き来できるようにしてある。
 */
const ANALYTICS_TABS = [
  { key: 'messages', label: '送信数' },
  { key: 'funnel', label: 'ファネル' },
  { key: 'cross', label: 'クロス集計' },
  { key: 'clicks', label: 'URLクリック' },
  { key: 'search', label: 'Google Analytics', href: '/search-console' },
]

const ranges = [7, 28, 90] as const
type RangeDays = typeof ranges[number]

const number = new Intl.NumberFormat('ja-JP')
const oneDecimal = new Intl.NumberFormat('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** プロパティのURLから、見出しに出すホスト名だけを取り出す。 */
function siteLabel(siteUrl: string): string {
  try {
    return new URL(siteUrl.replace(/^sc-domain:/, 'https://')).host
  } catch {
    return siteUrl
  }
}

function percentDelta(current: number, previous: number, lowerIsBetter = false) {
  if (previous === 0) return null
  const raw = ((current - previous) / Math.abs(previous)) * 100
  return lowerIsBetter ? -raw : raw
}

function MetricCard({
  label,
  value,
  current,
  previous,
  color,
  lowerIsBetter = false,
}: {
  label: string
  value: string
  current: number
  previous: number
  color: string
  lowerIsBetter?: boolean
}) {
  const delta = percentDelta(current, previous, lowerIsBetter)
  const positive = delta !== null && delta >= 0
  return (
    <div className="rounded-card border-hairline border bg-canvas p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-ink-secondary whitespace-nowrap text-sm font-medium">{label}</p>
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
      </div>
      <p className="text-ink mt-3 whitespace-nowrap text-3xl font-bold tabular-nums tracking-[-0.02em]">{value}</p>
      <p className={`mt-2 whitespace-nowrap text-xs font-semibold ${delta === null ? 'text-ink-faint' : positive ? 'text-success' : 'text-danger'}`}>
        {delta === null ? '前期間との比較なし' : `${positive ? '↑' : '↓'} ${oneDecimal.format(Math.abs(delta))}% 前期間比`}
      </p>
    </div>
  )
}

function TrendChart({ rows }: { rows: SearchConsoleMetricRow[] }) {
  if (rows.length === 0) {
    return <div className="text-ink-faint flex h-64 items-center justify-center text-sm">期間内のデータがありません</div>
  }
  const width = 1000
  const height = 240
  const max = Math.max(...rows.map((row) => row.clicks), 1)
  const points = rows.map((row, index) => {
    const x = rows.length === 1 ? width / 2 : (index / (rows.length - 1)) * width
    const y = height - (row.clicks / max) * (height - 35) - 15
    return `${x},${y}`
  }).join(' ')
  const fillPoints = `0,${height} ${points} ${width},${height}`
  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-64 w-full" role="img" aria-label="日別クリック数の推移">
        <defs>
          <linearGradient id="searchClickArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-action)" stopOpacity="0.24" />
            <stop offset="100%" stopColor="var(--color-action)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75, 1].map((ratio) => (
          <line key={ratio} x1="0" x2={width} y1={height * ratio} y2={height * ratio} stroke="var(--color-hairline)" strokeWidth="1" />
        ))}
        <polygon points={fillPoints} fill="url(#searchClickArea)" />
        <polyline points={points} fill="none" stroke="var(--color-action)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="text-ink-faint flex justify-between text-[11px]">
        <span>{rows[0]?.key.replaceAll('-', '/')}</span>
        <span>{rows.at(-1)?.key.replaceAll('-', '/')}</span>
      </div>
    </div>
  )
}

function RankingTable({ title, rows, kind }: { title: string; rows: SearchConsoleMetricRow[]; kind: 'query' | 'page' }) {
  const displayKey = (key: string) => {
    if (kind === 'query') return key || '（検索語句なし）'
    try {
      const url = new URL(key)
      return `${url.pathname}${url.search}` || '/'
    } catch {
      return key
    }
  }
  return (
    <section className="rounded-card border-hairline overflow-hidden border bg-canvas">
      <div className="border-hairline border-b px-5 py-4">
        <h2 className="text-ink whitespace-nowrap text-base font-bold">{title}</h2>
      </div>
      {rows.length === 0 ? (
        <p className="text-ink-faint p-8 text-center text-sm">データがありません</p>
      ) : (
        <table className="w-full table-fixed text-xs">
          <colgroup><col className="w-[43%]" /><col className="w-[16%]" /><col className="w-[14%]" /><col className="w-[13%]" /><col className="w-[14%]" /></colgroup>
          <thead className="bg-canvas-sunken text-ink-faint text-[11px] font-semibold">
            <tr><th className="px-4 py-3 text-left">{kind === 'query' ? 'キーワード' : 'ページ'}</th><th className="px-2 py-3 text-right">表示回数</th><th className="px-2 py-3 text-right">クリック</th><th className="px-2 py-3 text-right">CTR</th><th className="px-4 py-3 text-right">掲載順位</th></tr>
          </thead>
          <tbody className="divide-hairline divide-y">
            {rows.map((row) => (
              <tr key={row.key} className="hover:bg-canvas-sunken">
                <td className="px-4 py-3"><span className="text-ink block truncate whitespace-nowrap font-medium" title={row.key}>{displayKey(row.key)}</span></td>
                <td className="text-ink-secondary whitespace-nowrap px-2 py-3 text-right">{number.format(row.impressions)}</td>
                <td className="text-ink whitespace-nowrap px-2 py-3 text-right font-semibold">{number.format(row.clicks)}</td>
                <td className="text-ink-secondary whitespace-nowrap px-2 py-3 text-right">{oneDecimal.format(row.ctr * 100)}%</td>
                <td className="text-ink-secondary whitespace-nowrap px-4 py-3 text-right">{oneDecimal.format(row.position)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function SetupCard({ setup, denied = false }: { setup: SearchConsoleSetup | null; denied?: boolean }) {
  return (
    <div className="rounded-card border-hairline bg-status-warn-soft border p-6">
      <div className="flex items-start gap-4">
        <div className="border-hairline flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border bg-canvas text-xl">G</div>
        <div>
          <h2 className="text-ink text-lg font-bold">{denied ? '閲覧権限の確認が必要です' : 'Search Consoleとつなぐ設定'}</h2>
          <p className="text-ink-secondary mt-1 text-sm leading-6">
            Search Consoleで対象プロパティを開き、サービスアカウントを「制限付きユーザー」として追加すると、検索データを読み取り専用で表示できます。
          </p>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div className="border-hairline rounded-xl border bg-canvas p-3"><dt className="text-ink-faint text-xs">対象プロパティ</dt><dd className="text-ink mt-1 truncate whitespace-nowrap font-medium" title={setup?.siteUrl ?? ''}>{setup?.siteUrl ?? '未設定'}</dd></div>
            <div className="border-hairline rounded-xl border bg-canvas p-3"><dt className="text-ink-faint text-xs">追加するアカウント</dt><dd className="text-ink mt-1 truncate whitespace-nowrap font-medium" title={setup?.serviceAccountEmail ?? ''}>{setup?.serviceAccountEmail ?? '未設定'}</dd></div>
          </dl>
        </div>
      </div>
    </div>
  )
}

export default function SearchConsolePage() {
  usePageTitle('分析')
  const [days, setDays] = useState<RangeDays>(28)
  const [data, setData] = useState<SearchConsolePerformance | null>(null)
  const [setup, setSetup] = useState<SearchConsoleSetup | null>(null)
  const [loading, setLoading] = useState(true)
  const [denied, setDenied] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    setDenied(false)
    api.searchConsole.performance(days)
      .then((response) => {
        if (!active || !response.success) return
        if (response.data.status === 'connected') {
          setData(response.data)
          setSetup(null)
        } else {
          setData(null)
          setSetup(response.data)
        }
      })
      .catch(() => { if (active) { setData(null); setDenied(true) } })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [days])

  const metrics: Array<{ label: string; value: string; key: keyof SearchConsoleMetric; color: string; lower?: boolean }> = [
    { label: '合計クリック数', value: number.format(data?.summary.clicks ?? 0), key: 'clicks', color: 'var(--color-action)' },
    { label: '合計表示回数', value: number.format(data?.summary.impressions ?? 0), key: 'impressions', color: 'var(--color-info)' },
    { label: '平均CTR', value: `${oneDecimal.format((data?.summary.ctr ?? 0) * 100)}%`, key: 'ctr', color: 'var(--color-success)' },
    { label: '平均掲載順位', value: oneDecimal.format(data?.summary.position ?? 0), key: 'position', color: 'var(--color-status-warn-deep)', lower: true },
  ]

  return (
    <div>
      <MergedTabs basePath="/analytics" tabs={ANALYTICS_TABS} active="search" />

      <div data-design="Head" className="mb-4 flex flex-wrap items-center justify-end gap-2">
        <div className="border-hairline flex rounded-xl border bg-canvas p-1">
          {ranges.map((range) => (
            <button
              key={range}
              onClick={() => setDays(range)}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold transition ${days === range ? 'bg-ink text-canvas' : 'text-ink-secondary hover:bg-canvas-sunken'}`}
            >
              {range}日
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{metrics.map((item) => <div key={item.label} className="rounded-card bg-canvas-sunken h-36 animate-pulse" />)}</div>
      ) : !data ? (
        <SetupCard setup={setup} denied={denied} />
      ) : (
        <div className="space-y-5">
          <div className="text-ink-secondary flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-ink font-medium">{siteLabel(data.siteUrl)}</span>
              <StatusBadge tone="success" size="compact">連携中</StatusBadge>
              <span className="text-ink-faint">Search Console のデータは反映まで2〜3日かかります</span>
            </div>
            <p className="text-ink-faint whitespace-nowrap">集計期間 {data.startDate.replaceAll('-', '/')} 〜 {data.endDate.replaceAll('-', '/')}</p>
          </div>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {metrics.map((item) => <MetricCard key={item.key} label={item.label} value={item.value} current={data.summary[item.key]} previous={data.previousSummary[item.key]} color={item.color} lowerIsBetter={item.lower} />)}
          </div>
          <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
            <section className="rounded-card border-hairline border bg-canvas p-5">
              <div><h2 className="text-ink whitespace-nowrap text-base font-bold">検索クリックの推移</h2><p className="text-ink-faint mt-1 text-xs">日別のクリック数</p></div>
              <TrendChart rows={data.daily} />
            </section>
            <section className="rounded-card border-hairline border bg-canvas p-5">
              <h2 className="text-ink whitespace-nowrap text-base font-bold">デバイス別</h2>
              <div className="mt-5 space-y-5">{data.devices.map((device) => { const ratio = data.summary.clicks ? (device.clicks / data.summary.clicks) * 100 : 0; const label = { MOBILE: 'スマートフォン', DESKTOP: 'パソコン', TABLET: 'タブレット' }[device.key] ?? device.key; return <div key={device.key}><div className="flex items-center justify-between gap-3 text-sm"><span className="text-ink-secondary whitespace-nowrap font-medium">{label}</span><span className="text-ink-secondary whitespace-nowrap">{number.format(device.clicks)}クリック</span></div><div className="bg-canvas-sunken mt-2 h-2 overflow-hidden rounded-full"><div className="bg-action h-full rounded-full" style={{ width: `${Math.min(ratio, 100)}%` }} /></div><p className="text-ink-faint mt-1 text-right text-[11px]">{oneDecimal.format(ratio)}%</p></div> })}</div>
            </section>
          </div>
          <div className="grid gap-5 xl:grid-cols-2">
            <RankingTable title="検索キーワード 上位10件" rows={data.queries} kind="query" />
            <RankingTable title="検索流入ページ 上位10件" rows={data.pages} kind="page" />
          </div>
          <details className="rounded-card border-hairline bg-canvas-sunken border p-5">
            <summary className="text-ink cursor-pointer text-sm font-bold">見かたの注意</summary>
            <ul className="text-ink-secondary mt-2 space-y-1 text-xs leading-relaxed">
              <li>・Search Console のデータは反映まで2〜3日かかります。直近の数字は出ません</li>
              <li>・掲載順位は平均値です。検索する人や場所によって実際の順位は変わります</li>
              <li>・「検索から友だち追加」は、サイトスクリプトで結びついた分だけを数えるものですが、その突き合わせはまだありません</li>
            </ul>
          </details>
          <p className="text-ink-faint text-right text-[11px]">Search Console APIから読み取り専用で取得・最終更新 {new Date(data.fetchedAt).toLocaleString('ja-JP')}</p>
        </div>
      )}
    </div>
  )
}
