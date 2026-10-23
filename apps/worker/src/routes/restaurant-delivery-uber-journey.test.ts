import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import type { Env } from '../worker-env.js';
import { restaurantDelivery } from './restaurant-delivery.js';

const TENANT = '00000000-0000-4000-8000-000000000001';
const OTHER_TENANT = '00000000-0000-4000-8000-000000000002';
const ACCOUNT = 'journey-account';
const STORE = 'journey-store';
const OTHER_ACCOUNT = 'journey-other-account';
const OTHER_STORE = 'journey-other-store';
const UBER_STORE = 'uber-journey-store';
const ORDER = 'uber-journey-order';
const SECRET = 'synthetic-uber-journey-secret';
const BASE = '/api/restaurant-test/delivery';

let database: SqliteD1;
let env: Env['Bindings'];
let transport: ReturnType<typeof vi.fn>;
let app: Hono<Env>;

function seedStore(input: {
  tenantId: string;
  accountId: string;
  organizationId: string;
  storeId: string;
  channelId: string;
}): void {
  database.raw.prepare(
    `INSERT INTO line_accounts
       (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
     VALUES (?, ?, ?, 'synthetic-token', 'synthetic-secret', 1, ?)`,
  ).run(input.accountId, input.channelId, input.storeId, input.tenantId);
  database.raw.prepare(
    `INSERT INTO rt_organizations (id, account_id, tenant_id, name, status)
     VALUES (?, ?, ?, ?, 'active')`,
  ).run(input.organizationId, input.accountId, input.tenantId, input.storeId);
  database.raw.prepare(
    `INSERT INTO rt_stores
       (id, organization_id, name, code, area, capacity, status, line_account_id)
     VALUES (?, ?, ?, ?, '東京', 20, 'active', ?)`,
  ).run(input.storeId, input.organizationId, input.storeId, input.storeId, input.accountId);
}

function uberOrderPayload() {
  return {
    id: ORDER,
    display_id: 'JOURNEY-123',
    current_state: 'CREATED',
    store: { id: UBER_STORE },
    cart: {
      items: [{
        id: 'meal',
        instance_id: 'meal-1',
        title: 'お弁当',
        quantity: 2,
        special_instructions: '卵を使わないでください',
        price: {
          unit_price: { amount: 1200, currency_code: 'JPY' },
          total_price: { amount: 2400, currency_code: 'JPY' },
        },
      }],
    },
    payment: { charges: { total: { amount: 2400, currency_code: 'JPY' } } },
    placed_at: '2026-10-22T12:00:00.000Z',
    type: 'DELIVERY_BY_UBER',
  };
}

async function sign(raw: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function notify(
  eventId: string,
  eventType: 'orders.notification' | 'orders.cancel' = 'orders.notification',
): Promise<Response> {
  const raw = JSON.stringify({
    event_id: eventId,
    event_type: eventType,
    meta: { resource_id: ORDER, user_id: UBER_STORE },
    resource_href: 'https://untrusted.example/must-not-be-fetched',
  });
  return app.request(`${BASE}/webhooks/ubereats`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-uber-signature': await sign(raw),
    },
    body: raw,
  }, env);
}

