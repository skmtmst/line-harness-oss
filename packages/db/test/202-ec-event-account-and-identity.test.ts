import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(import.meta.dirname, '..', 'migrations', '202_ec_event_account_and_identity.sql'),
  'utf8',
);

function setup(): Database.Database {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE line_accounts (id TEXT PRIMARY KEY);
    CREATE TABLE friends (id TEXT PRIMARY KEY, line_account_id TEXT REFERENCES line_accounts(id));
    CREATE TABLE ec_events (
      id TEXT PRIMARY KEY, source TEXT NOT NULL, external_event_id TEXT NOT NULL,
      event_type TEXT NOT NULL, customer_id TEXT, line_user_id TEXT NOT NULL,
      friend_id TEXT REFERENCES friends(id), payload TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('received','processing','processed','skipped','failed')),
      error_message TEXT, received_at TEXT NOT NULL, processed_at TEXT, updated_at TEXT NOT NULL,
      UNIQUE(source, external_event_id)
    );
    INSERT INTO line_accounts VALUES ('account-a'), ('account-b');
    INSERT INTO friends VALUES ('friend-a', 'account-a');
    INSERT INTO ec_events VALUES
      ('legacy', 'eccube', 'event-legacy', 'ec.order.confirmed', NULL,
       'U00000000000000000000000000000000', 'friend-a', '{}', 'processed',
       NULL, '2026-08-01', '2026-08-01', '2026-08-01');
  `);
  sqlite.exec(migration);
  return sqlite;
}

describe('migration 202 EC event account and identity', () => {
  it('backfills legacy ownership and accepts an unmatched event', () => {
    const sqlite = setup();
    expect(sqlite.prepare('SELECT line_account_id FROM ec_events WHERE id = ?').get('legacy'))
      .toEqual({ line_account_id: 'account-a' });
    expect(() => sqlite.prepare(`INSERT INTO ec_events
      (id, source, external_event_id, event_type, line_account_id, line_user_id,
       payload, status, received_at, updated_at)
      VALUES ('unmatched', 'eccube:account-b', 'event-1', 'ec.order.confirmed',
       'account-b', NULL, '{}', 'identity_pending', '2026-08-02', '2026-08-02')`).run())
      .not.toThrow();
  });

  it('keeps equal provider event IDs separate for each account source', () => {
    const sqlite = setup();
    const insert = sqlite.prepare(`INSERT INTO ec_events
      (id, source, external_event_id, event_type, line_account_id, payload,
       status, received_at, updated_at)
      VALUES (?, ?, 'same-event', 'ec.order.confirmed', ?, '{}', 'identity_pending', '2026-08-02', '2026-08-02')`);
    insert.run('a', 'eccube:account-a', 'account-a');
    expect(() => insert.run('b', 'eccube:account-b', 'account-b')).not.toThrow();
  });
});
