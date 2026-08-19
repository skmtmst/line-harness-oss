import type { LineAccount } from '@line-crm/db';
import type { AuthenticatedStaff } from '../middleware/auth.js';

/**
 * 認証済みユーザーが閲覧できるLINE公式アカウントを返す。
 *
 * - owner と既存ユーザー（割当なし）は後方互換のため全件
 * - 割当あり・他アカウント権限OFFは自分の1件だけ
 * - ONは構成上の子・孫を再帰的に含む
 */
export function filterVisibleLineAccounts(
  accounts: LineAccount[] | undefined,
  staff: AuthenticatedStaff | undefined,
): LineAccount[] {
  const available = accounts ?? [];
  if (!staff || staff.role === 'owner' || !staff.assignedLineAccountId) return available;

  const visible = new Set<string>([staff.assignedLineAccountId]);
  if (staff.canAccessDescendantAccounts) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const account of available) {
        if (
          account.parent_line_account_id &&
          visible.has(account.parent_line_account_id) &&
          !visible.has(account.id)
        ) {
          visible.add(account.id);
          changed = true;
        }
      }
    }
  }
  return available.filter((account) => visible.has(account.id));
}

export function canAccessLineAccount(
  accounts: LineAccount[] | undefined,
  staff: AuthenticatedStaff | undefined,
  accountId: string,
): boolean {
  if (!staff || staff.role === 'owner' || !staff.assignedLineAccountId) return true;
  return filterVisibleLineAccounts(accounts, staff).some((account) => account.id === accountId);
}

export type HierarchyRelationship = { id: string; parentLineAccountId: string | null };

/** 親子関係が循環せず、親・子・孫の3階層以内に収まることを検証する。 */
export function validateAccountHierarchy(
  accounts: LineAccount[],
  relationships: HierarchyRelationship[],
): string | null {
  const ids = new Set(accounts.map((account) => account.id));
  const parents = new Map(accounts.map((account) => [account.id, account.parent_line_account_id]));

  for (const relationship of relationships) {
    if (!ids.has(relationship.id)) return '存在しないLINEアカウントが含まれています';
    if (relationship.parentLineAccountId !== null && !ids.has(relationship.parentLineAccountId)) {
      return '存在しない親LINEアカウントが含まれています';
    }
    if (relationship.id === relationship.parentLineAccountId) {
      return '同じLINEアカウントを親に設定できません';
    }
    parents.set(relationship.id, relationship.parentLineAccountId);
  }

  for (const id of ids) {
    const visited = new Set<string>([id]);
    let current = parents.get(id) ?? null;
    let depth = 1;
    while (current) {
      if (visited.has(current)) return 'LINEアカウント構成を循環させることはできません';
      visited.add(current);
      depth += 1;
      if (depth > 3) return 'LINEアカウント構成は親・子・孫の3階層までです';
      current = parents.get(current) ?? null;
    }
  }
  return null;
}
