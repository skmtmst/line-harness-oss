import { tracedFetch as fetch } from '@line-crm/shared/server';
import type { Context } from 'hono';
import type { Env } from '../worker-env.js';
import { getFriendByLineUserIdForAccount, listLineAccountsWithTenantStatus } from '@line-crm/db';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';

type ResolvedFriend = {
  id: string;
  display_name: string;
  user_id: string | null;
  line_account_id: string | null;
};

/**
 * Verify a LINE access token and resolve the backing friend row.
 *
 * Returns a discriminated result so callers can pick the right HTTP status in
 * a single pass:
 *   - 'invalid_token' → 401 (token could not be verified against LINE)
 *   - 'no_friend'     → 404 (token verified, but no friend row exists)
 *   - 'ok'            → proceed with the resolved friend
 */
export async function resolveFriendFromLineToken(
  env: Env['Bindings'],
  accessToken: string,
): Promise<
  | { status: 'invalid_token' }
  | { status: 'no_friend' }
  | { status: 'tenant_suspended' }
  | { status: 'ok'; friend: ResolvedFriend; lineAccountId: string | null; tenantId: string }
> {
  const db = env.DB;
  const v = await fetch(
    'https://api.line.me/oauth2/v2.1/verify?access_token=' +
      encodeURIComponent(accessToken),
  );
  if (!v.ok) return { status: 'invalid_token' };

  // The verify response carries the LINE Login channel (`client_id`) that
  // minted this token. Reject any token issued by a channel this deployment
  // does not own — otherwise a token from an unrelated LINE Login app whose
  // user happens to share a lineUserId could impersonate an affiliate.
  // Allowed channels = env default + every DB account's login channel, mirroring
  // the multi-account verification pattern in liff.ts.
  const verifyBody = await v
    .json<{ client_id?: string }>()
    .catch((): { client_id?: string } => ({}));
  const tokenClientId = verifyBody.client_id;
  if (!tokenClientId) return { status: 'invalid_token' };

  const allowedChannelIds = new Set<string>();
  if (env.LINE_LOGIN_CHANNEL_ID) allowedChannelIds.add(env.LINE_LOGIN_CHANNEL_ID);
  const dbAccounts = await listLineAccountsWithTenantStatus(db);
  for (const acct of dbAccounts) {
    if (acct.login_channel_id) allowedChannelIds.add(acct.login_channel_id);
  }
  if (!allowedChannelIds.has(tokenClientId)) return { status: 'invalid_token' };

  const prof = await fetch('https://api.line.me/v2/profile', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!prof.ok) return { status: 'invalid_token' };

  const { userId } = await prof.json<{ userId: string }>();
  if (!userId) return { status: 'invalid_token' };

  const lineAccount = dbAccounts.find(
    (account) => account.login_channel_id === tokenClientId,
  );
  if (lineAccount && (lineAccount.tenant_status !== 'active' || !lineAccount.is_active || lineAccount.archived_at != null)) {
    return { status: 'tenant_suspended' };
  }
  const lineAccountId = lineAccount?.id ?? null;
  const friend = await getFriendByLineUserIdForAccount(db, userId, lineAccountId);
  if (!friend || friend.line_account_id !== lineAccountId) return { status: 'no_friend' };
  if (!lineAccount && tokenClientId !== env.LINE_LOGIN_CHANNEL_ID) return { status: 'invalid_token' };
  return {
    status: 'ok',
    friend: friend as unknown as ResolvedFriend,
    lineAccountId,
    tenantId: lineAccount?.tenant_id ?? DEFAULT_TENANT_ID,
  };
}

/** Map a non-ok resolution to its JSON error response. */
export function unresolvedResponse(
  c: Context<Env>,
  result:
    | { status: 'invalid_token' }
    | { status: 'no_friend' }
    | { status: 'tenant_suspended' },
) {
  if (result.status === 'tenant_suspended') {
    return c.json({
      success: false,
      code: 'TENANT_SUSPENDED',
      error: '現在ご利用いただけません',
    }, 503);
  }
  if (result.status === 'invalid_token') {
    return c.json({ success: false, error: 'Invalid LINE access token' }, 401);
  }
  return c.json({ success: false, error: 'Friend not found' }, 404);
}
