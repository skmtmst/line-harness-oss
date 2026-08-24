import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const db = vi.hoisted(() => ({
  getLineAccounts: vi.fn(),
  listFriendAddEvents: vi.fn(),
  getTags: vi.fn(),
}));

vi.mock('@line-crm/db', () => db);

const { friendAddRouting } = await import('./friend-add-routing.js');

const app = new Hono<Env>();
app.use('*', async (c, next) => {
  c.set('staff', {
    id: 'staff-1', name: '担当者', role: 'staff', readOnly: false,
    tenantId: 'tenant-1', permissionKeys: ['/friend-add-settings'],
  });
  await next();
});
app.route('/', friendAddRouting);

const env = { DB: {} as D1Database } as Env['Bindings'];

beforeEach(() => {
  vi.clearAllMocks();
  db.getLineAccounts.mockResolvedValue([
    { id: 'account-1', tenant_id: 'tenant-1' },
    { id: 'account-2', tenant_id: 'tenant-2' },
  ]);
  db.listFriendAddEvents.mockResolvedValue({
    items: [],
    summary: { total: 0, firstTime: 0, returning: 0, captured: 0, unavailable: 0, pending: 0, failed: 0 },
    nextCursor: null,
  });
});

describe('GET /api/friend-add-routing/events', () => {
  test('同じ統括のLINEアカウントだけを取得する', async () => {
    const response = await app.request(
      '/api/friend-add-routing/events?account_id=account-1&kind=returning&attribution_status=unavailable',
      {}, env,
    );
    expect(response.status).toBe(200);
    expect(db.listFriendAddEvents).toHaveBeenCalledWith(env.DB, expect.objectContaining({
      lineAccountId: 'account-1', kind: 'returning', attributionStatus: 'unavailable',
    }));
  });

  test('別統括のLINEアカウントは存在しないものとして返す', async () => {
    const response = await app.request(
      '/api/friend-add-routing/events?account_id=account-2', {}, env,
    );
    expect(response.status).toBe(404);
    expect(db.listFriendAddEvents).not.toHaveBeenCalled();
  });

  test('不正な状態値はDBを読まずに止める', async () => {
    const response = await app.request(
      '/api/friend-add-routing/events?account_id=account-1&routing_status=unknown', {}, env,
    );
    expect(response.status).toBe(400);
    expect(db.getLineAccounts).not.toHaveBeenCalled();
  });
});
