'use client'

import { ValueBarChart, LineChart, FunnelChart } from '@/components/shared/charts'

/*
 * ★V8 Googleビジネス パフォーマンス（`SrmVs`）。
 * 数4（共通の KpiCard）→ 飲食店向け指標 → 注。期間は 7／28／90 日（今の画面と同じ口・既定28日）。
 * 表示数の推移（今の画面の棒グラフ）は、帯の下の「表示数の推移を見る」で開閉する。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Eye, MapPin, MousePointerClick, Phone } from 'lucide-react'
import Button from '@/components/shared/button'
import Card from '@/components/shared/card'
import SectionHeader from '@/components/shared/section-header'
import KpiBand from '@/components/shared/kpi-band'
import SegmentedControl from '@/components/shared/segmented'
import { RowMenu } from '@/components/shared/row-actions'
import PeriodPicker from '@/components/shared/period-picker'
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
import { formatDate as polishFormatDate, formatNumber as polishFormatNumber } from '@/lib/format'


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
  return polishFormatDate(isoDate, { style: 'list-day', fallback: '—' })
}

function ImpressionsChart({ data }: { data: GooglePerformanceData }) {
  const buckets = useMemo(() => bucketDaily(data.daily, data.days), [data])
  const max = Math.max(...buckets.map((bucket) => bucket.total ?? 0), 1)
  if (!buckets.some((bucket) => bucket.total !== null)) {
    return <ListState kind="empty" title="表示数のデータがまだありません" description="夜間の自動取得のあとに表示されます。" />
  }
  return <ValueBarChart label={`プロフィール表示の推移（${BUCKET_LABELS[data.days]}の合計）`} unit="回" items={buckets.map(bucket=>({key:bucket.startDate,label:bucket.startDate,value:bucket.total}))} />
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
        <PeriodPicker days={days} onChange={(value) => setDays(value as GooglePerformanceDays)} supportedDays={DAYS} />
      </div>
      {loading && !data ? <div className={styles.stateBox}><ListState kind="loading" title="パフォーマンスを読み込んでいます" /></div> : null}
      {loadError ? <ListState kind="error" title="パフォーマンスを表示できませんでした" description={loadError} onRetry={() => void load()} /> : null}
      {data ? (
        <>
          {data.lastMetricsSyncedAt === null ? <Notice tone="info">パフォーマンスの自動取得はまだ実行されていません。毎晩の取得のあとに数値が表示されます。</Notice> : null}
          <KpiBand presentation="band" gridClassName="">
            {METRICS.map(({ key, title, icon: Icon }) => (
              <KpiCard
                key={key}
                presentation="band"
                title={title}
                icon={<Icon aria-hidden className={styles.icon13} />}
                value={data.totals[key]}
                unit="回"
                detail={compareText(data.days, data.totals[key], data.previousTotals[key])}
                help={key === 'callClicks' ? '電話ボタンが押された数です。通話が成立した数ではありません。' : undefined}
              />
            ))}
          </KpiBand>
          <Button onClick={() => setShowTrend((current) => !current)} aria-expanded={showTrend}>表示数の推移を見る</Button>
          <Card appearance="outlined" layout="vertical" padding="default" gap="normal">
            <SectionHeader size="small" title={<>飲食店向け指標</>} />
            <dl className={styles.facts}>
              <div className={styles.factRow}><dt className={styles.factKey}>予約ボタンのクリック</dt><dd className={styles.factValue}>{data.food.bookings === null ? '—（連携サービス未対応）' : `${polishFormatNumber(data.food.bookings)} 回`}</dd></div>
              <div className={styles.factRow}><dt className={styles.factKey}>メニューの閲覧</dt><dd className={styles.factValue}>{data.food.menuClicks === null ? '—（対象機能を使っている店舗のみ）' : `${polishFormatNumber(data.food.menuClicks)} 回`}</dd></div>
              <div className={styles.factRow}><dt className={styles.factKey}>料理の写真の閲覧</dt><dd className={styles.factValue}>—（未取得）</dd></div>
            </dl>
            <p className={styles.grayNote}>数字は Google ビジネス プロフィールの集計です（前日までの分。2〜3日遅れることがあります）。</p>
          </Card>
          {showTrend ? (
            <Card appearance="outlined" layout="vertical" padding="default" gap="normal" aria-label="プロフィール表示の推移">
              <div className={styles.cardHead}>
                <SectionHeader size="small" title={<>プロフィール表示の推移</>} />
                <span className={styles.spacer} aria-hidden="true" />
                <span className={styles.muted}>{`■ 表示数 / ${BUCKET_LABELS[data.days]}の合計・${range}`}</span>
                <Button variant="text" onClick={() => setShowTrend(false)}>閉じる</Button>
              </div>
              <ImpressionsChart data={data} />
            </Card>
          ) : null}
        </>
      ) : null}
    </>
  )
}
