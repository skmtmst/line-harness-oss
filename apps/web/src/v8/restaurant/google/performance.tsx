'use client'

/*
 * ★V8 Googleビジネス パフォーマンス（`SrmVs`）。
 * 数4（共通の KpiCard）→ 飲食店向け指標 → 注。期間は 7／28／90 日（今の画面と同じ口・既定28日）。
 * 表示数の推移（今の画面の棒グラフ）は、数のマスの「…」→「表示数の推移を見る」で下に開く。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Eye, MapPin, MousePointerClick, MoreHorizontal, Phone } from 'lucide-react'
import ActionMenu from '@/components/shared/action-menu'
import IconButton from '@/components/shared/icon-button'
import KpiCard from '@/components/shared/kpi-card'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import {
  restaurantGoogleApi,
  type GooglePerformanceData,
  type GooglePerformanceDays,
  type GooglePerformanceTotals,
} from '@/lib/restaurant-google-api'
import { errorMessage } from './format'
import styles from './google.module.css'

const DAYS: GooglePerformanceDays[] = [7, 28, 90]

const METRICS: Array<{ key: keyof GooglePerformanceTotals; title: string; icon: typeof Eye }> = [
  { key: 'impressions', title: 'プロフィール表示', icon: Eye },
  { key: 'directionRequests', title: 'ルート検索', icon: MapPin },
  { key: 'callClicks', title: '電話ボタンのクリック', icon: Phone },
  { key: 'websiteClicks', title: 'サイトへのクリック', icon: MousePointerClick },
]

/** 前期比「前の28日より +12%」。比べられないときは「—」。 */
export function compareText(days: number, current: number | null, previous: number | null): string {
  if (current === null || previous === null || previous === 0) return `前の${days}日より —`
  const percent = Math.round(((current - previous) / previous) * 100)
  return `前の${days}日より ${percent >= 0 ? '+' : '−'}${Math.abs(percent)}%`
}

/** 日別値を描画用の束にまとめる。7日=1日ごと、28日=2日ごと、90日=7日ごと（今の画面と同じ）。 */
export function bucketDaily(daily: Array<{ date: string; impressions: number | null }>, days: GooglePerformanceDays): Array<{ startDate: string; total: number | null }> {
  const size = days === 7 ? 1 : days === 28 ? 2 : 7
  const buckets: Array<{ startDate: string; total: number | null }> = []
  for (let index = 0; index < daily.length; index += size) {
    const slice = daily.slice(index, index + size)
    let total: number | null = null
    for (const day of slice) {
      if (day.impressions === null) continue
      total = (total ?? 0) + day.impressions
    }
    buckets.push({ startDate: slice[0].date, total })
  }
  return buckets
}

const BUCKET_LABELS: Record<GooglePerformanceDays, string> = { 7: '1日ごと', 28: '2日ごと', 90: '7日ごと' }

function shortDate(isoDate: string): string {
  const [, month, day] = isoDate.split('-')
  return `${Number.parseInt(month, 10)}/${day}`
}

function ImpressionsChart({ data }: { data: GooglePerformanceData }) {
  const buckets = useMemo(() => bucketDaily(data.daily, data.days), [data])
  const max = Math.max(...buckets.map((bucket) => bucket.total ?? 0), 1)
  if (!buckets.some((bucket) => bucket.total !== null)) {
    return <ListState kind="empty" title="表示数のデータがまだありません" description="夜間の自動取得のあとに表示されます。" />
  }
  const summary = buckets.filter((b) => b.total !== null).map((b) => `${shortDate(b.startDate)}〜 ${b.total}回`).join('、')
  return (
    <svg className={styles.chart} viewBox={`0 0 ${buckets.length * 10} 100`} preserveAspectRatio="none" role="img" aria-label={`プロフィール表示の推移（${BUCKET_LABELS[data.days]}の合計）: ${summary}`}>
      {buckets.map((bucket, index) => {
        const height = ((bucket.total ?? 0) / max) * 100
        return (
          <rect key={bucket.startDate} className={styles.chartBar} x={index * 10 + 1.5} width={7} y={100 - height} height={height}>
            <title>{`${shortDate(bucket.startDate)}〜: ${bucket.total ?? '—'}`}</title>
          </rect>
        )
      })}
    </svg>
  )
}

