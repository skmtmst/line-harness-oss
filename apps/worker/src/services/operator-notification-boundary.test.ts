/*
 * N-327 (#663): 境界の守りのうち、誰も見張っていなかった3か所を見張る。
 *
 * 審査(2026-09-12)が守りを1つずつ外して測ったところ、次の3つは**外しても
 * 全スイートが緑のまま**だった。つまり本当に誰も見ていなかった。
 *
 * ここで止めたい崩れ方:
 *   T2. account-1 のルールが別店所属のスタッフを名指ししたとき、その人へ送ってしまう
 *   T3. 停止中の LINE アカウントの鍵で送ってしまう
 *   T4. 積んだ後で無効になった受信者へ、回収が送ってしまう
 *
 * いずれも既存の境界試験は**ルール取得の層**(getActiveNotificationRulesByEvent の
 * line_account_id 絞り)で止まるため、受信者解決・鍵解決・回収の層まで到達しない。
 * 多層防御の内側が素通しだと、外側を誰かが緩めた瞬間に最後の砦が消えている。
 *
 * T2 はアカウント境界。通知は外へ出るので、**別店のスタッフへ他店の情報が届く。**
 * T4 は cron から走る経路で、**要求の文脈が無いところで境界を見ている最後の層。**
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

const pushMessageWithRequestId = vi.hoisted(() => vi.fn());
const sendOperationEmail = vi.hoisted(() => vi.fn());
vi.mock('@line-crm/line-sdk', () => ({
  LineClient: class { pushMessageWithRequestId = pushMessageWithRequestId; },
}));
vi.mock('./operation-notifications.js', () => ({ sendOperationEmail }));

const { dispatchOperatorEvent, sweepOperatorNotifications } = await import(
  './operator-notification-dispatch.js'
);

const A = 'account-1';
/** 固定時刻。next_retry_at の過去/未来を時計に依存させない。 */
const NOW = new Date('2026-11-02T03:00:00.000Z');

function base(db: SqliteD1, opts?: { accountActive?: number }) {
  db.raw.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-1','統括1')`).run();
  db.raw.prepare(`
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
    VALUES (?, 'channel-1','店舗1','token-1','secret-1', ?, 'tenant-1')
  `).run(A, opts?.accountActive ?? 1);
  db.raw.prepare(`
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
    VALUES ('account-2','channel-2','店舗2','token-2','secret-2',1,'tenant-1')
  `).run();
}

/** account_scope='accounts' で account-2 に割り当てられたスタッフ */
function otherAccountStaff(db: SqliteD1) {
  db.raw.prepare(`
    INSERT INTO staff_members (id, name, email, role, api_key, line_user_id, email_verified_at,
      assigned_line_account_id, account_scope, tenant_id, is_active)
    VALUES ('staff-other','別店のスタッフ','other@example.test','admin','key-other','U-other',
            '2026-09-07T10:00:00+09:00','account-2','accounts','tenant-1',1)
  `).run();
}

function ownStaff(db: SqliteD1) {
  db.raw.prepare(`
    INSERT INTO staff_members (id, name, email, role, api_key, line_user_id, email_verified_at,
      assigned_line_account_id, account_scope, tenant_id, is_active)
    VALUES ('owner-1','オーナー','owner@example.test','owner','key-owner','U-owner',
            '2026-09-07T10:00:00+09:00', ?, 'all','tenant-1',1)
  `).run(A);
}

function rule(db: SqliteD1, recipientIds: string[]) {
  db.raw.prepare(`
    INSERT INTO notification_rules (id, name, event_type, conditions, channels, line_account_id, is_active)
    VALUES ('rule-1','新しい予約','booking_created', ?, '["line"]', ?, 1)
  `).run(JSON.stringify({ recipientIds, message: '新しい予約が入りました', dedupeMinutes: 0 }), A);
}

/** 送り残しの行を1件作る（回収の対象になる retry_wait） */
function seedStuck(db: SqliteD1, id: string) {
  db.raw.prepare(`
    INSERT INTO notification_instances
      (id, line_account_id, audience_type, definition_id, source_event_type, source_event_id,
       source_metadata_json, dedupe_key, status, created_at, updated_at)
    VALUES (?, ?, 'operator','rule-1','booking_created', ?, ?, ?, 'pending', ?, ?)
  `).run(`instance-${id}`, A, `booking-${id}`,
    JSON.stringify({ message: '新しい予約が入りました', ruleName: '新しい予約', channels: ['line'] }),
    `dedupe-${id}`, '2026-11-02T00:00:00.000Z', '2026-11-02T00:00:00.000Z');
  db.raw.prepare(`
    INSERT INTO notification_deliveries
      (id, line_account_id, instance_id, audience_type, recipient_type, recipient_id,
       channel, idempotency_key, status, retryable, attempts, next_retry_at,
       queued_at, execution_mode, version, updated_at)
    VALUES (?, ?, ?, 'operator','staff','owner-1','line', ?, 'retry_wait', 1, 1, ?, ?, 'automatic', 1, ?)
  `).run(id, A, `instance-${id}`, `key-${id}`,
    '2026-11-02T00:00:00.000Z', '2026-11-02T00:00:00.000Z', '2026-11-02T00:00:00.000Z');
}

const env = () => ({} as never);

describe('N-327 #663 運用者通知の境界 — 受信者と鍵', () => {
  let db: SqliteD1;

  beforeEach(() => {
    pushMessageWithRequestId.mockReset();
    pushMessageWithRequestId.mockResolvedValue({ data: {}, requestId: 'req-1' });
    sendOperationEmail.mockReset();
    sendOperationEmail.mockResolvedValue(undefined);
    db = createTestD1();
  });

  it('別店所属のスタッフを名指ししても、その人へは送らない', async () => {
    base(db); ownStaff(db); otherAccountStaff(db);
    rule(db, ['staff-other']);
    await dispatchOperatorEvent(db.db, env(), {
      lineAccountId: A, eventType: 'booking_created', sourceEventId: 'bk-1',
      executionMode: 'automatic',
    });
    expect(pushMessageWithRequestId).not.toHaveBeenCalled();
  });

  it('停止中の LINE アカウントの鍵では送らない', async () => {
    base(db, { accountActive: 0 }); ownStaff(db);
    rule(db, ['owner-1']);
    await dispatchOperatorEvent(db.db, env(), {
      lineAccountId: A, eventType: 'booking_created', sourceEventId: 'bk-1',
      executionMode: 'automatic',
    });
    expect(pushMessageWithRequestId).not.toHaveBeenCalled();
  });

  it('回収のとき、積んだ後で無効になった受信者へは送らない', async () => {
    base(db); ownStaff(db); rule(db, ['owner-1']);
    seedStuck(db, 'delivery-1');
    db.raw.prepare(`UPDATE staff_members SET is_active = 0 WHERE id = 'owner-1'`).run();
    await sweepOperatorNotifications(db.db, env(), { limit: 10, now: NOW });
    const row = db.raw.prepare(
      `SELECT status, error_code FROM notification_deliveries WHERE id = 'delivery-1'`,
    ).get() as { status: string; error_code: string | null };
    expect(pushMessageWithRequestId).not.toHaveBeenCalled();
    expect(row.status).toBe('excluded');
    expect(row.error_code).toBe('staff_not_available');
  });
});
