import { formatYen } from '@/components/ops/ops-charts'

export function deltaLabel(delta: number): string {
  if (delta === 0) return '前月比 ±¥0'
  return `前月比 ${delta > 0 ? '＋' : '−'}${formatYen(Math.abs(delta))}`
}

export function revenueDetail(delta: number, refunds: number): string {
  return `${deltaLabel(delta)}・返金 ${formatYen(refunds)}`
}

export function contractDetail(
  active: number,
  byPlan: Record<'light' | 'standard' | 'pro', number>,
  filledByListPriceCount: number,
): string {
  const base = `${active}件（ライト${byPlan.light}・スタンダード${byPlan.standard}・プロ${byPlan.pro}）`
  return filledByListPriceCount > 0 ? `${base}・定価で補い ${filledByListPriceCount}件` : base
}

export function revenueSourceLabel(pricing: 'stripe_actual' | 'list_price', lastSyncedAt: string | null): string {
  if (pricing === 'list_price') return '定価で数えています'
  if (!lastSyncedAt) return 'Stripe の入金実績'
  const date = new Date(lastSyncedAt)
  if (!Number.isFinite(date.getTime())) return 'Stripe の入金実績'
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return `Stripe の入金実績（最終同期 ${value('month')}/${value('day')} ${value('hour')}:${value('minute')}）`
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
