import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { createTestD1 } from '../test-utils/d1-sqlite.js';

const access = vi.hoisted(() => ({ canAccess: vi.fn(async () => true) }));
vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: access.canAccess,
}));

const { featureSettings } = await import('./feature-settings.js');

function app() {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', {
      id: 'owner',
      name: 'Owner',
      role: 'owner',
      readOnly: false,
      tenantId: 'tenant-a',
    });
    await next();
  });
  instance.route('/', featureSettings);
  return instance;
}

beforeEach(() => {
  vi.clearAllMocks();
  access.canAccess.mockResolvedValue(true);
});

describe('feature settings scope and versioning', () => {
  it.each(['GET', 'PUT'] as const)('%s rejects an inaccessible account before DB reads', async (method) => {
    access.canAccess.mockResolvedValue(false);
    const prepare = vi.fn();
    const response = await app().request('/api/settings/features?account_id=other', {
      method,
      headers: { 'content-type': 'application/json' },
      body: method === 'PUT'
        ? JSON.stringify({ expectedVersion: 0, features: {} })
        : undefined,
    }, { DB: { prepare } as unknown as D1Database });

    expect(response.status).toBe(403);
    expect(prepare).not.toHaveBeenCalled();
  });

  it('saves one bundle row and returns 409 to a stale writer', async () => {
    const testDb = createTestD1();
    try {
      const first = await app().request('/api/settings/features?account_id=account-1', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          expectedVersion: 0,
          features: { scenarios: false },
          sidebarItemOrder: { delivery: ['broadcasts', 'scenarios'] },
        }),
      }, { DB: testDb.db, RESTAURANT_TEST_ENABLED: 'true' });
      expect(first.status).toBe(200);
      expect(await first.json()).toMatchObject({ success: true, data: { version: 1 } });

      const stale = await app().request('/api/settings/features?account_id=account-1', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedVersion: 0, features: { scenarios: true } }),
      }, { DB: testDb.db, RESTAURANT_TEST_ENABLED: 'true' });
      expect(stale.status).toBe(409);

      const loaded = await app().request(
        '/api/settings/features?account_id=account-1',
        {},
        { DB: testDb.db, RESTAURANT_TEST_ENABLED: 'true' },
      );
      expect(await loaded.json()).toMatchObject({
        success: true,
        data: {
          version: 1,
          features: { scenarios: false },
          sidebarItemOrder: { delivery: ['broadcasts', 'scenarios'] },
        },
      });
    } finally {
      testDb.raw.close();
    }
  });

  it('rejects duplicate ordering and non-boolean feature values', async () => {
    const testDb = createTestD1();
    try {
      const duplicate = await app().request('/api/settings/features?account_id=account-1', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          expectedVersion: 0,
          sidebarItemOrder: { delivery: ['scenarios', 'scenarios'] },
        }),
      }, { DB: testDb.db, RESTAURANT_TEST_ENABLED: 'true' });
      expect(duplicate.status).toBe(400);

      const invalid = await app().request('/api/settings/features?account_id=account-1', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedVersion: 0, features: { scenarios: 'off' } }),
      }, { DB: testDb.db, RESTAURANT_TEST_ENABLED: 'true' });
      expect(invalid.status).toBe(400);
    } finally {
      testDb.raw.close();
    }
  });
});
