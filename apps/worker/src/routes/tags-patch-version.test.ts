import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import type { Env } from '../index.js';
import { tags } from './tags.js';

/*
 * PATCH /api/tags/:id は expectedVersion 必須(#715)。版なしの迂回は無い。
 *
 * 実DB・実routeで見る。missing/stale/success/archived/account境界を、
 * DBに残った値と応答の版で突き合わせる。
 */
let sql: Database.Database, db: D1Database, app: Hono<Env>;
beforeEach(() => {
  const fixture = createTestD1({ foreignKeys: true });
  sql = fixture.raw;
  db = fixture.db;
  sql.prepare("INSERT INTO line_accounts(id,name,channel_id,channel_access_token,channel_secret) VALUES ('a1','A店','ch-a','t','s'),('a2','B店','ch-b','t','s')").run();
  sql.exec(`INSERT INTO tags(id,name,line_account_id,status,is_starred)
    VALUES ('t1','通常','a1','active',0),
           ('t-arch','保管済み','a1','archived',0),
           ('t-other','別店','a2','active',0)`);
  app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'env-owner', name: '試験管理者', role: 'owner', readOnly: false });
    await next();
  });
  app.route('/', tags);
});
afterEach(() => sql.close());

async function request(path: string, body: unknown) {
  const response = await app.request(path, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, { DB: db });
  return { status: response.status, body: await response.json() as any };
}

const versionOf = (id: string) =>
  (sql.prepare('SELECT version FROM tags WHERE id=?').get(id) as { version: number }).version;

describe('PATCH /api/tags/:id の版必須(#715)', () => {
  test('版が無いと400で書かない', async () => {
    const res = await request('/api/tags/t1', { lineAccountId: 'a1', isStarred: true });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'expectedVersion is required' });
    expect(versionOf('t1')).toBe(1);
  });

  test('不正な版は400で書かない', async () => {
    for (const expectedVersion of [0, -1, 1.5, 'x', null]) {
      const res = await request('/api/tags/t1', { lineAccountId: 'a1', expectedVersion, isStarred: true });
      expect(res.status).toBe(400);
    }
    expect(versionOf('t1')).toBe(1);
  });

  test('古い版は409で書かない', async () => {
    sql.prepare('UPDATE tags SET version=5 WHERE id=?').run('t1');
    const res = await request('/api/tags/t1', { lineAccountId: 'a1', expectedVersion: 1, isStarred: true });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'version_conflict' });
    expect((sql.prepare('SELECT is_starred,version FROM tags WHERE id=?').get('t1') as object)).toEqual({ is_starred: 0, version: 5 });
  });

  test('正しい版なら200で版が進み応答にも載る', async () => {
    const res = await request('/api/tags/t1', { lineAccountId: 'a1', expectedVersion: 1, isStarred: true });
    expect(res.status).toBe(200);
    expect(res.body.data.version).toBe(2);
    expect(res.body.data.tag.version).toBe(2);
    expect((sql.prepare('SELECT is_starred,version FROM tags WHERE id=?').get('t1') as object)).toEqual({ is_starred: 1, version: 2 });
  });

  test('別アカウントの指定では404で書かない', async () => {
    const res = await request('/api/tags/t-other', { lineAccountId: 'a1', expectedVersion: 1, isStarred: true });
    expect(res.status).toBe(404);
    expect(versionOf('t-other')).toBe(1);
  });

  test('archivedの名前訂正は通るがスター変更は409(#710維持)', async () => {
    const renamed = await request('/api/tags/t-arch', { lineAccountId: 'a1', expectedVersion: 1, name: '保管済み(訂正)' });
    expect(renamed.status).toBe(200);
    const starred = await request('/api/tags/t-arch', { lineAccountId: 'a1', expectedVersion: 2, isStarred: true });
    expect(starred.status).toBe(409);
    expect(starred.body).toMatchObject({ code: 'archived_readonly' });
    expect((sql.prepare('SELECT is_starred FROM tags WHERE id=?').get('t-arch') as object)).toEqual({ is_starred: 0 });
  });
});
