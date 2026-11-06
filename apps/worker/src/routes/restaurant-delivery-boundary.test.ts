import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../worker-env.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { restaurantDelivery } from './restaurant-delivery.js';

const tenant = '00000000-0000-4000-8000-000000000001';
const now = new Date('2026-10-23T03:00:00.000Z');
let database: SqliteD1;
let env: Env['Bindings'];
let transport: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
  database = createTestD1({ loginPolicy: 'off' });
  database.raw.prepare(`UPDATE tenants SET feature_packs = '["restaurant"]' WHERE id = ?`).run(tenant);
  database.raw.prepare(`INSERT INTO line_accounts
    (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
    VALUES ('delivery-account', 'delivery-channel', '店舗', 'test-token', 'test-secret', 1, ?)`).run(tenant);
  database.raw.prepare(`INSERT INTO rt_organizations (id, account_id, tenant_id, name)
    VALUES ('delivery-org', 'delivery-account', ?, '統括')`).run(tenant);
  database.raw.prepare(`INSERT INTO rt_stores
    (id, organization_id, name, code, area, capacity, status, line_account_id)
    VALUES ('delivery-store', 'delivery-org', '店舗', 'DELIVERY', '東京', 20, 'active', 'delivery-account')`).run();
  env = { DB: database.db, DEPLOY_ENV: 'test', RESTAURANT_TEST_ENABLED: 'true' } as Env['Bindings'];
  transport = vi.fn(() => { throw new Error('Unexpected external request'); });
  vi.stubGlobal('fetch', transport);
});

afterEach(() => {
  expect(transport).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  database.raw.close();
});

/** 上流の認証を重ねず、実際のrouteへ登録された店舗・環境ゲートを確かめる。 */
function read(query = 'account_id=delivery-account') {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'env-owner', name: '運営', role: 'owner', readOnly: false, tenantId: tenant });
    return next();
  });
  app.route('/', restaurantDelivery);
  return app.request(`/api/restaurant-test/delivery/orders?${query}`, {}, env);
}

function seedOrder(id: string, status: string, receivedAt: number): void {
  database.raw.prepare(`INSERT INTO rt_delivery_orders
    (id, account_id, store_id, service, external_order_id, order_number, status,
     total_amount, currency, item_count, pickup_method, wanted_at, urgency,
     received_at, version, created_at, updated_at)
    VALUES (?, 'delivery-account', 'delivery-store', 'demaecan', ?, ?, ?,
      1000, 'JPY', 1, '配達', ?, 'normal', ?, 1, ?, ?)`)
    .run(id, `external-${id}`, `#${id}`, status, receivedAt + 1800,
      receivedAt, receivedAt, receivedAt);
}

describe('registered delivery access boundary', () => {
  it('keeps the read routes and protected write routes registered', () => {
    for (const [method,paths] of [
      ['POST',['/api/restaurant-test/delivery/orders/:id/accept','/api/restaurant-test/delivery/orders/:id/cancel','/api/restaurant-test/delivery/menu-items/bulk-sold-out','/api/restaurant-test/delivery/intake/stop']],
      ['GET',['/api/restaurant-test/delivery/orders','/api/restaurant-test/delivery/orders/:id','/api/restaurant-test/delivery/history','/api/restaurant-test/delivery/menu-items']],
    ] as const) for(const path of paths)expect(restaurantDelivery.routes.some(route=>route.method===method&&route.path===path)).toBe(true);
  });

  it('keeps a valid same-tenant store readable', async () => {
    const response = await read();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true, orders: [] });
  });

  it('keeps ready orders actionable without counting them as handed over', async () => {
    const nowSec = Math.floor(now.getTime() / 1000);
    seedOrder('order-new', 'new', nowSec - 60);
    seedOrder('order-cooking', 'cooking', nowSec - 60);
    seedOrder('order-ready-yesterday', 'ready', nowSec - 26 * 60 * 60);
    seedOrder('order-handed-over', 'handed_over', nowSec - 60);

    const cookingResponse = await read('account_id=delivery-account&tab=cooking');
    expect(cookingResponse.status).toBe(200);
    const cookingBody = (await cookingResponse.json()) as {
      kpis: { handedOverCount: number };
      tabCounts: { all: number; new: number; cooking: number; handed_over: number };
      orders: Array<{ id: string; status: string; statusLabel: string }>;
    };
    expect(cookingBody.kpis.handedOverCount).toBe(1);
    expect(cookingBody.tabCounts).toEqual({ all: 4, new: 1, cooking: 2, handed_over: 1 });
    expect(cookingBody.orders.map((order) => order.id).sort()).toEqual([
      'order-cooking',
      'order-ready-yesterday',
    ]);
    expect(cookingBody.orders.find((order) => order.status === 'ready')).toMatchObject({
      statusLabel: '準備完了',
    });

    const handedOverResponse = await read('account_id=delivery-account&tab=handed_over');
    expect(handedOverResponse.status).toBe(200);
    const handedOverBody = (await handedOverResponse.json()) as {
      orders: Array<{ id: string }>;
    };
    expect(handedOverBody.orders.map((order) => order.id)).toEqual(['order-handed-over']);

    const allResponse = await read('account_id=delivery-account&tab=all');
    expect(allResponse.status).toBe(200);
    const allBody = (await allResponse.json()) as { orders: Array<{ id: string }> };
    expect(allBody.orders.map((order) => order.id).sort()).toEqual([
      'order-cooking',
      'order-handed-over',
      'order-new',
      'order-ready-yesterday',
    ]);
  });

  it.each(['production', 'unknown'])('keeps %s closed even with an enabled flag', async (environment) => {
    env.DEPLOY_ENV = environment;
    expect((await read()).status).toBe(404);
  });

  it('keeps the environment switch off', async () => {
    env.RESTAURANT_TEST_ENABLED = 'false';
    expect((await read()).status).toBe(404);
  });

  it('requires the current restaurant feature pack', async () => {
    database.raw.prepare(`UPDATE tenants SET feature_packs = '[]' WHERE id = ?`).run(tenant);
    expect((await read()).status).toBe(404);
  });

  it('keeps an account without a linked store unavailable', async () => {
    database.raw.prepare('DELETE FROM rt_stores WHERE id = ?').run('delivery-store');
    const response=await read();
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({error:'このLINEアカウントに店舗が紐付いていません'});
  });

  it('rejects a requested tenant different from the authenticated tenant', async () => {
    expect((await read('account_id=delivery-account&tenant_id=other-tenant')).status).toBe(403);
  });

  it('rejects an account outside the current visible scope', async () => {
    expect((await read('account_id=other-account')).status).toBe(403);
  });
});
