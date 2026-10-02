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

/**
 * M503: CSV書き出しの失敗を、状態に合った運用者の言葉にする。
 * 通信断なのに権限の確認を案内しない。403 だけ権限、取れない応答は
 * 時間をおいての案内にする。共通部品は触らず、この画面だけで分ける。
 */
export function describeMileageCsvExportFailure(status: number | null): string {
  if (status === 403) return 'CSVを書き出せませんでした。権限を確認して、もう一度お試しください。'
  if (status === null) return 'CSVを書き出せませんでした。通信を確認して、もう一度お試しください。'
  return 'CSVを書き出せませんでした。時間をおいて、もう一度お試しください。'
}

/** 未取得と、取得できた 0 件を区別したまま接続先を返す。 */
export function mileageConnectedAccounts(value: unknown): MileageConnectedAccount[] | null {
  if (!Array.isArray(value)) return null
  /*
   * R386: 同じアカウントの複数プロフィールを同じ本人へ結ぶと、接続先の
   * 一覧に同じアカウントが重なって返ることがある。表示はアカウント単位に
   * 絞り、同じアカウントIDの重複キー警告も防ぐ。
   */
  const seen = new Set<string>()
  return (value as MileageConnectedAccount[]).filter((connection) => {
    if (seen.has(connection.accountId)) return false
    seen.add(connection.accountId)
    return true
  })
}
