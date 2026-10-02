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
    'SELECT 1 AS ok FROM rt_stores WHERE id = ? AND organization_id = ? LIMIT 1',
  ).bind(storeId, organizationId).first<{ ok: number }>();
  return Boolean(row?.ok);
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
  const body: { documentKey?: unknown; version?: unknown } = await c.req.json().catch(() => ({}));
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
    dbFor(c.env).prepare(`SELECT * FROM rt_memberships
      WHERE organization_id = ? AND (? IS NULL OR store_id = ?)
      ORDER BY role, staff_name`).bind(orgId, scopedStoreId, scopedStoreId).all(),
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
    dbFor(c.env).prepare(`SELECT m.*, (SELECT after_price FROM rt_menu_change_requests r WHERE r.menu_id = m.id AND r.status = 'pending') AS pendingPrice FROM rt_menu_items m JOIN rt_stores s ON s.id = m.store_id
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
      inventory: inventory.results,
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
  } = await c.req.json().catch(() => ({}));
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
  } = await c.req.json().catch(() => ({}));
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
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
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
      db.prepare(`UPDATE rt_inventory_slots SET reserved_count = reserved_count + ?, updated_at = datetime('now')
        WHERE store_id = ? AND datetime(starts_at) = datetime(?) AND EXISTS (SELECT 1 FROM rt_reservations WHERE id = ?)` )
        .bind(reservation.guestCount, email.store_id, reservation.startsAt, id),
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
  if (!guestDelta) return;
  if (guestDelta > 0) {
    await db.prepare(`UPDATE rt_inventory_slots SET reserved_count = reserved_count + ?,
      updated_at = datetime('now') WHERE store_id = ? AND starts_at = ?`).bind(
        guestDelta, storeId, startsAt,
      ).run();
    return;
  }
  await db.prepare(`UPDATE rt_inventory_slots SET
      reserved_count = CASE WHEN reserved_count + ? < 0 THEN 0 ELSE reserved_count + ? END,
      updated_at = datetime('now') WHERE store_id = ? AND starts_at = ?`).bind(
      guestDelta, guestDelta, storeId, startsAt,
    ).run();
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
  const lockKey = `reservation:${storeId}:${checked.value.startsAt}`;
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
    const tableId = checked.value.tableId || chooseRestaurantTable(tables.results.map((row) => ({ id: row.id, minCapacity: row.min_capacity, maxCapacity: row.max_capacity, isActive: row.is_active === 1 })), checked.value.guestCount);
    if (tableId && await overlappingReservationExists(dbFor(c.env, storeId), storeId, tableId, checked.value.startsAt, checked.value.endsAt)) {
      return c.json({ success: false, error: '同じ卓に重なる時間の予約があるため登録できません' }, 409);
    }
    const id = crypto.randomUUID();
    await dbFor(c.env, storeId).prepare(`INSERT INTO rt_reservations
      (id, store_id, source, external_id, customer_name, customer_phone, line_uid, guest_count, starts_at, ends_at, table_id, course_id, status, allergy_note, note)
      VALUES (?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        id, storeId, checked.value.externalId, checked.value.customerName, checked.value.customerPhone,
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
      courseId: checked.value.courseId ?? null, status: checked.value.status ?? 'confirmed',
    })
    : { sent: false, reason: 'not_requested' };
  return c.json({ success: true, data: { ...saved, syncDirection: 'inbound_only', lineNotice } }, 201);
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
      course_id: string | null; status: string; allergy_note: string | null; note: string | null;
    }>();
  if (!current) return c.json({ success: false, error: '予約が見つかりません' }, 404);
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
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
      dbFor(c.env, current.store_id), current.store_id, next.table_id, next.starts_at, next.ends_at, current.id,
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
  return c.json({ success: true, data: { id: current.id } });
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
  if (!isRestaurantReservationSource(body.provider) || ['manual', 'phone', 'line'].includes(body.provider)) return c.json({ success: false, error: '受信媒体が正しくありません' }, 400);
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
      dbFor(c.env, body.storeId), body.storeId, value.tableId, value.startsAt, value.endsAt, current?.id ?? null,
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

