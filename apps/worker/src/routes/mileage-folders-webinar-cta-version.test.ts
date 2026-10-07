import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { Hono } from 'hono';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import { createMileageRewardDraft } from '@line-crm/db';
import type { Env } from '../index.js';
import { authMiddleware } from '../middleware/auth.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { scoring } from './scoring.js';
import { webinarRoutes } from './webinars.js';

let sqlite: SqliteD1;
let app: Hono<Env>;
function request(path: string, method = 'GET', body?: unknown, token = 'owner-key') {
  return app.request(path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, { DB: sqlite.db } as Env['Bindings']);
}
beforeEach(() => {
  sqlite = createTestD1();
  sqlite.raw.prepare(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
    VALUES ('acc-1', 'channel-1', '本店', 'token', 'secret', ?), ('acc-2', 'channel-2', '支店', 'token', 'secret', ?)`).run(DEFAULT_TENANT_ID, DEFAULT_TENANT_ID);
  sqlite.raw.prepare(`INSERT INTO staff_members (id, name, role, api_key, tenant_id, account_scope, permission_keys)
    VALUES ('owner', '統括', 'owner', 'owner-key', ?, 'all', '[]'),
           ('staff', '担当', 'staff', 'staff-key', ?, 'all', '["/mileage","/webinars"]')`).run(DEFAULT_TENANT_ID, DEFAULT_TENANT_ID);
  sqlite.raw.exec("INSERT INTO webinars (id, account_id, title, slug, created_at, updated_at) VALUES ('w1', 'acc-1', '配信', 'stream', '2026-10-07T00:00:00', '2026-10-07T00:00:00');");
  app = new Hono<Env>();
  app.use('*', authMiddleware);
  app.route('/', scoring);
  app.route('/', webinarRoutes);
});
afterEach(() => sqlite.raw.close());

describe('マイルの使い道のフォルダ', () => {
  test('作成・並べ替え・分類・未分類・件数をアカウント内で扱う', async () => {
    const reward = await createMileageRewardDraft(sqlite.db, { lineAccountId: 'acc-1', draft: { name: '割引', rewardKind: 'coupon', requiredMiles: 100 } });
    const create = async (accountId: string, name: string) => {
      const res = await request('/api/mileage/reward-folders', 'POST', { accountId, name });
      expect(res.status).toBe(201);
      return (await res.json() as { data: { id: string } }).data.id;
    };
    const first = await create('acc-1', 'クーポン');
    const second = await create('acc-1', '体験');
    const other = await create('acc-2', '支店');
    expect((await request('/api/mileage/reward-folders/order', 'PUT', { accountId: 'acc-1', ids: [second, first] })).status).toBe(200);
    const move = await request(`/api/mileage/rewards/${reward.id}/folder`, 'PUT', { accountId: 'acc-1', folderId: first });
    expect(move.status).toBe(200);
    expect((await move.json() as { data: unknown }).data).toMatchObject({ folderId: first });
    const list = await request('/api/mileage/reward-folders?accountId=acc-1');
    expect((await list.json() as { data: unknown }).data).toEqual([
      expect.objectContaining({ id: second, count: 0, displayOrder: 0 }), expect.objectContaining({ id: first, count: 1, displayOrder: 1 }),
    ]);
    expect((await request(`/api/mileage/rewards/${reward.id}/folder`, 'PUT', { accountId: 'acc-1', folderId: other })).status).toBe(404);
    expect((await request('/api/mileage/reward-folders/order', 'PUT', { accountId: 'acc-1', ids: [first, other] })).status).toBe(422);
    expect((await request('/api/mileage/reward-folders/order', 'PUT', { accountId: 'acc-1', ids: [first, first] })).status).toBe(422);
    expect((await request(`/api/mileage/rewards/${reward.id}/folder`, 'PUT', { accountId: 'acc-1', folderId: null })).status).toBe(200);
    expect(sqlite.raw.prepare('SELECT folder_id, status FROM mileage_rewards WHERE id = ?').get(reward.id)).toEqual({ folder_id: null, status: 'draft' });
  });
  test('担当者は読めるが分類を変更できない', async () => {
    expect((await request('/api/mileage/reward-folders?accountId=acc-1', 'GET', undefined, 'staff-key')).status).toBe(200);
    expect((await request('/api/mileage/reward-folders', 'POST', { accountId: 'acc-1', name: '分類' }, 'staff-key')).status).toBe(403);
  });
});

describe('ウェビナーCTAの版を確かめる保存', () => {
  const card = { atSeconds: 30, kind: 'url', title: '案内', buttonLabel: '開く', url: 'https://example.com' };
  test('古い版で消さず、比較後に最新の版で自分の内容を保存できる', async () => {
    const initial = await request('/api/webinars/w1/ctas');
    expect(initial.status).toBe(200);
    expect(await initial.json()).toMatchObject({ data: [], version: 0, updatedBy: null });
    const saved = await request('/api/webinars/w1/ctas', 'PUT', { expectedVersion: 0, ctas: [card] });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ data: { count: 1, version: 1 } });
    const stale = await request('/api/webinars/w1/ctas', 'PUT', { expectedVersion: 0, ctas: [] });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ currentVersion: 1, updatedBy: 'owner' });
    expect(sqlite.raw.prepare('SELECT COUNT(*) AS count FROM webinar_ctas').get()).toEqual({ count: 1 });
    expect((await request('/api/webinars/w1/ctas', 'PUT', { expectedVersion: 1, ctas: [] })).status).toBe(200);
    expect(await (await request('/api/webinars/w1/ctas')).json()).toMatchObject({ data: [], version: 2, updatedBy: 'owner' });
  });
  test('比較後、batch直前の別担当の保存もカードを消さず409にする', async () => {
    const batch = sqlite.db.batch.bind(sqlite.db);
    sqlite.db.batch = async (statements) => {
      sqlite.raw.exec("UPDATE webinars SET cta_version = 1, cta_updated_by = 'other', cta_write_token = 'other-save'; INSERT INTO webinar_ctas (id, webinar_id, at_seconds, kind, title, button_label, url, created_at, updated_at) VALUES ('other-card', 'w1', 1, 'url', '他の内容', '開く', 'https://example.com', '2026-10-07T00:00:00', '2026-10-07T00:00:00');");
      return batch(statements);
    };
    expect((await request('/api/webinars/w1/ctas', 'PUT', { expectedVersion: 0, ctas: [card] })).status).toBe(409);
    expect(sqlite.raw.prepare('SELECT id, title FROM webinar_ctas').all()).toEqual([{ id: 'other-card', title: '他の内容' }]);
    expect(sqlite.raw.prepare('SELECT cta_version, cta_updated_by FROM webinars').get()).toEqual({ cta_version: 1, cta_updated_by: 'other' });
  });
  test('版の省略でも版を進め、不正な版・カードと担当者の保存は拒む', async () => {
    expect((await request('/api/webinars/w1/ctas', 'PUT', { ctas: [card] })).status).toBe(200);
    expect((await request('/api/webinars/w1/ctas', 'PUT', { expectedVersion: '1', ctas: [] })).status).toBe(400);
    expect((await request('/api/webinars/w1/ctas', 'PUT', { expectedVersion: 1, ctas: [{ ...card, url: 'http://example.com' }] })).status).toBe(400);
    expect((await request('/api/webinars/w1/ctas', 'PUT', { expectedVersion: 1, ctas: [] }, 'staff-key')).status).toBe(403);
    expect(sqlite.raw.prepare('SELECT cta_version FROM webinars').get()).toEqual({ cta_version: 1 });
  });
});
