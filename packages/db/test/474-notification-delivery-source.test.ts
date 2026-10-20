import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createCustomerTestInstance,
  recordCustomerEcDelivery,
  recordCustomerTestDelivery,
} from '../src/line-notifications.js';
import { getDeliveryFailureOrigins } from '../src/notification-delivery-origins.js';

const migration304 = readFileSync(
  join(import.meta.dirname, '..', 'migrations', '304_line_notification_delivery_ledger.sql'),
  'utf8',
);
const migration474 = readFileSync(
  join(import.meta.dirname, '..', 'migrations', '474_notification_delivery_source.sql'),
  'utf8',
);

function asD1(sqlite: Database.Database): D1Database {
  const wrap = (query: string, params: unknown[]) => ({
    async run() {
      const info = sqlite.prepare(query).run(...params);
      return { results: [], success: true, meta: { changes: info.changes } };
    },
    async first<T>() {
      return (sqlite.prepare(query).get(...params) as T) ?? null;
    },
    async all<T>() {
      return { results: sqlite.prepare(query).all(...params) as T[], success: true, meta: {} };
    },
    async batch() {
      throw new Error('batch is not supported in this test');
    },
  });
  return {
    prepare(query: string) {
      return { bind: (...params: unknown[]) => wrap(query, params), ...wrap(query, []) };
    },
    batch(statements: { run(): Promise<unknown> }[]) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
  } as unknown as D1Database;
}

const SINCE = '2026-09-27T00:00:00+09:00';

function insertInstance(
  sqlite: Database.Database,
  input: { id: string; account: string; eventType: string; eventId: string },
): void {
  sqlite.prepare(`
    INSERT INTO notification_instances
      (id, line_account_id, audience_type, source_event_type, source_event_id,
       dedupe_key, status, created_at, updated_at)
    VALUES (?, ?, 'customer', ?, ?, ?, 'failed', '2026-09-27T10:00:00+09:00', '2026-09-27T10:00:00+09:00')
  `).run(input.id, input.account, input.eventType, input.eventId, `dedupe:${input.id}`);
}

function insertDelivery(
  sqlite: Database.Database,
  input: {
    id: string;
    account: string;
    instanceId: string;
    mode?: string;
    source?: string | null;
    failedAt?: string | null;
  },
): void {
  sqlite.prepare(`
    INSERT INTO notification_deliveries
      (id, line_account_id, instance_id, audience_type, recipient_type, recipient_id,
       channel, idempotency_key, status, retryable, attempts, queued_at,
       failed_at, execution_mode, version, updated_at, source)
    VALUES (?, ?, ?, 'customer', 'friend', 'friend-a', 'line', ?, 'failed',
            0, 1, '2026-09-27T10:00:00+09:00', ?, ?, 1,
            '2026-09-27T10:00:00+09:00', ?)
  `).run(
    input.id, input.account, input.instanceId, `key:${input.id}`,
    input.failedAt ?? '2026-09-27T10:00:00+09:00',
    input.mode ?? 'automatic', input.source ?? null,
  );
}

