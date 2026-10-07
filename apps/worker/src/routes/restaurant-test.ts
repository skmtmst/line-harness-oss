import { validateClosure, publicClosure, closurePreview, closuresForRange, closureAffectsTable, openSeatTables, type ClosureRow } from '../services/restaurant-closures.js';
import { processVisitStampQueue } from '../services/visit-stamps.js';
import { safeRestaurantHttpsUrl, restaurantReservationEmbed } from '../services/restaurant-media-links.js';
import { getRestaurantInventoryRules, saveRestaurantInventoryRules, validateRestaurantInventoryRules, listRestaurantCloseTasks } from '@line-crm/db';
import { reconcileRestaurantInventory, recordRestaurantTableConflict } from '../services/restaurant-inventory-rules.js';
import type { RestaurantTableLayoutInput } from '@line-crm/shared';
import { updateStaffPolicy } from './staff.js';
import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  CredentialEncryptionKeyError,
  createLineAccount,
  deleteUncommittedLineAccount,
  getLineAccounts,
  type LineAccount,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { adminSessionTokenHashFromRequest } from '../middleware/auth.js';
import { requireRole } from '../middleware/role-guard.js';
import {
  canAccessLineAccount,
  getVisibleLineAccountScope,
} from '../services/account-access.js';
import { sendRestaurantLineConfirmation, type RestaurantLineNotice } from '../services/restaurant-line-confirmation.js';
import { promoteSeatWaitlist } from '../services/restaurant-seat-waitlist.js';
import { finishExpiredWaitlists } from '../services/booking-waitlist.js';
import { processBookingWaitlists } from '../services/waitlist-tick.js';
import { dbFor } from '../services/db-router.js';
import {
  issueRestaurantIntakeAddress,
  listRestaurantIntakeAddresses,
  RestaurantIntakeConfigurationError,
} from '../services/restaurant-email-intake.js';
import { fetchWebhookEndpointState } from '../services/line-webhook-state.js';
import {
  issueLineAccessToken,
  LineTokenIssueError,
  type LineTokenIssueFailure,
} from '../services/token-refresh.js';
import { fetchBotProfile } from '../lib/bot-profile.js';
import { restaurantTestEnabled } from '../lib/environment-features.js';
import { restaurantTableCapacity, validateRestaurantOpeningHours } from '../services/restaurant-inventory.js';
import { applyDueRestaurantMenuPrices, expireRestaurantHolds, validateRestaurantHold, validRestaurantDate, restaurantCivilTime } from '../services/restaurant-booking.js';
import { DEFAULT_STAY_MINUTES } from '../services/restaurant-reservation-email.js';
import { restaurantChannelState, restaurantDayBounds } from '../services/restaurant-channels.js';
import { DEFAULT_TENANT_ID } from '../lib/tenant.js';
import { tenantHasFeaturePack } from '../services/tenant-features.js';
import {
  chooseRestaurantTable,
  isRestaurantReservationSource,
  validateInboundReservation,
} from '../services/restaurant-test.js';

/**
 * 飲食店向け（テスト）の専用API。
 *
 * 媒体連携は管理者が投入した受信データを検証する一方向である。
 * 手動予約の確認通知は、明示的に選んだときだけ既存のHarness経路で送る。
 */
export const restaurantTest = new Hono<Env>();
restaurantTest.use('/api/restaurant-test/*', async (c,next) => {
 await next();
 if(!['POST','PUT','PATCH','DELETE'].includes(c.req.method)||!c.res.ok||c.req.path.endsWith('/closures/preview'))return;
 await processVisitStampQueue(c.env);
 const organization=await organizationFor(c);if(!organization)return;
 const dirty=await dbFor(c.env).prepare(`SELECT q.store_id FROM rt_inventory_rule_queue q JOIN rt_stores s ON s.id=q.store_id
 WHERE s.organization_id=? AND (? IS NULL OR s.id=?) LIMIT 100`).bind(organization.id,organization.scopedStoreId,organization.scopedStoreId).all<{store_id:string}>();
 for(const row of dirty.results)try {await reconcileRestaurantInventory(c.env,row.store_id);}catch {console.error('飲食店の枠通知は次の定期処理で再試行します');}
});
restaurantTest.onError((error, c) => {
  if (String(error).includes('closure_conflict')) return c.json({ success: false, error: 'closure_conflict', code: 'closure_conflict', reason: '臨時休業・貸切の日時と卓に重なるため受付できません' }, 409);
  if (String(error).includes('restaurant_table_conflict')) return c.json({ success: false, error: '同じ卓に重なる予約または仮押さえがあります' }, 409);
  throw error;
});

restaurantTest.use('*',async(c,next)=>{await next();if(!['GET','HEAD','OPTIONS'].includes(c.req.method)&&!c.req.path.endsWith('/closures/preview')&&c.res.status<400&&!(c.req.path.endsWith('/seat-waitlist')&&c.req.method==='POST')){try{const org=await organizationFor(c);if(org)await processBookingWaitlists(c.env,org.account_id);}catch{console.error(JSON.stringify({event:'seat_waitlist_reconcile_failed'}));}}});

const RESTAURANT_TERMS_DOCUMENT_KEY = 'musubo-terms';
const RESTAURANT_TERMS_DOCUMENT_VERSION = 'v0.1-draft';

type OrganizationRow = {
  id: string;
  account_id: string;
  tenant_id: string | null;
  tenant_name: string | null;
  name: string;
  status: string;
};
type OrganizationContext = OrganizationRow & { scopedStoreId: string | null };
type RestaurantStoreRow = {
  id: string;
  organization_id: string;
  name: string;
  code: string;
  area: string | null;
  capacity: number;
  timezone: string;
  status: 'active' | 'paused' | 'archived';
  line_status: 'connected' | 'warning' | 'error' | 'unconfigured';
  google_status: string;
  line_account_id: string | null;
  line_account_name: string | null;
  friend_count?: number | null;
  created_at: string;
  updated_at: string;
};

type SelectedRestaurantStore = {
  id: string;
  organization_id: string;
  name: string;
};

async function organizationByTenantId(
  c: Context<Env>,
  id: string,
): Promise<OrganizationContext | null> {
  const organization = await dbFor(c.env).prepare(`SELECT
      o.id, o.account_id, o.tenant_id, t.name AS tenant_name, o.name, o.status
    FROM rt_organizations o
    LEFT JOIN tenants t ON t.id = o.tenant_id
    WHERE o.tenant_id = ?
    LIMIT 1`).bind(id).first<OrganizationRow>();
  return organization ? { ...organization, scopedStoreId: null } : null;
}

function accountId(c: Context<Env>): string | null {
  return c.req.query('account_id') || null;
}

function tenantId(c: Context<Env>): string | null {
  return c.req.query('tenant_id') || null;
}

function hasOrganizationSelector(c: Context<Env>): boolean {
  return Boolean(accountId(c) || tenantId(c));
}

function authenticatedTenantId(c: Context<Env>): string {
  return c.get('staff')?.tenantId ?? DEFAULT_TENANT_ID;
}

restaurantTest.use('/api/restaurant-test/*', async (c, next) => {
  if (!restaurantTestEnabled(c.env)) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }

  const staffTenant = c.get('staff')?.tenantId ?? DEFAULT_TENANT_ID;
  // 統括に飲食店機能パックが付いていない場合、環境が無効な場合と同じ404で
  // 返す。機能の存在自体を、権限が無い呼び出し元に漏らさないため。
  if (!(await tenantHasFeaturePack(dbFor(c.env), staffTenant, 'restaurant'))) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }

  const requestedTenant = tenantId(c);
  if (requestedTenant && requestedTenant !== staffTenant) {
    return c.json({ success: false, error: 'この統括を操作する権限がありません' }, 403);
  }

  // The existing account_id visibility check intentionally remains unchanged.
  const selectedAccount = accountId(c);
  if (!selectedAccount) return next();
  const scope = await getVisibleLineAccountScope(dbFor(c.env), c.get('staff'));
  if (!scope.ids.includes(selectedAccount)) {
    return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
  }
  return next();
});

/**
 * One authenticated operator belongs to one restaurant organization in phase
 * A. Multi-organization membership is intentionally deferred until its access
 * model is defined.
 */
async function baseOrganizationFor(c: Context<Env>): Promise<OrganizationContext | null> {
  const requestedTenant = tenantId(c);
  if (requestedTenant) {
    return organizationByTenantId(c, requestedTenant);
  }

  const id = accountId(c);
  if (!id) return null;
  const organization = await dbFor(c.env).prepare(
    `SELECT o.id, o.account_id, o.tenant_id, t.name AS tenant_name, o.name, o.status
     FROM rt_organizations o
     LEFT JOIN tenants t ON t.id = o.tenant_id
     WHERE o.account_id = ? LIMIT 1`,
  ).bind(id).first<OrganizationRow>();
  if (organization) return { ...organization, scopedStoreId: null };

  const storeOrganization = await dbFor(c.env).prepare(`SELECT
      o.id, o.account_id, o.tenant_id, t.name AS tenant_name,
      o.name, o.status, s.id AS scoped_store_id
    FROM rt_stores s
    JOIN rt_organizations o ON o.id = s.organization_id
    LEFT JOIN tenants t ON t.id = o.tenant_id
    WHERE s.line_account_id = ?
    LIMIT 1`).bind(id).first<OrganizationRow & { scoped_store_id: string }>();
  return storeOrganization
    ? { ...storeOrganization, scopedStoreId: storeOrganization.scoped_store_id }
    : null;
}

/**
 * Create only the real organization required by a write operation. The
 * tenant-scoped unique index and the legacy account_id unique index make this
 * safe when two requests arrive together; the SELECT after INSERT returns the
 * winning row in either case.
 */
async function ensureOrganizationForAuthenticatedTenant(
  c: Context<Env>,
): Promise<OrganizationContext | null> {
  const staffTenantId = authenticatedTenantId(c);
  const existing = await organizationByTenantId(c, staffTenantId);
  if (existing) return existing;

  const tenant = await dbFor(c.env).prepare(
    'SELECT name FROM tenants WHERE id = ? LIMIT 1',
  ).bind(staffTenantId).first<{ name: string }>();
  if (!tenant) return null;

  await dbFor(c.env).prepare(`INSERT OR IGNORE INTO rt_organizations
    (id, account_id, tenant_id, name, status)
    VALUES (?, ?, ?, ?, 'active')`).bind(
      crypto.randomUUID(),
      staffTenantId,
      staffTenantId,
      tenant.name,
    ).run();
  return organizationByTenantId(c, staffTenantId);
}

async function selectedRestaurantStore(
  c: Context<Env>,
  organizationId: string,
): Promise<SelectedRestaurantStore | null> {
  const tokenHash = await adminSessionTokenHashFromRequest(c);
  if (!tokenHash) return null;
  return dbFor(c.env).prepare(`SELECT s.id, s.organization_id, s.name
    FROM admin_sessions session
    JOIN rt_stores s ON s.id = session.selected_restaurant_store_id
    WHERE session.token_hash = ?
      AND session.expires_at > ?
      AND s.organization_id = ?
    LIMIT 1`).bind(tokenHash, new Date().toISOString(), organizationId)
    .first<SelectedRestaurantStore>();
}

async function organizationFor(
  c: Context<Env>,
  options: { ignoreSession?: boolean } = {},
): Promise<OrganizationContext | null> {
  const organization = await baseOrganizationFor(c);
  if (!organization || options.ignoreSession) return organization;
  const selected = await selectedRestaurantStore(c, organization.id);
  return selected ? { ...organization, scopedStoreId: selected.id } : organization;
}

async function storeBelongsTo(c: Context<Env>, organizationId: string, storeId: string): Promise<boolean> {
  const selected = await selectedRestaurantStore(c, organizationId);
  if (selected && selected.id !== storeId) return false;
  const row = await dbFor(c.env, storeId).prepare(
    'SELECT line_account_id FROM rt_stores WHERE id = ? AND organization_id = ? LIMIT 1',
  ).bind(storeId, organizationId).first<{ line_account_id: string | null }>();
  if (!row) return false;
  const scope = await getVisibleLineAccountScope(dbFor(c.env), c.get('staff'));
  return row.line_account_id ? scope.ids.includes(row.line_account_id) : !scope.isAccountScoped;
}

function requiredAccount(c: Context<Env>) {
  return c.json({ success: false, error: 'account_id が必要です' }, 400);
}

function publicOrganization(organization: OrganizationContext): OrganizationRow {
  return {
    id: organization.id,
    account_id: organization.account_id,
    tenant_id: organization.tenant_id,
    tenant_name: organization.tenant_name,
    name: organization.name,
    status: organization.status,
  };
}

function expectedWebhookUrl(c: Context<Env>): string {
  const base = (
    c.env.WORKER_PUBLIC_URL || c.env.WORKER_URL || new URL(c.req.url).origin
  ).replace(/\/$/, '');
  return `${base}/webhook`;
}

async function deriveStoreLineStatuses(
  c: Context<Env>,
  stores: RestaurantStoreRow[],
): Promise<RestaurantStoreRow[]> {
  let accounts: LineAccount[] = [];
  try {
    accounts = await getLineAccounts(dbFor(c.env));
  } catch {
    // A credential/key failure is visible as an error status. Credential values
    // and underlying crypto errors must not be copied into this response or logs.
  }
  const byId = new Map(accounts.map((item) => [item.id, item]));
  const webhookUrl = expectedWebhookUrl(c);
  return Promise.all(stores.map(async (store) => {
    if (!store.line_account_id) {
      return { ...store, line_status: 'unconfigured' as const };
    }
    const account = byId.get(store.line_account_id);
    if (!account?.channel_access_token) {
      return { ...store, line_status: 'error' as const };
    }
    const webhook = await fetchWebhookEndpointState(account.channel_access_token, webhookUrl);
    const lineStatus: RestaurantStoreRow['line_status'] = webhook.status === 'matched'
      ? 'connected'
      : webhook.status === 'unknown'
        ? 'error'
        : 'warning';
    return { ...store, line_status: lineStatus };
  }));
}

