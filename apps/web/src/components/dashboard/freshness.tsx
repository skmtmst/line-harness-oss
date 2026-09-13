import type { DashboardOverview } from '@/lib/api'

type Freshness = NonNullable<DashboardOverview['freshness']>
type Reason = NonNullable<DashboardOverview['sections']>[keyof NonNullable<DashboardOverview['sections']>]['reason']

function dashboardFreshnessReasonText(reason: Reason): string | null {
  if (reason === 'source_failed') return '集計元の取得に失敗'
  if (reason === 'fetch_failed') return '外部サービスの取得に失敗'
  if (reason === 'not_connected') return 'LINE未接続'
  if (reason === 'not_loaded') return '未取得'
  if (reason === 'not_applicable') return '対象外'
  return null
}

export function formatDashboardAsOf(asOf: string | null | undefined): string | null {
  if (!asOf) return null
  // APIが返すtimezone無しD1時刻は、server側と同じ既存契約に従ってJSTとして扱う。
  // Z / offset 付きの値は絶対時刻なので、その指定をそのまま維持する。
  const normalized = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(asOf)
    ? `${asOf.replace(' ', 'T')}+09:00`
    : asOf
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  })
}

export function dashboardFreshnessText(
  freshness: Freshness,
  asOf: string | null | undefined,
  reason?: Reason,
): string {
  const time = formatDashboardAsOf(asOf)
  const reasonText = dashboardFreshnessReasonText(reason)
  if (freshness === 'unavailable') return reasonText ? `取得失敗・${reasonText}` : '取得失敗'
  if (freshness === 'partial') {
    const label = time ? `一部取得・更新 ${time}` : '一部取得'
    return reasonText ? `${label}・${reasonText}` : label
  }
  if (!time) return '更新時刻未取得'
  if (freshness === 'stale') return `最終更新 ${time}・要確認`
  if (freshness === 'delayed') return `更新 ${time}・遅延`
  return `更新 ${time}`
}

export default function DashboardFreshness({
  freshness,
  asOf,
  reason,
}: {
  freshness: Freshness | undefined
  asOf: string | null | undefined
  reason?: Reason
}) {
  if (!freshness) return null
  return (
    <span className={freshness === 'unavailable'
      ? 'text-danger shrink-0 text-xs font-medium'
      : freshness === 'partial' || freshness === 'stale' || freshness === 'delayed'
        ? 'text-warning shrink-0 text-xs font-medium'
        : 'text-ink-faint shrink-0 text-xs font-medium'}>
      {dashboardFreshnessText(freshness, asOf, reason)}
    </span>
  )
}
