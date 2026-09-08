'use client'

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { api, type AnalyticsMetric, type SavedAnalyticsSnapshot } from '@/lib/api'
import Button from '@/components/shared/button'
import { type ChipTone } from '@/components/shared/chip'
import { csvCell } from '@/lib/presentation'
import { formatAnalyticsDateTime } from '../analytics-time'

// 実行間隔ガード(点検#508の中4)の符号を、運用の言葉に言い換える。
export function explainStartError(code: string, fallback: string): string {
  if (code === 'analytics_cross_busy') return '他の集計が動いています。終わってからもう一度押してください'
  if (code === 'analytics_funnel_too_soon') return 'さきほど集計したばかりです。少し待ってから押してください'
  return fallback
}

export const TABS = [
  { key: 'friends', label: '友だちの増減' },
  { key: 'reactions', label: '配信の反応' },
  { key: 'routes', label: '経路と成果' },
  { key: 'usage', label: '使われ方' },
  { key: 'cross', label: 'クロス分析' },
  { key: 'funnel', label: 'ファネル' },
  { key: 'url-clicks', label: 'URLクリック' },
  { key: 'saved', label: '保存した分析' },
]

export function downloadCsv(filename: string, rows: Array<Array<string | number | null | undefined>>) {
  const csv = rows.map((row) => row.map(csvCell).join(',')).join('\n')
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function AnalyticsNotice({ children }: { children: ReactNode }) {
  return (
    <div className="bg-info-bg border-info rounded-card border px-4 py-3 text-sm leading-relaxed text-ink-secondary">
      {children}
    </div>
  )
}

export function AnalyticsExportButton({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <Button onClick={onClick} disabled={disabled} variant="secondary">
      CSVで書き出す
    </Button>
  )
}

export function metricSum(metrics: Array<AnalyticsMetric<number>>): number | null {
  const values = metrics.map(shownValue)
  return values.some((value) => value === null)
    ? null
    : values.reduce<number>((sum, value) => sum + (value ?? 0), 0)
}

export const RANGES = [7, 30, 90]
export const WEEKDAY_JP = ['日', '月', '火', '水', '木', '金', '土']

export function RangePicker({ days, onChange }: { days: number; onChange: (days: number) => void }) {
  return (
    <div className="flex gap-1" aria-label="集計期間">
      {RANGES.map((range) => (
        <button
          type="button"
          key={range}
          onClick={() => onChange(range)}
          className={`rounded-control px-3 py-2 text-xs font-medium ${days === range ? 'bg-accent-deep text-on-accent' : 'bg-canvas-sunken text-ink-secondary'}`}
        >
          {range}日
        </button>
      ))}
    </div>
  )
}

export function weekdayOf(date: string): string {
  return WEEKDAY_JP[new Date(`${date}T00:00:00+09:00`).getDay()] ?? ''
}

export function rangeFor(days: number): { from: string; to: string } {
  const jstNow = new Date(Date.now() + 9 * 3600_000)
  return {
    from: new Date(jstNow.getTime() - days * 24 * 3600_000).toISOString().slice(0, 10),
    to: jstNow.toISOString().slice(0, 10),
  }
}

export function SaveAnalysisAction({
  accountId,
  sourceKind,
  sourceResultId,
  defaultName,
}: {
  accountId: string
  sourceKind: 'cross' | 'funnel'
  sourceResultId: string
  defaultName: string
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(defaultName)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setOpen(false)
    setName(defaultName)
    setSaved(false)
    setError('')
  }, [accountId, defaultName, sourceResultId])

  const save = async () => {
    if (!name.trim() || !sourceResultId) return
    setSaving(true)
    setError('')
    try {
      const response = await api.analytics.saved.create(accountId, {
        name: name.trim(),
        sourceKind,
        sourceResultId,
      })
      if (!response.success) throw new Error(response.error)
      setSaved(true)
      setOpen(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '分析結果を保存できませんでした')
    } finally {
      setSaving(false)
    }
  }

  if (saved) {
    return (
      <div className="bg-success-bg rounded-control flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
        <span className="text-success">定義とこの時点の結果を保存しました</span>
        <Link href="/analytics?tab=saved" className="text-accent font-medium hover:underline">
          保存した分析を見る
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {open ? (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={`saved-analysis-${sourceKind}`} className="sr-only">保存する分析名</label>
          <input
            id={`saved-analysis-${sourceKind}`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={120}
            className="border-hairline rounded-control min-w-64 flex-1 border px-3 py-2 text-sm"
            placeholder="保存する分析名"
          />
          <Button onClick={() => void save()} disabled={saving || !name.trim()} variant="primary">
            {saving ? '保存中' : 'この名前で保存'}
          </Button>
          <Button onClick={() => setOpen(false)} disabled={saving} variant="secondary">
            やめる
          </Button>
        </div>
      ) : (
        <Button onClick={() => setOpen(true)} variant="secondary">
          この分析結果を保存
        </Button>
      )}
      {error && <p className="text-danger text-xs">{error}</p>}
      <p className="text-ink-faint text-xs">条件の定義と、いま表示している結果を別々に固定して残します。</p>
    </div>
  )
}

export type OverviewResult<T> =
  | { success: true; data: T }
  | { success: false; error: string }

export function useOverview<T>(load: () => Promise<OverviewResult<T>>, key: string) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    setData(null)
    void load()
      .then((result) => {
        if (!active) return
        if (result.success) setData(result.data)
        else setError(result.error || '分析を表示できませんでした')
      })
      .catch(() => {
        if (active) setError('分析を表示できませんでした')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
    // 契約: loaderはkeyに含まれる値だけに依存すること。キーに含まれない値をloaderが読んだらキーを足す。
    // loaderはkeyが表すアカウント・期間が変わった時だけ実行する。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return { data, loading, error }
}

export function metricText(
  value: AnalyticsMetric<number | string>,
  options?: { percent?: boolean; currency?: boolean },
) {
  if (value.value === null) return '—'
  if (typeof value.value === 'string') return value.value
  if (options?.percent) return `${Math.round(value.value * 1000) / 10}%`
  if (options?.currency) return `${value.value.toLocaleString('ja-JP')}円`
  return value.value.toLocaleString('ja-JP')
}

/**
 * 指標が自分で言っている状態を見てから数を出す。
 *
 * 契約では `AnalyticsMetric` が `value` と一緒に `state` と `reason` を持っている。
 * 初回集計を待っている（`pending`）ときや取得に失敗した（`failed`）とき、
 * サーバは `value` に 0 を入れて返すことがある。**それをそのまま描くと
 * 「日別集計の初回更新を待っています」と「0人」が同じカードに並び、
 * 読む人には0が実測に見える。**
 *
 * 実測できた（`available`）か、途中まで集計できた（`partial`）ときだけ数を出す。
 * それ以外は `—` にして、理由のほうを読ませる。
 */
export function shownValue(metric: AnalyticsMetric<number>): number | null {
  if (metric.value === null) return null
  return metric.state === 'available' || metric.state === 'partial' ? metric.value : null
}

export function MetricCell({ metric, percent, currency }: {
  metric: AnalyticsMetric<number | string>
  percent?: boolean
  currency?: boolean
}) {
  // 表の桁も帯と同じ決めごとで出す。`value === null` だけ見ていると、
  // 集計待ちの 0 が実測の 0 と同じ濃さで並ぶ。
  const shown = metric.state === 'available' || metric.state === 'partial'
  return <span className={metric.value === null || !shown ? 'text-ink-faint' : 'text-ink'} title={metric.reason ?? undefined}>
    {shown ? metricText(metric, { percent, currency }) : '—'}
  </span>
}

export function DateTimeMetricCell({ metric }: { metric: AnalyticsMetric<string> }) {
  return <span className={metric.value === null ? 'text-ink-faint' : 'text-ink'} title={metric.reason ?? undefined}>
    {formatAnalyticsDateTime(metric.value)}
  </span>
}

export function OverviewState({ loading, error }: { loading: boolean; error: string }) {
  if (loading) return <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-10 text-center text-sm">分析を読み込んでいます</div>
  if (error) return <div className="bg-danger-bg rounded-card border-danger text-danger border p-6 text-sm">{error}</div>
  return null
}

export const SAVED_STATE_LABELS: Record<SavedAnalyticsSnapshot['state'], string> = {
  available: '利用可能',
  partial: '一部集計',
  unavailable: '取得不可',
  failed: '失敗',
}

export const SAVED_STATE_TONES: Record<SavedAnalyticsSnapshot['state'], ChipTone> = {
  available: 'ok',
  partial: 'warn',
  unavailable: 'danger',
  failed: 'danger',
}
