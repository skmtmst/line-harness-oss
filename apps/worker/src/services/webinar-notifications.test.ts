import { describe, expect, test, vi } from 'vitest';

import { createTestD1, insertFriend } from '../test-utils/d1-sqlite.js';
import {
  calculateWebinarNotificationSchedule,
  enqueueWebinarCompletedNotification,
  processWebinarNotificationJobs,
  registerWebinarSession,
  saveWebinarNotificationSettings,
  sendWebinarNotificationTest,
  type WebinarNotificationSettingsInput,
} from './webinar-notifications.js';

const SETTINGS: WebinarNotificationSettingsInput = {
  registrationEnabled: true,
  dayBeforeEnabled: true,
  dayBeforeTime: '20:00',
  hourBeforeEnabled: true,
  hourBeforeMinutes: 60,
  startEnabled: true,
  missedEnabled: true,
  missedTime: '10:00',
  completedEnabled: true,
};

const NOW = new Date('2026-08-29T00:00:00.000Z');
const SESSION = Math.floor(Date.parse('2026-09-02T02:00:00.000Z') / 1000); // JST 11:00

function seedBase(raw: import('better-sqlite3').Database) {
  raw.prepare(
    `INSERT INTO line_accounts
       (id, channel_id, name, channel_access_token, channel_secret, is_active, liff_id)
     VALUES ('account-1', 'channel-1', 'テスト', 'token-1', 'secret-1', 1, 'liff-1')`,
  ).run();
  raw.prepare(
    `INSERT INTO account_settings (id, line_account_id, key, value)
     VALUES ('feature-webinars', 'account-1', 'feature.webinars', '{"enabled":true}')`,
  ).run();
  raw.prepare(
    `INSERT INTO webinars
       (id, account_id, title, slug, status, duration_seconds, schedule_json, created_at, updated_at)
     VALUES ('webinar-1', 'account-1', '商品説明会', 'product-live', 'active', 3600, '[]', ?, ?)`,
  ).run(NOW.toISOString(), NOW.toISOString());
  insertFriend(raw, 'friend-1', { line_account_id: 'account-1', line_user_id: 'U001' });
}

describe('calculateWebinarNotificationSchedule', () => {
  test('JSTの前日・開始前・開始時・翌日の時刻を固定する', () => {
    expect(calculateWebinarNotificationSchedule(SESSION, SETTINGS, NOW.getTime() / 1000)).toEqual([
      { kind: 'day_before', scheduledAt: Date.parse('2026-09-01T11:00:00.000Z') / 1000 },
      { kind: 'hour_before', scheduledAt: Date.parse('2026-09-02T01:00:00.000Z') / 1000 },
      { kind: 'session_start', scheduledAt: SESSION },
      { kind: 'missed', scheduledAt: Date.parse('2026-09-03T01:00:00.000Z') / 1000 },
    ]);
  });
});

