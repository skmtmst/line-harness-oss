import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { DEFAULT_TENANT_ID } from '../lib/tenant.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { tenants } from './tenants.js';

let testDb: SqliteD1;

function app(staff: AuthenticatedStaff) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', staff);
    return next();
  });
  instance.route('/', tenants);
  return instance;
}

function environment(): Env['Bindings'] {
  return { DB: testDb.db } as Env['Bindings'];
}

const operator = (role: AuthenticatedStaff['role']): AuthenticatedStaff => ({
  id: `${role}-1`,
  name: role,
  role,
  readOnly: false,
  tenantId: DEFAULT_TENANT_ID,
});

beforeEach(() => {
  testDb = createTestD1();
  testDb.raw.prepare(`INSERT INTO line_accounts
    (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?)`).run(
      'account-1', 'channel-1', '店舗A', 'sensitive-token', 'sensitive-secret', DEFAULT_TENANT_ID,
    );
  testDb.raw.prepare(`INSERT INTO staff_members
    (id, name, role, api_key, tenant_id) VALUES (?, ?, ?, ?, ?)`).run(
      'owner-1', 'Owner', 'owner', 'owner-key', DEFAULT_TENANT_ID,
    );
});

describe('tenant boundary preview', () => {
  it.each(['owner', 'admin'] as const)('%sは移行境界を読み取れる', async (role) => {
    const response = await app(operator(role)).request(
      '/api/tenants/boundary-preview',
      {},
      environment(),
    );
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      success: true,
      data: {
        staffTenantId: DEFAULT_TENANT_ID,
        visibleNow: 1,
        visibleIfEnforced: 1,
        wouldLose: [],
        accountsWithoutTenant: 0,
        staffWithoutTenant: 0,
      },
    });
    expect(text).not.toContain('sensitive-token');
    expect(text).not.toContain('sensitive-secret');
    expect(text).not.toContain('channel-1');
  });

  it('staffは移行境界を読み取れない', async () => {
    const response = await app(operator('staff')).request(
      '/api/tenants/boundary-preview',
      {},
      environment(),
    );
    expect(response.status).toBe(403);
  });
});
