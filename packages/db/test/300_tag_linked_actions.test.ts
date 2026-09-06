import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(import.meta.dirname, '..', 'migrations', '300_tag_linked_actions.sql'),
  'utf8',
);

describe('migration 300 tag linked actions', () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE line_accounts (id TEXT PRIMARY KEY);
      CREATE TABLE tags (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        line_account_id TEXT REFERENCES line_accounts(id),
        created_at TEXT NOT NULL
      );
      INSERT INTO line_accounts (id) VALUES ('account-a'), ('account-b');
      INSERT INTO tags (id, name, line_account_id, created_at)
      VALUES ('legacy', '既存', 'account-a', '2026-09-07T00:00:00.000Z');
    `);
    sqlite.exec(migration);
  });

  afterEach(() => sqlite.close());

  it('既存タグを初期設定と版1で引き継ぐ', () => {
    expect(sqlite.prepare(
      `SELECT manual_assignment_allowed, reapply_policy, linked_enabled,
              status, version, updated_at
         FROM tags WHERE id = 'legacy'`,
    ).get()).toEqual({
      manual_assignment_allowed: 1,
      reapply_policy: 'first_only',
      linked_enabled: 0,
      status: 'active',
      version: 1,
      updated_at: '2026-09-07T00:00:00.000Z',
    });
  });

  it('同じアカウントの正規化名を重複させない', () => {
    sqlite.prepare(
      `INSERT INTO tags (id, name, normalized_name, line_account_id, created_at)
       VALUES ('one', '会員A', '会員a', 'account-a', '2026-09-07')`,
    ).run();
    expect(() => sqlite.prepare(
      `INSERT INTO tags (id, name, normalized_name, line_account_id, created_at)
       VALUES ('two', '会員Ｂ', '会員a', 'account-a', '2026-09-07')`,
    ).run()).toThrow(/UNIQUE/);
  });

  it('状態・付け直し方針・版の壊れた値を拒否する', () => {
    expect(() => sqlite.prepare(
      `INSERT INTO tags
         (id, name, line_account_id, created_at, status, reapply_policy, version)
       VALUES ('bad', '不正', 'account-a', '2026-09-07', 'deleted', 'always', 0)`,
    ).run()).toThrow(/CHECK/);
  });
});

