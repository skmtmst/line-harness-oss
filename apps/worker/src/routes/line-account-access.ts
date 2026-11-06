import type { Context } from 'hono';
import { getLineAccountById, type LineAccount, type LineAccountScopeEntry } from '@line-crm/db';
import { getVisibleLineAccountScope } from '../services/account-access.js';
import type { Env } from '../worker-env.js';

export async function getVisibleLineAccountEntry(c: Context<Env>, id: string): Promise<LineAccountScopeEntry | null> {
  const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
  return scope.accounts.find((account) => account.id === id) ?? null;
}

export async function getAuthorizedLineAccount(c: Context<Env>, id: string): Promise<LineAccount | null> {
  if (!await getVisibleLineAccountEntry(c, id)) return null;
  return getLineAccountById(c.env.DB, id);
}
