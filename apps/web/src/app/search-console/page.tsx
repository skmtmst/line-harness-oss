'use client'

import { useEffect, useState } from 'react'
import Header from '@/components/layout/header'
import MergedTabs from '@/components/layout/merged-tabs'
import { api } from '@/lib/api'
import type {
  SearchConsoleMetric,
  SearchConsoleMetricRow,
  SearchConsolePerformance,
  SearchConsoleSetup,
} from '@/lib/api'

/**
 * 検索からの流入（設計 V2 6-11）。
 *
 * 設計では「分析」の5タブのうちの1枚。実体だけ別ルートに残っているので、
 * 同じタブの帯をここにも出して、行き来できるようにしてある。
 */
const ANALYTICS_TABS = [
  { key: 'messages', label: '送信数' },
  { key: 'funnel', label: 'ファネル' },
  { key: 'cross', label: 'クロス集計' },
  { key: 'clicks', label: 'URLクリック' },
  { key: 'search', label: '検索からの流入', href: '/search-console' },
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
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="whitespace-nowrap text-sm font-medium text-slate-500">{label}</p>
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
      </div>
      <p className="mt-3 whitespace-nowrap text-3xl font-bold tracking-tight text-slate-950">{value}</p>
      <p className={`mt-2 whitespace-nowrap text-xs font-semibold ${delta === null ? 'text-slate-400' : positive ? 'text-emerald-600' : 'text-rose-500'}`}>
        {delta === null ? '前期間との比較なし' : `${positive ? '↑' : '↓'} ${oneDecimal.format(Math.abs(delta))}% 前期間比`}
      </p>
    </div>
  )
}

function TrendChart({ rows }: { rows: SearchConsoleMetricRow[] }) {
  if (rows.length === 0) {
    return <div className="flex h-64 items-center justify-center text-sm text-slate-400">期間内のデータがありません</div>
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
            <stop offset="0%" stopColor="#2563eb" stopOpacity="0.24" />
            <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75, 1].map((ratio) => (
          <line key={ratio} x1="0" x2={width} y1={height * ratio} y2={height * ratio} stroke="#e2e8f0" strokeWidth="1" />
        ))}
        <polygon points={fillPoints} fill="url(#searchClickArea)" />
        <polyline points={points} fill="none" stroke="#2563eb" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="flex justify-between text-[11px] text-slate-400">
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
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="whitespace-nowrap text-base font-bold text-slate-900">{title}</h2>
      </div>
      {rows.length === 0 ? (
        <p className="p-8 text-center text-sm text-slate-400">データがありません</p>
      ) : (
        <table className="w-full table-fixed text-xs">
          <colgroup><col className="w-[43%]" /><col className="w-[16%]" /><col className="w-[14%]" /><col className="w-[13%]" /><col className="w-[14%]" /></colgroup>
          <thead className="bg-slate-50 text-[11px] font-semibold text-slate-500">
            <tr><th className="px-4 py-3 text-left">{kind === 'query' ? 'キーワード' : 'ページ'}</th><th className="px-2 py-3 text-right">表示回数</th><th className="px-2 py-3 text-right">クリック</th><th className="px-2 py-3 text-right">CTR</th><th className="px-4 py-3 text-right">掲載順位</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.key} className="hover:bg-slate-50/70">
                <td className="px-4 py-3"><span className="block truncate whitespace-nowrap font-medium text-slate-800" title={row.key}>{displayKey(row.key)}</span></td>
                <td className="whitespace-nowrap px-2 py-3 text-right text-slate-600">{number.format(row.impressions)}</td>
                <td className="whitespace-nowrap px-2 py-3 text-right font-semibold text-slate-800">{number.format(row.clicks)}</td>
                <td className="whitespace-nowrap px-2 py-3 text-right text-slate-600">{oneDecimal.format(row.ctr * 100)}%</td>
                <td className="whitespace-nowrap px-4 py-3 text-right text-slate-600">{oneDecimal.format(row.position)}</td>
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
    <div className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-6 shadow-sm">
      <div className="flex items-start gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-xl">G</div>
        <div>
          <h2 className="text-lg font-bold text-slate-900">{denied ? '閲覧権限の確認が必要です' : 'Search Consoleとの接続準備中です'}</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Search Consoleで対象プロパティを開き、サービスアカウントを「制限付きユーザー」として追加すると、検索データを読み取り専用で表示できます。
          </p>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200"><dt className="text-xs text-slate-400">対象プロパティ</dt><dd className="mt-1 truncate whitespace-nowrap font-medium text-slate-800" title={setup?.siteUrl ?? ''}>{setup?.siteUrl ?? '未設定'}</dd></div>
            <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200"><dt className="text-xs text-slate-400">追加するアカウント</dt><dd className="mt-1 truncate whitespace-nowrap font-medium text-slate-800" title={setup?.serviceAccountEmail ?? ''}>{setup?.serviceAccountEmail ?? '未設定'}</dd></div>
          </dl>
        </div>
      </div>
    </div>
  )
}

