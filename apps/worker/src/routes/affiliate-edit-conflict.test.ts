/*
 * アフィリエイターの同時編集も「最後に直した日時で比べる」（v8f と同じ形）。
 * PUT /api/affiliates/:id は読んだときの更新日時 expectedUpdatedAt を
 * 任意で受ける。違えば409と今の中身を返し、同じなら保存、
 * 送らなければ今までどおり保存する。
 */
import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../index';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite';

const { affiliates } = await import('./affiliates.js');

let sqlite: SqliteD1['raw'];
let db: D1Database;

function staffApp(route: Hono<Env>) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'staff-1', name: '担当者', role: 'owner', readOnly: false });
    return next();
  });
  app.route('/', route);
  return app;
}

const SAVED_AT = '2026-10-02T14:02:00.000+09:00';

beforeEach(() => {
  const created = createTestD1();
  sqlite = created.raw;
  db = created.db;
  sqlite.exec(`
    INSERT INTO line_accounts
      (id, channel_id, name, channel_access_token, channel_secret)
    VALUES ('account-a', 'channel-a', 'A店', 'token-a', 'secret-a');
    INSERT INTO affiliates
      (id, tenant_id, line_account_id, name, code, created_at, updated_at)
    VALUES ('aff-a', '00000000-0000-4000-8000-000000000001', 'account-a',
      'ペットライフ編集部', 'petli', '2026-10-01T00:00:00.000+09:00', '${SAVED_AT}');
  `);
});

function put(body: unknown) {
  const app = staffApp(affiliates as Hono<Env>);
  return app.request('/api/affiliates/aff-a', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, { DB: db });
}

describe('アフィリエイターの同時編集は更新日時で見分ける', () => {
  it('違えば409で今の中身を返し、書き換えない', async () => {
    const res = await put({ name: '別名', expectedUpdatedAt: '2000-01-01T00:00:00.000+09:00' });
    expect(res.status).toBe(409);
    const json = await res.json() as Record<string, unknown>;
    expect(json.code).toBe('VERSION_CONFLICT');
    const latest = (json.data as { latest: { name: string; updatedAt: string } }).latest;
    expect(latest.name).toBe('ペットライフ編集部');
    expect(latest.updatedAt).toBe(SAVED_AT);
    // 書き換わっていない
    const row = sqlite.prepare('SELECT name FROM affiliates WHERE id = ?').get('aff-a') as { name: string };
    expect(row.name).toBe('ペットライフ編集部');
  });

  it('同じなら保存する', async () => {
    const res = await put({ name: 'ペットライフ編集部・新', expectedUpdatedAt: SAVED_AT });
    expect(res.status).toBe(200);
    const json = await res.json() as { data: { name: string; updatedAt: string } };
    expect(json.data.name).toBe('ペットライフ編集部・新');
    expect(json.data.updatedAt).not.toBe(SAVED_AT);
  });

  it('送らなければ今までどおり保存する', async () => {
    const res = await put({ name: '送らず保存' });
    expect(res.status).toBe(200);
    const json = await res.json() as { data: { name: string } };
    expect(json.data.name).toBe('送らず保存');
  });
});
