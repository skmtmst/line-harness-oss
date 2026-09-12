import { describe, expect, test, vi } from 'vitest';

import { createTestD1, insertFriend } from '../test-utils/d1-sqlite.js';
import {
  calculateWebinarNotificationSchedule,
  enqueueWebinarCompletedNotification,
  getWebinarNotificationOverview,
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
  test('通知対象は有効予約の人数と予約枠数を分けて数える', async () => {
    const { db, raw } = createTestD1();
    seedBase(raw);
    insertFriend(raw, 'friend-2', { line_account_id: 'account-1', line_user_id: 'U002' });
    const insert = raw.prepare(
      `INSERT INTO webinar_registrations
         (id, webinar_id, friend_id, session_start_at, status, created_at)
       VALUES (?, 'webinar-1', ?, ?, ?, ?)`,
    );
    insert.run('registration-1', 'friend-1', SESSION, 'active', NOW.toISOString());
    insert.run('registration-2', 'friend-1', SESSION + 3600, 'active', NOW.toISOString());
    insert.run('registration-3', 'friend-2', SESSION, 'active', NOW.toISOString());
    insert.run('registration-4', 'friend-2', SESSION + 3600, 'cancelled', NOW.toISOString());

    const result = await getWebinarNotificationOverview(db, 'webinar-1');

    expect(result).toMatchObject({
      total: 0,
      audience: { people: 2, bookings: 3, definition: 'active_registrations' },
    });
  });

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
    })).toEqual({ sent: 1, failed: 0, skipped: 0, heldByStop: 0 });
    expect(dispatch).toHaveBeenCalledTimes(1);
    const request = dispatch.mock.calls[0]?.[0];
    expect(request.headers.get('X-Line-Retry-Key')).toBe(job.line_retry_key);
    expect(request.headers.get('X-Line-Harness-Source')).toBeNull();
    expect(raw.prepare(`SELECT status FROM webinar_notification_jobs WHERE id=?`).get(job.id))
      .toEqual({ status: 'succeeded' });
  });

  test('機能オフ中は予約をclaimせず、再開可能なまま監査だけを残す', async () => {
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
      `UPDATE account_settings SET value='{"enabled":false}'
        WHERE line_account_id='account-1' AND key='feature.webinars'`,
    ).run();
    const dispatch = vi.fn(async () => new Response('{}', { status: 200 }));

    expect(await processWebinarNotificationJobs(db, {
      now: NOW,
      proxyBaseUrl: 'https://worker.example.com',
      defaultAccessToken: 'fallback',
      defaultLiffId: null,
      proxyDispatch: dispatch,
    })).toEqual({ sent: 0, failed: 0, skipped: 1, heldByStop: 0 });
    expect(dispatch).not.toHaveBeenCalled();
    expect(raw.prepare(
      `SELECT status, attempt_count FROM webinar_notification_jobs WHERE id=?`,
    ).get(job.id)).toEqual({ status: 'queued', attempt_count: 0 });
    expect(raw.prepare(
      `SELECT action, target_id FROM audit_events WHERE action='feature.execution.skipped'`,
    ).get()).toEqual({ action: 'feature.execution.skipped', target_id: 'webinar-notifications' });
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
    })).toEqual({ sent: 0, failed: 0, skipped: 1, heldByStop: 0 });
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

  /*
   * #745 の裁定で契約が変わりました。**緊急停止は「捨てる」から「止める」へ。**
   *
   * 元の表明（`status='skipped'`, `last_error_code='operation_stopped'` に
   * なること）が捕まえていた壊し方は2つです。
   *
   *   1. 緊急停止中なのに外部へ送ってしまう
   *      → 下の `expect(dispatch).not.toHaveBeenCalled()` が引き続き捕まえます
   *   2. 緊急停止が判定されず、何事も無かったことにされる
   *      → 元は「skipped が1件」で見ていました。いまは `heldByStop: 1` で見ます
   *
   * そして元の表明は、**復旧しても永久に届かない**という壊れ方を
   * 通していました（`skipped` を戻す経路が無いため）。新しい表明は
   * 「行が触られていないこと」と「復旧したら実際に届くこと」まで見るので、
   * 元より強くなっています。
   */
  test('緊急停止中は行を確定させず、復旧したら実際に届く', async () => {
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
    const options = {
      now: NOW,
      proxyBaseUrl: 'https://worker.example.com',
      defaultAccessToken: 'fallback',
      defaultLiffId: null,
      proxyDispatch: dispatch,
    };

    expect(await processWebinarNotificationJobs(db, options))
      .toEqual({ sent: 0, failed: 0, skipped: 0, heldByStop: 1 });
    expect(dispatch).not.toHaveBeenCalled();
    // **行に触らない。**claim もしない（attempt_count が毎tick増えると、
    // 取り出しの上限に当たった時点でやはり黙って届かなくなる）。
    expect(raw.prepare(
      `SELECT status, attempt_count, last_error_code, lease_expires_at
         FROM webinar_notification_jobs WHERE id=?`,
    ).get(job.id)).toEqual({
      status: 'queued', attempt_count: 0, last_error_code: null, lease_expires_at: null,
    });

    // 止めている間、何tick回しても増えない。
    await processWebinarNotificationJobs(db, options);
    await processWebinarNotificationJobs(db, options);
    expect(raw.prepare(`SELECT attempt_count FROM webinar_notification_jobs WHERE id=?`).get(job.id))
      .toEqual({ attempt_count: 0 });

    // 復旧したら届く。ここが元の表明では通っていた壊れ方（永久に届かない）。
    raw.prepare(`UPDATE operation_control_sets SET states_json=?, active_incident_id=NULL WHERE scope_key='account-1'`)
      .run(JSON.stringify({ reminder_dispatch: 'running' }));
    expect(await processWebinarNotificationJobs(db, options))
      .toEqual({ sent: 1, failed: 0, skipped: 0, heldByStop: 0 });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(raw.prepare(`SELECT status FROM webinar_notification_jobs WHERE id=?`).get(job.id))
      .toEqual({ status: 'succeeded' });
  });

  /*
   * 落とす理由は「期限を過ぎた」であって「止まっていた」ではない（#745）。
   * 停止中は判断そのものを先送りし、復旧したときに、そのジョブ自身の
   * 予定時刻で改めて判断する。
   */
  test('停止をまたいで期限が切れたら、停止ではなく期限を理由に落ちる', async () => {
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

    // 停止中は落とさない。行は queued のまま。
    expect(await processWebinarNotificationJobs(db, {
      now: NOW, proxyBaseUrl: 'https://worker.example.com',
      defaultAccessToken: 'fallback', defaultLiffId: null, proxyDispatch: dispatch,
    })).toEqual({ sent: 0, failed: 0, skipped: 0, heldByStop: 1 });
    expect(raw.prepare(`SELECT status FROM webinar_notification_jobs WHERE id=?`).get(job.id))
      .toEqual({ status: 'queued' });

    // 復旧したときには、対象回が終わっている。
    raw.prepare(`UPDATE operation_control_sets SET states_json=?, active_incident_id=NULL WHERE scope_key='account-1'`)
      .run(JSON.stringify({ reminder_dispatch: 'running' }));
    const afterSession = new Date((SESSION + 3600 + 60) * 1000);
    // 前日・開始前・開始時の3件がまとめて期限切れになる（対象回が終わったため）。
    // 見逃し案内(missed)はまだ予定時刻に達していないので対象外。
    expect(await processWebinarNotificationJobs(db, {
      now: afterSession, proxyBaseUrl: 'https://worker.example.com',
      defaultAccessToken: 'fallback', defaultLiffId: null, proxyDispatch: dispatch,
    })).toEqual({ sent: 0, failed: 0, skipped: 3, heldByStop: 0 });
    expect(dispatch).not.toHaveBeenCalled();
    // 理由は notification_expired。operation_stopped ではない。
    expect(raw.prepare(
      `SELECT status, last_error_code FROM webinar_notification_jobs WHERE id=?`,
    ).get(job.id)).toEqual({ status: 'skipped', last_error_code: 'notification_expired' });
  });

  /*
   * 「見送り 5件」だけでは、取るべき行動が決まらない（#745）。
   * 視聴済み（正常）と対象回の終了（届かないまま終わった）を分けて出す。
   */
  test('見送りの内訳を理由ごとに数えて返す', async () => {
    const { db, raw } = createTestD1();
    seedBase(raw);
    const insert = raw.prepare(
      `INSERT INTO webinar_notification_jobs
         (id, webinar_id, registration_id, friend_id, session_start_at, settings_version, kind,
          scheduled_at, status, attempt_count, line_retry_key, last_error_code, created_at, updated_at)
       VALUES (?, 'webinar-1', ?, 'friend-1', ?, 1, ?, ?, 'skipped', 1, ?, ?, ?, ?)`,
    );
    raw.prepare(
      `INSERT INTO webinar_registrations (id, webinar_id, friend_id, session_start_at, status, created_at)
       VALUES ('registration-1','webinar-1','friend-1',?, 'active', ?)`,
    ).run(SESSION, NOW.toISOString());
    insert.run('j1', 'registration-1', SESSION, 'day_before', SESSION - 86400, 'rk1', 'notification_expired', NOW.toISOString(), NOW.toISOString());
    insert.run('j2', 'registration-1', SESSION, 'hour_before', SESSION - 3600, 'rk2', 'notification_expired', NOW.toISOString(), NOW.toISOString());
    insert.run('j3', 'registration-1', SESSION, 'missed', SESSION + 86400, 'rk3', 'already_viewed', NOW.toISOString(), NOW.toISOString());
    insert.run('j4', 'registration-1', SESSION, 'session_start', SESSION, 'rk4', null, NOW.toISOString(), NOW.toISOString());
    // 見送り以外の行にも理由の符号は付く。**内訳に混ぜない。**
    // 混ぜると「対象回が終了済み 2件」の隣に、送信の再試行が尽きた失敗が
    // 並び、運用者は見送りの件数を読み違える。
    raw.prepare(
      `INSERT INTO webinar_notification_jobs
         (id, webinar_id, registration_id, friend_id, session_start_at, settings_version, kind,
          scheduled_at, status, attempt_count, line_retry_key, last_error_code, created_at, updated_at)
       VALUES ('j5','webinar-1','registration-1','friend-1',?,1,'completed',?, 'permanent_failed', 3, 'rk5',
               'retry_exhausted', ?, ?)`,
    ).run(SESSION, SESSION + 7200, NOW.toISOString(), NOW.toISOString());

    const overview = await getWebinarNotificationOverview(db, 'webinar-1');
    expect(overview.skipped).toBe(4);
    expect(overview.skippedReasons).toEqual([
      { code: 'notification_expired', label: '対象回が終了済み', count: 2 },
      { code: null, label: '理由の記録なし', count: 1 },
      { code: 'already_viewed', label: 'すでに視聴済み', count: 1 },
    ]);
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
