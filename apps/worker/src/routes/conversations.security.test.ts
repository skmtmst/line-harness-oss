import { describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import type { Env } from '../index.js';

vi.mock('@line-crm/db', () => ({
  getLineAccounts: vi.fn(async () => [
    { id: 'account-1', parent_line_account_id: null, tenant_id: DEFAULT_TENANT_ID },
    { id: 'account-2', parent_line_account_id: null, tenant_id: DEFAULT_TENANT_ID },
    { id: 'account-b', parent_line_account_id: null, tenant_id: 'tenant-B' },
  ]),
  getStaffById: vi.fn(async () => ({ account_scope: 'all' })),
  getStaffAccountScopeIds: vi.fn(async () => []),
}));

import { conversations } from './conversations.js';

function dbWithFriend(lineAccountId: string | null) {
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

function app(tenantId?: string) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', {
      id: 'staff-1', name: '担当者', role: 'staff', readOnly: false,
      assignedLineAccountId: 'account-1', canAccessDescendantAccounts: false,
      tenantId,
    });
    return next();
  });
  instance.route('/', conversations);
  return instance;
}

test('staff can read another account transcript in the same organization', async () => {
  const response = await app().request('/api/conversations/friend-2', {}, {
    DB: dbWithFriend('account-2'),
  } as Env['Bindings']);
  expect(response.status).toBe(200);
});

test('default tenant can read an unassigned transcript', async () => {
  const response = await app().request('/api/conversations/friend-2', {}, {
    DB: dbWithFriend(null),
  } as Env['Bindings']);
  expect(response.status).toBe(200);
});

test('non-default tenant cannot read an unassigned transcript', async () => {
  const response = await app('tenant-B').request('/api/conversations/friend-2', {}, {
    DB: dbWithFriend(null),
  } as Env['Bindings']);
  expect(response.status).toBe(404);
});