function MetricMenu({ title, onShowTrend }: { title: string; onShowTrend: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <span className={styles.menuBox}>
      <IconButton aria-label={`${title}の操作`} title={`${title}の操作`} aria-expanded={open} className={styles.metricMenu} onClick={() => setOpen((v) => !v)}>
        <MoreHorizontal aria-hidden className={styles.icon16} />
      </IconButton>
      <ActionMenu open={open} onClose={() => setOpen(false)} ariaLabel={`${title}の操作`} items={[{ id: 'trend', label: '表示数の推移を見る', onSelect: () => { setOpen(false); onShowTrend() } }]} />
    </span>
  )
}

export default function PerformanceBoard({ accountId }: { accountId: string }) {
  const [days, setDays] = useState<GooglePerformanceDays>(28)
  const [data, setData] = useState<GooglePerformanceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [showTrend, setShowTrend] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      setData(await restaurantGoogleApi.performance(accountId, days))
    } catch (err) {
      setData(null)
      setLoadError(errorMessage(err, 'パフォーマンスを読み込めませんでした。'))
    } finally {
      setLoading(false)
    }
  }, [accountId, days])

  useEffect(() => { void load() }, [load])

  const range = data ? `${data.range.startDate.replace(/-/g, '/')}–${data.range.endDate.slice(5).replace('-', '/')}` : ''

  return (
    <>
      <div className={styles.toolbar}>
        <p className={styles.toolbarText} title={range ? `集計期間 ${range}（日本時間）` : undefined}>Google の検索・地図でどれだけ見られたか</p>
        <div className={styles.seg} role="radiogroup" aria-label="集計期間">
          {DAYS.map((d) => (
            <button key={d} type="button" role="radio" aria-checked={days === d} className={styles.segButton} onClick={() => setDays(d)}>{`直近${d}日`}</button>
          ))}
        </div>
      </div>
      {loading && !data ? <div className={styles.stateBox}><ListState kind="loading" title="パフォーマンスを読み込んでいます" /></div> : null}
      {loadError ? <ListState kind="error" title="パフォーマンスを表示できませんでした" description={loadError} onRetry={() => void load()} /> : null}
      {data ? (
        <>
          {data.lastMetricsSyncedAt === null ? <Notice tone="info">パフォーマンスの自動取得はまだ実行されていません。毎晩の取得のあとに数値が表示されます。</Notice> : null}
          <div className={styles.metrics}>
            {METRICS.map(({ key, title, icon: Icon }) => (
              <KpiCard
                key={key}
                className={styles.metric}
                title={title}
                icon={<Icon aria-hidden className={styles.icon13} />}
                menu={<MetricMenu title={title} onShowTrend={() => setShowTrend(true)} />}
                value={data.totals[key]}
                unit="回"
                detail={compareText(data.days, data.totals[key], data.previousTotals[key])}
                help={key === 'callClicks' ? '電話ボタンが押された数です。通話が成立した数ではありません。' : undefined}
              />
            ))}
          </div>
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>飲食店向け指標</h2>
            <dl className={styles.facts}>
              <div className={styles.factRow}><dt className={styles.factKey}>予約ボタンのクリック</dt><dd className={styles.factValue}>{data.food.bookings === null ? '—（連携サービス未対応）' : `${data.food.bookings.toLocaleString('ja-JP')} 回`}</dd></div>
              <div className={styles.factRow}><dt className={styles.factKey}>メニューの閲覧</dt><dd className={styles.factValue}>{data.food.menuClicks === null ? '—（対象機能を使っている店舗のみ）' : `${data.food.menuClicks.toLocaleString('ja-JP')} 回`}</dd></div>
              <div className={styles.factRow}><dt className={styles.factKey}>料理の注文</dt><dd className={styles.factValue}>{data.food.foodOrders === null ? '—（連携サービス未対応）' : `${data.food.foodOrders.toLocaleString('ja-JP')} 回`}</dd></div>
            </dl>
            <p className={styles.grayNote}>数字は Google ビジネス プロフィールの集計です（前日までの分。2〜3日遅れることがあります）。</p>
          </section>
          {showTrend ? (
            <section className={styles.card} aria-label="プロフィール表示の推移">
              <div className={styles.cardHead}>
                <h2 className={styles.cardTitle}>プロフィール表示の推移</h2>
                <span className={styles.spacer} aria-hidden="true" />
                <span className={styles.muted}>{`■ 表示数 / ${BUCKET_LABELS[data.days]}の合計・${range}`}</span>
                <button type="button" className={styles.textButton} onClick={() => setShowTrend(false)}>閉じる</button>
              </div>
              <ImpressionsChart data={data} />
            </section>
          ) : null}
        </>
      ) : null}
    </>
  )
}
