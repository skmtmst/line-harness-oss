import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { webhooks } from './webhooks.js';
import { updateOutgoingWebhook } from '@line-crm/db';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
let db: SqliteD1;
beforeEach(() => {
  db = createTestD1();
  db.raw.prepare(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
    VALUES ('a1', 'test-channel', '試験', 'fixture-token', 'fixture-secret')`).run();
  db.raw.prepare(`INSERT INTO outgoing_webhooks (id, name, url, event_types, line_account_id)
    VALUES ('wh1', '試験送り先', 'https://example.test/hook', '["message"]', 'a1')`).run();
});
afterEach(() => db.raw.close());
function app() {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'editor-test', name: '試験担当', role: 'owner', readOnly: false });
    await next();
  });
  app.route('/', webhooks);
  return app;
}
const put = (body: object) => app().request('/api/webhooks/outgoing/wh1?lineAccountId=a1', {
  method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}, { DB: db.db });
describe('送り先の版の競合', () => {
  test('一致する版で更新し、担当と日時を返す', async () => {
    const res = await put({ expectedVersion: 1, name: '更新後' });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { version: number; updatedBy: string; updatedAt: string } };
    expect(body.data).toMatchObject({ version: 2, updatedBy: 'editor-test' });
    expect(Number.isFinite(Date.parse(body.data.updatedAt))).toBe(true);
  });
  test('古い版は409で、相手の版・担当・日時を返し上書きしない', async () => {
    await put({ expectedVersion: 1, name: '先の編集' });
    const res = await put({ expectedVersion: 1, name: '古い画面' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'VERSION_CONFLICT', data: {
      currentVersion: 2, updatedBy: 'editor-test', updatedAt: expect.any(String),
    } });
    expect(db.raw.prepare('SELECT name FROM outgoing_webhooks').get()).toEqual({ name: '先の編集' });
  });
  test('版の省略は従来どおり保存できる', async () => {
    expect((await put({ name: '版の省略' })).status).toBe(200);
    expect(db.raw.prepare('SELECT version FROM outgoing_webhooks').get()).toEqual({ version: 2 });
  });
  test('不正な版は400', async () => {
    for (const expectedVersion of [0, -1, 1.5, '1', null]) {
      expect((await put({ expectedVersion, name: '変更' })).status).toBe(400);
    }
  });
  test('同じ版の競合更新はDB条件で片方だけ成功する', async () => {
    const result = await Promise.all([
      updateOutgoingWebhook(db.db, 'wh1', 'a1', { name: '編集A' }, undefined, { expectedVersion: 1, updatedByStaffId: 'A' }),
      updateOutgoingWebhook(db.db, 'wh1', 'a1', { name: '編集B' }, undefined, { expectedVersion: 1, updatedByStaffId: 'B' }),
    ]);
    expect(result.sort()).toEqual([false, true]);
    expect(db.raw.prepare('SELECT version FROM outgoing_webhooks').get()).toEqual({ version: 2 });
  });
  test('一覧と詳細に版・担当・日時を含め、秘密値は含めない', async () => {
    await put({ expectedVersion: 1, name: '保存済み' });
    for (const path of ['/api/webhooks/outgoing', '/api/webhooks/outgoing/wh1']) {
      const res = await app().request(path + '?lineAccountId=a1', {}, { DB: db.db });
      expect(res.status).toBe(200);
      const body = await res.json() as { data: object | object[] };
      const row = Array.isArray(body.data) ? body.data[0] : body.data;
      expect(row).toMatchObject({ version: 2, updatedBy: 'editor-test', updatedAt: expect.any(String) });
      expect(row).not.toHaveProperty('secret');
    }
  });
  test('自動停止と削除・復元は版を進め、通信結果の件数だけでは進めない', async () => {
    db.raw.prepare('UPDATE outgoing_webhooks SET consecutive_failures = 1').run();
    expect(db.raw.prepare('SELECT version FROM outgoing_webhooks').get()).toEqual({ version: 1 });
    db.raw.prepare('UPDATE outgoing_webhooks SET is_active = 0').run();
    expect((await put({ expectedVersion: 1, name: '古い画面' })).status).toBe(409);
    db.raw.prepare(`UPDATE outgoing_webhooks SET deleted_at = '2026-10-07'`).run();
    db.raw.prepare('UPDATE outgoing_webhooks SET deleted_at = NULL').run();
    expect(db.raw.prepare('SELECT version, updated_by_staff_id FROM outgoing_webhooks').get())
      .toEqual({ version: 4, updated_by_staff_id: null });
  });
  test('別アカウントには保存しない', async () => {
    expect(await updateOutgoingWebhook(db.db, 'wh1', 'a2', { name: '越境' }, undefined, { expectedVersion: 1 })).toBe(false);
    expect(db.raw.prepare('SELECT version FROM outgoing_webhooks').get()).toEqual({ version: 1 });
  });
});
