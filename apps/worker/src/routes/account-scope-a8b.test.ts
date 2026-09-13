import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { profileRefresh } from './profile-refresh.js';
import { liffRoutes } from './liff.js';

const getVisibleLineAccountScope = vi.hoisted(() => vi.fn());

vi.mock('../services/account-access.js', () => ({ getVisibleLineAccountScope }));
vi.mock('@line-crm/line-sdk', () => ({ LineClient: vi.fn() }));

type RecordedQuery = { sql: string; binds: unknown[] };

function database(records: RecordedQuery[]): D1Database {
  return {
    prepare(sql: string) {
      const record = { sql, binds: [] as unknown[] };
      records.push(record);
      const statement = {
        bind(...binds: unknown[]) { record.binds = binds; return statement; },
        async all() { return { results: [] }; },
        async first() { return { count: 0 }; },
        async run() { return { success: true }; },
      };
      return statement;
    },
  } as unknown as D1Database;
}

function app(route: typeof profileRefresh | typeof liffRoutes) {
  const instance = new Hono();
  instance.use('*', async (c, next) => {
    c.set('staff' as never, { id: 'owner', role: 'owner', tenantId: 'tenant-a' } as never);
    await next();
  });
  instance.route('/', route);
  return instance;
}

describe('A-8b omitted account scope', () => {
  beforeEach(() => {
    getVisibleLineAccountScope.mockReset();
    getVisibleLineAccountScope.mockResolvedValue({
      accounts: [], allowedAccountIds: ['account-a', 'account-b'], canSeeUnassigned: false,
      ids: ['account-a', 'account-b'],
    });
  });

  test('refresh-profiles scopes its selection before any LINE request', async () => {
    const records: RecordedQuery[] = [];
    const response = await app(profileRefresh).request('/api/admin/refresh-profiles', { method: 'POST' }, {
      DB: database(records), LINE_CHANNEL_ACCESS_TOKEN: 'default-token',
    });

    expect(response.status).toBe(200);
    expect(records).toHaveLength(1);
    expect(records[0].sql).toContain('f.line_account_id IN (SELECT value FROM json_each(?))');
    expect(records[0].binds).toEqual(['["account-a","account-b"]', 100, 0]);
  });

  test('ref-summary applies the same scope and binds to the list and both totals', async () => {
    const records: RecordedQuery[] = [];
    const response = await app(liffRoutes).request('/api/analytics/ref-summary', {}, {
      DB: database(records),
    });

    expect(response.status).toBe(200);
    expect(records).toHaveLength(3);
    for (const record of records) {
      expect(record.sql).toContain('f.line_account_id IN (?,?)');
      expect(record.binds).toEqual(['account-a', 'account-b']);
    }
  });

  test('ref detail limits personal names to the visible account scope', async () => {
    const records: RecordedQuery[] = [];
    const response = await app(liffRoutes).request('/api/analytics/ref/campaign-a', {}, {
      DB: database(records),
    });

    expect(response.status).toBe(200);
    const friendQuery = records[1];
    expect(friendQuery.sql).toContain('f.line_account_id IN (?,?)');
    expect(friendQuery.binds).toEqual(['campaign-a', 'campaign-a', 'account-a', 'account-b']);
  });

  test.each([
    '/api/analytics/ref-summary?lineAccountId=account-hidden',
    '/api/analytics/ref/campaign-a?lineAccountId=account-hidden',
  ])('explicit account selection rejects an invisible account before any analytics query: %s', async (path) => {
    const records: RecordedQuery[] = [];
    const response = await app(liffRoutes).request(path, {}, { DB: database(records) });

    expect(response.status).toBe(403);
    expect(records).toHaveLength(0);
  });

  test('explicit visible account keeps the existing filtered response', async () => {
    const records: RecordedQuery[] = [];
    const response = await app(liffRoutes).request(
      '/api/analytics/ref-summary?lineAccountId=account-a', {}, { DB: database(records) },
    );

    expect(response.status).toBe(200);
    expect(records).toHaveLength(3);
    expect(records.every((record) => record.sql.includes('f.line_account_id = ?'))).toBe(true);
    expect(records.every((record) => record.binds[0] === 'account-a')).toBe(true);
  });
});
