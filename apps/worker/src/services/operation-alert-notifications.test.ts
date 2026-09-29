import { beforeEach, describe, expect, it, vi } from 'vitest';

const pushMessageWithRequestId = vi.hoisted(() => vi.fn(async () => ({})));
const sendViaXServerRelay = vi.hoisted(() => vi.fn(async () => {
  throw new Error('email provider unavailable');
}));

vi.mock('@line-crm/line-sdk', () => ({
  LineClient: class { pushMessageWithRequestId = pushMessageWithRequestId; },
}));
vi.mock('./support-relay.js', () => ({ sendViaXServerRelay }));

import {
  enqueuePendingOperationAlertNotifications,
  reconcileOperationHealthAlerts,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { processOperationAlertNotificationOutbox } from './operation-alert-notifications.js';

describe('operation alert notification outbox', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-16T00:00:00.000Z'));
    pushMessageWithRequestId.mockClear();
    sendViaXServerRelay.mockClear();
  });

  it('通知ごとにclaimし、メール障害を成功扱いせずLINEだけ完了する', async () => {
    const testDb = createTestD1();
    testDb.raw.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
       VALUES ('account-1', 'channel-1', 'LINE 1', 'token', 'secret')`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO staff_members (id, name, email, role, api_key, line_user_id)
       VALUES ('owner-1', 'Owner', 'owner@example.test', 'owner', 'owner-key', 'U-owner')`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO operation_health_runs
         (id, scope_key, line_account_id, window_started_at, source, status, overall_status, started_at, completed_at)
       VALUES ('run-1', 'account-1', 'account-1', '2026-09-16T00:00:00.000Z',
               'scheduled', 'completed', 'warning', '2026-09-16T00:00:00.000Z', '2026-09-16T00:00:00.000Z')`,
    ).run();
    await reconcileOperationHealthAlerts(testDb.db, {
      lineAccountId: 'account-1',
      runId: 'run-1',
      results: [{
        id: 'result-1', runId: 'run-1', checkKey: 'webhook', status: 'warning',
        summary: 'Webhook受信に失敗があります', source: 'test', observedAt: '2026-09-16T00:00:00.000Z',
      }],
      now: '2026-09-16T00:00:00.000Z',
    });
    await enqueuePendingOperationAlertNotifications(testDb.db, {
      lineAccountId: 'account-1', now: '2026-09-16T00:00:00.000Z',
    });

    const env = {
      DB: testDb.db,
      XSERVER_RELAY_URL: 'https://relay.example.test',
      XSERVER_RELAY_SECRET: 'secret',
    } as Env['Bindings'];
    await expect(processOperationAlertNotificationOutbox(env)).resolves.toEqual({ sent: 1, failed: 1 });

    expect(pushMessageWithRequestId).toHaveBeenCalledWith(
      'U-owner',
      [{ type: 'text', text: expect.stringContaining('異常を検知しました') }],
      expect.any(String),
    );
    expect(sendViaXServerRelay).toHaveBeenCalledOnce();
    expect(testDb.raw.prepare(
      'SELECT channel, status, attempt_count, last_error FROM operation_alert_notification_outbox ORDER BY channel',
    ).all()).toEqual([
      { channel: 'email', status: 'failed', attempt_count: 1, last_error: 'email provider unavailable' },
      { channel: 'line', status: 'sent', attempt_count: 1, last_error: null },
    ]);
  });

  it('Worker停止でsendingに残った通知をlease期限後に回収する', async () => {
    const testDb = createTestD1();
    testDb.raw.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
       VALUES ('account-1', 'channel-1', 'LINE 1', 'token', 'secret')`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO staff_members (id, name, role, api_key, line_user_id)
       VALUES ('owner-1', 'Owner', 'owner', 'owner-key', 'U-owner')`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO operation_health_runs
         (id, scope_key, line_account_id, window_started_at, source, status, overall_status, started_at, completed_at)
       VALUES ('run-1', 'account-1', 'account-1', '2026-09-16T00:00:00.000Z',
               'scheduled', 'completed', 'warning', '2026-09-16T00:00:00.000Z', '2026-09-16T00:00:00.000Z')`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO operation_alerts
         (id, line_account_id, check_key, status, severity, summary, source_run_id,
          first_detected_at, last_detected_at, created_at, updated_at)
       VALUES ('alert-1', 'account-1', 'webhook', 'open', 'warning', 'Webhook受信に失敗があります',
               'run-1', '2026-09-16T00:00:00.000Z', '2026-09-16T00:00:00.000Z',
               '2026-09-16T00:00:00.000Z', '2026-09-16T00:00:00.000Z')`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO operation_alert_events
         (id, alert_id, line_account_id, source_run_id, action, severity, summary, alert_version, created_at)
       VALUES ('event-1', 'alert-1', 'account-1', 'run-1', 'opened', 'warning',
               'Webhook受信に失敗があります', 1, '2026-09-16T00:00:00.000Z')`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO operation_alert_notification_outbox
         (id, event_id, line_account_id, staff_id, channel, status, attempt_count,
          next_attempt_at, created_at, updated_at)
       VALUES ('outbox-stale', 'event-1', 'account-1', 'owner-1', 'line', 'sending', 1,
               '2026-09-16T00:10:00.000Z', '2026-09-16T00:00:00.000Z', '2026-09-16T00:00:00.000Z')`,
    ).run();
    const env = { DB: testDb.db } as Env['Bindings'];

    await expect(processOperationAlertNotificationOutbox(env)).resolves.toEqual({ sent: 0, failed: 0 });
    expect(pushMessageWithRequestId).not.toHaveBeenCalled();
    vi.setSystemTime(new Date('2026-09-16T00:10:00.001Z'));
    await expect(processOperationAlertNotificationOutbox(env)).resolves.toEqual({ sent: 1, failed: 0 });
    expect(pushMessageWithRequestId).toHaveBeenCalledOnce();
    expect(testDb.raw.prepare(
      "SELECT status, attempt_count FROM operation_alert_notification_outbox WHERE id = 'outbox-stale'",
    ).get()).toEqual({ status: 'sent', attempt_count: 2 });
  });
});
