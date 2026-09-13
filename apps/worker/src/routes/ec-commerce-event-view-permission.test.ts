import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

// N-316(#626): events / subscriptions / connector / settings の4 GET が
// overview / orders 等と同じ requireEcPermission('ec.event.view') で守られること。
// 権限なしstaffは403、許可staff・owner/adminは既存どおり、アカウント不可視の403秘匿を保つ。
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
vi.mock('@line-crm/line-sdk', () => ({ LineClient: vi.fn() }));

const { ecCommerce } = await import('./ec-commerce.js');

function firstFor(sql: string): unknown {
  if (sql.includes('FROM ec_connectors')) return null;
  if (sql.includes('SUM(CASE')) {
    return {
      today: 0, last_30_days: 0, failed: 0,
      last_received_at: null, last_succeeded_at: null,
    };
  }
  if (sql.includes('COUNT(*) AS count')) return { count: 0 };
  return null;
}

const DB = {
  // connector の影響集計は bind なしで first を呼ぶため、直呼びにも対応する。
  prepare: (sql: string) => {
    const statement = {
      bind: (..._args: unknown[]) => statement,
      first: async () => firstFor(sql),
      all: async () => ({ results: [] }),
      run: async () => ({ meta: { changes: 1 } }),
    };
    return statement;
  },
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

const TARGETS = [
  '/api/ec-commerce/events?lineAccountId=account-1',
  '/api/ec-commerce/subscriptions?lineAccountId=account-1',
  '/api/ec-commerce/connector?lineAccountId=account-1',
  '/api/ec-commerce/settings?lineAccountId=account-1',
];

beforeEach(() => {
  vi.clearAllMocks();
  accessMocks.canAccessAllLineAccounts.mockResolvedValue(true);
  accessMocks.getVisibleLineAccountScope.mockResolvedValue({ allowedAccountIds: [], canSeeUnassigned: true });
});

describe('EC event.view permission gate (N-316)', () => {
  it('staff without ec.event.view gets 403 on all four reads', async () => {
    for (const path of TARGETS) {
      const response = await request(path, { role: 'staff' });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ success: false, code: 'FORBIDDEN' });
    }
  });

  it('staff with ec.event.view can read all four', async () => {
    for (const path of TARGETS) {
      const response = await request(path, { role: 'staff', permissions: ['ec.event.view'] });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ success: true });
    }
  });

  it('owner and admin can read all four without the key', async () => {
    for (const role of ['owner', 'admin'] as const) {
      for (const path of TARGETS) {
        const response = await request(path, { role });
        expect(response.status).toBe(200);
      }
    }
  });

  it('invisible accounts stay 403 even with the permission', async () => {
    accessMocks.canAccessAllLineAccounts.mockResolvedValue(false);
    for (const path of TARGETS) {
      const response = await request(path, { role: 'staff', permissions: ['ec.event.view'] });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        success: false, error: 'このLINEアカウントを表示する権限がありません',
      });
    }
  });

  it('overview regression: gate still matches the four reads', async () => {
    const denied = await request('/api/ec-commerce/overview?lineAccountId=account-1', { role: 'staff' });
    expect(denied.status).toBe(403);
    const allowed = await request('/api/ec-commerce/overview?lineAccountId=account-1', {
      role: 'staff', permissions: ['ec.event.view'],
    });
    expect(allowed.status).toBe(200);
  });
});