function action(
  orderId: string,
  name: 'accept' | 'ready' | 'handed-over',
  body: object = {},
) {
  return app.request(`${BASE}/orders/${orderId}/${name}?account_id=${ACCOUNT}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }, env);
}

beforeEach(() => {
  database = createTestD1({ loginPolicy: 'off' });
  database.raw.prepare(`UPDATE tenants SET feature_packs = '["restaurant"]' WHERE id = ?`).run(TENANT);
  database.raw.prepare(
    `INSERT INTO tenants (id, name, feature_packs) VALUES (?, '別の統括', '["restaurant"]')`,
  ).run(OTHER_TENANT);
  seedStore({
    tenantId: TENANT,
    accountId: ACCOUNT,
    organizationId: 'journey-org',
    storeId: STORE,
    channelId: 'journey-channel',
  });
  seedStore({
    tenantId: OTHER_TENANT,
    accountId: OTHER_ACCOUNT,
    organizationId: 'journey-other-org',
    storeId: OTHER_STORE,
    channelId: 'journey-other-channel',
  });
  database.raw.prepare(
    `INSERT INTO rt_delivery_uber_connections
       (store_id, account_id, uber_store_id, status, provisioned_at, created_at, updated_at)
     VALUES (?, ?, ?, 'connected', 1, 1, 1)`,
  ).run(STORE, ACCOUNT, UBER_STORE);
  database.raw.prepare(
    `INSERT INTO rt_delivery_orders
       (id, account_id, store_id, service, external_order_id, order_number, status,
        total_amount, currency, item_count, received_at, version, created_at, updated_at)
     VALUES ('other-order', ?, ?, 'ubereats', 'other-external-order', 'OTHER-1', 'new',
       900, 'JPY', 1, 1, 1, 1, 1)`,
  ).run(OTHER_ACCOUNT, OTHER_STORE);

  env = {
    DB: database.db,
    DEPLOY_ENV: 'test',
    RESTAURANT_TEST_ENABLED: 'true',
    RT_DELIVERY_SEND_ENABLED: 'true',
    RT_DELIVERY_UBEREATS_ENVIRONMENT: 'sandbox',
    RT_DELIVERY_UBEREATS_CLIENT_ID: 'synthetic-app',
    RT_DELIVERY_UBEREATS_CLIENT_SECRET: SECRET,
    WORKER_PUBLIC_URL: 'https://worker.example.test',
    LINE_CREDENTIAL_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  } as unknown as Env['Bindings'];
  transport = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === 'https://sandbox-login.uber.com/oauth/v2/token') {
      return Response.json({
        access_token: 'synthetic-app-token',
        expires_in: 3600,
        scope: 'eats.order eats.store.orders.read',
      });
    }
    if (url === `https://test-api.uber.com/v2/eats/order/${ORDER}` && init?.method === 'GET') {
      return Response.json(uberOrderPayload());
    }
    if (url === `https://test-api.uber.com/v1/eats/orders/${ORDER}/accept_pos_order`) {
      return new Response(null, { status: 204 });
    }
    throw new Error('unexpected_synthetic_transport');
  });
  vi.stubGlobal('fetch', transport);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', {
      id: 'journey-owner',
      name: '運営',
      role: 'owner',
      readOnly: false,
      tenantId: TENANT,
    });
    return next();
  });
  app.route('/', restaurantDelivery);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  database.raw.close();
});

