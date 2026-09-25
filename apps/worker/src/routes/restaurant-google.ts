/**
 * 飲食店向け「Googleビジネス」第1段：設定（Google接続）と口コミ。
 *
 * - 1店舗（rt_stores）＝1 LINE公式アカウント（rt_stores.line_account_id）＝1 Googleロケーション。
 * - 店舗は必ず account_id → rt_stores.line_account_id と担当者の統括（tenant）で引く。組織IDだけで信用しない。
 * - Googleとの通信は services/google-business.ts に閉じ込め、この層はDBと権限だけを扱う。
 * - Googleへの書き込みは GOOGLE_BUSINESS_WRITE_ENABLED=true の環境でしか行わない（検証・本番の環境分離）。
 * - トークンは暗号化して保存し、応答・ログに平文を出さない。
 */
import { Hono } from 'hono';
import type { Context, MiddlewareHandler } from 'hono';
import { CredentialEncryptionKeyError, decryptCredential, encryptCredential } from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { auditLog } from '../lib/audit-log.js';
import { restaurantTestEnabled } from '../lib/environment-features.js';
import { DEFAULT_TENANT_ID } from '../lib/tenant.js';
import { getVisibleLineAccountScope } from '../services/account-access.js';
import { dbFor } from '../services/db-router.js';
import {
  GoogleBusinessError,
  buildAuthorizeUrl,
  buildReplyDraftPrompt,
  codeChallengeFor,
  createCodeVerifier,
  exchangeAuthorizationCode,
  fetchAccountEmail,
  getReview,
  listAllReviews,
  listManageableLocations,
  randomToken,
  refreshAccessToken,
  revokeToken,
  updateReviewReply,
  validateReplyText,
  type GoogleLocation,
  type GoogleOAuthClient,
  type GoogleReview,
  type RequestOptions,
} from '../services/google-business.js';

export const restaurantGoogle = new Hono<Env>();

const OAUTH_STATE_COOKIE = 'lh_gb_state';
const OAUTH_STATE_MAX_AGE_SEC = 600;
const CALLBACK_PATH = '/api/restaurant-test/google/oauth/callback';
const ADMIN_RETURN_PATH = '/restaurant-test/google';
/** 画面を開いたとき、最終同期からこの時間を過ぎていれば同期を勧める。 */
export const SYNC_STALE_AFTER_MS = 10 * 60 * 1000;
const DEFAULT_AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const AI_TIMEOUT_MS = 45_000;
const REVIEWS_PAGE_SIZE_MAX = 100;

type ConnectionStatus = 'pending_location' | 'connected' | 'expired' | 'no_permission' | 'disconnected';
type ReplyStatus = 'unreplied' | 'draft' | 'pending_confirm' | 'replied' | 'published';

/**
 * Google接続は統括の設定。owner は常に許可し、admin はDB上で
 * 「全アカウント担当」が明示されている場合だけ許可する。
 * `can_access_descendant_accounts` は親子階層の範囲を表す別の権限であり、
 * 統括全体の接続管理可否には使わない。店舗限定の管理者へ接続権限を
 * 広げないため、行が無い・値が曖昧なら拒否する。
 */
async function canManageGoogleConnection(c: Context<Env>): Promise<boolean> {
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

async function googlePermissions(c: Context<Env>) {
  const staff = c.get('staff');
  return {
    canManageConnection: await canManageGoogleConnection(c),
    canPublishReply: staff?.role === 'owner' || staff?.role === 'admin',
  };
}

const requireConnectionManager: MiddlewareHandler<Env> = async (c, next) => {
  if (!await canManageGoogleConnection(c)) {
    return fail(c, 403, 'Googleアカウントの接続には統括の管理者権限が必要です');
  }
  return next();
};

interface StoreContext {
  id: string;
  name: string;
  organizationId: string;
  lineAccountId: string;
}

interface ConnectionRow {
  id: string;
  store_id: string;
  line_account_id: string | null;
  google_account_email: string | null;
  location_name: string | null;
  location_title: string | null;
  location_maps_url: string | null;
  refresh_token_enc: string | null;
  access_token_enc: string | null;
  access_token_expires_at: string | null;
  status: ConnectionStatus;
  connected_by_staff_id: string | null;
  connected_at: string | null;
  disconnected_at: string | null;
  last_synced_at: string | null;
  last_sync_error: string | null;
  average_rating: number | null;
  total_review_count: number | null;
}

interface ReviewRow {
  id: string;
  store_id: string;
  review_name: string;
  reviewer_display_name: string | null;
  star_rating: number;
  comment: string | null;
  create_time: string;
  update_time: string | null;
  needs_attention: number;
  reply_status: ReplyStatus;
  reply_draft: string | null;
  reply_draft_ai_generated: number;
  reply_draft_generated_at: string | null;
  reply_comment: string | null;
  reply_update_time: string | null;
  first_seen_at: string;
  updated_at: string;
}

class GoogleAiTimeout extends Error {
  constructor() {
    super('google_ai_timeout');
    this.name = 'GoogleAiTimeout';
  }
}

// ---------- env / helpers ----------

function oauthClient(c: Context<Env>): GoogleOAuthClient | null {
  const clientId = c.env.GOOGLE_BUSINESS_OAUTH_CLIENT_ID?.trim();
  const clientSecret = c.env.GOOGLE_BUSINESS_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, redirectUri: `${new URL(c.req.url).origin}${CALLBACK_PATH}` };
}

function writeEnabled(env: Env['Bindings']): boolean {
  return env.GOOGLE_BUSINESS_WRITE_ENABLED === 'true';
}

function accountId(c: Context<Env>): string | null {
  return c.req.query('account_id') || null;
}

function staffTenantId(c: Context<Env>): string {
  return c.get('staff')?.tenantId ?? DEFAULT_TENANT_ID;
}

function nowIso(): string {
  return new Date().toISOString();
}

function fail(c: Context<Env>, status: 400 | 401 | 403 | 404 | 409 | 500 | 502 | 503 | 504, error: string, extra: Record<string, unknown> = {}) {
  return c.json({ success: false, error, ...extra }, status);
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
  if (lineAccountId) url.searchParams.set('account_id', lineAccountId);
  url.searchParams.set('google', result);
  return url.toString();
}

