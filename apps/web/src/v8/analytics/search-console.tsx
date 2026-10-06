'use client'

/*
 * ★V8 Search Console（Pencil `h1G4d`・`/search-console`）。
 * 板の頭（CSV）→ 数の帯（合計クリック数・合計表示回数・平均CTR・平均掲載順位）→ 道具の段
 * （対象プロパティ・連携中・期間・連携を設定）→ 検索クリックの推移 → キーワード・ページ上位・デバイス別 → 見かたの注意。
 * つないでいないとき・閲覧権限が無いときは設定の案内。
 * 呼ぶ口（`api.searchConsole.performance(days)`）・403 とそれ以外の失敗の言い分け・CSV は今の画面（app/search-console/page.tsx）と同じ。
 */
import { useEffect, useState } from 'react'
import { Download, Eye, ListOrdered, MousePointerClick, Percent, SlidersHorizontal } from 'lucide-react'
import { ListPage } from '@/components/templates'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import SegmentedControl from '@/components/shared/segmented'
import Select from '@/components/shared/select'
import { DelayedSkeleton, Skeleton } from '@/components/shared/skeleton'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { api, ApiError, type SearchConsoleMetric, type SearchConsoleMetricRow, type SearchConsolePerformance, type SearchConsoleSetup } from '@/lib/api'
import { csvCell } from '@/lib/presentation'
import { formatDateTime, formatNumber } from '@/lib/format'
import { KpiMenu, StatePill, shortDay } from './common'
import styles from './analytics.module.css'

const RANGES = [7, 28, 90] as const
type RangeDays = typeof RANGES[number]
const DEVICE_LABELS: Record<string, string> = { MOBILE: 'スマートフォン', DESKTOP: 'パソコン', TABLET: 'タブレット' }

function pagePath(key: string) {
  try { const url = new URL(key); return `${url.pathname}${url.search}` || '/' } catch { return key }
}

function Ranking({ title, rows, kind }: { title: string; rows: SearchConsoleMetricRow[]; kind: 'query' | 'page' }) {
  return <section className={styles.funnelFlow} aria-label={title}>
    <h2 className={styles.hoursTitle}>{title}</h2>
    {rows.length === 0 ? <p className={styles.caption}>データがありません</p> : <div className={styles.table} role="table" aria-label={title} data-kind={kind}>
      <div className={styles.thead} role="row" data-size="compact">
        <span role="columnheader" className={styles.colMain}>{kind === 'query' ? 'キーワード' : 'ページ'}</span>
        <span role="columnheader" className={styles.num} data-w="sc60">クリック</span>
        <span role="columnheader" className={styles.num} data-w="sc70">表示回数</span>
        <span role="columnheader" className={styles.num} data-w="sc64">掲載順位</span>
      </div>
      {rows.map((row) => <div key={row.key} className={styles.trow} role="row" data-size="compact">
        <span role="cell" className={styles.colMain}><span className={styles.cellText} title={row.key}>{kind === 'query' ? (row.key || '（検索語句なし）') : pagePath(row.key)}</span></span>
        <span role="cell" className={styles.num} data-w="sc60"><span title={`CTR ${formatNumber(row.ctr * 100, { digits: 1 })}%`}>{formatNumber(row.clicks)}</span></span>
        <span role="cell" className={styles.num} data-w="sc70"><span>{formatNumber(row.impressions)}</span></span>
        <span role="cell" className={styles.num} data-w="sc64"><span>{formatNumber(row.position, { digits: 1 })}</span></span>
      </div>)}
    </div>}
  </section>
}

function SetupCard({ setup, denied }: { setup: SearchConsoleSetup | null; denied: boolean }) {
  return <section className={styles.flowCard} data-w="full" aria-labelledby="sc-setup-title">
    <h2 id="sc-setup-title" className={styles.hoursTitle}>{denied ? '閲覧権限の確認が必要です' : 'Search Consoleとつなぐ設定'}</h2>
    <p className={styles.observation}>Search Consoleで対象プロパティを開き、サービスアカウントを「制限付きユーザー」として追加すると、検索データを読み取り専用で表示できます。</p>
    <div className={styles.compareRow}><span className={styles.flowLabel} data-size="row">対象プロパティ</span><span className={styles.spacer} /><strong title={setup?.siteUrl ?? ''}>{setup?.siteUrl ?? '未設定'}</strong></div>
    <div className={styles.compareRow}><span className={styles.flowLabel} data-size="row">追加するアカウント</span><span className={styles.spacer} /><strong title={setup?.serviceAccountEmail ?? ''}>{setup?.serviceAccountEmail ?? '未設定'}</strong></div>
  </section>
}