describe('Uber Eats HTTP横断', () => {
  it('署名通知を1回だけ取り込み、店舗内の進行を外部送信なしで受け渡し済みまで記録する', async () => {
    expect((await notify('journey-event')).status).toBe(200);
    expect((await notify('journey-event')).status).toBe(200);

    expect(transport.mock.calls.filter(([url]) => String(url).endsWith(`/v2/eats/order/${ORDER}`)))
      .toHaveLength(1);
    expect(database.raw.prepare(
      `SELECT account_id, external_order_id, status, attempts FROM rt_delivery_events
       WHERE external_event_id = 'journey-event'`,
    ).get()).toEqual({
      account_id: ACCOUNT,
      external_order_id: ORDER,
      status: 'processed',
      attempts: 1,
    });
    const stored = database.raw.prepare(
      `SELECT id, account_id, store_id, status, total_amount, item_count
       FROM rt_delivery_orders WHERE external_order_id = ?`,
    ).get(ORDER) as { id: string; account_id: string; store_id: string; status: string };
    expect(stored).toMatchObject({
      account_id: ACCOUNT,
      store_id: STORE,
      status: 'new',
      total_amount: 2400,
      item_count: 2,
    });
    expect(database.raw.prepare(
      'SELECT name, note, quantity, amount FROM rt_delivery_order_items WHERE order_id = ?',
    ).get(stored.id)).toEqual({
      name: 'お弁当',
      note: '卵を使わないでください',
      quantity: 2,
      amount: 1200,
    });

    const listing = await app.request(`${BASE}/orders?account_id=${ACCOUNT}&tab=new`, {}, env);
    expect(listing.status).toBe(200);
    const listed = await listing.json() as { orders: { id: string; storeId?: string }[] };
    expect(listed.orders.map((order) => order.id)).toEqual([stored.id]);
    expect(listed.orders.map((order) => order.id)).not.toContain('other-order');

    const foreignAction = await action('other-order', 'accept', {});
    expect(foreignAction.status).toBe(404);
    expect(database.raw.prepare('SELECT status FROM rt_delivery_orders WHERE id = ?').get('other-order'))
      .toEqual({ status: 'new' });

    expect((await action(stored.id, 'accept')).status).toBe(200);
    const callsAfterAccept = transport.mock.calls.length;
    const ready = await action(stored.id, 'ready');
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({
      synchronization: 'local',
      order: { id: stored.id, status: 'ready' },
    });
    expect((await action(stored.id, 'ready')).status).toBe(409);
    const handedOver = await action(stored.id, 'handed-over');
    expect(handedOver.status).toBe(200);
    expect(await handedOver.json()).toMatchObject({
      synchronization: 'local',
      order: { id: stored.id, status: 'handed_over' },
    });
    expect((await action(stored.id, 'handed-over')).status).toBe(409);

    expect(database.raw.prepare(
      `SELECT status, accepted_at IS NOT NULL AS accepted,
              ready_at IS NOT NULL AS ready, handed_over_at IS NOT NULL AS handed_over, version
       FROM rt_delivery_orders WHERE id = ?`,
    ).get(stored.id)).toEqual({
      status: 'handed_over',
      accepted: 1,
      ready: 1,
      handed_over: 1,
      version: 4,
    });
    expect(database.raw.prepare(
      `SELECT action, status, account_id, store_id FROM rt_delivery_dispatches
       WHERE target_id = ? ORDER BY requested_at, action`,
    ).all(stored.id)).toEqual([
      { action: 'accept', status: 'succeeded', account_id: ACCOUNT, store_id: STORE },
    ]);
    expect(transport.mock.calls.filter(([url]) => String(url).endsWith('/accept_pos_order'))).toHaveLength(1);
    expect(transport.mock.calls).toHaveLength(callsAfterAccept);
    expect(database.raw.prepare(
      `SELECT COUNT(*) AS count FROM rt_delivery_dispatches WHERE target_id = 'other-order'`,
    ).get()).toEqual({ count: 0 });
  });

  it.each([
    { label: '保留中', status: 'pending', errorCode: null },
    { label: '結果不明', status: 'failed', errorCode: 'delivery_result_unknown' },
  ])('別の版の外部操作が$labelの間も、店舗内の進行を書き込まない', async ({ status, errorCode }) => {
    await notify('pending-dispatch-order');
    await action((database.raw.prepare(
      'SELECT id FROM rt_delivery_orders WHERE external_order_id = ?',
    ).get(ORDER) as { id: string }).id, 'accept');
    const order = database.raw.prepare(
      'SELECT id, version FROM rt_delivery_orders WHERE external_order_id = ?',
    ).get(ORDER) as { id: string; version: number };
    database.raw.prepare(
      `INSERT INTO rt_delivery_dispatches
        (id, account_id, store_id, service, action, target_kind, target_id, status, error_code,
         attempts, requested_at, version, created_at, updated_at)
       VALUES (?, ?, ?, 'ubereats', 'cancel', 'order', ?, ?, ?, 1, 1, ?, 1, 1)`,
    ).run(
      `unresolved-other-version:${status}`,
      ACCOUNT,
      STORE,
      order.id,
      status,
      errorCode,
      order.version + 50,
    );
    transport.mockClear();

    const response = await action(order.id, 'ready');
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'delivery_result_unknown', retryable: false });
    expect(database.raw.prepare('SELECT status, ready_at FROM rt_delivery_orders WHERE id = ?').get(order.id))
      .toEqual({ status: 'cooking', ready_at: null });
    expect(transport).not.toHaveBeenCalled();
  });

  it('同じ注文の取消webhook lockが有効な間は店舗内の進行を書き込まない', async () => {
    await notify('active-order-lock');
    const order = database.raw.prepare(
      'SELECT id FROM rt_delivery_orders WHERE external_order_id = ?',
    ).get(ORDER) as { id: string };
    await action(order.id, 'accept');
    database.raw.prepare(`INSERT INTO rt_resource_locks
      (resource_key, owner_token, expires_at, created_at) VALUES (?, 'webhook-owner', ?, ?)`)
      .run(`uber-webhook-order:${ORDER}`, '2999-01-01T00:00:00.000Z', '2026-10-23T00:00:00.000Z');
    transport.mockClear();

    const response = await action(order.id, 'ready');
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'delivery_order_conflict' });
    expect(database.raw.prepare('SELECT status, ready_at FROM rt_delivery_orders WHERE id = ?').get(order.id))
      .toEqual({ status: 'cooking', ready_at: null });
    expect(transport).not.toHaveBeenCalled();
  });

  it('外部送信を止めた環境では、店舗内の進行も書き込まない', async () => {
    await notify('disabled-progress-order');
    const order = database.raw.prepare(
      'SELECT id FROM rt_delivery_orders WHERE external_order_id = ?',
    ).get(ORDER) as { id: string };
    await action(order.id, 'accept');
    env = { ...env, RT_DELIVERY_SEND_ENABLED: 'false' };
    transport.mockClear();

    const response = await action(order.id, 'ready');
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: 'delivery_send_disabled', retryable: false });
    expect(database.raw.prepare('SELECT status, ready_at FROM rt_delivery_orders WHERE id = ?').get(order.id))
      .toEqual({ status: 'cooking', ready_at: null });
    expect(database.raw.prepare('SELECT status FROM rt_delivery_orders WHERE id = ?').get('other-order'))
      .toEqual({ status: 'new' });
    expect(database.raw.prepare(
      `SELECT COUNT(*) AS count FROM rt_delivery_dispatches WHERE target_id = 'other-order'`,
    ).get()).toEqual({ count: 0 });
    expect(transport).not.toHaveBeenCalled();
  });

  it('操作前に店舗接続が切れたら、店舗内の進行も書き込まない', async () => {
    await notify('disconnected-progress-order');
    const order = database.raw.prepare(
      'SELECT id FROM rt_delivery_orders WHERE external_order_id = ?',
    ).get(ORDER) as { id: string };
    await action(order.id, 'accept');
    database.raw.prepare(
      "UPDATE rt_delivery_uber_connections SET status = 'disconnected', version = version + 1 WHERE store_id = ?",
    ).run(STORE);
    transport.mockClear();

    const response = await action(order.id, 'ready');
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: 'delivery_not_configured', retryable: false });
    expect(database.raw.prepare('SELECT status, ready_at FROM rt_delivery_orders WHERE id = ?').get(order.id))
      .toEqual({ status: 'cooking', ready_at: null });
    expect(transport).not.toHaveBeenCalled();
  });

  it('取消通知が受信台帳に入ったら、処理中も処理後も店舗内の進行で戻さない', async () => {
    await notify('cancel-race-order');
    const order = database.raw.prepare(
      'SELECT id FROM rt_delivery_orders WHERE external_order_id = ?',
    ).get(ORDER) as { id: string };
    await action(order.id, 'accept');
    database.raw.prepare(
      `INSERT INTO rt_delivery_events
        (id, account_id, service, external_event_id, event_type, external_order_id,
         status, payload_json, attempts, received_at, version)
       VALUES ('pending-cancel', ?, 'ubereats', 'pending-cancel', 'orders.cancel', ?,
         'received', ?, 0, 1, 1)`,
    ).run(ACCOUNT, ORDER, JSON.stringify({
      event_id: 'pending-cancel',
      event_type: 'orders.cancel',
      meta: { resource_id: ORDER, user_id: UBER_STORE },
    }));

    expect((await action(order.id, 'ready')).status).toBe(409);
    expect(database.raw.prepare('SELECT status FROM rt_delivery_orders WHERE id = ?').get(order.id))
      .toEqual({ status: 'cooking' });

    database.raw.prepare("DELETE FROM rt_delivery_events WHERE id = 'pending-cancel'").run();
    expect((await notify('processed-cancel', 'orders.cancel')).status).toBe(200);
    expect((await action(order.id, 'ready')).status).toBe(409);
    expect(database.raw.prepare('SELECT status, ready_at FROM rt_delivery_orders WHERE id = ?').get(order.id))
      .toEqual({ status: 'canceled', ready_at: null });
  });

  it('状態更新のCAS直前に取消通知が到着したら、店舗内の進行を書き込まない', async () => {
    await notify('cancel-cas-order');
    const order = database.raw.prepare(
      'SELECT id FROM rt_delivery_orders WHERE external_order_id = ?',
    ).get(ORDER) as { id: string };
    await action(order.id, 'accept');
    transport.mockClear();

    const originalPrepare = database.db.prepare.bind(database.db);
    let cancellationInserted = false;
    const racingDb = {
      prepare(sql: string) {
        const prepared = originalPrepare(sql);
        if (!/^UPDATE rt_delivery_orders\s+SET status = \?, ready_at = \?/m.test(sql)) {
          return prepared;
        }
        return {
          ...prepared,
          bind(...values: unknown[]) {
            const bound = prepared.bind(...values);
            return {
              ...bound,
              async run() {
                if (!cancellationInserted) {
                  database.raw.prepare(
                    `INSERT INTO rt_delivery_events
                      (id, account_id, service, external_event_id, event_type, external_order_id,
                       status, payload_json, attempts, received_at, version)
                     VALUES ('cancel-during-cas', ?, 'ubereats', 'cancel-during-cas',
                       'orders.cancel', ?, 'received', ?, 0, 1, 1)`,
                  ).run(ACCOUNT, ORDER, JSON.stringify({
                    event_id: 'cancel-during-cas',
                    event_type: 'orders.cancel',
                    meta: { resource_id: ORDER, user_id: UBER_STORE },
                  }));
                  cancellationInserted = true;
                }
                return bound.run();
              },
            } as unknown as D1PreparedStatement;
          },
        } as unknown as D1PreparedStatement;
      },
      batch: database.db.batch.bind(database.db),
    } as unknown as D1Database;
    env = { ...env, DB: racingDb };

    const response = await action(order.id, 'ready');
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'delivery_order_conflict' });
    expect(cancellationInserted).toBe(true);
    expect(database.raw.prepare('SELECT status, ready_at FROM rt_delivery_orders WHERE id = ?').get(order.id))
      .toEqual({ status: 'cooking', ready_at: null });
    expect(database.raw.prepare(
      `SELECT status FROM rt_delivery_events WHERE external_event_id = 'cancel-during-cas'`,
    ).get()).toEqual({ status: 'received' });
    expect(transport).not.toHaveBeenCalled();
  });

  it('対象アカウントが無効なら受信台帳も注文も作らず、外部へ送らない', async () => {
    database.raw.prepare('UPDATE line_accounts SET is_active = 0 WHERE id = ?').run(ACCOUNT);

    expect((await notify('inactive-event')).status).toBe(404);
    expect(transport).not.toHaveBeenCalled();
    expect(database.raw.prepare(
      `SELECT COUNT(*) AS count FROM rt_delivery_events WHERE external_event_id = 'inactive-event'`,
    ).get()).toEqual({ count: 0 });
    expect(database.raw.prepare(
      'SELECT COUNT(*) AS count FROM rt_delivery_orders WHERE external_order_id = ?',
    ).get(ORDER)).toEqual({ count: 0 });
    expect(database.raw.prepare('SELECT status FROM rt_delivery_orders WHERE id = ?').get('other-order'))
      .toEqual({ status: 'new' });
  });
});
