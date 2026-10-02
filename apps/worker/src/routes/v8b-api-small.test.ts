import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { getEntryRouteFunnel, getFolderItemCounts } from '@line-crm/db';
import events from './events.js';
import { entryRoutes } from './entry-routes.js';

let db: SqliteD1;
let app: Hono<Env>;
const base = '/api/events/admin/events';
function call(method: string, path: string, body?: unknown) {
  return app.request(path, { method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) }, { DB: db.db } as Env['Bindings']);
}
beforeEach(() => {
  db = createTestD1();
  for (const id of ['a', 'b', 'other']) db.raw.prepare("INSERT INTO line_accounts (id, name, channel_id, channel_secret, channel_access_token) VALUES (?, ?, ?, 'unused', 'unused')").run(id, id, id);
  db.raw.exec(`INSERT INTO folders(id, kind, name, account_id) VALUES ('event-a', 'event', '分類', 'a'), ('event-other', 'event', '他', 'other'), ('tag-a', 'tag', 'タグ', 'a');`);
  app = new Hono<Env>();
  app.use('*', async (c, next) => { c.set('staff', { id: 'owner', name: '試験', role: 'owner', readOnly: false }); await next(); });
  app.route('/', events);
  app.route('/', entryRoutes);
});
afterEach(() => db.raw.close());

describe('V8-Bの既存契約への追加', () => {
  it('流入の旧4項目を残し、残存・ブロック・成果金額を返す', async () => {
    db.raw.exec(`INSERT INTO entry_routes (id, ref_code, name) VALUES ('route', 'first', '流入');
      INSERT INTO friends (id, line_user_id, ref_code, is_following) VALUES ('f1', 'u1', 'first', 1), ('f2', 'u2', 'first', 0), ('f3', 'u3', 'other', 1);
      INSERT INTO conversion_points (id, name, event_type, value) VALUES ('point', '成果', 'purchase', 50);
      INSERT INTO conversion_events (id, friend_id, conversion_point_id, value_snapshot) VALUES ('c1', 'f1', 'point', 100), ('c2', 'f1', 'point', 0), ('c3', 'f2', 'point', NULL), ('c4', 'f3', 'point', 999);`);
    const expected = { click_count: 0, friend_add_count: 2, form_submission_count: 0, cv_count: 3,
      remainingCount: 1, blockedCount: 1, conversionValueSum: 150 };
    expect(await getEntryRouteFunnel(db.db, 'route')).toEqual(expected);
    expect(await (await call('GET', '/api/entry-routes/route/funnel')).json()).toEqual({ success: true, data: expected });
    expect(await getEntryRouteFunnel(db.db, 'empty')).toMatchObject({ remainingCount: 0, blockedCount: 0, conversionValueSum: 0 });
  });

  it('イベントの分類を作成・変更・解除し、旧一覧フィールドと版チェックを残す', async () => {
    const created = await call('POST', `${base}?account_id=a`, { name: '体験会', folderId: 'event-a' });
    expect(created.status).toBe(201);
    const row = await created.json<{ id: string; version: number; folderId: string; folder_id: string }>();
    expect(row).toMatchObject({ folderId: 'event-a', folder_id: 'event-a' });
    const listed = await (await call('GET', `${base}?account_id=a&folderId=event-a`)).json<{ items: typeof row[]; data: typeof row[] }>();
    expect(listed.items ?? listed.data).toEqual([expect.objectContaining({ id: row.id, folderId: 'event-a', folder_id: 'event-a' })]);
    expect((await call('PUT', `${base}/${row.id}?account_id=a`, { expectedVersion: row.version, folderId: null })).status).toBe(200);
    expect((await call('PUT', `${base}/${row.id}?account_id=a`, { expectedVersion: row.version, folderId: 'event-a' })).status).toBe(409);
    expect(await (await call('GET', `${base}/${row.id}?account_id=a`)).json()).toMatchObject({ folderId: null, folder_id: null });
    for (const folderId of ['event-other', 'tag-a', 'missing', 3]) {
      expect((await call('POST', `${base}?account_id=a`, { name: '体験会', folderId })).status).toBe(422);
    }
  });

  it('Bからも複数アカウントの開催を数え、両方指定でも二重に数えない', async () => {
    db.raw.exec(`INSERT INTO events (id, name, line_account_id, target_type, account_ids, folder_id) VALUES
      ('multi', '合同', 'a', 'multi-account-dedup', '["a","b"]', 'event-a'),
      ('single', '単独', 'a', 'single', NULL, 'event-a'),
      ('unfiled', '未分類', 'b', 'single', NULL, NULL),
      ('hidden', '他', 'other', 'single', NULL, 'event-a');
      INSERT INTO events (id, name, line_account_id, deleted_at, folder_id) VALUES ('deleted', '削除済み', 'b', '2026-10-01', 'event-a');`);
    expect(await getFolderItemCounts(db.db, 'event', { allowedAccountIds: ['b'], canSeeUnassigned: false }))
      .toEqual({ byFolderId: { 'event-a': 1 }, unfiled: 1 });
    expect(await getFolderItemCounts(db.db, 'event', { allowedAccountIds: ['a', 'b'], canSeeUnassigned: true }))
      .toEqual({ byFolderId: { 'event-a': 2 }, unfiled: 1 });
    expect(await getFolderItemCounts(db.db, 'event', { allowedAccountIds: [], canSeeUnassigned: true }))
      .toEqual({ byFolderId: {}, unfiled: 0 });
  });
});
