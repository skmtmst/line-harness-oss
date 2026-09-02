import type { MileageConnectedAccount } from '@/lib/api'

function finiteNonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/** API の入れ子が欠けたとき、未取得を 0 件として扱わない。 */
export function mileagePaginationTotal(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null
  const pagination = (value as { pagination?: unknown }).pagination
  if (!pagination || typeof pagination !== 'object') return null
  return finiteNonNegativeNumber((pagination as { total?: unknown }).total)
}

/** 付与記録の回数が欠けたとき、画面全体を落とさず未取得として扱う。 */
export function mileageRewardedActions(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null
  return finiteNonNegativeNumber((value as { rewardedActions?: unknown }).rewardedActions)
}

/** 未取得と、取得できた 0 件を区別したまま接続先を返す。 */
export function mileageConnectedAccounts(value: unknown): MileageConnectedAccount[] | null {
  return Array.isArray(value) ? value as MileageConnectedAccount[] : null
}
