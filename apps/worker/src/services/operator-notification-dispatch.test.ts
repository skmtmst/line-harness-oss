// N-327 (#663): 公開ルールの自動発火・冪等・回復・版固定・境界の契約試験。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createNotificationRule,
  updateNotificationRule,
} from '@line-crm/db';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import {
  dispatchOperatorEvent,
  sweepOperatorNotifications,
  OperatorEventError,
} from './operator-notification-dispatch.js';
import { listOperatorEventTypes } from './operator-notification-registry.js';

const pushMessageWithRequestId = vi.hoisted(() => vi.fn());
const sendOperationEmail = vi.hoisted(() => vi.fn());
vi.mock('@line-crm/line-sdk', () => ({
  LineClient: class {
    pushMessageWithRequestId = pushMessageWithRequestId;
  },
}));
vi.mock('./operation-notifications.js', () => ({ sendOperationEmail }));

const env = {} as Parameters<typeof sendOperationEmail>[0];

function seedBase(db: SqliteD1) {
  const columns = db.raw.prepare(`PRAGMA table_info(notification_rules)`).all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === 'version')) {
    db.raw.prepare(`ALTER TABLE notification_rules ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0)`).run();
  }
  db.raw.prepare(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_operator_notification_instance_source
      ON notification_instances(line_account_id, definition_id, source_event_type, source_event_id)
      WHERE audience_type = 'operator'
  `).run();
  db.raw.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-1', '統括1'), ('tenant-2', '統括2')`).run();
  db.raw.prepare(`
    INSERT INTO line_accounts
      (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
    VALUES ('account-1', 'channel-1', '店舗1', 'token-1', 'secret-1', 1, 'tenant-1'),
           ('account-2', 'channel-2', '店舗2', 'token-2', 'secret-2', 1, 'tenant-2')
  `).run();
  db.raw.prepare(`
    INSERT INTO staff_members
      (id, name, email, role, api_key, line_user_id, email_verified_at,
       assigned_line_account_id, account_scope, tenant_id)
    VALUES ('owner-1', 'オーナー', 'owner@example.test', 'owner', 'key-owner',
            'U-owner', '2026-09-07T10:00:00+09:00', 'account-1', 'accounts', 'tenant-1'),
           ('staff-2', '担当', 'staff@example.test', 'staff', 'key-staff',
            'U-staff', '2026-09-07T10:00:00+09:00', 'account-1', 'accounts', 'tenant-1'),
           ('staff-9', '他統括', 'other@example.test', 'staff', 'key-other',
            'U-other', '2026-09-07T10:00:00+09:00', 'account-1', 'accounts', 'tenant-2')
  `).run();
}

async function publishRule(db: SqliteD1, overrides: Record<string, unknown> = {}) {
  const rule = await createNotificationRule(db.db, {
    lineAccountId: 'account-1',
    name: '新しい予約',
    eventType: 'booking_created',
    conditions: {
      recipientIds: ['owner-1', 'staff-2'],
      message: '新しい予約が入りました',
      ...(overrides.conditions as Record<string, unknown> ?? {}),
    },
    channels: (overrides.channels as string[] | undefined) ?? ['line', 'dashboard'],
  });
  await updateNotificationRule(db.db, rule.id, 'account-1', { isActive: true });
  return rule;
}