restaurantTest.post('/api/restaurant-test/tables', requireRole('owner', 'admin'), async (c) => {
  if (!hasOrganizationSelector(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({ success: false, error: '飲食店テスト組織がありません' }, 404);
  const body = await c.req.json<{ storeId?: string; code?: string; label?: string; seatType?: string; minCapacity?: number; maxCapacity?: number }>();
  if (!body.storeId || !await storeBelongsTo(c, organization.id, body.storeId)) return c.json({ success: false, error: '店舗が正しくありません' }, 400);
  const seatTypes = ['counter', 'table', 'private_room', 'terrace'];
  const min = Number(body.minCapacity);
  const max = Number(body.maxCapacity);
  if (!body.code?.trim() || !body.label?.trim() || !seatTypes.includes(body.seatType || '') || !Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min) return c.json({ success: false, error: '卓の入力内容が正しくありません' }, 400);
  const id = crypto.randomUUID();
  await dbFor(c.env, body.storeId).prepare('INSERT INTO rt_tables (id, store_id, code, label, seat_type, min_capacity, max_capacity) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, body.storeId, body.code.trim(), body.label.trim(), body.seatType, min, max).run();
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
  if (!current) return c.json({ success: false, error: '卓が見つかりません' }, 404);
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
    || (body.floorX !== undefined && !Number.isSafeInteger(body.floorX))
    || (body.floorY !== undefined && !Number.isSafeInteger(body.floorY))
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
    .first<{ store_id: string | null; staff_name: string; email: string | null; role: string; line_uid: string | null; google_email: string | null; status: string }>();
  if (!current) return c.json({ success: false, error: '所属ユーザーが見つかりません' }, 404);
  const body = await c.req.json<{ storeId?: string | null; staffName?: string; email?: string | null; role?: string; lineUid?: string | null; googleEmail?: string | null; status?: string }>();
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
  const body = await c.req.json<{ kind?: string; name?: string; price?: number; allergens?: string[]; servicePeriods?: string[]; status?: string }>();
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
  const db = dbFor(c.env, current.store_id);
  const approvalId = price !== current.price ? crypto.randomUUID() : null;
  const requestId = approvalId ? crypto.randomUUID() : null;
  const writes = [db.prepare(`UPDATE rt_menu_items SET kind = ?, name = ?, allergens_json = ?, service_periods_json = ?, status = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(kind, name.trim(), body.allergens === undefined ? current.allergens_json : JSON.stringify(body.allergens), body.servicePeriods === undefined ? current.service_periods_json : JSON.stringify(body.servicePeriods), status, c.req.param('id'))];
  if (approvalId) {
    const requester = c.get('staff')?.id || '管理者';
    writes.push(db.prepare(`INSERT INTO rt_approval_requests (id, organization_id, store_id, kind, title, status, payload_json, requested_by)
      VALUES (?, ?, ?, 'menu_change', ?, 'pending', ?, ?)`).bind(approvalId, organization.id, current.store_id,
      `${name.trim()}の価格変更`, JSON.stringify({ menuId: c.req.param('id'), beforePrice: current.price, afterPrice: price }), requester));
    writes.push(db.prepare(`INSERT INTO rt_menu_change_requests (id, approval_id, menu_id, store_id, before_price, after_price, requested_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(requestId, approvalId, c.req.param('id'), current.store_id, current.price, price, requester));
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

restaurantTest.put('/api/restaurant-test/inventory/:id', requireRole('owner', 'admin'), async (c) => {
  if (!hasOrganizationSelector(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({ success: false, error: '飲食店テスト組織がありません' }, 404);
  const body = await c.req.json<{ totalCapacity?: number; otaCapacity?: number; lineCapacity?: number; walkInCapacity?: number }>();
  const values = [body.totalCapacity, body.otaCapacity, body.lineCapacity, body.walkInCapacity].map(Number);
  if (values.some((value) => !Number.isInteger(value) || value < 0) || values.slice(1).reduce((a, b) => a + b, 0) > values[0]) {
    return c.json({ success: false, error: '媒体別枠の合計は総受入枠以下にしてください' }, 400);
  }
  const result = await dbFor(c.env).prepare(`UPDATE rt_inventory_slots SET
    total_capacity = ?, ota_capacity = ?, line_capacity = ?, walk_in_capacity = ?, updated_at = datetime('now')
    WHERE id = ? AND store_id IN (
      SELECT id FROM rt_stores WHERE organization_id = ? AND (? IS NULL OR id = ?)
    )`).bind(
      ...values, c.req.param('id'), organization.id,
      organization.scopedStoreId, organization.scopedStoreId,
    ).run();
  if (!result.meta.changes) return c.json({ success: false, error: '対象がありません' }, 404);
  return c.json({ success: true, data: { id: c.req.param('id') } });
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
  const storeId = c.req.query('storeId') || null;
  if (storeId && !await storeBelongsTo(c, organization.id, storeId)) return c.json({ success: false, error: '店舗が正しくありません' }, 400);
  const rows = await dbFor(c.env, storeId).prepare(`SELECT m.*,
    (SELECT after_price FROM rt_menu_change_requests r WHERE r.menu_id = m.id AND r.status = 'pending') AS pendingPrice
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
