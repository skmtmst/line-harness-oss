'use client'

import { useEffect, useState } from 'react'
import ReadonlyHeaderV8 from '../analytics/readonly-header-v8'
import '../analytics/readonly-v8.css'
import Button from '@/components/shared/button'
import { Download } from 'lucide-react'
import KpiCard from '@/components/shared/kpi-card'
import SegmentedControl from '@/components/shared/segmented'
import Select from '@/components/shared/select'
import styles from './search-console-v8.module.css'
import Disclosure from '@/components/shared/disclosure'
import NoteBar from '@/components/shared/note-bar'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import ListState from '@/components/shared/list-state'
import { DelayedSkeleton, Skeleton } from '@/components/shared/skeleton'
import StatusBadge from '@/components/shared/status-badge'
import { api, ApiError } from '@/lib/api'
import { csvCell } from '@/lib/presentation'
import type {
  SearchConsoleMetric,
  SearchConsoleMetricRow,
  SearchConsolePerformance,
  SearchConsoleSetup,
} from '@/lib/api'
import { usePageTitle, usePageCrumbs } from '@/components/shell/page-chrome'
import { useAdminTheme } from '@/lib/use-admin-theme'
import SearchConsoleV8 from '@/v8/analytics/search-console'
import { formatDateTime, formatNumber } from '@/lib/format'

/**
 * Google検索の分析画面。要件 v6-20 §2: Search Console を「Google Analytics」と呼ばない。
 *
 * 設計では「分析」の5タブのうちの1枚。実体だけ別ルートに残っているので、
 * 同じタブの帯をここにも出して、行き来できるようにしてある。
 */

const ranges = [7, 28, 90] as const
type RangeDays = typeof ranges[number]


/** プロパティのURLから、見出しに出すホスト名だけを取り出す。 */

