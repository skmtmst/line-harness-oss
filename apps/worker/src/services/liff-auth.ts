import { tracedFetch as fetch } from '@line-crm/shared/server';
import { getLineAccountLoginChannels } from '@line-crm/db';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';

// The unverified audience selects a single verification endpoint candidate only.
// Identity is trusted only after LINE verifies the token for that client_id.
function tokenAudience(token: string): string | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1].replaceAll('-', '+').replaceAll('_', '/');
    const claims = JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '='))) as { aud?: unknown };
    return typeof claims.aud === 'string' && claims.aud.length > 0 ? claims.aud : null;
  } catch {
    return null;
  }
}

export interface VerifyEnv {
  LINE_LOGIN_CHANNEL_ID?: string;
  DB: D1Database;
}

export interface VerifiedLineIdentity {
  lineUserId: string;
  lineAccountId: string | null;
}

export async function verifyCallerLineIdentity(
  authHeader: string | undefined,
  env: VerifyEnv,
  expectedLineAccountId?: string | null,
): Promise<VerifiedLineIdentity | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const idToken = authHeader.slice('Bearer '.length).trim();
  if (!idToken) return null;

  const audience = tokenAudience(idToken);
  if (!expectedLineAccountId && !audience) return null;
  const accounts = await getLineAccountLoginChannels(env.DB, expectedLineAccountId
    ? { accountId: expectedLineAccountId }
    : { loginChannelId: audience! });
  const dbAccounts = accounts.filter(account => expectedLineAccountId === null
    ? (account.tenant_id ?? DEFAULT_TENANT_ID) === DEFAULT_TENANT_ID
    : !expectedLineAccountId || account.id === expectedLineAccountId);
  const account = dbAccounts.find(item => expectedLineAccountId ? item.id === expectedLineAccountId : item.login_channel_id === audience);
  const environmentBelongsToDefault = !accounts.some(item =>
    item.login_channel_id === env.LINE_LOGIN_CHANNEL_ID && (item.tenant_id ?? DEFAULT_TENANT_ID) !== DEFAULT_TENANT_ID);
  const environmentChannel = !expectedLineAccountId && audience === env.LINE_LOGIN_CHANNEL_ID
    && (expectedLineAccountId !== null || environmentBelongsToDefault) ? audience : null;
  const channelId = account?.login_channel_id ?? environmentChannel;
  if (!channelId || (audience && audience !== channelId)) return null;
  const res = await fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
    signal: AbortSignal.timeout(5_000),
  });
  if (res.ok) {
    const verified = (await res.json()) as { sub?: string };
    if (verified.sub) return { lineUserId: verified.sub, lineAccountId: account?.id ?? null };
  }
  return null;
}

export async function verifyCallerLineUserId(
  authHeader: string | undefined,
  env: VerifyEnv,
  expectedLineAccountId?: string | null,
): Promise<string | null> {
  return (await verifyCallerLineIdentity(authHeader, env, expectedLineAccountId))?.lineUserId ?? null;
}