describe('migration 474 通知送達の出どころ欄', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(`CREATE TABLE line_accounts (id TEXT PRIMARY KEY);`);
    sqlite.exec(`INSERT INTO line_accounts (id) VALUES ('account-a');`);
    sqlite.exec(migration304);
    sqlite.exec(migration474);
    db = asD1(sqlite);
  });

  afterEach(() => sqlite.close());

  it('既存行の出どころを親インスタンスから埋める', () => {
    insertInstance(sqlite, { id: 'inst-a', account: 'account-a', eventType: 'broadcast.failed', eventId: 'e-a' });
    sqlite.prepare(`
      INSERT INTO notification_deliveries
        (id, line_account_id, instance_id, audience_type, recipient_type, recipient_id,
         channel, idempotency_key, status, queued_at, updated_at)
      VALUES ('delivery-a', 'account-a', 'inst-a', 'customer', 'friend', 'friend-a',
              'line', 'key-a', 'failed', '2026-09-27T10:00:00+09:00', '2026-09-27T10:00:00+09:00')
    `).run();
    // 埋める UPDATE をもう一度流しても結果は同じ(冪等)。
    sqlite.exec(`
      UPDATE notification_deliveries
      SET source = (
        SELECT i.source_event_type
        FROM notification_instances i
        WHERE i.id = notification_deliveries.instance_id
      )
      WHERE source IS NULL
    `);
    const row = sqlite.prepare(`SELECT source FROM notification_deliveries WHERE id = 'delivery-a'`).get() as {
      source: string | null;
    };
    expect(row.source).toBe('broadcast.failed');
  });

  it('EC送達の書き込みで出どころが入る', async () => {
    await recordCustomerEcDelivery(db, {
      lineAccountId: 'account-a',
      sourceEventType: 'ec.order.shipped',
      sourceEventId: 'event-ec-1',
      recipientId: 'friend-a',
      idempotencyKey: 'ec-key-1',
      attemptedSend: false,
      finish: { kind: 'failed', errorCode: 'E1', errorMessage: '失敗' },
    });
    const row = sqlite.prepare(`SELECT source, execution_mode FROM notification_deliveries WHERE idempotency_key = 'ec-key-1'`).get() as {
      source: string | null;
      execution_mode: string;
    };
    expect(row.source).toBe('ec.order.shipped');
    expect(row.execution_mode).toBe('automatic');
  });

  it('試し送りの書き込みで出どころが親から写る', async () => {
    const created = await createCustomerTestInstance(db, {
      lineAccountId: 'account-a',
      definitionId: 'def-a',
      definitionVersionId: null,
      sourceEventType: 'ec.order.confirmed',
    });
    await recordCustomerTestDelivery(db, {
      lineAccountId: 'account-a',
      instanceId: created.instanceId,
      recipientId: 'friend-a',
      idempotencyKey: 'test-key-1',
      outcome: 'failed',
    });
    const row = sqlite.prepare(`SELECT source FROM notification_deliveries WHERE idempotency_key = 'test-key-1'`).get() as {
      source: string | null;
    };
    expect(row.source).toBe('ec.order.confirmed');
  });

  it('同じ失敗は1件に数え、送り直し・試し送りは数えない', async () => {
    insertInstance(sqlite, { id: 'inst-a', account: 'account-a', eventType: 'broadcast.failed', eventId: 'e-a' });
    insertInstance(sqlite, { id: 'inst-b', account: 'account-a', eventType: 'broadcast.failed', eventId: 'e-b' });
    insertInstance(sqlite, { id: 'inst-c', account: 'account-a', eventType: 'scenario.failed', eventId: 'e-c' });
    // 同じ失敗の送達が2行あっても1件。
    insertDelivery(sqlite, { id: 'd-a1', account: 'account-a', instanceId: 'inst-a', source: 'broadcast.failed' });
    insertDelivery(sqlite, { id: 'd-a2', account: 'account-a', instanceId: 'inst-a', source: 'broadcast.failed' });
    insertDelivery(sqlite, { id: 'd-b1', account: 'account-a', instanceId: 'inst-b', source: 'broadcast.failed' });
    // 送り直し・試し送りは数えない。
    insertDelivery(sqlite, { id: 'd-a-resend', account: 'account-a', instanceId: 'inst-a', mode: 'resend', source: 'broadcast.failed' });
    insertDelivery(sqlite, { id: 'd-a-retry', account: 'account-a', instanceId: 'inst-a', mode: 'retry', source: 'broadcast.failed' });
    insertDelivery(sqlite, { id: 'd-c-test', account: 'account-a', instanceId: 'inst-c', mode: 'test', source: 'scenario.failed' });
    // 期間より前・別アカウントは数えない。
    insertDelivery(sqlite, {
      id: 'd-old', account: 'account-a', instanceId: 'inst-b', source: 'broadcast.failed',
      failedAt: '2026-09-26T23:59:59+09:00',
    });

    const result = await getDeliveryFailureOrigins(db, { lineAccountId: 'account-a', since: SINCE });
    expect(result.total).toBe(2);
    expect(result.asOf).toBe('2026-09-27T10:00:00+09:00');
    expect(result.origins).toHaveLength(1);
    expect(result.origins[0]).toMatchObject({ source: 'broadcast.failed', failures: 2 });
    // 代表の送達IDは重複なし・新しい順の while 台帳へつながる。
    expect(result.origins[0].sampleDeliveryIds).toHaveLength(2);

    // 台帳を直接数えた件数と一致する。
    const raw = sqlite.prepare(`
      SELECT COUNT(DISTINCT instance_id) AS c FROM notification_deliveries
       WHERE line_account_id = 'account-a' AND status = 'failed'
         AND execution_mode = 'automatic' AND failed_at >= ?
    `).get(SINCE) as { c: number };
    expect(result.total).toBe(Number(raw.c));
  });

  it('失敗が無いときは0件・時点なし', async () => {
    const result = await getDeliveryFailureOrigins(db, { lineAccountId: 'account-a', since: SINCE });
    expect(result).toEqual({ total: 0, asOf: null, origins: [] });
  });
});
