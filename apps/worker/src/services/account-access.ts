import {
  getLineAccountScopeEntries,
  getStaffAccountScopeIds,
  getStaffById,
  type LineAccountScopeEntry,
} from '@line-crm/db';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import type { AuthenticatedStaff } from '../middleware/auth.js';

/**
 * 認証済みユーザーが閲覧できるLINE公式アカウントを返す。
 *
 * tenant_id が未設定の既存行は既定統括に属するものとして扱い、管理画面から
 * 行方不明にならないようにする。親子階層は認可に使わない。
 */
export function filterVisibleLineAccounts<T extends { tenant_id: string | null }>(
  accounts: readonly T[] | undefined,
  staff: AuthenticatedStaff | undefined,
): T[] {
  // 認証されていない呼び出しを、既定統括のスタッフとして扱わない。
  if (!staff) return [];
  const staffTenant = staff?.tenantId ?? DEFAULT_TENANT_ID;
  return (accounts ?? []).filter(
    (account) => (account.tenant_id ?? DEFAULT_TENANT_ID) === staffTenant,
  );
}

export function canAccessLineAccount<T extends { id: string; tenant_id: string | null }>(
  accounts: readonly T[] | undefined,
  staff: AuthenticatedStaff | undefined,
  accountId: string,
): boolean {
  return filterVisibleLineAccounts(accounts, staff).some((account) => account.id === accountId);
}

export type VisibleLineAccountScope = {
  accounts: LineAccountScopeEntry[];
  /** Account IDs that every scoped query must filter against. */
  allowedAccountIds: string[];
  /** Only the default tenant may see legacy rows without an account assignment. */
  canSeeUnassigned: boolean;
  /** Kept for account-specific authorization call sites. */
  ids: string[];
  /** True when the staff member is limited to explicitly assigned accounts. */
  isAccountScoped: boolean;
};

/** Resolve account visibility once at a route boundary and reuse it in every query. */
export async function getVisibleLineAccountScope(
  db: D1Database,
  staff: AuthenticatedStaff | undefined,
): Promise<VisibleLineAccountScope> {
  if (!staff) {
    return {
      accounts: [],
      allowedAccountIds: [],
      canSeeUnassigned: false,
      ids: [],
      isAccountScoped: true,
    };
  }
  const staffTenant = staff.tenantId ?? DEFAULT_TENANT_ID;
  const tenantAccounts = filterVisibleLineAccounts(
    await getLineAccountScopeEntries(db, staffTenant),
    staff,
  );
  if (staff?.id === 'env-owner') {
    const allowedAccountIds = tenantAccounts.map((account) => account.id);
    return {
      accounts: tenantAccounts,
      allowedAccountIds,
      canSeeUnassigned: true,
      ids: allowedAccountIds,
      isAccountScoped: false,
    };
  }

  const member = staff?.id ? await getStaffById(db, staff.id) : null;
  const isAccountScoped = member?.account_scope === 'accounts';
  const scopedIds = isAccountScoped
    ? new Set(await getStaffAccountScopeIds(db, staff!.id))
    : null;
  // The tenant wall is applied first. An empty assigned scope deliberately stays empty.
  const accounts = scopedIds
    ? tenantAccounts.filter((account) => scopedIds.has(account.id))
    : tenantAccounts;
  const allowedAccountIds = accounts.map((account) => account.id);
  return {
    accounts,
    allowedAccountIds,
    canSeeUnassigned: !isAccountScoped && staffTenant === DEFAULT_TENANT_ID,
    ids: allowedAccountIds,
    isAccountScoped,
  };
}

/** Return true only when every account reference belongs to the staff tenant. */
export async function canAccessAllLineAccounts(
  db: D1Database,
  staff: AuthenticatedStaff | undefined,
  accountIds: Array<string | null | undefined>,
): Promise<boolean> {
  const scope = await getVisibleLineAccountScope(db, staff);
  return accountIds.every((accountId) => accountId == null
    ? scope.canSeeUnassigned
    : scope.allowedAccountIds.includes(accountId));
}

export type HierarchyRelationship = { id: string; parentLineAccountId: string | null };

/** 親子関係が循環せず、親・子・孫の3階層以内に収まることを検証する。 */
export function validateAccountHierarchy(
  accounts: Array<{ id: string; parent_line_account_id: string | null }>,
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
