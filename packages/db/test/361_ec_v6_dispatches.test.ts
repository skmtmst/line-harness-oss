import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NOW = '2026-09-09 03:30:00';

const UPSERT = `INSERT INTO ec_v6_dispatches
    (event_id, subscriber, status, attempt_count, last_error, idempotency_key, updated_at)
   VALUES (?, ?, ?, 1, ?, ?, ?)
   ON CONFLICT(event_id, subscriber) DO UPDATE SET
     status = excluded.status,
     attempt_count = ec_v6_dispatches.attempt_count + 1,
     last_error = excluded.last_error,
     idempotency_key = excluded.idempotency_key,
     updated_at = excluded.updated_at`;

describe('EC購読先別配送台帳(migration 361)', () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(ROOT, 'bootstrap.sql'), 'utf8'));
    sqlite.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
       VALUES ('account-a', 'ca', 'A', 'ta', 'sa')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO ec_events
         (id, source, external_event_id, event_type, line_account_id, customer_id,
          line_user_id, payload, status, received_at, updated_at)
       VALUES ('evt-row-1', 'eccube:account-a', 'event-12345678', 'ec.order.confirmed',
               'account-a', 'customer-1', 'U1', '{}', 'processing', ?, ?)`,
    ).run(NOW, NOW);
  });

  afterEach(() => sqlite.close());

  it('通知とV6の行を分け、再試行で試行回数だけ増やす', () => {
    const upsert = sqlite.prepare(UPSERT);
    upsert.run('evt-row-1', 'notification', 'sent', null, 'eccube:account-a:event-12345678:notification', NOW);
    upsert.run('evt-row-1', 'v6', 'failed', 'db is busy', 'eccube:account-a:event-12345678:v6', NOW);
    // V6だけ再試行して成功する。通知行には触らない。
    upsert.run('evt-row-1', 'v6', 'sent', null, 'eccube:account-a:event-12345678:v6', NOW);

    const rows = sqlite.prepare(
      `SELECT subscriber, status, attempt_count, last_error FROM ec_v6_dispatches ORDER BY subscriber`,
    ).all();
    expect(rows).toEqual([
      { subscriber: 'notification', status: 'sent', attempt_count: 1, last_error: null },
      { subscriber: 'v6', status: 'sent', attempt_count: 2, last_error: null },
    ]);
  });

  it('安定キーの二重登録と台帳外の値を拒否する', () => {
    const upsert = sqlite.prepare(UPSERT);
    upsert.run('evt-row-1', 'notification', 'sent', null, 'eccube:account-a:event-12345678:notification', NOW);
    expect(() => upsert.run(
      'evt-row-1', 'v6', 'sent', null, 'eccube:account-a:event-12345678:notification', NOW,
    )).toThrow();
    expect(() => upsert.run('evt-row-1', 'push', 'sent', null, 'k1', NOW)).toThrow();
    expect(() => upsert.run('evt-row-1', 'v6', 'done', null, 'k2', NOW)).toThrow();
  });
});
