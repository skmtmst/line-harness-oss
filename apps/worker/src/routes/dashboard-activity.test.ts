import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { dashboard } from './dashboard.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
let db: SqliteD1;
beforeEach(() => {
  db = createTestD1();
  for (const id of ['a1', 'a2']) {
    db.raw.prepare(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
      VALUES (?, ?, '試験', 'fixture-token', 'fixture-secret')`).run(id, id);
    db.raw.prepare(`INSERT INTO friends (id, line_user_id, line_account_id) VALUES (?, ?, ?)`).run('f-' + id, 'U-' + id, id);
  }
});
afterEach(() => db.raw.close());
function app(auth = true, allowedAccountIds?: string[]) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    if (auth) c.set('staff', { id: 'owner-test', name: '試験', role: 'owner', readOnly: false, featureEnabledLineAccountIds: allowedAccountIds });
    await next();
  });
  app.route('/', dashboard);
  return app;
}
const get = (query: string) => app().request('/api/dashboard/activity?' + query, {}, { DB: db.db });
function broadcast(id: string, at: string, account = 'a1', status = 'sent') {
  db.raw.prepare(`INSERT INTO broadcasts (id, title, message_type, message_content, status, sent_at, line_account_id)
    VALUES (?, '試験配信', 'text', '試験', ?, ?, ?)`).run(id, status, at, account);
}
describe('ダッシュボードの最近の動き', () => {
  test('アカウントを混ぜず新しい順で件数を制限する', async () => {
    broadcast('old', '2026-10-01T10:00:00+09:00');
    broadcast('new', '2026-10-02T02:00:00Z');
    broadcast('other', '2026-10-03T00:00:00Z', 'a2');
    broadcast('scheduled', '2026-10-04T00:00:00Z', 'a1', 'scheduled');
    const res = await get('account_id=a1&limit=1');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: { items: [{ id: 'broadcast:new', kind: 'broadcast_sent',
      href: '/broadcasts/detail?id=new' }] } });
  });
  test('フォーム回答と友だち追加を混ぜ、試し回答は除く', async () => {
    db.raw.prepare(`INSERT INTO forms (id, name) VALUES ('form1', '試験フォーム')`).run();
    db.raw.prepare(`INSERT INTO form_accounts (form_id, line_account_id) VALUES ('form1', 'a1')`).run();
    for (const [id, isTest, friend] of [['s1', 0, 'f-a1'], ['test', 1, 'f-a1'], ['other', 0, 'f-a2']] as const) {
      db.raw.prepare(`INSERT INTO form_submissions (id, form_id, friend_id, is_test, created_at)
        VALUES (?, 'form1', ?, ?, '2026-10-02T00:00:00Z')`).run(id, friend, isTest);
    }
    db.raw.prepare(`INSERT INTO friend_add_events
      (id, line_account_id, friend_id, webhook_event_id, friend_kind, occurred_at)
      VALUES ('add1', 'a1', 'f-a1', 'e1', 'first_time', '2026-10-03T00:00:00Z')`).run();
    const body = await (await get('account_id=a1')).json() as { data: { items: { kind: string }[] } };
    expect(body.data.items.map(i => i.kind)).toEqual(['friend_added', 'form_submitted']);
  });
  test('予約日時ではなく予約が入った日時を返す', async () => {
    db.raw.prepare(`INSERT INTO bookings (id, line_account_id, staff_id, menu_id, friend_id,
      starts_at, ends_at, block_ends_at, status, price_at_booking, requested_at)
      VALUES ('booking1', 'a1', 'test-staff', 'test-menu', 'f-a1', '2999-01-01',
        '2999-01-01', '2999-01-01', 'confirmed', 0, '2026-10-01T00:00:00Z')`).run();
    const body = await (await get('account_id=a1')).json();
    expect(body).toMatchObject({ data: { items: [{ kind: 'booking_created', occurredAt: '2026-10-01T00:00:00Z',
      href: '/booking/bookings/detail?id=booking1' }] } });
  });
  test('入力が不正・アカウント不明なら拒否する', async () => {
    expect((await get('limit=1')).status).toBe(400);
    expect((await get('account_id=missing')).status).toBe(404);
    for (const limit of ['0', '101', '1.5', 'NaN', '']) {
      expect((await get('account_id=a1&limit=' + limit)).status).toBe(400);
    }
  });
  test('未認証では読めず、空のアカウントは空の一覧を返す', async () => {
    expect((await app(false).request('/api/dashboard/activity?account_id=a1', {}, { DB: db.db })).status).toBe(403);
    expect(await (await get('account_id=a1')).json()).toMatchObject({ data: { items: [] } });
  });
});


test('閲覧範囲の外のアカウントの最近の動きを読ませない', async () => {
  broadcast('hidden', '2026-10-01T00:00:00Z', 'a2');
  const res = await app(true, ['a1']).request('/api/dashboard/activity?account_id=a2', {}, { DB: db.db });
  expect(res.status).toBe(404);
});
