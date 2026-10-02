'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import KpiCard from '@/components/shared/kpi-card'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import Select from '@/components/shared/select'
import {
  restaurantGoogleApi,
  type GooglePerformanceData,
  type GooglePerformanceDays,
  type GooglePerformanceTotals,
} from '@/lib/restaurant-google-api'
import { errorMessage } from './google-format'

/**
 * ★V6 Googleビジネス 第4段：パフォーマンス（GB-9 Zq8DN）。
 *
 * - 数値は自前DBに毎晩取り込んだ集計値（Google提供・3〜5日遅れで確定）を出す。
 *   この画面からGoogleは呼ばない。表示は常に速い。
 * - 「未取得・未対応」は「—」で出し、0件と区別する（設計の注記どおり）。
 * - 期間は 7／28／90 日。設計の「直近28日 ▾」を Select にし、前期比も期間に追随する。
 */

export const PERFORMANCE_DESIGN_NODES: Record<string, string> = {
  performance: 'Zq8DN',
}

const DAYS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '7', label: '直近7日' },
  { value: '28', label: '直近28日' },
  { value: '90', label: '直近90日' },
]

const METRIC_CARDS: Array<{ key: keyof GooglePerformanceTotals; title: string }> = [
  { key: 'impressions', title: 'プロフィール表示' },
  { key: 'directionRequests', title: 'ルート検索' },
  { key: 'callClicks', title: '電話ボタンのクリック' },
  { key: 'websiteClicks', title: 'サイトへのクリック' },
]

function formatRange(range: { startDate: string; endDate: string }): string {
  return `${range.startDate.replace(/-/g, '/')}–${range.endDate.slice(5).replace('-', '/')}`
}

function shortDate(isoDate: string): string {
  const [, month, day] = isoDate.split('-')
  return `${Number.parseInt(month, 10)}/${day}`
}

/** 前期比の一言。どちらかが未取得、または前期が0のときは比較できないので「—」。 */
function compareText(days: number, current: number | null, previous: number | null): string {
  if (current === null || previous === null || previous === 0) return `前の${days}日比 —`
  const percent = ((current - previous) / previous) * 100
  const sign = percent >= 0 ? '+' : ''
  return `前の${days}日比 ${sign}${percent.toFixed(1)}%`
}

/** 日別値を描画用の束にまとめる。7日=1日ごと、28日=2日ごと、90日=7日ごと。 */
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

/** 単系列の棒グラフ。共通 BarChart は「増えた／減った」2系列専用なので、ここは自前で1系列を描く。 */
function ImpressionsChart({ data }: { data: GooglePerformanceData }) {
  const buckets = useMemo(() => bucketDaily(data.daily, data.days), [data])
  const max = Math.max(...buckets.map((bucket) => bucket.total ?? 0), 1)
  const hasAny = buckets.some((bucket) => bucket.total !== null)
  const axis = [buckets[0], buckets[Math.floor(buckets.length / 2)], buckets[buckets.length - 1]]

  if (!hasAny) {
    return <ListState kind="empty" title="表示数のデータがまだありません" description="夜間の自動取得のあとに表示されます。" />
  }

  const summary = buckets
    .filter((bucket) => bucket.total !== null)
    .map((bucket) => `${shortDate(bucket.startDate)}〜 ${bucket.total}回`)
    .join('、')

  return (
    <div>
      <div
        role="img"
        aria-label={`プロフィール表示の推移（${BUCKET_LABELS[data.days]}の合計）: ${summary}`}
        className="flex h-40 items-end gap-2"
      >
        {buckets.map((bucket) => (
          <div key={bucket.startDate} className="flex h-full min-w-0 flex-1 items-end" title={`${shortDate(bucket.startDate)}〜: ${bucket.total ?? '—'}`}>
            <div
              className="w-full rounded-t-mini"
              style={{
                background: 'var(--color-accent)',
                height: `${Math.max(((bucket.total ?? 0) / max) * 100, bucket.total ? 2 : 0)}%`,
              }}
            />
          </div>
        ))}
      </div>
      <div className="text-ink-faint mt-2 flex justify-between text-xs">
        <span>{shortDate(axis[0].startDate)}</span>
        <span>{shortDate(axis[1].startDate)}</span>
        <span>{shortDate(axis[2].startDate)}</span>
      </div>
    </div>
  )
}

// ---------- GB-9：パフォーマンス ----------

export function PerformanceTab({ accountId }: { accountId: string }) {
  const [days, setDays] = useState<GooglePerformanceDays>(28)
  const [data, setData] = useState<GooglePerformanceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

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

  if (loading) return <ListState kind="loading" title="パフォーマンスを読み込んでいます" />
  if (loadError || !data) return <ListState kind="error" title="パフォーマンスを表示できませんでした" description={loadError} onRetry={() => void load()} />

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold">パフォーマンス</h2>
        <div className="flex-1" />
        <Select
          aria-label="集計期間"
          value={String(data.days)}
          onChange={(value) => setDays(Number.parseInt(value, 10) as GooglePerformanceDays)}
          options={DAYS_OPTIONS}
        />
        <span className="text-ink-faint text-sm">{formatRange(data.range)}</span>
      </div>

      <p className="text-ink-secondary text-sm">Google提供の集計値です。最新データには遅れがあります。電話のクリック数は、通話成立数ではありません。</p>

      {data.lastMetricsSyncedAt === null ? (
        <NoteBar tone="info">パフォーマンスの自動取得はまだ実行されていません。毎晩の取得のあとに数値が表示されます。</NoteBar>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {METRIC_CARDS.map(({ key, title }) => (
          <KpiCard
            key={key}
            variant="v6"
            title={title}
            value={data.totals[key]}
            unit=""
            detail={compareText(data.days, data.totals[key], data.previousTotals[key])}
          />
        ))}
      </div>

      <section className="border-hairline rounded-card border p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h3 className="font-semibold">プロフィール表示の推移</h3>
          <div className="flex-1" />
          <span className="text-ink-faint text-xs">■ 表示数 / {BUCKET_LABELS[data.days]}の合計</span>
        </div>
        <ImpressionsChart data={data} />
      </section>

      <div>
        <h3 className="mb-3 font-semibold">飲食店向け指標</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <KpiCard
            variant="v6"
            title="メニュー閲覧"
            value={data.food.menuClicks}
            unit=""
            detail="対象機能を利用している店舗のみ"
          />
          <KpiCard variant="v6" title="Google経由の予約" value={data.food.bookings} unit="" detail="連携サービス未対応" valueTone={data.food.bookings === null ? 'faint' : 'default'} />
          <KpiCard variant="v6" title="料理の注文" value={data.food.foodOrders} unit="" detail="連携サービス未対応" valueTone={data.food.foodOrders === null ? 'faint' : 'default'} />
        </div>
      </div>

      <p className="text-ink-faint text-xs">未取得・未対応は「—」で表示し、0件と区別します。表示数は区分別の合計であり、実来店数ではありません。</p>
    </div>
  )
}
