import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(import.meta.dirname, '..', 'migrations', '304_line_notification_delivery_ledger.sql'),
  'utf8',
);

describe('migration 304 LINE notification delivery ledger', () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE line_accounts (id TEXT PRIMARY KEY);
      INSERT INTO line_accounts (id) VALUES ('account-a'), ('account-b');
    `);
    sqlite.exec(migration);
  });

  afterEach(() => sqlite.close());

  it('公開版を定義ごとの連番で保存し、同じ版を上書きしない', () => {
    sqlite.prepare(`
      INSERT INTO customer_notification_definitions
        (id, line_account_id, key, name, category, source_event_type,
         draft_config_json, created_by, updated_by, created_at, updated_at)
      VALUES ('definition-a', 'account-a', 'order-confirmed', '注文確定', 'order',
              'ec.order.confirmed', '{}', 'owner', 'owner', '2026-09-07', '2026-09-07')
    `).run();
    sqlite.prepare(`
      INSERT INTO customer_notification_versions
        (id, definition_id, version_number, config_json, line_template_json,
         published_by, published_at)
      VALUES ('version-a', 'definition-a', 1, '{}', '[]', 'owner', '2026-09-07')
    `).run();
    expect(() => sqlite.prepare(`
      INSERT INTO customer_notification_versions
        (id, definition_id, version_number, config_json, line_template_json,
         published_by, published_at)
      VALUES ('version-b', 'definition-a', 1, '{}', '[]', 'owner', '2026-09-07')
    `).run()).toThrow(/UNIQUE/);
  });

  it('同じイベント・版・宛先・チャネルの送信を一意キーで二重登録しない', () => {
    sqlite.prepare(`
      INSERT INTO notification_instances
        (id, line_account_id, audience_type, source_event_type, source_event_id,
         dedupe_key, created_at, updated_at)
      VALUES ('instance-a', 'account-a', 'customer', 'ec.order.confirmed',
              'event-a', 'event-a:version-a:friend-a:line', '2026-09-07', '2026-09-07')
    `).run();
    const insert = sqlite.prepare(`
      INSERT INTO notification_deliveries
        (id, line_account_id, instance_id, audience_type, recipient_type,
         recipient_id, channel, idempotency_key, queued_at, updated_at)
      VALUES (?, 'account-a', 'instance-a', 'customer', 'friend', 'friend-a',
              'line', 'event-a:version-a:friend-a:line', '2026-09-07', '2026-09-07')
    `);
    insert.run('delivery-a');
    expect(() => insert.run('delivery-b')).toThrow(/UNIQUE/);
  });

  it('受付成功を delivered と名付けず、公式集計の未取得を NULL で持つ', () => {
    const deliverySql = sqlite.prepare(
      `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'notification_deliveries'`,
    ).get() as { sql: string };
    expect(deliverySql.sql).toContain('provider_accepted');
    expect(deliverySql.sql).not.toMatch(/'delivered'/);

    sqlite.prepare(`
      INSERT INTO customer_notification_definitions
        (id, line_account_id, key, name, category, source_event_type,
         draft_config_json, created_by, updated_by, created_at, updated_at)
      VALUES ('definition-a', 'account-a', 'shipping', '発送', 'shipping',
              'ec.order.shipped', '{}', 'owner', 'owner', '2026-09-07', '2026-09-07')
    `).run();
    sqlite.prepare(`
      INSERT INTO notification_aggregate_metrics
        (id, line_account_id, definition_id, metric_date, aggregation_unit,
         accepted_count, display_count, click_count, state, reason, updated_at)
      VALUES ('metric-a', 'account-a', 'definition-a', '2026-09-07', 'shipping_20260907',
              12, NULL, 2, 'unavailable_privacy', 'privacy threshold', '2026-09-07')
    `).run();
    expect(sqlite.prepare(
      `SELECT display_count, state FROM notification_aggregate_metrics WHERE id = 'metric-a'`,
    ).get()).toEqual({ display_count: null, state: 'unavailable_privacy' });
  });
});
