import { getLineAccounts, type LineAccount } from '@line-crm/db';
import type { AuthenticatedStaff } from '../middleware/auth.js';

/**
 * 認証済みユーザーが閲覧できるLINE公式アカウントを返す。
 *
 * このシステムは1つの組織で使う前提で、認証済みスタッフは役割にかかわらず
 * 組織内の全アカウントを操作できる。assignedLineAccountId はログイン直後に
 * 選ぶ既定値であり、認可境界には使わない。
 */
export function filterVisibleLineAccounts(
  accounts: LineAccount[] | undefined,
  _staff: AuthenticatedStaff | undefined,
): LineAccount[] {
  return accounts ?? [];
}

export function canAccessLineAccount(
  accounts: LineAccount[] | undefined,
  _staff: AuthenticatedStaff | undefined,
  accountId: string,
): boolean {
  // There is no staff-assignment restriction, but the account must still
  // belong to this installation (the organization boundary).
  return (accounts ?? []).some((account) => account.id === accountId);
}

export type VisibleLineAccountScope = {
  accounts: LineAccount[];
  ids: string[];
  /** false means the caller may use legacy rows whose account is not assigned. */
  restricted: boolean;
};

/** Resolve account visibility once at a route boundary and reuse it in every query. */
export async function getVisibleLineAccountScope(
  db: D1Database,
  staff: AuthenticatedStaff | undefined,
): Promise<VisibleLineAccountScope> {
  const allAccounts = await getLineAccounts(db);
  const accounts = filterVisibleLineAccounts(allAccounts, staff);
  return { accounts, ids: accounts.map((account) => account.id), restricted: false };
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