describe('運用者通知の自動発火と登録簿', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    pushMessageWithRequestId.mockReset();
    pushMessageWithRequestId.mockResolvedValue({ data: {}, requestId: 'line-request-1' });
    sendOperationEmail.mockReset();
    sendOperationEmail.mockResolvedValue(undefined);
    testDb = createTestD1();
    seedBase(testDb);
  });

  it('登録簿の4件が見え、接続済みと未接続を見分けられる', () => {
    const items = listOperatorEventTypes();
    expect(items.map((item) => item.eventType).sort()).toEqual([
      'booking_created', 'broadcast_completed', 'ec_order_received', 'form_submitted',
    ]);
    expect(items.filter((item) => item.connected).map((item) => item.eventType).sort())
      .toEqual(['booking_created', 'broadcast_completed', 'ec_order_received']);
    // フォームは PR #1469 が未統合で未接続。接続したらここも変える。
    expect(items.filter((item) => !item.connected).map((item) => item.eventType).sort())
      .toEqual(['form_submitted']);
    expect(items.every((item) => item.producer.file.length > 0 && item.producer.route.length > 0)).toBe(true);
  });

  it('未登録のきっかけは発火しない', async () => {
    await expect(dispatchOperatorEvent(testDb.db, env, {
      lineAccountId: 'account-1', eventType: 'not_registered',
      sourceEventId: 'x-1', executionMode: 'automatic',
    })).rejects.toMatchObject({ code: 'unknown_event_type' });
    expect(pushMessageWithRequestId).not.toHaveBeenCalled();
  });

  it('公開済みだけが一致して発火し、下書き・別種別は送らない', async () => {
    const live = await publishRule(testDb);
    await createNotificationRule(testDb.db, {
      lineAccountId: 'account-1', name: '下書き', eventType: 'booking_created',
      conditions: { recipientIds: ['owner-1'] }, channels: ['dashboard'],
    });
    await createNotificationRule(testDb.db, {
      lineAccountId: 'account-1', name: '別種別', eventType: 'form_submitted',
      conditions: { recipientIds: ['owner-1'] }, channels: ['dashboard'],
    }).then(async (draft) => {
      await updateNotificationRule(testDb.db, draft.id, 'account-1', { isActive: true });
    });
    const results = await dispatchOperatorEvent(testDb.db, env, {
      lineAccountId: 'account-1', eventType: 'booking_created',
      sourceEventId: 'booking-1', executionMode: 'automatic',
    });
    expect(results.map((result) => result.ruleId)).toEqual([live.id]);
    // 受信者2人 × (LINE+管理画面) = 4件受理
    expect(results[0]).toMatchObject({ accepted: 4, failed: 0, pending: 0, duplicate: 0 });
  });

  it('同一業務イベントの再送・cron再実行でも台帳を重複作成しない', async () => {
    const live = await publishRule(testDb);
    const input = {
      lineAccountId: 'account-1', eventType: 'booking_created',
      sourceEventId: 'booking-9', executionMode: 'automatic' as const,
    };
    const first = await dispatchOperatorEvent(testDb.db, env, input);
    const second = await dispatchOperatorEvent(testDb.db, env, input);
    // 2接続目の競合: 同じ発生元は受理0・重複扱い
    expect(second[0]).toMatchObject({ accepted: 0, duplicate: 4 });
    expect(first[0]?.instanceId).toBe(second[0]?.instanceId);
    expect(testDb.raw.prepare(`SELECT COUNT(*) AS count FROM notification_instances`).get())
      .toEqual({ count: 1 });
    expect(testDb.raw.prepare(`SELECT COUNT(*) AS count FROM notification_deliveries`).get())
      .toEqual({ count: 4 });
    const ruleInstances = testDb.raw.prepare(
      `SELECT COUNT(DISTINCT definition_id) AS count FROM notification_instances WHERE definition_id = ?`,
    ).get(live.id);
    expect(ruleInstances).toEqual({ count: 1 });
  });

  it('重複防止時間の境目をまたいだ再送でも同じ業務イベントを二重作成しない', async () => {
    vi.useFakeTimers();
    try {
      const live = await publishRule(testDb, {
        channels: ['dashboard'],
        conditions: { dedupeMinutes: 10 },
      });
      vi.setSystemTime(new Date('2026-09-09T00:09:59.000Z'));
      const first = await dispatchOperatorEvent(testDb.db, env, {
        lineAccountId: 'account-1', eventType: 'booking_created',
        sourceEventId: 'booking-boundary', executionMode: 'automatic',
      });
      vi.setSystemTime(new Date('2026-09-09T00:10:01.000Z'));
      const second = await dispatchOperatorEvent(testDb.db, env, {
        lineAccountId: 'account-1', eventType: 'booking_created',
        sourceEventId: 'booking-boundary', executionMode: 'automatic',
      });

      expect(second[0]).toMatchObject({ instanceId: first[0]?.instanceId, duplicate: 2 });
      expect(testDb.raw.prepare(`
        SELECT COUNT(*) AS count FROM notification_instances WHERE definition_id = ?
      `).get(live.id)).toEqual({ count: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('部分失敗: 壊れた宛先があっても届く分は届き、全体は失敗で残る', async () => {
    await publishRule(testDb);
    pushMessageWithRequestId.mockImplementation(async (to: string) => {
      if (to === 'U-staff') throw new Error('provider down');
      return { data: {}, requestId: 'line-ok' };
    });
    const [result] = await dispatchOperatorEvent(testDb.db, env, {
      lineAccountId: 'account-1', eventType: 'booking_created',
      sourceEventId: 'booking-partial', executionMode: 'automatic',
    });
    expect(result).toMatchObject({ accepted: 3, pending: 1, failed: 0 });
    expect(testDb.raw.prepare(`SELECT status FROM notification_instances`).get())
      .toEqual({ status: 'pending' });
    const retry = testDb.raw.prepare(
      `SELECT status, retryable FROM notification_deliveries WHERE status = 'retry_wait'`,
    ).get();
    expect(retry).toMatchObject({ status: 'retry_wait', retryable: 1 });
  });

  it('provider応答消失は送達不明で追跡し、回収で届く', async () => {
    await publishRule(testDb, { channels: ['line'] });
    pushMessageWithRequestId.mockResolvedValue({ data: {} });
    const [result] = await dispatchOperatorEvent(testDb.db, env, {
      lineAccountId: 'account-1', eventType: 'booking_created',
      sourceEventId: 'booking-lost', executionMode: 'automatic',
    });
    expect(result).toMatchObject({ accepted: 0, pending: 2 });
    const unknown = testDb.raw.prepare(
      `SELECT error_code, provider_status FROM notification_deliveries LIMIT 1`,
    ).get();
    expect(unknown).toEqual({ error_code: 'provider_response_unknown', provider_status: 'unknown' });
    expect(testDb.raw.prepare(`SELECT COUNT(*) AS count FROM notification_delivery_attempts`).get())
      .toEqual({ count: 2 });
    // 再送時刻を過ぎたことにする
    testDb.raw.prepare(
      `UPDATE notification_deliveries SET next_retry_at = '2000-01-01T00:00:00+09:00'`,
    ).run();
    pushMessageWithRequestId.mockResolvedValue({ data: {}, requestId: 'line-recovered' });
    const swept = await sweepOperatorNotifications(testDb.db, env, { lineAccountId: 'account-1' });
    expect(swept).toMatchObject({ swept: 2, accepted: 2 });
    expect(testDb.raw.prepare(`SELECT status FROM notification_instances`).get())
      .toEqual({ status: 'completed' });
  });

  it('LINEの認証拒否は再試行せず恒久失敗として安全な理由を残す', async () => {
    await publishRule(testDb, {
      channels: ['line'],
      conditions: { recipientIds: ['owner-1'] },
    });
    pushMessageWithRequestId.mockRejectedValue(Object.assign(
      new Error('LINE API error: 401 token=secret'),
      { status: 401 },
    ));

    const [result] = await dispatchOperatorEvent(testDb.db, env, {
      lineAccountId: 'account-1', eventType: 'booking_created',
      sourceEventId: 'booking-auth-failed', executionMode: 'automatic',
    });

    expect(result).toMatchObject({ failed: 1, pending: 0 });
    expect(testDb.raw.prepare(`
      SELECT status, retryable, error_code, error_message_safe
        FROM notification_deliveries
    `).get()).toEqual({
      status: 'failed',
      retryable: 0,
      error_code: 'line_authentication_failed',
      error_message_safe: 'LINE連携の認証を確認してください。',
    });
  });

  it('LINEの429はRetry-Afterを共通の1分既定より優先する', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-09-09T09:00:00.000Z'));
      await publishRule(testDb, {
        channels: ['line'],
        conditions: { recipientIds: ['owner-1'] },
      });
      pushMessageWithRequestId.mockRejectedValue(Object.assign(
        new Error('LINE API error: 429 body=secret'),
        { status: 429, retryAfter: '120' },
      ));

      const [result] = await dispatchOperatorEvent(testDb.db, env, {
        lineAccountId: 'account-1', eventType: 'booking_created',
        sourceEventId: 'booking-rate-limited', executionMode: 'automatic',
      });

      expect(result).toMatchObject({ pending: 1, failed: 0 });
      expect(testDb.raw.prepare(`
        SELECT status, next_retry_at, error_code, error_message_safe
          FROM notification_deliveries
      `).get()).toEqual({
        status: 'retry_wait',
        next_retry_at: '2026-09-09T09:02:00.000Z',
        error_code: 'line_rate_limited',
        error_message_safe: 'LINE側の送信上限に達しました。時間を置いて再試行します。',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('試行上限を超えたら恒久失敗で閉じる', async () => {
    await publishRule(testDb, { channels: ['line'] });
    pushMessageWithRequestId.mockRejectedValue(new Error('provider down'));
    await dispatchOperatorEvent(testDb.db, env, {
      lineAccountId: 'account-1', eventType: 'booking_created',
      sourceEventId: 'booking-doomed', executionMode: 'automatic',
    });
    testDb.raw.prepare(
      `UPDATE notification_deliveries SET attempts = 3, next_retry_at = '2000-01-01T00:00:00+09:00'`,
    ).run();
    const swept = await sweepOperatorNotifications(testDb.db, env, { lineAccountId: 'account-1' });
    expect(swept).toMatchObject({ failed: 2 });
    expect(testDb.raw.prepare(`SELECT DISTINCT status FROM notification_deliveries`).all())
      .toEqual([{ status: 'failed' }]);
    expect(testDb.raw.prepare(`SELECT status FROM notification_instances`).get())
      .toEqual({ status: 'failed' });
  });

  it('Worker中断の置き土産(pendingのまま)も回収する', async () => {
    const live = await publishRule(testDb, { channels: ['dashboard'] });
    const instanceId = 'instance-stuck';
    testDb.raw.prepare(`
      INSERT INTO notification_instances
        (id, line_account_id, audience_type, definition_id, definition_version_id,
         source_event_type, source_event_id, source_metadata_json,
         dedupe_key, status, created_at, updated_at)
      VALUES (?, 'account-1', 'operator', ?, '1', 'booking_created', 'booking-stuck',
              ?, ?, 'pending', '2000-01-01T00:00:00+09:00', '2000-01-01T00:00:00+09:00')
    `).run(instanceId, live.id, JSON.stringify({ ruleVersion: 1, ruleName: '新しい予約', message: 'ためし' }), `${live.id}:booking-stuck`);
    testDb.raw.prepare(`
      INSERT INTO notification_deliveries
        (id, line_account_id, instance_id, audience_type, recipient_type, recipient_id,
         channel, idempotency_key, status, retryable, attempts, queued_at,
         execution_mode, version, updated_at)
      VALUES ('delivery-stuck', 'account-1', ?, 'operator', 'staff', 'owner-1',
              'in_app', 'retry-stuck', 'pending', 0, 0, '2000-01-01T00:00:00+09:00',
              'automatic', 1, '2000-01-01T00:00:00+09:00')
    `).run(instanceId);
    // 画面通知のINSERT直後、送達行の確定前にWorkerが止まった状態。
    testDb.raw.prepare(`
      INSERT INTO notifications
        (id, rule_id, event_type, title, body, channel, status, metadata,
         line_account_id, category, created_at)
      VALUES ('delivery-stuck', ?, 'booking_created', '新しい予約', 'ためし',
              'dashboard', 'sent', '{}', 'account-1', 'info', '2000-01-01T00:00:00+09:00')
    `).run(live.id);
    const swept = await sweepOperatorNotifications(testDb.db, env, { lineAccountId: 'account-1' });
    expect(swept).toMatchObject({ swept: 1, accepted: 1 });
    // 管理画面の通知一覧にも残る
    expect(testDb.raw.prepare(`SELECT COUNT(*) AS count FROM notifications`).get())
      .toEqual({ count: 1 });
  });

  it('送れない宛先は除外として残し、外部送信の試行回数へ数えない', async () => {
    await publishRule(testDb, {
      channels: ['email'],
      conditions: { recipientIds: ['staff-2'] },
    });
    testDb.raw.prepare(`UPDATE staff_members SET email_verified_at = NULL WHERE id = 'staff-2'`).run();

    const [result] = await dispatchOperatorEvent(testDb.db, env, {
      lineAccountId: 'account-1', eventType: 'booking_created',
      sourceEventId: 'booking-email-unavailable', executionMode: 'automatic',
    });

    expect(result).toMatchObject({ excluded: 1, accepted: 0, pending: 0 });
    expect(testDb.raw.prepare(`SELECT status, attempts FROM notification_deliveries`).get())
      .toEqual({ status: 'excluded', attempts: 0 });
    expect(testDb.raw.prepare(`SELECT COUNT(*) AS count FROM notification_delivery_attempts`).get())
      .toEqual({ count: 0 });
  });

  it('ルール更新中の版固定: 発火済みは旧版のまま、新規は新版で送る', async () => {
    const live = await publishRule(testDb, { channels: ['dashboard'] });
    const [first] = await dispatchOperatorEvent(testDb.db, env, {
      lineAccountId: 'account-1', eventType: 'booking_created',
      sourceEventId: 'booking-v1', executionMode: 'automatic',
    });
    expect(first?.ruleVersion).toBe(1);
    await updateNotificationRule(testDb.db, live.id, 'account-1', {
      conditions: { recipientIds: ['owner-1'], message: '文面を変えました' },
    });
    const [second] = await dispatchOperatorEvent(testDb.db, env, {
      lineAccountId: 'account-1', eventType: 'booking_created',
      sourceEventId: 'booking-v2', executionMode: 'automatic',
    });
    expect(second?.ruleVersion).toBe(2);
    const pinned = testDb.raw.prepare(
      `SELECT definition_version_id FROM notification_instances ORDER BY source_event_id`,
    ).all();
    expect(pinned).toEqual([
      { definition_version_id: '1' },
      { definition_version_id: '2' },
    ]);
    const deliveryVersions = testDb.raw.prepare(
      `SELECT DISTINCT version FROM notification_deliveries ORDER BY version`,
    ).all();
    expect(deliveryVersions).toEqual([{ version: 1 }, { version: 2 }]);
  });

  it('再試行はルール更新後も発火時点の文面とチャネルを使う', async () => {
    const live = await publishRule(testDb, {
      channels: ['line'],
      conditions: { recipientIds: ['owner-1'], message: '公開時の文面' },
    });
    pushMessageWithRequestId.mockRejectedValueOnce(new Error('temporary'));
    await dispatchOperatorEvent(testDb.db, env, {
      lineAccountId: 'account-1', eventType: 'booking_created',
      sourceEventId: 'booking-version-retry', executionMode: 'automatic',
    });
    await updateNotificationRule(testDb.db, live.id, 'account-1', {
      channels: ['dashboard'],
      conditions: { recipientIds: ['owner-1'], message: '更新後の文面' },
    });
    testDb.raw.prepare(`
      UPDATE notification_deliveries SET next_retry_at = '2000-01-01T00:00:00.000Z'
    `).run();
    pushMessageWithRequestId.mockReset();
    pushMessageWithRequestId.mockResolvedValue({ data: {}, requestId: 'line-retry-ok' });

    const swept = await sweepOperatorNotifications(testDb.db, env, { lineAccountId: 'account-1' });

    expect(swept).toMatchObject({ swept: 1, accepted: 1 });
    expect(pushMessageWithRequestId).toHaveBeenCalledOnce();
    expect(pushMessageWithRequestId.mock.calls[0]?.[1]).toEqual([
      { type: 'text', text: '公開時の文面' },
    ]);
  });

  it('2つの回収処理が同時に走っても同じ送達を1回だけ送る', async () => {
    await publishRule(testDb, {
      channels: ['line'],
      conditions: { recipientIds: ['owner-1'] },
    });
    pushMessageWithRequestId.mockRejectedValueOnce(new Error('temporary'));
    await dispatchOperatorEvent(testDb.db, env, {
      lineAccountId: 'account-1', eventType: 'booking_created',
      sourceEventId: 'booking-concurrent-sweep', executionMode: 'automatic',
    });
    testDb.raw.prepare(`
      UPDATE notification_deliveries SET next_retry_at = '2000-01-01T00:00:00.000Z'
    `).run();
    pushMessageWithRequestId.mockReset();
    let release!: (value: { data: Record<string, never>; requestId: string }) => void;
    pushMessageWithRequestId.mockImplementation(() => new Promise((resolve) => { release = resolve; }));

    const firstSweep = sweepOperatorNotifications(testDb.db, env, { lineAccountId: 'account-1' });
    await vi.waitFor(() => expect(pushMessageWithRequestId).toHaveBeenCalledOnce());
    const secondSweep = sweepOperatorNotifications(testDb.db, env, { lineAccountId: 'account-1' });
    release({ data: {}, requestId: 'line-once' });
    const [first, second] = await Promise.all([firstSweep, secondSweep]);

    expect(first.swept + second.swept).toBe(1);
    expect(pushMessageWithRequestId).toHaveBeenCalledOnce();
    expect(testDb.raw.prepare(`SELECT attempts FROM notification_deliveries`).get())
      .toEqual({ attempts: 2 });
  });

  it('境界fail-close: 別アカウントの出来事は別店のルール・受信者・鍵を使わない', async () => {
    await publishRule(testDb);
    const results = await dispatchOperatorEvent(testDb.db, env, {
      lineAccountId: 'account-2', eventType: 'booking_created',
      sourceEventId: 'booking-other', executionMode: 'automatic',
    });
    expect(results).toEqual([]);
    expect(pushMessageWithRequestId).not.toHaveBeenCalled();
    expect(testDb.raw.prepare(`SELECT COUNT(*) AS count FROM notification_instances`).get())
      .toEqual({ count: 0 });
  });

  it('他統括のスタッフは受信者に混ぜない', async () => {
    await publishRule(testDb, {
      conditions: { recipientIds: ['owner-1', 'staff-9'] },
      channels: ['dashboard'],
    });
    const [result] = await dispatchOperatorEvent(testDb.db, env, {
      lineAccountId: 'account-1', eventType: 'booking_created',
      sourceEventId: 'booking-scope', executionMode: 'automatic',
    });
    expect(result).toMatchObject({ accepted: 1, duplicate: 0 });
    expect(testDb.raw.prepare(
      `SELECT recipient_id FROM notification_deliveries`,
    ).all()).toEqual([{ recipient_id: 'owner-1' }]);
  });

  it('unknown_event_type は OperatorEventError の約束を守る', () => {
    expect(new OperatorEventError('x', 'y')).toMatchObject({ code: 'x' });
  });
});
