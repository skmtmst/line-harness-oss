import { tracedFetch as fetch } from '@line-crm/shared/server';
// LIFF id_token verification.
// Mirrors the helper in routes/booking.ts but lives in services/ so that new
// route modules (e.g. events.ts) can import & share it. booking.ts keeps its
// own copy for now to avoid touching production-stable code in this PR.

import { getLineAccounts } from '@line-crm/db';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';

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

  const allAccounts = await getLineAccounts(env.DB);
  const dbAccounts = allAccounts.filter(account => expectedLineAccountId === null
    ? (account.tenant_id ?? DEFAULT_TENANT_ID) === DEFAULT_TENANT_ID
    : !expectedLineAccountId || account.id === expectedLineAccountId);
  if (expectedLineAccountId && (dbAccounts.length === 0 || !dbAccounts[0]?.login_channel_id)) return null;
  const candidates: string[] = [];
  const environmentAccount = allAccounts.find(account => account.login_channel_id === env.LINE_LOGIN_CHANNEL_ID);
  const environmentBelongsToDefault = !environmentAccount
    || (environmentAccount.tenant_id ?? DEFAULT_TENANT_ID) === DEFAULT_TENANT_ID;
  if (env.LINE_LOGIN_CHANNEL_ID && !expectedLineAccountId
    && (expectedLineAccountId !== null || environmentBelongsToDefault)) candidates.push(env.LINE_LOGIN_CHANNEL_ID);
  for (const account of dbAccounts) {
    const channelId = account.login_channel_id;
    if (channelId && !candidates.includes(channelId)) candidates.push(channelId);
  }
  for (const channelId of candidates) {
    const res = await fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
    });
    if (res.ok) {
      const verified = (await res.json()) as { sub?: string };
      if (verified.sub) {
        return {
          lineUserId: verified.sub,
          lineAccountId: dbAccounts.find((account) => account.login_channel_id === channelId)?.id ?? (expectedLineAccountId ?? null),
        };
      }
    }
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
