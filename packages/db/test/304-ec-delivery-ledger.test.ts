/*
 * N-328 (#943): EC顧客通知を共通送信台帳へ書く `recordCustomerEcDelivery`
 * と、送信の正本を決める `getCustomerNotificationSource` を実SQLiteで固定する。
 *
 * 見る点:
 *  - 同一外部イベント・同一冪等キーは行を増やさない
 *  - 送信を試みた記録だけが試行回数・試行履歴を増やす
 *  - 受理済みの送達は、あとから来る失敗・対象外の記録で戻らない
 *  - 送る中身の正本は定義(published)で、無いイベントだけ null を返す
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getCustomerNotificationSource,
  recordCustomerEcDelivery,
} from '../src/line-notifications.js';

function asD1(sqlite: Database.Database): D1Database {
  const prepare = (sql: string): D1PreparedStatement => {
    const make = (params: unknown[]): D1PreparedStatement => {
      const execute = () => {
        const statement = sqlite.prepare(sql);
        if (statement.reader) {
          return { success: true, results: statement.all(...params), meta: { changes: 0 } };
        }
        const result = statement.run(...params);
        return { success: true, results: [], meta: { changes: result.changes } };
      };
      return {
        bind: (...next: unknown[]) => make(next),
        async all<T>() {
          return { success: true, results: sqlite.prepare(sql).all(...params) as T[], meta: {} };
        },
        async first<T>() {
          return (sqlite.prepare(sql).get(...params) as T | undefined) ?? null;
        },
        async run<T>() {
          return execute() as T;
        },
        raw: async () => [],
        __execute: execute,
      } as unknown as D1PreparedStatement;
    };
    return make([]);
  };
  return {
    prepare,
    async batch(statements: D1PreparedStatement[]) {
      const transaction = sqlite.transaction(() => statements.map((statement) =>
        (statement as unknown as { __execute: () => D1Result }).__execute()));
      return transaction();
    },
  } as unknown as D1Database;
}

let sqlite: Database.Database;
let db: D1Database;

const seed = `
  INSERT INTO line_accounts
    (id, channel_id, name, channel_access_token, channel_secret)
  VALUES ('account-a', 'channel-a', 'A店', 'token-a', 'secret-a'),
         ('account-b', 'channel-b', 'B店', 'token-b', 'secret-b');
`;

const acceptedInput = {
  lineAccountId: 'account-a',
  sourceEventType: 'ec.order.confirmed',
  sourceEventId: 'evt-1',
  recipientId: 'friend-1',
  idempotencyKey: 'retry-key-1',
  attemptedSend: true,
  finish: { kind: 'accepted', providerRequestId: 'req-1' },
} as const;

const instance = () => sqlite.prepare(
  `SELECT * FROM notification_instances WHERE line_account_id = 'account-a'`,
).all() as Record<string, unknown>[];
const delivery = () => sqlite.prepare(
  `SELECT * FROM notification_deliveries WHERE line_account_id = 'account-a'`,
).all() as Record<string, unknown>[];
const attempts = () => sqlite.prepare(
  `SELECT a.* FROM notification_delivery_attempts a
     JOIN notification_deliveries d ON d.id = a.delivery_id
    WHERE d.line_account_id = 'account-a' ORDER BY a.attempt_number`,
).all() as Record<string, unknown>[];

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
  sqlite.exec(seed);
  db = asD1(sqlite);
});

afterEach(() => sqlite.close());

describe('recordCustomerEcDelivery', () => {
  it('受理した送信は通知・送達・試行を1件ずつ残す', async () => {
    await recordCustomerEcDelivery(db, acceptedInput);

    expect(instance()).toHaveLength(1);
    expect(instance()[0]).toMatchObject({
      audience_type: 'customer',
      source_event_type: 'ec.order.confirmed',
      source_event_id: 'evt-1',
      dedupe_key: 'ec:evt-1',
      status: 'completed',
    });
    expect(delivery()).toHaveLength(1);
    expect(delivery()[0]).toMatchObject({
      audience_type: 'customer',
      recipient_type: 'friend',
      recipient_id: 'friend-1',
      channel: 'line',
      idempotency_key: 'retry-key-1',
      status: 'provider_accepted',
      attempts: 1,
      provider_request_id: 'req-1',
    });
    expect(attempts()).toHaveLength(1);
    expect(attempts()[0]).toMatchObject({
      attempt_number: 1,
      retry_key: 'retry-key-1',
      outcome: 'provider_accepted',
      provider_request_id: 'req-1',
    });
  });

  it('同じ外部イベント・同じ冪等キーは行を増やさない', async () => {
    await recordCustomerEcDelivery(db, acceptedInput);
    await recordCustomerEcDelivery(db, acceptedInput);

    expect(instance()).toHaveLength(1);
    expect(delivery()).toHaveLength(1);
    // 受理済みの送達は終端。重複して記録されても回数・履歴を水増ししない。
    expect(delivery()[0].attempts).toBe(1);
    expect(attempts()).toHaveLength(1);
  });

  it('送信を試みていない記録(対象外)は試行回数・試行履歴を増やさない', async () => {
    await recordCustomerEcDelivery(db, {
      ...acceptedInput,
      attemptedSend: false,
      finish: { kind: 'excluded', errorCode: 'notification_disabled', errorMessage: '停止中' },
    });

    expect(instance()[0]).toMatchObject({ status: 'excluded' });
    expect(delivery()[0]).toMatchObject({
      status: 'excluded', attempts: 0, error_code: 'notification_disabled',
    });
    expect(attempts()).toHaveLength(0);
  });

  it('失敗のあと同じ冪等キーで受理されると、失敗の行が受理へ確定する', async () => {
    await recordCustomerEcDelivery(db, {
      ...acceptedInput,
      finish: { kind: 'failed', errorCode: 'line_temporary_failure', errorMessage: '一時失敗' },
    });
    await recordCustomerEcDelivery(db, acceptedInput);

    expect(delivery()).toHaveLength(1);
    expect(delivery()[0]).toMatchObject({
      status: 'provider_accepted', attempts: 2, provider_request_id: 'req-1',
      error_code: null, error_message_safe: null,
    });
    expect(attempts()).toHaveLength(2);
    expect(attempts()[0]).toMatchObject({ attempt_number: 1, outcome: 'failed' });
    expect(attempts()[1]).toMatchObject({ attempt_number: 2, outcome: 'provider_accepted' });
  });

  it('受理済みの送達は、あとから来る失敗・対象外の記録で戻らない', async () => {
    await recordCustomerEcDelivery(db, acceptedInput);
    await recordCustomerEcDelivery(db, {
      ...acceptedInput,
      attemptedSend: true,
      finish: { kind: 'failed', errorCode: 'delivery_failed', errorMessage: '失敗' },
    });
    await recordCustomerEcDelivery(db, {
      ...acceptedInput,
      attemptedSend: false,
      finish: { kind: 'excluded', errorCode: 'notification_disabled', errorMessage: '停止中' },
    });

    expect(delivery()).toHaveLength(1);
    expect(delivery()[0]).toMatchObject({ status: 'provider_accepted', attempts: 1 });
    expect(attempts()).toHaveLength(1);
  });

  it('対象外の記録のあとに実送信が受理されると、同じ行が受理へ進む', async () => {
    await recordCustomerEcDelivery(db, {
      ...acceptedInput,
      attemptedSend: false,
      finish: { kind: 'excluded', errorCode: 'friend_not_following', errorMessage: '未フォロー' },
    });
    await recordCustomerEcDelivery(db, acceptedInput);

    expect(delivery()).toHaveLength(1);
    expect(delivery()[0]).toMatchObject({ status: 'provider_accepted', attempts: 1 });
    expect(attempts()).toHaveLength(1);
  });

  it('アカウントごとに行が分かれる', async () => {
    await recordCustomerEcDelivery(db, acceptedInput);
    await recordCustomerEcDelivery(db, {
      ...acceptedInput,
      lineAccountId: 'account-b',
      recipientId: 'friend-2',
    });

    expect(
      sqlite.prepare(`SELECT COUNT(*) AS n FROM notification_instances`).get(),
    ).toMatchObject({ n: 2 });
    expect(
      sqlite.prepare(`SELECT COUNT(*) AS n FROM notification_deliveries`).get(),
    ).toMatchObject({ n: 2 });
    expect(delivery()).toHaveLength(1);
    expect(delivery()[0]).toMatchObject({ recipient_id: 'friend-1' });
  });
});

describe('getCustomerNotificationSource', () => {
  const seedDefinition = (status: string, configJson = '{}') => sqlite.exec(`
    INSERT INTO customer_notification_definitions
      (id, line_account_id, key, name, category, source_event_type, status,
       current_version_id, draft_config_json, version, created_by, updated_by,
       created_at, updated_at)
    VALUES ('def-1', 'account-a', 'ec:ec.order.confirmed', '注文受付', 'order',
            'ec.order.confirmed', '${status}', 'ver-1', '{}', 1, 'staff', 'staff',
            '2026-09-01', '2026-09-01');
    INSERT INTO customer_notification_versions
      (id, definition_id, version_number, config_json, line_template_json,
       published_by, published_at)
    VALUES ('ver-1', 'def-1', 3, '${configJson.replaceAll("'", "''")}', '[]',
            'staff', '2026-09-01');
  `);

  it('定義が無いイベントは null(呼び出し側が従来設定へ倒れる)', async () => {
    expect(await getCustomerNotificationSource(db, 'account-a', 'ec.order.confirmed')).toBeNull();
  });

  it('published の定義は確定済み版の config を返す', async () => {
    seedDefinition('published', JSON.stringify({ introText: '公開版の本文' }));
    const source = await getCustomerNotificationSource(db, 'account-a', 'ec.order.confirmed');
    expect(source).toMatchObject({
      definitionId: 'def-1', status: 'published',
      versionId: 'ver-1', versionNumber: 3,
    });
    expect(source?.config).toMatchObject({ introText: '公開版の本文' });
  });

  it('stopped/draft の定義も返す(送るかは呼び出し側が status で決める)', async () => {
    seedDefinition('stopped');
    expect(await getCustomerNotificationSource(db, 'account-a', 'ec.order.confirmed'))
      .toMatchObject({ status: 'stopped' });
  });

  it('アカウントをまたいだ定義は拾わない', async () => {
    sqlite.exec(`
      INSERT INTO customer_notification_definitions
        (id, line_account_id, key, name, category, source_event_type, status,
         draft_config_json, version, created_by, updated_by, created_at, updated_at)
      VALUES ('def-b', 'account-b', 'ec:ec.order.confirmed', '注文受付', 'order',
              'ec.order.confirmed', 'published', '{}', 1, 'staff', 'staff',
              '2026-09-01', '2026-09-01');
    `);
    expect(await getCustomerNotificationSource(db, 'account-a', 'ec.order.confirmed')).toBeNull();
  });
});
