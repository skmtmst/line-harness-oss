import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const roleBundles = [
  { id: 'administrator', name: '管理者', description: '全機能', featureAccess: 'edit', requiresMfa: true },
  { id: 'operations', name: '運用', description: '運用', featureAccess: 'edit', requiresMfa: false },
  { id: 'reception', name: '受付', description: '受付', featureAccess: 'edit', requiresMfa: false },
  { id: 'view_only', name: '見るだけ', description: '閲覧', featureAccess: 'view', requiresMfa: false },
  { id: 'custom', name: 'カスタム', description: '個別', featureAccess: 'custom', requiresMfa: false },
] as const;

const mocks = vi.hoisted(() => ({
  listAccessUsers: vi.fn(),
  listAuditEvents: vi.fn(),
  getVisibleLineAccountScope: vi.fn(),
}));

vi.mock('@line-crm/db', () => ({
  ACCESS_ROLE_BUNDLES: roleBundles,
  listAccessUsers: mocks.listAccessUsers,
  listAuditEvents: mocks.listAuditEvents,
}));
vi.mock('../services/account-access.js', () => ({
  getVisibleLineAccountScope: mocks.getVisibleLineAccountScope,
}));

const { access } = await import('./access.js');
const env = { DB: {} as D1Database };

function app(role: 'owner' | 'admin' | 'staff' = 'owner', permissionKeys: string[] = []) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', {
      id: 'actor-1', name: '担当', role, readOnly: false, permissionKeys,
      tenantId: 'tenant-a', assignedLineAccountId: null, canAccessDescendantAccounts: false,
    });
    return next();
  });
  instance.route('/', access);
  return instance;
}

function request(path: string, role: 'owner' | 'admin' | 'staff' = 'owner', permissionKeys: string[] = []) {
  return app(role, permissionKeys).fetch(new Request(`https://example.com${path}`), env);
}

const userResult = {
  items: [{
    id: 'user-1', name: '山本', email: 'yamamoto@example.com', jobTitle: null,
    roleBundle: 'administrator', featureCount: null, hasFieldMasks: null,
    accountScope: { type: 'all', assignedLineAccountId: null, lineAccountIds: [], includesDescendants: false },
    lastLoginAt: '2026-09-01T00:00:00.000Z', lastActionAt: '2026-09-02T00:00:00.000Z',
    mfaEnabled: true, status: 'active', policyVersion: 3,
    createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
  }],
  summary: {
    active: 1, invited: 0, expiredInvitations: 0, unused90Days: 0, mfaEnabled: 1, mfaRate: 100,
    roleCounts: { administrator: 1, operations: 0, reception: 0, view_only: 0, custom: 0 },
  },
  total: 1, limit: 50, offset: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getVisibleLineAccountScope.mockResolvedValue({
    accounts: [{ id: 'account-a' }], allowedAccountIds: ['account-a'], canSeeUnassigned: false,
    ids: ['account-a'], isAccountScoped: false,
  });
  mocks.listAccessUsers.mockResolvedValue(userResult);
  mocks.listAuditEvents.mockResolvedValue({
    items: [{ id: 'audit-1', action: 'auth.login' }],
    summary: { periodDays: 30, total: 1, deleted: 0, sent: 0, changed: 0, logins: 1, suspiciousLogins: 0 },
    total: 1, limit: 20, offset: 0,
  });
});

describe('access users and role bundle routes', () => {
  it('returns real KPI inputs, last activity and policy version for an owner', async () => {
    const response = await request('/api/access/users?lineAccountId=account-a&status=active');
    expect(response.status).toBe(200);
    const body = await response.json() as { data: { items: Array<Record<string, unknown>>; summary: Record<string, unknown> } };
    expect(body.data.items[0]).toMatchObject({
      email: 'yamamoto@example.com', lastActionAt: '2026-09-02T00:00:00.000Z', policyVersion: 3,
    });
    expect(body.data.summary).toMatchObject({ active: 1, mfaRate: 100 });
    expect(mocks.listAccessUsers).toHaveBeenCalledWith(env.DB, expect.objectContaining({
      tenantId: 'tenant-a', lineAccountId: 'account-a', status: 'active', includeEmailInSearch: true,
    }));
  });

  it('masks email for permitted staff without the field permission', async () => {
    const response = await request('/api/access/users', 'staff', ['access.user.view']);
    expect(response.status).toBe(200);
    const body = await response.json() as { data: { items: Array<{ email: string }> } };
    expect(body.data.items[0].email).toBe('y***@example.com');
    expect(mocks.listAccessUsers).toHaveBeenCalledWith(env.DB, expect.objectContaining({ includeEmailInSearch: false }));
  });

  it('returns all fixed bundles with actual assigned counts', async () => {
    const response = await request('/api/access/roles?lineAccountId=account-a');
    expect(response.status).toBe(200);
    const body = await response.json() as { data: { items: Array<{ id: string; assignedUserCount: number }>; totalBundles: number } };
    expect(body.data.totalBundles).toBe(5);
    expect(body.data.items.find((item) => item.id === 'administrator')?.assignedUserCount).toBe(1);
  });

  it('rejects staff without explicit access permission', async () => {
    const response = await request('/api/access/users', 'staff');
    expect(response.status).toBe(403);
    expect(mocks.listAccessUsers).not.toHaveBeenCalled();
  });

  it('hides an account outside the actor scope', async () => {
    const response = await request('/api/access/users?lineAccountId=account-b');
    expect(response.status).toBe(404);
    expect(mocks.listAccessUsers).not.toHaveBeenCalled();
  });

  it('returns an empty state without inventing KPI values', async () => {
    mocks.listAccessUsers.mockResolvedValue({
      ...userResult, items: [], total: 0,
      summary: { ...userResult.summary, active: 0, mfaEnabled: 0, mfaRate: null, roleCounts: {
        administrator: 0, operations: 0, reception: 0, view_only: 0, custom: 0,
      } },
    });
    const response = await request('/api/access/users');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { items: [], summary: { active: 0, mfaRate: null } } });
  });

  it('returns a safe error when the database fails', async () => {
    mocks.listAccessUsers.mockRejectedValue(new Error('SQL and customer@example.com'));
    const response = await request('/api/access/users');
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('customer@example.com');
  });
});

describe('audit event route', () => {
  it('passes tenant, account and search filters to the common audit reader', async () => {
    const response = await request('/api/audit/events?lineAccountId=account-a&category=business&result=failed&query=配信');
    expect(response.status).toBe(200);
    expect(mocks.listAuditEvents).toHaveBeenCalledWith(env.DB, expect.objectContaining({
      tenantId: 'tenant-a', includeTenantWide: true, lineAccountId: 'account-a',
      category: 'business', result: 'failed', query: '配信',
    }));
  });

  it('requires a separate audit permission for staff', async () => {
    expect((await request('/api/audit/events', 'staff', ['access.user.view'])).status).toBe(403);
    expect((await request('/api/audit/events', 'staff', ['access.audit.view'])).status).toBe(200);
  });

  it('rejects invalid dates before querying the database', async () => {
    const response = await request('/api/audit/events?from=not-a-date');
    expect(response.status).toBe(400);
    expect(mocks.listAuditEvents).not.toHaveBeenCalled();
  });

  it('returns a safe error when audit search fails', async () => {
    mocks.listAuditEvents.mockRejectedValue(new Error('raw database detail'));
    const response = await request('/api/audit/events');
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('raw database detail');
  });
});
