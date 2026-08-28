import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { finishAdConversionAttempt, reserveAdConversion } from '../src/ad-platforms.js';
import { asD1 } from './d1-test-helper.js';

const migration = readFileSync(
  join(import.meta.dirname, '..', 'migrations', '198_ad_conversion_idempotency.sql'),
  'utf8',
);

function setup(): Database.Database {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE ad_conversion_logs (
      id TEXT PRIMARY KEY,
      line_account_id TEXT,
      ad_platform_id TEXT NOT NULL,
      friend_id TEXT NOT NULL,
      conversion_point_id TEXT,
      event_name TEXT NOT NULL,
      click_id TEXT,
      click_id_type TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      request_body TEXT,
      response_body TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL
    );
    INSERT INTO ad_conversion_logs
      (id, ad_platform_id, friend_id, event_name, status, created_at)
    VALUES ('legacy', 'platform-a', 'friend-a', 'Purchase', 'sent', '2026-08-01T00:00:00Z');
  `);
  sqlite.exec(migration);
  return sqlite;
}

describe('広告成果の重複防止と再試行', () => {
  it('既存履歴を残し、同じ冪等キーを一度だけ予約する', async () => {
    const sqlite = setup();
    const db = asD1(sqlite);
    expect(sqlite.prepare('SELECT updated_at FROM ad_conversion_logs WHERE id = ?').get('legacy'))
      .toEqual({ updated_at: '2026-08-01T00:00:00Z' });

    const input = {
      platformId: 'platform-a', friendId: 'friend-a', eventName: 'Purchase',
      lineAccountId: 'account-a',
      clickId: 'click-a', clickIdType: 'gclid', idempotencyKey: 'event-a:google',
    };
    const first = await reserveAdConversion(db, input);
    const duplicate = await reserveAdConversion(db, input);
    expect(first?.status).toBe('pending');
    expect(first?.attempt_count).toBe(0);
    expect(duplicate).toBeNull();
  });

  it('失敗した試行の回数と次の再試行時刻を残す', async () => {
    const sqlite = setup();
    const db = asD1(sqlite);
    const row = await reserveAdConversion(db, {
      platformId: 'platform-a', friendId: 'friend-a', eventName: 'Purchase',
      lineAccountId: 'account-a',
      clickId: 'click-a', clickIdType: 'gclid', idempotencyKey: 'event-b:google',
    });
    expect(row).not.toBeNull();

    await finishAdConversionAttempt(db, row!.id, {
      status: 'retry_wait', errorMessage: '一時的な失敗', nextRetryAt: '2026-08-28T09:05:00Z',
    });
    expect(sqlite.prepare(`
      SELECT status, attempt_count, error_message, next_retry_at
        FROM ad_conversion_logs WHERE id = ?
    `).get(row!.id)).toEqual({
      status: 'retry_wait', attempt_count: 1, error_message: '一時的な失敗',
      next_retry_at: '2026-08-28T09:05:00Z',
    });
  });
});