describe('webinar notification jobs', () => {
  test('設定の版を上げ、古い未送信予定を取り消して新しい予定を作る', async () => {
    const { db, raw } = createTestD1();
    seedBase(raw);
    await registerWebinarSession(db, 'webinar-1', 'friend-1', SESSION, NOW);

    const first = await saveWebinarNotificationSettings(db, 'webinar-1', SETTINGS, NOW);
    expect(first.settings.version).toBe(1);
    expect(first.queued).toBe(4);

    const second = await saveWebinarNotificationSettings(
      db,
      'webinar-1',
      { ...SETTINGS, hourBeforeMinutes: 180 },
      new Date(NOW.getTime() + 60_000),
    );
    expect(second.settings.version).toBe(2);
    expect(second.cancelled).toBe(4);
    expect(second.queued).toBe(4);
    expect(raw.prepare(
      `SELECT COUNT(*) AS count FROM webinar_notification_jobs WHERE status='cancelled'`,
    ).get()).toEqual({ count: 4 });
    expect(raw.prepare(
      `SELECT COUNT(*) AS count FROM webinar_notification_jobs WHERE status='queued'`,
    ).get()).toEqual({ count: 4 });
  });

  test('回を選び直すと前の予定を止め、同じ回への再送信は増やさない', async () => {
    const { db, raw } = createTestD1();
    seedBase(raw);
    await saveWebinarNotificationSettings(db, 'webinar-1', SETTINGS, NOW);
    const first = await registerWebinarSession(db, 'webinar-1', 'friend-1', SESSION, NOW);
    const same = await registerWebinarSession(db, 'webinar-1', 'friend-1', SESSION, NOW);
    expect(first.created).toBe(true);
    expect(same).toMatchObject({ created: false, rescheduled: false });

    const nextSession = SESSION + 3600;
    const changed = await registerWebinarSession(db, 'webinar-1', 'friend-1', nextSession, NOW);
    expect(changed.rescheduled).toBe(true);
    expect(raw.prepare(
      `SELECT COUNT(*) AS count FROM webinar_notification_jobs
        WHERE registration_id=? AND status='cancelled'`,
    ).get(first.registration.id)).toEqual({ count: 4 });
    expect(raw.prepare(
      `SELECT COUNT(*) AS count FROM webinar_notification_jobs
        WHERE registration_id=? AND status='queued'`,
    ).get(changed.registration.id)).toEqual({ count: 4 });
  });

  test('90%視聴のお礼は同じ申込へ1件だけ作る', async () => {
    const { db, raw } = createTestD1();
    seedBase(raw);
    await saveWebinarNotificationSettings(db, 'webinar-1', SETTINGS, NOW);
    await registerWebinarSession(db, 'webinar-1', 'friend-1', SESSION, NOW);
    expect(await enqueueWebinarCompletedNotification(db, 'webinar-1', 'friend-1', SESSION, NOW)).toBe(true);
    expect(await enqueueWebinarCompletedNotification(db, 'webinar-1', 'friend-1', SESSION, NOW)).toBe(false);
    expect(raw.prepare(
      `SELECT COUNT(*) AS count FROM webinar_notification_jobs WHERE kind='completed'`,
    ).get()).toEqual({ count: 1 });
  });

  test('期限の来た通知をHarness Proxyへ一度だけ渡し、retry keyを維持する', async () => {
    const { db, raw } = createTestD1();
    seedBase(raw);
    await saveWebinarNotificationSettings(db, 'webinar-1', SETTINGS, NOW);
    await registerWebinarSession(db, 'webinar-1', 'friend-1', SESSION, NOW);
    const job = raw.prepare(
      `SELECT id, line_retry_key FROM webinar_notification_jobs WHERE kind='day_before'`,
    ).get() as { id: string; line_retry_key: string };
    raw.prepare(
      `UPDATE webinar_notification_jobs SET scheduled_at=?, next_retry_at=? WHERE id=?`,
    ).run(Math.floor(NOW.getTime() / 1000), Math.floor(NOW.getTime() / 1000), job.id);
    const dispatch = vi.fn(async (_request: Request) => new Response('{}', { status: 200 }));

    expect(await processWebinarNotificationJobs(db, {
      now: NOW,
      proxyBaseUrl: 'https://worker.example.com',
      defaultAccessToken: 'fallback',
      defaultLiffId: null,
      proxyDispatch: dispatch,
    })).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(dispatch).toHaveBeenCalledTimes(1);
    const request = dispatch.mock.calls[0]?.[0];
    expect(request.headers.get('X-Line-Retry-Key')).toBe(job.line_retry_key);
    expect(request.headers.get('X-Line-Harness-Source')).toBeNull();
    expect(raw.prepare(`SELECT status FROM webinar_notification_jobs WHERE id=?`).get(job.id))
      .toEqual({ status: 'succeeded' });
  });

  test('見ている人への見逃し案内は送らず、理由のない0件にしない', async () => {
    const { db, raw } = createTestD1();
    seedBase(raw);
    await saveWebinarNotificationSettings(db, 'webinar-1', SETTINGS, NOW);
    await registerWebinarSession(db, 'webinar-1', 'friend-1', SESSION, NOW);
    raw.prepare(
      `INSERT INTO webinar_viewers
       (id, webinar_id, friend_id, session_start_at, joined_at, last_position_seconds)
       VALUES ('viewer-1', 'webinar-1', 'friend-1', ?, ?, 1)`,
    ).run(SESSION, NOW.toISOString());
    const missed = raw.prepare(
      `SELECT id FROM webinar_notification_jobs WHERE kind='missed'`,
    ).get() as { id: string };
    raw.prepare(
      `UPDATE webinar_notification_jobs SET scheduled_at=?, next_retry_at=? WHERE id=?`,
    ).run(Math.floor(NOW.getTime() / 1000), Math.floor(NOW.getTime() / 1000), missed.id);
    const dispatch = vi.fn(async (_request: Request) => new Response('{}', { status: 200 }));

    expect(await processWebinarNotificationJobs(db, {
      now: NOW,
      proxyBaseUrl: 'https://worker.example.com',
      defaultAccessToken: 'fallback',
      defaultLiffId: null,
      proxyDispatch: dispatch,
    })).toEqual({ sent: 0, failed: 0, skipped: 1 });
    expect(dispatch).not.toHaveBeenCalled();
    expect(raw.prepare(`SELECT status FROM webinar_notification_jobs WHERE id=?`).get(missed.id))
      .toEqual({ status: 'skipped' });
  });

  test('外部API失敗は共通の1分・5分・30分だけ再試行し、安全な理由で終了する', async () => {
    const { db, raw } = createTestD1();
    seedBase(raw);
    await saveWebinarNotificationSettings(db, 'webinar-1', SETTINGS, NOW);
    await registerWebinarSession(db, 'webinar-1', 'friend-1', SESSION, NOW);
    const job = raw.prepare(
      `SELECT id FROM webinar_notification_jobs WHERE kind='day_before'`,
    ).get() as { id: string };
    raw.prepare(
      `UPDATE webinar_notification_jobs SET scheduled_at=?, next_retry_at=? WHERE id=?`,
    ).run(Math.floor(NOW.getTime() / 1000), Math.floor(NOW.getTime() / 1000), job.id);
    const dispatch = vi.fn(async () => new Response('provider-secret', { status: 500 }));
    const times = [0, 1, 6, 36].map((minutes) => new Date(NOW.getTime() + minutes * 60_000));

    for (const now of times) {
      await processWebinarNotificationJobs(db, {
        now,
        proxyBaseUrl: 'https://worker.example.com',
        defaultAccessToken: 'fallback',
        defaultLiffId: null,
        proxyDispatch: dispatch,
      });
    }

    expect(dispatch).toHaveBeenCalledTimes(4);
    expect(raw.prepare(
      `SELECT status, attempt_count, next_retry_at, last_error_code, last_error_message
         FROM webinar_notification_jobs WHERE id=?`,
    ).get(job.id)).toEqual({
      status: 'permanent_failed',
      attempt_count: 4,
      next_retry_at: null,
      last_error_code: 'retry_exhausted',
      last_error_message: '自動再試行の上限に達しました。LINE連携を確認し、必要なら手動で再試行してください。',
    });
  });

  test('緊急停止中は送信直前に止め、停止理由を履歴へ残す', async () => {
    const { db, raw } = createTestD1();
    seedBase(raw);
    await saveWebinarNotificationSettings(db, 'webinar-1', SETTINGS, NOW);
    await registerWebinarSession(db, 'webinar-1', 'friend-1', SESSION, NOW);
    const job = raw.prepare(
      `SELECT id FROM webinar_notification_jobs WHERE kind='day_before'`,
    ).get() as { id: string };
    raw.prepare(
      `UPDATE webinar_notification_jobs SET scheduled_at=?, next_retry_at=? WHERE id=?`,
    ).run(Math.floor(NOW.getTime() / 1000), Math.floor(NOW.getTime() / 1000), job.id);
    raw.prepare(
      `INSERT INTO operation_control_sets
         (scope_key, line_account_id, version, states_json, active_incident_id, updated_at)
       VALUES ('account-1', 'account-1', 1, ?, 'incident-1', ?)`,
    ).run(JSON.stringify({ reminder_dispatch: 'stopped' }), NOW.toISOString());
    const dispatch = vi.fn(async () => new Response('{}', { status: 200 }));

    expect(await processWebinarNotificationJobs(db, {
      now: NOW,
      proxyBaseUrl: 'https://worker.example.com',
      defaultAccessToken: 'fallback',
      defaultLiffId: null,
      proxyDispatch: dispatch,
    })).toEqual({ sent: 0, failed: 0, skipped: 1 });
    expect(dispatch).not.toHaveBeenCalled();
    expect(raw.prepare(
      `SELECT status, last_error_code FROM webinar_notification_jobs WHERE id=?`,
    ).get(job.id)).toEqual({ status: 'skipped', last_error_code: 'operation_stopped' });
  });

  test('テスト送信先だけへ自動送信として通知イメージを送る', async () => {
    const { db, raw } = createTestD1();
    seedBase(raw);
    raw.prepare(
      `INSERT INTO account_settings (id, line_account_id, key, value)
       VALUES ('test-recipients', 'account-1', 'test_recipients', '["friend-1"]')`,
    ).run();
    const dispatch = vi.fn(async (_request: Request) => new Response('{}', { status: 200 }));

    expect(await sendWebinarNotificationTest(
      db,
      { id: 'webinar-1', accountId: 'account-1', title: '商品説明会', slug: 'product-live' },
      SESSION,
      {
        now: NOW,
        proxyBaseUrl: 'https://worker.example.com',
        defaultAccessToken: 'fallback',
        defaultLiffId: null,
        proxyDispatch: dispatch,
      },
    )).toEqual({ sent: 1, failed: 0 });
    const request = dispatch.mock.calls[0]?.[0];
    expect(request.headers.get('X-Line-Harness-Source')).toBeNull();
    expect(await request.clone().json()).toEqual(expect.objectContaining({
      messages: [expect.objectContaining({ text: expect.stringContaining('【テスト送信】') })],
    }));
  });
});
