import { beforeEach, describe, expect, test } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION = readFileSync(
  join(HERE, '..', 'migrations', '178_line_webhook_events.sql'),
  'utf8',
);

describe('178_line_webhook_events.sql', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(MIGRATION);
  });

  test('同じイベントIDは1行だけ記録する', () => {
    const insert = db.prepare(
      `INSERT OR IGNORE INTO line_webhook_events
         (webhook_event_id, line_account_id, event_type)
       VALUES (?, ?, ?)`,
    );
    expect(insert.run('evt-1', 'account-1', 'message').changes).toBe(1);
    expect(insert.run('evt-1', 'account-1', 'message').changes).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM line_webhook_events').get()).toEqual({ count: 1 });
  });

  test('マイグレーションを2回実行しても壊れない', () => {
    expect(() => db.exec(MIGRATION)).not.toThrow();
    const indexes = db.prepare(
      `SELECT name FROM sqlite_master
        WHERE type = 'index' AND name LIKE 'idx_line_webhook_events_%'
        ORDER BY name`,
    ).all() as Array<{ name: string }>;
    expect(indexes.map((row) => row.name)).toEqual([
      'idx_line_webhook_events_account',
      'idx_line_webhook_events_status',
    ]);
  });

  test('個人情報やWebhook本文を保存する列を持たない', () => {
    const columns = db.prepare('PRAGMA table_info(line_webhook_events)').all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toEqual([
      'webhook_event_id',
      'line_account_id',
      'event_type',
      'status',
      'attempts',
      'last_error',
      'received_at',
      'updated_at',
    ]);
    const source = MIGRATION.toLowerCase();
    for (const forbidden of ['line_user_id', 'display_name', 'message_content', 'request_body', 'payload']) {
      expect(source).not.toContain(forbidden);
    }
  });

  test('許可されていない状態を拒否する', () => {
    expect(() => db.exec(
      `INSERT INTO line_webhook_events (webhook_event_id, event_type, status)
       VALUES ('evt-bad', 'message', 'retrying')`,
    )).toThrow(/CHECK constraint failed/);
  });

  test('失敗回数と短い分類だけを更新する', () => {
    db.exec(
      `INSERT INTO line_webhook_events
         (webhook_event_id, line_account_id, event_type, status)
       VALUES ('evt-failed', 'account-1', 'message', 'processing')`,
    );
    db.prepare(
      `UPDATE line_webhook_events
          SET status = 'failed', attempts = attempts + 1, last_error = ?
        WHERE webhook_event_id = ?`,
    ).run('line_api_error', 'evt-failed');
    expect(db.prepare(
      `SELECT status, attempts, last_error FROM line_webhook_events
        WHERE webhook_event_id = 'evt-failed'`,
    ).get()).toEqual({ status: 'failed', attempts: 1, last_error: 'line_api_error' });

    expect(() => db.prepare(
      `UPDATE line_webhook_events SET last_error = ? WHERE webhook_event_id = ?`,
    ).run('raw exception text', 'evt-failed')).toThrow(/CHECK constraint failed/);
  });
});
