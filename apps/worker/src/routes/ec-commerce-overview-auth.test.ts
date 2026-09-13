import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

// 概要の口に viewers 以外の権限ゲートが付いているか(#517 中4)。
// orders / action-executions / identity-candidates と同じく
// requireRole + requireEcPermission('ec.event.view') で守る。
const dbMocks = vi.hoisted(() => ({
  encryptCredential: vi.fn(),
  getLineAccountById: vi.fn(),
  jstNow: vi.fn(() => '2026-09-08T00:00:00+09:00'),
}));
const accessMocks = vi.hoisted(() => ({
  canAccessAllLineAccounts: vi.fn(),
  getVisibleLineAccountScope: vi.fn(),
}));

vi.mock('@line-crm/db', () => dbMocks);
vi.mock('../services/account-access.js', () => accessMocks);
vi.mock('../services/event-bus.js', () => ({ logOutgoingMessage: vi.fn() }));
vi.mock('../services/ec-notification-message.js', () => ({ ecFlexMessage: vi.fn() }));
vi.mock('./line-notifications.js', () => ({ notificationDeliveriesResponse: vi.fn() }));
vi.mock('./ec-integrations.js', () => ({ EC_EVENT_TYPES: [] }));

const { ecCommerce } = await import('./ec-commerce.js');

const DB = {
  prepare: () => ({
    bind: (..._args: unknown[]) => ({
      first: async () => ({
        total: 0, processed: 0, identity_pending: 0, failed: 0,
        skipped: 0, last_24h: 0, last_received_at: null,
      }),
      all: async () => ({ results: [] }),
    }),
  }),
} as unknown as D1Database;

function app(role: 'owner' | 'admin' | 'staff' = 'owner', permissionKeys: string[] = []) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', {
      id: 'staff-1', name: '担当者', role, readOnly: false,
      tenantId: 'tenant-1', permissionKeys,
    });
    await next();
  });
  instance.route('/', ecCommerce);
  return instance;
}

function request(path: string, options: { role?: 'owner' | 'admin' | 'staff'; permissions?: string[] } = {}) {
  return app(options.role, options.permissions).fetch(
    new Request(`https://example.com${path}`),
    { DB } as Env['Bindings'],
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  accessMocks.canAccessAllLineAccounts.mockResolvedValue(true);
  accessMocks.getVisibleLineAccountScope.mockResolvedValue({ allowedAccountIds: [], canSeeUnassigned: true });
});

describe('EC overview permission gate', () => {
  it('staff without ec.event.view gets 403', async () => {
    const response = await request('/api/ec-commerce/overview?lineAccountId=account-1', { role: 'staff' });
    expect(response.status).toBe(403);
  });

  it('staff with ec.event.view can read the overview', async () => {
    const response = await request('/api/ec-commerce/overview?lineAccountId=account-1', {
      role: 'staff', permissions: ['ec.event.view'],
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true });
  });

  it('owner can read the overview', async () => {
    const response = await request('/api/ec-commerce/overview?lineAccountId=account-1', { role: 'owner' });
    expect(response.status).toBe(200);
  });

  it('other accounts stay 403 even with the permission', async () => {
    accessMocks.canAccessAllLineAccounts.mockResolvedValueOnce(false);
    const response = await request('/api/ec-commerce/overview?lineAccountId=other', {
      role: 'staff', permissions: ['ec.event.view'],
    });
    expect(response.status).toBe(403);
  });
});
