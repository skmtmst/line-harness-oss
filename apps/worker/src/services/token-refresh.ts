/**
 * Token auto-refresh — proactively renew LINE channel access tokens before expiry.
 *
 * LINE's stateless token API uses client_credentials grant:
 * POST channel_id + channel_secret → new access_token (30 days).
 * No refresh_token needed.
 *
 * Runs every cron cycle (5 min). Only refreshes when:
 * - token_expires_at is within 7 days, OR
 * - token_expires_at is NULL (legacy, unknown expiry — refresh once to start tracking)
 */

import { getLineAccounts, updateLineAccount } from '@line-crm/db';
import type { LineAccount } from '@line-crm/db';

const REFRESH_THRESHOLD_MS = 7 * 24 * 60 * 60_000; // 7 days
const JST_OFFSET_MS = 9 * 60 * 60_000;

function jstNow(): string {
  const jst = new Date(Date.now() + JST_OFFSET_MS);
  return jst.toISOString().slice(0, -1) + '+09:00';
}

function shouldRefresh(account: LineAccount): boolean {
  if (!account.token_expires_at) return true; // unknown expiry
  const expiresAt = new Date(account.token_expires_at).getTime();
  return expiresAt - Date.now() < REFRESH_THRESHOLD_MS;
}

export interface TokenResponse {
  access_token: string;
  expires_in: number; // seconds
  token_type: string;
}

export type LineTokenIssueFailure =
  | 'credentials'
  | 'rate_limited'
  | 'temporary'
  | 'network'
  | 'invalid_response';

export class LineTokenIssueError extends Error {
  constructor(
    public readonly reason: LineTokenIssueFailure,
    public readonly status: number | null = null,
  ) {
    super(`LINE access token could not be issued (${reason})`);
    this.name = 'LineTokenIssueError';
  }
}

/**
 * Issue a channel access token through the existing LINE OAuth endpoint.
 * Response bodies are intentionally never copied into exceptions because they
 * may contain operational details that must not reach logs or browser errors.
 */
export async function issueLineAccessToken(
  channelId: string,
  channelSecret: string,
): Promise<TokenResponse> {
  let res: Response;
  try {
    res = await fetch('https://api.line.me/v2/oauth/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: channelId,
        client_secret: channelSecret,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new LineTokenIssueError('network');
  }

  if (!res.ok) {
    const reason: LineTokenIssueFailure = res.status === 400 || res.status === 401
      ? 'credentials'
      : res.status === 429
        ? 'rate_limited'
        : res.status >= 500
          ? 'temporary'
          : 'invalid_response';
    throw new LineTokenIssueError(reason, res.status);
  }

  try {
    const token = await res.json<TokenResponse>();
    if (!token.access_token || !Number.isFinite(token.expires_in)) {
      throw new LineTokenIssueError('invalid_response', res.status);
    }
    return token;
  } catch (error) {
    if (error instanceof LineTokenIssueError) throw error;
    throw new LineTokenIssueError('invalid_response', res.status);
  }
}

export async function refreshLineAccessTokens(db: D1Database): Promise<void> {
  const accounts = await getLineAccounts(db);

  for (const account of accounts) {
    if (!account.is_active) continue;
    if (!shouldRefresh(account)) continue;

    try {
      const token = await issueLineAccessToken(account.channel_id, account.channel_secret);
      const expiresAt = new Date(Date.now() + token.expires_in * 1000 + JST_OFFSET_MS);
      const expiresAtJst = expiresAt.toISOString().slice(0, -1) + '+09:00';

      await updateLineAccount(db, account.id, {
        channel_access_token: token.access_token,
        token_expires_at: expiresAtJst,
      });

      console.log(`🔄 Token refreshed: ${account.name} (expires ${expiresAtJst})`);
    } catch (err) {
      console.error(`❌ Token refresh failed for ${account.name}:`, err);
    }
  }
}
