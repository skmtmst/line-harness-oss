import { beforeEach, describe, expect, it, vi } from 'vitest';

const pushMessageWithRequestId = vi.hoisted(() => vi.fn(async () => ({})));
const fetchQuota = vi.hoisted(() => vi.fn(async (): Promise<{
  used: number | null;
  limit: number | null;
}> => ({ used: 0, limit: 200 })));
const sendViaXServerRelay = vi.hoisted(() => vi.fn(async () => {
  throw new Error('email provider unavailable');
}));

vi.mock('@line-crm/line-sdk', () => ({
  LineClient: class { pushMessageWithRequestId = pushMessageWithRequestId; },
}));
vi.mock('./broadcast-quota-guard.js', () => ({ fetchQuota }));
vi.mock('./support-relay.js', () => ({ sendViaXServerRelay }));

import {
  acknowledgeOperationAlert,
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
    fetchQuota.mockReset();
    fetchQuota.mockResolvedValue({ used: 0, limit: 200 });
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

  it('運用通知のLINE設定をオフにすると新規通知を積まず、設定前の未送信行も送らない', async () => {
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
      lineAccountId: 'account-1', runId: 'run-1',
      results: [{
        id: 'result-1', runId: 'run-1', checkKey: 'dispatch_jobs', status: 'warning',
        summary: '配信処理に遅延または失敗があります', source: 'test', observedAt: '2026-09-16T00:00:00.000Z',
      }], now: '2026-09-16T00:00:00.000Z',
    });
    await enqueuePendingOperationAlertNotifications(testDb.db, {
      lineAccountId: 'account-1', now: '2026-09-16T00:00:00.000Z',
    });
    expect(testDb.raw.prepare('SELECT channel FROM operation_alert_notification_outbox ORDER BY channel').all())
      .toEqual([{ channel: 'email' }, { channel: 'line' }]);

    testDb.raw.prepare(
      `UPDATE staff_members SET notification_preferences = '{"operations":{"line":false,"email":true}}'
        WHERE id = 'owner-1'`,
    ).run();
    const env = { DB: testDb.db } as Env['Bindings'];
    await processOperationAlertNotificationOutbox(env);
    expect(pushMessageWithRequestId).not.toHaveBeenCalled();
    expect(testDb.raw.prepare('SELECT channel FROM operation_alert_notification_outbox').all())
      .toEqual([{ channel: 'email' }]);

    testDb.raw.prepare(
      `UPDATE operation_alert_events SET notification_enqueued_at = NULL WHERE action = 'opened'`,
    ).run();
    await enqueuePendingOperationAlertNotifications(testDb.db, {
      lineAccountId: 'account-1', now: '2026-09-16T00:01:00.000Z',
    });
    expect(testDb.raw.prepare("SELECT COUNT(*) AS count FROM operation_alert_notification_outbox WHERE channel = 'line'").get())
      .toEqual({ count: 0 });
  });

  async function seedBase(testDb: ReturnType<typeof createTestD1>) {
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
       VALUES ('run-seed', 'account-1', 'account-1', '2026-09-16T00:00:00.000Z',
               'scheduled', 'completed', 'warning', '2026-09-16T00:00:00.000Z', '2026-09-16T00:00:00.000Z')`,
    ).run();
  }

  async function seedLineNotifications(
    testDb: ReturnType<typeof createTestD1>,
    rows: Array<{ id: string; createdAt: string; status?: 'queued' | 'failed' | 'sent'; attempts?: number; sentAt?: string }>,
  ) {
    await seedBase(testDb);
    testDb.raw.prepare(
      `INSERT INTO operation_alerts
         (id, line_account_id, check_key, status, severity, summary, source_run_id,
          first_detected_at, last_detected_at, created_at, updated_at)
       VALUES ('alert-1', 'account-1', 'webhook', 'open', 'warning',
               'Webhook受信に失敗があります', 'run-seed',
               '2026-09-16T00:00:00.000Z', '2026-09-16T00:00:00.000Z',
               '2026-09-16T00:00:00.000Z', '2026-09-16T00:00:00.000Z')`,
    ).run();
    rows.forEach((row, index) => {
      testDb.raw.prepare(
        `INSERT INTO operation_alert_events
           (id, alert_id, line_account_id, source_run_id, action, severity, summary, alert_version, created_at)
         VALUES (?, 'alert-1', 'account-1', 'run-seed', 'opened', 'warning',
                 'Webhook受信に失敗があります', ?, ?)`,
      ).bind(`event-${row.id}`, index + 1, row.createdAt).run();
      testDb.raw.prepare(
        `INSERT INTO operation_alert_notification_outbox
           (id, event_id, line_account_id, staff_id, channel, status, attempt_count,
            next_attempt_at, sent_at, created_at, updated_at)
         VALUES (?, ?, 'account-1', 'owner-1', 'line', ?, ?, ?, ?, ?, ?)`,
      ).bind(row.id, `event-${row.id}`, row.status ?? 'queued', row.attempts ?? 0,
        row.createdAt, row.sentAt ?? null, row.createdAt, row.sentAt ?? row.createdAt).run();
    });
  }

  it('月初に前月の通知を再送せず、新しい通知だけ送る', async () => {
    const testDb = createTestD1();
    await seedLineNotifications(testDb, [
      { id: 'old', createdAt: '2026-10-27T00:00:00.000Z', status: 'failed', attempts: 23 },
      { id: 'fresh', createdAt: '2026-10-31T15:01:00.000Z' },
    ]);
    vi.setSystemTime(new Date('2026-10-31T15:05:00.000Z'));

    await expect(processOperationAlertNotificationOutbox({ DB: testDb.db } as Env['Bindings']))
      .resolves.toEqual({ sent: 1, failed: 0 });
    expect(pushMessageWithRequestId).toHaveBeenCalledOnce();
    expect(testDb.raw.prepare('SELECT id, status, attempt_count FROM operation_alert_notification_outbox ORDER BY id').all())
      .toEqual([
        { id: 'fresh', status: 'sent', attempt_count: 1 },
        { id: 'old', status: 'failed', attempt_count: 23 },
      ]);
  });

  it('LINEの残枠を確認できないときと残り10%に達したときは運用アラートを送らない', async () => {
    const testDb = createTestD1();
    await seedLineNotifications(testDb, [{ id: 'fresh', createdAt: '2026-09-16T00:00:00.000Z' }]);
    const env = { DB: testDb.db } as Env['Bindings'];
    fetchQuota.mockResolvedValue({ used: null, limit: null });
    await expect(processOperationAlertNotificationOutbox(env)).resolves.toEqual({ sent: 0, failed: 0 });
    fetchQuota.mockResolvedValue({ used: 10, limit: null });
    await expect(processOperationAlertNotificationOutbox(env)).resolves.toEqual({ sent: 0, failed: 0 });
    fetchQuota.mockResolvedValue({ used: 180, limit: 200 });
    await expect(processOperationAlertNotificationOutbox(env)).resolves.toEqual({ sent: 0, failed: 0 });
    expect(pushMessageWithRequestId).not.toHaveBeenCalled();
    expect(testDb.raw.prepare("SELECT status, attempt_count FROM operation_alert_notification_outbox WHERE id = 'fresh'").get())
      .toEqual({ status: 'queued', attempt_count: 0 });
  });

  it('運用アラートはアカウント全体で月20通までとし、再試行も24回で止める', async () => {
    const testDb = createTestD1();
    const sentAt = '2026-09-15T15:01:00.000Z';
    await seedLineNotifications(testDb, [
      ...Array.from({ length: 20 }, (_, index) => ({ id: `sent-${index}`, createdAt: sentAt, status: 'sent' as const, sentAt })),
      { id: 'fresh', createdAt: '2026-09-16T00:00:00.000Z' },
      { id: 'exhausted', createdAt: '2026-09-16T00:00:00.000Z', status: 'failed', attempts: 24 },
    ]);
    await expect(processOperationAlertNotificationOutbox({ DB: testDb.db } as Env['Bindings']))
      .resolves.toEqual({ sent: 0, failed: 0 });
    expect(pushMessageWithRequestId).not.toHaveBeenCalled();
    expect(testDb.raw.prepare("SELECT id, status, attempt_count FROM operation_alert_notification_outbox WHERE id IN ('fresh', 'exhausted') ORDER BY id").all())
      .toEqual([
        { id: 'exhausted', status: 'failed', attempt_count: 24 },
        { id: 'fresh', status: 'queued', attempt_count: 0 },
      ]);
  });

  it('同じ処理で多数の通知が並んでも月間上限を越えて送らない', async () => {
    const testDb = createTestD1();
    await seedLineNotifications(testDb, Array.from({ length: 25 }, (_, index) => ({
      id: `fresh-${index}`, createdAt: '2026-09-16T00:00:00.000Z',
    })));
    await expect(processOperationAlertNotificationOutbox({ DB: testDb.db } as Env['Bindings']))
      .resolves.toEqual({ sent: 20, failed: 0 });
    expect(pushMessageWithRequestId).toHaveBeenCalledTimes(20);
    expect(fetchQuota).toHaveBeenCalledOnce();
    expect(testDb.raw.prepare("SELECT COUNT(*) AS count FROM operation_alert_notification_outbox WHERE status = 'sent'").get())
      .toEqual({ count: 20 });
  });

  async function seedResolvedFlap(testDb: ReturnType<typeof createTestD1>) {
    seedBase(testDb);
    testDb.raw.prepare(
      `INSERT INTO operation_alerts
         (id, line_account_id, check_key, status, severity, summary, source_run_id,
          first_detected_at, last_detected_at, resolved_at, version, reopened_count, created_at, updated_at)
       VALUES ('alert-9', 'account-1', 'dispatch_jobs', 'resolved', 'danger',
               '配信処理に遅延または失敗があります', 'run-seed',
               '2026-09-16T00:00:00.000Z', '2026-09-16T00:10:00.000Z', '2026-09-16T00:10:00.000Z',
               2, 0, '2026-09-16T00:00:00.000Z', '2026-09-16T00:10:00.000Z')`,
    ).run();
    // 「この異常は検知したときに知らせた」状態にしておく。知らせていない異常の解消は
    // そもそも送らない決まりなので、その前提がないと重複抑止の試験にならない。
    testDb.raw.prepare(
      `INSERT INTO operation_alert_events
         (id, alert_id, line_account_id, source_run_id, action, severity, summary,
          alert_version, notification_enqueued_at, created_at)
       VALUES ('event-o1', 'alert-9', 'account-1', 'run-seed', 'opened', 'danger',
               '配信処理に遅延または失敗があります', 1,
               '2026-09-16T00:00:00.000Z', '2026-09-16T00:00:00.000Z')`,
    ).run();
    for (const channel of ['line', 'email'] as const) {
      testDb.raw.prepare(
        `INSERT INTO operation_alert_notification_outbox
           (id, event_id, line_account_id, staff_id, channel, status, attempt_count,
            next_attempt_at, sent_at, created_at, updated_at)
         VALUES (?, 'event-o1', 'account-1', 'owner-1', ?, 'sent', 1,
                 '2026-09-16T00:00:00.000Z', '2026-09-16T00:00:01.000Z',
                 '2026-09-16T00:00:00.000Z', '2026-09-16T00:00:01.000Z')`,
      ).bind(`outbox-o1-${channel}`, channel).run();
    }
  }

  function outboxActionCounts(testDb: ReturnType<typeof createTestD1>) {
    return testDb.raw.prepare(
      `SELECT e.action AS action, COUNT(*) AS count
         FROM operation_alert_notification_outbox o
         JOIN operation_alert_events e ON e.id = o.event_id
        GROUP BY e.action ORDER BY e.action`,
    ).all() as Array<{ action: string; count: number }>;
  }

  it('各actionの文面が意味どおりになる（解消・確認に重さの札を付けない）', async () => {
    const testDb = createTestD1();
    seedBase(testDb);
    const run = async (runId: string, status: 'warning' | 'danger' | 'normal', now: string, summary: string) => {
      testDb.raw.prepare(
        `INSERT INTO operation_health_runs
           (id, scope_key, line_account_id, window_started_at, source, status, overall_status, started_at, completed_at)
         VALUES (?, ?, 'account-1', ?, 'scheduled', 'completed', ?, ?, ?)`,
      ).bind(runId, runId, now, status === 'normal' ? 'normal' : status, now, now).run();
      await reconcileOperationHealthAlerts(testDb.db, {
        lineAccountId: 'account-1',
        runId,
        results: [{
          id: `result-${runId}`, runId, checkKey: 'dispatch_jobs', status,
          summary, source: 'test', observedAt: now,
        }],
        now,
      });
    };
    await run('run-open', 'warning', '2026-09-16T00:00:00.000Z', '配信処理に遅延または失敗があります');
    await run('run-escalated', 'danger', '2026-09-16T00:40:00.000Z', '配信処理に遅延または失敗があります');
    const [alertOpened] = await testDb.db.prepare('SELECT id, version FROM operation_alerts').all<{ id: string; version: number }>()
      .then((result) => result.results ?? []);
    await acknowledgeOperationAlert(testDb.db, {
      id: alertOpened.id, lineAccountId: 'account-1', actorId: 'owner-1',
      expectedVersion: alertOpened.version, note: '確認中', now: '2026-09-16T00:41:00.000Z',
    });
    await run('run-resolved', 'normal', '2026-09-16T00:50:00.000Z', 'ok');
    await run('run-reopened', 'warning', '2026-09-16T01:30:00.000Z', '配信処理に遅延または失敗があります');
    await enqueuePendingOperationAlertNotifications(testDb.db, {
      lineAccountId: 'account-1', now: '2026-09-16T01:31:00.000Z',
    });

    const env = { DB: testDb.db } as Env['Bindings'];
    vi.setSystemTime(new Date('2026-09-16T01:31:00.001Z'));
    await processOperationAlertNotificationOutbox(env);
    const texts = pushMessageWithRequestId.mock.calls.map(
      (call) => ((call as unknown[])[1] as Array<{ text: string }>)[0].text,
    );
    expect(texts).toHaveLength(5);
    const byPrefix = (prefix: string) => texts.find((text) => text.startsWith(prefix));
    expect(byPrefix('【運用状態】異常を検知しました（注意）')).toContain('配信処理に遅延または失敗があります');
    expect(byPrefix('【運用状態】異常の深刻度が上がりました（エラー）')).toContain('配信処理に遅延または失敗があります');
    expect(byPrefix('【運用状態】解消済みの異常が再発しました（注意）')).toContain('配信処理に遅延または失敗があります');
    const resolved = byPrefix('【運用状態】解消しました：配信処理');
    expect(resolved).toBeDefined();
    expect(resolved).not.toContain('（');
    expect(resolved).not.toContain('があります');
    const acknowledged = texts.find((text) => text.includes('確認しました：定期確認') || text.includes('確認しました：配信処理'));
    expect(acknowledged).toBeDefined();
    expect(acknowledged).not.toContain('（');
  });

  it('同じalertの同じactionは30分以内に重ねて送らない', async () => {
    const testDb = createTestD1();
    seedResolvedFlap(testDb);
    testDb.raw.prepare(
      `INSERT INTO operation_alert_events
         (id, alert_id, line_account_id, source_run_id, action, severity, summary, alert_version, created_at)
       VALUES ('event-r1', 'alert-9', 'account-1', 'run-seed', 'resolved', 'danger',
               '配信処理に遅延または失敗があります', 2, '2026-09-16T00:10:00.000Z'),
              ('event-r2', 'alert-9', 'account-1', 'run-seed', 'resolved', 'danger',
               '配信処理に遅延または失敗があります', 3, '2026-09-16T00:20:00.000Z')`,
    ).run();
    await enqueuePendingOperationAlertNotifications(testDb.db, {
      lineAccountId: 'account-1', now: '2026-09-16T00:21:00.000Z',
    });
    // ownerはLINEとメールの2行。2回目の解消は抑止され、行は増えない
    // （openedの2行は「検知を知らせた」記録として最初から入れてある）
    expect(outboxActionCounts(testDb)).toEqual([
      { action: 'opened', count: 2 },
      { action: 'resolved', count: 2 },
    ]);
    expect(testDb.raw.prepare(
      "SELECT COUNT(DISTINCT event_id) AS events FROM operation_alert_notification_outbox WHERE event_id <> 'event-o1'",
    ).get()).toEqual({ events: 1 });
  });

  it('解消の直後に再発したときはまとめて1通にする', async () => {
    const testDb = createTestD1();
    seedResolvedFlap(testDb);
    testDb.raw.prepare(
      `INSERT INTO operation_alert_events
         (id, alert_id, line_account_id, source_run_id, action, severity, summary, alert_version, created_at)
       VALUES ('event-r1', 'alert-9', 'account-1', 'run-seed', 'resolved', 'danger',
               '配信処理に遅延または失敗があります', 2, '2026-09-16T00:10:00.000Z')`,
    ).run();
    await enqueuePendingOperationAlertNotifications(testDb.db, {
      lineAccountId: 'account-1', now: '2026-09-16T00:11:00.000Z',
    });
    expect(outboxActionCounts(testDb)).toEqual([
      { action: 'opened', count: 2 },
      { action: 'resolved', count: 2 },
    ]);

    testDb.raw.prepare(
      `INSERT INTO operation_alert_events
         (id, alert_id, line_account_id, source_run_id, action, severity, summary, alert_version, created_at)
       VALUES ('event-o2', 'alert-9', 'account-1', 'run-seed', 'reopened', 'warning',
               '配信処理に遅延または失敗があります', 3, '2026-09-16T00:15:00.000Z')`,
    ).run();
    await enqueuePendingOperationAlertNotifications(testDb.db, {
      lineAccountId: 'account-1', now: '2026-09-16T00:16:00.000Z',
    });
    expect(outboxActionCounts(testDb)).toEqual([
      { action: 'opened', count: 2 },
      { action: 'resolved', count: 2 },
    ]);
    expect(testDb.raw.prepare(
      "SELECT notification_enqueued_at AS enqueued FROM operation_alert_events WHERE id = 'event-o2'",
    ).get()).toEqual({ enqueued: '2026-09-16T00:16:00.000Z' });
  });

  it('30分を過ぎた再発とその後の解消は送る', async () => {
    const testDb = createTestD1();
    seedResolvedFlap(testDb);
    testDb.raw.prepare(
      `INSERT INTO operation_alert_events
         (id, alert_id, line_account_id, source_run_id, action, severity, summary, alert_version, created_at)
       VALUES ('event-r1', 'alert-9', 'account-1', 'run-seed', 'resolved', 'danger',
               '配信処理に遅延または失敗があります', 2, '2026-09-16T00:10:00.000Z')`,
    ).run();
    await enqueuePendingOperationAlertNotifications(testDb.db, {
      lineAccountId: 'account-1', now: '2026-09-16T00:11:00.000Z',
    });
    testDb.raw.prepare(
      `INSERT INTO operation_alert_events
         (id, alert_id, line_account_id, source_run_id, action, severity, summary, alert_version, created_at)
       VALUES ('event-o2', 'alert-9', 'account-1', 'run-seed', 'reopened', 'warning',
               '配信処理に遅延または失敗があります', 3, '2026-09-16T00:50:00.000Z'),
              ('event-r3', 'alert-9', 'account-1', 'run-seed', 'resolved', 'warning',
               '配信処理に遅延または失敗があります', 4, '2026-09-16T00:55:00.000Z')`,
    ).run();
    await enqueuePendingOperationAlertNotifications(testDb.db, {
      lineAccountId: 'account-1', now: '2026-09-16T00:56:00.000Z',
    });
    expect(outboxActionCounts(testDb)).toEqual([
      { action: 'opened', count: 2 },
      { action: 'reopened', count: 2 },
      { action: 'resolved', count: 4 },
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
