import type { Context } from 'hono';
import { activeTenantLineAccountSql, getFriendById } from '@line-crm/db';
import type { Env } from '../index.js';
import { verifyCallerLineIdentity } from './liff-auth.js';

/** R2 selects the owner; a caller cannot choose a friend or a different shop. */
export async function isCustomerFileOwner(c: Context<Env>, object: R2Object): Promise<boolean> {
  const accountId = object.customMetadata?.lineAccountId;
  const friendId = object.customMetadata?.friendId;
  if (!accountId || !friendId) return false;
  const account = await c.env.DB.prepare(`SELECT a.id FROM line_accounts a
    WHERE a.id = ? AND a.is_active = 1 AND a.archived_at IS NULL
      AND ${activeTenantLineAccountSql('a.id')}`)
    .bind(accountId).first();
  if (!account) return false;
  const identity = await verifyCallerLineIdentity(c.req.header('Authorization'), c.env, accountId);
  if (!identity || identity.lineAccountId !== accountId) return false;
  const friend = await getFriendById(c.env.DB, friendId);
  return !!friend && friend.line_account_id === accountId && friend.line_user_id === identity.lineUserId;
}
