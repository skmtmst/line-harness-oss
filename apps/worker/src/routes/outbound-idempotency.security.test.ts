import { describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

vi.mock('../services/account-access.js', () => ({
  getVisibleLineAccountScope: vi.fn(async () => ({
    accounts: [], ids: [], allowedAccountIds: [], canSeeUnassigned: true,
  })),
}));

import { chats } from './chats.js';
import { friends } from './friends.js';
import { supportInbox } from './support-inbox.js';

function appWith(route: Hono<Env>): Hono<Env> {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', {
      id: 'staff-1',
      name: '担当者',
      role: 'staff',
      readOnly: false,
      permissionKeys: ['/chats', '/tags'],
      assignedLineAccountId: null,
      canAccessDescendantAccounts: false,
    });
    return next();
  });
  app.route('/', route);
  return app;
}

describe('manual outbound routes fail closed without an idempotency key', () => {
  test.each([
    ['LINE chat', appWith(chats), '/api/chats/chat-1/send'],
    ['LINE friend', appWith(friends), '/api/friends/friend-1/messages'],
    ['support email', appWith(supportInbox), '/api/support/email/threads/thread-1/reply'],
  ])('%s', async (_label, app, path) => {
    const response = await app.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'hello', content: 'hello' }),
    }, { DB: {} as D1Database } as Env['Bindings']);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ success: false });
  });
});
