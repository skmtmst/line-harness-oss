import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createTag, createTagsBulk, updateTag } from '@line-crm/db';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import type { Env } from '../index.js';
import { tags } from './tags.js';

let sql: Database.Database, db: D1Database, app: Hono<Env>;
let beforeBulkInsert: (() => Promise<void>) | undefined;
beforeEach(() => {
  const fixture = createTestD1({ foreignKeys: true });
  sql = fixture.raw;
  db = fixture.db;
  beforeBulkInsert = undefined;
  // D1 run() returns rows for INSERT RETURNING; the generic fixture only models
  // run() changes. Use real SQLite RETURNING here, never simulate uniqueness.
  const prepare = db.prepare.bind(db);
  db.prepare = ((query: string) => {
    if (!/^INSERT OR IGNORE INTO tags/.test(query)) return prepare(query);
    return {
      bind: (...args: unknown[]) => ({
        run: async () => {
          if (beforeBulkInsert) await beforeBulkInsert();
          const results = sql.prepare(query).all(...args);
          return { success: true, results, meta: { changes: results.length } };
        },
      }),
    };
  }) as D1Database['prepare'];
  app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'env-owner', name: '試験管理者', role: 'owner', readOnly: false });
    await next();
  });
  app.route('/', tags);
});
afterEach(() => sql.close());
async function request(path: string, method: string, body: unknown) {
  const response = await app.request(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, { DB: db });
  return { status: response.status, body: await response.json() as any };
}

