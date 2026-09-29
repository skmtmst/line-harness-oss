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

function statement(value: { first?: unknown; results?: unknown[] }) {
  const result = {
    bind: vi.fn(),
    first: vi.fn(async () => value.first),
    all: vi.fn(async () => ({ results: value.results ?? [] })),
  };
  result.bind.mockReturnValue(result);
  return result;
}

describe('GET /api/ad-platforms/logs', () => {
  it('媒体横断の履歴を共通一覧契約で返しlimitを200に丸める', async () => {
    const count = statement({ first: { total: 501 } });
    const summary = statement({ first: { sent: 12, pending: 2, failed: 1 } });
    const rows = statement({ results: [{
      id: 'log-1', ad_platform_id: 'platform-1', friend_id: 'friend-1', event_name: 'Purchase',
      click_id: 'click-1', click_id_type: 'gclid', status: 'success', error_message: null,
      created_at: '2026-09-08T10:00:00.000',
    }] });
    const prepare = vi.fn()
      .mockReturnValueOnce(count)
      .mockReturnValueOnce(summary)
      .mockReturnValueOnce(rows);
    const app = new Hono<Env>();
    app.use('*', async (c, next) => {
      c.set('staff', { id: 'owner-1', name: 'Owner', role: 'owner', readOnly: false, tenantId: 'tenant-1' });
      return next();
    });
    app.route('/', adPlatforms);

    const response = await app.request('/api/ad-platforms/logs?page=2&limit=999999&status=sent', {}, {
      DB: { prepare } as unknown as D1Database,
    } as Env['Bindings']);
    expect(response.status).toBe(200);
    expect(rows.bind).toHaveBeenCalledWith(200, 200);
    expect(await response.json()).toMatchObject({ data: {
      items: [{ id: 'log-1', adPlatformId: 'platform-1', status: 'success' }],
      total: 501, page: 2, limit: 200,
      summary: { sentLast30Days: 12, pendingLast30Days: 2, failedLast30Days: 1 },
      sort: [{ field: 'createdAt', direction: 'desc' }, { field: 'id', direction: 'desc' }],
    } });
  });

  it('R278: 30日内の送信数は複数媒体を合算し、期間外25件・ページ・検索条件で変わらない', async () => {
    const testDb = createTestD1();
    testDb.raw.prepare("INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, is_active) VALUES ('a1', 'channel-a', 'A', 'token', 'secret', 1), ('a2', 'channel-b', 'B', 'token', 'secret', 1)").run();
    testDb.raw.prepare("INSERT INTO ad_platforms (id, name, line_account_id, config) VALUES ('p1', 'meta', 'a1', '{\"sent_count\":99}'), ('p2', 'google', 'a1', '{\"sent_count\":3}'), ('p3', 'x', 'a2', '{}')").run();
    const when = (days: number, minutes = 0) => toJstString(new Date(Date.now() - days * 86_400_000 + minutes * 60_000));
    const insert = testDb.raw.prepare('INSERT INTO ad_conversion_logs (id, ad_platform_id, line_account_id, friend_id, event_name, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (let index = 0; index < 25; index++) insert.run(`old-${index}`, 'p1', 'a1', 'friend-1', 'Purchase', 'sent', when(31));
    insert.run('outside-boundary', 'p1', 'a1', 'friend-1', 'Purchase', 'sent', when(30, -5));
    insert.run('inside-boundary', 'p1', 'a1', 'friend-1', 'Purchase', 'sent', when(30, 5));
    for (let index = 0; index < 3; index++) insert.run(`recent-meta-${index}`, 'p1', 'a1', 'friend-1', 'Purchase', 'sent', when(5));
    for (let index = 0; index < 4; index++) insert.run(`recent-google-${index}`, 'p2', 'a1', 'friend-1', 'Purchase', 'success', when(3));
    insert.run('pending', 'p1', 'a1', 'friend-1', 'Purchase', 'pending', when(2));
    insert.run('failed', 'p2', 'a1', 'friend-1', 'Purchase', 'failed', when(2));
    insert.run('another-account', 'p3', 'a2', 'friend-2', 'Purchase', 'sent', when(1));
    const app = new Hono<Env>();
    app.use('*', async (c, next) => {
      c.set('staff', { id: 'owner-1', name: 'Owner', role: 'owner', readOnly: false, tenantId: 'tenant-1' });
      return next();
    });
    app.route('/', adPlatforms);
    for (const page of [1, 2]) {
      const res = await app.request(`/api/ad-platforms/logs?lineAccountId=a1&page=${page}&limit=20&status=failed&query=Purchase`, {}, { DB: testDb.db } as Env['Bindings']);
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { total: number; summary?: { sentLast30Days: number; pendingLast30Days: number; failedLast30Days: number } } };
      expect(body.data.total).toBe(1);
      expect(body.data.summary).toMatchObject({ sentLast30Days: 8, pendingLast30Days: 1, failedLast30Days: 1 });
    }
  });
});
