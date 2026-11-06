import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../worker-env.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { restaurantDelivery } from './restaurant-delivery.js';

const TENANT = '00000000-0000-4000-8000-000000000001';
const SECRET = 'synthetic-uber-app-secret';
const BASE = '/api/restaurant-test/delivery';
let database: SqliteD1;
let env: Env['Bindings'];
let transport: ReturnType<typeof vi.fn>;
let app: Hono<Env>;

function orderPayload() {
  return {
    id: 'uber-order', display_id: '123ABC', current_state: 'CREATED',
    store: { id: 'uber-store' },
    cart: { items: [{
      id: 'meal', instance_id: 'meal-1', title: 'お弁当', quantity: 2,
      special_instructions: '卵を使わないでください',
      price: {
        unit_price: { amount: 1200, currency_code: 'JPY' },
        total_price: { amount: 2400, currency_code: 'JPY' },
      },
    }] },
    payment: { charges: { total: { amount: 2400, currency_code: 'JPY' } } },
    placed_at: new Date().toISOString(), type: 'DELIVERY_BY_UBER',
  };
}

beforeEach(() => {
  database = createTestD1({ loginPolicy: 'off' });
  database.raw.prepare(`UPDATE tenants SET feature_packs = '["restaurant"]' WHERE id = ?`).run(TENANT);
  database.raw.prepare(`INSERT INTO line_accounts
    (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
    VALUES ('delivery-account', 'delivery-channel', '店舗', 'synthetic-token', 'synthetic-secret', 1, ?)`).run(TENANT);
  database.raw.prepare(`INSERT INTO rt_organizations (id, account_id, tenant_id, name)
    VALUES ('delivery-org', 'parent-account', ?, '統括')`).run(TENANT);
  database.raw.prepare(`INSERT INTO line_accounts
    (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
    VALUES ('parent-account', 'parent-channel', '統括', 'synthetic-token', 'synthetic-secret', 1, ?)`).run(TENANT);
  database.raw.prepare(`INSERT INTO rt_stores
    (id, organization_id, name, code, area, capacity, status, line_account_id)
    VALUES ('delivery-store', 'delivery-org', '店舗', 'DELIVERY', '東京', 20, 'active', 'delivery-account')`).run();
  database.raw.prepare(`INSERT INTO rt_delivery_uber_connections
    (store_id, account_id, uber_store_id, status, provisioned_at, created_at, updated_at)
    VALUES ('delivery-store', 'delivery-account', 'uber-store', 'connected', ?, ?, ?)`)
    .run(Date.now(), Date.now(), Date.now());
  env = {
    DB: database.db, DEPLOY_ENV: 'test', RESTAURANT_TEST_ENABLED: 'true',
    RT_DELIVERY_SEND_ENABLED: 'true', RT_DELIVERY_UBEREATS_ENVIRONMENT: 'sandbox',
    RT_DELIVERY_UBEREATS_CLIENT_ID: 'synthetic-app', RT_DELIVERY_UBEREATS_CLIENT_SECRET: SECRET,
    WORKER_PUBLIC_URL: 'https://worker.example.test',
    LINE_CREDENTIAL_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  } as unknown as Env['Bindings'];
  transport = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === 'https://sandbox-login.uber.com/oauth/v2/token') {
      return Response.json({ access_token: 'synthetic-app-token', expires_in: 3600, scope: 'eats.order eats.store.orders.read' });
    }
    if (url === 'https://test-api.uber.com/v2/eats/order/uber-order' && init?.method === 'GET') {
      return Response.json(orderPayload());
    }
    if (url === 'https://test-api.uber.com/v1/eats/orders/uber-order/accept_pos_order') {
      return new Response(null, { status: 204 });
    }
    if (url === 'https://test-api.uber.com/v1/eats/orders/uber-order/cancel') {
      return new Response(null, { status: 200 });
    }
    throw new Error('unexpected_synthetic_transport');
  });
  vi.stubGlobal('fetch', transport);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'env-owner', name: '運営', role: 'owner', readOnly: false, tenantId: TENANT });
    return next();
  });
  app.route('/', restaurantDelivery);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  database.raw.close();
});

async function notify(eventId = 'event-1', signatureOverride?: string) {
  const raw = JSON.stringify({
    event_id: eventId, event_type: 'orders.notification',
    meta: { resource_id: 'uber-order', user_id: 'uber-store' },
    resource_href: 'https://untrusted.example/do-not-fetch',
  });
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)));
  const signature = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return app.request(`${BASE}/webhooks/ubereats`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-uber-signature': signatureOverride ?? signature }, body: raw,
  }, env);
}

function localOrder() {
  return database.raw.prepare('SELECT id, status FROM rt_delivery_orders').get() as { id: string; status: string };
}

function act(action: string, body: object = {}, confirmation?: string) {
  return app.request(`${BASE}/orders/${localOrder().id}/${action}?account_id=delivery-account`, {
    method: 'POST', headers: {
      'content-type': 'application/json',
      ...(confirmation ? { 'x-confirm-irreversible': confirmation } : {}),
    }, body: JSON.stringify(body),
  }, env);
}

