import { describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const computeUnansweredInbox = vi.hoisted(() => vi.fn(async () => ({
  total: 1, page: 1, pageSize: 5,
  rows: [{
    friendId: 'friend-1', displayName: '担当顧客', pictureUrl: null,
    accountId: 'account-1', accountName: '担当アカウント',
    lastIncomingAt: '2026-08-21T01:00:00.000Z', lastManualAt: null,
    lastMachineAt: null, lastIncomingType: 'text', lastIncomingContent: '相談です',
  }],
})));
const countUnanswered = vi.hoisted(() => vi.fn(async () => ({
  total: 0, byAccount: [], oldestWaitMinutes: null,
})));
const getVisibleLineAccountScope = vi.hoisted(() => vi.fn());

vi.mock('../services/unanswered-inbox.js', () => ({
  computeUnansweredInbox,
  countUnanswered,
}));

vi.mock('../services/account-access.js', () => ({
  getVisibleLineAccountScope,
}));

import { supportInbox } from './support-inbox.js';

function app() {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', {
      id: 'staff-1', name: '担当者', role: 'staff', readOnly: false,
      permissionKeys: ['/chats'], assignedLineAccountId: 'account-1',
      canAccessDescendantAccounts: false,
    });
    return next();
  });
  app.route('/', supportInbox);
  return app;
}

function db() {
  const statement = {
    bind() { return statement; },
    all: async () => ({ results: [] }),
    first: async () => ({ open_count: 0, unread_count: 0, oldest_at: null }),
  };
  return { prepare: () => statement } as unknown as D1Database;
}

test('default tenant always filters LINE accounts and can read unassigned email threads', async () => {
  getVisibleLineAccountScope.mockResolvedValue({
    accounts: [{ id: 'account-1' }, { id: 'account-2' }],
    ids: ['account-1', 'account-2'],
    allowedAccountIds: ['account-1', 'account-2'],
    canSeeUnassigned: true,
  });
  const response = await app().request('/api/support/inbox?status=open&limit=5', {}, {
    DB: db(),
  } as Env['Bindings']);
  expect(response.status).toBe(200);
  expect(computeUnansweredInbox).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      allowedAccountIds: ['account-1', 'account-2'], canSeeUnassigned: true,
    }),
  );
  const body = await response.json() as { data: { items: Array<{ channel: string }>; summary: { email: number } } };
  expect(body.data.items.map((item) => item.channel)).toEqual(['line']);
  expect(body.data.summary.email).toBe(0);
});

test('non-default tenant cannot read unassigned email threads', async () => {
  getVisibleLineAccountScope.mockResolvedValue({
    accounts: [{ id: 'account-2' }], ids: ['account-2'],
    allowedAccountIds: ['account-2'], canSeeUnassigned: false,
  });
  const response = await app().request('/api/support/inbox?status=open&limit=5', {}, {
    DB: db(),
  } as Env['Bindings']);
  expect(response.status).toBe(200);
  expect(computeUnansweredInbox).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.objectContaining({ allowedAccountIds: ['account-2'], canSeeUnassigned: false }),
  );
  const body = await response.json() as { data: { items: Array<{ channel: string }> } };
  expect(body.data.items.every((item) => item.channel === 'line')).toBe(true);
});

test('a selected LINE account never receives unassigned legacy email threads', async () => {
  getVisibleLineAccountScope.mockResolvedValue({
    accounts: [{ id: 'account-1' }], ids: ['account-1'],
    allowedAccountIds: ['account-1'], canSeeUnassigned: true,
  });
  const failOnEmailQuery = {
    prepare: () => {
      throw new Error('email query must not run for a selected LINE account');
    },
  } as unknown as D1Database;
  const response = await app().request(
    '/api/support/inbox?channel=email&status=all&lineAccountId=account-1',
    {},
    { DB: failOnEmailQuery } as Env['Bindings'],
  );
  expect(response.status).toBe(200);
  const body = await response.json() as { data: { items: unknown[]; summary: { email: number } } };
  expect(body.data.items).toEqual([]);
  expect(body.data.summary.email).toBe(0);
});

test('tenant with no accounts gets an empty LINE filter without errors', async () => {
  getVisibleLineAccountScope.mockResolvedValue({
    accounts: [], ids: [], allowedAccountIds: [], canSeeUnassigned: false,
  });
  computeUnansweredInbox.mockResolvedValueOnce({ total: 0, page: 1, pageSize: 5, rows: [] });
  const response = await app().request('/api/support/inbox?status=open&limit=5', {}, {
    DB: db(),
  } as Env['Bindings']);
  expect(response.status).toBe(200);
  expect(computeUnansweredInbox).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.objectContaining({ allowedAccountIds: [], canSeeUnassigned: false }),
  );
});
