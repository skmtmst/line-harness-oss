import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import { getFormSubmissionAnalytics } from '../src/forms.js';

const migration = readFileSync(
  join(import.meta.dirname, '..', 'migrations', '312_form_submission_analytics.sql'),
  'utf8',
);

function asD1(sqlite: Database.Database): D1Database {
  return {
    prepare(query: string) {
      const statement = (bindings: unknown[]) => ({
        async run() {
          const info = sqlite.prepare(query).run(...bindings);
          return { results: [], success: true, meta: { changes: info.changes } };
        },
        async first<T>() {
          return (sqlite.prepare(query).get(...bindings) as T | undefined) ?? null;
        },
        async all<T>() {
          return { results: sqlite.prepare(query).all(...bindings) as T[], success: true, meta: {} };
        },
      });
      return { bind: (...bindings: unknown[]) => statement(bindings), ...statement([]) };
    },
  } as unknown as D1Database;
}

describe('F11 rating平均', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE friends (id TEXT PRIMARY KEY, line_account_id TEXT, display_name TEXT);
      CREATE TABLE form_submissions (
        id TEXT PRIMARY KEY, form_id TEXT NOT NULL, friend_id TEXT,
        data TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, is_test INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE form_opens (id TEXT PRIMARY KEY, form_id TEXT NOT NULL, friend_id TEXT, opened_at TEXT NOT NULL, is_test INTEGER NOT NULL DEFAULT 0);
      INSERT INTO friends VALUES
        ('friend-a1', 'account-a', '山田'), ('friend-a2', 'account-a', '佐藤'),
        ('friend-a3', 'account-a', '田中'), ('friend-b1', 'account-b', '別店舗');
    `);
    sqlite.exec(migration);
    sqlite.exec(`
      INSERT INTO form_submissions (id, form_id, friend_id, data, created_at, is_test) VALUES
        ('r1', 'form-1', 'friend-a1', '{"satisfaction":5}', '2026-09-01', 0),
        ('r2', 'form-1', 'friend-a2', '{"satisfaction":1}', '2026-09-02', 0),
        ('r3', 'form-1', 'friend-a3', '{"other":"x"}', '2026-09-03', 0),
        ('bad0', 'form-1', 'friend-a1', '{"satisfaction":0}', '2026-09-04', 0),
        ('bad6', 'form-1', 'friend-a2', '{"satisfaction":6}', '2026-09-05', 0),
        ('badtext', 'form-1', 'friend-a1', '{"satisfaction":"good"}', '2026-09-06', 0),
        ('testrow', 'form-1', 'friend-a1', '{"satisfaction":5}', '2026-09-07', 1),
        ('other-account', 'form-1', 'friend-b1', '{"satisfaction":5}', '2026-09-08', 0),
        ('introw', 'form-1', 'friend-a3', '{"satisfaction":3}', '2026-09-09', 0),
        ('boolrow', 'form-1', 'friend-a1', '{"satisfaction":true}', '2026-09-10', 0),
        ('dotrow', 'form-1', 'friend-a2', '{"satisfaction":"3.0"}', '2026-09-11', 0),
        ('exprow', 'form-1', 'friend-a3', '{"satisfaction":"3e0"}', '2026-09-12', 0);
    `);
    db = asD1(sqlite);
  });

  test('項目ごとに非テスト全回答の平均、0と未回答nullを区別し不正旧値を混ぜない', async () => {
    const summary = await getFormSubmissionAnalytics(
      db, 'form-1', 'account-a', [], [{ key: 'satisfaction', label: '満足度' }],
    );
    expect(summary.ratingFields).toEqual([{
      key: 'satisfaction', label: '満足度', answered: 3, average: 3,
    }]);
  });

  test('真偽値・"3.0"・"3e0"は平均に入れない', async () => {
    const summary = await getFormSubmissionAnalytics(
      db, 'form-1', 'account-a', [], [{ key: 'satisfaction', label: '満足度' }],
    );
    // 5・1・整数3だけが有効。true・"3.0"・"3e0"・0・6・文字は除外。
    expect(summary.ratingFields[0]).toMatchObject({ answered: 3, average: 3 });
  });

  test('未回答だけならaverageはnull', async () => {
    const summary = await getFormSubmissionAnalytics(
      db, 'form-1', 'account-a', [], [{ key: 'no-such', label: '無い項目' }],
    );
    expect(summary.ratingFields).toEqual([{
      key: 'no-such', label: '無い項目', answered: 0, average: null,
    }]);
  });
});