/** account_id と担当者の統括から店舗を1つ引く。組織IDだけで引かない（アカウント分離の原則）。 */
async function storeFor(c: Context<Env>): Promise<StoreContext | null> {
  const lineAccountId = accountId(c);
  if (!lineAccountId) return null;
  const row = await dbFor(c.env)
    .prepare(
      `SELECT s.id, s.name, s.organization_id, s.line_account_id
       FROM rt_stores s
       JOIN rt_organizations o ON o.id = s.organization_id
       WHERE s.line_account_id = ? AND o.tenant_id = ?
       LIMIT 1`,
    )
    .bind(lineAccountId, staffTenantId(c))
    .first<{ id: string; name: string; organization_id: string; line_account_id: string }>();
  if (!row) return null;
  return { id: row.id, name: row.name, organizationId: row.organization_id, lineAccountId: row.line_account_id };
}

/**
 * 1つのLINE公式アカウントを1店舗として扱うGoogleビジネス画面向けの初期化。
 *
 * 可視範囲の検査は上流middlewareで済んでいるが、DB上にも同じtenantの有効な
 * LINEアカウントが存在することを再確認してから作る。tenant/LINEアカウントの
 * UNIQUE制約と INSERT OR IGNORE により、同時アクセスでも1件だけを採用する。
 */
async function ensureStoreForGoogle(c: Context<Env>): Promise<StoreContext | null> {
  const existing = await storeFor(c);
  if (existing) return existing;

  const lineAccountId = accountId(c);
  if (!lineAccountId) return null;
  const tenantId = staffTenantId(c);
  const db = dbFor(c.env);
  const lineAccount = await db
    .prepare(
      `SELECT id, name
       FROM line_accounts
       WHERE id = ?
         AND COALESCE(tenant_id, ?) = ?
         AND is_active = 1
         AND archived_at IS NULL
       LIMIT 1`,
    )
    .bind(lineAccountId, DEFAULT_TENANT_ID, tenantId)
    .first<{ id: string; name: string }>();
  if (!lineAccount) return null;

  let organization = await db
    .prepare('SELECT id FROM rt_organizations WHERE tenant_id = ? LIMIT 1')
    .bind(tenantId)
    .first<{ id: string }>();
  if (!organization) {
    const tenant = await db
      .prepare('SELECT name FROM tenants WHERE id = ? LIMIT 1')
      .bind(tenantId)
      .first<{ name: string }>();
    if (!tenant) return null;
    await db
      .prepare(
        `INSERT OR IGNORE INTO rt_organizations (id, account_id, tenant_id, name, status)
         VALUES (?, ?, ?, ?, 'active')`,
      )
      .bind(crypto.randomUUID(), tenantId, tenantId, tenant.name)
      .run();
    organization = await db
      .prepare('SELECT id FROM rt_organizations WHERE tenant_id = ? LIMIT 1')
      .bind(tenantId)
      .first<{ id: string }>();
  }
  if (!organization) return null;

  const storeId = crypto.randomUUID();
  const inserted = await db
    .prepare(
      `INSERT OR IGNORE INTO rt_stores
         (id, organization_id, name, code, capacity, timezone, line_account_id)
       VALUES (?, ?, ?, ?, 0, 'Asia/Tokyo', ?)`,
    )
    .bind(storeId, organization.id, lineAccount.name, `line-${lineAccount.id}`, lineAccount.id)
    .run();
  const store = await storeFor(c);
  if (store && Number(inserted.meta.changes ?? 0) > 0) {
    auditLog(c, 'restaurant.google.store.bootstrap', { id: store.id, kind: 'rt_store' }, { lineAccountId: store.lineAccountId });
  }
  return store;
}

async function connectionFor(c: Context<Env>, storeId: string): Promise<ConnectionRow | null> {
  return dbFor(c.env, storeId)
    .prepare('SELECT * FROM rt_google_connections WHERE store_id = ? LIMIT 1')
    .bind(storeId)
    .first<ConnectionRow>();
}

function publicConnection(row: ConnectionRow | null) {
  if (!row) return { status: 'disconnected' as ConnectionStatus };
  return {
    status: row.status,
    googleAccountEmail: row.google_account_email,
    locationName: row.location_name,
    locationTitle: row.location_title,
    locationMapsUrl: row.location_maps_url,
    connectedAt: row.connected_at,
    disconnectedAt: row.disconnected_at,
    lastSyncedAt: row.last_synced_at,
    lastSyncError: row.last_sync_error,
    averageRating: row.average_rating,
    totalReviewCount: row.total_review_count,
  };
}

function publicReview(row: ReviewRow) {
  return {
    id: row.id,
    reviewName: row.review_name,
    reviewerDisplayName: row.reviewer_display_name,
    starRating: row.star_rating,
    comment: row.comment,
    createTime: row.create_time,
    updateTime: row.update_time,
    needsAttention: row.needs_attention === 1,
    replyStatus: row.reply_status,
    replyDraft: row.reply_draft,
    replyDraftAiGenerated: row.reply_draft_ai_generated === 1,
    replyDraftGeneratedAt: row.reply_draft_generated_at,
    replyComment: row.reply_comment,
    replyUpdateTime: row.reply_update_time,
    firstSeenAt: row.first_seen_at,
    updatedAt: row.updated_at,
  };
}

async function setConnectionStatus(c: Context<Env>, storeId: string, status: ConnectionStatus, error?: string | null): Promise<void> {
  await dbFor(c.env, storeId)
    .prepare(`UPDATE rt_google_connections SET status = ?, last_sync_error = COALESCE(?, last_sync_error), updated_at = ? WHERE store_id = ?`)
    .bind(status, error ?? null, nowIso(), storeId)
    .run();
}

