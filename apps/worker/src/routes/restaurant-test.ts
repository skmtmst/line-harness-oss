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
import { DEFAULT_TENANT_ID } from '../lib/tenant.js';
import {
  chooseRestaurantTable,
  isRestaurantReservationSource,
  validateInboundReservation,
} from '../services/restaurant-test.js';

/**
 * 飲食店向け（テスト）の専用API。
 *
 * `/api/restaurant-test` 以外の既存機能には依存せず、外部サービスへの
 * fetch/send は意図的に実装しない。媒体連携は管理者が投入した受信データを
 * 検証する一方向だけである。
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

  const requestedTenant = tenantId(c);
  const staffTenant = c.get('staff')?.tenantId ?? DEFAULT_TENANT_ID;
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
        stores: [], memberships: [], approvals: [], reservations: [], tables: [],
        inventory: [], menuItems: [], connectors: [], reviews: [], posts: [], lineFlows: [],
      },
    });
  }

  const orgId = organization.id;
  const scopedStoreId = organization.scopedStoreId;
  const [stores, memberships, approvals, reservations, tables, inventory, menuItems, connectors, reviews, posts, lineFlows] = await Promise.all([
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
    dbFor(c.env).prepare(`SELECT r.*, s.name AS store_name, t.label AS table_label, m.name AS course_name
      FROM rt_reservations r
      JOIN rt_stores s ON s.id = r.store_id
      LEFT JOIN rt_tables t ON t.id = r.table_id
      LEFT JOIN rt_menu_items m ON m.id = r.course_id
      WHERE s.organization_id = ? AND (? IS NULL OR s.id = ?)
      ORDER BY r.starts_at ASC LIMIT 300`).bind(orgId, scopedStoreId, scopedStoreId).all(),
    dbFor(c.env).prepare(`SELECT t.* FROM rt_tables t JOIN rt_stores s ON s.id = t.store_id
      WHERE s.organization_id = ? AND (? IS NULL OR s.id = ?)
      ORDER BY t.store_id, t.code`).bind(orgId, scopedStoreId, scopedStoreId).all(),
    dbFor(c.env).prepare(`SELECT i.* FROM rt_inventory_slots i JOIN rt_stores s ON s.id = i.store_id
      WHERE s.organization_id = ? AND (? IS NULL OR s.id = ?)
      ORDER BY i.starts_at LIMIT 300`).bind(orgId, scopedStoreId, scopedStoreId).all(),
    dbFor(c.env).prepare(`SELECT m.* FROM rt_menu_items m JOIN rt_stores s ON s.id = m.store_id
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

restaurantTest.patch('/api/restaurant-test/approvals/:id', requireRole('owner', 'admin'), async (c) => {
  if (!hasOrganizationSelector(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({ success: false, error: '飲食店テスト組織がありません' }, 404);
  const body = await c.req.json<{ action?: string; comment?: string }>();
  const status = body.action === 'approve' ? 'approved' : body.action === 'return' ? 'returned' : null;
  if (!status) return c.json({ success: false, error: 'action は approve または return です' }, 400);
  const staff = c.get('staff');
  const result = await dbFor(c.env).prepare(`UPDATE rt_approval_requests
    SET status = ?, review_comment = ?, reviewed_by = ?, updated_at = datetime('now')
    WHERE id = ? AND organization_id = ? AND (? IS NULL OR store_id = ?)
      AND status IN ('pending', 'returned')`).bind(
      status, body.comment?.trim() || null, staff?.name || staff?.id || '管理者', c.req.param('id'), organization.id,
      organization.scopedStoreId, organization.scopedStoreId,
    ).run();
  if (!result.meta.changes) return c.json({ success: false, error: '対象が無いか、すでに処理済みです' }, 409);
  return c.json({ success: true, data: { id: c.req.param('id'), status } });
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

restaurantTest.post('/api/restaurant-test/reservations/manual', requireRole('owner', 'admin', 'staff'), async (c) => {
  if (!hasOrganizationSelector(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({ success: false, error: '飲食店テスト組織がありません' }, 404);
  const body = await c.req.json<Record<string, unknown>>();
  const storeId = typeof body.storeId === 'string' ? body.storeId : '';
  if (!storeId || !await storeBelongsTo(c, organization.id, storeId)) return c.json({ success: false, error: '店舗が正しくありません' }, 400);
  const checked = validateInboundReservation({ ...body, externalId: `manual-${crypto.randomUUID()}` });
  if (!checked.ok) return c.json({ success: false, error: checked.error }, 400);
  const lockKey = `reservation:${storeId}:${checked.value.startsAt}`;
  const lockOwner = crypto.randomUUID();
  if (!await acquireLock(dbFor(c.env, storeId), lockKey, lockOwner)) return c.json({ success: false, error: '同じ時間帯を別の担当者が更新中です' }, 409);
  try {
    const tables = await dbFor(c.env, storeId).prepare('SELECT id, min_capacity, max_capacity, is_active FROM rt_tables WHERE store_id = ?').bind(storeId).all<{ id: string; min_capacity: number; max_capacity: number; is_active: number }>();
    const tableId = checked.value.tableId || chooseRestaurantTable(tables.results.map((row) => ({ id: row.id, minCapacity: row.min_capacity, maxCapacity: row.max_capacity, isActive: row.is_active === 1 })), checked.value.guestCount);
    const id = crypto.randomUUID();
    await dbFor(c.env, storeId).prepare(`INSERT INTO rt_reservations
      (id, store_id, source, external_id, customer_name, customer_phone, line_uid, guest_count, starts_at, ends_at, table_id, course_id, status, allergy_note, note)
      VALUES (?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        id, storeId, checked.value.externalId, checked.value.customerName, checked.value.customerPhone,
        checked.value.lineUid, checked.value.guestCount, checked.value.startsAt, checked.value.endsAt,
        tableId, checked.value.courseId, checked.value.status, checked.value.allergyNote, checked.value.note,
      ).run();
    return c.json({ success: true, data: { id, tableId, syncDirection: 'inbound_only' } }, 201);
  } finally {
    await releaseLock(dbFor(c.env, storeId), lockKey, lockOwner);
  }
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
  if (!inserted.meta.changes) return c.json({ success: true, data: { duplicate: true, direction: 'inbound' } });
  try {
    const value = checked.value;
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
    await dbFor(c.env, body.storeId).prepare("UPDATE rt_sync_events SET status = 'processed', processed_at = datetime('now') WHERE id = ?").bind(eventDbId).run();
    return c.json({ success: true, data: { duplicate: false, direction: 'inbound', outboundWrites: 0 } }, 201);
  } catch (error) {
    await dbFor(c.env, body.storeId).prepare("UPDATE rt_sync_events SET status = 'failed', error_message = ? WHERE id = ?").bind(error instanceof Error ? error.message.slice(0, 500) : 'unknown', eventDbId).run();
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
  const body = await c.req.json<{ storeId?: string; kind?: string; name?: string; price?: number; allergens?: string[]; servicePeriods?: string[] }>();
  if (!body.storeId || !await storeBelongsTo(c, organization.id, body.storeId)) return c.json({ success: false, error: '店舗が正しくありません' }, 400);
  const price = Number(body.price);
  if (!['course', 'a_la_carte'].includes(body.kind || '') || !body.name?.trim() || !Number.isInteger(price) || price < 0) return c.json({ success: false, error: 'メニューの入力内容が正しくありません' }, 400);
  const id = crypto.randomUUID();
  await dbFor(c.env, body.storeId).prepare('INSERT INTO rt_menu_items (id, store_id, kind, name, price, allergens_json, service_periods_json) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, body.storeId, body.kind, body.name.trim(), price, JSON.stringify(body.allergens || []), JSON.stringify(body.servicePeriods || ['dinner'])).run();
  return c.json({ success: true, data: { id } }, 201);
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
