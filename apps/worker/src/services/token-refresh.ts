import { jstCalendar as japanCalendar } from '@line-crm/shared';
import { tracedFetch as fetch, logger } from '@line-crm/shared/server';
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

import { getLineAccountById, updateLineAccount, updateLineAccountFields } from '@line-crm/db';
import type { LineAccount } from '@line-crm/db';
import { fetchBotProfile } from '../lib/bot-profile.js';
import { SCHEDULED_WORK_BUDGET_MS, withScheduledWorkLease } from './scheduled-work-lease.js';

const REFRESH_THRESHOLD_MS = 7 * 24 * 60 * 60_000; // 7 days

function jstNow(): string {
  const jst = japanCalendar();
  return jst.toISOString().slice(0, -1) + '+09:00';
}

function shouldRefresh(account: LineAccount): boolean {
  if (!account.token_expires_at) return true; // unknown expiry
  const expiresAt = new Date(account.token_expires_at).getTime();
  return expiresAt - Date.now() < REFRESH_THRESHOLD_MS;
}

function shouldSyncProfile(account: LineAccount): boolean {
  if (!account.line_profile_synced_at) return true;
  const syncedAt = new Date(account.line_profile_synced_at).getTime();
  return !Number.isFinite(syncedAt) || Date.now() - syncedAt >= 24 * 60 * 60_000;
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

export const TOKEN_REFRESH_BATCH_SIZE = 25;
const ATTEMPT_COOLDOWN_MS = 30 * 60_000;
const ATTEMPT_KEY_PREFIX = 'line-token-refresh:attempt:';

export async function refreshLineAccessTokens(
  db: D1Database,
  credentialEncryptionKey?: string,
): Promise<void> {
  await withScheduledWorkLease(db, 'line-token-refresh', async (lease) => {
    const started = Date.now();
    const now = new Date(started).toISOString();
    const threshold = new Date(started + REFRESH_THRESHOLD_MS).toISOString();
    // Select IDs before decrypting credentials. Successful accounts leave the due
    // set. Untouched due accounts precede retries; oldest attempts rotate next.
    // Urgency breaks ties, so an expired failure prefix cannot starve other bands.
    const candidates = await db.prepare(`
      SELECT a.id FROM line_accounts a
      LEFT JOIN platform_settings attempt ON attempt.key=?||a.id
      WHERE a.is_active=1 AND a.archived_at IS NULL
        AND (attempt.value IS NULL OR CAST(attempt.value AS INTEGER)<=?)
        AND (a.token_expires_at IS NULL OR a.token_expires_at=''
          OR julianday(a.token_expires_at)<julianday(?)
          OR julianday(a.line_profile_synced_at) IS NULL
          OR julianday(a.line_profile_synced_at)<=julianday(?,'-1 day'))
      ORDER BY COALESCE(CAST(attempt.value AS INTEGER),0), CASE
        WHEN julianday(a.token_expires_at)<julianday(?) THEN 0
        WHEN a.token_expires_at IS NULL OR a.token_expires_at='' THEN 1
        WHEN julianday(a.token_expires_at)<julianday(?) THEN 2 ELSE 3 END,
        COALESCE(julianday(a.token_expires_at),0),
        COALESCE(julianday(a.line_profile_synced_at),0),a.id
      LIMIT ?
    `).bind(ATTEMPT_KEY_PREFIX, started - ATTEMPT_COOLDOWN_MS, threshold,
      now, now, threshold, TOKEN_REFRESH_BATCH_SIZE).all<{ id: string }>();

    for (const candidate of candidates.results) {
      if (Date.now() - started >= SCHEDULED_WORK_BUDGET_MS || !await lease.renew()) break;
      const attemptKey = ATTEMPT_KEY_PREFIX + candidate.id;
      await db.prepare(`INSERT INTO platform_settings(key,value,updated_by,updated_at)
        VALUES(?,?,'line-token-refresh',?) ON CONFLICT(key) DO UPDATE
        SET value=excluded.value,updated_at=excluded.updated_at`)
        .bind(attemptKey, String(Date.now()), new Date().toISOString()).run();
      try {
        const account = await getLineAccountById(db, candidate.id, credentialEncryptionKey);
        if (!account?.is_active || account.archived_at) continue;
        let accessToken = account.channel_access_token;
        let failed = false;
        if (shouldRefresh(account)) {
          try {
            const token = await issueLineAccessToken(account.channel_id, account.channel_secret);
            const expiresAt = japanCalendar(new Date(Date.now() + token.expires_in * 1000));
            const expiresAtJst = expiresAt.toISOString().slice(0, -1) + '+09:00';
            await updateLineAccount(db, account.id, {
              channel_access_token: token.access_token,
              token_expires_at: expiresAtJst,
            }, credentialEncryptionKey);
            accessToken = token.access_token;
            logger.log('services_token_refresh_log');
          } catch {
            failed = true;
            logger.error('services_token_refresh_failed');
          }
        }
        if (shouldSyncProfile(account)) {
          try {
            const profile = await fetchBotProfile(accessToken);
            if (profile.displayName || profile.pictureUrl || profile.basicId) {
              await updateLineAccountFields(db, account.id, {
                lineDisplayName: profile.displayName ?? null,
                linePictureUrl: profile.pictureUrl ?? null,
                lineBasicId: profile.basicId ?? null,
                lineProfileSyncedAt: jstNow(),
              });
            } else failed = true;
          } catch {
            failed = true;
            logger.error('services_token_refresh_failed');
          }
        }
        if (!failed) {
          await db.prepare('DELETE FROM platform_settings WHERE key=?').bind(attemptKey).run();
        }
      } catch {
        // Includes one account whose encrypted credentials cannot be read.
        logger.error('services_token_refresh_failed');
      }
    }
  });
}
