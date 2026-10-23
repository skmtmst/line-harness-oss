import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Env } from '../../worker-env.js';
import { createTestD1, type SqliteD1 } from '../../test-utils/d1-sqlite.js';
import { UberEatsError, type FetchLike } from '../../services/uber-eats.js';
import { restaurantDelivery } from '../../routes/restaurant-delivery.js';
import {
  parseUberStoreLifecycleNotification,
  processUberStoreLifecycleNotification,
  type UberStoreLifecycleNotification,
} from './store-lifecycle.js';

const NOW_MS = Date.parse('2026-10-23T03:00:00Z');
const NOW_SECONDS = Math.floor(NOW_MS / 1000);
const TENANT = '00000000-0000-4000-8000-000000000001';
const ENCRYPTION_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const HOSTS = {
  authorizeUrl: 'https://sandbox-login.uber.com/oauth/v2/authorize',
  tokenUrl: 'https://sandbox-login.uber.com/oauth/v2/token',
  apiBaseUrl: 'https://test-api.uber.com',
};

let database: SqliteD1;
let fetcher: Mock<FetchLike>;
let getAccessToken: Mock<() => Promise<string>>;

function payload(
  eventType: UberStoreLifecycleNotification['eventType'] = 'store.provisioned',
  options: { eventId?: string; storeId?: string; clientId?: string; timestamp?: number; performRefreshMenu?: boolean } = {},
) {
  return {
    event_type: eventType,
    store_id: options.storeId ?? 'uber-store',
    perform_refresh_menu: options.performRefreshMenu ?? false,
    webhook_meta: {
      client_id: options.clientId ?? 'fixture-client',
      webhook_msg_timestamp: options.timestamp ?? NOW_SECONDS,
      webhook_msg_uuid: options.eventId ?? 'event-one',
    },
  };
}

function connection() {
  return database.raw.prepare(`SELECT * FROM rt_delivery_uber_connections WHERE store_id = 'store-one'`).get() as Record<string, unknown>;
}

function event(eventId = 'event-one') {
  return database.raw.prepare(`SELECT * FROM rt_delivery_events WHERE external_event_id = ?`).get(eventId) as Record<string, unknown> | undefined;
}

async function seedConnection(overrides: {
  storeId?: string;
  uberStoreId?: string;
  status?: string;
  connectedAt?: number;
  provisionedAt?: number | null;
  version?: number;
  accountId?: string;
  token?: string | null;
  expiresAt?: number | null;
} = {}) {
  database.raw.prepare(`INSERT INTO rt_delivery_uber_connections
    (store_id, account_id, uber_store_id, access_token_enc, access_token_expires_at,
      granted_scope, status, connected_at, provisioned_at, version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'eats.pos_provisioning', ?, ?, ?, ?, ?, ?)`)
    .run(overrides.storeId ?? 'store-one', overrides.accountId ?? 'account-one', overrides.uberStoreId ?? 'uber-store',
      overrides.token === undefined ? 'merchant-token-ciphertext' : overrides.token,
      overrides.expiresAt === undefined ? NOW_MS + 86_400_000 : overrides.expiresAt,
      overrides.status ?? 'pending_store', overrides.connectedAt ?? NOW_MS - 60_000,
      overrides.provisionedAt === undefined ? null : overrides.provisionedAt,
      overrides.version ?? 1, NOW_MS - 60_000, NOW_MS - 60_000);
}

async function process(raw = payload()) {
  const parsed = parseUberStoreLifecycleNotification(raw);
  if (!parsed.matched || !parsed.ok) throw new Error('fixture did not parse');
  return processUberStoreLifecycleNotification({
    db: database.db,
    notification: parsed.notification,
    rawBody: JSON.stringify(raw),
    expectedClientId: 'fixture-client',
    hosts: HOSTS,
    fetcher,
    getAccessToken,
    nowMs: NOW_MS,
  });
}

