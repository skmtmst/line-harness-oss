import type { Context } from 'hono';
import type { Env } from '../worker-env.js';
import { getVisibleLineAccountScope } from './account-access.js';

export function accountScopeWhere(
  scope: { allowedAccountIds: string[]; canSeeUnassigned: boolean },
  accountColumn: string,
): string {
  const where = scope.allowedAccountIds.length
    ? `AND (${accountColumn} IN (SELECT value FROM json_each(?))${scope.canSeeUnassigned ? ` OR ${accountColumn} IS NULL` : ''})`
    : scope.canSeeUnassigned
      ? `AND ${accountColumn} IS NULL`
      : 'AND 1 = 0';
  return where;
}

export function accountScopeBindings(scope: { allowedAccountIds: string[] }): unknown[] {
  return scope.allowedAccountIds.length ? [JSON.stringify(scope.allowedAccountIds)] : [];
}

export async function adminAccountScope(c: Context<Env>, accountColumn = 'f.line_account_id') {
  const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
  const where = accountScopeWhere(scope, accountColumn);
  return { scope, where };
}

export async function visibleAccountNames(
  db: D1Database,
  allowedAccountIds: string[],
): Promise<Map<string, string>> {
  if (allowedAccountIds.length === 0) return new Map();
  const result = await db.prepare(
    `SELECT id, name FROM line_accounts
      WHERE id IN (SELECT value FROM json_each(?))`,
  ).bind(JSON.stringify(allowedAccountIds)).all<{ id: string; name: string }>();
  return new Map(result.results?.map((account) => [account.id, account.name]) ?? []);
}
