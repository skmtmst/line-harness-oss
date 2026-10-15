import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';

test('audience migration preserves existing recipients with foreign keys enabled', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys=ON');
  db.exec(
    `CREATE TABLE line_accounts(id TEXT PRIMARY KEY);INSERT INTO line_accounts VALUES('a');CREATE TABLE friends(id TEXT PRIMARY KEY);INSERT INTO friends VALUES('f');CREATE TABLE analytics_cross_runs(id TEXT PRIMARY KEY,line_account_id TEXT);CREATE TABLE analytics_funnel_runs(id TEXT PRIMARY KEY,line_account_id TEXT);INSERT INTO analytics_funnel_runs VALUES('r','a');CREATE TABLE analytics_result_audiences(id TEXT PRIMARY KEY,line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,source_kind TEXT NOT NULL CHECK(source_kind IN('funnel','cross')),source_result_id TEXT NOT NULL,selection_key TEXT NOT NULL,member_count INTEGER NOT NULL DEFAULT 0,expires_at TEXT NOT NULL,created_by TEXT,created_at TEXT NOT NULL);CREATE TABLE analytics_result_audience_members(audience_id TEXT NOT NULL REFERENCES analytics_result_audiences(id) ON DELETE CASCADE,friend_id TEXT NOT NULL REFERENCES friends(id),PRIMARY KEY(audience_id,friend_id));INSERT INTO analytics_result_audiences VALUES('aud','a','funnel','r','selection',1,'2030-01-01','actor','2026-01-01');INSERT INTO analytics_result_audience_members VALUES('aud','f');`,
  );
  const migration = readFileSync(
    resolve(
      import.meta.dirname,
      '../../../../packages/db/migrations/650_booking_analytics_audiences.sql',
    ),
    'utf8',
  );
  db.transaction(() => db.exec(migration))();
  expect(
    db.prepare('SELECT * FROM analytics_result_audience_members').all(),
  ).toEqual([{ audience_id: 'aud', friend_id: 'f' }]);
  expect(
    db
      .prepare(
        'SELECT member_count,source_kind FROM analytics_result_audiences',
      )
      .get(),
  ).toEqual({ member_count: 1, source_kind: 'funnel' });
  expect(db.pragma('foreign_key_check')).toEqual([]);
  expect(() =>
    db
      .prepare(
        "INSERT INTO analytics_result_audiences VALUES('bad','a','booking','missing','selection',0,'2030-01-01',NULL,'2026-01-01')",
      )
      .run(),
  ).toThrow('analytics_result_source_not_found');
  db.close();
});
