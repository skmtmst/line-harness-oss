import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(import.meta.dirname, '..', 'migrations', '201_ad_platform_account_scope.sql'),
  'utf8',
);

function setup(accountCount: number): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE line_accounts (id TEXT PRIMARY KEY);
    CREATE TABLE friends (
      id TEXT PRIMARY KEY,
      line_account_id TEXT REFERENCES line_accounts(id)
    );
    CREATE TABLE ad_platforms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      display_name TEXT,
      config TEXT NOT NULL DEFAULT '{}',
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE ad_conversion_logs (
      id TEXT PRIMARY KEY,
      ad_platform_id TEXT NOT NULL,
      friend_id TEXT NOT NULL,
      event_name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  for (let index = 1; index <= accountCount; index += 1) {
    db.prepare(`INSERT INTO line_accounts (id) VALUES (?)`).run(`account-${index}`);
  }
  db.exec(`
    INSERT INTO ad_platforms
      (id, name, config, created_at, updated_at)
    VALUES ('platform-1', 'google', '{}', '2026-08-01', '2026-08-01');
  `);
  return db;
}

describe('広告接続と送信履歴のLINEアカウント分離', () => {
  it('1アカウント環境の既存接続だけを安全に補完する', () => {
    const db = setup(1);
    db.exec(migration);

    expect(db.prepare(`SELECT line_account_id FROM ad_platforms WHERE id = 'platform-1'`).get())
      .toEqual({ line_account_id: 'account-1' });
  });

  it('複数アカウント環境の旧接続を推測しない', () => {
    const db = setup(2);
    db.exec(migration);

    expect(db.prepare(`SELECT line_account_id FROM ad_platforms WHERE id = 'platform-1'`).get())
      .toEqual({ line_account_id: null });
  });

  it('送信履歴は友だちの所属から補完する', () => {
    const db = setup(2);
    db.exec(`
      INSERT INTO friends (id, line_account_id) VALUES ('friend-1', 'account-2');
      INSERT INTO ad_conversion_logs
        (id, ad_platform_id, friend_id, event_name, created_at)
      VALUES ('log-1', 'platform-1', 'friend-1', 'Purchase', '2026-08-01');
    `);
    db.exec(migration);

    expect(db.prepare(`SELECT line_account_id FROM ad_conversion_logs WHERE id = 'log-1'`).get())
      .toEqual({ line_account_id: 'account-2' });
  });
});