export default function SearchConsoleV8() {
  usePageTitle('Search Console')
  usePageCrumbs([{ label: 'ホーム', href: '/' }, { label: '分析', href: '/analytics' }])
  const [days, setDays] = useState<RangeDays>(28)
  const [data, setData] = useState<SearchConsolePerformance | null>(null)
  const [setup, setSetup] = useState<SearchConsoleSetup | null>(null)
  const [loading, setLoading] = useState(true)
  const [denied, setDenied] = useState(false)
  // 403（Google 側の閲覧権限なし）だけ権限の案内にし、通信断・500・429・success:false は失敗と読み直しを出す。
  const [loadError, setLoadError] = useState<unknown>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true); setDenied(false); setLoadError(null)
    api.searchConsole.performance(days).then((response) => {
      if (!active) return
      if (!response.success) { setData(null); setSetup(null); setLoadError(new Error('search console load failed')); return }
      if (response.data.status === 'connected') { setData(response.data); setSetup(null) } else { setData(null); setSetup(response.data) }
    }).catch((caught: unknown) => {
      if (!active) return
      setData(null); setSetup(null)
      if (caught instanceof ApiError && caught.status === 403) setDenied(true)
      else setLoadError(caught)
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [days, attempt])

  const metrics: Array<{ label: string; key: keyof SearchConsoleMetric; unit: string; help: string; icon: typeof MousePointerClick }> = [
    { label: '合計クリック数', key: 'clicks', unit: '回', help: 'クリック ÷ 表示回数', icon: MousePointerClick },
    { label: '合計表示回数', key: 'impressions', unit: '回', help: 'Google検索の結果に表示された回数です', icon: Eye },
    { label: '平均CTR', key: 'ctr', unit: '%', help: 'クリック ÷ 表示回数', icon: Percent },
    { label: '平均掲載順位', key: 'position', unit: '位', help: '平均値。人や場所で変わる', icon: ListOrdered },
  ]
  const exportCsv = () => {
    if (!data) return
    const lines: string[][] = [
      ['区分', '項目', '表示回数', 'クリック数', 'CTR(%)', '掲載順位'],
      ['集計', `合計（${data.startDate}〜${data.endDate}）`, String(data.summary.impressions), String(data.summary.clicks), formatNumber(data.summary.ctr * 100, { digits: 1 }), formatNumber(data.summary.position, { digits: 1 })],
      ...data.daily.map((row) => ['日別', row.key, '', String(row.clicks), '', '']),
      ...data.devices.map((device) => ['デバイス', DEVICE_LABELS[device.key] ?? device.key, '', String(device.clicks), '', '']),
      ...data.queries.map((row) => ['キーワード', row.key || '（検索語句なし）', String(row.impressions), String(row.clicks), formatNumber(row.ctr * 100, { digits: 1 }), formatNumber(row.position, { digits: 1 })]),
      ...data.pages.map((row) => ['ページ', row.key, String(row.impressions), String(row.clicks), formatNumber(row.ctr * 100, { digits: 1 }), formatNumber(row.position, { digits: 1 })]),
    ]
    const csv = lines.map((row) => row.map((value) => csvCell(value)).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `search-console-${data.startDate}_${data.endDate}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }
  const settingsSiteUrl = data?.siteUrl ?? setup?.siteUrl
  const settingsHref = settingsSiteUrl ? `https://search.google.com/search-console/users?resource_id=${encodeURIComponent(settingsSiteUrl)}` : null
  const periodControl = <SegmentedControl aria-label="集計期間" value={String(days)} options={RANGES.map((range) => ({ value: String(range), label: `${range}日` }))} onChange={(value) => setDays(Number(value) as RangeDays)} />
  const settingsButton = settingsHref ? <Button variant="secondary" href={settingsHref} target="_blank" rel="noreferrer"><SlidersHorizontal size={15} aria-hidden="true" />連携を設定</Button> : null
  const maxDaily = Math.max(1, ...(data?.daily ?? []).map((row) => row.clicks))
  const middle = data ? data.daily[Math.floor(data.daily.length / 2)] : null

  return <ListPage
    boardId="h1G4d"
    title="Search Console"
    description={<span className={styles.description}>Google の検索から、どのキーワード・どのページで人が来たかを見ます。サイトスクリプトとつなぐと、検索から友だち追加までを結べます。</span>}
    actions={<Button variant="secondary" onClick={exportCsv} disabled={!data || loading}><Download size={15} aria-hidden="true" />CSV で書き出す</Button>}
  >
    {loading ? <div className={styles.body} data-gap="tab"><DelayedSkeleton loading skeleton={<Skeleton className="block h-36 w-full rounded-card" />} /></div>
      : loadError ? <div className={styles.body} data-gap="tab"><ListState kind="error" error={loadError} onRetry={() => setAttempt((current) => current + 1)} /></div>
      : !data ? <div className={styles.body} data-gap="tab">
        <div className={styles.toolbar}>{periodControl}<span className={styles.spacer} />{settingsButton}</div>
        <p className={styles.noteBox}>Search Console をつなぐと、検索からの流入が見られます。</p>
        <SetupCard setup={setup} denied={denied} />
      </div>
      : <>
        <KpiBand className={styles.band}>
          {metrics.map((item) => {
            const value = data.summary[item.key] * (item.key === 'ctr' ? 100 : 1)
            const previous = data.previousSummary[item.key] * (item.key === 'ctr' ? 100 : 1)
            const difference = value - previous
            const detail = item.key === 'clicks' || item.key === 'impressions' ? `前の${data.rangeDays}日より ${difference >= 0 ? '+' : ''}${formatNumber(difference)}` : item.help
            return <KpiCard key={item.key} presentation="band" title={item.label} icon={<item.icon size={13} aria-hidden="true" />} menu={<KpiMenu title={item.label} onExport={exportCsv} disabled={false} />} value={Math.round(value * 10) / 10} unit={item.unit} detail={detail} />
          })}
        </KpiBand>
        <div className={styles.body} data-gap="tab">
          <div className={styles.controls} data-gap="narrow">
            <label className={styles.field} data-w="property"><span className={styles.fieldLabel}>対象プロパティ</span>
              <Select id="search-property" aria-label="対象プロパティ" size="full" value={data.siteUrl} disabled onChange={() => {}} options={[{ value: data.siteUrl, label: data.siteUrl }]} />
            </label>
            <span className={styles.pillSlot}><StatePill tone="ok">連携中</StatePill></span>
            {periodControl}
            <span className={styles.spacer} />
            {settingsButton}
          </div>
          <section className={styles.flowCard} data-w="full" aria-labelledby="sc-trend-title">
            <h2 id="sc-trend-title" className={styles.hoursTitle}>検索クリックの推移（日別クリック数）</h2>
            {data.daily.length === 0 ? <ListState kind="empty" title="期間内のデータがありません" description="集計期間を変えると、ここに推移が出ます。" /> : <>
              <div className={styles.hourBars} role="img" aria-label="日別クリック数の推移">{data.daily.map((row) => <span key={row.key} className={styles.hourBar} data-empty={row.clicks === 0 || undefined} title={`${row.key}：${formatNumber(row.clicks)}クリック`} style={{ height: `${Math.max(2, row.clicks / maxDaily * 100)}%` }} />)}</div>
              <div className={styles.scAxis}><span>{shortDay(data.daily[0].key)}</span><span>{middle ? shortDay(middle.key) : ''}</span><span>{`${shortDay(data.daily[data.daily.length - 1].key)}（反映待ち）`}</span></div>
            </>}
          </section>
          <div className={styles.routesSplit}>
            <Ranking title="検索キーワード 上位10件" rows={data.queries} kind="query" />
            <Ranking title="検索流入ページ 上位10件" rows={data.pages} kind="page" />
            <section className={styles.funnelSide} data-w="devices" aria-labelledby="sc-devices-title">
              <h2 id="sc-devices-title" className={styles.hoursTitle}>デバイス別</h2>
              {data.devices.map((device) => {
                const ratio = data.summary.clicks ? device.clicks / data.summary.clicks * 100 : 0
                const label = DEVICE_LABELS[device.key] ?? device.key
                return <div key={device.key} className={styles.compareRow} title={`${label}：${ratio.toFixed(1)}%`}><span className={styles.flowLabel} data-size="row">{label}</span><span className={styles.spacer} /><strong data-weight="bold">{formatNumber(device.clicks)}</strong></div>
              })}
            </section>
          </div>
          <p className={styles.noteBox} title={`集計期間 ${data.startDate}〜${data.endDate} ／ 読み取り専用で取得・最終更新 ${formatDateTime(data.fetchedAt)}`}>見かたの注意：Search Console のデータは反映まで2〜3日かかります。直近の数字は出ません。掲載順位は平均値です。「検索から友だち追加」はサイトスクリプトで結びついた分だけを数えるものですが、その突き合わせはまだありません。</p>
        </div>
      </>}
  </ListPage>
}
