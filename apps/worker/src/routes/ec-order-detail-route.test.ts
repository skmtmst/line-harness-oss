/*
 * IDEA-23: GET /api/ec-commerce/orders/:id のルート契約。
 * 権限・アカウント可視範囲・404 の区別を固定する。中身の組み立ては
 * packages/db の getEcOrderDetail 実DB試験が受け持つ。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const dbMocks = vi.hoisted(() => ({
  getEcOrderDetail: vi.fn(),
}));
const canAccess = vi.hoisted(() => vi.fn());

vi.mock('@line-crm/db', () => dbMocks);
vi.mock('../services/account-access.js', () => ({ canAccessAllLineAccounts: canAccess }));

const { ecOperations } = await import('./ec-operations.js');

const DB = {} as D1Database;

function app(role: 'owner' | 'admin' | 'staff' = 'owner', permissionKeys: string[] = []) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', {
      id: 'staff-1', name: '担当者', role, readOnly: false,
      tenantId: 'tenant-1', permissionKeys,
    });
    await next();
  });
  instance.route('/', ecOperations);
  return instance;
}

function request(path: string, role: 'owner' | 'admin' | 'staff' = 'owner', permissionKeys: string[] = []) {
  return app(role, permissionKeys).fetch(new Request(`https://example.com${path}`), { DB } as Env['Bindings']);
}

beforeEach(() => {
  vi.clearAllMocks();
  canAccess.mockResolvedValue(true);
  dbMocks.getEcOrderDetail.mockResolvedValue({
    order: { id: 'order-1', orderNumber: 'NEN-1001' },
    events: [], followUps: [],
    outcomes: { conversions: [], mileage: [], scores: [] },
  });
});

describe('GET /api/ec-commerce/orders/:id', () => {
  it('アカウント未指定は 400', async () => {
    const response = await request('/api/ec-commerce/orders/order-1');
    expect(response.status).toBe(400);
    expect(dbMocks.getEcOrderDetail).not.toHaveBeenCalled();
  });

  it('ec.event.view を持たない staff は 403', async () => {
    const response = await request('/api/ec-commerce/orders/order-1?lineAccountId=account-1', 'staff', ['other.permission']);
    expect(response.status).toBe(403);
    expect(dbMocks.getEcOrderDetail).not.toHaveBeenCalled();
  });

  it('ec.event.view を持つ staff は読める', async () => {
    const response = await request('/api/ec-commerce/orders/order-1?lineAccountId=account-1', 'staff', ['ec.event.view']);
    expect(response.status).toBe(200);
  });

  it('見えないアカウントは 403', async () => {
    canAccess.mockResolvedValue(false);
    const response = await request('/api/ec-commerce/orders/order-1?lineAccountId=account-1');
    expect(response.status).toBe(403);
    expect(dbMocks.getEcOrderDetail).not.toHaveBeenCalled();
  });

  it('対象外の注文は 404', async () => {
    dbMocks.getEcOrderDetail.mockResolvedValue(null);
    const response = await request('/api/ec-commerce/orders/order-1?lineAccountId=account-1');
    expect(response.status).toBe(404);
  });

  it('注文IDとアカウントを束ねて台帳へ渡す', async () => {
    const response = await request('/api/ec-commerce/orders/order-1?lineAccountId=account-1');
    expect(response.status).toBe(200);
    expect(dbMocks.getEcOrderDetail).toHaveBeenCalledWith(expect.anything(), {
      lineAccountId: 'account-1', orderId: 'order-1',
    });
    const body = await response.json() as { success: boolean; data: { order: { orderNumber: string } } };
    expect(body.success).toBe(true);
    expect(body.data.order.orderNumber).toBe('NEN-1001');
  });
});
