import type { Context } from 'hono';
import type { Env } from '../worker-env.js';
import { getVisibleLineAccountScope } from './account-access.js';
import { dbFor } from './db-router.js';

/** account_id が担当者の可視範囲にあるか（restaurant の googleAccessGuard と同じ確認）。 */
export async function visibleAccount(c: Context<Env>, selected: string | null = c.req.query('account_id') || null): Promise<string | null> {
  if (!selected) return null;
  const scope = await getVisibleLineAccountScope(dbFor(c.env), c.get('staff'));
  return scope.ids.includes(selected) ? selected : null;
}