describe('Uberの署名付き受信から注文操作まで', () => {
  it.each([
    ["UPDATE rt_delivery_uber_connections SET provisioned_at = NULL", 'disconnected'],
    ["UPDATE rt_delivery_uber_connections SET last_error = 'pos_activation_unknown'", 'error'],
    ["UPDATE rt_delivery_uber_connections SET status = 'expired'", 'error'],
    ["INSERT INTO rt_delivery_uber_connections (store_id, account_id, uber_store_id, status, provisioned_at, created_at, updated_at) VALUES ('other-store', 'other-account', 'uber-store', 'connected', 1, 1, 1)", 'error'],
  ])('操作できない接続を接続中と表示しない: %s', async (sql, status) => {
    database.raw.exec(sql);
    const response = await app.request(`${BASE}/orders?account_id=delivery-account`, {}, env);
    expect(response.status).toBe(200);
    const json = await response.json() as { services: unknown[] };
    expect(json.services).toEqual(expect.arrayContaining([expect.objectContaining({
      service: 'ubereats',
      connectionStatus: status,
      orderActionsEnabled: false,
    })]));
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([
    ['RT_DELIVERY_SEND_ENABLED', 'false'],
    ['RT_DELIVERY_UBEREATS_CLIENT_ID', undefined],
    ['LINE_CREDENTIAL_ENCRYPTION_KEY', undefined],
  ] as const)('%s が使えないときは注文操作を利用可能と返さない', async (key, value) => {
    env = { ...env, [key]: value };
    const response = await app.request(`${BASE}/orders?account_id=delivery-account`, {}, env);
    expect(response.status).toBe(200);
    const json = await response.json() as { services: unknown[] };
    expect(json.services).toEqual(expect.arrayContaining([expect.objectContaining({
      service: 'ubereats',
      connectionStatus: 'connected',
      orderActionsEnabled: false,
    })]));
    expect(transport).not.toHaveBeenCalled();
  });

  it('公式通知を取り込み、接続状態と注文を表示し、受注を一度だけ送る', async () => {
    const received = await notify();
    expect(received.status).toBe(200);
    expect(await received.text()).toBe('');
    expect((await notify()).status).toBe(200);
    const listing = await app.request(`${BASE}/orders?account_id=delivery-account&tab=new`, {}, env);
    expect(listing.status).toBe(200);
    const json = await listing.json() as {
      orders: { id: string }[];
      services: { service: string; connectionStatus: string; orderActionsEnabled?: boolean }[];
    };
    expect(json.orders).toHaveLength(1);
    expect(json.services).toEqual(expect.arrayContaining([expect.objectContaining({
      service: 'ubereats',
      connectionStatus: 'connected',
      orderActionsEnabled: true,
    })]));
    expect((await act('accept')).status).toBe(200);
    expect(localOrder().status).toBe('cooking');
    expect((await act('accept')).status).toBe(409);
    expect(transport.mock.calls.filter(([url]) => url.endsWith('/accept_pos_order'))).toHaveLength(1);
    expect(transport.mock.calls.filter(([url]) => url.endsWith('/oauth/v2/token'))).toHaveLength(1);
    expect(database.raw.prepare('SELECT note, amount FROM rt_delivery_order_items').get())
      .toMatchObject({ note: '卵を使わないでください', amount: 1200 });
  });

  it('準備完了は外部へ送らず店舗内の進行として記録する', async () => {
    await notify();
    await act('accept');
    transport.mockClear();
    const response = await act('ready');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      synchronization: 'local',
      order: { status: 'ready' },
    });
    expect(localOrder().status).toBe('ready');
    expect(transport).not.toHaveBeenCalled();
  });

  it('キャンセルは確認操作を必須にし、公式の理由で送る', async () => {
    await notify();
    await act('accept');
    transport.mockClear();
    expect((await act('cancel', { reason_code: 'out_of_stock' })).status).toBe(428);
    expect(transport).not.toHaveBeenCalled();
    expect((await act('cancel', { reason_code: 'out_of_stock' }, 'delivery-order-cancel')).status).toBe(200);
    expect(JSON.parse(String(transport.mock.calls[0]?.[1]?.body))).toEqual({ reason: 'OUT_OF_ITEMS' });
    expect(localOrder().status).toBe('canceled');
  });

  it('不正な署名ではトークン取得も注文保存もしない', async () => {
    expect((await notify('bad', '0'.repeat(64))).status).toBe(401);
    expect(transport).not.toHaveBeenCalled();
    expect(database.raw.prepare('SELECT COUNT(*) AS count FROM rt_delivery_orders').get()).toEqual({ count: 0 });
  });

  it('受注前に連携が切れたら外部へ送らない', async () => {
    await notify();
    database.raw.prepare("UPDATE rt_delivery_uber_connections SET status = 'disconnected'").run();
    transport.mockClear();
    expect((await act('accept')).status).toBeGreaterThanOrEqual(400);
    expect(localOrder().status).toBe('new');
    expect(transport).not.toHaveBeenCalled();
  });
});
