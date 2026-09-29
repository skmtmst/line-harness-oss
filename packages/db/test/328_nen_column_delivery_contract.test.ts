import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(import.meta.dirname, '..', 'migrations', '328_nen_column_delivery_contract.sql'),
  'utf8',
);

describe('328 NEN column delivery contract', () => {
  it('adds targeting and completion fields plus an idempotent read-event ledger', () => {
    const db = new Database(':memory:');
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE line_accounts (id TEXT PRIMARY KEY);
      CREATE TABLE friends (id TEXT PRIMARY KEY);
      CREATE TABLE tags (id TEXT PRIMARY KEY);
      CREATE TABLE nen_columns (
        id TEXT PRIMARY KEY, line_account_id TEXT, delivery_status TEXT NOT NULL DEFAULT 'draft'
      );
    `);
    db.exec(migration);

    const fields = db.prepare(`PRAGMA table_info(nen_columns)`).all() as Array<{ name: string }>;
    expect(fields.map((field) => field.name)).toEqual(expect.arrayContaining([
      'target_mode', 'target_tag_id', 'completion_event_name', 'completion_tag_id', 'source_column_id',
    ]));

    db.prepare(`INSERT INTO line_accounts (id) VALUES ('account-a')`).run();
    db.prepare(`INSERT INTO friends (id) VALUES ('friend-a')`).run();
    db.prepare(`INSERT INTO nen_columns (id, line_account_id) VALUES ('column-a', 'account-a')`).run();
    const insert = db.prepare(`INSERT INTO nen_column_read_events
      (id, line_account_id, column_id, friend_id, event_kind, idempotency_key, occurred_at, created_at)
      VALUES (?, 'account-a', 'column-a', 'friend-a', 'completed', 'read-1', '2026-09-07', '2026-09-07')`);
    insert.run('event-a');
    expect(() => insert.run('event-b')).toThrow(/UNIQUE/);
  });
});
