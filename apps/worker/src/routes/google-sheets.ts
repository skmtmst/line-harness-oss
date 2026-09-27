/**
 * #838 第2段: Google Sheets への直接書き出し（OAuth + Sheets API）。
 *
 * - 認可・トークン保管・権限の形は restaurant-google.ts と揃える。
 *   state はDB管理・1回使い切り・10分失効。PKCEの verifier も暗号化して持つ。
 * - 変えられるのは統括（owner または全アカウント担当の admin）だけ。
 * - 接続の解除は Google 側の revoke ＋連携行の削除（要件 #838 §2）。
 * - トークン・秘密値を応答・ログに出さない。
 */
import { Hono } from 'hono';
import type { Context, MiddlewareHandler } from 'hono';
import {
  CredentialEncryptionKeyError,
  decryptCredential,
  encryptCredential,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { auditLog } from '../lib/audit-log.js';
import { DEFAULT_TENANT_ID } from '../lib/tenant.js';
import { getVisibleLineAccountScope } from '../services/account-access.js';
import { dbFor } from '../services/db-router.js';
import {
  GoogleBusinessError,
  buildAuthorizeUrl,
  codeChallengeFor,
  createCodeVerifier,
  exchangeAuthorizationCode,
  fetchAccountEmail,
  randomToken,
  revokeToken,
  type GoogleOAuthClient,
} from '../services/google-business.js';
import {
  GOOGLE_SHEETS_SCOPES,
  MANUAL_SYNC_BUDGET_MS,
  fetchSpreadsheetTitle,
  parseSpreadsheetId,
  sheetsAccessToken,
  sheetsOauthClient,
  syncGoogleSheetsIntegration,
  type GoogleSheetsIntegrationRow,
} from '../services/google-sheets.js';

export const googleSheets = new Hono<Env>();

const OAUTH_STATE_COOKIE = 'lh_sheets_state';
const OAUTH_STATE_MAX_AGE_SEC = 600;
const CALLBACK_PATH = '/api/integrations/google-sheets/oauth/callback';
const ADMIN_RETURN_PATH = '/webhooks';
const ADMIN_RETURN_TAB = 'sheets';

type ConnectionStatus = 'disconnected' | 'pending_target' | 'connected' | 'expired';

function nowIso(): string {
  return new Date().toISOString();
}

function fail(
  c: Context<Env>,
  status: 400 | 401 | 403 | 404 | 409 | 500 | 502 | 503,
  error: string,
  extra: Record<string, unknown> = {},
) {
  return c.json({ success: false, error, ...extra }, status);
}

function staffTenantId(c: Context<Env>): string {
  return c.get('staff')?.tenantId ?? DEFAULT_TENANT_ID;
}

function accountId(c: Context<Env>): string | null {
  return c.req.query('account_id') || null;
}

/**
 * 接続・出力先の変更は統括だけ。owner は常に許可し、admin はDB上で
 * 「全アカウント担当」（account_scope='all'）のときだけ許可する。
 * 店舗限定の管理者へ接続権限を広げないため、行が無い・値が曖昧なら拒否する。
 */
async function canManageIntegration(c: Context<Env>): Promise<boolean> {
  const staff = c.get('staff');
  if (!staff) return false;
  if (staff.role === 'owner') return true;
  if (staff.role !== 'admin' || staff.id === 'env-owner') return false;
  const row = await dbFor(c.env)
    .prepare(
      `SELECT account_scope
       FROM staff_members
       WHERE id = ? AND tenant_id = ? AND role = 'admin' AND is_active = 1
       LIMIT 1`,
    )
    .bind(staff.id, staffTenantId(c))
    .first<{ account_scope: string | null }>();
  return row?.account_scope === 'all';
}

const requireIntegrationManager: MiddlewareHandler<Env> = async (c, next) => {
  if (!await canManageIntegration(c)) {
    return fail(c, 403, 'Google Sheets連携の変更には統括の管理者権限が必要です');
  }
  return next();
};

/** account_id が担当者の可視範囲にあるか（restaurant の googleAccessGuard と同じ確認）。 */
async function visibleAccount(c: Context<Env>): Promise<string | null> {
  const selected = accountId(c);
  if (!selected) return null;
  const scope = await getVisibleLineAccountScope(dbFor(c.env), c.get('staff'));
  return scope.ids.includes(selected) ? selected : null;
}

function oauthClientFor(c: Context<Env>): GoogleOAuthClient | null {
  return sheetsOauthClient(c.env, `${new URL(c.req.url).origin}${CALLBACK_PATH}`);
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) {
      try {
        return decodeURIComponent(value.join('='));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function stateCookie(value: string, maxAge = OAUTH_STATE_MAX_AGE_SEC): string {
  return `${OAUTH_STATE_COOKIE}=${encodeURIComponent(value)}; Path=${CALLBACK_PATH}; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function adminReturnUrl(c: Context<Env>, lineAccountId: string | null, result: string): string {
  const base = (c.env.ADMIN_PUBLIC_URL ?? '').replace(/\/+$/, '');
  const url = new URL(`${base || new URL(c.req.url).origin}${ADMIN_RETURN_PATH}`);
  url.searchParams.set('tab', ADMIN_RETURN_TAB);
  if (lineAccountId) url.searchParams.set('account_id', lineAccountId);
  url.searchParams.set('sheets', result);
  return url.toString();
}

async function integrationFor(c: Context<Env>, lineAccountId: string): Promise<GoogleSheetsIntegrationRow | null> {
  return dbFor(c.env)
    .prepare('SELECT * FROM google_sheets_integrations WHERE line_account_id = ? LIMIT 1')
    .bind(lineAccountId)
    .first<GoogleSheetsIntegrationRow>();
}

function publicIntegration(row: GoogleSheetsIntegrationRow | null) {
  if (!row) return { status: 'disconnected' as ConnectionStatus };
  return {
    status: row.status as ConnectionStatus,
    googleAccountEmail: row.google_account_email,
    spreadsheetId: row.spreadsheet_id,
    spreadsheetTitle: row.spreadsheet_title,
    spreadsheetUrl: row.spreadsheet_id
      ? `https://docs.google.com/spreadsheets/d/${row.spreadsheet_id}`
      : null,
    lastSyncedAt: row.last_synced_at,
    lastSyncStatus: row.last_sync_status,
    lastSyncError: row.last_sync_error,
    consecutiveFailures: row.consecutive_failures,
    connectedAt: row.connected_at,
  };
}

function sheetsErrorResponse(c: Context<Env>, error: unknown) {
  if (error instanceof CredentialEncryptionKeyError) {
    return fail(c, 503, 'トークン暗号化キーが設定されていません', { code: 'encryption_key_missing' });
  }
  if (error instanceof GoogleBusinessError) {
    switch (error.kind) {
      case 'auth_expired':
        return fail(c, 409, 'Googleとの接続を確認してください（認可切れ）', { code: 'auth_expired' });
      case 'no_permission':
        return fail(c, 409, 'このスプレッドシートを操作する権限がありません', { code: 'no_permission' });
      case 'rate_limited':
        return fail(c, 503, 'Googleの利用上限に達しました。しばらくしてから確認してください', { code: 'rate_limited' });
      case 'not_found':
        return fail(c, 404, '指定したスプレッドシートが見つかりません', { code: 'not_found' });
      case 'unavailable':
        return fail(c, 502, 'Googleに接続できません。あとで確認してください', { code: 'unavailable' });
      default:
        return fail(c, 502, 'Googleとの通信に失敗しました', { code: error.kind });
    }
  }
  console.error('[google-sheets] unexpected failure', { name: error instanceof Error ? error.name : 'UnknownError' });
  return fail(c, 500, '予期しないエラーが発生しました');
}

// ---------- 状態 ----------

googleSheets.get('/api/integrations/google-sheets/connection', requireRole('owner', 'admin'), async (c) => {
  const selected = await visibleAccount(c);
  if (!selected) return fail(c, 404, 'Not found');
  const integration = await integrationFor(c, selected);
  const db = dbFor(c.env);
  const counts = await db.prepare(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END), 0) AS running
       FROM google_sheets_sync_runs WHERE integration_id = ?`,
  ).bind(integration?.id ?? '').first<{ total: number; running: number }>();
  return c.json({
    success: true,
    connection: publicIntegration(integration),
    oauthConfigured: Boolean(sheetsOauthClient(c.env, 'https://localhost/unused')),
    syncRunning: Number(counts?.running ?? 0) > 0,
    canManage: await canManageIntegration(c),
  });
});

googleSheets.get('/api/integrations/google-sheets/runs', requireRole('owner', 'admin'), async (c) => {
  const selected = await visibleAccount(c);
  if (!selected) return fail(c, 404, 'Not found');
  const integration = await integrationFor(c, selected);
  if (!integration) return c.json({ success: true, runs: [] });
  const rows = await dbFor(c.env)
    .prepare(
      `SELECT id, kind, data_type, status, rows_written, error, started_at, finished_at
         FROM google_sheets_sync_runs
        WHERE integration_id = ? ORDER BY started_at DESC LIMIT 10`,
    )
    .bind(integration.id)
    .all<{
      id: string; kind: string; data_type: string; status: string;
      rows_written: number; error: string | null; started_at: string; finished_at: string | null;
    }>();
  return c.json({
    success: true,
    runs: rows.results.map((row) => ({
      id: row.id,
      kind: row.kind,
      dataType: row.data_type,
      status: row.status,
      rowsWritten: row.rows_written,
      error: row.error,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
    })),
  });
});

// ---------- OAuth ----------

googleSheets.post('/api/integrations/google-sheets/connect/start', requireIntegrationManager, async (c) => {
  const client = oauthClientFor(c);
  if (!client) return fail(c, 503, 'Google接続の設定（OAuthクライアント）がこの環境にありません', { code: 'oauth_not_configured' });
  const body = await c.req.json<{ accountId?: string }>().catch(() => ({}) as { accountId?: string });
  const selected = body.accountId?.trim() || accountId(c);
  if (!selected) return fail(c, 400, 'LINEアカウントを指定してください');
  const scope = await getVisibleLineAccountScope(dbFor(c.env), c.get('staff'));
  if (!scope.ids.includes(selected)) return fail(c, 404, 'Not found');
  const existing = await integrationFor(c, selected);
  const mode = existing && existing.status !== 'pending_target' ? 'reconnect' : 'connect';

  let verifierEnc: string;
  const verifier = createCodeVerifier();
  try {
    verifierEnc = await encryptCredential(verifier, c.env.LINE_CREDENTIAL_ENCRYPTION_KEY);
  } catch (error) {
    return sheetsErrorResponse(c, error);
  }
  const state = randomToken(32);
  const expiresAt = new Date(Date.now() + OAUTH_STATE_MAX_AGE_SEC * 1000).toISOString();
  await dbFor(c.env)
    .prepare(
      `INSERT INTO google_sheets_oauth_states (state, line_account_id, staff_id, mode, code_verifier_enc, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(state, selected, c.get('staff')!.id, mode, verifierEnc, expiresAt)
    .run();
  c.header('Set-Cookie', stateCookie(state));
  auditLog(c, 'google.sheets.connect.start', { id: selected, kind: 'google_sheets_integration' }, { lineAccountId: selected });
  return c.json({
    success: true,
    mode,
    authorizeUrl: buildAuthorizeUrl({
      clientId: client.clientId,
      redirectUri: client.redirectUri,
      state,
      codeChallenge: await codeChallengeFor(verifier),
      loginHint: existing?.google_account_email ?? null,
      scopes: GOOGLE_SHEETS_SCOPES,
    }),
  });
});

/**
 * Googleからの戻り。DBのstateを管理画面のログイン担当者へ結び付け、
 * 1回使い切り・10分失効で検証してから保存する。
 * 管理画面（pages.dev）からWorker（workers.dev）への認可開始はクロスサイト通信に
 * なるためCookieが届かないことがある。届けば追加検査として一致を必須にし、
 * 届かなくてもDB上の高エントロピーstate・担当者・期限・未使用が合えば続行する。
 */
googleSheets.get('/api/integrations/google-sheets/oauth/callback', requireIntegrationManager, async (c) => {
  c.header('Set-Cookie', stateCookie('', 0));
  const state = c.req.query('state') ?? '';
  const code = c.req.query('code') ?? '';
  const cookieState = readCookie(c.req.header('cookie'), OAUTH_STATE_COOKIE);
  const stateRow = state
    ? await dbFor(c.env)
        .prepare('SELECT * FROM google_sheets_oauth_states WHERE state = ? LIMIT 1')
        .bind(state)
        .first<{
          state: string; line_account_id: string; staff_id: string;
          mode: 'connect' | 'reconnect'; code_verifier_enc: string;
          expires_at: string; used_at: string | null;
        }>()
    : null;
  const lineAccountId = stateRow?.line_account_id ?? null;

  if (!stateRow || (cookieState !== null && cookieState !== state) || stateRow.used_at || Date.parse(stateRow.expires_at) < Date.now()) {
    return c.redirect(adminReturnUrl(c, lineAccountId, 'error:invalid_state'));
  }
  if (stateRow.staff_id !== c.get('staff')!.id) {
    return c.redirect(adminReturnUrl(c, lineAccountId, 'error:invalid_state'));
  }
  await dbFor(c.env).prepare('UPDATE google_sheets_oauth_states SET used_at = ? WHERE state = ?').bind(nowIso(), state).run();
  if (c.req.query('error') || !code) {
    return c.redirect(adminReturnUrl(c, lineAccountId, 'error:denied'));
  }
  // 発行時のアカウントが今もこの担当者の統括に属しているか。
  const account = await dbFor(c.env)
    .prepare(
      `SELECT id FROM line_accounts
        WHERE id = ? AND COALESCE(tenant_id, ?) = ? AND is_active = 1 AND archived_at IS NULL
        LIMIT 1`,
    )
    .bind(lineAccountId, DEFAULT_TENANT_ID, staffTenantId(c))
    .first<{ id: string }>();
  if (!account) return c.redirect(adminReturnUrl(c, lineAccountId, 'error:account_missing'));

  const client = oauthClientFor(c);
  if (!client) return c.redirect(adminReturnUrl(c, lineAccountId, 'error:oauth_not_configured'));
  const key = c.env.LINE_CREDENTIAL_ENCRYPTION_KEY;
  try {
    const tokens = await exchangeAuthorizationCode({
      client, code, codeVerifier: await decryptCredential(stateRow.code_verifier_enc, key), fetch,
    });
    const email = await fetchAccountEmail({ fetch, accessToken: tokens.accessToken });
    const existing = lineAccountId ? await integrationFor(c, lineAccountId) : null;
    const refreshEnc = tokens.refreshToken
      ? await encryptCredential(tokens.refreshToken, key)
      : existing?.refresh_token_enc ?? null;
    if (!refreshEnc) {
      // access_type=offline + prompt=consent でも refresh_token が来ないときは
      // Googleアカウント側の許可済み状態が原因。再接続しても直らないので案内する。
      return c.redirect(adminReturnUrl(c, lineAccountId, 'error:no_refresh_token'));
    }
    const now = nowIso();
    await dbFor(c.env)
      .prepare(
        `INSERT INTO google_sheets_integrations
           (id, line_account_id, tenant_id, google_account_email, refresh_token_enc,
            status, connected_by_staff_id, connected_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending_target', ?, ?, ?, ?)
         ON CONFLICT(line_account_id) DO UPDATE SET
           tenant_id = excluded.tenant_id,
           google_account_email = excluded.google_account_email,
           refresh_token_enc = excluded.refresh_token_enc,
           status = CASE
             WHEN google_sheets_integrations.spreadsheet_id IS NOT NULL THEN 'connected'
             ELSE 'pending_target'
           END,
           connected_by_staff_id = excluded.connected_by_staff_id,
           connected_at = excluded.connected_at,
           last_sync_error = NULL,
           updated_at = excluded.updated_at`,
      )
      .bind(crypto.randomUUID(), lineAccountId, staffTenantId(c), email, refreshEnc, c.get('staff')!.id, now, now, now)
      .run();
    auditLog(c, stateRow.mode === 'reconnect' ? 'google.sheets.reconnect' : 'google.sheets.connect', { id: lineAccountId, kind: 'google_sheets_integration' }, { lineAccountId });
    return c.redirect(adminReturnUrl(c, lineAccountId, stateRow.mode === 'reconnect' ? 'reconnected' : 'connected'));
  } catch (error) {
    const code = error instanceof GoogleBusinessError ? error.kind : error instanceof CredentialEncryptionKeyError ? 'encryption_key_missing' : 'unknown';
    console.error('[google-sheets] oauth callback failed', { code });
    return c.redirect(adminReturnUrl(c, lineAccountId, `error:${code}`));
  }
});

googleSheets.post('/api/integrations/google-sheets/disconnect', requireIntegrationManager, async (c) => {
  const body = await c.req.json<{ accountId?: string; confirmed?: boolean }>().catch(() => ({}) as { accountId?: string; confirmed?: boolean });
  if (body.confirmed !== true) return fail(c, 400, '確認が必要です', { code: 'confirmation_required' });
  const selected = body.accountId?.trim() || accountId(c);
  if (!selected) return fail(c, 400, 'LINEアカウントを指定してください');
  const integration = await integrationFor(c, selected);
  if (!integration) return fail(c, 409, '接続されていません', { code: 'not_connected' });
  let revoked = false;
  try {
    revoked = await revokeToken({
      token: await decryptCredential(integration.refresh_token_enc, c.env.LINE_CREDENTIAL_ENCRYPTION_KEY),
      fetch,
    });
  } catch {
    revoked = false;
  }
  // 要件 #838 §2: 切断は行ごと消す。同期履歴も CASCADE で消える。
  await dbFor(c.env).prepare('DELETE FROM google_sheets_integrations WHERE id = ?').bind(integration.id).run();
  auditLog(c, 'google.sheets.disconnect', { id: selected, kind: 'google_sheets_integration' }, { lineAccountId: selected });
  return c.json({ success: true, revoked, connection: publicIntegration(null) });
});

// ---------- 出力先 ----------

googleSheets.put('/api/integrations/google-sheets/target', requireIntegrationManager, async (c) => {
  const body = await c.req.json<{ accountId?: string; spreadsheet?: string }>().catch(() => ({}) as { accountId?: string; spreadsheet?: string });
  const selected = body.accountId?.trim() || accountId(c);
  if (!selected) return fail(c, 400, 'LINEアカウントを指定してください');
  const spreadsheetId = parseSpreadsheetId(body.spreadsheet ?? '');
  if (!spreadsheetId) {
    return fail(c, 400, 'スプレッドシートのURLまたはIDの形が違います', { code: 'invalid_spreadsheet' });
  }
  const integration = await integrationFor(c, selected);
  if (!integration || integration.status === 'expired') {
    return fail(c, 409, 'Googleアカウントが接続されていません', { code: 'not_connected' });
  }
  try {
    // 保存前に実際に開けるか確認する。権限が無いIDを登録させない。
    const accessToken = await sheetsAccessToken(c.env, integration, fetch);
    const title = await fetchSpreadsheetTitle({ fetch, accessToken }, spreadsheetId);
    await dbFor(c.env)
      .prepare(
        `UPDATE google_sheets_integrations
            SET spreadsheet_id = ?, spreadsheet_title = ?, status = 'connected', last_sync_error = NULL, updated_at = ?
          WHERE id = ?`,
      )
      .bind(spreadsheetId, title, nowIso(), integration.id)
      .run();
    auditLog(c, 'google.sheets.target.update', { id: integration.id, kind: 'google_sheets_integration' }, { lineAccountId: selected });
    return c.json({ success: true, connection: publicIntegration(await integrationFor(c, selected)) });
  } catch (error) {
    return sheetsErrorResponse(c, error);
  }
});

// ---------- 同期 ----------

googleSheets.post('/api/integrations/google-sheets/sync', requireIntegrationManager, async (c) => {
  const body = await c.req.json<{ accountId?: string }>().catch(() => ({}) as { accountId?: string });
  const selected = body.accountId?.trim() || accountId(c);
  if (!selected) return fail(c, 400, 'LINEアカウントを指定してください');
  const integration = await integrationFor(c, selected);
  if (!integration || !integration.spreadsheet_id) {
    return fail(c, 409, 'Googleアカウントまたは出力先が設定されていません', { code: 'not_ready' });
  }
  if (integration.status === 'expired') {
    return fail(c, 409, 'Googleとの接続を確認してください（認可切れ）', { code: 'auth_expired' });
  }
  auditLog(c, 'google.sheets.sync', { id: integration.id, kind: 'google_sheets_integration' }, { lineAccountId: selected });
  try {
    const results = await syncGoogleSheetsIntegration(c.env, integration, {
      kind: 'manual',
      now: nowIso(),
      deadlineMs: Date.now() + MANUAL_SYNC_BUDGET_MS,
    });
    const status = results.every((r) => r.status === 'ok')
      ? 'ok'
      : results.some((r) => r.status === 'ok' || r.status === 'partial')
        ? 'partial'
        : results.every((r) => r.status === 'already_running')
          ? 'already_running'
          : 'error';
    return c.json({ success: status !== 'error', status, results });
  } catch (error) {
    return sheetsErrorResponse(c, error);
  }
});
