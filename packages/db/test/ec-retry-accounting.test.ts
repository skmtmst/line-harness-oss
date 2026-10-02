import { describe, expect, test, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { setEcActionExecutionStatus } from '../src/ec-operations.js';
import { asD1 } from './d1-test-helper.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');

let sqlite: Database.Database;
let db: D1Database;

const NOW = '2026-09-20T10:00:00.000Z';

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(PKG_ROOT, 'bootstrap.sql'), 'utf8'));
  db = asD1(sqlite);
  sqlite.exec(`
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
    VALUES ('account-a', 'channel-a', '本店', 'token', 'secret');
    INSERT INTO ec_events (id, source, external_event_id, event_type, line_account_id, customer_id,
      line_user_id, payload, status, received_at, updated_at)
    VALUES ('row-1', 'eccube', 'evt-1', 'ec.order.confirmed', 'account-a', 'C-1',
      'U-1', '{}', 'failed', '${NOW}', '${NOW}');
    INSERT INTO ec_action_executions
      (id, event_id, line_account_id, action_type, rule_version, idempotency_key, status,
       attempt_count, max_attempts, version, created_at, updated_at)
    VALUES ('exec-1', 'row-1', 'account-a', 'customer_notification', 'v1',
      'key-1', 'retryable_failed', 0, 3, 1, '${NOW}', '${NOW}');
  `);
});

function execution() {
  return sqlite.prepare(`SELECT * FROM ec_action_executions WHERE id = 'exec-1'`).get() as {
    status: string; attempt_count: number; next_retry_at: string | null;
  };
}

/*
 * EC の再試行は上限つきで、超えたら dead letter。
 *
 * 失敗の報告は試行回数に数え、次はいつ回すか（next_retry_at）を決める。
 * 上限に達した失敗は permanent_failed へ倒し、それ以上は触らない。
 */
describe('EC再試行の回数計算 (P1-23)', () => {
  test('失敗のたびに回数が増え、次回時刻が決まる', async () => {
    await setEcActionExecutionStatus(db, {
      eventId: 'row-1', lineAccountId: 'account-a', status: 'retryable_failed',
      errorCode: 'line_is_down', errorMessageSafe: 'LINEが混み合っています', now: NOW,
    });
    const first = execution();
    expect(first.status).toBe('retryable_failed');
    expect(first.attempt_count).toBe(1);
    expect(first.next_retry_at, '次回時刻が決まっていない').not.toBeNull();
    const firstAt = new Date(first.next_retry_at!).getTime() - new Date(NOW).getTime();
    // 1回目の待ちは5分前後（±10%のぶれ）。
    expect(firstAt).toBeGreaterThanOrEqual(270_000);
    expect(firstAt).toBeLessThanOrEqual(330_000);

    await setEcActionExecutionStatus(db, {
      eventId: 'row-1', lineAccountId: 'account-a', status: 'retryable_failed',
      errorCode: 'line_is_down', errorMessageSafe: 'LINEが混み合っています', now: NOW,
    });
    const second = execution();
    expect(second.attempt_count).toBe(2);
    expect(second.status).toBe('retryable_failed');
  });

  test('上限に達したら dead letter へ倒す', async () => {
    for (let i = 0; i < 3; i += 1) {
      await setEcActionExecutionStatus(db, {
        eventId: 'row-1', lineAccountId: 'account-a', status: 'retryable_failed',
        errorCode: 'line_is_down', errorMessageSafe: 'x', now: NOW,
      });
    }
    const row = execution();
    expect(row.attempt_count).toBe(3);
    expect(row.status).toBe('permanent_failed');
    expect(row.next_retry_at).toBeNull();
  });

  test('成功は回数を増やさず待ちも消す', async () => {
    await setEcActionExecutionStatus(db, {
      eventId: 'row-1', lineAccountId: 'account-a', status: 'retryable_failed',
      errorCode: 'line_is_down', errorMessageSafe: 'x', now: NOW,
    });
    await setEcActionExecutionStatus(db, {
      eventId: 'row-1', lineAccountId: 'account-a', status: 'succeeded', now: NOW,
    });
    const row = execution();
    expect(row.status).toBe('succeeded');
    expect(row.attempt_count).toBe(1);
    expect(row.next_retry_at).toBeNull();
  });
});
