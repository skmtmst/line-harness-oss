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

vi.mock('../services/unanswered-inbox.js', () => ({
  computeUnansweredInbox,
  countUnanswered: vi.fn(),
}));

vi.mock('../services/account-access.js', () => ({
  getVisibleLineAccountScope: vi.fn(async () => ({
    accounts: [{ id: 'account-1' }], ids: ['account-1'], restricted: true,
  })),
}));

import { supportInbox } from './support-inbox.js';

test('restricted support inbox passes its account scope and hides unattributed email', async () => {
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
  const response = await app.request('/api/support/inbox?status=open&limit=5', {}, {
    DB: {} as D1Database,
  } as Env['Bindings']);
  expect(response.status).toBe(200);
  expect(computeUnansweredInbox).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ allowedAccountIds: ['account-1'] }),
  );
  const body = await response.json() as { data: { items: Array<{ channel: string }>; summary: { email: number } } };
  expect(body.data.items.map((item) => item.channel)).toEqual(['line']);
  expect(body.data.summary.email).toBe(0);
});
