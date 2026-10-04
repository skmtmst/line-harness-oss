import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { toJstString } from '@line-crm/db';
import type { Env } from '../index.js';

vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: vi.fn(async () => true),
  getVisibleLineAccountScope: vi.fn(async () => ({ allowedAccountIds: [], canSeeUnassigned: true })),
}));

import { adPlatforms } from './ad-platforms.js';

function app() {
  const hono = new Hono<Env>();
  hono.use('*', async (c, next) => {
    c.set('staff', { id: 'owner-1', name: 'Owner', role: 'owner', readOnly: false, tenantId: 'tenant-1' });
    return next();
  });
  hono.route('/', adPlatforms);
  return hono;
}

function seed() {
  const testDb = createTestD1();
  testDb.raw.prepare("INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, is_active) VALUES ('a1', 'channel-a', 'A', 'token', 'secret', 1)").run();
  testDb.raw.prepare("INSERT INTO ad_platforms (id, name, line_account_id, config) VALUES ('p1', 'meta', 'a1', '{}')").run();
  testDb.raw.prepare("INSERT INTO friends (id, line_user_id, line_account_id) VALUES ('f1', 'U1', 'a1')").run();
  const insert = testDb.raw.prepare(
    'INSERT INTO ad_conversion_outbox (id, ad_platform_id, friend_id, event_name, idempotency_key, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const when = (daysAgo: number) => toJstString(new Date(Date.now() - daysAgo * 86_400_000));
  insert.run('failed-recent', 'p1', 'f1', 'Purchase', 'key-1', 'failed', when(5), when(5));
  insert.run('failed-old', 'p1', 'f1', 'Purchase', 'key-2', 'failed', when(91), when(91));
  insert.run('sent-row', 'p1', 'f1', 'Purchase', 'key-3', 'sent', when(5), when(5));
  return testDb;
}

describe('POST /api/ad-platforms/outbox/:id/retry', () => {
  it('puts a failed row back to pending with the same idempotency key', async () => {
    const testDb = seed();
    const response = await app().request('/api/ad-platforms/outbox/failed-recent/retry', {
      method: 'POST',
    }, {
      DB: testDb.db,
    } as Env['Bindings']);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, data: { id: 'failed-recent', status: 'pending' } });
    const row = testDb.raw.prepare('SELECT status, idempotency_key FROM ad_conversion_outbox WHERE id = ?').get('failed-recent') as { status: string; idempotency_key: string };
    expect(row.status).toBe('pending');
    expect(row.idempotency_key).toBe('key-1');
  });

  it('rejects a row that did not fail', async () => {
    const testDb = seed();
    const response = await app().request('/api/ad-platforms/outbox/sent-row/retry', {
      method: 'POST',
    }, {
      DB: testDb.db,
    } as Env['Bindings']);
    expect(response.status).toBe(422);
    const body = await response.json() as { success: boolean; error: string };
    expect(body.success).toBe(false);
  });

  it('rejects a failed row older than 90 days', async () => {
    const testDb = seed();
    const response = await app().request('/api/ad-platforms/outbox/failed-old/retry', {
      method: 'POST',
    }, {
      DB: testDb.db,
    } as Env['Bindings']);
    expect(response.status).toBe(422);
    const body = await response.json() as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain('90日');
  });

  it('returns 404 for an unknown row', async () => {
    const testDb = seed();
    const response = await app().request('/api/ad-platforms/outbox/no-such-row/retry', {
      method: 'POST',
    }, {
      DB: testDb.db,
    } as Env['Bindings']);
    expect(response.status).toBe(404);
  });
});
