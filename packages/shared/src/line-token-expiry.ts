import { lineObservationTime } from './line-observation-time.js'

export const LINE_TOKEN_CAUTION_DAYS = 14
export const LINE_TOKEN_REFRESH_DAYS = 7

export type LineTokenExpiry = { status: 'unknown' | 'expired' | 'expiring' | 'valid'; label: string; daysLeft: number | null }

/** 時差のない保存日時は日本時間として読み、全画面で期限と接続を分ける。 */
export function lineTokenExpiry(expiresAt: string | null | undefined, now = Date.now()): LineTokenExpiry {
  const at = lineObservationTime(expiresAt)
  if (!Number.isFinite(at)) return { status: 'unknown', label: 'トークンの期限は未確認', daysLeft: null }
  const daysLeft = Math.floor((at - now) / (24 * 60 * 60_000))
  if (at <= now) return { status: 'expired', label: 'トークンの期限が切れています', daysLeft }
  if (daysLeft <= LINE_TOKEN_CAUTION_DAYS) return { status: 'expiring', label: 'トークンの期限が近づいています', daysLeft }
  return { status: 'valid', label: 'トークンの期限に余裕があります', daysLeft }
}
