import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const migration304 = readFileSync(
  join(import.meta.dirname, '..', 'migrations', '304_line_notification_delivery_ledger.sql'),
  'utf8',
);
const migration371 = readFileSync(
  join(import.meta.dirname, '..', 'migrations', '371_operator_notification_rule_versions.sql'),
  'utf8',
);

describe('migration 371 operator notification rule versions', () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE line_accounts (id TEXT PRIMARY KEY);
      CREATE TABLE notification_rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        event_type TEXT NOT NULL,
        conditions TEXT NOT NULL DEFAULT '{}',
        channels TEXT NOT NULL DEFAULT '["dashboard"]',
        line_account_id TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO line_accounts (id) VALUES ('account-a');
      INSERT INTO notification_rules
        (id, name, event_type, line_account_id, created_at, updated_at)
      VALUES ('rule-a', '予約', 'booking_created', 'account-a', '2026-09-09', '2026-09-09');
    `);
    sqlite.exec(migration304);
    sqlite.exec(migration371);
  });

  afterEach(() => sqlite.close());

  it('既存ルールへ版1を付け、新しい版は正の整数だけ保存する', () => {
    expect(sqlite.prepare(`SELECT version FROM notification_rules WHERE id = 'rule-a'`).get())
      .toEqual({ version: 1 });
    expect(() => sqlite.prepare(`UPDATE notification_rules SET version = 0 WHERE id = 'rule-a'`).run())
      .toThrow(/CHECK/);
  });

  it('重複防止時間をまたいでも同じ業務イベントを二重登録しない', () => {
    const insert = sqlite.prepare(`
      INSERT INTO notification_instances
        (id, line_account_id, audience_type, definition_id, definition_version_id,
         source_event_type, source_event_id, dedupe_key, created_at, updated_at)
      VALUES (?, 'account-a', 'operator', 'rule-a', '1',
              'booking_created', 'booking-a', ?, '2026-09-09', '2026-09-09')
    `);
    insert.run('instance-a', 'rule-a:booking_created:window-1');
    expect(() => insert.run('instance-b', 'rule-a:booking_created:window-2')).toThrow(/UNIQUE/);
  });

  it('別ルールまたは別業務イベントはそれぞれ登録できる', () => {
    sqlite.prepare(`
      INSERT INTO notification_rules
        (id, name, event_type, line_account_id, created_at, updated_at)
      VALUES ('rule-b', '予約2', 'booking_created', 'account-a', '2026-09-09', '2026-09-09')
    `).run();
    const insert = sqlite.prepare(`
      INSERT INTO notification_instances
        (id, line_account_id, audience_type, definition_id, definition_version_id,
         source_event_type, source_event_id, dedupe_key, created_at, updated_at)
      VALUES (?, 'account-a', 'operator', ?, '1',
              'booking_created', ?, ?, '2026-09-09', '2026-09-09')
    `);
    insert.run('instance-a', 'rule-a', 'booking-a', 'dedupe-a');
    insert.run('instance-b', 'rule-a', 'booking-b', 'dedupe-b');
    insert.run('instance-c', 'rule-b', 'booking-a', 'dedupe-c');
    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM notification_instances`).get())
      .toEqual({ count: 3 });
  });
});
