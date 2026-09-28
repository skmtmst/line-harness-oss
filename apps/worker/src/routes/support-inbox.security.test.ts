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

  // アカウント選択中も、見られない人にメールは出ない。
  const selected = await app().request(
    '/api/support/inbox?channel=email&status=all&lineAccountId=account-2', {}, {
      DB: db(),
    } as Env['Bindings']);
  expect(selected.status).toBe(200);
  const selectedBody = await selected.json() as { data: { items: unknown[] } };
  expect(selectedBody.data.items).toEqual([]);
});

test('a selected LINE account still receives unassigned legacy email threads when visible', async () => {
  getVisibleLineAccountScope.mockResolvedValue({
    accounts: [{ id: 'account-1' }], ids: ['account-1'],
    allowedAccountIds: ['account-1'], canSeeUnassigned: true,
  });
  // メールはLINEアカウントに所属しない。選択中のアカウントがあっても、
  // 未割り当てが見える担当者には一覧を返す（件数の数え方と同じ）。
  const at = '2026-08-21T01:00:00.000Z';
  const statement = {
    bind() { return statement; },
    all: async () => ({
      results: [{
        id: 'thread-1',
        customer_email: 'customer@example.com',
        customer_name: '顧客',
        subject: '件名',
        status: 'unread',
        revision: 1,
        assigned_staff_id: null,
        assigned_staff_name: null,
        last_message_at: at,
        last_incoming_at: at,
        last_outgoing_at: null,
        preview: '本文',
        total_count: 1,
        unread_count: 1,
        is_unread_for_staff: 1,
      }],
    }),
    first: async () => null,
  };
  const emailDb = { prepare: () => statement } as unknown as D1Database;
  const response = await app().request(
    '/api/support/inbox?channel=email&status=all&lineAccountId=account-1',
    {},
    { DB: emailDb } as Env['Bindings'],
  );
  expect(response.status).toBe(200);
  const body = await response.json() as {
    data: { items: Array<{ channel: string }>; summary: { email: number; total: number } };
  };
  expect(body.data.items.map((item) => item.channel)).toEqual(['email']);
  expect(body.data.summary.email).toBe(1);
  expect(body.data.summary.total).toBe(1);
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