function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('ja-JP', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function uniqueStoreConflict(error: unknown): 'line_account' | 'code' | null {
  const message = error instanceof Error ? error.message : String(error);
  if (!/UNIQUE constraint failed/i.test(message)) return null;
  if (/rt_stores\.line_account_id/i.test(message)) return 'line_account';
  if (/rt_stores\.organization_id.*rt_stores\.code|rt_stores\.code/i.test(message)) return 'code';
  return null;
}

async function validateStoreLineAccount(
  c: Context<Env>,
  lineAccountId: string,
): Promise<boolean> {
  const scope = await getVisibleLineAccountScope(dbFor(c.env), c.get('staff'));
  return canAccessLineAccount(scope.accounts, c.get('staff'), lineAccountId);
}

async function updateSelectedRestaurantStore(
  c: Context<Env>,
  storeId: string | null,
): Promise<boolean> {
  const tokenHash = await adminSessionTokenHashFromRequest(c);
  if (!tokenHash) return false;
  const result = await dbFor(c.env).prepare(`UPDATE admin_sessions
    SET selected_restaurant_store_id = ?
    WHERE token_hash = ? AND expires_at > ?`).bind(
      storeId,
      tokenHash,
      new Date().toISOString(),
    ).run();
  return Boolean(result.meta.changes);
}

function lineConnectionMessage(reason: LineTokenIssueFailure): string {
  if (reason === 'credentials') {
    return 'チャネルIDまたはチャネルシークレットが違う可能性があります。LINE Developersの「チャネル基本設定」からコピーし直してください。';
  }
  if (reason === 'rate_limited') {
    return 'LINE側の利用回数制限に達しました。少し時間を置いてから、もう一度お試しください。';
  }
  if (reason === 'network' || reason === 'temporary') {
    return 'LINEへ一時的に接続できませんでした。通信状況を確認し、少し時間を置いてからもう一度お試しください。';
  }
  return 'LINEから接続確認に必要な情報を取得できませんでした。チャネルIDとチャネルシークレットを確認してください。';
}

/** HQ store list. Session store scope is deliberately ignored here. */
restaurantTest.get('/api/restaurant-test/stores', requireRole('owner', 'admin', 'staff'), async (c) => {
  if (!hasOrganizationSelector(c)) return requiredAccount(c);
  const organization = await organizationFor(c, { ignoreSession: true });
  if (!organization) {
    return c.json({ success: true, data: { organization: null, stores: [] } });
  }
  const stores = await dbFor(c.env).prepare(`SELECT
      s.*, la.name AS line_account_name,
      CASE WHEN s.line_account_id IS NULL THEN NULL ELSE (
        SELECT COUNT(*) FROM friends f
        WHERE f.line_account_id = s.line_account_id AND f.is_following = 1
      ) END AS friend_count
    FROM rt_stores s
    LEFT JOIN line_accounts la ON la.id = s.line_account_id
    WHERE s.organization_id = ?
    ORDER BY s.name COLLATE NOCASE ASC, s.id ASC`).bind(organization.id)
    .all<RestaurantStoreRow>();
  const withStatuses = await deriveStoreLineStatuses(c, stores.results);
  return c.json({
    success: true,
    data: { organization: publicOrganization(organization), stores: withStatuses },
  });
});

/** Read-only context for the fixed store banner. */
restaurantTest.get('/api/restaurant-test/store-context', requireRole('owner', 'admin', 'staff'), async (c) => {
  if (!hasOrganizationSelector(c)) return requiredAccount(c);
  const organization = await organizationFor(c, { ignoreSession: true });
  if (!organization) {
    return c.json({ success: true, data: { selectedStore: null } });
  }
  const selectedStore = await selectedRestaurantStore(c, organization.id);
  return c.json({
    success: true,
    data: { selectedStore: selectedStore ? { id: selectedStore.id, name: selectedStore.name } : null },
  });
});

/** Return the latest agreement for the organization; credential values are unrelated and never selected. */
restaurantTest.get('/api/restaurant-test/terms-agreement', requireRole('owner', 'admin', 'staff'), async (c) => {
  const organization = hasOrganizationSelector(c)
    ? await organizationFor(c, { ignoreSession: true })
    : await organizationByTenantId(c, authenticatedTenantId(c));
  if (!organization) {
    return c.json({
      success: true,
      data: {
        documentKey: RESTAURANT_TERMS_DOCUMENT_KEY,
        agreedVersion: null,
        agreedAt: null,
      },
    });
  }
  const agreement = await dbFor(c.env).prepare(`SELECT document_version, agreed_at
    FROM rt_organization_agreements
    WHERE organization_id = ? AND document_key = ?
    ORDER BY (document_version = ?) DESC, agreed_at DESC
    LIMIT 1`).bind(
      organization.id,
      RESTAURANT_TERMS_DOCUMENT_KEY,
      RESTAURANT_TERMS_DOCUMENT_VERSION,
    ).first<{ document_version: string; agreed_at: string }>();
  return c.json({
    success: true,
    data: {
      documentKey: RESTAURANT_TERMS_DOCUMENT_KEY,
      agreedVersion: agreement?.document_version ?? null,
      agreedAt: agreement?.agreed_at ?? null,
    },
  });
});

/** Record one idempotent organization/version agreement without IP or other personal data. */
restaurantTest.post('/api/restaurant-test/terms-agreement', requireRole('owner', 'admin'), async (c) => {
  const body: { documentKey?: unknown; version?: unknown } = (await c.req.json().catch(() => null)) || {};
  if (
    body.documentKey !== RESTAURANT_TERMS_DOCUMENT_KEY
    || body.version !== RESTAURANT_TERMS_DOCUMENT_VERSION
  ) {
    return c.json({ success: false, error: '現在の利用規約バージョンと一致しません' }, 400);
  }
  const organization = await ensureOrganizationForAuthenticatedTenant(c);
  if (!organization) return c.json({ success: false, error: '統括情報を確認できません' }, 404);
  const staffId = c.get('staff')?.id ?? null;
  await dbFor(c.env).prepare(`INSERT OR IGNORE INTO rt_organization_agreements
    (id, organization_id, document_key, document_version, agreed_by_staff_id)
    VALUES (?, ?, ?, ?, ?)`).bind(
      crypto.randomUUID(),
      organization.id,
      RESTAURANT_TERMS_DOCUMENT_KEY,
      RESTAURANT_TERMS_DOCUMENT_VERSION,
      staffId,
    ).run();
  const agreement = await dbFor(c.env).prepare(`SELECT agreed_at
    FROM rt_organization_agreements
    WHERE organization_id = ? AND document_key = ? AND document_version = ?
    LIMIT 1`).bind(
      organization.id,
      RESTAURANT_TERMS_DOCUMENT_KEY,
      RESTAURANT_TERMS_DOCUMENT_VERSION,
    ).first<{ agreed_at: string }>();
  return c.json({
    success: true,
    data: {
      documentKey: RESTAURANT_TERMS_DOCUMENT_KEY,
      agreedVersion: RESTAURANT_TERMS_DOCUMENT_VERSION,
      agreedAt: agreement?.agreed_at ?? null,
    },
  });
});

/** Save a same-organization store in the existing opaque admin session. */
restaurantTest.post('/api/restaurant-test/stores/:id/select', requireRole('owner', 'admin', 'staff'), async (c) => {
  if (!hasOrganizationSelector(c)) return requiredAccount(c);
  const organization = await organizationFor(c, { ignoreSession: true });
  if (!organization) return c.json({ success: false, error: '飲食店テスト組織がありません' }, 404);
  const storeId = c.req.param('id');
  const store = await dbFor(c.env, storeId).prepare(
    'SELECT id, organization_id, name, status FROM rt_stores WHERE id = ? LIMIT 1',
  ).bind(storeId).first<SelectedRestaurantStore & { status: string }>();
  if (!store || store.organization_id !== organization.id) {
    return c.json({ success: false, error: 'この店舗を表示することはできません' }, 403);
  }
  if (store.status === 'archived') {
    return c.json({ success: false, error: 'アーカイブ済みの店舗は表示できません' }, 409);
  }
  if (!await updateSelectedRestaurantStore(c, store.id)) {
    return c.json({ success: false, error: '店舗切り替えには管理画面への再ログインが必要です' }, 409);
  }
  return c.json({ success: true, data: { selectedStore: { id: store.id, name: store.name } } });
});

/** Clear store scope and return to the organization-wide HQ view. */
restaurantTest.post('/api/restaurant-test/stores/selection/clear', requireRole('owner', 'admin', 'staff'), async (c) => {
  if (!hasOrganizationSelector(c)) return requiredAccount(c);
  if (!await updateSelectedRestaurantStore(c, null)) {
    return c.json({ success: false, error: '統括表示へ戻すには管理画面への再ログインが必要です' }, 409);
  }
  return c.json({ success: true, data: { selectedStore: null } });
});

const RESERVATION_FILTER_STATUSES = ['pending', 'confirmed', 'seated', 'visited', 'cancelled', 'no_show'];

/**
 * R103: 予約台帳の絞り込み条件を読む。期間は開始日時の範囲、状態は複数可、
 * 件数と開始位置でページを切る。既定は従来どおり先頭300件。
 */
function parseReservationFilter(c: Context<Env>, orgId: string, scopedStoreId: string | null):
  | { ok: true; where: string; params: unknown[]; limit: number; offset: number }
  | { ok: false; error: string } {
  const params: unknown[] = [orgId, scopedStoreId, scopedStoreId];
  let where = 's.organization_id = ? AND (? IS NULL OR s.id = ?)';
  const from = c.req.query('reservationFrom') || '';
  if (from) {
    const parsed = Date.parse(from);
    if (!Number.isFinite(parsed)) return { ok: false, error: '期間の指定が正しくありません' };
    where += ' AND r.starts_at >= ?';
    params.push(new Date(parsed).toISOString());
  }
  const to = c.req.query('reservationTo') || '';
  if (to) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      // 日付だけの指定はその日の終わりまで含める（翌日0時未満）。
      const next = new Date(`${to}T00:00:00.000Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      where += ' AND r.starts_at < ?';
      params.push(next.toISOString());
    } else {
      const parsed = Date.parse(to);
      if (!Number.isFinite(parsed)) return { ok: false, error: '期間の指定が正しくありません' };
      where += ' AND r.starts_at <= ?';
      params.push(new Date(parsed).toISOString());
    }
  }
  const statusParam = (c.req.query('reservationStatus') || '').trim();
  if (statusParam && statusParam !== 'all') {
    const list = statusParam.split(',').map((item) => item.trim()).filter(Boolean);
    if (list.length === 0 || list.some((item) => !RESERVATION_FILTER_STATUSES.includes(item))) {
      return { ok: false, error: '状態の指定が正しくありません' };
    }
    where += ` AND r.status IN (${list.map(() => '?').join(', ')})`;
    params.push(...list);
  }
  const limit = Number(c.req.query('reservationLimit') || '300');
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    return { ok: false, error: '件数の指定が正しくありません' };
  }
  const offset = Number(c.req.query('reservationOffset') || '0');
  if (!Number.isInteger(offset) || offset < 0) {
    return { ok: false, error: '開始位置の指定が正しくありません' };
  }
  return { ok: true, where, params, limit, offset };
}

restaurantTest.get('/api/restaurant-test/snapshot', requireRole('owner', 'admin', 'staff'), async (c) => {
  if (!hasOrganizationSelector(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) {
    return c.json({
      success: true,
      data: {
        environment: 'staging_test',
        integrationPolicy: 'inbound_only',
        organization: null,
        stores: [], memberships: [], approvals: [], reservations: [], reservationTotal: 0, tables: [],
        inventory: [], menuItems: [], connectors: [], reviews: [], posts: [], lineFlows: [],
      },
    });
  }

  await expireRestaurantHolds(dbFor(c.env), undefined, organization.scopedStoreId ?? undefined, organization.id);
  await applyDueRestaurantMenuPrices(dbFor(c.env), organization.id, organization.scopedStoreId ?? undefined);
  const orgId = organization.id;
  const scopedStoreId = organization.scopedStoreId;
  // R103: 予約台帳の絞り込み（期間・状態）とページ切替。既定は従来どおり先頭300件。
  const reservationFilter = parseReservationFilter(c, orgId, scopedStoreId);
  if (!reservationFilter.ok) return c.json({ success: false, error: reservationFilter.error }, 400);
  const [stores, memberships, approvals, reservationTotal, reservations, tables, inventory, menuItems, connectors, reviews, posts, lineFlows] = await Promise.all([
    dbFor(c.env).prepare(`SELECT s.*, la.name AS line_account_name
      FROM rt_stores s
      LEFT JOIN line_accounts la ON la.id = s.line_account_id
      WHERE s.organization_id = ? AND (? IS NULL OR s.id = ?)
      ORDER BY s.code`).bind(orgId, scopedStoreId, scopedStoreId).all<RestaurantStoreRow>(),
    dbFor(c.env).prepare(`SELECT m.*, sm.name AS loginName, sm.role AS loginRole, sm.access_level AS loginAccessLevel,
      sm.is_active AS loginActive, sm.policy_version AS loginPolicyVersion, sm.account_scope AS loginAccountScope,
      (SELECT json_group_array(line_account_id) FROM staff_account_scopes WHERE staff_id=m.staff_id) AS loginAccountIdsJson
      FROM rt_memberships m LEFT JOIN staff_members sm ON sm.id=m.staff_id
      WHERE m.organization_id = ? AND (? IS NULL OR m.store_id = ?)
      ORDER BY m.role, m.staff_name`).bind(orgId, scopedStoreId, scopedStoreId).all(),
    dbFor(c.env).prepare(`SELECT * FROM rt_approval_requests
      WHERE organization_id = ? AND (? IS NULL OR store_id = ?)
      ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'returned' THEN 1 ELSE 2 END,
        created_at DESC LIMIT 100`).bind(orgId, scopedStoreId, scopedStoreId).all(),
    dbFor(c.env).prepare(`SELECT COUNT(*) AS total FROM rt_reservations r
      JOIN rt_stores s ON s.id = r.store_id
      WHERE ${reservationFilter.where}`).bind(...reservationFilter.params).first<{ total: number }>(),
    dbFor(c.env).prepare(`SELECT r.*, s.name AS store_name, t.label AS table_label, m.name AS course_name
      FROM rt_reservations r
      JOIN rt_stores s ON s.id = r.store_id
      LEFT JOIN rt_tables t ON t.id = r.table_id
      LEFT JOIN rt_menu_items m ON m.id = r.course_id
      WHERE ${reservationFilter.where}
      ORDER BY r.starts_at ASC LIMIT ? OFFSET ?`).bind(...reservationFilter.params, reservationFilter.limit, reservationFilter.offset).all(),
    dbFor(c.env).prepare(`SELECT t.* FROM rt_tables t JOIN rt_stores s ON s.id = t.store_id
      WHERE s.organization_id = ? AND (? IS NULL OR s.id = ?)
      ORDER BY t.store_id, t.code`).bind(orgId, scopedStoreId, scopedStoreId).all(),
    dbFor(c.env).prepare(`SELECT i.* FROM rt_inventory_slots i JOIN rt_stores s ON s.id = i.store_id
      WHERE s.organization_id = ? AND (? IS NULL OR s.id = ?)
      ORDER BY i.starts_at LIMIT 300`).bind(orgId, scopedStoreId, scopedStoreId).all(),
    dbFor(c.env).prepare(`SELECT m.*, (SELECT after_price FROM rt_menu_change_requests r WHERE r.menu_id = m.id AND r.status IN ('pending','approved')) AS pendingPrice, (SELECT effective_at FROM rt_menu_change_requests r WHERE r.menu_id=m.id AND r.status IN ('pending','approved')) AS pendingEffectiveAt, (SELECT status FROM rt_menu_change_requests r WHERE r.menu_id=m.id AND r.status IN ('pending','approved')) AS priceChangeStatus FROM rt_menu_items m JOIN rt_stores s ON s.id = m.store_id
      WHERE s.organization_id = ? AND (? IS NULL OR s.id = ?)
      ORDER BY m.kind, m.name`).bind(orgId, scopedStoreId, scopedStoreId).all(),
    dbFor(c.env).prepare(`SELECT x.* FROM rt_connector_status x JOIN rt_stores s ON s.id = x.store_id
      WHERE s.organization_id = ? AND (? IS NULL OR s.id = ?)
      ORDER BY x.store_id, x.provider`).bind(orgId, scopedStoreId, scopedStoreId).all(),
    dbFor(c.env).prepare(`SELECT g.* FROM rt_gbp_reviews g JOIN rt_stores s ON s.id = g.store_id
      WHERE s.organization_id = ? AND (? IS NULL OR s.id = ?)
      ORDER BY g.reviewed_at DESC LIMIT 100`).bind(orgId, scopedStoreId, scopedStoreId).all(),
    dbFor(c.env).prepare(`SELECT p.* FROM rt_gbp_posts p JOIN rt_stores s ON s.id = p.store_id
      WHERE s.organization_id = ? AND (? IS NULL OR s.id = ?)
      ORDER BY p.created_at DESC LIMIT 100`).bind(orgId, scopedStoreId, scopedStoreId).all(),
    dbFor(c.env).prepare(`SELECT * FROM rt_line_flows
      WHERE organization_id = ? AND (? IS NULL OR store_id = ?)
      ORDER BY flow_type`).bind(orgId, scopedStoreId, scopedStoreId).all(),
  ]);
  const storesWithLineStatus = await deriveStoreLineStatuses(c, stores.results);

  return c.json({
    success: true,
    data: {
      environment: 'staging_test',
      integrationPolicy: 'inbound_only',
      organization: publicOrganization(organization),
      stores: storesWithLineStatus,
      memberships: memberships.results,
      approvals: approvals.results,
      reservations: reservations.results,
      reservationTotal: reservationTotal?.total ?? 0,
      tables: tables.results,
      inventory: inventory.results.map((slot) => ({ ...slot, total_capacity: tables.results
        .filter((table) => table.store_id === slot.store_id && table.is_active === 1)
        .reduce((total, table) => total + Number(table.max_capacity), 0) })),
      menuItems: menuItems.results,
      connectors: connectors.results,
      reviews: reviews.results,
      posts: posts.results,
      lineFlows: lineFlows.results,
    },
  });
});

/**
 * Complete the four-step store wizard in one server operation. Draft values
 * stay in the browser until this request; a failed connection leaves neither
 * a store nor a LINE account behind.
 */
restaurantTest.post('/api/restaurant-test/stores/connect', requireRole('owner', 'admin'), async (c) => {
  const body: {
    name?: unknown;
    alias?: unknown;
    channelId?: unknown;
    channelSecret?: unknown;
  } = (await c.req.json().catch(() => null)) || {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const alias = typeof body.alias === 'string' ? body.alias.trim() : '';
  const channelId = typeof body.channelId === 'string' ? body.channelId.trim() : '';
  const channelSecret = typeof body.channelSecret === 'string' ? body.channelSecret.trim() : '';
  if (!name) return c.json({ success: false, error: '店舗名を入力してください' }, 400);
  if (!channelId) return c.json({ success: false, error: 'チャネルIDを入力してください' }, 400);
  if (!channelSecret) return c.json({ success: false, error: 'チャネルシークレットを入力してください' }, 400);

  const organization = await ensureOrganizationForAuthenticatedTenant(c);
  if (!organization) return c.json({ success: false, error: '統括情報を確認できません' }, 404);

  const code = alias || name;
  const [sameCode, sameChannel] = await Promise.all([
    dbFor(c.env).prepare(
      'SELECT 1 AS found FROM rt_stores WHERE organization_id = ? AND code = ? LIMIT 1',
    ).bind(organization.id, code).first<{ found: number }>(),
    dbFor(c.env).prepare(
      'SELECT 1 AS found FROM line_accounts WHERE channel_id = ? LIMIT 1',
    ).bind(channelId).first<{ found: number }>(),
  ]);
  if (sameCode) return c.json({ success: false, error: '同じ店舗の略称が既に使用されています' }, 409);
  if (sameChannel) return c.json({ success: false, error: 'このLINE公式アカウントは既に登録されています' }, 409);

  let createdLineAccountId: string | null = null;
  try {
    const token = await issueLineAccessToken(channelId, channelSecret);
    const profile = await fetchBotProfile(token.access_token);
    if (!profile.displayName?.trim()) {
      return c.json({
        success: false,
        error: 'LINE公式アカウントの情報を取得できませんでした。Messaging APIが有効になっているか確認してください。',
      }, 400);
    }

    const lineAccount = await createLineAccount(dbFor(c.env), {
      channelId,
      name: profile.displayName.trim(),
      channelAccessToken: token.access_token,
      channelSecret,
      tenantId: organization.tenant_id ?? DEFAULT_TENANT_ID,
    }, c.env.LINE_CREDENTIAL_ENCRYPTION_KEY);
    createdLineAccountId = lineAccount.id;
    const storeId = crypto.randomUUID();
    await dbFor(c.env, storeId).prepare(`INSERT INTO rt_stores
      (id, organization_id, name, code, capacity, timezone, line_account_id)
      VALUES (?, ?, ?, ?, 0, 'Asia/Tokyo', ?)`).bind(
        storeId,
        organization.id,
        name,
        code,
        lineAccount.id,
      ).run();
    return c.json({
      success: true,
      data: { store: { id: storeId, name }, lineAccountName: profile.displayName.trim() },
    }, 201);
  } catch (error) {
    if (createdLineAccountId) {
      try {
        await deleteUncommittedLineAccount(dbFor(c.env), createdLineAccountId);
      } catch {
        console.error(JSON.stringify({ event: 'restaurant_store_wizard_rollback_failed' }));
      }
    }
    if (error instanceof LineTokenIssueError) {
      return c.json({ success: false, error: lineConnectionMessage(error.reason) }, 400);
    }
    if (error instanceof CredentialEncryptionKeyError) {
      return c.json({ success: false, error: 'LINE資格情報の暗号鍵が未設定です' }, 503);
    }
    const conflict = uniqueStoreConflict(error);
    if (conflict === 'line_account') {
      return c.json({ success: false, error: 'このLINE公式アカウントは別の店舗で使用されています' }, 409);
    }
    if (conflict === 'code') {
      return c.json({ success: false, error: '同じ店舗の略称が既に使用されています' }, 409);
    }
    const message = error instanceof Error ? error.message : '';
    if (/UNIQUE constraint failed.*line_accounts\.channel_id/i.test(message)) {
      return c.json({ success: false, error: 'このLINE公式アカウントは既に登録されています' }, 409);
    }
    console.error(JSON.stringify({ event: 'restaurant_store_wizard_failed', reason: 'internal' }));
    return c.json({ success: false, error: '店舗を追加できませんでした。時間を置いてもう一度お試しください。' }, 500);
  }
});

/** LINE公式アカウントを必ず1つ割り当てて店舗を作成する。 */
restaurantTest.post('/api/restaurant-test/stores', requireRole('owner', 'admin'), async (c) => {
  if (!hasOrganizationSelector(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({ success: false, error: '飲食店テスト組織がありません' }, 404);
  const body: {
    name?: unknown;
    code?: unknown;
    area?: unknown;
    capacity?: unknown;
    timezone?: unknown;
    lineAccountId?: unknown;
  } = (await c.req.json().catch(() => null)) || {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  const area = typeof body.area === 'string' ? body.area.trim() || null : null;
  const capacity = Number(body.capacity);
  const timezone = typeof body.timezone === 'string' && body.timezone.trim()
    ? body.timezone.trim()
    : 'Asia/Tokyo';
  const lineAccountId = typeof body.lineAccountId === 'string'
    ? body.lineAccountId.trim()
    : '';
  if (!name || !code || !Number.isInteger(capacity) || capacity < 0 || !isValidTimezone(timezone)) {
    return c.json({ success: false, error: '店舗の入力内容が正しくありません' }, 400);
  }
  if (!lineAccountId) {
    return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
  }
  if (!await validateStoreLineAccount(c, lineAccountId)) {
    return c.json({ success: false, error: 'LINEアカウントが正しくありません' }, 400);
  }

  const id = crypto.randomUUID();
  try {
    await dbFor(c.env, id).prepare(`INSERT INTO rt_stores
      (id, organization_id, name, code, area, capacity, timezone, line_account_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        id, organization.id, name, code, area, capacity, timezone, lineAccountId,
      ).run();
  } catch (error) {
    const conflict = uniqueStoreConflict(error);
    if (conflict === 'line_account') {
      return c.json({ success: false, error: 'このLINEアカウントは別の店舗で使用されています' }, 409);
    }
    if (conflict === 'code') {
      return c.json({ success: false, error: '同じ店舗コードが既に使用されています' }, 409);
    }
    throw error;
  }
  return c.json({ success: true, data: { id } }, 201);
});

