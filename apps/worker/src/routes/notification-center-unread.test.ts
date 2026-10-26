import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../worker-env.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { _resetVisibleLineAccountScopeCacheForTest } from '../services/account-access.js';
import { notificationCenter } from './notification-center.js';

// ベル・通知の一覧の「未読」（unread=1）。未読は担当者ごとの既読で決め、口で絞る。
// 画面は先頭の数件に切るので、口で絞らないと 6 件目以降の未読が埋もれる。
let db: SqliteD1;

beforeEach(() => {
  _resetVisibleLineAccountScopeCacheForTest();
  db = createTestD1();
  db.raw.prepare(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
    VALUES ('account-a', 'channel-a', '本店', 'token', 'secret', NULL),
           ('account-b', 'channel-b', '支店', 'token', 'secret', NULL)`).run();
  db.raw.prepare(`INSERT INTO staff_members (id, name, role, api_key, account_scope)
    VALUES ('staff-a', 'staff-a', 'owner', 'key-a', 'all'),
           ('staff-b', 'staff-b', 'owner', 'key-b', 'all'),
           ('scoped-b', 'scoped-b', 'staff', 'key-s', 'accounts')`).run();
  db.raw.prepare(`INSERT INTO staff_account_scopes (staff_id, line_account_id, created_at) VALUES ('scoped-b', 'account-b', '2026-10-01T00:00:00.000Z')`).run();
});
afterEach(() => { db.raw.close(); });

function app(actor: string, role: 'owner' | 'staff' = 'owner') {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: actor, name: actor, role, readOnly: false });
    await next();
  });
  app.route('/', notificationCenter);
  return app;
}

function seed(id: string, minute: number, category: 'error' | 'update' | 'info' = 'error', account = 'account-a') {
  db.raw.prepare(`INSERT INTO notifications (id, event_type, title, body, channel, status, line_account_id, category, created_at)
    VALUES (?, 'broadcast.failed', ?, '', 'dashboard', 'sent', ?, ?, ?)`)
    .run(id, `知らせ ${id}`, account, category, `2026-10-25T10:${String(minute).padStart(2, '0')}:00.000Z`);
}

function markRead(staffId: string, id: string) {
  db.raw.prepare(`INSERT INTO staff_notification_reads (notification_id, staff_id, read_at) VALUES (?, ?, '2026-10-25T11:00:00.000Z')`).run(id, staffId);
}

type Body = { success: boolean; error?: string; data: { items: { id: string; isRead: boolean }[]; counts: Record<string, number>; total: number } };

async function list(actor: string, query: Record<string, string>, role: 'owner' | 'staff' = 'owner') {
  const res = await app(actor, role).request(`/api/notifications/center?${new URLSearchParams(query)}`, {}, { DB: db.db } as Env['Bindings']);
  return { status: res.status, body: await res.json() as Body };
}

/** 新しい既読 6 件の下に、古い未読 2 件。先頭 5 件に切ると未読は 1 件も出ない。 */
function seedBuriedUnread() {
  for (let i = 0; i < 6; i += 1) {
    seed(`read-${i}`, 50 - i);
    markRead('staff-a', `read-${i}`);
  }
  seed('unread-old-1', 10);
  seed('unread-old-2', 5, 'update');
}

describe('GET /api/notifications/center?unread=1', () => {
  test('6 件目より後ろの未読も、未読だけを新しい順に返す。件数は未読の数', async () => {
    seedBuriedUnread();
    const all = await list('staff-a', { lineAccountId: 'account-a', limit: '5' });
    expect(all.body.data.items.every((item) => item.isRead)).toBe(true);

    const unread = await list('staff-a', { lineAccountId: 'account-a', unread: '1', limit: '5' });
    expect(unread.status).toBe(200);
    expect(unread.body.data.items.map((item) => item.id)).toEqual(['unread-old-1', 'unread-old-2']);
    expect(unread.body.data.total).toBe(2);
    expect(unread.body.data.counts.unread).toBe(2);
  });

  test('担当者 A の既読は B の未読に効かない', async () => {
    seedBuriedUnread();
    const forB = await list('staff-b', { lineAccountId: 'account-a', unread: '1', limit: '20' });
    expect(forB.body.data.items).toHaveLength(8);
    expect(forB.body.data.counts.unread).toBe(8);
  });

  test('まとめて既読にすると、すべて・未読・システムのどれでも未読が 0', async () => {
    seedBuriedUnread();
    const res = await app('staff-a').request('/api/notifications/center/read-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lineAccountId: 'account-a', category: 'all' }),
    }, { DB: db.db } as Env['Bindings']);
    expect(res.status).toBe(200);
    for (const query of [{}, { unread: '1' }, { category: 'error' }] as Record<string, string>[]) {
      const after = await list('staff-a', { lineAccountId: 'account-a', ...query });
      expect(after.body.data.counts.unread).toBe(0);
      expect(after.body.data.items.every((item) => item.isRead)).toBe(true);
    }
    // ほかの担当者の未読は残る。
    expect((await list('staff-b', { lineAccountId: 'account-a', unread: '1' })).body.data.items).toHaveLength(8);
  });

  test('見えないアカウントの知らせは未読でも出さない', async () => {
    seed('other-unread', 30, 'error', 'account-a');
    const denied = await list('scoped-b', { lineAccountId: 'account-a', unread: '1' }, 'staff');
    expect(denied.status).toBe(403);
    seed('own-unread', 31, 'error', 'account-b');
    const own = await list('scoped-b', { lineAccountId: 'account-b', unread: '1' }, 'staff');
    expect(own.body.data.items.map((item) => item.id)).toEqual(['own-unread']);
  });

  test('知らない値・種類との組み合わせは 400（残りの件数がずれるため）', async () => {
    expect((await list('staff-a', { lineAccountId: 'account-a', unread: 'yes' })).status).toBe(400);
    const both = await list('staff-a', { lineAccountId: 'account-a', unread: '1', category: 'error' });
    expect(both.status).toBe(400);
    expect(both.body.error).toBe('未読と種類は一緒に指定できません');
    expect((await list('staff-a', { lineAccountId: 'account-a', unread: '0' })).status).toBe(200);
  });
});
