import { describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

vi.mock('@line-crm/db', () => ({
  getLineAccounts: vi.fn(async () => [
    { id: 'account-1', parent_line_account_id: null },
    { id: 'account-2', parent_line_account_id: null },
  ]),
}));

import { conversations } from './conversations.js';

function dbWithFriend(lineAccountId: string) {
  return {
    prepare() {
      const statement = {
        bind() { return statement; },
        first: async () => ({
          id: 'friend-2', line_user_id: 'U22222222222222222222222222222222',
          display_name: '別アカウント顧客', is_following: 1,
          line_account_id: lineAccountId, line_account_name: '別アカウント',
        }),
        all: async () => ({ results: [] }),
      };
      return statement;
    },
  } as unknown as D1Database;
}

function app() {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', {
      id: 'staff-1', name: '担当者', role: 'staff', readOnly: false,
      assignedLineAccountId: 'account-1', canAccessDescendantAccounts: false,
    });
    return next();
  });
  instance.route('/', conversations);
  return instance;
}

test('restricted staff cannot read another account transcript by friend id', async () => {
  const response = await app().request('/api/conversations/friend-2', {}, {
    DB: dbWithFriend('account-2'),
  } as Env['Bindings']);
  expect(response.status).toBe(404);
});
