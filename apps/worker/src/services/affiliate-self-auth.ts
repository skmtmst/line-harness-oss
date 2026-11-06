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

/** LINE トークンの不正は401、確認済みでも友だちなしは404、成功は本人の友だちを返し、呼出元が1回の解決で状態を選べるようにする。 */
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

  // 別アプリのなりすましを防ぐため、verify の client_id が環境の既定または DB のログインチャネルに属する場合だけ受け付ける。
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

/** 解決失敗を対応する JSON のエラー応答へ変換する。 */
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
