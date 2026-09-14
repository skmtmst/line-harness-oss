import {
  canAccessAllLineAccounts,
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
export type BoundaryDenialReason = 'unauthenticated' | 'outside-scope' | 'forbidden';

export type BoundaryDecision =
  | { allowed: true; scope: VisibleLineAccountScope }
  | { allowed: false; reason: BoundaryDenialReason; scope: VisibleLineAccountScope };

export type BoundaryOptions = {
  /**
   * 必須の個別権限キー。完全一致で比べる(部分一致は許可しない)。
   * 指定時は readOnly のstaffを必ず拒否する(閲覧専用に変更はさせない)。
   */
  requiredPermissionKey?: string;
};

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
  options: BoundaryOptions = {},
): Promise<BoundaryDecision> {
  const scope = await getVisibleLineAccountScope(db, staff);
  if (!staff) {
    return { allowed: false, reason: 'unauthenticated', scope };
  }
  if (!hasRequiredPermission(staff, options.requiredPermissionKey)) {
    return { allowed: false, reason: 'forbidden', scope };
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

/**
 * 個別権限キーの完全一致とreadOnly拒否。キーの指定がないときは通す。
 * 閉じ側へ倒す:キー一覧が無い・読めないstaffは不許可。
 */
function hasRequiredPermission(
  staff: AuthenticatedStaff,
  requiredPermissionKey: string | undefined,
): boolean {
  if (requiredPermissionKey === undefined || requiredPermissionKey === '') return true;
  if (staff.readOnly) return false;
  const keys = staff.permissionKeys;
  if (!Array.isArray(keys)) return false;
  return keys.some((key) => key === requiredPermissionKey);
}

/**
 * 複数アカウントIDの一括判定。アカウント部分は既存 canAccessAllLineAccounts
 * へ委譲する。1件でも範囲外なら全体を不許可にする(fail-closed)。
 */
export async function resolveRequestBoundaries(
  db: D1Database,
  staff: AuthenticatedStaff | undefined,
  requestedAccountIds: Array<string | null | undefined>,
  options: BoundaryOptions = {},
): Promise<BoundaryDecision> {
  const scope = await getVisibleLineAccountScope(db, staff);
  if (!staff) {
    return { allowed: false, reason: 'unauthenticated', scope };
  }
  if (!hasRequiredPermission(staff, options.requiredPermissionKey)) {
    return { allowed: false, reason: 'forbidden', scope };
  }
  const allowed = await canAccessAllLineAccounts(db, staff, requestedAccountIds);
  if (!allowed) {
    return { allowed: false, reason: 'outside-scope', scope };
  }
  return { allowed: true, scope };
}
