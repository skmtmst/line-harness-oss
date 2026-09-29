import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  acknowledgeOperationAlert,
  enqueuePendingOperationAlertNotifications,
  listOperationAlerts,
  reconcileOperationHealthAlerts,
  retryOperationAlertNotifications,
  type OperationHealthResult,
  type OperationHealthStatus,
} from '../src/operations-health.js';
import { asD1 } from './d1-test-helper.js';

let sqlite: Database.Database;
let db: D1Database;

function healthResult(status: OperationHealthStatus, summary = status): OperationHealthResult {
  return {
    id: crypto.randomUUID(),
    runId: 'run-1',
    checkKey: 'webhook',
    status,
    summary,
    source: 'test',
    observedAt: '2026-09-16T00:00:00.000Z',
  };
}

async function observe(status: OperationHealthStatus, runId: string, now: string): Promise<void> {
  sqlite.prepare(
    `INSERT OR IGNORE INTO operation_health_runs
       (id, scope_key, line_account_id, window_started_at, source, status, overall_status, started_at, completed_at)
     VALUES (?, ?, 'account-1', ?, 'scheduled', 'completed', ?, ?, ?)`,
  ).run(runId, `${runId}:scope`, now, status, now, now);
  await reconcileOperationHealthAlerts(db, {
    lineAccountId: 'account-1',
    runId,
    results: [{ ...healthResult(status), runId, observedAt: now }],
    now,
  });
}

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
  sqlite.prepare("INSERT INTO tenants (id, name) VALUES ('tenant-1', '統括1'), ('tenant-2', '統括2')").run();
  sqlite.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
     VALUES ('account-1', 'channel-1', 'LINE 1', 'token-1', 'secret-1', 'tenant-1'),
            ('account-2', 'channel-2', 'LINE 2', 'token-2', 'secret-2', 'tenant-1')`,
  ).run();
  db = asD1(sqlite);
});

describe('運用異常alertのライフサイクル', () => {
  it('同じ異常をまとめ、悪化・受領・解消・再発を版付き履歴に残す', async () => {
    await observe('warning', 'run-open', '2026-09-16T00:00:00.000Z');
    await observe('warning', 'run-same', '2026-09-16T00:05:00.000Z');

    let [alert] = await listOperationAlerts(db, { lineAccountId: 'account-1' });
    expect(alert).toMatchObject({ status: 'open', severity: 'warning', version: 1 });
    expect(alert.events.map(({ action }) => action)).toEqual(['opened']);

    await observe('danger', 'run-escalated', '2026-09-16T00:10:00.000Z');
    [alert] = await listOperationAlerts(db, { lineAccountId: 'account-1' });
    expect(alert).toMatchObject({ status: 'open', severity: 'danger', version: 2 });

    const acknowledged = await acknowledgeOperationAlert(db, {
      id: alert.id,
      lineAccountId: 'account-1',
      actorId: 'owner-1',
      expectedVersion: alert.version,
      note: 'Webhook設定を確認中',
      now: '2026-09-16T00:11:00.000Z',
    });
    expect(acknowledged).toMatchObject({
      status: 'changed',
      alert: { status: 'acknowledged', acknowledgedById: 'owner-1', acknowledgementNote: 'Webhook設定を確認中', version: 3 },
    });
    expect(await acknowledgeOperationAlert(db, {
      id: alert.id, lineAccountId: 'account-1', actorId: 'owner-1', expectedVersion: 3,
      note: 'Webhook設定を確認中', now: '2026-09-16T00:12:00.000Z',
    })).toMatchObject({ status: 'duplicate', alert: { version: 3 } });
    expect(await acknowledgeOperationAlert(db, {
      id: alert.id, lineAccountId: 'account-1', actorId: 'owner-1', expectedVersion: 2,
      note: 'Webhook設定を確認中', now: '2026-09-16T00:12:00.000Z',
    })).toMatchObject({ status: 'conflict', alert: { version: 3 } });
    expect(await acknowledgeOperationAlert(db, {
      id: alert.id, lineAccountId: 'account-1', actorId: 'admin-1', expectedVersion: 3,
      note: 'Webhook設定を確認中', now: '2026-09-16T00:12:00.000Z',
    })).toMatchObject({ status: 'conflict', alert: { version: 3 } });
    expect(await acknowledgeOperationAlert(db, {
      id: alert.id, lineAccountId: 'account-1', actorId: 'owner-1', expectedVersion: 3,
      note: '別の対応内容', now: '2026-09-16T00:12:00.000Z',
    })).toMatchObject({ status: 'conflict', alert: { version: 3 } });

    await observe('normal', 'run-resolved', '2026-09-16T00:15:00.000Z');
    expect(await listOperationAlerts(db, { lineAccountId: 'account-1' })).toEqual([]);
    await observe('warning', 'run-reopened', '2026-09-16T00:20:00.000Z');

    [alert] = await listOperationAlerts(db, { lineAccountId: 'account-1', includeResolved: true });
    expect(alert).toMatchObject({
      status: 'open', severity: 'warning', version: 5, reopenedCount: 1,
      acknowledgedAt: null, acknowledgedById: null, acknowledgementNote: null,
    });
    expect(alert.events.map(({ action, alertVersion }) => [action, alertVersion])).toEqual([
      ['reopened', 5],
      ['resolved', 4],
      ['acknowledged', 3],
      ['escalated', 2],
      ['opened', 1],
    ]);
    expect(sqlite.prepare(
      "SELECT COUNT(*) AS count FROM operation_alerts WHERE line_account_id = 'account-1' AND check_key = 'webhook'",
    ).get()).toEqual({ count: 1 });

    sqlite.prepare(
      `INSERT INTO staff_members (id, name, email, role, api_key, tenant_id)
       VALUES ('owner-1', 'Owner', 'owner@example.test', 'owner', 'key-owner', 'tenant-1')`,
    ).run();
    await enqueuePendingOperationAlertNotifications(db, {
      lineAccountId: 'account-1', now: '2026-09-16T00:21:00.000Z',
    });
    await enqueuePendingOperationAlertNotifications(db, {
      lineAccountId: 'account-1', now: '2026-09-16T00:22:00.000Z',
    });
    expect(sqlite.prepare(
      `SELECT e.action, COUNT(*) AS count
         FROM operation_alert_notification_outbox o
         JOIN operation_alert_events e ON e.id = o.event_id
        GROUP BY e.action ORDER BY e.alert_version`,
    ).all()).toEqual([
      { action: 'opened', count: 1 },
      { action: 'escalated', count: 1 },
      { action: 'acknowledged', count: 1 },
      { action: 'resolved', count: 1 },
      { action: 'reopened', count: 1 },
    ]);
  });

  it('同一統括かつ対象accountを見られるowner/adminだけへ通知を積み、別accountの再開を拒む', async () => {
    const insertStaff = sqlite.prepare(
      `INSERT INTO staff_members
         (id, name, email, role, api_key, line_user_id, tenant_id, account_scope, assigned_line_account_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insertStaff.run('owner-all', 'Owner', 'owner@example.test', 'owner', 'key-owner', 'U-owner', 'tenant-1', 'all', null);
    insertStaff.run('admin-scoped', 'Admin', 'admin@example.test', 'admin', 'key-admin', null, 'tenant-1', 'accounts', 'account-2');
    insertStaff.run('admin-empty', 'Empty', 'empty@example.test', 'admin', 'key-empty', null, 'tenant-1', 'accounts', 'account-1');
    insertStaff.run('staff-all', 'Staff', 'staff@example.test', 'staff', 'key-staff', 'U-staff', 'tenant-1', 'all', null);
    insertStaff.run('owner-other', 'Other', 'other@example.test', 'owner', 'key-other', 'U-other', 'tenant-2', 'all', null);
    sqlite.prepare(
      "INSERT INTO staff_account_scopes (staff_id, line_account_id, created_at) VALUES ('admin-scoped', 'account-1', '2026-09-16T00:00:00.000Z')",
    ).run();

    await observe('warning', 'run-open', '2026-09-16T00:00:00.000Z');
    await enqueuePendingOperationAlertNotifications(db, { lineAccountId: 'account-1', now: '2026-09-16T00:01:00.000Z' });
    await enqueuePendingOperationAlertNotifications(db, { lineAccountId: 'account-1', now: '2026-09-16T00:02:00.000Z' });

    expect(sqlite.prepare(
      'SELECT staff_id, channel, status FROM operation_alert_notification_outbox ORDER BY staff_id, channel',
    ).all()).toEqual([
      { staff_id: 'admin-scoped', channel: 'email', status: 'queued' },
      { staff_id: 'owner-all', channel: 'email', status: 'queued' },
      { staff_id: 'owner-all', channel: 'line', status: 'queued' },
    ]);

    sqlite.prepare("UPDATE operation_alert_notification_outbox SET status = 'failed', last_error = 'provider unavailable'").run();
    const [{ id: alertId }] = sqlite.prepare('SELECT id FROM operation_alerts').all() as Array<{ id: string }>;
    expect(await retryOperationAlertNotifications(db, {
      alertId, lineAccountId: 'account-2', now: '2026-09-16T00:03:00.000Z',
    })).toBe(0);
    expect(await retryOperationAlertNotifications(db, {
      alertId, lineAccountId: 'account-1', now: '2026-09-16T00:03:00.000Z',
    })).toBe(3);
    expect(sqlite.prepare(
      "SELECT COUNT(*) AS count FROM operation_alert_notification_outbox WHERE status = 'queued' AND last_error IS NULL",
    ).get()).toEqual({ count: 3 });
  });

  it('tenant未設定の既存accountを既定統括として扱い、既定統括のownerへ通知する', async () => {
    sqlite.prepare("UPDATE line_accounts SET tenant_id = NULL WHERE id = 'account-1'").run();
    sqlite.prepare(
      `INSERT INTO staff_members (id, name, email, role, api_key, tenant_id)
       VALUES ('owner-default', 'Default owner', 'default@example.test', 'owner', 'key-default',
               '00000000-0000-4000-8000-000000000001')`,
    ).run();
    await observe('warning', 'run-open', '2026-09-16T00:00:00.000Z');
    await enqueuePendingOperationAlertNotifications(db, {
      lineAccountId: 'account-1', now: '2026-09-16T00:01:00.000Z',
    });

    expect(sqlite.prepare(
      'SELECT staff_id, channel FROM operation_alert_notification_outbox',
    ).all()).toEqual([{ staff_id: 'owner-default', channel: 'email' }]);
  });

  it('通知対象0人を未設定として残し、担当者設定後の再確認で通知を積む', async () => {
    await observe('warning', 'run-open', '2026-09-16T00:00:00.000Z');
    await enqueuePendingOperationAlertNotifications(db, {
      lineAccountId: 'account-1', now: '2026-09-16T00:01:00.000Z',
    });
    let [alert] = await listOperationAlerts(db, { lineAccountId: 'account-1' });
    expect(alert.notification).toEqual({
      queued: 0, sending: 0, sent: 0, failed: 0, unconfigured: 1, total: 0,
    });

    sqlite.prepare(
      `INSERT INTO staff_members (id, name, email, role, api_key, tenant_id)
       VALUES ('owner-1', 'Owner', 'owner@example.test', 'owner', 'key-owner', 'tenant-1')`,
    ).run();
    expect(await retryOperationAlertNotifications(db, {
      alertId: alert.id, lineAccountId: 'account-1', now: '2026-09-16T00:02:00.000Z',
    })).toBe(1);
    await enqueuePendingOperationAlertNotifications(db, {
      lineAccountId: 'account-1', now: '2026-09-16T00:02:00.000Z',
    });
    [alert] = await listOperationAlerts(db, { lineAccountId: 'account-1' });
    expect(alert.notification).toEqual({
      queued: 1, sending: 0, sent: 0, failed: 0, unconfigured: 0, total: 1,
    });
  });

  it('alertが6項目あっても一覧を3クエリでまとめて取得する', async () => {
    sqlite.prepare(
      `INSERT INTO operation_health_runs
         (id, scope_key, line_account_id, window_started_at, source, status, overall_status, started_at, completed_at)
       VALUES ('run-all', 'run-all:scope', 'account-1', '2026-09-16T00:00:00.000Z',
               'scheduled', 'completed', 'warning', '2026-09-16T00:00:00.000Z', '2026-09-16T00:00:00.000Z')`,
    ).run();
    const checkKeys = [
      'line_connection', 'message_quota', 'external_integrations',
      'webhook', 'dispatch_jobs', 'friend_change',
    ] as const;
    await reconcileOperationHealthAlerts(db, {
      lineAccountId: 'account-1', runId: 'run-all', now: '2026-09-16T00:00:00.000Z',
      results: checkKeys.map((checkKey) => ({
        ...healthResult('warning', `${checkKey} warning`), checkKey, runId: 'run-all',
      })),
    });
    let prepareCount = 0;
    const countingDb = {
      prepare(sql: string) {
        prepareCount += 1;
        return db.prepare(sql);
      },
      batch: db.batch.bind(db),
    } as D1Database;

    expect(await listOperationAlerts(countingDb, { lineAccountId: 'account-1' })).toHaveLength(6);
    expect(prepareCount).toBe(3);
  });
});