/** 店舗は削除せず、不要になった場合はarchivedへ変更する。 */
restaurantTest.patch('/api/restaurant-test/stores/:id', requireRole('owner', 'admin'), async (c) => {
  if (!hasOrganizationSelector(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({ success: false, error: '飲食店テスト組織がありません' }, 404);
  const storeId = c.req.param('id');
  if (!await storeBelongsTo(c, organization.id, storeId)) {
    return c.json({ success: false, error: '店舗が正しくありません' }, 400);
  }
  const current = await dbFor(c.env, storeId).prepare(
    'SELECT line_account_id FROM rt_stores WHERE id = ? LIMIT 1',
  ).bind(storeId).first<{ line_account_id: string | null }>();
  const body: Record<string, unknown> = (await c.req.json().catch(() => null)) || {};
  const fields: string[] = [];
  const values: unknown[] = [];
  const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key);

  if (has('name')) {
    const value = typeof body.name === 'string' ? body.name.trim() : '';
    if (!value) return c.json({ success: false, error: '店舗名が正しくありません' }, 400);
    fields.push('name = ?');
    values.push(value);
  }
  if (has('code')) {
    const value = typeof body.code === 'string' ? body.code.trim() : '';
    if (!value) return c.json({ success: false, error: '店舗コードが正しくありません' }, 400);
    fields.push('code = ?');
    values.push(value);
  }
  if (has('area')) {
    const value = typeof body.area === 'string' ? body.area.trim() || null : null;
    fields.push('area = ?');
    values.push(value);
  }
  if (has('capacity')) {
    const value = Number(body.capacity);
    if (!Number.isInteger(value) || value < 0) {
      return c.json({ success: false, error: '収容人数が正しくありません' }, 400);
    }
    fields.push('capacity = ?');
    values.push(value);
  }
  if (has('status')) {
    const value = typeof body.status === 'string' ? body.status : '';
    if (!['active', 'paused', 'archived'].includes(value)) {
      return c.json({ success: false, error: '店舗状態が正しくありません' }, 400);
    }
    fields.push('status = ?');
    values.push(value);
  }

  let nextLineAccountId = current?.line_account_id || '';
  if (has('lineAccountId')) {
    nextLineAccountId = typeof body.lineAccountId === 'string'
      ? body.lineAccountId.trim()
      : '';
    if (!nextLineAccountId) {
      return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
    }
    if (!await validateStoreLineAccount(c, nextLineAccountId)) {
      return c.json({ success: false, error: 'LINEアカウントが正しくありません' }, 400);
    }
    fields.push('line_account_id = ?');
    values.push(nextLineAccountId);
  }
  if (!nextLineAccountId) {
    return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
  }
  if (fields.length === 0) {
    return c.json({ success: false, error: '変更内容がありません' }, 400);
  }

  fields.push("updated_at = datetime('now')");
  try {
    await dbFor(c.env, storeId).prepare(
      `UPDATE rt_stores SET ${fields.join(', ')} WHERE id = ? AND organization_id = ?`,
    ).bind(...values, storeId, organization.id).run();
  } catch (error) {
    const conflict = uniqueStoreConflict(error);
    if (conflict === 'line_account') {
      return c.json({ success: false, error: 'このLINEアカウントは別の店舗で使用されています' }, 409);
    }
    if (conflict === 'code') {
      return c.json({ success: false, error: '同じ店舗コードが既に使用されています' }, 409);
    }
    throw error;
  }
  return c.json({ success: true, data: { id: storeId } });
});

/** 店舗で現在受信できる予約メール取り込みアドレスを確認する。 */
restaurantTest.get('/api/restaurant-test/intake-addresses', requireRole('owner', 'admin'), async (c) => {
  if (!hasOrganizationSelector(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({ success: false, error: '飲食店テスト組織がありません' }, 404);
  const storeId = c.req.query('storeId') || '';
  if (!storeId || !await storeBelongsTo(c, organization.id, storeId)) {
    return c.json({ success: false, error: '店舗が正しくありません' }, 400);
  }
  try {
    const addresses = await listRestaurantIntakeAddresses(c.env, storeId);
    return c.json({ success: true, data: addresses });
  } catch (error) {
    if (error instanceof RestaurantIntakeConfigurationError) {
      return c.json({ success: false, error: '予約メール取り込み用ドメインが設定されていません' }, 503);
    }
    throw error;
  }
});

/** 店舗の予約メール取り込みアドレスを発行・再発行する。 */
restaurantTest.post('/api/restaurant-test/intake-addresses', requireRole('owner', 'admin'), async (c) => {
  if (!hasOrganizationSelector(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({ success: false, error: '飲食店テスト組織がありません' }, 404);
  const body: { storeId?: string } = await c.req.json<{ storeId?: string }>().catch(() => ({}));
  if (!body.storeId || !await storeBelongsTo(c, organization.id, body.storeId)) {
    return c.json({ success: false, error: '店舗が正しくありません' }, 400);
  }
  try {
    const issued = await issueRestaurantIntakeAddress(c.env, body.storeId);
    return c.json({ success: true, data: issued }, 201);
  } catch (error) {
    if (error instanceof RestaurantIntakeConfigurationError) {
      return c.json({ success: false, error: '予約メール取り込み用ドメインが設定されていません' }, 503);
    }
    throw error;
  }
});

restaurantTest.get('/api/restaurant-test/channels', requireRole('owner', 'admin', 'staff'), async (c) => {
  if (!hasOrganizationSelector(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({ success: false, error: '飲食店テスト組織がありません' }, 404);
  const storeId = c.req.query('storeId') || organization.scopedStoreId;
  if (!storeId || (organization.scopedStoreId && organization.scopedStoreId !== storeId) || !await storeBelongsTo(c, organization.id, storeId)) return c.json({ success: false, error: '店舗が正しくありません' }, 400);
  const db = dbFor(c.env, storeId);
  const store = await db.prepare('SELECT timezone FROM rt_stores WHERE id = ?').bind(storeId).first<{ timezone: string }>();
  const [from, to] = restaurantDayBounds(store!.timezone);
  const media = await db.prepare(`SELECT m.id, m.code, m.name, m.is_active,
    (SELECT COUNT(*) FROM rt_inbound_emails e WHERE e.store_id = ? AND e.media_id = m.id AND datetime(e.received_at) >= datetime(?) AND datetime(e.received_at) < datetime(?)) AS todayCount,
    (SELECT MAX(received_at) FROM rt_inbound_emails e WHERE e.store_id = ? AND e.media_id = m.id) AS lastReceivedAt,
    (SELECT COUNT(*) FROM rt_inbound_emails e WHERE e.store_id = ? AND e.media_id = m.id AND e.status = 'quarantined') AS unreadableCount
    FROM rt_media m ORDER BY m.code`).bind(storeId, from, to, storeId, storeId)
    .all<{ id: string; code: string; name: string; is_active: number; todayCount: number; lastReceivedAt: string | null; unreadableCount: number }>();
  const data = media.results.map(({ is_active, ...row }) => ({ ...row, receiveMethod: 'email_forward', ...restaurantChannelState(row.lastReceivedAt, is_active === 1) }));
  for (const [code, name] of [['restaurant_board', 'レストランボード'], ['reszaiko', 'レス在庫']] as const) {
    const row = await db.prepare(`SELECT COUNT(CASE WHEN datetime(received_at) >= datetime(?) AND datetime(received_at) < datetime(?) THEN 1 END) AS todayCount,
      MAX(received_at) AS lastReceivedAt, COUNT(CASE WHEN status = 'failed' THEN 1 END) AS unreadableCount
      FROM rt_sync_events WHERE store_id = ? AND provider = ?`).bind(from, to, storeId, code)
      .first<{ todayCount: number; lastReceivedAt: string | null; unreadableCount: number }>();
    data.push({ id: code, code, name, ...row!, receiveMethod: 'direct', ...restaurantChannelState(row!.lastReceivedAt, true) });
  }
  const manual = await db.prepare(`SELECT COUNT(CASE WHEN datetime(created_at) >= datetime(?) AND datetime(created_at) < datetime(?) THEN 1 END) AS todayCount,
    MAX(created_at) AS lastReceivedAt FROM rt_reservations WHERE store_id = ? AND source IN ('manual', 'phone', 'line') AND inbound_email_id IS NULL`)
    .bind(from, to, storeId).first<{ todayCount: number; lastReceivedAt: string | null }>();
  data.push({ id: 'manual', code: 'manual', name: '手入力・電話・LINE', ...manual!, unreadableCount: 0, receiveMethod: 'manual', ...restaurantChannelState(manual!.lastReceivedAt, true) });
  return c.json({ success: true, data });
});

restaurantTest.get('/api/restaurant-test/inbound-emails', requireRole('owner', 'admin'), async (c) => {
  if (!hasOrganizationSelector(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({ success: false, error: '飲食店テスト組織がありません' }, 404);
  const storeId = c.req.query('storeId') || organization.scopedStoreId;
  if (!storeId || (organization.scopedStoreId && organization.scopedStoreId !== storeId) || !await storeBelongsTo(c, organization.id, storeId)) return c.json({ success: false, error: '店舗が正しくありません' }, 400);
  if ((c.req.query('status') || 'quarantined') !== 'quarantined') return c.json({ success: false, error: 'status は quarantined を指定してください' }, 400);
  const limit = Math.min(200, Math.max(1, Number.parseInt(c.req.query('limit') || '100', 10) || 100));
  const offset = Math.max(0, Number.parseInt(c.req.query('offset') || '0', 10) || 0);
  const rows = await dbFor(c.env, storeId).prepare(`SELECT e.id, e.store_id AS storeId, e.received_at AS receivedAt,
    e.status, e.quarantine_reason AS reason, m.code AS mediaCode, m.name AS mediaName
    FROM rt_inbound_emails e LEFT JOIN rt_media m ON m.id = e.media_id
    WHERE e.store_id = ? AND e.status = 'quarantined' ORDER BY e.received_at DESC, e.id LIMIT ? OFFSET ?`)
    .bind(storeId, limit, offset).all();
  const count = await dbFor(c.env, storeId).prepare("SELECT COUNT(*) AS total FROM rt_inbound_emails WHERE store_id = ? AND status = 'quarantined'").bind(storeId).first<{ total: number }>();
  return c.json({ success: true, data: rows.results, total: count!.total });
});

restaurantTest.post('/api/restaurant-test/inbound-emails/:id/manual-import', requireRole('owner', 'admin'), async (c) => {
  if (!hasOrganizationSelector(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({ success: false, error: '飲食店テスト組織がありません' }, 404);
  const db = dbFor(c.env);
  const email = await db.prepare(`SELECT e.id, e.store_id, e.status, e.media_id, m.code AS media_code FROM rt_inbound_emails e
    JOIN rt_stores s ON s.id = e.store_id LEFT JOIN rt_media m ON m.id = e.media_id
    WHERE e.id = ? AND s.organization_id = ? AND (? IS NULL OR s.id = ?)`)
    .bind(c.req.param('id'), organization.id, organization.scopedStoreId, organization.scopedStoreId)
    .first<{ id: string; store_id: string; status: string; media_id: string | null; media_code: string | null }>();
  if (!email) return c.json({ success: false, error: 'メールが見つかりません' }, 404);
  const existing = await db.prepare("SELECT id, table_id FROM rt_reservations WHERE inbound_email_id = ? AND parser_key = 'manual_import'").bind(email.id).first<{ id: string; table_id: string | null }>();
  if (existing) return c.json({ success: true, data: { id: existing.id, tableId: existing.table_id, duplicate: true } });
  if (email.status !== 'quarantined') return c.json({ success: false, error: '手で取り込めるのは読めなかったメールだけです' }, 409);
  const body: Record<string, unknown> = (await c.req.json<Record<string, unknown>>().catch(() => null)) || {};
  const start = typeof body.startsAt === 'string' ? Date.parse(body.startsAt) : NaN;
  const endsAt = body.endsAt ?? (Number.isFinite(start) ? new Date(start + DEFAULT_STAY_MINUTES * 60_000).toISOString() : undefined);
  const checked = validateInboundReservation({ ...body, endsAt, externalId: `email-${email.id}`, status: 'confirmed' });
  if (!checked.ok) return c.json({ success: false, error: checked.error }, 400);
  const reservation = checked.value;
  const key = `reservation:${email.store_id}:${reservation.startsAt}`;
  const owner = crypto.randomUUID();
  if (!await acquireLock(db, key, owner)) return c.json({ success: false, error: '同じ時間帯を別の担当者が更新中です' }, 409);
  try {
    const tables = await db.prepare(`SELECT t.id, t.min_capacity, t.max_capacity, t.is_active FROM rt_tables t WHERE t.store_id = ?
      AND NOT EXISTS (SELECT 1 FROM rt_reservations r WHERE r.store_id = t.store_id AND r.table_id = t.id
        AND r.status NOT IN ('cancelled', 'no_show') AND datetime(r.starts_at) < datetime(?) AND datetime(r.ends_at) > datetime(?))`)
      .bind(email.store_id, reservation.endsAt, reservation.startsAt).all<{ id: string; min_capacity: number; max_capacity: number; is_active: number }>();
    const tableId = chooseRestaurantTable(tables.results.map((t) => ({ id: t.id, minCapacity: t.min_capacity, maxCapacity: t.max_capacity, isActive: t.is_active === 1 })), reservation.guestCount);
    const id = crypto.randomUUID();
    const source = isRestaurantReservationSource(email.media_code) ? email.media_code : 'manual';
    const writes = await db.batch([
      db.prepare(`INSERT INTO rt_reservations (id, store_id, source, external_id, customer_name, guest_count, starts_at, ends_at, table_id, status, media_id, inbound_email_id, parser_key, note)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, 'manual_import', ?
        WHERE EXISTS (SELECT 1 FROM rt_inbound_emails WHERE id = ? AND status = 'quarantined')
        ON CONFLICT(store_id, source, external_id) DO NOTHING`).bind(id, email.store_id, source, reservation.externalId, reservation.customerName, reservation.guestCount,
          reservation.startsAt, reservation.endsAt, tableId, email.media_id, email.id, `担当者 ${c.get('staff')?.id || '管理者'} が手で取り込み`, email.id),
      db.prepare(`UPDATE rt_inbound_emails SET status = 'received', quarantine_reason = NULL WHERE id = ?
        AND EXISTS (SELECT 1 FROM rt_reservations WHERE inbound_email_id = ? AND parser_key = 'manual_import')`).bind(email.id, email.id),
      db.prepare(`UPDATE rt_inventory_slots SET reserved_count = COALESCE((SELECT SUM(r.guest_count) FROM rt_reservations r WHERE r.store_id=rt_inventory_slots.store_id AND r.status NOT IN ('cancelled','no_show') AND datetime(r.starts_at)<datetime(rt_inventory_slots.starts_at, '+' || rt_inventory_slots.slot_minutes || ' minutes') AND datetime(r.ends_at)>datetime(rt_inventory_slots.starts_at)),0), updated_at = datetime('now')
        WHERE store_id = ? AND datetime(starts_at) = datetime(?) AND EXISTS (SELECT 1 FROM rt_reservations WHERE id = ?)` )
        .bind(email.store_id, reservation.startsAt, id),
    ]);
    const saved = await db.prepare("SELECT id, table_id FROM rt_reservations WHERE inbound_email_id = ? AND parser_key = 'manual_import'").bind(email.id).first<{ id: string; table_id: string | null }>();
    if (!saved) return c.json({ success: false, error: 'メールの状態が変わりました。読み直してください' }, 409);
    return c.json({ success: true, data: { id: saved.id, tableId: saved.table_id, duplicate: !writes[0].meta.changes } }, writes[0].meta.changes ? 201 : 200);
  } finally {
    await releaseLock(db, key, owner);
  }
});

restaurantTest.patch('/api/restaurant-test/approvals/:id', requireRole('owner', 'admin'), async (c) => {
  if (!hasOrganizationSelector(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({ success: false, error: '飲食店テスト組織がありません' }, 404);
  const body = await c.req.json<{ action?: string; comment?: string }>();
  const status = body.action === 'approve' ? 'approved' : body.action === 'return' ? 'returned' : null;
  if (!status) return c.json({ success: false, error: 'action は approve または return です' }, 400);
  if (status === 'returned' && (typeof body.comment !== 'string' || !body.comment.trim())) {
    return c.json({ success: false, error: '差し戻しの理由を入力してください' }, 400);
  }
  if (body.comment !== undefined && typeof body.comment !== 'string') return c.json({ success: false, error: 'コメントは文字列で入力してください' }, 400);
  const staff = c.get('staff');
  const result = await dbFor(c.env).prepare(`UPDATE rt_approval_requests
    SET status = ?, review_comment = ?, reviewed_by = ?, updated_at = datetime('now')
    WHERE id = ? AND organization_id = ? AND (? IS NULL OR store_id = ?)
      AND status = 'pending'`).bind(
      status, body.comment?.trim() || null, staff?.name || staff?.id || '管理者', c.req.param('id'), organization.id,
      organization.scopedStoreId, organization.scopedStoreId,
    ).run();
  if (!result.meta.changes) return c.json({ success: false, error: '対象が無いか、すでに処理済みです' }, 409);
  const change = await dbFor(c.env).prepare('SELECT status, failure_reason FROM rt_menu_change_requests WHERE approval_id = ?')
    .bind(c.req.param('id')).first<{ status: string; failure_reason: string | null }>();
  return c.json({ success: true, data: { id: c.req.param('id'), status, menuChangeStatus: change?.status ?? null, failureReason: change?.failure_reason ?? null } });
});

async function acquireLock(db: D1Database, key: string, owner: string): Promise<boolean> {
  const expires = new Date(Date.now() + 10_000).toISOString();
  await db.prepare(`INSERT INTO rt_resource_locks (resource_key, owner_token, expires_at)
    VALUES (?, ?, ?)
    ON CONFLICT(resource_key) DO UPDATE SET owner_token = excluded.owner_token, expires_at = excluded.expires_at, created_at = datetime('now')
    WHERE datetime(rt_resource_locks.expires_at) <= datetime('now')`).bind(key, owner, expires).run();
  const held = await db.prepare('SELECT owner_token FROM rt_resource_locks WHERE resource_key = ?').bind(key).first<{ owner_token: string }>();
  return held?.owner_token === owner;
}

async function releaseLock(db: D1Database, key: string, owner: string): Promise<void> {
  await db.prepare('DELETE FROM rt_resource_locks WHERE resource_key = ? AND owner_token = ?').bind(key, owner).run();
}

const INACTIVE_RESERVATION_STATUSES = ['cancelled', 'no_show'];

function reservationSlotActive(status: string | null | undefined): boolean {
  return !INACTIVE_RESERVATION_STATUSES.includes(status || '');
}

/**
 * 同じ卓に時間が重なる有効予約があるかを調べる（R100）。
 * 終了ちょうどの入替（ends_at = starts_at）は重なりとみなさない。
 */
async function overlappingReservationExists(
  db: D1Database,
  storeId: string,
  tableId: string,
  startsAt: string,
  endsAt: string,
  excludeId?: string | null,
  env?: Env['Bindings'],
): Promise<boolean> {
  const params: unknown[] = [storeId, tableId, endsAt, startsAt];
  let sql = `SELECT 1 AS ok FROM rt_reservations
    WHERE store_id = ? AND table_id = ?
      AND status NOT IN ('cancelled', 'no_show')
      AND starts_at < ? AND ends_at > ?`;
  if (excludeId) {
    sql += ' AND id != ?';
    params.push(excludeId);
  }
  const row = await db.prepare(`${sql} LIMIT 1`).bind(...params).first();
  if(row && env) await recordRestaurantTableConflict(env,storeId,startsAt,tableId);
  return Boolean(row);
}

type ReservationSlotState = { starts_at: string; guest_count: number; status: string };

/** 予約の新旧状態に合わせて時間帯在庫の予約済数を動かす（R100・R107）。 */
async function applyReservationInventoryChange(
  db: D1Database,
  storeId: string,
  old: ReservationSlotState | null,
  next: ReservationSlotState | null,
): Promise<void> {
  const wasActive = old ? reservationSlotActive(old.status) : false;
  const isActive = next ? reservationSlotActive(next.status) : false;
  if (!old && next && isActive) {
    await adjustInventoryReservedCount(db, storeId, next.starts_at, next.guest_count);
    return;
  }
  if (!old || !next) return;
  if (wasActive && !isActive) {
    await adjustInventoryReservedCount(db, storeId, old.starts_at, -old.guest_count);
  } else if (!wasActive && isActive) {
    await adjustInventoryReservedCount(db, storeId, next.starts_at, next.guest_count);
  } else if (wasActive && isActive) {
    if (old.starts_at === next.starts_at) {
      await adjustInventoryReservedCount(db, storeId, next.starts_at, next.guest_count - old.guest_count);
    } else {
      await adjustInventoryReservedCount(db, storeId, old.starts_at, -old.guest_count);
      await adjustInventoryReservedCount(db, storeId, next.starts_at, next.guest_count);
    }
  }
}

/** 時間帯在庫の予約済数を人数分だけ動かす（R100）。枠が無ければ何もしない。 */
async function adjustInventoryReservedCount(
  db: D1Database,
  storeId: string,
  startsAt: string,
  guestDelta: number,
): Promise<void> {
  // 予約そのものを正本にし、取消・枠をまたぐ滞在・再送で二重加算しない。
  await db.prepare(`UPDATE rt_inventory_slots SET reserved_count = COALESCE((SELECT SUM(r.guest_count)
    FROM rt_reservations r WHERE r.store_id = rt_inventory_slots.store_id AND r.status NOT IN ('cancelled', 'no_show')
      AND datetime(r.starts_at) < datetime(rt_inventory_slots.starts_at, '+' || rt_inventory_slots.slot_minutes || ' minutes')
      AND datetime(r.ends_at) > datetime(rt_inventory_slots.starts_at)), 0) WHERE store_id = ?`).bind(storeId).run();
}

restaurantTest.post('/api/restaurant-test/reservations/manual', requireRole('owner', 'admin', 'staff'), async (c) => {
  if (!hasOrganizationSelector(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({ success: false, error: '飲食店テスト組織がありません' }, 404);
  const body = await c.req.json<Record<string, unknown>>();
  if (body.notifyLine !== undefined && typeof body.notifyLine !== 'boolean') {
    return c.json({ success: false, error: 'notifyLine は true または false を指定してください' }, 400);
  }
  const storeId = typeof body.storeId === 'string' ? body.storeId : '';
  if (!storeId || !await storeBelongsTo(c, organization.id, storeId)) return c.json({ success: false, error: '店舗が正しくありません' }, 400);
  const checked = validateInboundReservation({ ...body, externalId: `manual-${crypto.randomUUID()}` });
  if (!checked.ok) return c.json({ success: false, error: checked.error }, 400);
  await expireRestaurantHolds(dbFor(c.env, storeId), undefined, storeId);
  const lockKey = `reservation:${storeId}`;
  const lockOwner = crypto.randomUUID();
  if (!await acquireLock(dbFor(c.env, storeId), lockKey, lockOwner)) return c.json({ success: false, error: '同じ時間帯を別の担当者が更新中です' }, 409);
  let saved: { id: string; tableId: string | null };
  try {
    const tables = await dbFor(c.env, storeId).prepare('SELECT id, min_capacity, max_capacity, is_active FROM rt_tables WHERE store_id = ?').bind(storeId).all<{ id: string; min_capacity: number; max_capacity: number; is_active: number }>();
    if (checked.value.tableId && !tables.results.some((table) => table.id === checked.value.tableId && table.is_active === 1)) {
      return c.json({ success: false, error: '停止中の卓は選べません' }, 400);
    }
    if (checked.value.courseId) {
      const course = await dbFor(c.env, storeId).prepare('SELECT id FROM rt_menu_items WHERE id = ? AND store_id = ? AND status = ?').bind(checked.value.courseId, storeId, 'active').first();
      if (!course) return c.json({ success: false, error: '停止中のコースは選べません' }, 400);
    }
    const closures = await closuresForRange(dbFor(c.env, storeId), storeId, checked.value.startsAt, checked.value.endsAt);
    const blocked = closures.filter(r => checked.value.tableId ? closureAffectsTable(r, checked.value.tableId) : true);
    const open = await openSeatTables(dbFor(c.env, storeId), storeId, checked.value.startsAt, checked.value.endsAt, checked.value.guestCount, true);
    if (blocked.length && (checked.value.tableId || !open.length)) return c.json({ success: false, error: 'closure_conflict', code: 'closure_conflict', reason: '臨時休業・貸切の日時と卓に重なります', closures: blocked.map(publicClosure) }, 409);
    const freeTables = [];
    for (const row of tables.results) {
      if (closures.some(r => closureAffectsTable(r, row.id))) continue;
      if (!await overlappingReservationExists(dbFor(c.env, storeId), storeId, row.id, checked.value.startsAt, checked.value.endsAt)) freeTables.push(row);
    }
    const tableId = checked.value.tableId || chooseRestaurantTable(freeTables.map((row) => ({ id: row.id, minCapacity: row.min_capacity, maxCapacity: row.max_capacity, isActive: row.is_active === 1 })), checked.value.guestCount);
    if (!tableId) return c.json({ success: false, error: '人数が入る空き卓がありません' }, 409);
    const chosen = tables.results.find(t => t.id === tableId)!;
    if (checked.value.guestCount < chosen.min_capacity || checked.value.guestCount > chosen.max_capacity) return c.json({ success: false, error: '卓の収容人数に合いません' }, 400);
    if (tableId && await overlappingReservationExists(dbFor(c.env, storeId), storeId, tableId, checked.value.startsAt, checked.value.endsAt, undefined, c.env)) {
      return c.json({ success: false, error: '同じ卓に重なる時間の予約があるため登録できません' }, 409);
    }
    const id = crypto.randomUUID();
    await dbFor(c.env, storeId).prepare(`INSERT INTO rt_reservations
      (id, store_id, source, external_id, customer_name, customer_phone, line_uid, guest_count, starts_at, ends_at, table_id, course_id, status, allergy_note, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        id, storeId, body.source === 'phone' ? 'phone' : 'manual', checked.value.externalId, checked.value.customerName, checked.value.customerPhone,
        checked.value.lineUid, checked.value.guestCount, checked.value.startsAt, checked.value.endsAt,
        tableId, checked.value.courseId, checked.value.status, checked.value.allergyNote, checked.value.note,
      ).run();
    if (reservationSlotActive(checked.value.status)) {
      await adjustInventoryReservedCount(dbFor(c.env, storeId), storeId, checked.value.startsAt, checked.value.guestCount);
    }
    saved = { id, tableId };
  } finally {
    await releaseLock(dbFor(c.env, storeId), lockKey, lockOwner);
  }
  const lineNotice: RestaurantLineNotice = body.notifyLine === true
    ? await sendRestaurantLineConfirmation(c, {
      reservationId: saved.id, storeId, tenantId: organization.tenant_id ?? DEFAULT_TENANT_ID,
      lineUid: checked.value.lineUid ?? null, startsAt: checked.value.startsAt,
      endsAt: checked.value.endsAt, guestCount: checked.value.guestCount,
      courseId: checked.value.courseId ?? null, status: checked.value.status ?? 'confirmed',
    })
    : { sent: false, reason: 'not_requested' };
  return c.json({ success: true, data: { ...saved, syncDirection: 'inbound_only', lineNotice } }, 201);
});

restaurantTest.post('/api/restaurant-test/reservations/walk-in', requireRole('owner', 'admin', 'staff'), async (c) => {
  if (!hasOrganizationSelector(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({ success: false, error: '飲食店テスト組織がありません' }, 404);
  const body = await c.req.json<Record<string, unknown>>();
  if (body.notifyLine !== undefined && typeof body.notifyLine !== 'boolean') {
    return c.json({ success: false, error: 'notifyLine は true または false を指定してください' }, 400);
  }
  const storeId = typeof body.storeId === 'string' ? body.storeId : '';
  if (!storeId || !await storeBelongsTo(c, organization.id, storeId)) return c.json({ success: false, error: '店舗が正しくありません' }, 400);
  if (!Number.isSafeInteger(body.guestCount) || Number(body.guestCount) < 1 || Number(body.guestCount) > 100
    || typeof body.tableId !== 'string' || !body.tableId) return c.json({ success: false, error: '人数と卓を指定してください' }, 400);
  for (const key of ['customerName', 'customerPhone', 'lineUid']) {
    if (body[key] !== undefined && (typeof body[key] !== 'string' || String(body[key]).length > 200)) return c.json({ success: false, error: '連絡先の形式を確認してください' }, 400);
  }
  const startsAt = new Date().toISOString();
  const checked = validateInboundReservation({ ...body, customerName: body.customerName || '予約なしの来店',
    startsAt, endsAt: new Date(Date.now() + DEFAULT_STAY_MINUTES * 60000).toISOString(), status: 'visited', externalId: `walk-in-${crypto.randomUUID()}` });
  if (!checked.ok) return c.json({ success: false, error: checked.error }, 400);
  await expireRestaurantHolds(dbFor(c.env, storeId), undefined, storeId);
  const lockKey = `reservation:${storeId}`;
  const lockOwner = crypto.randomUUID();
  if (!await acquireLock(dbFor(c.env, storeId), lockKey, lockOwner)) return c.json({ success: false, error: '同じ時間帯を別の担当者が更新中です' }, 409);
  let saved: { id: string; tableId: string | null };
  try {
    const tables = await dbFor(c.env, storeId).prepare('SELECT id, min_capacity, max_capacity, is_active FROM rt_tables WHERE store_id = ?').bind(storeId).all<{ id: string; min_capacity: number; max_capacity: number; is_active: number }>();
    if (checked.value.tableId && !tables.results.some((table) => table.id === checked.value.tableId && table.is_active === 1)) {
      return c.json({ success: false, error: '停止中の卓は選べません' }, 400);
    }
    if (checked.value.courseId) {
      const course = await dbFor(c.env, storeId).prepare('SELECT id FROM rt_menu_items WHERE id = ? AND store_id = ? AND status = ?').bind(checked.value.courseId, storeId, 'active').first();
      if (!course) return c.json({ success: false, error: '停止中のコースは選べません' }, 400);
    }
    const closures = await closuresForRange(dbFor(c.env, storeId), storeId, checked.value.startsAt, checked.value.endsAt);
    const blocked = closures.filter(r => checked.value.tableId ? closureAffectsTable(r, checked.value.tableId) : true);
    const open = await openSeatTables(dbFor(c.env, storeId), storeId, checked.value.startsAt, checked.value.endsAt, checked.value.guestCount, true);
    if (blocked.length && (checked.value.tableId || !open.length)) return c.json({ success: false, error: 'closure_conflict', code: 'closure_conflict', reason: '臨時休業・貸切の日時と卓に重なります', closures: blocked.map(publicClosure) }, 409);
    const freeTables = [];
    for (const row of tables.results) {
      if (closures.some(r => closureAffectsTable(r, row.id))) continue;
      if (!await overlappingReservationExists(dbFor(c.env, storeId), storeId, row.id, checked.value.startsAt, checked.value.endsAt)) freeTables.push(row);
    }
    const tableId = checked.value.tableId || chooseRestaurantTable(freeTables.map((row) => ({ id: row.id, minCapacity: row.min_capacity, maxCapacity: row.max_capacity, isActive: row.is_active === 1 })), checked.value.guestCount);
    if (!tableId) return c.json({ success: false, error: '人数が入る空き卓がありません' }, 409);
    const chosen = tables.results.find(t => t.id === tableId)!;
    if (checked.value.guestCount < chosen.min_capacity || checked.value.guestCount > chosen.max_capacity) return c.json({ success: false, error: '卓の収容人数に合いません' }, 400);
    if (tableId && await overlappingReservationExists(dbFor(c.env, storeId), storeId, tableId, checked.value.startsAt, checked.value.endsAt, undefined, c.env)) {
      return c.json({ success: false, error: '同じ卓に重なる時間の予約があるため登録できません' }, 409);
    }
    const id = crypto.randomUUID();
    const db = dbFor(c.env, storeId);
    await db.batch([
      db.prepare(`INSERT INTO rt_reservations
        (id, store_id, source, external_id, customer_name, customer_phone, line_uid, guest_count, starts_at, ends_at, table_id, course_id, status, allergy_note, note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
          id, storeId, 'walk_in', checked.value.externalId, checked.value.customerName, checked.value.customerPhone,
          checked.value.lineUid, checked.value.guestCount, checked.value.startsAt, checked.value.endsAt,
          tableId, checked.value.courseId, checked.value.status, checked.value.allergyNote, checked.value.note),
      db.prepare(`INSERT INTO rt_seat_visit_marks
        (id,reservation_id,store_id,kind,marked_by_staff_id,marked_by_name,marked_at) VALUES(?,?,?,'visited',?,?,?)`)
        .bind(crypto.randomUUID(),id,storeId,c.get('staff')?.id??null,c.get('staff')?.name??null,startsAt),
    ]);
    saved = { id, tableId };
  } finally {
    await releaseLock(dbFor(c.env, storeId), lockKey, lockOwner);
  }
  return c.json({ success: true, data: { ...saved, status: 'visited', source: 'walk_in', startsAt: checked.value.startsAt, endsAt: checked.value.endsAt } }, 201);
});

/**
 * R107: 登録後の予約を変更・取消・再配席する。日時・人数・卓の変更は
 * 重なり検査と在庫連動を通し、取消は在庫を戻す（物理削除はしない）。
 */
restaurantTest.patch('/api/restaurant-test/reservations/:id', requireRole('owner', 'admin', 'staff'), async (c) => {
  if (!hasOrganizationSelector(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({ success: false, error: '飲食店テスト組織がありません' }, 404);
  const current = await dbFor(c.env).prepare(`SELECT r.* FROM rt_reservations r
    JOIN rt_stores s ON s.id = r.store_id
    WHERE r.id = ? AND s.organization_id = ? AND (? IS NULL OR s.id = ?)
    LIMIT 1`).bind(
      c.req.param('id'), organization.id,
      organization.scopedStoreId, organization.scopedStoreId,
    ).first<{
      id: string; store_id: string; customer_name: string; customer_phone: string | null;
      guest_count: number; starts_at: string; ends_at: string; table_id: string | null;
      course_id: string | null; status: string; allergy_note: string | null; note: string | null; hold_expires_at: string | null;
    }>();
  if (!current) return c.json({ success: false, error: '予約が見つかりません' }, 404);
  if (!await storeBelongsTo(c, organization.id, current.store_id)) return c.json({success:false,error:'この店舗を操作する権限がありません'},403);
  if (current.hold_expires_at && current.status === 'pending' && Date.parse(current.hold_expires_at) <= Date.now()) {
    await expireRestaurantHolds(dbFor(c.env, current.store_id), undefined, current.store_id);
    return c.json({ success: false, error: '仮押さえの期限が切れました。読み直してください' }, 409);
  }
  const body: Record<string, unknown> = (await c.req.json().catch(() => null)) || {};
  const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key);

  const next = {
    customer_name: current.customer_name,
    customer_phone: current.customer_phone,
    guest_count: current.guest_count,
    starts_at: current.starts_at,
    ends_at: current.ends_at,
    table_id: current.table_id,
    course_id: current.course_id,
    status: current.status,
    allergy_note: current.allergy_note,
    note: current.note,
  };
  if (has('customerName')) {
    const value = typeof body.customerName === 'string' ? body.customerName.trim() : '';
    if (!value) return c.json({ success: false, error: 'お客様名が正しくありません' }, 400);
    next.customer_name = value;
  }
  if (has('customerPhone')) {
    next.customer_phone = typeof body.customerPhone === 'string' && body.customerPhone.trim()
      ? body.customerPhone.trim()
      : null;
  }
  if (has('guestCount')) {
    const value = Number(body.guestCount);
    if (!Number.isInteger(value) || value < 1 || value > 100) {
      return c.json({ success: false, error: '人数は1〜100で指定してください' }, 400);
    }
    next.guest_count = value;
  }
  if (has('startsAt') || has('endsAt')) {
    if (!has('startsAt') || !has('endsAt')) {
      return c.json({ success: false, error: '日時は開始と終了を両方指定してください' }, 400);
    }
    const start = Date.parse(String(body.startsAt));
    const end = Date.parse(String(body.endsAt));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return c.json({ success: false, error: '日時の指定が正しくありません' }, 400);
    }
    next.starts_at = new Date(start).toISOString();
    next.ends_at = new Date(end).toISOString();
  }
  if (has('status')) {
    const value = typeof body.status === 'string' ? body.status : '';
    if (!RESERVATION_FILTER_STATUSES.includes(value)) {
      return c.json({ success: false, error: '状態の指定が正しくありません' }, 400);
    }
    next.status = value;
  }
  if (has('tableId')) {
    if (body.tableId === null || body.tableId === '') {
      next.table_id = null;
    } else if (typeof body.tableId === 'string') {
      const table = await dbFor(c.env, current.store_id).prepare(
        'SELECT id FROM rt_tables WHERE id = ? AND store_id = ? AND (is_active = 1 OR id = ?) LIMIT 1',
      ).bind(body.tableId, current.store_id, current.table_id).first();
      if (!table) return c.json({ success: false, error: '卓が正しくありません' }, 400);
      next.table_id = body.tableId;
    } else {
      return c.json({ success: false, error: '卓が正しくありません' }, 400);
    }
  }
  if (has('courseId')) {
    if (body.courseId === null || body.courseId === '') {
      next.course_id = null;
    } else if (typeof body.courseId === 'string') {
      const course = await dbFor(c.env, current.store_id).prepare(
        'SELECT id FROM rt_menu_items WHERE id = ? AND store_id = ? AND (status = ? OR id = ?) LIMIT 1',
      ).bind(body.courseId, current.store_id, 'active', current.course_id).first();
      if (!course) return c.json({ success: false, error: 'コースが正しくありません' }, 400);
      next.course_id = body.courseId;
    } else {
      return c.json({ success: false, error: 'コースが正しくありません' }, 400);
    }
  }
  if (has('allergyNote')) {
    next.allergy_note = typeof body.allergyNote === 'string' && body.allergyNote.trim()
      ? body.allergyNote.trim()
      : null;
  }
  if (has('note')) {
    next.note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null;
  }

  if (next.table_id && reservationSlotActive(next.status)
    && await overlappingReservationExists(
      dbFor(c.env, current.store_id), current.store_id, next.table_id, next.starts_at, next.ends_at, current.id, c.env,
    )) {
    return c.json({ success: false, error: '同じ卓に重なる時間の予約があるため変更できません' }, 409);
  }
  await dbFor(c.env, current.store_id).prepare(`UPDATE rt_reservations SET
    customer_name = ?, customer_phone = ?, guest_count = ?, starts_at = ?, ends_at = ?,
    table_id = ?, course_id = ?, status = ?, allergy_note = ?, note = ?, updated_at = datetime('now')
    WHERE id = ?`).bind(
      next.customer_name, next.customer_phone, next.guest_count, next.starts_at, next.ends_at,
      next.table_id, next.course_id, next.status, next.allergy_note, next.note, current.id,
    ).run();
  await applyReservationInventoryChange(
    dbFor(c.env, current.store_id), current.store_id,
    { starts_at: current.starts_at, guest_count: current.guest_count, status: current.status },
    { starts_at: next.starts_at, guest_count: next.guest_count, status: next.status },
  );
  if (next.status === 'cancelled' && next.table_id) {
    // 席の空き待ち：空いた卓に入る組の早い順で1組に知らせる。
    // 知らせの失敗で取り消し自体を失敗させない。
    try {
      await promoteSeatWaitlist(dbFor(c.env, current.store_id), {
        storeId: current.store_id,
        startsAt: next.starts_at,
        tableId: next.table_id,
      }, undefined, c.env.LIFF_URL ?? '',c.env);
    } catch {
      console.error(JSON.stringify({ event: 'seat_waitlist_promote_failed', reservationId: current.id }));
    }
  }
  return c.json({ success: true, data: { id: current.id } });
});

/**
 * 席の空き待ちの登録の共通処理。
 *
 * 開始時刻は UTC ISO (Z) にそろえる（取り消し時の突き合わせ用）。
 * 満席の判定は空き照会の表示側で行い、登録口は受け付ける。
 */
export async function insertSeatWaitlistEntry(
  db: D1Database,
  input: {
    storeId: string;
    startsAt: string;
    guestCount: number;
    customerName: string;
    customerPhone: string | null;
    lineUid: string | null;
    endsAt?:string;
  },
): Promise<
  | { ok: true; id: string }
  | { ok: false; error: 'invalid_slot' | 'invalid_party' | 'invalid_starts_at' | 'starts_at_in_past' | 'missing_customer' | 'already_waiting' | 'registration_closed' | 'waitlist_limit' | 'closure_conflict' }
> {
  const startsAtMs = Date.parse(input.startsAt);
  if (Number.isNaN(startsAtMs)) return { ok: false, error: 'invalid_starts_at' };
  if (startsAtMs <= Date.now()) return { ok: false, error: 'starts_at_in_past' };
  if(startsAtMs<=Date.now()+60*60_000)return {ok:false,error:'registration_closed'};
  const account=await db.prepare('SELECT line_account_id FROM rt_stores WHERE id=?').bind(input.storeId).first<{line_account_id:string}>();
  if(account)await finishExpiredWaitlists(db,account.line_account_id);
  if (!Number.isInteger(input.guestCount) || input.guestCount < 1 || input.guestCount > 100) {
    return { ok: false, error: 'invalid_party' };
  }
  const customerName = input.customerName.trim();
  if (!customerName) return { ok: false, error: 'missing_customer' };
  const startsAt = new Date(startsAtMs).toISOString();
  const endsAt = input.endsAt ?? new Date(startsAtMs + DEFAULT_STAY_MINUTES * 60_000).toISOString();
  if (!Number.isFinite(Date.parse(endsAt)) || Date.parse(endsAt) <= startsAtMs) return { ok: false, error: 'invalid_slot' };
  if ((await closuresForRange(db, input.storeId, startsAt, endsAt)).length && !(await openSeatTables(db, input.storeId, startsAt, endsAt, input.guestCount, true)).length) return { ok: false, error: 'closure_conflict' };
  const identityKey = input.lineUid
    ? `line:${input.lineUid}`
    : input.customerPhone
      ? `phone:${input.customerPhone}`
      : `name:${customerName}`;
  const existing = await db
    .prepare(`SELECT id FROM rt_seat_waitlist
      WHERE store_id = ? AND starts_at = ? AND identity_key = ?
        AND status IN ('waiting', 'invited')`)
    .bind(input.storeId, startsAt, identityKey)
    .first<{ id: string }>();
  if (existing) return { ok: false, error: 'already_waiting' };
  const id = crypto.randomUUID();
  try {
    await db
      .prepare(`INSERT INTO rt_seat_waitlist
        (id, store_id, starts_at, guest_count, customer_name, customer_phone,
         line_uid, identity_key,ends_at,created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?,?,?)`)
      .bind(id, input.storeId, startsAt, input.guestCount, customerName,
        input.customerPhone, input.lineUid, identityKey,input.endsAt??new Date(startsAtMs+DEFAULT_STAY_MINUTES*60_000).toISOString(),new Date().toISOString())
      .run();
  } catch (error) {
    // 同時登録の race は部分一致キーが止める。
    if (/closure_conflict/.test(String(error))) return { ok: false, error: 'closure_conflict' };
    if (/waitlist_limit/.test(String(error)))return {ok:false,error:'waitlist_limit'};
    if(/waitlist_registration_closed/.test(String(error)))return {ok:false,error:'registration_closed'};
    if (error instanceof Error && /UNIQUE/i.test(error.message)) {
      return { ok: false, error: 'already_waiting' };
    }
    throw error;
  }
  return { ok: true, id };
}

const SEAT_WAITLIST_ERROR_STATUS: Record<string, number> = {
  invalid_slot: 400,
  invalid_party: 400,
  invalid_starts_at: 400,
  starts_at_in_past: 400,
  missing_customer: 400,
  already_waiting: 409,
  registration_closed:409,waitlist_limit:409,closure_conflict:409,
};

/** 店舗が組織のものか確かめる。違えば null。 */
async function storeInOrganization(
  c: Context<Env>,
  organizationId: string,
  storeId: string,
): Promise<{ id: string; timezone: string } | null> {
  const row = await dbFor(c.env).prepare(
    `SELECT id, timezone FROM rt_stores WHERE id = ? AND organization_id = ? AND status != 'archived'`,
  ).bind(storeId, organizationId).first<{ id: string; timezone: string }>();
  return row ?? null;
}

restaurantTest.post('/api/restaurant-test/seat-waitlist', requireRole('owner', 'admin', 'staff'), async (c) => {
  if (!hasOrganizationSelector(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({ success: false, error: '飲食店テスト組織がありません' }, 404);
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) return c.json({ success: false, error: 'invalid_json' }, 400);
  const storeId = typeof body.storeId === 'string' ? body.storeId : '';
  if (!storeId || !await storeBelongsTo(c, organization.id, storeId)) {
    return c.json({ success: false, error: '店舗が正しくありません' }, 400);
  }
  const result = await insertSeatWaitlistEntry(dbFor(c.env, storeId), {
    storeId,
    startsAt: typeof body.startsAt === 'string' ? body.startsAt : '',
    guestCount: Number(body.guestCount),
    customerName: typeof body.customerName === 'string' ? body.customerName : '',
    customerPhone: typeof body.customerPhone === 'string' && body.customerPhone.trim()
      ? body.customerPhone.trim() : null,
    lineUid: typeof body.lineUid === 'string' && body.lineUid.trim() ? body.lineUid.trim() : null,
  });
  if (!result.ok) {
    return c.json(
      { success: false, error: result.error },
      SEAT_WAITLIST_ERROR_STATUS[result.error] as 400 | 409,
    );
  }
  return c.json({ success: true, data: { id: result.id } }, 201);
});

restaurantTest.get('/api/restaurant-test/seat-waitlist', requireRole('owner', 'admin', 'staff'), async (c) => {
  if (!hasOrganizationSelector(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({ success: false, error: '飲食店テスト組織がありません' }, 404);
  const storeId = c.req.query('storeId')?.trim() ?? '';
  const store = storeId ? await storeInOrganization(c, organization.id, storeId) : null;
  if (!store) return c.json({ success: false, error: '店舗が正しくありません' }, 400);
  const conditions = ['w.store_id = ?'];
  const values: unknown[] = [store.id];
  const startsAt = c.req.query('startsAt')?.trim();
  if (startsAt) {
    const startsAtMs = Date.parse(startsAt);
    if (Number.isNaN(startsAtMs)) return c.json({ success: false, error: '日時の指定が正しくありません' }, 400);
    conditions.push('w.starts_at = ?');
    values.push(new Date(startsAtMs).toISOString());
  }
  const status = c.req.query('status')?.trim();
  if (status && ['waiting', 'invited', 'converted', 'cancelled','finished'].includes(status)) {
    conditions.push('w.status = ?');
    values.push(status);
  }
  const rows = await dbFor(c.env, store.id)
    .prepare(
      `SELECT w.*, t.label AS table_label
         FROM rt_seat_waitlist w
         LEFT JOIN rt_tables t ON t.id = w.table_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY w.starts_at ASC, w.created_at ASC, w.rowid ASC LIMIT 100`,
    )
    .bind(...values)
    .all();
  return c.json({ success: true, data: { waitlist: rows.results } });
});

restaurantTest.delete('/api/restaurant-test/seat-waitlist/:id', requireRole('owner', 'admin', 'staff'), async (c) => {
  if (!hasOrganizationSelector(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({ success: false, error: '飲食店テスト組織がありません' }, 404);
  const id = c.req.param('id');
  const entry = await dbFor(c.env).prepare(
    `SELECT w.store_id, w.starts_at, w.status, w.table_id FROM rt_seat_waitlist w
       JOIN rt_stores s ON s.id = w.store_id
      WHERE w.id = ? AND s.organization_id = ?
        AND (? IS NULL OR s.id = ?)`,
  ).bind(id, organization.id, organization.scopedStoreId, organization.scopedStoreId)
    .first<{ store_id: string; starts_at: string; status: string; table_id: string | null }>();
  if (!entry) return c.json({ success: false, error: '見つかりません' }, 404);
  if (entry.status !== 'waiting' && entry.status !== 'invited') {
    return c.json({ success: false, error: 'すでに終わっています' }, 409);
  }
  const wasInvited = entry.status === 'invited';
  const updated = await dbFor(c.env, entry.store_id).prepare(
    `UPDATE rt_seat_waitlist SET status = 'cancelled', updated_at = datetime('now')
      WHERE id = ? AND status IN ('waiting', 'invited')`,
  ).bind(id).run();
  if ((updated.meta?.changes ?? 0) === 0) {
    return c.json({ success: false, error: 'すでに終わっています' }, 409);
  }
  if (wasInvited && entry.table_id) {
    // 見送りで仮押さえが空いたら、その卓に入る次の組へすぐ回す。
    try {
      await promoteSeatWaitlist(dbFor(c.env, entry.store_id), {
        storeId: entry.store_id,
        startsAt: entry.starts_at,
        tableId: entry.table_id,
      }, undefined, c.env.LIFF_URL ?? '',c.env);
    } catch {
      console.error(JSON.stringify({ event: 'seat_waitlist_promote_failed', waitlistId: id }));
    }
  }
  return c.json({ success: true, data: { status: 'cancelled' } });
});

/**
 * 招待ずみの組が予約を取ったとき、待ちを「予約になった」へ進める。
 * 同じ店・同じ開始時刻・同じ組の予約だけ受け付ける。
 */
restaurantTest.post('/api/restaurant-test/seat-waitlist/:id/convert', requireRole('owner', 'admin', 'staff'), async (c) => {
  if (!hasOrganizationSelector(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({ success: false, error: '飲食店テスト組織がありません' }, 404);
  const id = c.req.param('id');
  const body = await c.req.json<{ reservationId?: unknown }>().catch(() => null);
  const reservationId = typeof body?.reservationId === 'string' ? body.reservationId : '';
  if (!reservationId) return c.json({ success: false, error: '予約が必要です' }, 400);
  const entry = await dbFor(c.env).prepare(
    `SELECT w.* FROM rt_seat_waitlist w
       JOIN rt_stores s ON s.id = w.store_id
      WHERE w.id = ? AND s.organization_id = ?
        AND (? IS NULL OR s.id = ?)`,
  ).bind(id, organization.id, organization.scopedStoreId, organization.scopedStoreId)
    .first<SeatWaitlistEntryLike>();
  if (!entry) return c.json({ success: false, error: '見つかりません' }, 404);
  if (entry.status !== 'invited'||!entry.hold_expires_at||Date.parse(entry.hold_expires_at)<=Date.now()) {
    return c.json({ success: false, error: 'すでに終わっています' }, 409);
  }
  const reservation = await dbFor(c.env, entry.store_id).prepare(
    `SELECT store_id, starts_at, guest_count, status,line_uid,customer_phone,table_id FROM rt_reservations
      WHERE id = ? AND store_id = ? AND status NOT IN ('cancelled')`,
  ).bind(reservationId, entry.store_id)
    .first<{ store_id: string; starts_at: string; guest_count: number; status: string;line_uid:string|null;customer_phone:string|null;table_id:string|null }>();
  if (!reservation
    || reservation.starts_at !== entry.starts_at
    || reservation.guest_count !== entry.guest_count
    || reservation.table_id!==entry.table_id
    || (entry.line_uid?reservation.line_uid!==entry.line_uid:reservation.customer_phone!==entry.customer_phone)) {
    return c.json({ success: false, error: '予約が待ちと合いません' }, 409);
  }
  const updated=await dbFor(c.env, entry.store_id).prepare(
    `UPDATE rt_seat_waitlist SET status = 'converted', updated_at = datetime('now')
      WHERE id = ? AND status='invited' AND julianday(hold_expires_at)>julianday('now')`,
  ).bind(id).run();
  if(!updated.meta.changes)return c.json({success:false,error:'案内の期限または状態が変わりました'},409);
  return c.json({ success: true, data: { status: 'converted' } });
});

interface SeatWaitlistEntryLike {
  hold_expires_at:string|null;
  table_id:string|null;
  line_uid:string|null;
  customer_phone:string|null;
  store_id: string;
  starts_at: string;
  guest_count: number;
  status: string;
}

const SEAT_VISIT_KINDS = ['visited', 'late', 'no_show'] as const;

/**
 * 席の予約に印を付ける。「来店した」→来店済み、「来なかった」→無断、
 * 「遅れる」→状態は変えず遅れ分数だけ残す。だれがいつ付けたか残す。
 */
restaurantTest.post('/api/restaurant-test/reservations/:id/visit', requireRole('owner', 'admin', 'staff'), async (c) => {
  if (!hasOrganizationSelector(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({ success: false, error: '飲食店テスト組織がありません' }, 404);
  const id = c.req.param('id');
  const current = await dbFor(c.env).prepare(
    `SELECT r.id, r.store_id, r.status FROM rt_reservations r
       JOIN rt_stores s ON s.id = r.store_id
      WHERE r.id = ? AND s.organization_id = ?
        AND (? IS NULL OR s.id = ?)`,
  ).bind(id, organization.id, organization.scopedStoreId, organization.scopedStoreId)
    .first<{ id: string; store_id: string; status: string }>();
  if (!current) return c.json({ success: false, error: '予約が見つかりません' }, 404);
  const body = await c.req.json<{ kind?: unknown; lateMinutes?: unknown }>().catch(() => null);
  const kind = typeof body?.kind === 'string' && (SEAT_VISIT_KINDS as readonly string[]).includes(body.kind)
    ? body.kind as 'visited' | 'late' | 'no_show'
    : null;
  if (!kind) return c.json({ success: false, error: '印の種類が正しくありません' }, 400);
  const lateMinutes = body?.lateMinutes === undefined || body?.lateMinutes === null
    ? null
    : Number(body.lateMinutes);
  if (kind === 'late') {
    if (!Number.isInteger(lateMinutes) || (lateMinutes as number) < 1 || (lateMinutes as number) > 1440) {
      return c.json({ success: false, error: '遅れ分数は1〜1440で指定してください' }, 400);
    }
  } else if (lateMinutes !== null) {
    return c.json({ success: false, error: '遅れ分数は遅れるのときだけ指定してください' }, 400);
  }
  const next = kind === 'visited' ? 'visited' : kind === 'no_show' ? 'no_show' : current.status;
  if ((kind === 'visited' || kind === 'no_show') && !['pending', 'confirmed', 'seated'].includes(current.status)) {
    return c.json({ success: false, error: 'この状態からは付けられません' }, 409);
  }
  if (kind === 'late' && !['pending', 'confirmed', 'seated'].includes(current.status)) {
    return c.json({ success: false, error: 'すでに終わっています' }, 409);
  }
  const me = c.get('staff') as { id?: string; name?: string } | undefined;
  const markedAt = new Date().toISOString();
  const markId = crypto.randomUUID();
  const db = dbFor(c.env, current.store_id);
  const results = await db.batch([
    db.prepare(`UPDATE rt_reservations SET status = ?, updated_at = datetime('now') WHERE id = ? AND status = ?`)
      .bind(next, id, current.status),
    db.prepare(`INSERT INTO rt_seat_visit_marks
      (id, reservation_id, store_id, kind, late_minutes, marked_by_staff_id, marked_by_name, marked_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1`)
      .bind(markId, id, current.store_id, kind, lateMinutes, me?.id ?? null, me?.name ?? null, markedAt),
  ]);
  if (!results[0].meta.changes) return c.json({ success: false, error: 'ほかの担当者が先に変えました' }, 409);
  return c.json({
    success: true,
    data: {
      status: next,
      visit_mark: {
        id: markId,
        kind,
        late_minutes: lateMinutes,
        marked_by_name: typeof me?.name === 'string' ? me.name : null,
        marked_at: markedAt,
      },
    },
  });
});

/**
 * 席の予約の印を取り消す。最新の印に取消者・時刻を残し、状態を変えていた
 * （来店→来店済み・来なかった→無断）ときは確定へ戻す。
 */
restaurantTest.delete('/api/restaurant-test/reservations/:id/visit', requireRole('owner', 'admin', 'staff'), async (c) => {
  if (!hasOrganizationSelector(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({ success: false, error: '飲食店テスト組織がありません' }, 404);
  const id = c.req.param('id');
  const current = await dbFor(c.env).prepare(
    `SELECT r.id, r.store_id, r.status FROM rt_reservations r
       JOIN rt_stores s ON s.id = r.store_id
      WHERE r.id = ? AND s.organization_id = ?
        AND (? IS NULL OR s.id = ?)`,
  ).bind(id, organization.id, organization.scopedStoreId, organization.scopedStoreId)
    .first<{ id: string; store_id: string; status: string }>();
  if (!current) return c.json({ success: false, error: '予約が見つかりません' }, 404);
  const mark = await dbFor(c.env, current.store_id).prepare(
    `SELECT id, kind FROM rt_seat_visit_marks
      WHERE reservation_id = ? AND store_id = ? AND undone_at IS NULL
      ORDER BY marked_at DESC LIMIT 1`,
  ).bind(id, current.store_id).first<{ id: string; kind: string }>();
  if (!mark) return c.json({ success: false, error: '印がありません' }, 404);
  let next = current.status;
  if (mark.kind === 'visited' && ['seated', 'visited'].includes(current.status)) next = 'confirmed';
  else if (mark.kind === 'no_show' && current.status === 'no_show') next = 'confirmed';
  else if (mark.kind !== 'late') {
    return c.json({ success: false, error: '状態が変わっているため戻せません' }, 409);
  }
  const db = dbFor(c.env, current.store_id);
  const results = await db.batch([
    db.prepare(`UPDATE rt_seat_visit_marks SET undone_at = datetime('now'), undone_by = ?
      WHERE id = ? AND undone_at IS NULL AND EXISTS(SELECT 1 FROM rt_reservations WHERE id = ? AND status = ?)
      AND id = (SELECT id FROM rt_seat_visit_marks WHERE reservation_id = ? AND undone_at IS NULL ORDER BY marked_at DESC LIMIT 1)`)
      .bind(c.get('staff')?.id ?? null, mark.id, id, current.status, id),
    db.prepare(`UPDATE rt_reservations SET status = ?, updated_at = datetime('now')
      WHERE id = ? AND status = ? AND changes() = 1`).bind(next, id, current.status),
  ]);
  if (!results[0].meta.changes) return c.json({ success: false, error: 'ほかの担当者が先に変えました' }, 409);
  return c.json({ success: true, data: { status: next } });
});

/**
 * 予約媒体の受信検証口。管理画面セッションでのみ投入でき、外部媒体へ返す処理は無い。
 * 本接続時は媒体ごとの署名アダプターをこの前段に置く。
 */
restaurantTest.post('/api/restaurant-test/inbound/reservations', requireRole('owner', 'admin'), async (c) => {
  if (!hasOrganizationSelector(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({ success: false, error: '飲食店テスト組織がありません' }, 404);
  const body = await c.req.json<{ storeId?: string; provider?: unknown; eventId?: string; reservation?: unknown }>();
  if (!body.storeId || !await storeBelongsTo(c, organization.id, body.storeId)) return c.json({ success: false, error: '店舗が正しくありません' }, 400);
  if (!isRestaurantReservationSource(body.provider) || ['manual', 'phone', 'line', 'walk_in'].includes(body.provider)) return c.json({ success: false, error: '受信媒体が正しくありません' }, 400);
  if (!body.eventId?.trim()) return c.json({ success: false, error: 'eventId が必要です' }, 400);
  const checked = validateInboundReservation(body.reservation);
  if (!checked.ok) return c.json({ success: false, error: checked.error }, 400);
  const eventDbId = crypto.randomUUID();
  const inserted = await dbFor(c.env, body.storeId).prepare(`INSERT INTO rt_sync_events
    (id, store_id, provider, external_event_id, payload_json, status)
    VALUES (?, ?, ?, ?, ?, 'received') ON CONFLICT(store_id, provider, external_event_id) DO NOTHING`).bind(
      eventDbId, body.storeId, body.provider, body.eventId.trim(), JSON.stringify(body.reservation),
    ).run();
  // R101: 処理済みだけを重複終了にする。失敗・受信中の再送は取り込み直す。
  let syncEventId = eventDbId;
  if (!inserted.meta.changes) {
    const existing = await dbFor(c.env, body.storeId).prepare(
      `SELECT id, status FROM rt_sync_events
       WHERE store_id = ? AND provider = ? AND external_event_id = ? LIMIT 1`,
    ).bind(body.storeId, body.provider, body.eventId.trim())
      .first<{ id: string; status: string }>();
    if (!existing) return c.json({ success: true, data: { duplicate: true, direction: 'inbound' } });
    if (existing.status === 'processed' || existing.status === 'duplicate') {
      return c.json({ success: true, data: { duplicate: true, direction: 'inbound' } });
    }
    syncEventId = existing.id;
    await dbFor(c.env, body.storeId).prepare(
      `UPDATE rt_sync_events SET payload_json = ?, status = 'received', error_message = NULL,
        received_at = datetime('now') WHERE id = ?`,
    ).bind(JSON.stringify(body.reservation), existing.id).run();
  }
  try {
    const value = checked.value;
    const current = await dbFor(c.env, body.storeId).prepare(
      `SELECT id, starts_at, guest_count, status, table_id, course_id, source_updated_at FROM rt_reservations
       WHERE store_id = ? AND source = ? AND external_id = ? LIMIT 1`,
    ).bind(body.storeId, body.provider, value.externalId)
      .first<{ id: string; starts_at: string; guest_count: number; status: string; table_id: string | null; course_id: string | null; source_updated_at: string | null }>();
    // R102: 媒体側の更新時刻が古い通知は記録だけ残して反映しない。
    if (current?.source_updated_at && value.sourceUpdatedAt
      && value.sourceUpdatedAt <= current.source_updated_at) {
      await dbFor(c.env, body.storeId).prepare(
        "UPDATE rt_sync_events SET status = 'processed', processed_at = datetime('now') WHERE id = ?",
      ).bind(syncEventId).run();
      return c.json({ success: true, data: { duplicate: false, stale: true, direction: 'inbound', outboundWrites: 0 } }, 200);
    }
    if (value.tableId && value.tableId !== current?.table_id) {
      const table = await dbFor(c.env, body.storeId).prepare('SELECT id FROM rt_tables WHERE id = ? AND store_id = ? AND is_active = 1')
        .bind(value.tableId, body.storeId).first();
      if (!table) {
        await dbFor(c.env, body.storeId).prepare("UPDATE rt_sync_events SET status = 'failed', error_message = ? WHERE id = ?")
          .bind('停止中の卓は選べません', syncEventId).run();
        return c.json({ success: false, error: '停止中の卓は選べません' }, 400);
      }
    }
    if (value.courseId && value.courseId !== current?.course_id) {
      const course = await dbFor(c.env, body.storeId).prepare("SELECT id FROM rt_menu_items WHERE id = ? AND store_id = ? AND status = 'active'")
        .bind(value.courseId, body.storeId).first();
      if (!course) {
        await dbFor(c.env, body.storeId).prepare("UPDATE rt_sync_events SET status = 'failed', error_message = ? WHERE id = ?")
          .bind('停止中のコースは選べません', syncEventId).run();
        return c.json({ success: false, error: '停止中のコースは選べません' }, 400);
      }
    }
    // R100: 同じ卓に重なる有効予約があれば取り込まない（自分自身の更新は除く）。
    if (value.tableId && await overlappingReservationExists(
      dbFor(c.env, body.storeId), body.storeId, value.tableId, value.startsAt, value.endsAt, current?.id ?? null, c.env,
    )) {
      throw new Error('同じ卓に重なる時間の予約があります');
    }
    const id = crypto.randomUUID();
    await dbFor(c.env, body.storeId).prepare(`INSERT INTO rt_reservations
      (id, store_id, source, external_id, hub_source, customer_name, customer_phone, line_uid, guest_count, starts_at, ends_at, table_id, course_id, status, allergy_note, note, source_updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(store_id, source, external_id) DO UPDATE SET
        customer_name = excluded.customer_name, customer_phone = excluded.customer_phone,
        line_uid = excluded.line_uid, guest_count = excluded.guest_count, starts_at = excluded.starts_at,
        ends_at = excluded.ends_at, table_id = excluded.table_id, course_id = excluded.course_id,
        status = excluded.status, allergy_note = excluded.allergy_note, note = excluded.note,
        source_updated_at = excluded.source_updated_at, updated_at = datetime('now')`).bind(
          id, body.storeId, body.provider, value.externalId,
          body.provider === 'restaurant_board' || body.provider === 'reszaiko' ? body.provider : null,
          value.customerName, value.customerPhone, value.lineUid, value.guestCount, value.startsAt, value.endsAt,
          value.tableId, value.courseId, value.status, value.allergyNote, value.note, value.sourceUpdatedAt,
        ).run();
    // R100: 時間帯在庫の予約済数を人数分だけ動かす（更新時は差分・枠移動を調整）。
    await applyReservationInventoryChange(
      dbFor(c.env, body.storeId), body.storeId,
      current ? { starts_at: current.starts_at, guest_count: current.guest_count, status: current.status } : null,
      { starts_at: value.startsAt, guest_count: value.guestCount, status: value.status ?? 'confirmed' },
    );
    await dbFor(c.env, body.storeId).prepare("UPDATE rt_sync_events SET status = 'processed', processed_at = datetime('now') WHERE id = ?").bind(syncEventId).run();
    return c.json({ success: true, data: { duplicate: false, direction: 'inbound', outboundWrites: 0 } }, 201);
  } catch (error) {
    await dbFor(c.env, body.storeId).prepare("UPDATE rt_sync_events SET status = 'failed', error_message = ? WHERE id = ?").bind(error instanceof Error ? error.message.slice(0, 500) : 'unknown', syncEventId).run();
    throw error;
  }
});

function validFloorCoordinate(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 10000;
}
function validJoinGroup(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.length <= 100);
}

restaurantTest.put('/api/restaurant-test/tables/layout', requireRole('owner', 'admin'), async (c) => {
  if (!hasOrganizationSelector(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({ success: false, error: '飲食店テスト組織がありません' }, 404);
  const body = await c.req.json<RestaurantTableLayoutInput>().catch(() => null);
  if (!body || typeof body.storeId !== 'string' || !await storeBelongsTo(c, organization.id, body.storeId)) return c.json({ success: false, error: '店舗が正しくありません' }, 400);
  if (!Array.isArray(body.tables) || !body.tables.length || body.tables.length > 200
      || body.tables.some(t => !t || typeof t.id !== 'string' || !t.id || !validFloorCoordinate(t.floorX) || !validFloorCoordinate(t.floorY) || !validJoinGroup(t.joinGroup))
      || new Set(body.tables.map(t => t.id)).size !== body.tables.length) return c.json({ success: false, error: '卓の配置が正しくありません' }, 400);
  const rows = body.tables.map(t => ({ ...t, joinGroup: t.joinGroup?.trim() || null }));
  const result = await dbFor(c.env).prepare(`WITH positions AS MATERIALIZED (
    SELECT json_extract(value,'$.id') AS id,json_extract(value,'$.floorX') AS x,json_extract(value,'$.floorY') AS y,json_extract(value,'$.joinGroup') AS join_group FROM json_each(?)
  ), eligible AS MATERIALIZED (SELECT t.id FROM rt_tables t JOIN positions p ON p.id=t.id WHERE t.store_id=?)
  UPDATE rt_tables SET floor_x=(SELECT x FROM positions WHERE id=rt_tables.id),floor_y=(SELECT y FROM positions WHERE id=rt_tables.id),
    join_group=(SELECT join_group FROM positions WHERE id=rt_tables.id),updated_at=datetime('now')
    WHERE id IN (SELECT id FROM eligible) AND (SELECT COUNT(*) FROM eligible)=?`)
    .bind(JSON.stringify(rows), body.storeId, rows.length).run();
  if (result.meta.changes !== rows.length) return c.json({ success: false, error: '卓が見つかりません。配置を読み直してください' }, 404);
  return c.json({ success: true, data: { tables: rows } });
});

restaurantTest.post('/api/restaurant-test/tables', requireRole('owner', 'admin'), async (c) => {
  if (!hasOrganizationSelector(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({ success: false, error: '飲食店テスト組織がありません' }, 404);
  const body = await c.req.json<{ storeId?: string; code?: string; label?: string; seatType?: string; minCapacity?: number; maxCapacity?: number; floorX?: number; floorY?: number; joinGroup?: string | null }>();
  if (!body.storeId || !await storeBelongsTo(c, organization.id, body.storeId)) return c.json({ success: false, error: '店舗が正しくありません' }, 400);
  const seatTypes = ['counter', 'table', 'private_room', 'terrace'];
  const min = Number(body.minCapacity);
  const max = Number(body.maxCapacity);
  if (!body.code?.trim() || !body.label?.trim() || !seatTypes.includes(body.seatType || '') || !Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min) return c.json({ success: false, error: '卓の入力内容が正しくありません' }, 400);
  if (!validFloorCoordinate(body.floorX === undefined ? 0 : body.floorX) || !validFloorCoordinate(body.floorY === undefined ? 0 : body.floorY) || !validJoinGroup(body.joinGroup ?? null)) return c.json({ success: false, error: '卓の配置が正しくありません' }, 400);
  const id = crypto.randomUUID();
  await dbFor(c.env, body.storeId).prepare('INSERT INTO rt_tables (id, store_id, code, label, seat_type, min_capacity, max_capacity, floor_x, floor_y, join_group) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, body.storeId, body.code.trim(), body.label.trim(), body.seatType, min, max, body.floorX ?? 0, body.floorY ?? 0, body.joinGroup?.trim() || null).run();
  return c.json({ success: true, data: { id } }, 201);
});

restaurantTest.post('/api/restaurant-test/memberships', requireRole('owner', 'admin'), async (c) => {
  if (!hasOrganizationSelector(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({ success: false, error: '飲食店テスト組織がありません' }, 404);
  const body = await c.req.json<{ storeId?: string | null; staffName?: string; email?: string; role?: string; lineUid?: string; googleEmail?: string }>();
  if (body.storeId && !await storeBelongsTo(c, organization.id, body.storeId)) return c.json({ success: false, error: '店舗が正しくありません' }, 400);
  if (!body.staffName?.trim() || !['super_admin', 'store_manager', 'staff'].includes(body.role || '')) return c.json({ success: false, error: '氏名と役割が必要です' }, 400);
  if (body.role === 'super_admin' && c.get('staff')?.role !== 'owner') return c.json({ success: false, error: 'SuperAdminを追加できるのはオーナーだけです' }, 403);
  const id = crypto.randomUUID();
  await dbFor(c.env, body.storeId).prepare(`INSERT INTO rt_memberships
    (id, organization_id, store_id, staff_name, email, role, line_uid, google_email, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`).bind(
      id, organization.id, body.storeId || null, body.staffName.trim(), body.email?.trim() || null,
      body.role, body.lineUid?.trim() || null, body.googleEmail?.trim() || null,
    ).run();
  return c.json({ success: true, data: { id } }, 201);
});

restaurantTest.patch('/api/restaurant-test/tables/:id', requireRole('owner', 'admin'), async (c) => {
  if (!hasOrganizationSelector(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({ success: false, error: '飲食店テスト組織がありません' }, 404);
  const current = await dbFor(c.env).prepare(`SELECT t.* FROM rt_tables t JOIN rt_stores s ON s.id = t.store_id
    WHERE t.id = ? AND s.organization_id = ? AND (? IS NULL OR s.id = ?)`)
    .bind(c.req.param('id'), organization.id, organization.scopedStoreId, organization.scopedStoreId)
    .first<{ store_id: string; code: string; label: string; seat_type: string; min_capacity: number; max_capacity: number; is_active: number; floor_x: number; floor_y: number; join_group: string | null }>();
  if (!current || !await storeBelongsTo(c, organization.id, current.store_id)) return c.json({ success: false, error: '卓が見つかりません' }, 404);
  const body = await c.req.json<{ code?: string; label?: string; seatType?: string; minCapacity?: number; maxCapacity?: number; isActive?: boolean; floorX?: number; floorY?: number; joinGroup?: string | null }>();
  const code = body.code === undefined ? current.code : body.code;
  const label = body.label === undefined ? current.label : body.label;
  const seatType = body.seatType === undefined ? current.seat_type : body.seatType;
  const min = body.minCapacity === undefined ? current.min_capacity : body.minCapacity;
  const max = body.maxCapacity === undefined ? current.max_capacity : body.maxCapacity;
  if (typeof code !== 'string' || !code.trim() || typeof label !== 'string' || !label.trim()
    || !['counter', 'table', 'private_room', 'terrace'].includes(seatType)
    || !Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min
    || (body.isActive !== undefined && typeof body.isActive !== 'boolean')
    || (body.floorX !== undefined && !validFloorCoordinate(body.floorX))
    || (body.floorY !== undefined && !validFloorCoordinate(body.floorY))
    || (body.joinGroup !== undefined && body.joinGroup !== null && (typeof body.joinGroup !== 'string' || body.joinGroup.length > 100))) {
    return c.json({ success: false, error: '卓の入力内容が正しくありません' }, 400);
  }
  await dbFor(c.env, current.store_id).prepare(`UPDATE rt_tables SET code = ?, label = ?, seat_type = ?, min_capacity = ?, max_capacity = ?, is_active = ?, floor_x = ?, floor_y = ?, join_group = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(code.trim(), label.trim(), seatType, min, max, body.isActive === undefined ? current.is_active : Number(body.isActive), body.floorX ?? current.floor_x, body.floorY ?? current.floor_y, body.joinGroup === undefined ? current.join_group : body.joinGroup?.trim() || null, c.req.param('id')).run();
  return c.json({ success: true, data: { id: c.req.param('id') } });
});

restaurantTest.patch('/api/restaurant-test/memberships/:id', requireRole('owner', 'admin'), async (c) => {
  if (!hasOrganizationSelector(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({ success: false, error: '飲食店テスト組織がありません' }, 404);
  const current = await dbFor(c.env).prepare(`SELECT * FROM rt_memberships WHERE id = ? AND organization_id = ? AND (? IS NULL OR store_id = ?)`)
    .bind(c.req.param('id'), organization.id, organization.scopedStoreId, organization.scopedStoreId)
    .first<{ store_id: string | null; staff_name: string; email: string | null; role: string; line_uid: string | null; google_email: string | null; status: string; staff_id: string | null }>();
  if (!current) return c.json({ success: false, error: '所属ユーザーが見つかりません' }, 404);
  const body = await c.req.json<{ storeId?: string | null; staffName?: string; email?: string | null; role?: string; lineUid?: string | null; googleEmail?: string | null; status?: string; expectedPolicyVersion?: number; idempotencyKey?: string }>();
  const storeId = body.storeId === undefined ? current.store_id : body.storeId === '' ? null : body.storeId;
  const name = body.staffName === undefined ? current.staff_name : body.staffName;
  const role = body.role === undefined ? current.role : body.role;
  const status = body.status === undefined ? current.status : body.status;
  if (typeof name !== 'string' || !name.trim() || !['super_admin', 'store_manager', 'staff'].includes(role)
    || !['active', 'invited', 'suspended'].includes(status)
    || [body.email, body.lineUid, body.googleEmail].some((value) => value !== undefined && value !== null && typeof value !== 'string')
    || (storeId !== null && (typeof storeId !== 'string' || !await storeBelongsTo(c, organization.id, storeId)))
    || (organization.scopedStoreId && storeId !== organization.scopedStoreId)) {
    return c.json({ success: false, error: '所属ユーザーの入力内容が正しくありません' }, 400);
  }
  if ((role === 'super_admin' || current.role === 'super_admin') && c.get('staff')?.role !== 'owner') {
    return c.json({ success: false, error: 'SuperAdminを変更できるのはオーナーだけです' }, 403);
  }
  if (current.staff_id && (role !== current.role || status !== current.status || storeId !== current.store_id)) {
    if (!Number.isSafeInteger(body.expectedPolicyVersion) || Number(body.expectedPolicyVersion) < 1) return c.json({success:false,error:'ログイン権限の版を読み直してください'},400);
    if (role === 'super_admin' || current.role === 'super_admin') return c.json({success:false,error:'オーナーの権限と利用状態は統括メンバーで管理してください'},403);
    if (status === 'invited') return c.json({success:false,error:'連携済みのログインメンバーを招待状態へ戻せません'},400);
    const loginStore = storeId ? await dbFor(c.env).prepare('SELECT line_account_id FROM rt_stores WHERE id=?').bind(storeId).first<{line_account_id:string|null}>() : null;
    if (storeId && !loginStore?.line_account_id) return c.json({success:false,error:'担当店舗にLINEアカウントを設定してください'},400);
    // 既存の認可・再認証・最終管理者保護・セッション失効・版検査をそのまま使う。
    const response = await updateStaffPolicy(c, current.staff_id, {
      ...(role !== current.role ? {role: role === 'store_manager' ? 'admin' : 'staff'} : {}),
      ...(status !== current.status ? {isActive: status === 'active'} : {}),
      ...(storeId !== current.store_id ? {accountScope:storeId ? 'accounts' : 'all',scopedLineAccountIds:storeId ? [loginStore!.line_account_id!] : []} : {}),
      expectedPolicyVersion:body.expectedPolicyVersion, idempotencyKey:body.idempotencyKey,
    });
    if (!response.ok) return response;
  }
  const optional = (value: string | null | undefined, old: string | null) => value === undefined ? old : typeof value === 'string' ? value.trim() || null : null;
  await dbFor(c.env, storeId || undefined).prepare(`UPDATE rt_memberships SET store_id = ?, staff_name = ?, email = ?, role = ?, line_uid = ?, google_email = ?, status = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(storeId, name.trim(), optional(body.email, current.email), role, optional(body.lineUid, current.line_uid), optional(body.googleEmail, current.google_email), status, c.req.param('id')).run();
  return c.json({ success: true, data: { id: c.req.param('id') } });
});

const updateRestaurantMenu = async (c: Context<Env>) => {
  if (!hasOrganizationSelector(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({ success: false, error: '飲食店テスト組織がありません' }, 404);
  const current = await dbFor(c.env).prepare(`SELECT m.* FROM rt_menu_items m JOIN rt_stores s ON s.id = m.store_id
    WHERE m.id = ? AND s.organization_id = ? AND (? IS NULL OR s.id = ?)`)
    .bind(c.req.param('id'), organization.id, organization.scopedStoreId, organization.scopedStoreId)
    .first<{ store_id: string; kind: string; name: string; price: number; allergens_json: string; service_periods_json: string; status: string }>();
  if (!current) return c.json({ success: false, error: 'メニューが見つかりません' }, 404);
  const body = await c.req.json<{ kind?: string; name?: string; price?: number; allergens?: string[]; servicePeriods?: string[]; status?: string; effectiveAt?: string | null }>();
  const kind = body.kind === undefined ? current.kind : body.kind;
  const name = body.name === undefined ? current.name : body.name;
  const price = body.price === undefined ? current.price : body.price;
  const status = body.status === undefined ? current.status : body.status;
  if (!['course', 'a_la_carte'].includes(kind) || typeof name !== 'string' || !name.trim()
    || !Number.isInteger(price) || price < 0 || !['draft', 'active', 'archived'].includes(status)
    || (body.allergens !== undefined && (!Array.isArray(body.allergens) || body.allergens.some((item) => typeof item !== 'string')))
    || (body.servicePeriods !== undefined && (!Array.isArray(body.servicePeriods) || body.servicePeriods.some((item) => !['lunch', 'dinner'].includes(item))))) {
    return c.json({ success: false, error: 'メニューの入力内容が正しくありません' }, 400);
  }
  if (body.effectiveAt !== undefined && body.effectiveAt !== null && (typeof body.effectiveAt !== 'string' || !Number.isFinite(Date.parse(body.effectiveAt)))) return c.json({ success:false,error:'価格の開始日時を確認してください' },400);
  const effectiveAt = body.effectiveAt ? new Date(body.effectiveAt).toISOString() : null;
  const db = dbFor(c.env, current.store_id);
  const approvalId = price !== current.price ? crypto.randomUUID() : null;
  const requestId = approvalId ? crypto.randomUUID() : null;
  const writes = [db.prepare(`UPDATE rt_menu_items SET kind = ?, name = ?, allergens_json = ?, service_periods_json = ?, status = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(kind, name.trim(), body.allergens === undefined ? current.allergens_json : JSON.stringify(body.allergens), body.servicePeriods === undefined ? current.service_periods_json : JSON.stringify(body.servicePeriods), status, c.req.param('id'))];
  if (approvalId) {
    const requester = c.get('staff')?.id || '管理者';
    writes.push(db.prepare(`INSERT INTO rt_approval_requests (id, organization_id, store_id, kind, title, status, payload_json, requested_by)
      VALUES (?, ?, ?, 'menu_change', ?, 'pending', ?, ?)`).bind(approvalId, organization.id, current.store_id,
      `${name.trim()}の価格変更`, JSON.stringify({ menuId: c.req.param('id'), beforePrice: current.price, afterPrice: price, effectiveAt }), requester));
    writes.push(db.prepare(`INSERT INTO rt_menu_change_requests (id, approval_id, menu_id, store_id, before_price, after_price, requested_by, effective_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(requestId, approvalId, c.req.param('id'), current.store_id, current.price, price, requester, effectiveAt));
  }
  try {
    await db.batch(writes);
  } catch (error) {
    if (/unique constraint/i.test(String(error))) return c.json({ success: false, error: 'このメニューの価格は申請中です。承認または差し戻しを待ってください' }, 409);
    throw error;
  }
  return c.json({ success: true, data: { id: c.req.param('id'), approvalId, requestId, pendingPrice: approvalId ? price : null } });
};
restaurantTest.patch('/api/restaurant-test/menu/:id', requireRole('owner', 'admin'), updateRestaurantMenu);
restaurantTest.patch('/api/restaurant-test/menus/:id', requireRole('owner', 'admin'), updateRestaurantMenu);

/** 全枠を一括保存し、どれか一つの版が古ければ一件も変更しない。 */
restaurantTest.put('/api/restaurant-test/inventory/allocation', requireRole('owner', 'admin'), async c => {
  if (!hasOrganizationSelector(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({success:false,error:'組織が見つかりません'},404);
  const body = await c.req.json<{storeId:string;slots:Array<{id:string;expectedVersion:number}>;otaCapacity:number;lineCapacity:number;walkInCapacity:number;sameDayCapacity?:number}>().catch(()=>null);
  if (!body || !Array.isArray(body.slots) || body.slots.length<1 || body.slots.length>200 || new Set(body.slots.map(s=>s?.id)).size!==body.slots.length
    || body.slots.some(s=>!s || typeof s.id!=='string' || !Number.isSafeInteger(s.expectedVersion) || s.expectedVersion<1)
    || !await storeBelongsTo(c,organization.id,body.storeId)) return c.json({success:false,error:'店舗・枠・版を確認してください'},400);
  const db=dbFor(c.env,body.storeId); const total=await restaurantTableCapacity(db,body.storeId);
  const allocation=[body.otaCapacity,body.lineCapacity,body.walkInCapacity,body.sameDayCapacity??0]; const sum=allocation.reduce((a,b)=>a+b,0);
  if(allocation.some(n=>!Number.isSafeInteger(n)||n<0)||sum>total) return c.json({success:false,error:'稼働中の席数以内で配分してください'},400);
  const result=await db.prepare(`WITH expected AS MATERIALIZED (
      SELECT json_extract(value,'$.id') AS id,json_extract(value,'$.expectedVersion') AS version FROM json_each(?)
    ), eligible AS MATERIALIZED (
      SELECT i.id FROM rt_inventory_slots i JOIN expected e ON e.id=i.id AND e.version=i.version WHERE i.store_id=? AND i.auto_line_original IS NULL AND i.auto_same_day_original IS NULL
    ) UPDATE rt_inventory_slots SET ota_capacity=?,line_capacity=?,walk_in_capacity=?,same_day_capacity=?,version=version+1,updated_by=?,updated_at=datetime('now')
    WHERE store_id=? AND id IN (SELECT id FROM eligible) AND (SELECT COUNT(*) FROM eligible)=?
    AND ? <= COALESCE((SELECT SUM(max_capacity) FROM rt_tables WHERE store_id=? AND is_active=1),0)`)
    .bind(JSON.stringify(body.slots),body.storeId,...allocation,c.get('staff')!.id,body.storeId,body.slots.length,sum,body.storeId).run();
  if(result.meta.changes!==body.slots.length) return c.json({success:false,error:'ほかの担当者が先に保存しました。最新の内容を比べてください'},409);
  return c.json({success:true,data:{updated:result.meta.changes}});
});

restaurantTest.put('/api/restaurant-test/inventory/:id', requireRole('owner', 'admin'), async (c) => {
  if (!hasOrganizationSelector(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({ success: false, error: '飲食店テスト組織がありません' }, 404);
  const db = dbFor(c.env);
  const slot = await db.prepare(`SELECT i.store_id, i.version FROM rt_inventory_slots i JOIN rt_stores s ON s.id = i.store_id
    WHERE i.id = ? AND s.organization_id = ? AND (? IS NULL OR s.id = ?)`)
    .bind(c.req.param('id'), organization.id, organization.scopedStoreId, organization.scopedStoreId)
    .first<{ store_id: string; version: number }>();
  if (!slot) return c.json({ success: false, error: '対象がありません' }, 404);
  const body: { totalCapacity?: number; otaCapacity?: number; lineCapacity?: number; walkInCapacity?: number; sameDayCapacity?: number; expectedVersion?: number } = (await c.req.json().catch(() => null)) || {};
  if (!Number.isSafeInteger(body.expectedVersion) || (body.expectedVersion ?? 0) < 1) return c.json({ success: false, error: 'expectedVersion に読み込んだ版を指定してください' }, 400);
  if (body.expectedVersion !== slot.version) return c.json({ success: false, error: 'ほかの担当者が先に保存しました。読み直してください', currentVersion: slot.version }, 409);
  const values = [body.otaCapacity, body.lineCapacity, body.walkInCapacity,body.sameDayCapacity??0];
  const totalCapacity = await restaurantTableCapacity(db, slot.store_id);
  if (values.some((value) => typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    || values.reduce<number>((sum, value) => sum + Number(value), 0) > totalCapacity) {
    return c.json({ success: false, error: '媒体別枠の合計は稼働中の卓の総席数以下にしてください', totalCapacity }, 400);
  }
  const result = await db.prepare(`UPDATE rt_inventory_slots SET
    total_capacity = COALESCE((SELECT SUM(max_capacity) FROM rt_tables WHERE store_id = rt_inventory_slots.store_id AND is_active = 1), 0),
    ota_capacity = ?, line_capacity = ?, walk_in_capacity = ?, same_day_capacity = ?, version = version + 1, updated_by = ?, updated_at = datetime('now')
    WHERE id = ? AND version = ? AND auto_line_original IS NULL AND auto_same_day_original IS NULL
      AND ? <= COALESCE((SELECT SUM(max_capacity) FROM rt_tables WHERE store_id = rt_inventory_slots.store_id AND is_active = 1), 0)`)
    .bind(...values, c.get('staff')?.id || '管理者', c.req.param('id'), body.expectedVersion,
      values.reduce<number>((sum, value) => sum + Number(value), 0)).run();
  if (!result.meta.changes) return c.json({ success: false, error: '卓または予約枠が変更されました。読み直してください' }, 409);
  const savedVersion=await db.prepare('SELECT version FROM rt_inventory_slots WHERE id=?').bind(c.req.param('id')).first<{version:number}>();
  return c.json({ success: true, data: { id: c.req.param('id'), totalCapacity, version: savedVersion!.version } });
});

restaurantTest.get('/api/restaurant-test/opening-hours', requireRole('owner', 'admin', 'staff'), async (c) => {
  if (!hasOrganizationSelector(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({ success: false, error: '飲食店テスト組織がありません' }, 404);
  const storeId = c.req.query('storeId') || organization.scopedStoreId;
  if (!storeId || (organization.scopedStoreId && organization.scopedStoreId !== storeId) || !await storeBelongsTo(c, organization.id, storeId)) return c.json({ success: false, error: '店舗が正しくありません' }, 400);
  const row = await dbFor(c.env, storeId).prepare('SELECT hours_json, version, updated_by, updated_at FROM rt_opening_hours_settings WHERE store_id = ?')
    .bind(storeId).first<{ hours_json: string; version: number; updated_by: string; updated_at: string }>();
  return c.json({ success: true, data: { storeId, hours: row ? JSON.parse(row.hours_json) : null, version: row?.version ?? 0, updatedBy: row?.updated_by ?? null, updatedAt: row?.updated_at ?? null } });
});

restaurantTest.put('/api/restaurant-test/opening-hours', requireRole('owner', 'admin'), async (c) => {
  if (!hasOrganizationSelector(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({ success: false, error: '飲食店テスト組織がありません' }, 404);
  const body: { storeId?: string; hours?: unknown; expectedVersion?: number } = (await c.req.json().catch(() => null)) || {};
  const storeId = typeof body.storeId === 'string' ? body.storeId : body.storeId === undefined ? organization.scopedStoreId : null;
  if (!storeId || (organization.scopedStoreId && organization.scopedStoreId !== storeId) || !await storeBelongsTo(c, organization.id, storeId)) return c.json({ success: false, error: '店舗が正しくありません' }, 400);
  const hours = validateRestaurantOpeningHours(body.hours);
  if (!hours || !Number.isSafeInteger(body.expectedVersion) || (body.expectedVersion ?? -1) < 0) {
    return c.json({ success: false, error: '曜日0〜6の営業時間とexpectedVersionを指定してください。重なる営業時間は保存できません' }, 400);
  }
  const db = dbFor(c.env, storeId);
  const result = body.expectedVersion === 0
    ? await db.prepare(`INSERT INTO rt_opening_hours_settings (store_id, hours_json, updated_by) VALUES (?, ?, ?) ON CONFLICT(store_id) DO NOTHING`)
      .bind(storeId, JSON.stringify(hours), c.get('staff')?.id || '管理者').run()
    : await db.prepare(`UPDATE rt_opening_hours_settings SET hours_json = ?, version = version + 1, updated_by = ?, updated_at = datetime('now')
      WHERE store_id = ? AND version = ?`).bind(JSON.stringify(hours), c.get('staff')?.id || '管理者', storeId, body.expectedVersion).run();
  if (!result.meta.changes) return c.json({ success: false, error: 'ほかの担当者が先に保存しました。読み直してください' }, 409);
  return c.json({ success: true, data: { storeId, hours, version: body.expectedVersion! + 1 } });
});

restaurantTest.post('/api/restaurant-test/menu', requireRole('owner', 'admin'), async (c) => {
  if (!hasOrganizationSelector(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({ success: false, error: '飲食店テスト組織がありません' }, 404);
  const body = await c.req.json<{ storeId?: string; kind?: string; name?: string; price?: number; allergens?: string[]; servicePeriods?: string[]; status?: string }>();
  if (!body.storeId || !await storeBelongsTo(c, organization.id, body.storeId)) return c.json({ success: false, error: '店舗が正しくありません' }, 400);
  const price = Number(body.price);
  if (!['course', 'a_la_carte'].includes(body.kind || '') || !body.name?.trim() || !Number.isInteger(price) || price < 0) return c.json({ success: false, error: 'メニューの入力内容が正しくありません' }, 400);
  const status = body.status ?? 'active';
  if (!['draft', 'active'].includes(status)) return c.json({ success: false, error: '作成時の状態は下書きまたは公開です' }, 400);
  const id = crypto.randomUUID();
  await dbFor(c.env, body.storeId).prepare('INSERT INTO rt_menu_items (id, store_id, kind, name, price, allergens_json, service_periods_json, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(id, body.storeId, body.kind, body.name.trim(), price, JSON.stringify(body.allergens || []), JSON.stringify(body.servicePeriods || ['dinner']), status).run();
  return c.json({ success: true, data: { id } }, 201);
});

restaurantTest.get('/api/restaurant-test/menus', requireRole('owner', 'admin', 'staff'), async (c) => {
  if (!hasOrganizationSelector(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({ success: false, error: '飲食店テスト組織がありません' }, 404);
  await applyDueRestaurantMenuPrices(dbFor(c.env), organization.id, organization.scopedStoreId ?? undefined);
  const storeId = c.req.query('storeId') || null;
  if (storeId && !await storeBelongsTo(c, organization.id, storeId)) return c.json({ success: false, error: '店舗が正しくありません' }, 400);
  const rows = await dbFor(c.env, storeId).prepare(`SELECT m.*,
    (SELECT after_price FROM rt_menu_change_requests r WHERE r.menu_id = m.id AND r.status IN ('pending','approved')) AS pendingPrice, (SELECT effective_at FROM rt_menu_change_requests r WHERE r.menu_id=m.id AND r.status IN ('pending','approved')) AS pendingEffectiveAt, (SELECT status FROM rt_menu_change_requests r WHERE r.menu_id=m.id AND r.status IN ('pending','approved')) AS priceChangeStatus
    FROM rt_menu_items m JOIN rt_stores s ON s.id = m.store_id
    WHERE s.organization_id = ? AND (? IS NULL OR m.store_id = ?) AND (? IS NULL OR m.store_id = ?)
    ORDER BY m.kind, m.name`).bind(organization.id, organization.scopedStoreId, organization.scopedStoreId, storeId, storeId).all();
  return c.json({ success: true, data: rows.results });
});

restaurantTest.delete('/api/restaurant-test/menus/:id', requireRole('owner', 'admin'), async (c) => {
  if (!hasOrganizationSelector(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({ success: false, error: '飲食店テスト組織がありません' }, 404);
  const db = dbFor(c.env);
  const menu = await db.prepare(`SELECT m.id, m.status, m.published_once, m.publication_history_unknown FROM rt_menu_items m JOIN rt_stores s ON s.id = m.store_id
    WHERE m.id = ? AND s.organization_id = ? AND (? IS NULL OR s.id = ?)`)
    .bind(c.req.param('id'), organization.id, organization.scopedStoreId, organization.scopedStoreId)
    .first<{ id: string; status: string; published_once: number; publication_history_unknown: number }>();
  if (!menu) return c.json({ success: false, error: 'メニューが見つかりません' }, 404);
  if (menu.publication_history_unknown) return c.json({ success: false, error: 'このメニューは過去の公開履歴を確認できません。削除せず停止してください' }, 409);
  if (menu.status !== 'draft' || menu.published_once) return c.json({ success: false, error: '公開したメニューは削除できません。停止してください' }, 409);
  const result = await db.prepare(`DELETE FROM rt_menu_items WHERE id = ? AND status = 'draft' AND published_once = 0 AND publication_history_unknown = 0
    AND NOT EXISTS (SELECT 1 FROM rt_menu_change_requests WHERE menu_id = rt_menu_items.id)
    AND NOT EXISTS (SELECT 1 FROM rt_reservations WHERE course_id = rt_menu_items.id)`)
    .bind(menu.id).run();
  if (!result.meta.changes) return c.json({ success: false, error: '申請や予約で使われているメニューは削除できません。停止してください' }, 409);
  return c.json({ success: true, data: { id: menu.id } });
});

restaurantTest.post('/api/restaurant-test/gbp/posts', requireRole('owner', 'admin'), async (c) => {
  if (!hasOrganizationSelector(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({ success: false, error: '飲食店テスト組織がありません' }, 404);
  const body = await c.req.json<{ storeId?: string; postType?: string; title?: string; body?: string; ctaType?: string; ctaUrl?: string }>();
  if (!body.storeId || !await storeBelongsTo(c, organization.id, body.storeId)) return c.json({ success: false, error: '店舗が正しくありません' }, 400);
  if (!['standard', 'event', 'offer'].includes(body.postType || '') || !body.title?.trim() || !body.body?.trim()) return c.json({ success: false, error: '投稿種別・タイトル・本文が必要です' }, 400);
  const postId = crypto.randomUUID();
  const approvalId = crypto.randomUUID();
  const staff = c.get('staff');
  await dbFor(c.env, body.storeId).batch([
    dbFor(c.env, body.storeId).prepare(`INSERT INTO rt_gbp_posts
      (id, store_id, post_type, title, body, cta_type, cta_url, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`).bind(postId, body.storeId, body.postType, body.title.trim(), body.body.trim(), body.ctaType || null, body.ctaUrl?.trim() || null),
    dbFor(c.env, body.storeId).prepare(`INSERT INTO rt_approval_requests
      (id, organization_id, store_id, kind, title, status, payload_json, requested_by)
      VALUES (?, ?, ?, 'gbp_post', ?, 'pending', ?, ?)`).bind(approvalId, organization.id, body.storeId, body.title.trim(), JSON.stringify({ postId }), staff?.name || staff?.id || '管理者'),
  ]);
  return c.json({ success: true, data: { postId, approvalId, published: false } }, 201);
});

restaurantTest.put('/api/restaurant-test/gbp/reviews/:id/draft', requireRole('owner', 'admin'), async (c) => {
  if (!hasOrganizationSelector(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({ success: false, error: '飲食店テスト組織がありません' }, 404);
  const body = await c.req.json<{ replyDraft?: string }>();
  if (!body.replyDraft?.trim()) return c.json({ success: false, error: '返信案が必要です' }, 400);
  const result = await dbFor(c.env).prepare(`UPDATE rt_gbp_reviews SET reply_draft = ?, reply_status = 'draft', updated_at = datetime('now')
    WHERE id = ? AND store_id IN (
      SELECT id FROM rt_stores WHERE organization_id = ? AND (? IS NULL OR id = ?)
    )`).bind(
      body.replyDraft.trim(), c.req.param('id'), organization.id,
      organization.scopedStoreId, organization.scopedStoreId,
    ).run();
  if (!result.meta.changes) return c.json({ success: false, error: '対象がありません' }, 404);
  return c.json({ success: true, data: { id: c.req.param('id'), sent: false } });
});

restaurantTest.put('/api/restaurant-test/line-flows/:id', requireRole('owner', 'admin'), async (c) => {
  if (!hasOrganizationSelector(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({ success: false, error: '飲食店テスト組織がありません' }, 404);
  const body = await c.req.json<{ title?: string; body?: string; timingMinutes?: number | null; isEnabled?: boolean }>();
  if (!body.title?.trim() || !body.body?.trim()) return c.json({ success: false, error: 'タイトルと本文が必要です' }, 400);
  const result = await dbFor(c.env).prepare(`UPDATE rt_line_flows SET title = ?, body = ?, timing_minutes = ?, is_enabled = ?,
    delivery_mode = 'preview_only', updated_at = datetime('now')
    WHERE id = ? AND organization_id = ? AND (? IS NULL OR store_id = ?)`).bind(
      body.title.trim(), body.body.trim(), body.timingMinutes ?? null, body.isEnabled ? 1 : 0,
      c.req.param('id'), organization.id, organization.scopedStoreId, organization.scopedStoreId,
    ).run();
  if (!result.meta.changes) return c.json({ success: false, error: '対象がありません' }, 404);
  return c.json({ success: true, data: { id: c.req.param('id'), deliveryMode: 'preview_only' } });
});

restaurantTest.post('/api/restaurant-test/reservations/holds', requireRole('owner', 'admin', 'staff'), async c => {
  if (!hasOrganizationSelector(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({ success: false, error: '組織が見つかりません' }, 404);
  const body = validateRestaurantHold(await c.req.json().catch(() => null));
  if (!body) return c.json({ success: false, error: '日時・人数・仮押さえの期限（1〜120分）を確認してください' }, 400);
  if (!await storeBelongsTo(c, organization.id, body.storeId)) return c.json({ success: false, error: '店舗が正しくありません' }, 400);
  const db = dbFor(c.env, body.storeId);
  await expireRestaurantHolds(db, undefined, body.storeId);
  const owner = crypto.randomUUID();
  const key = `reservation:${body.storeId}`;
  if (!await acquireLock(db, key, owner)) return c.json({ success: false, error: '同じ店舗で予約を更新中です。再度お試しください' }, 409);
  try {
    const closures = await closuresForRange(db, body.storeId, body.startsAt, body.endsAt);
    const tables = await openSeatTables(db, body.storeId, body.startsAt, body.endsAt, body.guestCount);
    const tableId = body.tableId ? tables.find(t => t.id === body.tableId)?.id : tables[0]?.id;
    if (!tableId) {
      const blocked = closures.filter(r => body.tableId ? closureAffectsTable(r, body.tableId) : true);
      if (blocked.length) return c.json({ success: false, error: 'closure_conflict', code: 'closure_conflict', reason: '臨時休業・貸切の日時と卓に重なります', closures: blocked.map(publicClosure) }, 409);
      return c.json({ success: false, error: '人数が入る空き卓がありません' }, 409);
    }
    const id = crypto.randomUUID();
    const holdExpiresAt = new Date(Date.now() + body.holdMinutes * 60_000).toISOString();
    await db.prepare(`INSERT INTO rt_reservations
      (id, store_id, source, customer_name, guest_count, starts_at, ends_at, table_id, status, note, hold_expires_at)
      VALUES (?, ?, 'manual', '押さえ', ?, ?, ?, ?, 'pending', ?, ?)`)
      .bind(id, body.storeId, body.guestCount, body.startsAt, body.endsAt, tableId, body.note?.trim() || null, holdExpiresAt).run();
    await adjustInventoryReservedCount(db, body.storeId, body.startsAt, body.guestCount);
    return c.json({ success: true, data: { id, tableId, holdExpiresAt } }, 201);
  } finally { await releaseLock(db, key, owner); }
});

/** 500件の一覧ページ上限を使わず、店舗の暦日に重なる予約をすべて取得する。 */
restaurantTest.get('/api/restaurant-test/reservations/day', requireRole('owner', 'admin', 'staff'), async c => {
  if (!hasOrganizationSelector(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({ success: false, error: '組織が見つかりません' }, 404);
  const storeId = c.req.query('storeId') || organization.scopedStoreId || '';
  const date = c.req.query('date') || '';
  if (!validRestaurantDate(date) || !await storeBelongsTo(c, organization.id, storeId)) return c.json({ success: false, error: '店舗と日付を確認してください' }, 400);
  const db = dbFor(c.env, storeId);
  await expireRestaurantHolds(db, undefined, storeId);
  const store = await db.prepare('SELECT timezone FROM rt_stores WHERE id = ?').bind(storeId).first<{ timezone: string }>();
  const from = restaurantCivilTime(date, 0, store!.timezone);
  const to = restaurantCivilTime(date, 1440, store!.timezone);
  const rows = await db.prepare(`SELECT r.*, s.name AS store_name, t.label AS table_label, m.name AS course_name
    FROM rt_reservations r JOIN rt_stores s ON s.id = r.store_id
    LEFT JOIN rt_tables t ON t.id = r.table_id LEFT JOIN rt_menu_items m ON m.id = r.course_id
    WHERE r.store_id = ? AND datetime(r.starts_at) < datetime(?) AND datetime(r.ends_at) > datetime(?)
    ORDER BY r.starts_at, r.id`).bind(storeId, to, from).all();
  return c.json({ success: true, data: { date, reservations: rows.results, closures: (await closuresForRange(db, storeId, from, to)).map(publicClosure) } });
});

restaurantTest.get('/api/restaurant-test/customers/history', requireRole('owner', 'admin', 'staff'), async c => {
  if (!hasOrganizationSelector(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({ success: false, error: '組織が見つかりません' }, 404);
  const storeId = c.req.query('storeId') || '';
  const lineUid = c.req.query('lineUid')?.trim();
  const phone = c.req.query('phone')?.replace(/[\s()-]/g, '');
  if ((!lineUid && !phone) || !await storeBelongsTo(c, organization.id, storeId)) return c.json({ success: false, error: '店舗と連絡先を確認してください' }, 400);
  const db = dbFor(c.env, storeId);
  const where = `r.store_id = ? AND r.status IN ('visited', 'seated') AND ${lineUid ? 'r.line_uid = ?' : "REPLACE(REPLACE(REPLACE(REPLACE(r.customer_phone, '-', ''), ' ', ''), '(', ''), ')', '') = ?"}`;
  const args = [storeId, lineUid || phone];
  const count = await db.prepare(`SELECT COUNT(*) AS total FROM rt_reservations r WHERE ${where}`).bind(...args).first<{ total: number }>();
  const rows = await db.prepare(`SELECT r.id, r.starts_at, r.guest_count, r.allergy_note, t.label AS table_label, m.name AS course_name
    FROM rt_reservations r LEFT JOIN rt_tables t ON t.id = r.table_id LEFT JOIN rt_menu_items m ON m.id = r.course_id
    WHERE ${where} ORDER BY r.starts_at DESC, r.id LIMIT 20`).bind(...args).all();
  return c.json({ success: true, data: { visitCount: count!.total, visits: rows.results } });
});

restaurantTest.get('/api/restaurant-test/customers/search', requireRole('owner', 'admin', 'staff'), async c => {
  if (!hasOrganizationSelector(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({ success: false, error: '組織が見つかりません' }, 404);
  const storeId = c.req.query('storeId') || '';
  const q = c.req.query('q')?.trim() || '';
  if (q.length < 2 || q.length > 100 || !await storeBelongsTo(c, organization.id, storeId)) return c.json({ success: false, error: '店舗と検索文字を確認してください' }, 400);
  const rows = await dbFor(c.env, storeId).prepare(`SELECT customer_name AS name, customer_phone AS phone, line_uid AS lineUid
    FROM rt_reservations WHERE store_id = ? AND hold_expires_at IS NULL
      AND (INSTR(customer_name, ?) > 0 OR INSTR(COALESCE(customer_phone, ''), ?) > 0)
      AND (customer_phone IS NOT NULL OR line_uid IS NOT NULL)
    GROUP BY COALESCE(line_uid, customer_phone) UNION
    SELECT COALESCE(f.display_name, 'LINEの友だち') AS name, NULL AS phone, f.line_user_id AS lineUid
    FROM friends f JOIN rt_stores s ON s.line_account_id = f.line_account_id
    WHERE s.id = ? AND f.is_following = 1 AND INSTR(COALESCE(f.display_name, ''), ?) > 0 LIMIT 20`)
    .bind(storeId, q, q, storeId, q).all();
  return c.json({ success: true, data: rows.results });
});

restaurantTest.get('/api/restaurant-test/inventory/day', requireRole('owner', 'admin', 'staff'), async c => {
  if (!hasOrganizationSelector(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({ success: false, error: '組織が見つかりません' }, 404);
  const storeId = c.req.query('storeId') || organization.scopedStoreId || '';
  const date = c.req.query('date') || '';
  if (!validRestaurantDate(date) || !await storeBelongsTo(c, organization.id, storeId)) return c.json({ success: false, error: '店舗と日付を確認してください' }, 400);
  const db = dbFor(c.env, storeId);
  await expireRestaurantHolds(db, undefined, storeId);
  const store = await db.prepare('SELECT timezone FROM rt_stores WHERE id = ?').bind(storeId).first<{ timezone: string }>();
  const rows = await db.prepare(`SELECT v.*, sm.name AS updated_by_name FROM rt_inventory_occupancy v
    LEFT JOIN staff_members sm ON sm.id=v.updated_by
    WHERE v.store_id=? AND datetime(v.starts_at)>=datetime(?) AND datetime(v.starts_at)<datetime(?) ORDER BY v.starts_at`)
    .bind(storeId, restaurantCivilTime(date, 0, store!.timezone), restaurantCivilTime(date, 1440, store!.timezone)).all<Record<string, unknown>>();
  const closures = await closuresForRange(db, storeId, restaurantCivilTime(date, 0, store!.timezone), restaurantCivilTime(date, 1440, store!.timezone));
  const tables=(await db.prepare('SELECT id,max_capacity FROM rt_tables WHERE store_id=? AND is_active=1').bind(storeId).all<{id:string;max_capacity:number}>()).results;
  return c.json({ success: true, closures: closures.map(publicClosure), data: rows.results.map(r => {
    const occupiedTableIds=JSON.parse(String(r.occupied_table_ids_json)) as string[];
    const from=Date.parse(String(r.starts_at)),to=from+Number(r.slot_minutes)*60_000;
    const closed=closures.filter(c=>(JSON.parse(c.periods_json) as Array<{startsAt:string;endsAt:string}>).some(p=>Date.parse(p.startsAt)<to&&Date.parse(p.endsAt)>from));
    const closedTables=tables.filter(t=>closed.some(c=>closureAffectsTable(c,t.id)));
    const blockedSeats=closedTables.filter(t=>!occupiedTableIds.includes(t.id)).reduce((n,t)=>n+t.max_capacity,0);
    return {...r,reserved_count:r.guest_count,occupiedTableIds,closedTableIds:closedTables.map(t=>t.id),
      freeSeats:Math.max(0,Number(r.total_capacity)-Number(r.occupied_seats)-Number(r.unassigned_guests)-blockedSeats)};
  }) });
});

restaurantTest.post('/api/restaurant-test/inventory/generate', requireRole('owner', 'admin'), async c => {
  if (!hasOrganizationSelector(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({ success: false, error: '組織が見つかりません' }, 404);
  const body = await c.req.json<{ storeId?: string; date?: string; expectedHoursVersion?: number; otaCapacity?: number; lineCapacity?: number; walkInCapacity?: number; sameDayCapacity?: number }>().catch(() => ({} as { storeId?: string; date?: string; expectedHoursVersion?: number; otaCapacity?: number; lineCapacity?: number; walkInCapacity?: number; sameDayCapacity?: number }));
  if (!body.storeId || !validRestaurantDate(body.date || '') || !await storeBelongsTo(c, organization.id, body.storeId)) return c.json({ success: false, error: '店舗と日付を確認してください' }, 400);
  const db = dbFor(c.env, body.storeId);
  const setting = await db.prepare(`SELECT h.hours_json,h.version,s.timezone FROM rt_opening_hours_settings h JOIN rt_stores s ON s.id=h.store_id WHERE h.store_id=?`)
    .bind(body.storeId).first<{ hours_json: string; version: number; timezone: string }>();
  if (!setting) return c.json({ success: false, error: '先に週の営業時間を保存してください' }, 409);
  if (setting.version !== body.expectedHoursVersion) return c.json({ success: false, error: '営業時間が変わりました。読み直してください', currentVersion: setting.version }, 409);
  const total = await restaurantTableCapacity(db, body.storeId);
  const allocation = [body.otaCapacity, body.lineCapacity, body.walkInCapacity,body.sameDayCapacity??0];
  if (allocation.some(n => !Number.isSafeInteger(n) || Number(n)<0) || allocation.reduce<number>((sum,n)=>sum+Number(n),0)>total) return c.json({ success: false, error: '稼働中の卓の席数以内で配分してください' }, 400);
  const hours = validateRestaurantOpeningHours(JSON.parse(setting.hours_json))!;
  const weekday = new Date(body.date!).getUTCDay();
  const mins = (time: string) => Number(time.slice(0,2))*60+Number(time.slice(3));
  const starts: string[] = [];
  for (const p of hours.find(d=>d.weekday===weekday)!.periods) {
    const start = mins(p.opensAt); const close = mins(p.closesAt); const end = close <= start ? close+1440 : close;
    for (let minute=start; minute<end; minute+=30) starts.push(restaurantCivilTime(body.date!, minute, setting.timezone));
  }
  // INSERT時にも版を検査。途中で版が変わったらbatch全体を巻き戻す。
  const key = `inventory:${body.storeId}`; const owner = crypto.randomUUID();
  if (!await acquireLock(db,key,owner)) return c.json({ success:false,error:'在庫を更新中です。もう一度お試しください' },409);
  try {
    const batch = await db.batch([
      db.prepare('SELECT version FROM rt_opening_hours_settings WHERE store_id=?').bind(body.storeId),
      db.prepare('SELECT COALESCE(SUM(max_capacity),0) AS total FROM rt_tables WHERE store_id=? AND is_active=1').bind(body.storeId),
      ...starts.map(start => db.prepare(`INSERT INTO rt_inventory_slots
        (id,store_id,starts_at,total_capacity,ota_capacity,line_capacity,walk_in_capacity,same_day_capacity,updated_by)
        SELECT ?,?,?,COALESCE((SELECT SUM(max_capacity) FROM rt_tables WHERE store_id=? AND is_active=1),0),?,?,?,?,?
        WHERE EXISTS(SELECT 1 FROM rt_opening_hours_settings WHERE store_id=? AND version=?)
          AND ? <= COALESCE((SELECT SUM(max_capacity) FROM rt_tables WHERE store_id=? AND is_active=1),0)
        ON CONFLICT(store_id,starts_at) DO NOTHING`).bind(crypto.randomUUID(),body.storeId,start,body.storeId,...allocation,c.get('staff')!.id,body.storeId,body.expectedHoursVersion,allocation.reduce<number>((a,n)=>a+Number(n),0),body.storeId)),
    ]);
    if ((batch[0].results[0] as {version:number} | undefined)?.version !== body.expectedHoursVersion
      || Number((batch[1].results[0] as {total:number}).total) < allocation.reduce<number>((a,n)=>a+Number(n),0)) return c.json({success:false,error:'営業時間または卓が変わりました。読み直してください'},409);
    const results = batch.slice(2);
    await adjustInventoryReservedCount(db, body.storeId, '', 0);
    return c.json({ success: true, data: { generated: results.reduce((sum,r)=>sum+r.meta.changes,0), slotMinutes: 30 } });
  } finally { await releaseLock(db,key,owner); }
});


restaurantTest.get('/api/restaurant-test/login-members', requireRole('owner','admin'), async c => {
  if(!hasOrganizationSelector(c)) return requiredAccount(c);
  const organization=await organizationFor(c);
  if(!organization) return c.json({success:false,error:'組織が見つかりません'},404);
  // ログイン用の鍵や秘密値は射影しない。
  const rows=await dbFor(c.env).prepare(`SELECT sm.id,sm.name,sm.role,sm.access_level AS accessLevel,sm.is_active AS isActive,
    sm.account_scope AS accountScope,sm.policy_version AS policyVersion,
    (SELECT json_group_array(line_account_id) FROM staff_account_scopes WHERE staff_id=sm.id) AS accountIdsJson
    FROM staff_members sm WHERE COALESCE(sm.tenant_id,?)=? ORDER BY sm.name`)
    .bind(DEFAULT_TENANT_ID,organization.tenant_id??DEFAULT_TENANT_ID).all<{id:string;name:string;role:string;accessLevel:string;isActive:number;accountScope:string;policyVersion:number;accountIdsJson:string}>();
  return c.json({success:true,data:rows.results.map(({accountIdsJson,...row})=>({...row,accountIds:JSON.parse(accountIdsJson)}))});
});

restaurantTest.put('/api/restaurant-test/memberships/:id/login', requireRole('owner','admin'), async c => {
  if(!hasOrganizationSelector(c)) return requiredAccount(c);
  const organization=await organizationFor(c);
  if(!organization) return c.json({success:false,error:'組織が見つかりません'},404);
  const db=dbFor(c.env);
  const member=await db.prepare(`SELECT id,store_id,role FROM rt_memberships WHERE id=? AND organization_id=? AND (? IS NULL OR store_id=?)`)
    .bind(c.req.param('id'),organization.id,organization.scopedStoreId,organization.scopedStoreId).first<{id:string;store_id:string|null;role:string}>();
  if(!member) return c.json({success:false,error:'所属ユーザーが見つかりません'},404);
  if(member.role==='super_admin' && c.get('staff')!.role!=='owner') return c.json({success:false,error:'オーナーとの連携はオーナーだけが変更できます'},403);
  if(member.store_id && !await storeBelongsTo(c,organization.id,member.store_id)) return c.json({success:false,error:'所属ユーザーが見つかりません'},404);
  const body=await c.req.json<{staffId?:string|null}>().catch(()=>null);
  if(!body || (body.staffId!==null && (typeof body.staffId!=='string' || !body.staffId))) return c.json({success:false,error:'ログインメンバーを選んでください'},400);
  if(body.staffId===null) {
    await db.prepare('UPDATE rt_memberships SET staff_id=NULL,updated_at=datetime(\'now\') WHERE id=?').bind(member.id).run();
    return c.json({success:true,data:{id:member.id,staffId:null}});
  }
  const login=await db.prepare(`SELECT id,role,is_active,invite_status,account_scope,assigned_line_account_id FROM staff_members
    WHERE id=? AND COALESCE(tenant_id,?)=?`).bind(body.staffId,DEFAULT_TENANT_ID,organization.tenant_id??DEFAULT_TENANT_ID)
    .first<{id:string;role:string;is_active:number;invite_status:string;account_scope:string;assigned_line_account_id:string|null}>();
  if(!login) return c.json({success:false,error:'ログインメンバーが見つかりません'},404);
  if((login.role==='owner' || member.role==='super_admin') && c.get('staff')!.role!=='owner') return c.json({success:false,error:'オーナーとの連携はオーナーだけが変更できます'},403);
  const scopeIds=await db.prepare('SELECT line_account_id FROM staff_account_scopes WHERE staff_id=?').bind(login.id).all<{line_account_id:string}>();
  const accountIds=scopeIds.results.map(s=>s.line_account_id);
  const isAll=login.account_scope==='all';
  const stores=await db.prepare('SELECT id,line_account_id FROM rt_stores WHERE organization_id=?').bind(organization.id).all<{id:string;line_account_id:string|null}>();
  const matching=stores.results.filter(s=>s.line_account_id && accountIds.includes(s.line_account_id));
  const storeId=isAll ? null : matching.find(s=>s.id===member.store_id)?.id || matching[0]?.id;
  if(storeId===undefined || (organization.scopedStoreId && storeId!==organization.scopedStoreId)) return c.json({success:false,error:'ログインメンバーの担当店舗が合いません。先に統括メンバーで閲覧範囲を設定してください'},409);
  try {
    await db.prepare(`UPDATE rt_memberships SET staff_id=?,role=?,status=?,store_id=?,updated_at=datetime('now') WHERE id=?`)
      .bind(login.id,login.role==='owner'?'super_admin':login.role==='admin'?'store_manager':'staff',login.is_active===0?'suspended':login.invite_status==='active'?'active':'invited',storeId,member.id).run();
  }catch(error){if(/unique constraint/i.test(String(error)))return c.json({success:false,error:'このログインメンバーはすでに別の名簿へ連携されています'},409);throw error;}
  return c.json({success:true,data:{id:member.id,staffId:login.id}});
});

restaurantTest.get('/api/restaurant-test/inventory-rules',requireRole('owner','admin','staff'),async c=>{
 if(!hasOrganizationSelector(c))return requiredAccount(c);
 const org=await organizationFor(c);const storeId=c.req.query('storeId')||org?.scopedStoreId;
 if(!org||!storeId||!await storeBelongsTo(c,org.id,storeId))return c.json({success:false,error:'店舗が正しくありません'},404);
 return c.json({success:true,data:await getRestaurantInventoryRules(dbFor(c.env,storeId),storeId)});
});
restaurantTest.put('/api/restaurant-test/inventory-rules',requireRole('owner','admin'),async c=>{
 if(!hasOrganizationSelector(c))return requiredAccount(c);
 const org=await organizationFor(c);const body=await c.req.json().catch(()=>null);
 if(!validateRestaurantInventoryRules(body))return c.json({success:false,error:'ルールと読み込んだ版を確認してください'},400);
 if(!org||!await storeBelongsTo(c,org.id,body.storeId))return c.json({success:false,error:'店舗が正しくありません'},404);
 const db=dbFor(c.env,body.storeId);
 if(!await saveRestaurantInventoryRules(db,body))return c.json({success:false,error:'ほかの担当者が先に保存しました',currentVersion:(await getRestaurantInventoryRules(db,body.storeId)).version},409);
 return c.json({success:true,data:await getRestaurantInventoryRules(db,body.storeId)});
});
restaurantTest.get('/api/restaurant-test/channel-close-tasks',requireRole('owner','admin','staff'),async c=>{
 if(!hasOrganizationSelector(c))return requiredAccount(c);
 const org=await organizationFor(c);const storeId=c.req.query('storeId')||org?.scopedStoreId;
 if(!org||!storeId||!await storeBelongsTo(c,org.id,storeId))return c.json({success:false,error:'店舗が正しくありません'},404);
 return c.json({success:true,data:await listRestaurantCloseTasks(dbFor(c.env,storeId),storeId)});
});
restaurantTest.post('/api/restaurant-test/channel-close-tasks/:id/done',requireRole('owner','admin','staff'),async c=>{
 if(!hasOrganizationSelector(c))return requiredAccount(c);
 const org=await organizationFor(c);if(!org)return c.json({success:false,error:'組織がありません'},404);
 const db=dbFor(c.env);const task=await db.prepare(`SELECT store_id,status,'rt_channel_close_tasks' AS task_table FROM rt_channel_close_tasks WHERE id=? UNION ALL SELECT store_id,status,'rt_reservation_close_tasks' AS task_table FROM rt_reservation_close_tasks WHERE id=? UNION ALL SELECT store_id,status,'rt_closure_close_tasks' AS task_table FROM rt_closure_close_tasks WHERE id=?`).bind(c.req.param('id'),c.req.param('id'),c.req.param('id')).first<{store_id:string;status:string;task_table:'rt_channel_close_tasks'|'rt_reservation_close_tasks'|'rt_closure_close_tasks'}>();
 if(!task||!await storeBelongsTo(c,org.id,task.store_id))return c.json({success:false,error:'知らせがありません'},404);
 if(task.status==='reopen')return c.json({success:false,error:'席が戻りました。もう開けてよい状態です'},409);
 const changed=await db.prepare(`UPDATE ${task.task_table} SET status='done',updated_at=datetime('now') WHERE id=? AND status='close'`).bind(c.req.param('id')).run();
 if(!changed.meta.changes&&task.status!=='done')return c.json({success:false,error:'知らせが更新されました。読み直してください'},409);
 return c.json({success:true,data:{id:c.req.param('id'),status:'done'}});
});


restaurantTest.get('/api/restaurant-test/media', requireRole('owner','admin','staff'), async c => {
  return c.json({success:true,data:(await dbFor(c.env).prepare('SELECT code,name,accepts_reservations AS acceptsReservations FROM rt_media ORDER BY name').all()).results});
});
restaurantTest.post('/api/restaurant-test/media', requireRole('owner','admin'), async c => {
  const body=await c.req.json<{code?:unknown;name?:unknown}>().catch(()=>null);
  if(typeof body?.code!=='string'||!/^gourmet_[a-z0-9_]{1,50}$/.test(body.code)||typeof body.name!=='string'||!body.name.trim()||body.name.length>100)
    return c.json({success:false,error:'グルメ媒体のコードと名前を確認してください'},400);
  const result=await dbFor(c.env).prepare(`INSERT OR IGNORE INTO rt_media(id,code,name,parser_key,is_active,accepts_reservations) VALUES(?,?,?,?,0,0)`)
    .bind(crypto.randomUUID(),body.code,body.name.trim(),body.code).run();
  if(!result.meta.changes)return c.json({success:false,error:'同じコードの媒体が登録済みです'},409);
  return c.json({success:true,data:{code:body.code,name:body.name.trim(),acceptsReservations:false}},201);
});
restaurantTest.get('/api/restaurant-test/media-links', requireRole('owner','admin','staff'),async c=>{
  const org=await organizationFor(c),storeId=c.req.query('storeId')||'';
  if(!org||!await storeBelongsTo(c,org.id,storeId))return c.json({success:false,error:'店舗を確認してください'},400);
  const data=await dbFor(c.env,storeId).prepare(`SELECT m.code,m.name,m.accepts_reservations AS acceptsReservations,
    l.page_url AS pageUrl,l.login_url AS loginUrl,COALESCE(l.close_on_booking,0) AS closeOnBooking,COALESCE(l.version,0) AS version
    FROM rt_media m LEFT JOIN rt_store_media_links l ON l.media_id=m.id AND l.store_id=? ORDER BY m.name`).bind(storeId).all();
  return c.json({success:true,data:data.results});
});
restaurantTest.put('/api/restaurant-test/media-links/:code', requireRole('owner','admin'),async c=>{
  const b=await c.req.json<{storeId:string;pageUrl:unknown;loginUrl:unknown;closeOnBooking:boolean;expectedVersion:number}>().catch(()=>null);
  const org=await organizationFor(c);
  if(!b||!org||typeof b.storeId!=='string'||!await storeBelongsTo(c,org.id,b.storeId))return c.json({success:false,error:'店舗を確認してください'},400);
  const page=safeRestaurantHttpsUrl(b.pageUrl),login=safeRestaurantHttpsUrl(b.loginUrl);
  const media=await dbFor(c.env).prepare('SELECT id,accepts_reservations FROM rt_media WHERE code=?').bind(c.req.param('code')).first<{id:string;accepts_reservations:number}>();
  if(!media||page===undefined||login===undefined||typeof b.closeOnBooking!=='boolean'||(!media.accepts_reservations&&b.closeOnBooking)||!Number.isSafeInteger(b.expectedVersion)||b.expectedVersion<0)
    return c.json({success:false,error:'HTTPSのURL・閉鎖対象・版を確認してください'},400);
  const db=dbFor(c.env,b.storeId);
  const saved=await db.prepare(`INSERT INTO rt_store_media_links(store_id,media_id,page_url,login_url,close_on_booking)
    SELECT ?,?,?,?,? WHERE ?=0 OR EXISTS(SELECT 1 FROM rt_store_media_links WHERE store_id=? AND media_id=?) ON CONFLICT(store_id,media_id) DO UPDATE SET page_url=excluded.page_url,login_url=excluded.login_url,
    close_on_booking=excluded.close_on_booking,version=version+1,updated_at=datetime('now') WHERE version=?`)
    .bind(b.storeId,media.id,page,login,b.closeOnBooking?1:0,b.expectedVersion,b.storeId,media.id,b.expectedVersion).run();
  if(!saved.meta.changes)return c.json({success:false,error:'設定が更新されました。読み直してください'},409);
  await db.prepare(`INSERT INTO rt_inventory_rule_queue(store_id,cause) VALUES(?,'media_links_saved') ON CONFLICT(store_id) DO UPDATE SET generation=generation+1,cause=excluded.cause`).bind(b.storeId).run();
  const row=await db.prepare('SELECT version FROM rt_store_media_links WHERE store_id=? AND media_id=?').bind(b.storeId,media.id).first<{version:number}>();
  return c.json({success:true,data:{code:c.req.param('code'),storeId:b.storeId,pageUrl:page,loginUrl:login,closeOnBooking:b.closeOnBooking,version:row!.version}});
});
restaurantTest.post('/api/restaurant-test/reservation-link', requireRole('owner','admin'),async c=>{
  const b=await c.req.json<{storeId?:string}>().catch(()=>null),org=await organizationFor(c);
  if(!b?.storeId||!org||!await storeBelongsTo(c,org.id,b.storeId))return c.json({success:false,error:'店舗を確認してください'},400);
  const base=safeRestaurantHttpsUrl(c.env.LIFF_URL);
  if(!base)return c.json({success:false,error:'お客さま向けURLの設定が必要です'},503);
  const db=dbFor(c.env,b.storeId);
  await db.prepare('INSERT OR IGNORE INTO rt_reservation_links(store_id,token) VALUES(?,?)').bind(b.storeId,crypto.randomUUID()).run();
  const link=await db.prepare('SELECT token FROM rt_reservation_links WHERE store_id=?').bind(b.storeId).first<{token:string}>();
  return c.json({success:true,data:restaurantReservationEmbed(base,link!.token)});
});

restaurantTest.get('/api/restaurant-test/closures', requireRole('owner','admin','staff'), async c => {
 if(!hasOrganizationSelector(c))return requiredAccount(c);
 const org=await organizationFor(c),storeId=c.req.query('storeId')||org?.scopedStoreId||'',month=c.req.query('month');
 if(!org||!await storeBelongsTo(c,org.id,storeId))return c.json({success:false,error:'店舗が正しくありません'},404);
 if(month!==undefined&&(!/^\d{4}-\d{2}$/.test(month)||!validRestaurantDate(month+'-01')))return c.json({success:false,error:'月はYYYY-MMです'},400);
 const rows=await dbFor(c.env,storeId).prepare(`SELECT * FROM rt_closures WHERE store_id=? AND archived_at IS NULL
 AND (? IS NULL OR (start_date<=date(?||'-01','+1 month','-1 day') AND end_date>=?||'-01')) ORDER BY start_date,start_time,id`)
 .bind(storeId,month??null,month??null,month??null).all<ClosureRow>();
 return c.json({success:true,data:rows.results.map(publicClosure)});
});

/** previewも保存も同じ検査・影響計算。版はPATCH/DELETEで必須。 */
for(const action of ['preview','create','patch'] as const) {
 const path=action==='preview'?'/api/restaurant-test/closures/preview':action==='create'?'/api/restaurant-test/closures':'/api/restaurant-test/closures/:id';
 restaurantTest.on(action==='patch'?'PATCH':'POST',path,requireRole('owner','admin','staff'),async c=>{
  if(!hasOrganizationSelector(c))return requiredAccount(c);
  const org=await organizationFor(c),b=await c.req.json().catch(()=>null);
  if(!org||!b||typeof b.storeId!=='string'||!await storeBelongsTo(c,org.id,b.storeId))return c.json({success:false,error:'店舗が正しくありません'},400);
  const db=dbFor(c.env,b.storeId),store=await db.prepare('SELECT timezone FROM rt_stores WHERE id=?').bind(b.storeId).first<{timezone:string}>();
  const checked=validateClosure(b,store!.timezone);
  if(!checked)return c.json({success:false,error:'日付・時間帯・種類・卓を確認してください（過去日は登録不可、期間は366日以内）'},400);
  const {input,periods}=checked;
  if(input.tableIds!.length){const tables=await db.prepare('SELECT id FROM rt_tables WHERE store_id=? AND is_active=1').bind(input.storeId).all<{id:string}>();
   if(input.tableIds!.some(id=>!tables.results.some(t=>t.id===id)))return c.json({success:false,error:'ほかの店舗・停止中の卓は指定できません'},400);}
  const id=action==='patch'?c.req.param('id'):crypto.randomUUID();
  const current=action==='patch'?await db.prepare('SELECT * FROM rt_closures WHERE id=? AND store_id=? AND archived_at IS NULL').bind(id,input.storeId).first<ClosureRow>():null;
  if(action==='patch'&&!current)return c.json({success:false,error:'休業・貸切がありません'},404);
  if(action==='patch'&&(!Number.isSafeInteger(b.expectedVersion)||b.expectedVersion<1))return c.json({success:false,error:'読み込んだ版を指定してください'},400);
  if(current&&current.version!==b.expectedVersion)return c.json({success:false,error:'version_conflict',currentVersion:current.version},409);
  const key=`reservation:${input.storeId}`,owner=crypto.randomUUID();
  if(action!=='preview'&&!await acquireLock(db,key,owner))return c.json({success:false,error:'同じ店舗を更新中です'},409);
  try {
   const preview=await closurePreview(db,input,periods,current?.id??null);
   if(preview.conflicts.length)return c.json({success:false,error:'closure_overlap',code:'closure_overlap',...preview},409);
   if(action==='preview')return c.json({success:true,data:preview});
   const values=[input.startDate,input.endDate,Number(input.allDay),input.startTime,input.endTime,input.kind,input.memo,JSON.stringify(input.tableIds),JSON.stringify(periods)];
   try {
    if(action==='patch'){
     const saved=await db.prepare(`UPDATE rt_closures SET start_date=?,end_date=?,all_day=?,start_time=?,end_time=?,kind=?,memo=?,table_ids_json=?,periods_json=?,version=version+1,updated_at=datetime('now')
     WHERE id=? AND store_id=? AND version=? AND archived_at IS NULL`).bind(...values,id,input.storeId,b.expectedVersion).run();
     if(!saved.meta.changes)return c.json({success:false,error:'version_conflict'},409);
    }else await db.prepare(`INSERT INTO rt_closures(start_date,end_date,all_day,start_time,end_time,kind,memo,table_ids_json,periods_json,id,store_id,created_by,created_by_name) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(...values,id,input.storeId,c.get('staff')?.id??null,c.get('staff')?.name??null).run();
   }catch(error){if(String(error).includes('closure_overlap'))return c.json({success:false,error:'closure_overlap',code:'closure_overlap',...await closurePreview(db,input,periods,current?.id??null)},409);throw error;}
   const row=(await db.prepare('SELECT * FROM rt_closures WHERE id=?').bind(id).first<ClosureRow>())!;
   return c.json({success:true,data:{closure:publicClosure(row),...await closurePreview(db,input,periods,id)}},action==='create'?201:200);
  }finally {if(action!=='preview')await releaseLock(db,key,owner);}
 });
}
restaurantTest.delete('/api/restaurant-test/closures/:id',requireRole('owner','admin','staff'),async c=>{
 if(!hasOrganizationSelector(c))return requiredAccount(c);
 const org=await organizationFor(c),b=await c.req.json().catch(()=>null);
 if(!b||!Number.isSafeInteger(b.expectedVersion)||b.expectedVersion<1)return c.json({success:false,error:'読み込んだ版を指定してください'},400);
 const db=dbFor(c.env),r=await db.prepare('SELECT * FROM rt_closures WHERE id=? AND archived_at IS NULL').bind(c.req.param('id')).first<ClosureRow>();
 if(!org||!r||!await storeBelongsTo(c,org.id,r.store_id))return c.json({success:false,error:'休業・貸切がありません'},404);
 const changed=await db.prepare(`UPDATE rt_closures SET archived_at=datetime('now'),version=version+1,updated_at=datetime('now') WHERE id=? AND version=? AND archived_at IS NULL`).bind(r.id,b.expectedVersion).run();
 if(!changed.meta.changes)return c.json({success:false,error:'version_conflict',currentVersion:r.version},409);
 return c.json({success:true,data:{id:r.id,version:r.version+1,archived:true}});
});
restaurantTest.get('/api/restaurant-test/availability',requireRole('owner','admin','staff'),async c=>{
 if(!hasOrganizationSelector(c))return requiredAccount(c);
 const org=await organizationFor(c),storeId=c.req.query('storeId')||org?.scopedStoreId||'',startsAt=c.req.query('startsAt')||'',endsAt=c.req.query('endsAt')||'',guestCount=Number(c.req.query('guestCount'));
 if(!org||!await storeBelongsTo(c,org.id,storeId))return c.json({success:false,error:'店舗が正しくありません'},404);
 if(!Number.isFinite(Date.parse(startsAt))||!Number.isFinite(Date.parse(endsAt))||Date.parse(endsAt)<=Date.parse(startsAt)||!Number.isSafeInteger(guestCount)||guestCount<1||guestCount>100)return c.json({success:false,error:'日時と人数を確認してください'},400);
 return c.json({success:true,data:{storeId,startsAt,endsAt,guestCount,tables:await openSeatTables(dbFor(c.env,storeId),storeId,startsAt,endsAt,guestCount)}});
});
