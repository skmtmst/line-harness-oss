import { formatYen } from '@/components/ops/ops-charts'

export function deltaLabel(delta: number): string {
  if (delta === 0) return '前月比 ±¥0'
  return `前月比 ${delta > 0 ? '＋' : '−'}${formatYen(Math.abs(delta))}`
}

export function minutesLabel(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes)) return '—'
  const total = Math.max(0, Math.round(minutes))
  if (total < 60) return `${total}分`
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h < 24) return m > 0 ? `${h}時間${m}分` : `${h}時間`
  return `${Math.floor(h / 24)}日${h % 24}時間`
}
