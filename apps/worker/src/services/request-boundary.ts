import {
  getVisibleLineAccountScope,
  type VisibleLineAccountScope,
} from './account-access.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';

/**
 * 権限・tenant・LINEアカウント境界の共通土台(board #800)。
 *
 * 各機能routeが手書きしていた「指定アカウントを見てよいか」の判定を1か所へ集める。
 * 中身の判定は既存 getVisibleLineAccountScope の再利用だけにする。
 * tenantの壁・個別アカウント範囲・機能範囲の順序は変えない。
 * 今回は各機能routeへ配線しない。後続のN/E-ID票がこの関数を呼ぶ。
 */
export type BoundaryDenialReason = 'unauthenticated' | 'outside-scope';

export type BoundaryDecision =
  | { allowed: true; scope: VisibleLineAccountScope }
  | { allowed: false; reason: BoundaryDenialReason; scope: VisibleLineAccountScope };

/**
 * 要求されたLINEアカウントIDがstaffの可視範囲に入るかを決める。
 *
 * - requestedAccountId 未指定(または空文字): 一覧用。許可し、呼び出し側は
 *   scope.allowedAccountIds で絞り込む。
 * - null: 未割当行の参照。scope.canSeeUnassigned のときだけ許可。
 * - 文字列: scope.allowedAccountIds に含まれるときだけ許可。
 * - staff 未認証: 常に不許可。scopeは空。
 */
export async function resolveRequestBoundary(
  db: D1Database,
  staff: AuthenticatedStaff | undefined,
  requestedAccountId?: string | null,
): Promise<BoundaryDecision> {
  const scope = await getVisibleLineAccountScope(db, staff);
  if (!staff) {
    return { allowed: false, reason: 'unauthenticated', scope };
  }
  if (requestedAccountId === undefined || requestedAccountId === '') {
    return { allowed: true, scope };
  }
  const allowed = requestedAccountId === null
    ? scope.canSeeUnassigned
    : scope.allowedAccountIds.includes(requestedAccountId);
  if (!allowed) {
    return { allowed: false, reason: 'outside-scope', scope };
  }
  return { allowed: true, scope };
}
