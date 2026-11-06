import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Miniflare } from 'miniflare';
import { expect, test } from 'vitest';

test('D1 audience rebuild preserves recipients in its real atomic batch', async () => {
  const mf = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    d1Databases: ['DB'],
  });
  try {
    const db = await mf.getD1Database('DB');
    const setup = [
      'CREATE TABLE line_accounts(id TEXT PRIMARY KEY)',
      "INSERT INTO line_accounts VALUES('a')",
      'CREATE TABLE friends(id TEXT PRIMARY KEY)',
      "INSERT INTO friends VALUES('f')",
      'CREATE TABLE analytics_cross_runs(id TEXT PRIMARY KEY,line_account_id TEXT)',
      'CREATE TABLE analytics_funnel_runs(id TEXT PRIMARY KEY,line_account_id TEXT)',
      "INSERT INTO analytics_funnel_runs VALUES('r','a')",
      "CREATE TABLE analytics_result_audiences(id TEXT PRIMARY KEY,line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,source_kind TEXT NOT NULL CHECK(source_kind IN('funnel','cross')),source_result_id TEXT NOT NULL,selection_key TEXT NOT NULL,member_count INTEGER NOT NULL DEFAULT 0,expires_at TEXT NOT NULL,created_by TEXT,created_at TEXT NOT NULL)",
      'CREATE TABLE analytics_result_audience_members(audience_id TEXT NOT NULL REFERENCES analytics_result_audiences(id) ON DELETE CASCADE,friend_id TEXT NOT NULL REFERENCES friends(id),PRIMARY KEY(audience_id,friend_id))',
      "INSERT INTO analytics_result_audiences VALUES('aud','a','funnel','r','selection',1,'2030-01-01','actor','2026-01-01')",
      "INSERT INTO analytics_result_audience_members VALUES('aud','f')",
    ];
    await db.batch(setup.map((sql) => db.prepare(sql)));
    const migration = readFileSync(
      resolve(
        import.meta.dirname,
        '../../../../packages/db/migrations/650_booking_analytics_audiences.sql',
      ),
      'utf8',
    )
      .split(/;\s*(?:\r?\n|$)/)
      .map((s) => s.trim())
      .filter(Boolean);
    await db.batch(migration.map((sql) => db.prepare(sql)));
    expect(
      (
        await db
          .prepare('SELECT * FROM analytics_result_audience_members')
          .all()
      ).results,
    ).toEqual([{ audience_id: 'aud', friend_id: 'f' }]);
    expect(
      (await db.prepare('PRAGMA foreign_key_check').all()).results,
    ).toEqual([]);
  } finally {
    await mf.dispose();
  }
}, 30000);
