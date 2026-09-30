import type { MileageFriendsV6Overview } from '@/lib/api'

/*
 * D022: 友だち残高の応答検査。描画が読む項目まで見る。
 *
 * `rankCounts`（・`monthChange`・`expiringMiles30d`・`measuredAt`）を欠く
 * 200応答が検査を通り抜けると、描画の `summary.rankCounts.length` で
 * 画面全体が落ちる。形が違うものは読み込めなかったものとして扱い、
 * 「読み込めませんでした」と再読み込みにする。
 */
export function isMileageFriendsV6Summary(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const summary = value as Partial<MileageFriendsV6Overview['summary']>
  return typeof summary.totalMembers === 'number'
    && typeof summary.withBalanceCount === 'number'
    && typeof summary.available === 'number'
    && typeof summary.pending === 'number'
    && typeof summary.monthChange === 'number'
    && Array.isArray(summary.rankCounts)
    && (typeof summary.expiringMiles30d === 'number' || summary.expiringMiles30d === null)
    && (summary.nextExpiringAt === null || typeof summary.nextExpiringAt === 'string')
}

export function isMileageFriendsV6Overview(value: unknown): value is MileageFriendsV6Overview {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<MileageFriendsV6Overview>
  return Array.isArray(candidate.items)
    && isMileageFriendsV6Summary(candidate.summary)
    && !!candidate.pagination
    && typeof candidate.pagination.total === 'number'
    && typeof candidate.pagination.limit === 'number'
    && typeof candidate.pagination.offset === 'number'
    && typeof candidate.measuredAt === 'string'
}
