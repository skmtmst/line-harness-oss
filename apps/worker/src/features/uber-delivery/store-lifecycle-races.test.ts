import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createTestD1, type SqliteD1 } from '../../test-utils/d1-sqlite.js';
import type { FetchLike } from '../../services/uber-eats.js';
import {
  parseUberStoreLifecycleNotification,
  processUberStoreLifecycleNotification,
  type UberStoreLifecycleNotification,
} from './store-lifecycle.js';

const NOW_MS = Date.parse('2026-10-23T03:00:00Z');
const NOW_SECONDS = Math.floor(NOW_MS / 1000);
const TENANT = '00000000-0000-4000-8000-000000000001';
const HOSTS = {
  authorizeUrl: 'https://sandbox-login.uber.com/oauth/v2/authorize',
  tokenUrl: 'https://sandbox-login.uber.com/oauth/v2/token',
  apiBaseUrl: 'https://test-api.uber.com',
};

let database: SqliteD1;
let fetcher: Mock<FetchLike>;

function payload(
  eventType: UberStoreLifecycleNotification['eventType'],
  eventId: string,
  timestamp: number,
  performRefreshMenu = false,
) {
  return {
    event_type: eventType,
    store_id: 'uber-store',
    perform_refresh_menu: performRefreshMenu,
    webhook_meta: {
      client_id: 'fixture-client',
      webhook_msg_timestamp: timestamp,
      webhook_msg_uuid: eventId,
    },
  };
}

async function process(raw: ReturnType<typeof payload>) {
  const parsed = parseUberStoreLifecycleNotification(raw);
  if (!parsed.matched || !parsed.ok) throw new Error('fixture did not parse');
  return processUberStoreLifecycleNotification({
    db: database.db,
    notification: parsed.notification,
    rawBody: JSON.stringify(raw),
    expectedClientId: 'fixture-client',
    hosts: HOSTS,
    fetcher,
    getAccessToken: async () => 'application-token',
    nowMs: NOW_MS,
  });
}

beforeEach(() => {
  database = createTestD1();
  database.raw.prepare(`UPDATE tenants SET feature_packs = '["restaurant"]', status = 'active' WHERE id = ?`).run(TENANT);
  database.raw.prepare(`INSERT INTO line_accounts
    (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
    VALUES ('account-one', 'channel-one', '店舗', 'fixture-token', 'fixture-secret', 1, ?)`).run(TENANT);
  database.raw.prepare(`INSERT INTO rt_organizations (id, account_id, tenant_id, name, status)
    VALUES ('organization-one', 'account-one', ?, '統括', 'active')`).run(TENANT);
  database.raw.prepare(`INSERT INTO rt_stores
    (id, organization_id, name, code, area, capacity, status, line_account_id)
    VALUES ('store-one', 'organization-one', '店舗', 'ONE', '東京', 20, 'active', 'account-one')`).run();
  database.raw.prepare(`INSERT INTO rt_delivery_uber_connections
    (store_id, account_id, uber_store_id, status, connected_at, provisioned_at, version, created_at, updated_at)
    VALUES ('store-one', 'account-one', 'uber-store', 'pending_store', ?, NULL, 1, ?, ?)`).run(
      NOW_MS - 60_000, NOW_MS - 60_000, NOW_MS - 60_000,
    );
});

afterEach(() => database.raw.close());

describe('Uber store lifecycle concurrency', () => {
  it('serializes different event UUIDs for one store and retries the older event as stale', async () => {
    let releaseFetch: ((response: Response) => void) | undefined;
    const deferred = new Promise<Response>(resolve => { releaseFetch = resolve; });
    fetcher = vi.fn(async () => deferred);

    const newer = process(payload('store.provisioned', 'provision-newer', NOW_SECONDS + 1));
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await expect(process(payload('store.deprovisioned', 'deprovision-older', NOW_SECONDS)))
      .resolves.toEqual({ status: 503, error: 'Processing is busy' });
    expect(database.raw.prepare(`SELECT COUNT(*) AS count FROM rt_delivery_events
      WHERE external_event_id = 'deprovision-older'`).get()).toEqual({ count: 0 });

    releaseFetch?.(Response.json({
      integration_enabled: true,
      integrator_store_id: 'store-one',
      order_manager_client_id: 'fixture-client',
      is_order_manager_pending: false,
    }));
    await expect(newer).resolves.toEqual({ status: 200 });
    await expect(process(payload('store.deprovisioned', 'deprovision-older', NOW_SECONDS)))
      .resolves.toEqual({ status: 200 });

    expect(database.raw.prepare(`SELECT status, provisioned_at, version
      FROM rt_delivery_uber_connections WHERE store_id = 'store-one'`).get()).toEqual({
      status: 'connected', provisioned_at: (NOW_SECONDS + 1) * 1000, version: 2,
    });
    expect(database.raw.prepare(`SELECT status, error_code FROM rt_delivery_events
      WHERE external_event_id = 'deprovision-older'`).get()).toEqual({
      status: 'ignored', error_code: 'store_lifecycle_stale',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('keeps an active mapping when an equal-second deprovision conflicts with current POS state', async () => {
    fetcher = vi.fn(async () => Response.json({
      integration_enabled: true,
      integrator_store_id: 'store-one',
      order_manager_client_id: 'fixture-client',
      is_order_manager_pending: false,
    }));
    await expect(process(payload('store.provisioned', 'provision-first', NOW_SECONDS)))
      .resolves.toEqual({ status: 200 });
    await expect(process(payload('store.deprovisioned', 'deprovision-same-second', NOW_SECONDS)))
      .resolves.toEqual({ status: 200 });

    expect(database.raw.prepare(`SELECT status, provisioned_at, version
      FROM rt_delivery_uber_connections WHERE store_id = 'store-one'`).get()).toEqual({
      status: 'connected', provisioned_at: NOW_MS, version: 2,
    });
    expect(database.raw.prepare(`SELECT status, error_code FROM rt_delivery_events
      WHERE external_event_id = 'deprovision-same-second'`).get()).toEqual({
      status: 'ignored', error_code: 'store_lifecycle_stale',
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not let an equal-second provision bypass a menu-refresh review', async () => {
    fetcher = vi.fn(async () => Response.json({
      integration_enabled: true,
      integrator_store_id: 'store-one',
      order_manager_client_id: 'fixture-client',
      is_order_manager_pending: false,
    }));
    await expect(process(payload('store.provisioned', 'provision-newer', NOW_SECONDS + 1, true)))
      .resolves.toEqual({ status: 200 });
    await expect(process(payload('store.provisioned', 'provision-same-second', NOW_SECONDS + 1)))
      .resolves.toEqual({ status: 200 });

    expect(database.raw.prepare(`SELECT status, last_error, version
      FROM rt_delivery_uber_connections WHERE store_id = 'store-one'`).get()).toEqual({
      status: 'pending_store', last_error: 'store_menu_refresh_review_required', version: 2,
    });
    expect(database.raw.prepare(`SELECT status, error_code FROM rt_delivery_events
      WHERE external_event_id = 'provision-same-second'`).get()).toEqual({
      status: 'ignored', error_code: 'store_lifecycle_stale',
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
