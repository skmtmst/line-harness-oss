import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(import.meta.dirname, '..', 'migrations', '315_line_account_connection_checks.sql'),
  'utf8',
);

function setup() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE line_accounts (
      id TEXT PRIMARY KEY,
      archived_at TEXT,
      updated_at TEXT NOT NULL
    );
    INSERT INTO line_accounts (id, archived_at, updated_at)
    VALUES ('account-1', NULL, '2026-09-07T00:00:00.000+09:00');
  `);
  db.exec(migration);
  return db;
}

describe('315 line account connection checks', () => {
  it('adds a version initialized to one and stores a complete check row', () => {
    const db = setup();
    expect(db.prepare('SELECT revision FROM line_accounts WHERE id = ?').get('account-1'))
      .toEqual({ revision: 1 });

    db.prepare(`
      INSERT INTO line_account_connection_checks (
        id, line_account_id, check_kind, result, expected_url, registered_url,
        webhook_active, http_status, checked_by, checked_at, correlation_id,
        idempotency_key, account_revision
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'check-1', 'account-1', 'webhook_endpoint', 'matched',
      'https://worker.example.com/webhook', 'https://worker.example.com/webhook',
      1, 200, 'staff-1', '2026-09-07T01:00:00.000+09:00',
      'correlation-1', 'account-check-0001', 2,
    );

    expect(db.prepare(`
      SELECT result, registered_url, webhook_active, http_status, account_revision
        FROM line_account_connection_checks WHERE id = ?
    `).get('check-1')).toEqual({
      result: 'matched',
      registered_url: 'https://worker.example.com/webhook',
      webhook_active: 1,
      http_status: 200,
      account_revision: 2,
    });
    db.close();
  });

  it('prevents duplicate idempotency keys per check kind and invalid states', () => {
    const db = setup();
    const insert = db.prepare(`
      INSERT INTO line_account_connection_checks (
        id, line_account_id, check_kind, result, checked_by, checked_at,
        correlation_id, idempotency_key, account_revision
      ) VALUES (?, 'account-1', 'bot_info', ?, 'staff-1', 'now', 'c1', 'same-key', 2)
    `);
    insert.run('check-1', 'ok');
    expect(() => insert.run('check-2', 'ok')).toThrow(/UNIQUE/);
    expect(() => db.prepare(`
      INSERT INTO line_account_connection_checks (
        id, line_account_id, check_kind, result, checked_by, checked_at,
        correlation_id, idempotency_key, account_revision
      ) VALUES ('check-3', 'account-1', 'bot_info', 'invalid', 'staff-1', 'now', 'c2', 'other-key', 2)
    `).run()).toThrow(/CHECK/);
    db.close();
  });
});
