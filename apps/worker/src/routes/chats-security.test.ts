import { afterAll, describe, expect, test } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../worker-env.js';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { chats } from './chats.js';

const fixture = createTestD1();
fixture.raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('a','a','店','x','x');
INSERT INTO staff_members(id,name,email,role,api_key,permission_keys) VALUES ('staff-1','担当者','private@example.com','staff','key','["/chats"]');`);
afterAll(() => fixture.raw.close());

describe('GET /api/operators response', () => {
  const appFor = (role: 'owner' | 'admin' | 'staff' | null) => {
    const app = new Hono<Env>();
    if (role) app.use('*', async (c, next) => { c.set('staff', { id: 'staff-1', name: '担当者', role, readOnly: false }); await next(); });
    app.route('/', chats); return app;
  };
  test('returns only fields needed by the inbox assignee picker', async () => {
    const response = await appFor('staff').request('/api/operators?lineAccountId=a', {}, { DB: fixture.db });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: [{ id: 'staff:staff-1', name: '担当者' }] });
  });
  test('rejects an unauthenticated operator-list request', async () => {
    const response = await appFor(null).request('/api/operators', {}, { DB: fixture.db });
    expect(response.status).toBe(403);
  });
});
