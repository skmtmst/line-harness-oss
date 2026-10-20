import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';

const migration = readFileSync(
  join(import.meta.dirname, '../migrations/409_outbound_send_failure_ledger.sql'),
  'utf8',
);

function legacyDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE line_accounts (id TEXT PRIMARY KEY);
    CREATE TABLE outbound_send_requests (
      idempotency_key TEXT PRIMARY KEY,
      channel TEXT NOT NULL CHECK (channel IN ('line', 'email')),
      resource_id TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('in_progress', 'succeeded')),
      response_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE INDEX idx_outbound_send_requests_created ON outbound_send_requests(created_at);
    INSERT INTO outbound_send_requests
      (idempotency_key, channel, resource_id, payload_hash, status, response_id,
       created_at, updated_at, completed_at)
    VALUES
      ('old-progress', 'line', 'chat-1', 'hash-1', 'in_progress', NULL,
       '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', NULL),
      ('old-success', 'line', 'chat-2', 'hash-2', 'succeeded', 'message-2',
       '2026-09-01T00:00:00.000Z', '2026-09-01T00:01:00.000Z', '2026-09-01T00:01:00.000Z');
  `);
  return db;
}

describe('409_outbound_send_failure_ledger.sql', () => {
  test('旧行を保ったまま失敗・送達不明・lease列と索引を追加する', () => {
    const db = legacyDb();
    db.exec(migration);
    expect(db.prepare(
      `SELECT idempotency_key, status, attempt_count, retryable, lease_token
         FROM outbound_send_requests ORDER BY idempotency_key`,
    ).all()).toEqual([
      { idempotency_key: 'old-progress', status: 'in_progress', attempt_count: 1, retryable: 0, lease_token: null },
      { idempotency_key: 'old-success', status: 'succeeded', attempt_count: 1, retryable: 0, lease_token: null },
    ]);
    const indexes = db.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'outbound_send_requests'`,
    ).all() as Array<{ name: string }>;
    expect(indexes.map((row) => row.name)).toEqual(expect.arrayContaining([
      'idx_outbound_send_requests_created',
      'idx_outbound_send_requests_account_failure',
      'idx_outbound_send_requests_active_lease',
    ]));
    db.close();
  });

  test('unknownをretryableにはできず、失敗code無しも拒否する', () => {
    const db = legacyDb();
    db.exec(migration);
    expect(() => db.prepare(`
      INSERT INTO outbound_send_requests
        (idempotency_key, channel, resource_id, payload_hash, status, failure_code,
         attempt_count, retryable, last_failed_at, created_at, updated_at)
      VALUES ('bad-unknown', 'line', 'chat', 'hash', 'unknown', 'LINE_DELIVERY_UNKNOWN',
              1, 1, '2026-09-16T00:00:00.000Z', '2026-09-16T00:00:00.000Z', '2026-09-16T00:00:00.000Z')
    `).run()).toThrow();
    expect(() => db.prepare(`
      INSERT INTO outbound_send_requests
        (idempotency_key, channel, resource_id, payload_hash, status,
         attempt_count, retryable, last_failed_at, created_at, updated_at)
      VALUES ('bad-code', 'line', 'chat', 'hash', 'failed',
              1, 0, '2026-09-16T00:00:00.000Z', '2026-09-16T00:00:00.000Z', '2026-09-16T00:00:00.000Z')
    `).run()).toThrow();
    db.close();
  });

  test('D1遠隔で拒否されるPRAGMAを含まない', () => {
    expect(migration).not.toMatch(/\bPRAGMA\b/i);
  });
});