async function sendSigned(raw: object, overrides: Partial<Env['Bindings']> = {}) {
  const body = JSON.stringify(raw);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('fixture-secret'),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  const signature = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  const app = new Hono<Env>();
  app.route('/', restaurantDelivery);
  const env = {
    DB: database.db, DEPLOY_ENV: 'test', RESTAURANT_TEST_ENABLED: 'true',
    RT_DELIVERY_UBEREATS_ENVIRONMENT: 'sandbox', RT_DELIVERY_UBEREATS_CLIENT_ID: 'fixture-client',
    RT_DELIVERY_UBEREATS_CLIENT_SECRET: 'fixture-secret', WORKER_PUBLIC_URL: 'https://worker.example.test',
    LINE_CREDENTIAL_ENCRYPTION_KEY: ENCRYPTION_KEY, ...overrides,
  } as unknown as Env['Bindings'];
  return app.request('/api/restaurant-test/delivery/webhooks/ubereats', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-uber-signature': signature }, body,
  }, env);
}

beforeEach(() => {
  database = createTestD1();
  database.raw.prepare(`UPDATE tenants SET feature_packs = '["restaurant"]', status = 'active' WHERE id = ?`).run(TENANT);
  database.raw.prepare(`INSERT INTO line_accounts
    (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
    VALUES ('account-one', 'channel-one', '店舗1', 'fixture-token', 'fixture-secret', 1, ?),
      ('account-two', 'channel-two', '店舗2', 'fixture-token', 'fixture-secret', 1, ?)`)
    .run(TENANT, TENANT);
  database.raw.prepare(`INSERT INTO rt_organizations (id, account_id, tenant_id, name, status)
    VALUES ('organization-one', 'account-one', ?, '統括', 'active')`).run(TENANT);
  database.raw.prepare(`INSERT INTO rt_stores
    (id, organization_id, name, code, area, capacity, status, line_account_id)
    VALUES ('store-one', 'organization-one', '店舗1', 'ONE', '東京', 20, 'active', 'account-one'),
      ('store-two', 'organization-one', '店舗2', 'TWO', '東京', 20, 'active', 'account-two')`).run();
  getAccessToken = vi.fn(async () => 'application-token');
  fetcher = vi.fn(async () => Response.json({
    integration_enabled: true,
    integrator_store_id: 'store-one',
    order_manager_client_id: 'fixture-client',
    is_order_manager_pending: false,
  }));
});

afterEach(() => {
  database.raw.close();
  vi.unstubAllGlobals();
});

describe('Uber store lifecycle envelope', () => {
  it('parses the documented store envelope separately from order notifications', () => {
    expect(parseUberStoreLifecycleNotification(payload())).toEqual({
      matched: true,
      ok: true,
      notification: {
        eventType: 'store.provisioned',
        storeId: 'uber-store',
        clientId: 'fixture-client',
        eventId: 'event-one',
        eventTimestampSeconds: NOW_SECONDS,
        performRefreshMenu: false,
      },
    });
    expect(parseUberStoreLifecycleNotification({ event_type: 'orders.notification' })).toEqual({ matched: false });
  });

  it.each([
    { ...payload(), store_id: '' },
    { ...payload(), webhook_meta: { ...payload().webhook_meta, client_id: ' fixture-client' } },
    { ...payload(), webhook_meta: { ...payload().webhook_meta, webhook_msg_uuid: null } },
    { ...payload(), webhook_meta: { ...payload().webhook_meta, webhook_msg_timestamp: 1.5 } },
    { ...payload(), perform_refresh_menu: 'yes' },
  ])('rejects a malformed recognized store event: %#', raw => {
    expect(parseUberStoreLifecycleNotification(raw)).toMatchObject({ matched: true, ok: false });
  });
});