describe('legacy tags after migration 382: real SQLite and HTTP', () => {
  test('same-name POST returns 409, including pre-existing NULL normalized_name', async () => {
    sql.exec("INSERT INTO tags(id,name) VALUES ('old','従来タグ')");
    expect((await request('/api/tags', 'POST', { name: '従来タグ' })).status).toBe(409);
    const first = await request('/api/tags', 'POST', { name: 'ＶＩＰ　会員' });
    expect(first.status).toBe(201);
    expect(sql.prepare('SELECT line_account_id,normalized_name FROM tags WHERE id=?').get(first.body.data.id)).toEqual({ line_account_id: null, normalized_name: 'vip 会員' });
    expect((await request('/api/tags', 'POST', { name: 'ＶＩＰ　会員' })).status).toBe(409);
    expect(sql.prepare('SELECT count(*) n FROM tags').get()).toEqual({ n: 2 });
  });

  test('concurrent CSV imports that both passed preflight create one row and report a skip', async () => {
    let arrived = 0, release!: () => void;
    const bothReady = new Promise<void>(resolve => { release = resolve; });
    beforeBulkInsert = async () => { if (++arrived === 2) release(); await bothReady; };
    const body = { rows: [{ line: 2, name: 'ＣＳＶ　会員', folderName: '' }] };
    const responses = await Promise.all([
      request('/api/tags/import', 'POST', body),
      request('/api/tags/import', 'POST', body),
    ]);
    expect(arrived).toBe(2);
    expect(responses.map(r => r.status)).toEqual([200, 200]);
    expect(responses.map(r => r.body.data.rows[0].status).sort()).toEqual(['created', 'skipped']);
    expect(sql.prepare('SELECT name,line_account_id,normalized_name FROM tags').all()).toEqual([
      { name: 'ＣＳＶ　会員', line_account_id: null, normalized_name: 'csv 会員' },
    ]);
  });

  test('legacy PATCH rejects a global collision and keeps scoped normalized uniqueness', async () => {
    sql.exec("INSERT INTO tags(id,name) VALUES ('old-a','旧Ａ'),('old-b','旧Ｂ')");
    expect((await request('/api/tags/old-b', 'PATCH', { name: '旧Ａ' })).status).toBe(409);
    expect(sql.prepare("SELECT name,normalized_name,version FROM tags WHERE id='old-b'").get()).toEqual({ name: '旧Ｂ', normalized_name: null, version: 1 });
    const changed = await request('/api/tags/old-b', 'PATCH', { name: 'Ｎｅｗ　名前' });
    expect(changed.status).toBe(200);
    expect(sql.prepare("SELECT name,normalized_name,line_account_id,version FROM tags WHERE id='old-b'").get()).toEqual({ name: 'Ｎｅｗ　名前', normalized_name: 'new 名前', line_account_id: null, version: 2 });
    for (const id of ['a1', 'a2']) sql.prepare("INSERT INTO line_accounts(id,name,channel_id,channel_access_token,channel_secret) VALUES (?,?,?,'fixture','fixture')").run(id,id,`fixture-${id}`);
    sql.exec("INSERT INTO tags(id,name,normalized_name,line_account_id) VALUES ('scope-a','VIP','vip','a1'),('scope-b','別名','別名','a1'),('other','VIP','vip','a2')");
    expect((await request('/api/tags/scope-b', 'PATCH', { name: 'ＶＩＰ' })).status).toBe(409);
    expect(sql.prepare("SELECT name,normalized_name,line_account_id,version FROM tags WHERE id='scope-b'").get()).toEqual({ name: '別名', normalized_name: '別名', line_account_id: 'a1', version: 1 });
    expect((await request('/api/tags/scope-b', 'PATCH', { name: 'Ｓｔａｆｆ' })).status).toBe(200);
    expect(sql.prepare("SELECT normalized_name,line_account_id,version FROM tags WHERE id='scope-b'").get()).toEqual({ normalized_name: 'staff', line_account_id: 'a1', version: 2 });
    expect(sql.pragma('foreign_key_check')).toEqual([]);
  });

  test('old scoped NULL-normalized names reject duplicate POST and both PATCH contracts', async () => {
    for (const id of ['a1', 'a2']) sql.prepare("INSERT INTO line_accounts(id,name,channel_id,channel_access_token,channel_secret) VALUES (?,?,?,'fixture','fixture')").run(id,id,`fixture-${id}`);
    sql.exec("INSERT INTO tags(id,name,normalized_name,line_account_id) VALUES ('old-scoped','VIP',NULL,'a1'),('renamed','Other','other','a1')");
    expect((await request('/api/tags', 'POST', { name: 'VIP', lineAccountId: 'a1' })).status).toBe(409);
    expect((await request('/api/tags/renamed', 'PATCH', { name: 'VIP' })).status).toBe(409);
    expect((await request('/api/tags/renamed', 'PATCH', { name: 'VIP', lineAccountId: 'a1', expectedVersion: 1 })).status).toBe(409);
    expect(sql.prepare("SELECT id,name,normalized_name,version FROM tags WHERE line_account_id='a1' ORDER BY id").all()).toEqual([
      { id: 'old-scoped', name: 'VIP', normalized_name: null, version: 1 },
      { id: 'renamed', name: 'Other', normalized_name: 'other', version: 1 },
    ]);
    expect((await request('/api/tags', 'POST', { name: 'VIP', lineAccountId: 'a2' })).status).toBe(201);
    expect(sql.pragma('foreign_key_check')).toEqual([]);
  });

  test('all legacy DB write helpers normalize names without rewriting the display name or assigning an account', async () => {
    const tag = await createTag(db, { name: '  Ａ　Ｂ  ' });
    expect(tag).toMatchObject({ name: '  Ａ　Ｂ  ', normalized_name: 'a b', line_account_id: null });
    const bulk = await createTagsBulk(db, [{ name: 'Ｃ  Ｄ' }]);
    expect(bulk[0].status).toBe('created');
    expect(sql.prepare('SELECT name,normalized_name,line_account_id FROM tags WHERE id=?').get(bulk[0].tagId)).toEqual({ name: 'Ｃ  Ｄ', normalized_name: 'c d', line_account_id: null });
    const updated = await updateTag(db, tag.id, { name: ' Ｅ　Ｆ ' });
    expect(updated).toMatchObject({ id: tag.id, name: ' Ｅ　Ｆ ', normalized_name: 'e f', line_account_id: null, version: 2 });
    const untouched = await updateTag(db, tag.id, {});
    expect(untouched).toEqual(updated);
  });
});
