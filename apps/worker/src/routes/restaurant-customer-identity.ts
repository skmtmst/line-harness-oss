import { tracedFetch as fetch } from '@line-crm/shared/server';
import { type Context } from 'hono';
import type { Env } from '../worker-env.js';
import { activeTenantLineAccountSql } from '@line-crm/db';
import { dbFor } from '../services/db-router.js';
import { isAccountFeatureEnabled } from '@line-crm/db';

export async function identity(
  c: Context<Env>,
): Promise<{ accountId: string; uid: string; friendName: string } | Response> {
  const liffId = c.req.query('liffId'),
    auth = c.req.header('Authorization');
  if (!liffId || !auth?.startsWith('Bearer ') || !auth.slice(7).trim())
    return c.json({ success: false, error: 'unauthorized' }, 401);
  const a = await dbFor(c.env)
    .prepare(
      `SELECT la.id,la.login_channel_id FROM line_accounts la WHERE la.liff_id=? AND la.is_active=1 AND la.archived_at IS NULL AND ${activeTenantLineAccountSql('la.id')}`,
    )
    .bind(liffId)
    .first<{ id: string; login_channel_id: string | null }>();
  if (!a?.login_channel_id)
    return c.json({ success: false, error: 'not_found' }, 404);
  if (!(await isAccountFeatureEnabled(c.env.DB, a.id, 'restaurant_test')))
    return c.json({ success: false, error: 'not_found' }, 404);
  let verified: { sub?: string; aud?: string; exp?: number };
  try {
    const r = await fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        id_token: auth.slice(7),
        client_id: a.login_channel_id,
      }),
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
    if (!r.ok) return c.json({ success: false, error: 'unauthorized' }, 401);
    verified = await r.json();
  } catch {
    return c.json({ success: false, error: 'unauthorized' }, 401);
  }
  if (
    !verified.sub ||
    verified.aud !== a.login_channel_id ||
    !verified.exp ||
    verified.exp <= Date.now() / 1000
  )
    return c.json({ success: false, error: 'unauthorized' }, 401);
  const friend = await dbFor(c.env)
    .prepare(
      'SELECT display_name,is_following FROM friends WHERE line_user_id=? AND line_account_id=?',
    )
    .bind(verified.sub, a.id)
    .first<{ display_name: string; is_following: number }>();
  if (!friend || !friend.is_following)
    return c.json({ success: false, error: 'cannot_book' }, 403);
  return {
    accountId: a.id,
    uid: verified.sub,
    friendName: friend.display_name || 'LINEのお客さま',
  };
}
