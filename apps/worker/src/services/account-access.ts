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

/**
 * 同一リクエスト内の scope 再計算を防ぐメモ化(#633)。
 *
 * tenant境界 middleware・機能off middleware・各 route の
 * canAccessAllLineAccounts が、1要求の中で同じ (staff, db) の
 * 可視範囲を何度も D1 へ問い合わせていた(最大3往復×3回)。
 *
 * キーは「staffオブジェクト自身 + D1バインディング自身 + scope入力の署名」。
 * staff は auth middleware が毎要求で新しく組み立て、機能off middleware が
 * 絞り込みを足すときも `{...staff}` の別オブジェクトへ差し替えるため、
 * オブジェクト同一性 ≒ 同一要求 になる。弱参照なので要求を超えて残らず、
 * リクエスト外への持ち出しも起きない。
 *
 * 万が一呼び出し間で staff オブジェクトが書き換えられても古い scope を
 * 返さないよう、scope の入力(id・tenantId・機能絞り込み)の署名が変わった
 * エントリは使い回さず再計算する。
 *
 * 同一 staff・同一 db で中間に scope 元(アカウント一覧・担当範囲)を
 * 書き換える処理があれば古い値を返しうる。現行の書き込み route は
 * 書き込み前に scope を読み、書き込み後に再読しないため問題ないが、
 * そういう経路を足すときはこのキャッシュを前提にしないこと。
 */
type CachedScope = { signature: string; pending: Promise<VisibleLineAccountScope> };

let scopeCacheByStaff = new WeakMap<
  AuthenticatedStaff,
  WeakMap<D1Database, CachedScope>
>();

/** テスト用。同じ staff オブジェクトを使い回すテスト間の持ち越しを切る。 */
export function _resetVisibleLineAccountScopeCacheForTest(): void {
  scopeCacheByStaff = new WeakMap();
}

/** scope 計算が読む staff 入力の指紋。変わっていたら別要求と同じく再計算する。 */
function scopeSignature(staff: AuthenticatedStaff): string {
  return [
    staff.id,
    staff.tenantId ?? '',
    staff.featureEnabledLineAccountIds?.join(',') ?? '',
  ].join('\u0000');
}

/** Resolve account visibility once at a route boundary and reuse it in every query. */
export function getVisibleLineAccountScope(
  db: D1Database,
  staff: AuthenticatedStaff | undefined,
): Promise<VisibleLineAccountScope> {
  if (!staff) {
    return Promise.resolve({
      accounts: [],
      allowedAccountIds: [],
      canSeeUnassigned: false,
      ids: [],
      isAccountScoped: true,
    });
  }
  const signature = scopeSignature(staff);
  let byDb = scopeCacheByStaff.get(staff);
  if (!byDb) {
    byDb = new WeakMap();
    scopeCacheByStaff.set(staff, byDb);
  }
  const cached = byDb.get(db);
  if (cached && cached.signature === signature) return cached.pending;
  // 失敗した読取は残さず、同じ要求内の再試行を許す。
  const pending = resolveVisibleLineAccountScope(db, staff).catch((error: unknown) => {
    if (byDb.get(db)?.pending === pending) byDb.delete(db);
    throw error;
  });
  byDb.set(db, { signature, pending });
  return pending;
}

async function resolveVisibleLineAccountScope(
  db: D1Database,
  staff: AuthenticatedStaff,
): Promise<VisibleLineAccountScope> {
  const staffTenant = staff.tenantId ?? DEFAULT_TENANT_ID;
  // アカウント一覧とスタッフ行は互いに独立。直列だと2往復分待つので同時に投げる。
  const [entries, member] = await Promise.all([
    getLineAccountScopeEntries(db, staffTenant),
    staff.id && staff.id !== 'env-owner' ? getStaffById(db, staff.id) : Promise.resolve(null),
  ]);
  const tenantAccounts = filterVisibleLineAccounts(entries, staff);
  const featureScope = staff.featureEnabledLineAccountIds
    ? new Set(staff.featureEnabledLineAccountIds)
    : null;
  const featureScopedAccounts = featureScope
    ? tenantAccounts.filter((account) => featureScope.has(account.id))
    : tenantAccounts;
  if (staff.id === 'env-owner') {
    const allowedAccountIds = featureScopedAccounts.map((account) => account.id);
    return {
      accounts: featureScopedAccounts,
      allowedAccountIds,
      canSeeUnassigned: !featureScope,
      ids: allowedAccountIds,
      isAccountScoped: false,
    };
  }

  const isAccountScoped = member?.account_scope === 'accounts';
  const scopedIds = isAccountScoped
    ? new Set(await getStaffAccountScopeIds(db, staff.id))
    : null;
  // The tenant wall is applied first. An empty assigned scope deliberately stays empty.
  const accounts = scopedIds
    ? featureScopedAccounts.filter((account) => scopedIds.has(account.id))
    : featureScopedAccounts;
  const allowedAccountIds = accounts.map((account) => account.id);
  return {
    accounts,
    allowedAccountIds,
    canSeeUnassigned: !featureScope && !isAccountScoped && staffTenant === DEFAULT_TENANT_ID,
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