function TrendChart({ rows }: { rows: SearchConsoleMetricRow[] }) {
  if (rows.length === 0) {
    return (
      <ListState
        kind="empty"
        title="期間内のデータがありません"
        description="集計期間を変えると、ここに推移が出ます。"
      />
    )
  }
  const max = Math.max(...rows.map((row) => row.clicks), 1)
  return <div className={styles.trend}>
    <div className={styles.bars} role="img" aria-label="日別クリック数の推移">{rows.map((row) => <div key={row.key} title={`${row.key}：${formatNumber(row.clicks)}クリック`} aria-label={`${row.key}：${formatNumber(row.clicks)}クリック`}><span style={{ height: `${row.clicks / max * 100}%` }} /></div>)}</div>
    <div className={styles.axis}><span>{rows[0]?.key.replaceAll('-', '/')}</span><span>{rows[Math.floor(rows.length / 2)]?.key.replaceAll('-', '/')}</span><span>{rows.at(-1)?.key.replaceAll('-', '/')}（反映まで2〜3日）</span></div>
  </div>
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
    <section className={styles.ranking}>
      <div className={styles.sectionHead}>
        <h2 className="text-ink whitespace-nowrap text-sm font-semibold">{title}</h2>
      </div>
      {rows.length === 0 ? (
        <p className="text-ink-faint p-8 text-center text-sm">データがありません</p>
      ) : (
        <DataTable className="rounded-none border-0">
          <thead>
            <TableHeadRow><Th style={{ width: '43%' }}>{kind === 'query' ? 'キーワード' : 'ページ'}</Th><Th style={{ width: '19%' }} align="right">クリック</Th><Th style={{ width: '20%' }} align="right">表示回数</Th><Th style={{ width: '18%' }} align="right">掲載順位</Th></TableHeadRow>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Tr key={row.key} interactive>
                <Td><span className="text-ink block truncate whitespace-nowrap font-medium" title={row.key}>{displayKey(row.key)}</span></Td>
                <Td align="right" className="text-ink whitespace-nowrap font-semibold"><span title={`CTR ${formatNumber(row.ctr * 100, { digits: 1 })}%`}>{formatNumber(row.clicks)}</span></Td>
                <Td align="right" className="text-ink-secondary whitespace-nowrap">{formatNumber(row.impressions)}</Td>
                <Td align="right" className="text-ink-secondary whitespace-nowrap">{formatNumber(row.position, { digits: 1 })}</Td>
              </Tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </section>
  )
}

function SetupCard({ setup, denied = false }: { setup: SearchConsoleSetup | null; denied?: boolean }) {
  return (
    <div className="rounded-card border-hairline bg-canvas border p-6">
      <div className="flex items-start gap-4">
        <div className="border-hairline flex h-11 w-11 shrink-0 items-center justify-center rounded-card border bg-canvas text-xl">G</div>
        <div>
          <h2 className="text-ink text-lg font-bold">{denied ? '閲覧権限の確認が必要です' : 'Search Consoleとつなぐ設定'}</h2>
          <p className="text-ink-secondary mt-1 text-sm leading-6">
            Search Consoleで対象プロパティを開き、サービスアカウントを「制限付きユーザー」として追加すると、検索データを読み取り専用で表示できます。
          </p>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div className="border-hairline rounded-card border bg-canvas p-3"><dt className="text-ink-faint text-xs">対象プロパティ</dt><dd className="text-ink mt-1 truncate whitespace-nowrap font-medium" title={setup?.siteUrl ?? ''}>{setup?.siteUrl ?? '未設定'}</dd></div>
            <div className="border-hairline rounded-card border bg-canvas p-3"><dt className="text-ink-faint text-xs">追加するアカウント</dt><dd className="text-ink mt-1 truncate whitespace-nowrap font-medium" title={setup?.serviceAccountEmail ?? ''}>{setup?.serviceAccountEmail ?? '未設定'}</dd></div>
          </dl>
        </div>
      </div>
    </div>
  )
}

function SearchConsoleCurrent() {
  usePageTitle('Search Console')
  usePageCrumbs([{ label: 'ホーム', href: '/' }, { label: '分析', href: '/analytics' }])
  const [days, setDays] = useState<RangeDays>(28)
  const [data, setData] = useState<SearchConsolePerformance | null>(null)
  const [setup, setSetup] = useState<SearchConsoleSetup | null>(null)
  const [loading, setLoading] = useState(true)
  const [denied, setDenied] = useState(false)
  /*
   * 監査 D020: 403（Google側の閲覧権限なし）だけ権限の案内カードにし、
   * 通信断・500・429・success:false は失敗の理由と再読み込みを出す。
   * 以前は catch が一律 denied にしていたため、原因と案内が食い違っていた。
   */
  const [loadError, setLoadError] = useState<unknown>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    setDenied(false)
    setLoadError(null)
    api.searchConsole.performance(days)
      .then((response) => {
        if (!active) return
        if (!response.success) {
          setData(null)
          setSetup(null)
          setLoadError(new Error('search console load failed'))
          return
        }
        if (response.data.status === 'connected') {
          setData(response.data)
          setSetup(null)
        } else {
          setData(null)
          setSetup(response.data)
        }
      })
      .catch((caught: unknown) => {
        if (!active) return
        setData(null)
        setSetup(null)
        if (caught instanceof ApiError && caught.status === 403) {
          setDenied(true)
        } else {
          setLoadError(caught)
        }
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [days, attempt])

  const metrics: Array<{ label: string; key: keyof SearchConsoleMetric; unit: string; help: string }> = [
    { label: '合計クリック数', key: 'clicks', unit: '回', help: 'Google検索の結果からサイトへ移動した回数です' },
    { label: '合計表示回数', key: 'impressions', unit: '回', help: 'Google検索の結果に表示された回数です' },
    { label: '平均CTR', key: 'ctr', unit: '%', help: 'クリック ÷ 表示回数' },
    { label: '平均掲載順位', key: 'position', unit: '位', help: '平均値。検索する人や場所で変わります' },
  ]
  const exportCsv = () => {
    if (!data) return
    const lines: string[][] = [
      ['区分', '項目', '表示回数', 'クリック数', 'CTR(%)', '掲載順位'],
      ['集計', `合計（${data.startDate}〜${data.endDate}）`, String(data.summary.impressions), String(data.summary.clicks), formatNumber(data.summary.ctr * 100, { digits: 1 }), formatNumber(data.summary.position, { digits: 1 })],
      ...data.daily.map((row) => ['日別', row.key, '', String(row.clicks), '', '']),
      ...data.devices.map((device) => ['デバイス', { MOBILE: 'スマートフォン', DESKTOP: 'パソコン', TABLET: 'タブレット' }[device.key] ?? device.key, '', String(device.clicks), '', '']),
      ...data.queries.map((row) => ['キーワード', row.key || '（検索語句なし）', String(row.impressions), String(row.clicks), formatNumber(row.ctr * 100, { digits: 1 }), formatNumber(row.position, { digits: 1 })]),
      ...data.pages.map((row) => ['ページ', row.key, String(row.impressions), String(row.clicks), formatNumber(row.ctr * 100, { digits: 1 }), formatNumber(row.position, { digits: 1 })]),
    ]
    const csv = lines.map((row) => row.map((value) => csvCell(value)).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `search-console-${data.startDate}_${data.endDate}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }
  const settingsSiteUrl = data?.siteUrl ?? setup?.siteUrl
  const settingsHref = settingsSiteUrl
    ? `https://search.google.com/search-console/users?resource_id=${encodeURIComponent(settingsSiteUrl)}`
    : null

  const periodControl = <SegmentedControl aria-label="集計期間" value={String(days)} options={ranges.map((range) => ({ value: String(range), label: `${range}日` }))} onChange={(value) => setDays(Number(value) as RangeDays)} />
  return (
    <div className={`${styles.board} v8-ro-analytics-page`} data-design-node="h1G4d">
      <ReadonlyHeaderV8 titleDisplay="always" title="Search Console" description="Googleの検索から、どのキーワード・どのページで人が来たかを見ます。検索から友だち追加への突合は未取得です。" actions={<Button variant="secondary" onClick={exportCsv} disabled={!data || loading}><Download size={14} aria-hidden="true" />CSV で書き出す</Button>} />
      {!data && <div className={styles.toolbar}>{periodControl}{settingsHref && <Button variant="secondary" href={settingsHref} target="_blank" rel="noreferrer">連携を設定</Button>}</div>}
      {loading ? (
        <DelayedSkeleton
          loading
          skeleton={
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {metrics.map((item) => <Skeleton key={item.label} className="block h-36 w-full rounded-card" />)}
            </div>
          }
        />
      ) : loadError ? (
        <ListState
          kind="error"
          error={loadError}
          onRetry={() => setAttempt((current) => current + 1)}
        />
      ) : !data ? (
        <>
          <div><NoteBar>Search Console をつなぐと、検索からの流入が見られます。</NoteBar></div>
          <SetupCard setup={setup} denied={denied} />
        </>
      ) : (
        <>
          <div className="v8-ro-analytics-kpis">
            {metrics.map((item) => {
              const value = data.summary[item.key] * (item.key === 'ctr' ? 100 : 1)
              const previous = data.previousSummary[item.key] * (item.key === 'ctr' ? 100 : 1)
              const difference = value - previous
              const detail = item.key === 'clicks' || item.key === 'impressions'
                ? `前の${data.rangeDays}日より ${difference >= 0 ? '+' : ''}${formatNumber(difference)}`
                : item.help
              return <KpiCard key={item.key} title={item.label} value={Math.round(value * 10) / 10} unit={item.unit} detail={detail} description={`${item.help}。前の${data.rangeDays}日は ${formatNumber(previous, { digits: item.key === 'ctr' || item.key === 'position' ? 1 : 0 })}${item.unit}`} />
            })}
          </div>
          <div className={styles.content}>
            <div className={styles.toolbar}><div className={styles.property}><label htmlFor="search-property">対象プロパティ</label><Select id="search-property" aria-label="対象プロパティ" value={data.siteUrl} disabled onChange={() => {}} options={[{ value: data.siteUrl, label: data.siteUrl }]} /></div><StatusBadge tone="success" size="compact">連携中</StatusBadge>{periodControl}{settingsHref && <Button variant="secondary" href={settingsHref} target="_blank" rel="noreferrer" className={styles.settings}>連携を設定</Button>}</div>
            <section className={styles.chart}><h2>検索クリックの推移（日別クリック数）</h2><TrendChart rows={data.daily} /></section>
            <div className={styles.results}>
              <RankingTable title="検索キーワード 上位10件" rows={data.queries} kind="query" />
              <RankingTable title="検索流入ページ 上位10件" rows={data.pages} kind="page" />
              <section className={styles.devices}><h2>デバイス別</h2><ul>{data.devices.map((device) => {
                const ratio = data.summary.clicks ? device.clicks / data.summary.clicks * 100 : 0
                const label = { MOBILE: 'スマートフォン', DESKTOP: 'パソコン', TABLET: 'タブレット' }[device.key] ?? device.key
                return <li key={device.key} title={`${label}：${ratio.toFixed(1)}%`}><span>{label}</span><strong>{formatNumber(device.clicks)}</strong></li>
              })}</ul></section>
            </div>
          <Disclosure title="見かたの注意" hint="3項目" size="compact">
            <ul className="text-ink-secondary space-y-1 text-xs leading-relaxed">
              <li>・Search Console のデータは反映まで2〜3日かかります。直近の数字は出ません</li>
              <li>・掲載順位は平均値です。検索する人や場所によって実際の順位は変わります</li>
              <li>・「検索から友だち追加」は、サイトスクリプトで結びついた分だけを数えるものですが、その突き合わせはまだありません</li>
            </ul>
          </Disclosure>
          <p className="text-ink-faint text-micro text-right">集計期間 {data.startDate}〜{data.endDate} ／ 読み取り専用で取得・最終更新 {formatDateTime(data.fetchedAt)}</p>
          </div>
        </>
      )}
    </div>
  )
}

/* V8 のときだけ新しい画面（src/v8/analytics/search-console.tsx）。それ以外は今の画面のまま。 */
export default function SearchConsolePage() {
  const theme = useAdminTheme()
  return theme === 'v8' ? <SearchConsoleV8 /> : <SearchConsoleCurrent />
}
