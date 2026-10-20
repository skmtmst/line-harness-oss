import { beforeEach, describe, expect, test } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION = readFileSync(
  join(HERE, '..', 'migrations', '167_outbound_send_idempotency.sql'),
  'utf8',
);

describe('167_outbound_send_idempotency.sql', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(MIGRATION);
  });

  test('同じ冪等キーを2回予約できない', () => {
    const insert = db.prepare(
      `INSERT INTO outbound_send_requests
         (idempotency_key, channel, resource_id, payload_hash, status, created_at, updated_at)
       VALUES (?, 'line', 'friend-1', 'hash-1', 'in_progress', ?, ?)`,
    );
    insert.run('key-1', '2026-08-21T00:00:00Z', '2026-08-21T00:00:00Z');
    expect(() => insert.run(
      'key-1',
      '2026-08-21T00:00:01Z',
      '2026-08-21T00:00:01Z',
    )).toThrow(/UNIQUE constraint failed/);
  });

  test('許可していないチャネルと状態を拒否する', () => {
    expect(() => db.exec(
      `INSERT INTO outbound_send_requests
         (idempotency_key, channel, resource_id, payload_hash, status, created_at, updated_at)
       VALUES ('bad-channel', 'sms', 'friend-1', 'hash', 'in_progress', 'now', 'now')`,
    )).toThrow(/CHECK constraint failed/);
    expect(() => db.exec(
      `INSERT INTO outbound_send_requests
         (idempotency_key, channel, resource_id, payload_hash, status, created_at, updated_at)
       VALUES ('bad-status', 'email', 'thread-1', 'hash', 'failed', 'now', 'now')`,
    )).toThrow(/CHECK constraint failed/);
  });

  test('作成日時の索引を作る', () => {
    const row = db.prepare(
      `SELECT name FROM sqlite_master
        WHERE type = 'index' AND name = 'idx_outbound_send_requests_created'`,
    ).get() as { name: string } | undefined;
    expect(row?.name).toBe('idx_outbound_send_requests_created');
  });
});