async function writeLog(
  c: Context<Env>,
  storeId: string,
  input: { kind: 'review_reply' | 'connect' | 'reconnect' | 'disconnect'; targetName?: string | null; beforeText?: string | null; afterText?: string | null; requestId?: string | null; result: 'accepted' | 'failed' | 'unknown'; error?: string | null },
): Promise<void> {
  await dbFor(c.env, storeId)
    .prepare(
      `INSERT INTO rt_google_write_log (id, store_id, kind, target_name, staff_id, before_text, after_text, request_id, result, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      storeId,
      input.kind,
      input.targetName ?? null,
      c.get('staff')?.id ?? null,
      input.beforeText ?? null,
      input.afterText ?? null,
      input.requestId ?? null,
      input.result,
      input.error ?? null,
    )
    .run();
}

/**
 * 有効なアクセストークンを返す。期限が近ければ更新して保存する。
 * 更新に失敗（invalid_grant）したら接続状態を expired にして例外を投げる。
 */
async function accessTokenFor(c: Context<Env>, connection: ConnectionRow): Promise<string> {
  const key = c.env.LINE_CREDENTIAL_ENCRYPTION_KEY;
  const expiresAt = connection.access_token_expires_at ? Date.parse(connection.access_token_expires_at) : 0;
  if (connection.access_token_enc && expiresAt > Date.now() + 60_000) {
    return decryptCredential(connection.access_token_enc, key);
  }
  if (!connection.refresh_token_enc) throw new GoogleBusinessError('auth_expired', null, 'google_refresh_token_missing');
  const client = oauthClient(c);
  if (!client) throw new GoogleBusinessError('unavailable', null, 'google_oauth_not_configured');
  try {
    const tokens = await refreshAccessToken({ client, refreshToken: await decryptCredential(connection.refresh_token_enc, key), fetch });
    await dbFor(c.env, connection.store_id)
      .prepare(
        `UPDATE rt_google_connections
         SET access_token_enc = ?, access_token_expires_at = ?, refresh_token_enc = ?, updated_at = ?
         WHERE store_id = ?`,
      )
      .bind(
        await encryptCredential(tokens.accessToken, key),
        new Date(tokens.expiresAtMs).toISOString(),
        tokens.refreshToken ? await encryptCredential(tokens.refreshToken, key) : connection.refresh_token_enc,
        nowIso(),
        connection.store_id,
      )
      .run();
    return tokens.accessToken;
  } catch (error) {
    if (error instanceof GoogleBusinessError && error.kind === 'auth_expired') {
      await setConnectionStatus(c, connection.store_id, 'expired', 'auth_expired');
    }
    throw error;
  }
}

function googleErrorResponse(c: Context<Env>, error: unknown) {
  if (error instanceof CredentialEncryptionKeyError) {
    return fail(c, 503, 'トークン暗号化キーが設定されていません', { code: 'encryption_key_missing' });
  }
  if (error instanceof GoogleBusinessError) {
    switch (error.kind) {
      case 'auth_expired':
        return fail(c, 409, 'Googleとの接続を確認してください（認可切れ）', { code: 'auth_expired' });
      case 'no_permission':
        return fail(c, 409, 'この店舗を操作する権限がありません', { code: 'no_permission' });
      case 'rate_limited':
        return fail(c, 503, 'Googleの利用上限に達しました。しばらくしてから確認してください', { code: 'rate_limited' });
      case 'not_found':
        return fail(c, 404, 'Google側に対象が見つかりません', { code: 'not_found' });
      case 'unavailable':
        return fail(c, 502, 'Googleに接続できません。あとで確認してください', { code: 'unavailable' });
      default:
        return fail(c, 502, 'Googleとの通信に失敗しました', { code: error.kind });
    }
  }
  console.error('[restaurant-google] unexpected failure', { name: error instanceof Error ? error.name : 'UnknownError' });
  return fail(c, 500, '予期しないエラーが発生しました');
}

async function requireConnectedStore(c: Context<Env>): Promise<{ store: StoreContext; connection: ConnectionRow } | Response> {
  const store = await storeFor(c);
  if (!store) return fail(c, 404, 'このLINEアカウントに店舗が紐付いていません');
  const connection = await connectionFor(c, store.id);
  if (!connection || connection.status === 'disconnected' || connection.status === 'pending_location' || !connection.location_name) {
    return fail(c, 409, 'Googleアカウントが接続されていません', { code: 'not_connected' });
  }
  return { store, connection };
}

async function reviewFor(c: Context<Env>, storeId: string, id: string): Promise<ReviewRow | null> {
  return dbFor(c.env, storeId)
    .prepare('SELECT * FROM rt_google_reviews WHERE id = ? AND store_id = ? LIMIT 1')
    .bind(id, storeId)
    .first<ReviewRow>();
}

// ---------- access guard（restaurant-test.ts と同じ3点検査） ----------

restaurantGoogle.use('/api/restaurant-test/google/*', async (c, next) => {
  if (!restaurantTestEnabled(c.env)) return fail(c, 404, 'Not found');
  const requestedTenant = c.req.query('tenant_id');
  if (requestedTenant && requestedTenant !== staffTenantId(c)) {
    return fail(c, 403, 'この統括を操作する権限がありません');
  }
  const selectedAccount = accountId(c);
  if (!selectedAccount) return next();
  const scope = await getVisibleLineAccountScope(dbFor(c.env), c.get('staff'));
  if (!scope.ids.includes(selectedAccount)) {
    return fail(c, 403, 'このLINEアカウントを操作する権限がありません');
  }
  return next();
});

// ---------- 設定タブ ----------

restaurantGoogle.get('/api/restaurant-test/google/connection', async (c) => {
  const store = await ensureStoreForGoogle(c);
  if (!store) return fail(c, 404, 'このLINEアカウントに店舗が紐付いていません');
  const connection = await connectionFor(c, store.id);
  const db = dbFor(c.env, store.id);
  const counts = await db
    .prepare(
      `SELECT
         SUM(CASE WHEN reply_status IN ('unreplied', 'draft') THEN 1 ELSE 0 END) AS unreplied,
         SUM(CASE WHEN reply_status = 'draft' THEN 1 ELSE 0 END) AS drafts,
         SUM(CASE WHEN needs_attention = 1 THEN 1 ELSE 0 END) AS attention,
         SUM(CASE WHEN first_seen_at >= COALESCE(?, '') THEN 1 ELSE 0 END) AS new_count,
         COUNT(*) AS stored
       FROM rt_google_reviews WHERE store_id = ?`,
    )
    .bind(connection?.last_synced_at ? new Date(Date.parse(connection.last_synced_at) - 24 * 3600 * 1000).toISOString() : null, store.id)
    .first<{ unreplied: number | null; drafts: number | null; attention: number | null; new_count: number | null; stored: number }>();
  const candidates =
    connection?.status === 'pending_location'
      ? (
          await db
            .prepare('SELECT location_name, location_title, address_text FROM rt_google_location_candidates WHERE store_id = ? ORDER BY location_title')
            .bind(store.id)
            .all<{ location_name: string; location_title: string; address_text: string | null }>()
        ).results.map((row) => ({ locationName: row.location_name, locationTitle: row.location_title, addressText: row.address_text }))
      : [];
  const lastSyncedMs = connection?.last_synced_at ? Date.parse(connection.last_synced_at) : 0;
  return c.json({
    success: true,
    store: { id: store.id, name: store.name, lineAccountId: store.lineAccountId },
    connection: publicConnection(connection),
    candidates,
    summary: {
      unrepliedCount: counts?.unreplied ?? 0,
      draftCount: counts?.drafts ?? 0,
      attentionCount: counts?.attention ?? 0,
      newCount: counts?.new_count ?? 0,
      storedCount: counts?.stored ?? 0,
      syncStale: !lastSyncedMs || Date.now() - lastSyncedMs > SYNC_STALE_AFTER_MS,
    },
    writeEnabled: writeEnabled(c.env),
    oauthConfigured: Boolean(oauthClient(c)),
    aiAvailable: Boolean(c.env.AI),
    permissions: await googlePermissions(c),
  });
});

restaurantGoogle.post('/api/restaurant-test/google/connect/start', requireConnectionManager, async (c) => {
  const client = oauthClient(c);
  if (!client) return fail(c, 503, 'Google接続の設定（OAuthクライアント）がこの環境にありません', { code: 'oauth_not_configured' });
  const store = await ensureStoreForGoogle(c);
  if (!store) return fail(c, 404, 'このLINEアカウントに店舗が紐付いていません');
  const existing = await connectionFor(c, store.id);
  const mode = existing?.status === 'connected' || existing?.status === 'expired' || existing?.status === 'no_permission' ? 'reconnect' : 'connect';

  let verifierEnc: string;
  const verifier = createCodeVerifier();
  try {
    verifierEnc = await encryptCredential(verifier, c.env.LINE_CREDENTIAL_ENCRYPTION_KEY);
  } catch (error) {
    return googleErrorResponse(c, error);
  }
  const state = randomToken(32);
  const expiresAt = new Date(Date.now() + OAUTH_STATE_MAX_AGE_SEC * 1000).toISOString();
  await dbFor(c.env, store.id)
    .prepare(
      `INSERT INTO rt_google_oauth_states (state, store_id, line_account_id, staff_id, mode, code_verifier_enc, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(state, store.id, store.lineAccountId, c.get('staff')!.id, mode, verifierEnc, expiresAt)
    .run();
  c.header('Set-Cookie', stateCookie(state));
  auditLog(c, 'restaurant.google.connect.start', { id: store.id, kind: 'rt_store' }, { lineAccountId: store.lineAccountId });
  return c.json({
    success: true,
    mode,
    authorizeUrl: buildAuthorizeUrl({
      clientId: client.clientId,
      redirectUri: client.redirectUri,
      state,
      codeChallenge: await codeChallengeFor(verifier),
      loginHint: existing?.google_account_email ?? null,
    }),
  });
});

/**
 * Googleからの戻り。DBのstateを管理画面のログイン担当者へ結び付け、
 * 1回使い切り・10分失効で検証してから保存する。
 *
 * 管理画面（pages.dev）からWorker（workers.dev）への認可開始はクロスサイト通信に
 * なるため、ブラウザのCookie制限によってstate Cookieが保存されない場合がある。
 * Cookieが届いた場合は追加検査として一致を必須にする一方、届かない場合も
 * DB上の高エントロピーstate・担当者・期限・未使用の全条件が一致すれば続行する。
 */
restaurantGoogle.get('/api/restaurant-test/google/oauth/callback', requireConnectionManager, async (c) => {
  c.header('Set-Cookie', stateCookie('', 0));
  const state = c.req.query('state') ?? '';
  const code = c.req.query('code') ?? '';
  const cookieState = readCookie(c.req.header('cookie'), OAUTH_STATE_COOKIE);
  const stateRow = state
    ? await dbFor(c.env)
        .prepare('SELECT * FROM rt_google_oauth_states WHERE state = ? LIMIT 1')
        .bind(state)
        .first<{ state: string; store_id: string; line_account_id: string | null; staff_id: string; mode: 'connect' | 'reconnect'; code_verifier_enc: string; expires_at: string; used_at: string | null }>()
    : null;
  const lineAccountId = stateRow?.line_account_id ?? null;

  if (!stateRow || (cookieState !== null && cookieState !== state) || stateRow.used_at || Date.parse(stateRow.expires_at) < Date.now()) {
    return c.redirect(adminReturnUrl(c, lineAccountId, 'error:invalid_state'));
  }
  if (stateRow.staff_id !== c.get('staff')!.id) {
    return c.redirect(adminReturnUrl(c, lineAccountId, 'error:invalid_state'));
  }
  await dbFor(c.env, stateRow.store_id).prepare('UPDATE rt_google_oauth_states SET used_at = ? WHERE state = ?').bind(nowIso(), state).run();
  if (c.req.query('error') || !code) {
    return c.redirect(adminReturnUrl(c, lineAccountId, 'error:denied'));
  }
  // 店舗が今もこの担当者の統括に属しているか（stateの発行後に変わっていないか）。
  const store = await dbFor(c.env, stateRow.store_id)
    .prepare(`SELECT s.id, s.name, s.organization_id, s.line_account_id FROM rt_stores s JOIN rt_organizations o ON o.id = s.organization_id WHERE s.id = ? AND o.tenant_id = ? LIMIT 1`)
    .bind(stateRow.store_id, staffTenantId(c))
    .first<{ id: string; name: string; organization_id: string; line_account_id: string | null }>();
  if (!store) return c.redirect(adminReturnUrl(c, lineAccountId, 'error:store_missing'));

  const client = oauthClient(c);
  if (!client) return c.redirect(adminReturnUrl(c, lineAccountId, 'error:oauth_not_configured'));
  const key = c.env.LINE_CREDENTIAL_ENCRYPTION_KEY;
  const db = dbFor(c.env, store.id);
  try {
    const tokens = await exchangeAuthorizationCode({ client, code, codeVerifier: await decryptCredential(stateRow.code_verifier_enc, key), fetch });
    const options: RequestOptions = { fetch, accessToken: tokens.accessToken };
    const email = await fetchAccountEmail(options);
    const locations = await listManageableLocations(options);
    const existing = await connectionFor(c, store.id);
    const refreshEnc = tokens.refreshToken ? await encryptCredential(tokens.refreshToken, key) : existing?.refresh_token_enc ?? null;
    const accessEnc = await encryptCredential(tokens.accessToken, key);
    const accessExpires = new Date(tokens.expiresAtMs).toISOString();

    if (stateRow.mode === 'reconnect' && existing?.location_name) {
      const same = locations.find((location) => location.name === existing.location_name);
      if (!same) {
        await writeLog(c, store.id, { kind: 'reconnect', targetName: existing.location_name, result: 'failed', error: 'location_mismatch' });
        return c.redirect(adminReturnUrl(c, lineAccountId, 'error:location_mismatch'));
      }
      await db
        .prepare(
          `UPDATE rt_google_connections
           SET google_account_email = ?, location_title = ?, location_maps_url = COALESCE(?, location_maps_url),
               refresh_token_enc = ?, access_token_enc = ?, access_token_expires_at = ?,
               status = 'connected', connected_by_staff_id = ?, connected_at = ?, disconnected_at = NULL,
               last_sync_error = NULL, updated_at = ?
           WHERE store_id = ?`,
        )
        .bind(email, same.title, same.mapsUri, refreshEnc, accessEnc, accessExpires, c.get('staff')!.id, nowIso(), nowIso(), store.id)
        .run();
      await writeLog(c, store.id, { kind: 'reconnect', targetName: same.name, result: 'accepted' });
      auditLog(c, 'restaurant.google.reconnect', { id: store.id, kind: 'rt_store' }, { lineAccountId });
      return c.redirect(adminReturnUrl(c, lineAccountId, 'reconnected'));
    }

    if (locations.length === 0) {
      return c.redirect(adminReturnUrl(c, lineAccountId, 'error:no_locations'));
    }
    const single: GoogleLocation | null = locations.length === 1 ? locations[0] : null;
    const status: ConnectionStatus = single ? 'connected' : 'pending_location';
    await db
      .prepare(
        `INSERT INTO rt_google_connections
           (id, store_id, line_account_id, google_account_email, location_name, location_title, location_maps_url,
            refresh_token_enc, access_token_enc, access_token_expires_at, status, connected_by_staff_id, connected_at, disconnected_at, last_sync_error, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)
         ON CONFLICT(store_id) DO UPDATE SET
           line_account_id = excluded.line_account_id,
           google_account_email = excluded.google_account_email,
           location_name = excluded.location_name,
           location_title = excluded.location_title,
           location_maps_url = excluded.location_maps_url,
           refresh_token_enc = excluded.refresh_token_enc,
           access_token_enc = excluded.access_token_enc,
           access_token_expires_at = excluded.access_token_expires_at,
           status = excluded.status,
           connected_by_staff_id = excluded.connected_by_staff_id,
           connected_at = excluded.connected_at,
           disconnected_at = NULL,
           last_sync_error = NULL,
           updated_at = excluded.updated_at`,
      )
      .bind(
        existing?.id ?? crypto.randomUUID(),
        store.id,
        store.line_account_id,
        email,
        single?.name ?? null,
        single?.title ?? null,
        single?.mapsUri ?? null,
        refreshEnc,
        accessEnc,
        accessExpires,
        status,
        c.get('staff')!.id,
        single ? nowIso() : null,
        nowIso(),
      )
      .run();
    await db.prepare('DELETE FROM rt_google_location_candidates WHERE store_id = ?').bind(store.id).run();
    if (!single) {
      const statements = locations.map((location) =>
        db
          .prepare('INSERT OR IGNORE INTO rt_google_location_candidates (id, store_id, location_name, location_title, address_text) VALUES (?, ?, ?, ?, ?)')
          .bind(crypto.randomUUID(), store.id, location.name, location.title, location.addressText),
      );
      await db.batch(statements);
      return c.redirect(adminReturnUrl(c, lineAccountId, 'select_location'));
    }
    await writeLog(c, store.id, { kind: 'connect', targetName: single.name, result: 'accepted' });
    auditLog(c, 'restaurant.google.connect', { id: store.id, kind: 'rt_store' }, { lineAccountId });
    return c.redirect(adminReturnUrl(c, lineAccountId, 'connected'));
  } catch (error) {
    const code = error instanceof GoogleBusinessError ? error.kind : error instanceof CredentialEncryptionKeyError ? 'encryption_key_missing' : 'unknown';
    console.error('[restaurant-google] oauth callback failed', { code });
    await writeLog(c, store.id, { kind: stateRow.mode, result: 'failed', error: code });
    return c.redirect(adminReturnUrl(c, lineAccountId, `error:${code}`));
  }
});

restaurantGoogle.post('/api/restaurant-test/google/connect/select-location', requireConnectionManager, async (c) => {
  const store = await storeFor(c);
  if (!store) return fail(c, 404, 'このLINEアカウントに店舗が紐付いていません');
  const connection = await connectionFor(c, store.id);
  if (!connection || connection.status !== 'pending_location') return fail(c, 409, '店舗の選択待ちではありません');
  const body = await c.req.json<{ locationName?: string }>().catch(() => ({}) as { locationName?: string });
  const locationName = body.locationName?.trim();
  if (!locationName) return fail(c, 400, 'locationName が必要です');
  const db = dbFor(c.env, store.id);
  const candidate = await db
    .prepare('SELECT location_name, location_title FROM rt_google_location_candidates WHERE store_id = ? AND location_name = ? LIMIT 1')
    .bind(store.id, locationName)
    .first<{ location_name: string; location_title: string }>();
  if (!candidate) return fail(c, 400, '選べる店舗ではありません');
  await db
    .prepare(
      `UPDATE rt_google_connections SET location_name = ?, location_title = ?, status = 'connected', connected_at = ?, updated_at = ? WHERE store_id = ?`,
    )
    .bind(candidate.location_name, candidate.location_title, nowIso(), nowIso(), store.id)
    .run();
  await db.prepare('DELETE FROM rt_google_location_candidates WHERE store_id = ?').bind(store.id).run();
  await writeLog(c, store.id, { kind: 'connect', targetName: candidate.location_name, result: 'accepted' });
  auditLog(c, 'restaurant.google.connect', { id: store.id, kind: 'rt_store' }, { lineAccountId: store.lineAccountId });
  return c.json({ success: true, connection: publicConnection(await connectionFor(c, store.id)) });
});

restaurantGoogle.post('/api/restaurant-test/google/disconnect', requireConnectionManager, async (c) => {
  const store = await storeFor(c);
  if (!store) return fail(c, 404, 'このLINEアカウントに店舗が紐付いていません');
  const body = await c.req.json<{ confirmed?: boolean }>().catch(() => ({}) as { confirmed?: boolean });
  if (body.confirmed !== true) return fail(c, 400, '確認が必要です', { code: 'confirmation_required' });
  const connection = await connectionFor(c, store.id);
  if (!connection || connection.status === 'disconnected') return fail(c, 409, '接続されていません');
  let revoked = false;
  try {
    if (connection.refresh_token_enc) {
      revoked = await revokeToken({ token: await decryptCredential(connection.refresh_token_enc, c.env.LINE_CREDENTIAL_ENCRYPTION_KEY), fetch });
    }
  } catch {
    revoked = false;
  }
  // 履歴（口コミ・下書き・記録）は残す。止めるのは同期と書き込みだけ。
  await dbFor(c.env, store.id)
    .prepare(
      `UPDATE rt_google_connections
       SET refresh_token_enc = NULL, access_token_enc = NULL, access_token_expires_at = NULL,
           status = 'disconnected', disconnected_at = ?, updated_at = ?
       WHERE store_id = ?`,
    )
    .bind(nowIso(), nowIso(), store.id)
    .run();
  await dbFor(c.env, store.id).prepare('DELETE FROM rt_google_location_candidates WHERE store_id = ?').bind(store.id).run();
  await writeLog(c, store.id, { kind: 'disconnect', targetName: connection.location_name, result: revoked ? 'accepted' : 'unknown', error: revoked ? null : 'revoke_failed' });
  auditLog(c, 'restaurant.google.disconnect', { id: store.id, kind: 'rt_store' }, { lineAccountId: store.lineAccountId });
  return c.json({ success: true, revoked, connection: publicConnection(await connectionFor(c, store.id)) });
});

// ---------- 口コミタブ ----------

async function upsertReviews(c: Context<Env>, storeId: string, reviews: GoogleReview[]): Promise<void> {
  const db = dbFor(c.env, storeId);
  const now = nowIso();
  const statements = reviews.map((review) =>
    db
      .prepare(
        `INSERT INTO rt_google_reviews
           (id, store_id, review_name, reviewer_display_name, star_rating, comment, create_time, update_time, needs_attention,
            reply_status, reply_comment, reply_update_time, first_seen_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(store_id, review_name) DO UPDATE SET
           reviewer_display_name = excluded.reviewer_display_name,
           star_rating = excluded.star_rating,
           comment = excluded.comment,
           update_time = excluded.update_time,
           needs_attention = excluded.needs_attention,
           reply_comment = excluded.reply_comment,
           reply_update_time = excluded.reply_update_time,
           reply_status = CASE
             WHEN excluded.reply_comment IS NOT NULL THEN 'published'
             WHEN rt_google_reviews.reply_status IN ('replied', 'pending_confirm', 'published') THEN 'unreplied'
             ELSE rt_google_reviews.reply_status END,
           updated_at = excluded.updated_at`,
      )
      .bind(
        crypto.randomUUID(),
        storeId,
        review.name,
        review.reviewerDisplayName,
        review.starRating,
        review.comment,
        review.createTime,
        review.updateTime,
        review.starRating <= 3 ? 1 : 0,
        review.reply ? 'published' : 'unreplied',
        review.reply?.comment ?? null,
        review.reply?.updateTime ?? null,
        now,
        now,
      ),
  );
  for (let index = 0; index < statements.length; index += 50) {
    await db.batch(statements.slice(index, index + 50));
  }
}

restaurantGoogle.post('/api/restaurant-test/google/reviews/sync', async (c) => {
  const ctx = await requireConnectedStore(c);
  if (ctx instanceof Response) return ctx;
  const { store, connection } = ctx;
  try {
    const accessToken = await accessTokenFor(c, connection);
    const result = await listAllReviews({ fetch, accessToken }, connection.location_name!);
    await upsertReviews(c, store.id, result.reviews);
    await dbFor(c.env, store.id)
      .prepare(
        `UPDATE rt_google_connections
         SET last_synced_at = ?, last_sync_error = ?, average_rating = COALESCE(?, average_rating),
             total_review_count = COALESCE(?, total_review_count), status = 'connected', updated_at = ?
         WHERE store_id = ?`,
      )
      .bind(nowIso(), result.complete ? null : 'partial', result.averageRating, result.totalReviewCount, nowIso(), store.id)
      .run();
    return c.json({
      success: true,
      fetched: result.reviews.length,
      complete: result.complete,
      averageRating: result.averageRating,
      totalReviewCount: result.totalReviewCount,
      syncedAt: nowIso(),
    });
  } catch (error) {
    if (error instanceof GoogleBusinessError) {
      if (error.kind === 'no_permission') await setConnectionStatus(c, store.id, 'no_permission', 'no_permission');
      else if (error.kind !== 'auth_expired') await setConnectionStatus(c, store.id, connection.status, error.kind);
    }
    return googleErrorResponse(c, error);
  }
});

restaurantGoogle.get('/api/restaurant-test/google/reviews', async (c) => {
  const store = await storeFor(c);
  if (!store) return fail(c, 404, 'このLINEアカウントに店舗が紐付いていません');
  const filter = c.req.query('filter') ?? 'unreplied';
  const rating = Number.parseInt(c.req.query('rating') ?? '', 10);
  const order = c.req.query('order') ?? 'newest';
  const q = (c.req.query('q') ?? '').trim();
  const page = Math.max(1, Number.parseInt(c.req.query('page') ?? '1', 10) || 1);
  const perPage = Math.min(REVIEWS_PAGE_SIZE_MAX, Math.max(1, Number.parseInt(c.req.query('per_page') ?? '20', 10) || 20));

  const where: string[] = ['store_id = ?'];
  const binds: unknown[] = [store.id];
  if (filter === 'unreplied') where.push(`reply_status IN ('unreplied', 'draft')`);
  else if (filter === 'draft') where.push(`reply_status = 'draft'`);
  else if (filter === 'attention') where.push('needs_attention = 1');
  else if (filter !== 'all') return fail(c, 400, 'filter が不正です');
  if (Number.isInteger(rating) && rating >= 1 && rating <= 5) {
    where.push('star_rating = ?');
    binds.push(rating);
  }
  if (q) {
    where.push('(comment LIKE ? OR reviewer_display_name LIKE ?)');
    binds.push(`%${q}%`, `%${q}%`);
  }
  const orderSql = order === 'oldest' ? 'create_time ASC' : order === 'rating_low' ? 'star_rating ASC, create_time DESC' : order === 'rating_high' ? 'star_rating DESC, create_time DESC' : 'create_time DESC';
  const db = dbFor(c.env, store.id);
  const total = await db.prepare(`SELECT COUNT(*) AS n FROM rt_google_reviews WHERE ${where.join(' AND ')}`).bind(...binds).first<{ n: number }>();
  const rows = await db
    .prepare(`SELECT * FROM rt_google_reviews WHERE ${where.join(' AND ')} ORDER BY ${orderSql} LIMIT ? OFFSET ?`)
    .bind(...binds, perPage, (page - 1) * perPage)
    .all<ReviewRow>();
  const connection = await connectionFor(c, store.id);
  return c.json({
    success: true,
    reviews: rows.results.map(publicReview),
    page,
    perPage,
    total: total?.n ?? 0,
    connection: publicConnection(connection),
  });
});

restaurantGoogle.get('/api/restaurant-test/google/reviews/:id', async (c) => {
  const store = await storeFor(c);
  if (!store) return fail(c, 404, 'このLINEアカウントに店舗が紐付いていません');
  const row = await reviewFor(c, store.id, c.req.param('id'));
  if (!row) return fail(c, 404, '口コミが見つかりません');
  const connection = await connectionFor(c, store.id);
  return c.json({ success: true, review: publicReview(row), store: { id: store.id, name: store.name }, connection: publicConnection(connection) });
});

function aiText(result: unknown): string {
  if (!result || typeof result !== 'object') return '';
  const value = result as { response?: unknown; choices?: Array<{ message?: { content?: unknown } }> };
  if (typeof value.response === 'string') return value.response.trim();
  const content = value.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content.trim() : '';
}

restaurantGoogle.post('/api/restaurant-test/google/reviews/:id/draft/generate', async (c) => {
  const store = await storeFor(c);
  if (!store) return fail(c, 404, 'このLINEアカウントに店舗が紐付いていません');
  const row = await reviewFor(c, store.id, c.req.param('id'));
  if (!row) return fail(c, 404, '口コミが見つかりません');
  if (row.reply_status === 'published' || row.reply_status === 'replied' || row.reply_status === 'pending_confirm') {
    return fail(c, 409, 'この口コミにはすでに返信があります', { code: 'already_replied' });
  }
  if (!c.env.AI) return fail(c, 503, 'AI下書きはこの環境では使えません', { code: 'ai_unavailable' });
  const body = await c.req.json<{ mode?: string }>().catch(() => ({}) as { mode?: string });
  const mode = body.mode === 'shorter' || body.mode === 'polite' ? body.mode : 'new';
  const connection = await connectionFor(c, store.id);
  const prompt = buildReplyDraftPrompt({
    storeTitle: connection?.location_title ?? store.name,
    starRating: row.star_rating,
    comment: row.comment,
    mode,
    previousDraft: row.reply_draft,
  });
  const model = c.env.GOOGLE_BUSINESS_AI_MODEL || c.env.OPS_SUPPORT_AI_MODEL || DEFAULT_AI_MODEL;
  let text = '';
  try {
    const run = c.env.AI.run(model as keyof AiModels, {
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      temperature: 0.4,
      max_tokens: 600,
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new GoogleAiTimeout()), AI_TIMEOUT_MS);
    });
    try {
      text = aiText(await Promise.race([run, timeout]));
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch (error) {
    console.error('[restaurant-google] AI draft failed', { model, code: error instanceof GoogleAiTimeout ? 'timeout' : 'provider_failure' });
    return fail(c, error instanceof GoogleAiTimeout ? 504 : 502, 'AIの下書き作成に失敗しました。もう一度お試しください', { code: error instanceof GoogleAiTimeout ? 'ai_timeout' : 'ai_failed' });
  }
  const validated = validateReplyText(text);
  if (!validated.ok) return fail(c, 502, 'AIの下書きが空でした。もう一度お試しください', { code: 'ai_empty' });
  const generatedAt = nowIso();
  await dbFor(c.env, store.id)
    .prepare(
      `UPDATE rt_google_reviews SET reply_draft = ?, reply_draft_ai_generated = 1, reply_draft_generated_at = ?, reply_status = 'draft', updated_at = ? WHERE id = ?`,
    )
    .bind(validated.text, generatedAt, generatedAt, row.id)
    .run();
  return c.json({ success: true, draft: validated.text, aiGenerated: true, generatedAt, mode });
});

restaurantGoogle.put('/api/restaurant-test/google/reviews/:id/draft', async (c) => {
  const store = await storeFor(c);
  if (!store) return fail(c, 404, 'このLINEアカウントに店舗が紐付いていません');
  const row = await reviewFor(c, store.id, c.req.param('id'));
  if (!row) return fail(c, 404, '口コミが見つかりません');
  if (row.reply_status === 'published' || row.reply_status === 'replied' || row.reply_status === 'pending_confirm') {
    return fail(c, 409, 'この口コミにはすでに返信があります', { code: 'already_replied' });
  }
  const body = await c.req.json<{ replyDraft?: string }>().catch(() => ({}) as { replyDraft?: string });
  const validated = validateReplyText(body.replyDraft ?? '');
  if (!validated.ok) return fail(c, 400, validated.reason === 'too_long' ? '返信文が長すぎます' : '返信文を入力してください', { code: validated.reason });
  await dbFor(c.env, store.id)
    .prepare(`UPDATE rt_google_reviews SET reply_draft = ?, reply_draft_ai_generated = 0, reply_status = 'draft', updated_at = ? WHERE id = ?`)
    .bind(validated.text, nowIso(), row.id)
    .run();
  return c.json({ success: true, review: publicReview((await reviewFor(c, store.id, row.id))!) });
});

restaurantGoogle.post('/api/restaurant-test/google/reviews/:id/reply', requireRole('owner', 'admin'), async (c) => {
  const ctx = await requireConnectedStore(c);
  if (ctx instanceof Response) return ctx;
  const { store, connection } = ctx;
  const row = await reviewFor(c, store.id, c.req.param('id'));
  if (!row) return fail(c, 404, '口コミが見つかりません');
  const body = await c.req.json<{ confirmed?: boolean; comment?: string }>().catch(() => ({}) as { confirmed?: boolean; comment?: string });
  if (body.confirmed !== true) return fail(c, 400, '返信先・内容・個人情報の有無の確認が必要です', { code: 'confirmation_required' });
  if (!writeEnabled(c.env)) return fail(c, 403, 'この環境ではGoogleへ公開できません', { code: 'write_disabled' });
  const validated = validateReplyText(body.comment ?? row.reply_draft ?? '');
  if (!validated.ok) return fail(c, 400, validated.reason === 'too_long' ? '返信文が長すぎます' : '返信文を入力してください', { code: validated.reason });
  if (row.reply_status === 'published' || row.reply_status === 'replied') {
    return fail(c, 409, 'この口コミにはすでに返信があります', { code: 'already_replied', existingReply: row.reply_comment });
  }
  const db = dbFor(c.env, store.id);
  let accessToken: string;
  try {
    accessToken = await accessTokenFor(c, connection);
  } catch (error) {
    return googleErrorResponse(c, error);
  }
  const options: RequestOptions = { fetch, accessToken };

  // 送信直前にGoogle側を照合する（別の担当者が返信していないか／前回の送信が届いていないか）。
  try {
    const latest = await getReview(options, row.review_name);
    if (latest.reply?.comment) {
      await db
        .prepare(`UPDATE rt_google_reviews SET reply_status = 'published', reply_comment = ?, reply_update_time = ?, updated_at = ? WHERE id = ?`)
        .bind(latest.reply.comment, latest.reply.updateTime, nowIso(), row.id)
        .run();
      if (row.reply_status === 'pending_confirm' && latest.reply.comment === validated.text) {
        return c.json({ success: true, alreadyPublished: true, reply: latest.reply });
      }
      return fail(c, 409, '別の担当者がすでに返信しています', { code: 'already_replied', existingReply: latest.reply.comment });
    }
  } catch (error) {
    if (error instanceof GoogleBusinessError && error.kind === 'no_permission') await setConnectionStatus(c, store.id, 'no_permission', 'no_permission');
    return googleErrorResponse(c, error);
  }

  const requestId = crypto.randomUUID();
  await db.prepare(`UPDATE rt_google_reviews SET reply_status = 'pending_confirm', updated_at = ? WHERE id = ?`).bind(nowIso(), row.id).run();
  try {
    const reply = await updateReviewReply(options, row.review_name, validated.text);
    await db
      .prepare(
        `UPDATE rt_google_reviews SET reply_status = 'replied', reply_comment = ?, reply_update_time = ?, reply_draft = ?, updated_at = ? WHERE id = ?`,
      )
      .bind(reply.comment, reply.updateTime, validated.text, nowIso(), row.id)
      .run();
    await writeLog(c, store.id, { kind: 'review_reply', targetName: row.review_name, beforeText: row.reply_comment, afterText: validated.text, requestId, result: 'accepted' });
    auditLog(c, 'restaurant.google.review.reply', { id: row.id, kind: 'rt_google_review' }, { lineAccountId: store.lineAccountId });
    return c.json({ success: true, alreadyPublished: false, reply, review: publicReview((await reviewFor(c, store.id, row.id))!) });
  } catch (error) {
    const kind = error instanceof GoogleBusinessError ? error.kind : 'unknown';
    // 通信結果が不明（ネットワーク断・5xx）なら pending_confirm のまま残し、次回は照合してから再送する。
    const unknownResult = kind === 'unavailable' || kind === 'unknown';
    if (!unknownResult) {
      await db.prepare(`UPDATE rt_google_reviews SET reply_status = 'draft', reply_draft = ?, updated_at = ? WHERE id = ?`).bind(validated.text, nowIso(), row.id).run();
    }
    await writeLog(c, store.id, { kind: 'review_reply', targetName: row.review_name, beforeText: row.reply_comment, afterText: validated.text, requestId, result: unknownResult ? 'unknown' : 'failed', error: kind });
    auditLog(c, 'restaurant.google.review.reply', { id: row.id, kind: 'rt_google_review' }, { result: 'failed', lineAccountId: store.lineAccountId });
    if (kind === 'no_permission') await setConnectionStatus(c, store.id, 'no_permission', 'no_permission');
    return googleErrorResponse(c, error);
  }
});