export default function SearchConsolePage() {
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
    { label: '合計クリック数', value: number.format(data?.summary.clicks ?? 0), key: 'clicks', color: '#2563eb' },
    { label: '合計表示回数', value: number.format(data?.summary.impressions ?? 0), key: 'impressions', color: '#7c3aed' },
    { label: '平均CTR', value: `${oneDecimal.format((data?.summary.ctr ?? 0) * 100)}%`, key: 'ctr', color: '#059669' },
    { label: '平均掲載順位', value: oneDecimal.format(data?.summary.position ?? 0), key: 'position', color: '#f59e0b', lower: true },
  ]

  return (
    <div>
      <div data-design="Head">
        <Header
          title="分析"
          description="Google検索でサイトがどれだけ表示され、どれだけ押されたかを見ます。Search Console から取り込んでいます。"
          action={
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
                {ranges.map((range) => (
                  <button
                    key={range}
                    onClick={() => setDays(range)}
                    className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold transition ${days === range ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
                  >
                    {range}日
                  </button>
                ))}
              </div>
              {/* 書き出しと連携の設定は、まだ受け口がない。 */}
              <button disabled title="準備中です" className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-400 opacity-60">
                CSVで書き出す
              </button>
              <button disabled title="準備中です" className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-400 opacity-60">
                連携を設定
              </button>
            </div>
          }
        />
      </div>

      <MergedTabs basePath="/analytics" tabs={ANALYTICS_TABS} active="search" />

      {loading ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{metrics.map((item) => <div key={item.label} className="h-36 animate-pulse rounded-2xl bg-slate-200/70" />)}</div>
      ) : !data ? (
        <SetupCard setup={setup} denied={denied} />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-slate-700">{siteLabel(data.siteUrl)}</span>
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">連携中</span>
              <span className="text-slate-400">Search Console のデータは反映まで2〜3日かかります</span>
            </div>
            <p className="whitespace-nowrap text-slate-400">集計期間 {data.startDate.replaceAll('-', '/')} 〜 {data.endDate.replaceAll('-', '/')}</p>
          </div>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            {metrics.map((item) => <MetricCard key={item.key} label={item.label} value={item.value} current={data.summary[item.key]} previous={data.previousSummary[item.key]} color={item.color} lowerIsBetter={item.lower} />)}
            {/* 検索で来た人がそのまま友だちになったかは、サイトスクリプトの記録と
                Search Console を突き合わせないと出ない。その突き合わせがまだ無い。 */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="whitespace-nowrap text-sm font-medium text-slate-500">検索から友だち追加</p>
              <p className="mt-3 text-3xl font-bold tracking-tight text-slate-300">—</p>
              <p className="mt-2 text-xs text-slate-400">サイトスクリプトとの突き合わせが未対応</p>
            </div>
          </div>
          <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div><h2 className="whitespace-nowrap text-base font-bold text-slate-900">検索クリックの推移</h2><p className="mt-1 text-xs text-slate-400">日別のクリック数</p></div>
              <TrendChart rows={data.daily} />
            </section>
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="whitespace-nowrap text-base font-bold text-slate-900">デバイス別</h2>
              <div className="mt-5 space-y-5">{data.devices.map((device) => { const ratio = data.summary.clicks ? (device.clicks / data.summary.clicks) * 100 : 0; const label = { MOBILE: 'スマートフォン', DESKTOP: 'パソコン', TABLET: 'タブレット' }[device.key] ?? device.key; return <div key={device.key}><div className="flex items-center justify-between gap-3 text-sm"><span className="whitespace-nowrap font-medium text-slate-700">{label}</span><span className="whitespace-nowrap text-slate-500">{number.format(device.clicks)}クリック</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.min(ratio, 100)}%` }} /></div><p className="mt-1 text-right text-[11px] text-slate-400">{oneDecimal.format(ratio)}%</p></div> })}</div>
            </section>
          </div>
          <div className="grid gap-5 xl:grid-cols-2">
            <RankingTable title="検索キーワード 上位10件" rows={data.queries} kind="query" />
            <RankingTable title="検索流入ページ 上位10件" rows={data.pages} kind="page" />
          </div>
          <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
            <h2 className="text-sm font-bold text-slate-800">見かたの注意</h2>
            <ul className="mt-2 space-y-1 text-xs leading-relaxed text-slate-500">
              <li>・Search Console のデータは反映まで2〜3日かかります。直近の数字は出ません</li>
              <li>・掲載順位は平均値です。検索する人や場所によって実際の順位は変わります</li>
              <li>・「検索から友だち追加」は、サイトスクリプトで結びついた分だけを数えるものですが、その突き合わせはまだありません</li>
            </ul>
          </section>
          <p className="text-right text-[11px] text-slate-400">Search Console APIから読み取り専用で取得・最終更新 {new Date(data.fetchedAt).toLocaleString('ja-JP')}</p>
        </div>
      )}
    </div>
  )
}