describe('Uber store lifecycle processing', () => {
  it('routes a store event before the incompatible order envelope parser', async () => {
    await seedConnection({ status: 'connected', provisionedAt: NOW_MS - 60_000 });
    const response = await sendSigned(payload('store.deprovisioned'), { RT_DELIVERY_SEND_ENABLED: 'false' });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
    expect(connection()).toMatchObject({ status: 'disconnected' });
  });

  it('uses a scope-isolated eats.store application token for provision reconciliation', async () => {
    await seedConnection();
    const provider = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/oauth/v2/token')) {
        return Response.json({ access_token: 'store-application-token', expires_in: 3600, scope: 'eats.store' });
      }
      return Response.json({ integration_enabled: true, integrator_store_id: 'store-one',
        order_manager_client_id: 'fixture-client', is_order_manager_pending: false });
    });
    vi.stubGlobal('fetch', provider);
    const response = await sendSigned(payload(), { RT_DELIVERY_SEND_ENABLED: 'true' });
    expect(response.status).toBe(200);
    expect(provider).toHaveBeenCalledTimes(2);
    const tokenInit = provider.mock.calls[0]?.[1];
    expect(new URLSearchParams(String(tokenInit?.body)).get('scope')).toBe('eats.store');
    expect(provider.mock.calls[1]?.[0]).toBe('https://test-api.uber.com/v1/eats/stores/uber-store/pos_data');
    expect(connection()).toMatchObject({ status: 'connected', version: 2 });
  });

  it('keeps signed provisioning retryable without token or POS traffic while delivery sending is disabled', async () => {
    await seedConnection();
    const provider = vi.fn();
    vi.stubGlobal('fetch', provider);
    const response = await sendSigned(payload(), { RT_DELIVERY_SEND_ENABLED: 'false' });
    expect(response.status).toBe(503);
    expect(provider).not.toHaveBeenCalled();
    expect(connection()).toMatchObject({ status: 'pending_store', provisioned_at: null, version: 1 });
    expect(event()).toMatchObject({ status: 'retryable_failed', error_code: 'store_provision_reconcile_retryable' });
  });

  it('reconciles provisioned through a mocked GET before marking the exact mapping connected', async () => {
    await seedConnection();
    await expect(process()).resolves.toEqual({ status: 200 });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://test-api.uber.com/v1/eats/stores/uber-store/pos_data');
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({ authorization: 'Bearer application-token' }),
    });
    expect(connection()).toMatchObject({
      status: 'connected', provisioned_at: NOW_MS, last_error: null, version: 2,
    });
    expect(event()).toMatchObject({ status: 'processed', event_type: 'store.provisioned', attempts: 1 });
  });

  it('defers perform_refresh_menu for explicit review instead of claiming the store is ready', async () => {
    await seedConnection();
    await expect(process(payload('store.provisioned', { performRefreshMenu: true }))).resolves.toEqual({ status: 200 });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(connection()).toMatchObject({ status: 'pending_store', last_error: 'store_menu_refresh_review_required', version: 2 });
    expect(event()).toMatchObject({ status: 'failed', error_code: 'store_menu_refresh_review_required' });
  });

  it('treats perform_refresh_menu as part of the durable event identity', async () => {
    await seedConnection();
    await process(payload('store.provisioned', { performRefreshMenu: true }));
    await expect(process(payload('store.provisioned', { performRefreshMenu: false }))).resolves.toEqual({
      status: 409, error: 'Event identity conflict',
    });
  });

  it('reconciles a valid same-second provision instead of leaving a pending mapping unresolved', async () => {
    await seedConnection({ connectedAt: NOW_MS + 1, status: 'pending_store' });
    await expect(process()).resolves.toEqual({ status: 200 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(connection()).toMatchObject({ status: 'connected', provisioned_at: NOW_MS, version: 2 });
    expect(event()).toMatchObject({ status: 'processed' });
  });

  it('deprovisions without a provider GET and removes the no-longer-authorized credential', async () => {
    await seedConnection({ status: 'connected', provisionedAt: NOW_MS - 60_000 });
    await expect(process(payload('store.deprovisioned'))).resolves.toEqual({ status: 200 });

    expect(fetcher).not.toHaveBeenCalled();
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(connection()).toMatchObject({
      status: 'disconnected', access_token_enc: null, access_token_expires_at: null,
      granted_scope: null, provisioned_at: null, disconnected_at: NOW_MS, version: 2,
    });
    expect(event()).toMatchObject({ status: 'processed', event_type: 'store.deprovisioned' });
  });

  it.each([
    ['pending_store', 'pos_deactivation_started', null],
    ['pending_store', 'pos_deactivation_unknown', null],
    ['disconnected', 'pos_deactivation_confirmed', NOW_MS - 60_000],
  ])('preserves the %s / %s manual DELETE marker on deprovision',
    async (status, lastError, disconnectedAt) => {
      await seedConnection({ status, connectedAt: NOW_MS - 120_000, provisionedAt: null });
      database.raw.prepare(`UPDATE rt_delivery_uber_connections
        SET last_error = ?, disconnected_at = ? WHERE store_id = 'store-one'`)
        .run(lastError, disconnectedAt);
      await expect(process(payload('store.deprovisioned'))).resolves.toEqual({ status: 200 });

      expect(fetcher).not.toHaveBeenCalled();
      expect(connection()).toMatchObject({
        status: 'disconnected', last_error: lastError, version: 2,
      });
    });

  it('does not let an old deprovision event deactivate a newer reconnection', async () => {
    await seedConnection({
      status: 'connected',
      connectedAt: NOW_MS - 120_000,
      provisionedAt: NOW_MS + 1,
      version: 8,
    });
    await expect(process(payload('store.deprovisioned'))).resolves.toEqual({ status: 200 });

    expect(connection()).toMatchObject({ status: 'connected', provisioned_at: NOW_MS + 1, version: 8 });
    expect(event()).toMatchObject({ status: 'ignored', error_code: 'store_lifecycle_stale' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('deprovisions a real same-second event when live reconciliation confirms access was lost', async () => {
    await seedConnection({
      status: 'connected', connectedAt: NOW_MS - 120_000, provisionedAt: NOW_MS + 1, version: 8,
    });
    getAccessToken.mockRejectedValueOnce(new UberEatsError('no_permission', 403));
    await expect(process(payload('store.deprovisioned'))).resolves.toEqual({ status: 200 });

    expect(connection()).toMatchObject({ status: 'disconnected', provisioned_at: null, version: 9 });
    expect(event()).toMatchObject({ status: 'processed', event_type: 'store.deprovisioned' });
  });

  it('makes a processed event UUID terminal even after the row reconnects', async () => {
    await seedConnection({ status: 'connected', provisionedAt: NOW_MS - 60_000 });
    const notice = payload('store.deprovisioned');
    await process(notice);
    database.raw.prepare(`UPDATE rt_delivery_uber_connections SET status = 'connected',
      access_token_enc = ?, access_token_expires_at = ?, provisioned_at = ?, version = version + 1
      WHERE store_id = 'store-one'`).run('merchant-token-ciphertext', NOW_MS + 86_400_000, NOW_MS + 10_000);
    const reconnectedVersion = connection().version;

    await expect(process(notice)).resolves.toEqual({ status: 200 });
    expect(connection()).toMatchObject({ status: 'connected', provisioned_at: NOW_MS + 10_000, version: reconnectedVersion });
    expect(database.raw.prepare(`SELECT COUNT(*) AS count FROM rt_delivery_events`).get()).toEqual({ count: 1 });
  });

  it('does not let an old provision event resurrect a newer deprovisioned mapping', async () => {
    await seedConnection({ status: 'connected', provisionedAt: NOW_MS - 120_000 });
    await process(payload('store.deprovisioned', { eventId: 'deprovision-new' }));
    await expect(process(payload('store.provisioned', {
      eventId: 'provision-old', timestamp: NOW_SECONDS - 60,
    }))).resolves.toEqual({ status: 200 });

    expect(connection()).toMatchObject({ status: 'disconnected', disconnected_at: NOW_MS, version: 2 });
    expect(event('provision-old')).toMatchObject({ status: 'ignored', error_code: 'store_lifecycle_stale' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('restores a temporarily deprovisioned mapping after a newer verified provision', async () => {
    await seedConnection({ status: 'connected', provisionedAt: NOW_MS - 120_000 });
    await process(payload('store.deprovisioned', { eventId: 'temporary-deprovision' }));
    await expect(process(payload('store.provisioned', {
      eventId: 'new-provision', timestamp: NOW_SECONDS + 60,
    }))).resolves.toEqual({ status: 200 });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(connection()).toMatchObject({
      status: 'connected', provisioned_at: NOW_MS + 60_000, disconnected_at: null,
      last_error: null, version: 3,
    });
    expect(event('new-provision')).toMatchObject({ status: 'processed' });
  });

  it('does not revive a confirmed manual disconnect from a newer stale positive provision', async () => {
    await seedConnection({ status: 'disconnected', provisionedAt: null, version: 3 });
    database.raw.prepare(`UPDATE rt_delivery_uber_connections
      SET disconnected_at = ?, last_error = 'pos_deactivation_confirmed'
      WHERE store_id = 'store-one'`).run(NOW_MS);
    await expect(process(payload('store.provisioned', {
      eventId: 'stale-positive-provision', timestamp: NOW_SECONDS + 60,
    }))).resolves.toEqual({ status: 200 });

    expect(fetcher).not.toHaveBeenCalled();
    expect(connection()).toMatchObject({
      status: 'disconnected', provisioned_at: null, disconnected_at: NOW_MS,
      last_error: 'pos_deactivation_confirmed', version: 3,
    });
    expect(event('stale-positive-provision')).toMatchObject({
      status: 'ignored', error_code: 'pos_deactivation_unresolved',
    });
  });

  it('keeps a same-second old provision disconnected when current provider access is gone', async () => {
    await seedConnection({ status: 'connected', provisionedAt: NOW_MS - 120_000 });
    await process(payload('store.deprovisioned', { eventId: 'deprovision-new' }));
    getAccessToken.mockRejectedValueOnce(new UberEatsError('no_permission', 403));
    await expect(process(payload('store.provisioned', { eventId: 'provision-old' }))).resolves.toEqual({ status: 200 });

    expect(connection()).toMatchObject({ status: 'disconnected', disconnected_at: NOW_MS, version: 2 });
    expect(event('provision-old')).toMatchObject({ status: 'ignored', error_code: 'store_lifecycle_stale' });
  });

  it('refuses an active event lease and recovers after that lease expires', async () => {
    await seedConnection({ status: 'connected', provisionedAt: NOW_MS - 60_000 });
    database.raw.prepare(`INSERT INTO rt_resource_locks(resource_key, owner_token, expires_at, created_at)
      VALUES ('uber-store-lifecycle:event-one', 'other-worker', ?, ?)`)
      .run(new Date(NOW_MS + 60_000).toISOString(), new Date(NOW_MS).toISOString());
    await expect(process(payload('store.deprovisioned'))).resolves.toEqual({
      status: 503, error: 'Processing is busy',
    });
    expect(connection()).toMatchObject({ status: 'connected', version: 1 });

    database.raw.prepare(`UPDATE rt_resource_locks SET expires_at = ?
      WHERE resource_key = 'uber-store-lifecycle:event-one'`)
      .run(new Date(NOW_MS - 1).toISOString());
    await expect(process(payload('store.deprovisioned'))).resolves.toEqual({ status: 200 });
    expect(connection()).toMatchObject({ status: 'disconnected', version: 2 });
  });

  it.each([
    {
      response: { integration_enabled: false, integrator_store_id: 'store-one', order_manager_client_id: 'fixture-client' },
      label: 'disabled integration',
    },
    {
      response: { integration_enabled: true, integrator_store_id: 'other-store', order_manager_client_id: 'fixture-client' },
      label: 'other integrator store',
    },
    {
      response: { integration_enabled: true, integrator_store_id: 'store-one', order_manager_client_id: 'other-client' },
      label: 'other order manager',
    },
    {
      response: { integration_enabled: true, integrator_store_id: 'store-one', order_manager_client_id: 'fixture-client', is_order_manager_pending: true },
      label: 'pending order manager',
    },
  ])('keeps provisioned under review for $label', async ({ response }) => {
    await seedConnection();
    fetcher.mockResolvedValueOnce(Response.json(response));
    await expect(process()).resolves.toEqual({ status: 200 });

    expect(connection()).toMatchObject({ status: 'pending_store', last_error: 'store_provision_review_required', version: 2 });
    expect(event()).toMatchObject({ status: 'failed', error_code: 'store_provision_review_required' });
  });

  it('requires an exact client ID before reading or mutating tenant state', async () => {
    await seedConnection();
    await expect(process(payload('store.provisioned', { clientId: 'other-client' }))).resolves.toEqual({
      status: 400,
      error: 'Store lifecycle client mismatch',
    });
    expect(connection()).toMatchObject({ status: 'pending_store', version: 1 });
    expect(event()).toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not infer tenant ownership or grant access for an unknown or ambiguous mapping', async () => {
    await expect(process()).resolves.toEqual({ status: 200 });
    await seedConnection();
    await seedConnection({ storeId: 'store-two', accountId: 'account-two' });
    await expect(process()).resolves.toEqual({ status: 200 });

    expect(database.raw.prepare(`SELECT COUNT(*) AS count FROM rt_delivery_events`).get()).toEqual({ count: 0 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    `UPDATE rt_stores SET status = 'paused' WHERE id = 'store-one'`,
    `UPDATE rt_stores SET line_account_id = NULL WHERE id = 'store-one'`,
    `UPDATE rt_organizations SET status = 'archived' WHERE id = 'organization-one'`,
    `UPDATE line_accounts SET is_active = 0 WHERE id = 'account-one'`,
    `UPDATE line_accounts SET archived_at = '2026-10-23T00:00:00Z' WHERE id = 'account-one'`,
    `UPDATE tenants SET status = 'suspended' WHERE id = '${TENANT}'`,
    `UPDATE tenants SET feature_packs = '[]' WHERE id = '${TENANT}'`,
    `INSERT INTO rt_store_feature_flags(store_id, feature, enabled, created_at, updated_at)
      VALUES ('store-one', 'delivery', 0, 1, 1)`,
  ])('does not mutate a mapping outside the active tenant/store ownership fence: %s', async sql => {
    await seedConnection();
    database.raw.exec(sql);
    await expect(process()).resolves.toEqual({ status: 200 });
    expect(connection()).toMatchObject({ status: 'pending_store', version: 1 });
    expect(event()).toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects reuse of one UUID for a different signed store event identity', async () => {
    await seedConnection({ status: 'connected', provisionedAt: NOW_MS - 60_000 });
    await process(payload('store.deprovisioned'));
    database.raw.prepare(`UPDATE rt_delivery_uber_connections SET status = 'connected',
      access_token_enc = ?, access_token_expires_at = ?, provisioned_at = ?, version = version + 1
      WHERE store_id = 'store-one'`).run('merchant-token-ciphertext', NOW_MS + 86_400_000, NOW_MS + 1);

    await expect(process(payload('store.provisioned'))).resolves.toEqual({
      status: 409,
      error: 'Event identity conflict',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not overwrite a connection that changes while GET pos_data is in flight', async () => {
    await seedConnection({ status: 'connected', provisionedAt: NOW_MS - 60_000 });
    fetcher.mockImplementationOnce(async () => {
      database.raw.prepare(`UPDATE rt_delivery_uber_connections SET version = version + 1
        WHERE store_id = 'store-one'`).run();
      return Response.json({ integration_enabled: true, integrator_store_id: 'store-one',
        order_manager_client_id: 'fixture-client', is_order_manager_pending: false });
    });
    await expect(process()).resolves.toEqual({ status: 503, error: 'Processing interrupted' });

    expect(connection()).toMatchObject({ uber_store_id: 'uber-store', status: 'connected', version: 2 });
    expect(event()).toMatchObject({ status: 'received', version: 1 });
  });

  it('does not mutate the connection or event after both leases are taken over during GET', async () => {
    await seedConnection();
    fetcher.mockImplementationOnce(async () => {
      database.raw.prepare(`UPDATE rt_resource_locks SET owner_token = 'replacement-owner'
        WHERE resource_key IN ('uber-store-lifecycle:event-one', 'uber-store-lifecycle-store:uber-store')`).run();
      return Response.json({ integration_enabled: true, integrator_store_id: 'store-one',
        order_manager_client_id: 'fixture-client', is_order_manager_pending: false });
    });
    await expect(process()).resolves.toEqual({ status: 503, error: 'Processing interrupted' });

    expect(connection()).toMatchObject({ status: 'pending_store', provisioned_at: null, version: 1 });
    expect(event()).toMatchObject({ status: 'received', version: 1 });
    expect(database.raw.prepare(`SELECT owner_token FROM rt_resource_locks
      WHERE resource_key = 'uber-store-lifecycle:event-one'`).get())
      .toEqual({ owner_token: 'replacement-owner' });
  });

  it('does not mark an event retryable after its leases are taken over during a failed GET', async () => {
    await seedConnection();
    getAccessToken.mockImplementationOnce(async () => {
      database.raw.prepare(`UPDATE rt_resource_locks SET owner_token = 'replacement-owner'
        WHERE resource_key IN ('uber-store-lifecycle:event-one', 'uber-store-lifecycle-store:uber-store')`).run();
      throw new UberEatsError('unavailable', 503);
    });
    await expect(process()).resolves.toEqual({ status: 503, error: 'Store reconciliation failed' });
    expect(connection()).toMatchObject({ status: 'pending_store', version: 1 });
    expect(event()).toMatchObject({ status: 'received', version: 1 });
  });

  it('does not mutate the connection when a duplicate Uber store mapping appears during GET', async () => {
    await seedConnection();
    fetcher.mockImplementationOnce(async () => {
      await seedConnection({ storeId: 'store-two', accountId: 'account-two' });
      return Response.json({ integration_enabled: true, integrator_store_id: 'store-one',
        order_manager_client_id: 'fixture-client', is_order_manager_pending: false });
    });
    await expect(process()).resolves.toEqual({ status: 503, error: 'Processing interrupted' });

    expect(connection()).toMatchObject({ status: 'pending_store', provisioned_at: null, version: 1 });
    expect(event()).toMatchObject({ status: 'received', version: 1 });
  });

  it('keeps a transient token failure retryable and finishes the same event after recovery', async () => {
    await seedConnection();
    getAccessToken.mockRejectedValueOnce(new UberEatsError('unavailable', 503));
    await expect(process()).resolves.toEqual({ status: 503, error: 'Store reconciliation failed' });
    expect(connection()).toMatchObject({ status: 'pending_store', last_error: null, version: 1 });
    expect(event()).toMatchObject({ status: 'retryable_failed', error_code: 'store_provision_reconcile_retryable' });
    expect(fetcher).not.toHaveBeenCalled();

    await expect(process()).resolves.toEqual({ status: 200 });
    expect(connection()).toMatchObject({ status: 'connected', version: 2 });
    expect(event()).toMatchObject({ status: 'processed' });
  });
});
