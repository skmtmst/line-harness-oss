import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const getVisibleLineAccountScope = vi.hoisted(() => vi.fn());

vi.mock('../services/account-access.js', () => ({ getVisibleLineAccountScope }));
vi.mock('@line-crm/line-sdk', () => ({ LineClient: vi.fn() }));

const { conversations } = await import('./conversations.js');
const { profileRefresh } = await import('./profile-refresh.js');

type Query = { sql: string; bindings: unknown[] };

function database(records: Query[]): D1Database {
  return {
    prepare(sql: string) {
      const record = { sql, bindings: [] as unknown[] };
      records.push(record);
      const statement = {
        bind(...bindings: unknown[]) {
          record.bindings = bindings;
          return statement;
        },
        async all() {
          return { results: [] };
        },
        async first() {
          if (sql.includes('FROM friends f LEFT JOIN line_accounts')) {
            return {
              id: 'friend-a',
              line_user_id: 'Ua',
              display_name: 'Aさん',
              is_following: 1,
              line_account_id: 'account-a',
              line_account_name: 'A店',
            };
          }
          return { total: 0 };
        },
        async run() {
          return { success: true, meta: { changes: 0 } };
        },
      };
      return statement;
    },
  } as unknown as D1Database;
}

function app(route: typeof conversations | typeof profileRefresh) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', {
      id: 'owner-a',
      name: 'Owner',
      role: 'owner',
      readOnly: false,
      tenantId: 'tenant-a',
    });
    return next();
  });
  instance.route('/', route);
  return instance;
}

beforeEach(() => {
  vi.clearAllMocks();
  getVisibleLineAccountScope.mockResolvedValue({
    accounts: [{ id: 'account-a' }],
    allowedAccountIds: ['account-a'],
    canSeeUnassigned: false,
    ids: ['account-a'],
  });
});

describe('conversation list limits', () => {
  it.each([
    ['-1', 50],
    ['not-a-number', 50],
    ['999999', 200],
  ])('normalizes list limit=%s to %i', async (raw, expected) => {
    const records: Query[] = [];
    const response = await app(conversations).request(`/api/conversations?limit=${raw}`, {}, {
      DB: database(records),
    });

    expect(response.status).toBe(200);
    const query = records.find((record) => record.sql.includes('LIMIT ? OFFSET ?'));
    expect(query?.bindings.slice(-2)).toEqual([expected, 0]);
    expect(query?.bindings).not.toContain(-1);
  });

  it.each([
    ['-1', 50],
    ['not-a-number', 50],
    ['999999', 200],
  ])('normalizes history limit=%s to %i', async (raw, expected) => {
    const records: Query[] = [];
    const response = await app(conversations).request(
      `/api/conversations/friend-a?limit=${raw}`,
      {},
      { DB: database(records) },
    );

    expect(response.status).toBe(200);
    const query = records.find((record) => record.sql.includes('FROM messages_log WHERE friend_id'));
    expect(query?.bindings.at(-1)).toBe(expected);
    expect(query?.bindings).not.toContain(-1);
  });
});

describe('profile refresh operation limits', () => {
  it.each([
    ['-1', 100],
    ['not-a-number', 100],
    ['999999', 500],
  ])('normalizes refresh-profiles limit=%s to %i', async (raw, expected) => {
    const records: Query[] = [];
    const response = await app(profileRefresh).request(
      `/api/admin/refresh-profiles?limit=${raw}`,
      { method: 'POST' },
      { DB: database(records), LINE_CHANNEL_ACCESS_TOKEN: 'token' },
    );

    expect(response.status).toBe(200);
    const query = records.find((record) => record.sql.includes('LIMIT ? OFFSET ?'));
    expect(query?.bindings.slice(-2)).toEqual([expected, 0]);
    expect(query?.bindings).not.toContain(-1);
  });

  it.each([
    ['-1', 20],
    ['not-a-number', 20],
    ['999999', 100],
  ])('normalizes recent-messages limit=%s to %i', async (raw, expected) => {
    const records: Query[] = [];
    const response = await app(profileRefresh).request(
      `/api/admin/recent-messages?limit=${raw}`,
      {},
      { DB: database(records) },
    );

    expect(response.status).toBe(200);
    const query = records.find((record) => record.sql.includes('FROM messages_log ml'));
    expect(query?.bindings).toEqual([expected]);
    expect(query?.bindings).not.toContain(-1);
  });
});
