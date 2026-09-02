import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const getNotificationCenter = vi.fn();
const getNotificationCenterCounts = vi.fn();
const markAllNotificationsRead = vi.fn();
const markNotificationRead = vi.fn();
const getVisibleLineAccountScope = vi.fn();

vi.mock('@line-crm/db', () => ({
  getNotificationCenter: (...args: unknown[]) => getNotificationCenter(...args),
  getNotificationCenterCounts: (...args: unknown[]) => getNotificationCenterCounts(...args),
  markAllNotificationsRead: (...args: unknown[]) => markAllNotificationsRead(...args),
  markNotificationRead: (...args: unknown[]) => markNotificationRead(...args),
}));

vi.mock('../services/account-access.js', () => ({
  getVisibleLineAccountScope: (...args: unknown[]) => getVisibleLineAccountScope(...args),
}));

async function createApp() {
  const { notificationCenter } = await import('./notification-center.js');
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', {
      id: 'staff-a', name: '担当者A', role: 'staff', readOnly: false, tenantId: 'tenant-a',
    });
    await next();
  });
  app.route('/', notificationCenter);
  return app;
}

const env = { DB: {} as D1Database } as Env['Bindings'];

beforeEach(() => {
  vi.clearAllMocks();
  getVisibleLineAccountScope.mockResolvedValue({ allowedAccountIds: ['account-a'] });
  getNotificationCenter.mockResolvedValue([{
    id: 'notice-1', rule_id: null, event_type: 'release', category: 'update',
    title: '更新があります', body: '内容', channel: 'dashboard', status: 'pending',
    metadata: '{"version":"1.0"}', line_account_id: 'account-a', read_at: null,
    created_at: '2026-08-27T10:00:00',
  }]);
  getNotificationCenterCounts.mockResolvedValue({ all: 1, error: 0, update: 1, unread: 1 });
  markNotificationRead.mockResolvedValue(true);
  markAllNotificationsRead.mockResolvedValue(1);
});

describe('dashboard notification center routes', () => {
  it('requires a selected LINE account', async () => {
    const response = await (await createApp()).request('/api/notifications/center', {}, env);
    expect(response.status).toBe(400);
    expect(getNotificationCenter).not.toHaveBeenCalled();
  });

  it('does not expose another account notifications', async () => {
    const response = await (await createApp()).request(
      '/api/notifications/center?lineAccountId=account-b', {}, env,
    );
    expect(response.status).toBe(403);
    expect(getNotificationCenter).not.toHaveBeenCalled();
  });

  it('returns account-scoped items, counts, and staff read state', async () => {
    const response = await (await createApp()).request(
      '/api/notifications/center?lineAccountId=account-a&category=update&limit=10', {}, env,
    );
    expect(response.status).toBe(200);
    expect(getNotificationCenter).toHaveBeenCalledWith(env.DB, {
      lineAccountId: 'account-a', staffId: 'staff-a', category: 'update', limit: 10,
    });
    expect(await response.json()).toMatchObject({
      success: true,
      data: {
        unreadCount: 1,
        items: [{ id: 'notice-1', isRead: false, metadata: { version: '1.0' } }],
      },
    });
  });

  it('marks one visible account notification as read', async () => {
    const response = await (await createApp()).request('/api/notifications/center/notice-1/read', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lineAccountId: 'account-a' }),
    }, env);
    expect(response.status).toBe(200);
    expect(markNotificationRead).toHaveBeenCalledWith(env.DB, {
      notificationId: 'notice-1', lineAccountId: 'account-a', staffId: 'staff-a',
    });
  });

  it('returns 404 instead of creating a read for a missing notification', async () => {
    markNotificationRead.mockResolvedValue(false);
    const response = await (await createApp()).request('/api/notifications/center/missing/read', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lineAccountId: 'account-a' }),
    }, env);
    expect(response.status).toBe(404);
  });

  it('marks only the selected category as read for the current staff member', async () => {
    const response = await (await createApp()).request('/api/notifications/center/read-all', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lineAccountId: 'account-a', category: 'error' }),
    }, env);
    expect(response.status).toBe(200);
    expect(markAllNotificationsRead).toHaveBeenCalledWith(env.DB, {
      lineAccountId: 'account-a', staffId: 'staff-a', category: 'error',
    });
  });
});
