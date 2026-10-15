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

test('681 preserves previous selection and defaults automatic insertion on; invalid states fail', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE account_styles(line_account_id TEXT PRIMARY KEY,selected_at TEXT,answers_json TEXT);
    INSERT INTO account_styles VALUES('chosen','2026-10-15','{"hours":{"mode":"manual"}}'),('unselected',NULL,'{}');
    CREATE TABLE style_starter_sets(id TEXT PRIMARY KEY,definition_json TEXT);
    INSERT INTO style_starter_sets VALUES('set','{"items":[]}');`);
  db.exec(
    readFileSync(
      resolve(
        import.meta.dirname,
        '../../../../packages/db/migrations/681_style_setup_selection_and_auto_insert.sql',
      ),
      'utf8',
    ),
  );
  expect(
    db
      .prepare(
        'SELECT line_account_id,selection_mode,answers_json FROM account_styles ORDER BY line_account_id',
      )
      .all(),
  ).toEqual([
    {
      line_account_id: 'chosen',
      selection_mode: 'configured',
      answers_json: '{"hours":{"mode":"manual"}}',
    },
    {
      line_account_id: 'unselected',
      selection_mode: 'later',
      answers_json: '{}',
    },
  ]);
  expect(
    db
      .prepare('SELECT auto_insert,definition_json FROM style_starter_sets')
      .get(),
  ).toEqual({ auto_insert: 1, definition_json: '{"items":[]}' });
  expect(() =>
    db.exec("UPDATE account_styles SET selection_mode='bad'"),
  ).toThrow();
  expect(() =>
    db.exec('UPDATE style_starter_sets SET auto_insert=2'),
  ).toThrow();
  db.close();
});
