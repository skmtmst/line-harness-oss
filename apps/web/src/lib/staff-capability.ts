/**
 * ログイン中スタッフの項目別権限を画面側で参照する（N-411 / N-424）。
 *
 * 正本は Worker の認可（permissionForApiPath + route guard）。ここは
 * 「見せる操作とAPI結果を一致させる」ための表示制御だけに使う。
 * localStorage には auth-guard が /api/auth/session の応答を保存している。
 */

function readKeys(storageKey: string): string[] {
  try {
    const raw = window.localStorage.getItem(storageKey);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/** owner/admin は全通過。staff は保存済みキーで判定する。 */
function isPrivilegedRole(): boolean {
  const role = window.localStorage.getItem('lh_staff_role');
  return role === 'owner' || role === 'admin';
}

/**
 * サーバーが項目キーではなく役割で門を閉めている操作（例: テンプレートの
 * 作成・更新・削除は requireRole('owner','admin')）を画面へ出してよいか。
 * staff に項目キーがあっても API は拒否するので、ここは役割だけを見る。
 */
export function isOwnerOrAdmin(): boolean {
  if (typeof window === 'undefined') return false;
  return isPrivilegedRole();
}

/** 変更系操作を画面へ出してよいか（edit キー相当）。 */
export function canEditFeature(permission: string): boolean {
  if (typeof window === 'undefined') return false;
  if (isPrivilegedRole()) return true;
  return readKeys('lh_staff_permissions').includes(permission);
}

/** 閲覧だけ許すか（edit または view キー相当）。 */
export function canViewFeature(permission: string): boolean {
  if (typeof window === 'undefined') return false;
  if (isPrivilegedRole()) return true;
  return canEditFeature(permission)
    || readKeys('lh_staff_view_permissions').includes(permission);
}
