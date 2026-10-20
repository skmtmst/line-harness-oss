import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(import.meta.dirname, '../migrations/399_operation_alert_lifecycle.sql'),
  'utf8',
);

describe('migration 399 operation alert lifecycle', () => {
  it('既存の運用checkへalert・履歴・通知台帳をD1互換SQLiteで追加する', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE line_accounts (id TEXT PRIMARY KEY);
      CREATE TABLE operation_health_runs (id TEXT PRIMARY KEY);
      CREATE TABLE staff_members (id TEXT PRIMARY KEY);
      INSERT INTO line_accounts (id) VALUES ('account-1');
      INSERT INTO operation_health_runs (id) VALUES ('run-1');
      INSERT INTO staff_members (id) VALUES ('owner-1');
    `);

    expect(() => db.exec(migration)).not.toThrow();
    db.prepare(
      `INSERT INTO operation_alerts
         (id, line_account_id, check_key, status, severity, summary, source_run_id,
          first_detected_at, last_detected_at, created_at, updated_at)
       VALUES ('alert-1', 'account-1', 'webhook', 'open', 'warning', 'Webhook受信に失敗があります',
               'run-1', '2026-09-16T00:00:00.000Z', '2026-09-16T00:00:00.000Z',
               '2026-09-16T00:00:00.000Z', '2026-09-16T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO operation_alert_events
         (id, alert_id, line_account_id, source_run_id, action, severity, summary, alert_version, created_at)
       VALUES ('event-1', 'alert-1', 'account-1', 'run-1', 'opened', 'warning',
               'Webhook受信に失敗があります', 1, '2026-09-16T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO operation_alert_notification_outbox
         (id, event_id, line_account_id, staff_id, channel, next_attempt_at, created_at, updated_at)
       VALUES ('outbox-1', 'event-1', 'account-1', 'owner-1', 'line',
               '2026-09-16T00:00:00.000Z', '2026-09-16T00:00:00.000Z', '2026-09-16T00:00:00.000Z')`,
    ).run();

    expect(db.prepare(
      'SELECT status, version, reopened_count FROM operation_alerts WHERE id = ?',
    ).get('alert-1')).toEqual({ status: 'open', version: 1, reopened_count: 0 });
    expect(db.prepare(
      'SELECT status, attempt_count FROM operation_alert_notification_outbox WHERE id = ?',
    ).get('outbox-1')).toEqual({ status: 'queued', attempt_count: 0 });
    expect(() => db.prepare(
      `INSERT INTO operation_alerts
         (id, line_account_id, check_key, status, severity, summary, source_run_id,
          first_detected_at, last_detected_at, created_at, updated_at)
       SELECT 'alert-2', line_account_id, check_key, status, severity, summary, source_run_id,
              first_detected_at, last_detected_at, created_at, updated_at
         FROM operation_alerts WHERE id = 'alert-1'`,
    ).run()).toThrow(/UNIQUE/);
    db.close();
  });
});
