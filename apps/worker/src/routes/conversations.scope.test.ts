import { beforeEach, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const getVisibleLineAccountScope = vi.hoisted(() => vi.fn());

vi.mock('../services/account-access.js', () => ({ getVisibleLineAccountScope }));

import { conversations } from './conversations.js';

function requestList() {
  const sqlCalls: Array<{ sql: string; bindings: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      const call = { sql, bindings: [] as unknown[] };
      sqlCalls.push(call);
      const statement = {
        bind(...bindings: unknown[]) {
          call.bindings = bindings;
          return statement;
        },
        all: async () => ({ results: [] }),
        first: async () => ({ total: 0 }),
      };
      return statement;
    },
  } as unknown as D1Database;
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', {
      id: 'staff', name: 'Staff', role: 'staff', readOnly: false,
      assignedLineAccountId: null, canAccessDescendantAccounts: false,
    });
    return next();
  });
  app.route('/', conversations);
  return {
    sqlCalls,
    response: app.request('/api/conversations', {}, { DB: db } as Env['Bindings']),
  };
}

beforeEach(() => getVisibleLineAccountScope.mockReset());

test('default tenant list filters its accounts and includes unassigned rows', async () => {
  getVisibleLineAccountScope.mockResolvedValue({
    accounts: [], ids: ['a1'], allowedAccountIds: ['a1'], canSeeUnassigned: true,
  });
  const run = requestList();
  expect((await run.response).status).toBe(200);
  const listQuery = run.sqlCalls.find((call) => call.sql.includes('SELECT\n        f.id AS friend_id'));
  expect(listQuery?.sql).toMatch(/line_account_id IN \(\?\).*line_account_id IS NULL/s);
  expect(listQuery?.bindings).toContain('a1');
});

test('non-default tenant list filters its accounts and excludes unassigned rows', async () => {
  getVisibleLineAccountScope.mockResolvedValue({
    accounts: [], ids: ['b1'], allowedAccountIds: ['b1'], canSeeUnassigned: false,
  });
  const run = requestList();
  expect((await run.response).status).toBe(200);
  const listQuery = run.sqlCalls.find((call) => call.sql.includes('SELECT\n        f.id AS friend_id'));
  expect(listQuery?.sql).toMatch(/line_account_id IN \(\?\)/);
  expect(listQuery?.sql).not.toMatch(/line_account_id IS NULL/);
  expect(listQuery?.bindings).toContain('b1');
});

test('tenant with no accounts receives an empty list filter without errors', async () => {
  getVisibleLineAccountScope.mockResolvedValue({
    accounts: [], ids: [], allowedAccountIds: [], canSeeUnassigned: false,
  });
  const run = requestList();
  expect((await run.response).status).toBe(200);
  const listQuery = run.sqlCalls.find((call) => call.sql.includes('SELECT\n        f.id AS friend_id'));
  expect(listQuery?.sql).toContain('AND 1 = 0');
});
