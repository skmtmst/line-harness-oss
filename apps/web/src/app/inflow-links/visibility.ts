export interface ReferralVisibilityRow {
  source: 'entry_route' | 'tracked_link' | 'orphan'
  poolId: string | null
  friendCount: number
}

export function shouldShowReferralRow(
  row: ReferralVisibilityRow,
  selectedAccountId: string | null,
  poolRoutesToAccount: (poolId: string | null, accountId: string) => boolean,
): boolean {
  if (!selectedAccountId) return true
  if (row.friendCount > 0) return true
  if (row.source === 'orphan') return false

  // Pool未設定のentry_routeは、特定アカウント専用だと判断できない。
  // 作成直後に一覧から消すと「保存されなかった」ように見えるため、
  // 選択中アカウントがあっても共通の未割当リンクとして表示する。
  if (row.source === 'entry_route' && row.poolId === null) return true

  return poolRoutesToAccount(row.poolId, selectedAccountId)
}
