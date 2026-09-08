/**
 * N-065 契約テスト: 予約・イベント・Meet の取消/日程変更を V6 へ同期する。
 *
 * 本物の SQLite (createTestD1) に当て、SQL そのものが約束を守るか確かめる。
 * 外部 LINE・顧客・Calendar へは送らない。対象は enroll / cancel / reschedule
 * の DB 連携だけで、通知送信は触らない。
 */
import { describe, expect, it } from 'vitest';

import { createTestD1, insertFriend } from '../test-utils/d1-sqlite.js';
import {
  cancelFriendReminder,
  claimReminderDeliveryRun,
  completeReminderDeliveryRunStatement,
  enrollFriendInReminder,
  getFriendReminderStatus,
  verifyClaimedRunBeforeSend,
} from '@line-crm/db';
import { cancelByTrigger, enrollByTrigger, reconcileV6ToStartsAt, rescheduleByTrigger } from './reminder-trigger.js';
import {
  cancelMeetConsultation,
  registerMeetConsultation,
} from './meet-consultation-reminders.js';

const ACCOUNT_1 = 'account-1';
const ACCOUNT_2 = 'account-2';

function seedAccount(raw: import('better-sqlite3').Database, id: string): void {
  raw.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
     VALUES (?, ?, ?, 'token', 'secret')`,
  ).run(id, `channel-${id}`, id);
}

/** 公開済みのきっかけルールを1本作る。起点は開始時刻そのもの。 */
function seedTriggerRule(
  raw: import('better-sqlite3').Database,
  id: string,
  triggerType: 'booking' | 'event',
  account = ACCOUNT_1,
): void {
  raw.prepare(
    `INSERT INTO reminders
       (id, name, line_account_id, is_active, trigger_type, delivery_mode, lifecycle_status)
     VALUES (?, ?, ?, 1, ?, 'countdown', 'published')`,
  ).run(id, `rule-${id}`, account, triggerType);
  raw.prepare(
    `INSERT INTO reminder_steps
       (id, reminder_id, offset_minutes, message_type, message_content)
     VALUES (?, ?, -60, 'text', 'ご来店をお待ちしています')`,
  ).run(`step-${id}`, id);
}

function enrollmentId(raw: import('better-sqlite3').Database, friendId: string): string {
  const row = raw.prepare(`SELECT id FROM friend_reminders WHERE friend_id = ?`).get(friendId) as {
    id: string;
  };
  return row.id;
}

function seedRule(
  raw: import('better-sqlite3').Database,
  id: string,
  triggerType: 'booking' | 'event' | 'manual',
): void {
  seedTriggerRule(raw, id, triggerType as 'booking' | 'event');
  if (triggerType === 'manual') {
    raw.prepare(`UPDATE reminders SET trigger_type = 'manual' WHERE id = ?`).run(id);
  }
}

function seedRun(
  raw: import('better-sqlite3').Database,
  id: string,
  enrollmentIdValue: string,
  friendId: string,
  reminderId: string,
  status: 'queued' | 'claimed' | 'retry_wait' | 'succeeded',
  scheduledAt: string,
): void {
  raw.prepare(
    `INSERT INTO reminder_delivery_runs
       (id, line_account_id, reminder_id, friend_reminder_id, friend_id,
        reminder_step_id, scheduled_at, idempotency_key, line_retry_key,
        status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    ACCOUNT_1,
    reminderId,
    enrollmentIdValue,
    friendId,
    `step-${reminderId}`,
    scheduledAt,
    `idem-${id}`,
    `retry-${id}`,
    status,
    '2026-09-01T00:00:00.000Z',
    '2026-09-01T00:00:00.000Z',
  );
}

describe('予約の取消', () => {
  it('未送信だけ止め、送信済み履歴と取消の追跡を残す', async () => {
    const { db, raw } = createTestD1();
    seedAccount(raw, ACCOUNT_1);
    insertFriend(raw, 'friend-1', { line_account_id: ACCOUNT_1 });
    seedTriggerRule(raw, 'rule-booking-1', 'booking');

    const startsAt = '2026-09-20T01:00:00.000Z';
    await enrollByTrigger(db, {
      triggerType: 'booking',
      friendId: 'friend-1',
      startsAtIso: startsAt,
      sourceId: 'bk-1',
      sourceEventId: 'bk-1',
      lineAccountId: ACCOUNT_1,
    });
    const enrollment = enrollmentId(raw, 'friend-1');
    // 未来の未送信と、送り終えた履歴を用意する。
    seedRun(raw, 'run-queued', enrollment, 'friend-1', 'rule-booking-1', 'queued', '2026-09-20T00:00:00.000Z');
    seedRun(raw, 'run-sent', enrollment, 'friend-1', 'rule-booking-1', 'succeeded', '2026-09-19T00:00:00.000Z');
    raw.prepare(
      `INSERT INTO friend_reminder_deliveries (id, friend_reminder_id, reminder_step_id, delivered_at)
       VALUES ('del-1', ?, 'step-rule-booking-1', '2026-09-19T00:00:00.000Z')`,
    ).run(enrollment);

    const result = await cancelByTrigger(db, {
      triggerType: 'booking',
      sourceId: 'bk-1',
      sourceEventId: 'bk-1',
      friendId: 'friend-1',
      startsAtIso: startsAt,
      lineAccountId: ACCOUNT_1,
      cancelReason: 'booking_cancel:bk-1:by:staff-9',
    });
    expect(result).toEqual({ cancelledEnrollments: 1, cancelledRuns: 1 });

    // 取消理由・元イベントID・実行者が残る。
    expect(
      raw.prepare(`SELECT status, cancel_reason FROM friend_reminders WHERE id = ?`).get(enrollment),
    ).toEqual({ status: 'cancelled', cancel_reason: 'booking_cancel:bk-1:by:staff-9' });
    // 未送信は止まり、送信済みは残る。
    expect(raw.prepare(`SELECT status FROM reminder_delivery_runs WHERE id = 'run-queued'`).get()).toEqual({
      status: 'cancelled',
    });
    expect(raw.prepare(`SELECT status FROM reminder_delivery_runs WHERE id = 'run-sent'`).get()).toEqual({
      status: 'succeeded',
    });
    expect(raw.prepare(`SELECT COUNT(*) AS c FROM friend_reminder_deliveries`).get()).toEqual({ c: 1 });
  });

  it('同じ取消通知の再送で二重取消を起こさない', async () => {
    const { db, raw } = createTestD1();
    seedAccount(raw, ACCOUNT_1);
    insertFriend(raw, 'friend-1', { line_account_id: ACCOUNT_1 });
    seedTriggerRule(raw, 'rule-booking-1', 'booking');

    await enrollByTrigger(db, {
      triggerType: 'booking',
      friendId: 'friend-1',
      startsAtIso: '2026-09-20T01:00:00.000Z',
      sourceId: 'bk-1',
      sourceEventId: 'bk-1',
      lineAccountId: ACCOUNT_1,
    });
    const input = {
      triggerType: 'booking' as const,
      sourceId: 'bk-1',
      sourceEventId: 'bk-1',
      friendId: 'friend-1',
      startsAtIso: '2026-09-20T01:00:00.000Z',
      lineAccountId: ACCOUNT_1,
      cancelReason: 'booking_cancel:bk-1:by:staff-9',
    };
    expect(await cancelByTrigger(db, input)).toEqual({ cancelledEnrollments: 1, cancelledRuns: 0 });
    expect(await cancelByTrigger(db, input)).toEqual({ cancelledEnrollments: 0, cancelledRuns: 0 });
    expect(raw.prepare(`SELECT COUNT(*) AS c FROM friend_reminders`).get()).toEqual({ c: 1 });
  });

  it('別アカウントの登録へ影響しない', async () => {
    const { db, raw } = createTestD1();
    seedAccount(raw, ACCOUNT_1);
    seedAccount(raw, ACCOUNT_2);
    insertFriend(raw, 'friend-1', { line_account_id: ACCOUNT_1 });
    insertFriend(raw, 'friend-2', { line_account_id: ACCOUNT_2 });
    seedTriggerRule(raw, 'rule-booking-1', 'booking', ACCOUNT_1);
    seedTriggerRule(raw, 'rule-booking-2', 'booking', ACCOUNT_2);

    await enrollByTrigger(db, {
      triggerType: 'booking',
      friendId: 'friend-1',
      startsAtIso: '2026-09-20T01:00:00.000Z',
      sourceId: 'bk-1',
      sourceEventId: 'bk-1',
      lineAccountId: ACCOUNT_1,
    });
    await enrollByTrigger(db, {
      triggerType: 'booking',
      friendId: 'friend-2',
      startsAtIso: '2026-09-20T01:00:00.000Z',
      sourceId: 'bk-2',
      sourceEventId: 'bk-2',
      lineAccountId: ACCOUNT_2,
    });

    const result = await cancelByTrigger(db, {
      triggerType: 'booking',
      sourceId: 'bk-1',
      sourceEventId: 'bk-1',
      friendId: 'friend-1',
      startsAtIso: '2026-09-20T01:00:00.000Z',
      lineAccountId: ACCOUNT_1,
      cancelReason: 'booking_cancel:bk-1:by:staff-9',
    });
    expect(result).toEqual({ cancelledEnrollments: 1, cancelledRuns: 0 });
    expect(
      raw.prepare(`SELECT status FROM friend_reminders WHERE friend_id = 'friend-2'`).get(),
    ).toEqual({ status: 'active' });
  });

  it('別の予約の取消がこちらの予定へ触れない', async () => {
    const { db, raw } = createTestD1();
    seedAccount(raw, ACCOUNT_1);
    insertFriend(raw, 'friend-1', { line_account_id: ACCOUNT_1 });
    seedTriggerRule(raw, 'rule-booking-1', 'booking');

    await enrollByTrigger(db, {
      triggerType: 'booking',
      friendId: 'friend-1',
      startsAtIso: '2026-09-20T01:00:00.000Z',
      sourceId: 'bk-1',
      sourceEventId: 'bk-1',
      lineAccountId: ACCOUNT_1,
    });
    await enrollByTrigger(db, {
      triggerType: 'booking',
      friendId: 'friend-1',
      startsAtIso: '2026-09-21T01:00:00.000Z',
      sourceId: 'bk-2',
      sourceEventId: 'bk-2',
      lineAccountId: ACCOUNT_1,
    });

    const result = await cancelByTrigger(db, {
      triggerType: 'booking',
      sourceId: 'bk-1',
      sourceEventId: 'bk-1',
      friendId: 'friend-1',
      startsAtIso: '2026-09-20T01:00:00.000Z',
      lineAccountId: ACCOUNT_1,
      cancelReason: 'booking_cancel:bk-1:by:staff-9',
    });
    expect(result).toEqual({ cancelledEnrollments: 1, cancelledRuns: 0 });
    expect(
      raw.prepare(`SELECT status FROM friend_reminders WHERE source_event_id = 'bk-2'`).get(),
    ).toEqual({ status: 'active' });
  });

  it('移行前の行 (source 未記録) は友だちと起点で止める', async () => {
    const { db, raw } = createTestD1();
    seedAccount(raw, ACCOUNT_1);
    insertFriend(raw, 'friend-1', { line_account_id: ACCOUNT_1 });
    seedTriggerRule(raw, 'rule-booking-1', 'booking');

    // N-065 より前の登録には source が無い。
    raw.prepare(
      `INSERT INTO friend_reminders (id, friend_id, reminder_id, target_date, status)
       VALUES ('legacy-1', 'friend-1', 'rule-booking-1', '2026-09-20T01:00:00.000Z', 'active')`,
    ).run();

    const result = await cancelByTrigger(db, {
      triggerType: 'booking',
      sourceId: 'bk-1',
      sourceEventId: 'bk-1',
      friendId: 'friend-1',
      startsAtIso: '2026-09-20T01:00:00.000Z',
      lineAccountId: ACCOUNT_1,
      cancelReason: 'booking_cancel:bk-1:by:staff-9',
    });
    expect(result).toEqual({ cancelledEnrollments: 1, cancelledRuns: 0 });
    expect(raw.prepare(`SELECT status FROM friend_reminders WHERE id = 'legacy-1'`).get()).toEqual({
      status: 'cancelled',
    });
  });
});

describe('イベントの日程変更', () => {
  it('送信済みを残し、未来予定だけ新基準日へ移す。再送は無変更', async () => {
    const { db, raw } = createTestD1();
    seedAccount(raw, ACCOUNT_1);
    insertFriend(raw, 'friend-1', { line_account_id: ACCOUNT_1 });
    seedTriggerRule(raw, 'rule-event-1', 'event');

    const oldStartsAt = '2026-09-20T01:00:00.000Z';
    const newStartsAt = '2026-09-27T01:00:00.000Z';
    await enrollByTrigger(db, {
      triggerType: 'event',
      friendId: 'friend-1',
      startsAtIso: oldStartsAt,
      sourceId: 'eb-1',
      sourceEventId: 'eb-1',
      lineAccountId: ACCOUNT_1,
    });
    const enrollment = enrollmentId(raw, 'friend-1');
    seedRun(raw, 'run-future', enrollment, 'friend-1', 'rule-event-1', 'queued', '2026-09-20T00:00:00.000Z');
    seedRun(raw, 'run-sent', enrollment, 'friend-1', 'rule-event-1', 'succeeded', '2026-09-19T00:00:00.000Z');

    const input = {
      triggerType: 'event' as const,
      sourceId: 'eb-1',
      sourceEventId: 'eb-1',
      friendId: 'friend-1',
      oldStartsAtIso: oldStartsAt,
      newStartsAtIso: newStartsAt,
      lineAccountId: ACCOUNT_1,
    };
    const result = await rescheduleByTrigger(db, input);
    expect(result).toEqual({ movedEnrollments: 1, cancelledRuns: 1 });

    expect(raw.prepare(`SELECT target_date, status FROM friend_reminders WHERE id = ?`).get(enrollment)).toEqual({
      target_date: newStartsAt,
      status: 'active',
    });
    // 旧基準日の未来予定は止まり、送信済みは残る。
    expect(raw.prepare(`SELECT status FROM reminder_delivery_runs WHERE id = 'run-future'`).get()).toEqual({
      status: 'cancelled',
    });
    expect(raw.prepare(`SELECT status FROM reminder_delivery_runs WHERE id = 'run-sent'`).get()).toEqual({
      status: 'succeeded',
    });

    // 同じ変更通知の再送は from が無いため無変更。
    expect(await rescheduleByTrigger(db, input)).toEqual({ movedEnrollments: 0, cancelledRuns: 0 });
    expect(raw.prepare(`SELECT COUNT(*) AS c FROM friend_reminders`).get()).toEqual({ c: 1 });
  });
});

const MEET_URL = 'https://meet.google.com/abc-defg-hij';

function meetInput(externalEventId: string, startsAt: string, endsAt: string, friendId = 'friend-1') {
  return {
    externalEventId,
    friendId,
    title: '個別相談',
    startsAt,
    endsAt,
    meetUrl: MEET_URL,
  };
}

describe('個別相談の取消・日程変更', () => {
  it('登録で V6 へ連動し、日程変更で未来予定だけ移す (二重登録なし)', async () => {
    const { db, raw } = createTestD1();
    seedAccount(raw, ACCOUNT_1);
    insertFriend(raw, 'friend-1', { line_account_id: ACCOUNT_1 });
    seedTriggerRule(raw, 'rule-booking-1', 'booking');

    const now = new Date('2026-09-01T00:00:00.000Z');
    await registerMeetConsultation(
      db,
      meetInput('google-event-a', '2026-09-20T01:00:00.000Z', '2026-09-20T01:30:00.000Z'),
      now,
    );
    expect(raw.prepare(`SELECT COUNT(*) AS c FROM friend_reminders`).get()).toEqual({ c: 1 });
    expect(
      raw.prepare(
        `SELECT source_kind, source_event_id, target_date, status FROM friend_reminders`,
      ).get(),
    ).toEqual({
      source_kind: 'meet',
      source_event_id: 'google-event-a',
      target_date: '2026-09-20T01:00:00.000Z',
      status: 'active',
    });

    // 同じ内容の再送は増やさない。
    await registerMeetConsultation(
      db,
      meetInput('google-event-a', '2026-09-20T01:00:00.000Z', '2026-09-20T01:30:00.000Z'),
      now,
    );
    expect(raw.prepare(`SELECT COUNT(*) AS c FROM friend_reminders`).get()).toEqual({ c: 1 });

    // 日程変更は行を増やさず新基準日へ移す。
    await registerMeetConsultation(
      db,
      meetInput('google-event-a', '2026-09-27T01:00:00.000Z', '2026-09-27T01:30:00.000Z'),
      now,
    );
    expect(raw.prepare(`SELECT COUNT(*) AS c FROM friend_reminders`).get()).toEqual({ c: 1 });
    expect(raw.prepare(`SELECT target_date, status FROM friend_reminders`).get()).toEqual({
      target_date: '2026-09-27T01:00:00.000Z',
      status: 'active',
    });
  });

  it('取消で未送信だけ止め、再送は無変更。作り直しで起こす', async () => {
    const { db, raw } = createTestD1();
    seedAccount(raw, ACCOUNT_1);
    insertFriend(raw, 'friend-1', { line_account_id: ACCOUNT_1 });
    seedTriggerRule(raw, 'rule-booking-1', 'booking');

    const now = new Date('2026-09-01T00:00:00.000Z');
    await registerMeetConsultation(
      db,
      meetInput('google-event-a', '2026-09-20T01:00:00.000Z', '2026-09-20T01:30:00.000Z'),
      now,
    );
    const enrollment = enrollmentId(raw, 'friend-1');
    seedRun(raw, 'run-future', enrollment, 'friend-1', 'rule-booking-1', 'queued', '2026-09-20T00:00:00.000Z');

    expect(await cancelMeetConsultation(db, 'google-event-a', now)).toBe(true);
    expect(raw.prepare(`SELECT status, cancel_reason FROM friend_reminders WHERE id = ?`).get(enrollment)).toEqual({
      status: 'cancelled',
      cancel_reason: 'meet_cancel:google-event-a:by:admin',
    });
    expect(raw.prepare(`SELECT status FROM reminder_delivery_runs WHERE id = 'run-future'`).get()).toEqual({
      status: 'cancelled',
    });

    // 同じ取消通知の再送は行を増やさず何も変えない。
    expect(await cancelMeetConsultation(db, 'google-event-a', now)).toBe(true);
    expect(raw.prepare(`SELECT COUNT(*) AS c FROM friend_reminders`).get()).toEqual({ c: 1 });

    // 取消後の作り直しは同じ行を起こす (二重登録なし)。
    await registerMeetConsultation(
      db,
      meetInput('google-event-a', '2026-09-28T01:00:00.000Z', '2026-09-28T01:30:00.000Z'),
      now,
    );
    expect(raw.prepare(`SELECT COUNT(*) AS c FROM friend_reminders`).get()).toEqual({ c: 1 });
    expect(raw.prepare(`SELECT target_date, status FROM friend_reminders WHERE id = ?`).get(enrollment)).toEqual({
      target_date: '2026-09-28T01:00:00.000Z',
      status: 'active',
    });
  });

  it('存在しない相談の取消は false で何もしない', async () => {
    const { db } = createTestD1();
    expect(await cancelMeetConsultation(db, 'no-such-event', new Date())).toBe(false);
  });
});

describe('取消と配信の競合', () => {
  it('claimed の実行行も止め、送信直前の再確認で送らない', async () => {
    const { db, raw } = createTestD1();
    seedAccount(raw, ACCOUNT_1);
    insertFriend(raw, 'friend-1', { line_account_id: ACCOUNT_1 });
    seedTriggerRule(raw, 'rule-booking-1', 'booking');

    await enrollByTrigger(db, {
      triggerType: 'booking',
      friendId: 'friend-1',
      startsAtIso: '2026-09-20T01:00:00.000Z',
      sourceId: 'bk-1',
      sourceEventId: 'bk-1',
      lineAccountId: ACCOUNT_1,
    });
    const enrollment = enrollmentId(raw, 'friend-1');
    // 送信中 (claimed) と再試行待ちの行が残っていても取消で止める。
    seedRun(raw, 'run-claimed', enrollment, 'friend-1', 'rule-booking-1', 'claimed', '2026-09-20T00:00:00.000Z');
    seedRun(raw, 'run-wait', enrollment, 'friend-1', 'rule-booking-1', 'retry_wait', '2026-09-20T00:01:00.000Z');

    const result = await cancelByTrigger(db, {
      triggerType: 'booking',
      sourceId: 'bk-1',
      sourceEventId: 'bk-1',
      friendId: 'friend-1',
      startsAtIso: '2026-09-20T01:00:00.000Z',
      lineAccountId: ACCOUNT_1,
      cancelReason: 'booking_cancel:bk-1:by:staff-9',
    });
    expect(result).toEqual({ cancelledEnrollments: 1, cancelledRuns: 2 });
    expect(raw.prepare(`SELECT status FROM reminder_delivery_runs WHERE id = 'run-claimed'`).get()).toEqual({
      status: 'cancelled',
    });
    expect(raw.prepare(`SELECT status FROM reminder_delivery_runs WHERE id = 'run-wait'`).get()).toEqual({
      status: 'cancelled',
    });
    // 配信側の送信直前の再確認も取消を見る (配信は送らない)。
    expect(await getFriendReminderStatus(db, enrollment)).toBe('cancelled');
  });
});

describe('部分失敗後の再試行', () => {
  it('業務ずみでも V6 取消を再実行できる (booking)', async () => {
    const { db, raw } = createTestD1();
    seedAccount(raw, ACCOUNT_1);
    insertFriend(raw, 'friend-1', { line_account_id: ACCOUNT_1 });
    seedTriggerRule(raw, 'rule-booking-1', 'booking');

    // 1回目で業務だけ終わり V6 が残った想定。2回目の取消は V6 を止める。
    await enrollByTrigger(db, {
      triggerType: 'booking',
      friendId: 'friend-1',
      startsAtIso: '2026-09-20T01:00:00.000Z',
      sourceId: 'bk-1',
      sourceEventId: 'bk-1',
      lineAccountId: ACCOUNT_1,
    });
    const input = {
      triggerType: 'booking' as const,
      sourceId: 'bk-1',
      sourceEventId: 'bk-1',
      friendId: 'friend-1',
      startsAtIso: '2026-09-20T01:00:00.000Z',
      lineAccountId: ACCOUNT_1,
      cancelReason: 'booking_cancel:bk-1:by:staff-9-retry',
    };
    expect(await cancelByTrigger(db, input)).toEqual({ cancelledEnrollments: 1, cancelledRuns: 0 });
    // 3回目は無変更 (冪等)。
    expect(await cancelByTrigger(db, input)).toEqual({ cancelledEnrollments: 0, cancelledRuns: 0 });
    expect(raw.prepare(`SELECT COUNT(*) AS c FROM friend_reminders`).get()).toEqual({ c: 1 });
  });

  it('業務ずみでも V6 取消を再実行できる (event)', async () => {
    const { db, raw } = createTestD1();
    seedAccount(raw, ACCOUNT_1);
    insertFriend(raw, 'friend-1', { line_account_id: ACCOUNT_1 });
    seedTriggerRule(raw, 'rule-event-1', 'event');

    await enrollByTrigger(db, {
      triggerType: 'event',
      friendId: 'friend-1',
      startsAtIso: '2026-09-20T01:00:00.000Z',
      sourceId: 'eb-1',
      sourceEventId: 'eb-1',
      lineAccountId: ACCOUNT_1,
    });
    const input = {
      triggerType: 'event' as const,
      sourceId: 'eb-1',
      sourceEventId: 'eb-1',
      friendId: 'friend-1',
      startsAtIso: '2026-09-20T01:00:00.000Z',
      lineAccountId: ACCOUNT_1,
      cancelReason: 'event_reject:eb-1:by:admin-retry',
    };
    expect(await cancelByTrigger(db, input)).toEqual({ cancelledEnrollments: 1, cancelledRuns: 0 });
    expect(await cancelByTrigger(db, input)).toEqual({ cancelledEnrollments: 0, cancelledRuns: 0 });
  });
});

describe('Meet の友だち変更', () => {
  it('旧 friend の active 登録/run を残さない', async () => {
    const { db, raw } = createTestD1();
    seedAccount(raw, ACCOUNT_1);
    insertFriend(raw, 'friend-1', { line_account_id: ACCOUNT_1 });
    insertFriend(raw, 'friend-2', { line_account_id: ACCOUNT_1 });
    seedTriggerRule(raw, 'rule-booking-1', 'booking');

    const now = new Date('2026-09-01T00:00:00.000Z');
    await registerMeetConsultation(
      db,
      meetInput('google-event-a', '2026-09-20T01:00:00.000Z', '2026-09-20T01:30:00.000Z', 'friend-1'),
      now,
    );
    const oldEnrollment = enrollmentId(raw, 'friend-1');
    seedRun(raw, 'run-old', oldEnrollment, 'friend-1', 'rule-booking-1', 'queued', '2026-09-20T00:00:00.000Z');

    // 同じ相談を別 friend へ変える。
    await registerMeetConsultation(
      db,
      meetInput('google-event-a', '2026-09-20T01:00:00.000Z', '2026-09-20T01:30:00.000Z', 'friend-2'),
      now,
    );

    // 旧 friend 側は止まり、新 friend 側だけ active。
    expect(raw.prepare(`SELECT status FROM friend_reminders WHERE id = ?`).get(oldEnrollment)).toEqual({
      status: 'cancelled',
    });
    expect(raw.prepare(`SELECT status FROM reminder_delivery_runs WHERE id = 'run-old'`).get()).toEqual({
      status: 'cancelled',
    });
    expect(
      raw.prepare(
        `SELECT friend_id, status FROM friend_reminders WHERE status = 'active'`,
      ).all(),
    ).toEqual([{ friend_id: 'friend-2', status: 'active' }]);
  });

  it('取りこぼしの旧 friend 行は再送で直る', async () => {
    const { db, raw } = createTestD1();
    seedAccount(raw, ACCOUNT_1);
    insertFriend(raw, 'friend-1', { line_account_id: ACCOUNT_1 });
    insertFriend(raw, 'friend-2', { line_account_id: ACCOUNT_1 });
    seedTriggerRule(raw, 'rule-booking-1', 'booking');

    const now = new Date('2026-09-01T00:00:00.000Z');
    await registerMeetConsultation(
      db,
      meetInput('google-event-a', '2026-09-20T01:00:00.000Z', '2026-09-20T01:30:00.000Z', 'friend-1'),
      now,
    );
    // 途中失敗を再現: 業務だけ新 friend へ進み、V6 が旧 friend のまま残る。
    raw.prepare(`UPDATE meet_consultations SET friend_id = 'friend-2' WHERE external_event_id = ?`)
      .run('google-event-a');

    await registerMeetConsultation(
      db,
      meetInput('google-event-a', '2026-09-20T01:00:00.000Z', '2026-09-20T01:30:00.000Z', 'friend-2'),
      now,
    );

    expect(
      raw.prepare(`SELECT friend_id, status FROM friend_reminders WHERE friend_id = 'friend-1'`).get(),
    ).toEqual({ friend_id: 'friend-1', status: 'cancelled' });
    expect(
      raw.prepare(`SELECT friend_id, status FROM friend_reminders WHERE friend_id = 'friend-2'`).get(),
    ).toEqual({ friend_id: 'friend-2', status: 'active' });
  });
});

describe('日程変更の途中失敗', () => {
  it('再送で V6 が新起点へ直る (Meet)', async () => {
    const { db, raw } = createTestD1();
    seedAccount(raw, ACCOUNT_1);
    insertFriend(raw, 'friend-1', { line_account_id: ACCOUNT_1 });
    seedTriggerRule(raw, 'rule-booking-1', 'booking');

    const now = new Date('2026-09-01T00:00:00.000Z');
    await registerMeetConsultation(
      db,
      meetInput('google-event-a', '2026-09-20T01:00:00.000Z', '2026-09-20T01:30:00.000Z'),
      now,
    );
    const enrollment = enrollmentId(raw, 'friend-1');
    seedRun(raw, 'run-old', enrollment, 'friend-1', 'rule-booking-1', 'queued', '2026-09-20T00:00:00.000Z');
    // 途中失敗を再現: 業務だけ新日へ進み、V6 が旧日のまま残る。
    raw.prepare(`UPDATE meet_consultations SET starts_at = ?, ends_at = ? WHERE external_event_id = ?`)
      .run('2026-09-27T01:00:00.000Z', '2026-09-27T01:30:00.000Z', 'google-event-a');

    await registerMeetConsultation(
      db,
      meetInput('google-event-a', '2026-09-27T01:00:00.000Z', '2026-09-27T01:30:00.000Z'),
      now,
    );

    // 行を増やさず新起点へ直り、旧 run は止まる。
    expect(raw.prepare(`SELECT COUNT(*) AS c FROM friend_reminders`).get()).toEqual({ c: 1 });
    expect(raw.prepare(`SELECT target_date, status FROM friend_reminders WHERE id = ?`).get(enrollment)).toEqual({
      target_date: '2026-09-27T01:00:00.000Z',
      status: 'active',
    });
    expect(raw.prepare(`SELECT status FROM reminder_delivery_runs WHERE id = 'run-old'`).get()).toEqual({
      status: 'cancelled',
    });
  });

  it('reconcile は整合済みなら何もしない (冪等)', async () => {
    const { db, raw } = createTestD1();
    seedAccount(raw, ACCOUNT_1);
    insertFriend(raw, 'friend-1', { line_account_id: ACCOUNT_1 });
    seedTriggerRule(raw, 'rule-booking-1', 'booking');

    const now = new Date('2026-09-01T00:00:00.000Z');
    const registered = await registerMeetConsultation(
      db,
      meetInput('google-event-b', '2026-09-20T01:00:00.000Z', '2026-09-20T01:30:00.000Z'),
      now,
    );
    const healed = await reconcileV6ToStartsAt(db, {
      triggerType: 'booking',
      sourceKind: 'meet',
      sourceId: registered.id,
      sourceEventId: 'google-event-b',
      friendId: 'friend-1',
      startsAtIso: '2026-09-20T01:00:00.000Z',
    });
    expect(healed).toEqual({ healedEnrollments: 0, cancelledStale: 0, cancelledRuns: 0 });
  });
});

describe('同時刻の曖昧さ', () => {
  it('取消は同時刻の手動登録・別ルールの別予約へ触れない。再送も同様', async () => {
    const { db, raw } = createTestD1();
    seedAccount(raw, ACCOUNT_1);
    insertFriend(raw, 'friend-1', { line_account_id: ACCOUNT_1 });
    seedTriggerRule(raw, 'rule-booking-1', 'booking');
    seedTriggerRule(raw, 'rule-booking-2', 'booking');
    seedRule(raw, 'rule-manual-1', 'manual');

    const startsAt = '2026-09-20T01:00:00.000Z';
    // 移行前の行 (source 未記録): booking ルールのものだけ止める。
    raw.prepare(
      `INSERT INTO friend_reminders (id, friend_id, reminder_id, target_date, status)
       VALUES ('legacy-booking', 'friend-1', 'rule-booking-1', ?, 'active')`,
    ).run(startsAt);
    // 同時刻の手動登録は残す。
    raw.prepare(
      `INSERT INTO friend_reminders
         (id, friend_id, reminder_id, target_date, status, source_kind)
       VALUES ('manual-1', 'friend-1', 'rule-manual-1', ?, 'active', 'manual')`,
    ).run(startsAt);
    // 同時刻の別ルールの別予約 (source あり) は残す。
    raw.prepare(
      `INSERT INTO friend_reminders
         (id, friend_id, reminder_id, target_date, status,
          source_kind, source_id, source_event_id)
       VALUES ('other-booking', 'friend-1', 'rule-booking-2', ?, 'active',
               'booking', 'bk-9', 'bk-9')`,
    ).run(startsAt);

    const input = {
      triggerType: 'booking' as const,
      sourceId: 'bk-1',
      sourceEventId: 'bk-1',
      friendId: 'friend-1',
      startsAtIso: startsAt,
      lineAccountId: ACCOUNT_1,
      cancelReason: 'booking_cancel:bk-1:by:staff-9',
    };
    expect(await cancelByTrigger(db, input)).toEqual({ cancelledEnrollments: 1, cancelledRuns: 0 });
    expect(raw.prepare(`SELECT status FROM friend_reminders WHERE id = 'legacy-booking'`).get()).toEqual({
      status: 'cancelled',
    });
    expect(raw.prepare(`SELECT status FROM friend_reminders WHERE id = 'manual-1'`).get()).toEqual({
      status: 'active',
    });
    expect(raw.prepare(`SELECT status FROM friend_reminders WHERE id = 'other-booking'`).get()).toEqual({
      status: 'active',
    });

    // 同じ取消通知の再送でも別予約・手動登録へ触れない。
    expect(await cancelByTrigger(db, input)).toEqual({ cancelledEnrollments: 0, cancelledRuns: 0 });
    expect(raw.prepare(`SELECT status FROM friend_reminders WHERE id = 'manual-1'`).get()).toEqual({
      status: 'active',
    });
    expect(raw.prepare(`SELECT status FROM friend_reminders WHERE id = 'other-booking'`).get()).toEqual({
      status: 'active',
    });
  });
});

describe('送信直前の原子的claim', () => {
  it('登録が非activeなら握らず、残った実行行だけ止める', async () => {
    const { db, raw } = createTestD1();
    seedAccount(raw, ACCOUNT_1);
    insertFriend(raw, 'friend-1', { line_account_id: ACCOUNT_1 });
    seedTriggerRule(raw, 'rule-booking-1', 'booking');

    await enrollByTrigger(db, {
      triggerType: 'booking',
      friendId: 'friend-1',
      startsAtIso: '2026-09-20T01:00:00.000Z',
      sourceId: 'bk-1',
      sourceEventId: 'bk-1',
      lineAccountId: ACCOUNT_1,
    });
    const enrollment = enrollmentId(raw, 'friend-1');
    const claimInput = {
      lineAccountId: ACCOUNT_1,
      reminderId: 'rule-booking-1',
      friendReminderId: enrollment,
      friendId: 'friend-1',
      reminderStepId: 'step-rule-booking-1',
      leaseExpiresAt: '2026-09-20T01:05:00.000Z',
    };
    // 先に握った行がある状態で、利用者が登録を取消す。
    const runA = await claimReminderDeliveryRun(db, {
      ...claimInput,
      scheduledAt: '2026-09-20T00:00:00.000Z',
      now: '2026-09-20T01:00:00.000Z',
    });
    expect(runA?.status).toBe('claimed');
    raw.prepare(`UPDATE friend_reminders SET status = 'cancelled' WHERE id = ?`).run(enrollment);

    // 取消後の claim は握らず、作りかけの行だけ止める (先の行には触れない)。
    const runB = await claimReminderDeliveryRun(db, {
      ...claimInput,
      scheduledAt: '2026-09-20T00:01:00.000Z',
      now: '2026-09-20T01:00:00.000Z',
    });
    expect(runB).toBeNull();
    expect(
      raw.prepare(`SELECT status FROM reminder_delivery_runs WHERE id = ?`).get(runA?.id),
    ).toEqual({ status: 'claimed' });

    // 送信直前の検証も通らず、残った行を止める。
    expect(
      await verifyClaimedRunBeforeSend(db, {
        id: runA!.id,
        friendReminderId: enrollment,
        now: '2026-09-20T01:00:00.000Z',
        leaseExpiresAt: '2026-09-20T01:05:00.000Z',
      }),
    ).toBe(false);
    expect(
      raw.prepare(`SELECT status FROM reminder_delivery_runs WHERE id = ?`).get(runA?.id),
    ).toEqual({ status: 'cancelled' });
  });
});

describe('移行前の行の特定不能は止めない', () => {
  it('同時刻の別2件はどれが対象か分からないため0件 (fail closed)', async () => {
    const { db, raw } = createTestD1();
    seedAccount(raw, ACCOUNT_1);
    insertFriend(raw, 'friend-1', { line_account_id: ACCOUNT_1 });
    seedTriggerRule(raw, 'rule-booking-1', 'booking');

    // 移行前の別予約2件 (どちらも source 未記録・同時刻)。
    const startsAt = '2026-09-20T01:00:00.000Z';
    raw.prepare(
      `INSERT INTO friend_reminders (id, friend_id, reminder_id, target_date, status, created_at)
       VALUES ('legacy-old', 'friend-1', 'rule-booking-1', ?, 'active', '2026-08-01T00:00:00.000Z')`,
    ).run(startsAt);
    raw.prepare(
      `INSERT INTO friend_reminders (id, friend_id, reminder_id, target_date, status, created_at)
       VALUES ('legacy-new', 'friend-1', 'rule-booking-1', ?, 'active', '2026-08-02T00:00:00.000Z')`,
    ).run(startsAt);

    // 片方の取消でも、対象行を特定できないため両方残す (誤取消しより残存)。
    const result = await cancelByTrigger(db, {
      triggerType: 'booking',
      friendId: 'friend-1',
      startsAtIso: startsAt,
      lineAccountId: ACCOUNT_1,
      cancelReason: 'booking_cancel:bk-1:by:staff-9',
    });
    expect(result).toEqual({ cancelledEnrollments: 0, cancelledRuns: 0 });
    expect(raw.prepare(`SELECT status FROM friend_reminders WHERE id = 'legacy-old'`).get()).toEqual({
      status: 'active',
    });
    expect(raw.prepare(`SELECT status FROM friend_reminders WHERE id = 'legacy-new'`).get()).toEqual({
      status: 'active',
    });

    // 日程変更も同様に動かさない。
    const moved = await rescheduleByTrigger(db, {
      triggerType: 'booking',
      friendId: 'friend-1',
      oldStartsAtIso: startsAt,
      newStartsAtIso: '2026-09-27T01:00:00.000Z',
      lineAccountId: ACCOUNT_1,
    });
    expect(moved).toEqual({ movedEnrollments: 0, cancelledRuns: 0 });
    expect(raw.prepare(`SELECT COUNT(*) AS c FROM friend_reminders WHERE status = 'active'`).get()).toEqual({
      c: 2,
    });
  });
});

describe('同時刻の別予約の共存', () => {
  it('別sourceの2件目は抑止せず、同じ発生元の再通知だけ1行に保つ', async () => {
    const { db, raw } = createTestD1();
    seedAccount(raw, ACCOUNT_1);
    insertFriend(raw, 'friend-1', { line_account_id: ACCOUNT_1 });
    seedTriggerRule(raw, 'rule-booking-1', 'booking');

    const startsAt = '2026-09-20T01:00:00.000Z';
    await enrollByTrigger(db, {
      triggerType: 'booking',
      friendId: 'friend-1',
      startsAtIso: startsAt,
      sourceId: 'bk-1',
      sourceEventId: 'bk-1',
      lineAccountId: ACCOUNT_1,
    });
    // 同時刻の別予約は別行で残る。
    await enrollByTrigger(db, {
      triggerType: 'booking',
      friendId: 'friend-1',
      startsAtIso: startsAt,
      sourceId: 'bk-2',
      sourceEventId: 'bk-2',
      lineAccountId: ACCOUNT_1,
    });
    expect(raw.prepare(`SELECT COUNT(*) AS c FROM friend_reminders WHERE status = 'active'`).get()).toEqual({
      c: 2,
    });

    // 同じ予約の再通知は増やさない (冪等)。
    await enrollByTrigger(db, {
      triggerType: 'booking',
      friendId: 'friend-1',
      startsAtIso: startsAt,
      sourceId: 'bk-1',
      sourceEventId: 'bk-1',
      lineAccountId: ACCOUNT_1,
    });
    expect(raw.prepare(`SELECT COUNT(*) AS c FROM friend_reminders WHERE status = 'active'`).get()).toEqual({
      c: 2,
    });
    expect(
      raw.prepare(`SELECT COUNT(*) AS c FROM friend_reminders WHERE source_id = 'bk-1'`).get(),
    ).toEqual({ c: 1 });
  });
});

describe('Meet の友だち変更の失敗時', () => {
  it('新friend登録の失敗は投げ、旧friend通知を残す。回復後は新だけ active', async () => {
    const { db, raw } = createTestD1();
    seedAccount(raw, ACCOUNT_1);
    insertFriend(raw, 'friend-1', { line_account_id: ACCOUNT_1 });
    insertFriend(raw, 'friend-2', { line_account_id: ACCOUNT_1 });
    seedTriggerRule(raw, 'rule-booking-1', 'booking');

    const now = new Date('2026-09-01T00:00:00.000Z');
    await registerMeetConsultation(
      db,
      meetInput('google-event-a', '2026-09-20T01:00:00.000Z', '2026-09-20T01:30:00.000Z', 'friend-1'),
      now,
    );
    const oldEnrollment = enrollmentId(raw, 'friend-1');

    // V6 登録だけ落とす失敗注入 (相談の保存は通る)。
    raw.exec(
      `CREATE TRIGGER v6_enroll_fail BEFORE INSERT ON friend_reminders
       BEGIN SELECT RAISE(ABORT, 'injected-enroll-failure'); END;`,
    );
    await expect(
      registerMeetConsultation(
        db,
        meetInput('google-event-a', '2026-09-20T01:00:00.000Z', '2026-09-20T01:30:00.000Z', 'friend-2'),
        now,
      ),
    ).rejects.toThrow();
    raw.exec(`DROP TRIGGER v6_enroll_fail`);

    // 旧 friend の通知は残り、新 friend には作られていない (補償)。
    expect(raw.prepare(`SELECT status FROM friend_reminders WHERE id = ?`).get(oldEnrollment)).toEqual({
      status: 'active',
    });
    expect(
      raw.prepare(`SELECT COUNT(*) AS c FROM friend_reminders WHERE friend_id = 'friend-2'`).get(),
    ).toEqual({ c: 0 });

    // 同じ変更の再送で回復する (新規成功後に旧取消)。
    await registerMeetConsultation(
      db,
      meetInput('google-event-a', '2026-09-20T01:00:00.000Z', '2026-09-20T01:30:00.000Z', 'friend-2'),
      now,
    );
    expect(raw.prepare(`SELECT status FROM friend_reminders WHERE id = ?`).get(oldEnrollment)).toEqual({
      status: 'cancelled',
    });
    expect(
      raw.prepare(`SELECT friend_id, status FROM friend_reminders WHERE status = 'active'`).all(),
    ).toEqual([{ friend_id: 'friend-2', status: 'active' }]);
  });

  it('初回も再送も新登録に失敗すると再送でも投げ、旧通知を残す', async () => {
    const { db, raw } = createTestD1();
    seedAccount(raw, ACCOUNT_1);
    insertFriend(raw, 'friend-1', { line_account_id: ACCOUNT_1 });
    insertFriend(raw, 'friend-2', { line_account_id: ACCOUNT_1 });
    seedTriggerRule(raw, 'rule-booking-1', 'booking');

    const now = new Date('2026-09-01T00:00:00.000Z');
    await registerMeetConsultation(
      db,
      meetInput('google-event-a', '2026-09-20T01:00:00.000Z', '2026-09-20T01:30:00.000Z', 'friend-1'),
      now,
    );
    const oldEnrollment = enrollmentId(raw, 'friend-1');

    // V6 登録の失敗が続く想定 (初回・再送とも INSERT が落ちる)。
    raw.exec(
      `CREATE TRIGGER v6_enroll_fail BEFORE INSERT ON friend_reminders
       BEGIN SELECT RAISE(ABORT, 'injected-enroll-failure'); END;`,
    );
    const changeToFriend2 = () => registerMeetConsultation(
      db,
      meetInput('google-event-a', '2026-09-20T01:00:00.000Z', '2026-09-20T01:30:00.000Z', 'friend-2'),
      now,
    );
    await expect(changeToFriend2()).rejects.toThrow();
    // 再送: 相談行だけ新 friend へ進んでいるが、新規0件でも成功にしない。
    await expect(changeToFriend2()).rejects.toThrow();
    raw.exec(`DROP TRIGGER v6_enroll_fail`);

    expect(raw.prepare(`SELECT status FROM friend_reminders WHERE id = ?`).get(oldEnrollment)).toEqual({
      status: 'active',
    });
    expect(
      raw.prepare(`SELECT COUNT(*) AS c FROM friend_reminders WHERE friend_id = 'friend-2'`).get(),
    ).toEqual({ c: 0 });

    // 障害復旧後の再送で回復する。
    await changeToFriend2();
    expect(raw.prepare(`SELECT status FROM friend_reminders WHERE id = ?`).get(oldEnrollment)).toEqual({
      status: 'cancelled',
    });
    expect(
      raw.prepare(`SELECT friend_id, status FROM friend_reminders WHERE status = 'active'`).all(),
    ).toEqual([{ friend_id: 'friend-2', status: 'active' }]);
  });
});

describe('自動登録のテナント境界', () => {
  it('2店舗のルールは自店舗の友だちだけ登録し、混ぜない', async () => {
    const { db, raw } = createTestD1();
    seedAccount(raw, ACCOUNT_1);
    seedAccount(raw, ACCOUNT_2);
    insertFriend(raw, 'friend-a', { line_account_id: ACCOUNT_1 });
    insertFriend(raw, 'friend-b', { line_account_id: ACCOUNT_2 });
    seedTriggerRule(raw, 'rule-a', 'booking', ACCOUNT_1);
    seedTriggerRule(raw, 'rule-b', 'booking', ACCOUNT_2);

    const startsAt = '2026-09-20T01:00:00.000Z';
    expect(await enrollByTrigger(db, {
      triggerType: 'booking',
      friendId: 'friend-a',
      startsAtIso: startsAt,
      sourceId: 'bk-a',
      sourceEventId: 'bk-a',
      lineAccountId: ACCOUNT_1,
    })).toBe(1);
    expect(await enrollByTrigger(db, {
      triggerType: 'booking',
      friendId: 'friend-b',
      startsAtIso: startsAt,
      sourceId: 'bk-b',
      sourceEventId: 'bk-b',
      lineAccountId: ACCOUNT_2,
    })).toBe(1);

    // 自店舗のルールにだけ載り、相手店舗の行は無い。
    expect(
      raw.prepare(`SELECT friend_id, reminder_id FROM friend_reminders ORDER BY friend_id`).all(),
    ).toEqual([
      { friend_id: 'friend-a', reminder_id: 'rule-a' },
      { friend_id: 'friend-b', reminder_id: 'rule-b' },
    ]);

    // 友だちと店舗の不一致は書かずに落とす。
    await expect(enrollByTrigger(db, {
      triggerType: 'booking',
      friendId: 'friend-a',
      startsAtIso: startsAt,
      sourceId: 'bk-x',
      sourceEventId: 'bk-x',
      lineAccountId: ACCOUNT_2,
    })).rejects.toThrow('REMINDER_ACCOUNT_MISMATCH');
    // 登録口そのものも友だちとルールの不一致を弾く。
    await expect(enrollFriendInReminder(db, {
      friendId: 'friend-b',
      reminderId: 'rule-a',
      targetDate: startsAt,
    })).rejects.toThrow('REMINDER_ACCOUNT_MISMATCH');
    expect(raw.prepare(`SELECT COUNT(*) AS c FROM friend_reminders`).get()).toEqual({ c: 2 });
  });
});

describe('送信権と取消の直列化', () => {
  it('verify確定後の取消は送信確定を0件にし、二度と送らない', async () => {
    const { db, raw } = createTestD1();
    seedAccount(raw, ACCOUNT_1);
    insertFriend(raw, 'friend-1', { line_account_id: ACCOUNT_1 });
    seedTriggerRule(raw, 'rule-booking-1', 'booking');

    await enrollByTrigger(db, {
      triggerType: 'booking',
      friendId: 'friend-1',
      startsAtIso: '2026-09-20T01:00:00.000Z',
      sourceId: 'bk-1',
      sourceEventId: 'bk-1',
      lineAccountId: ACCOUNT_1,
    });
    const enrollment = enrollmentId(raw, 'friend-1');
    const run = await claimReminderDeliveryRun(db, {
      lineAccountId: ACCOUNT_1,
      reminderId: 'rule-booking-1',
      friendReminderId: enrollment,
      friendId: 'friend-1',
      reminderStepId: 'step-rule-booking-1',
      scheduledAt: '2026-09-20T00:00:00.000Z',
      now: '2026-09-20T01:00:00.000Z',
      leaseExpiresAt: '2026-09-20T01:05:00.000Z',
    });
    // 送信権の取得と取消の確定は DB 上で直列化される。取得が先なら送れるが、
    // 確定は取消後に通らない (0 件で検出)。送り直しもしない。
    expect(await verifyClaimedRunBeforeSend(db, {
      id: run!.id,
      friendReminderId: enrollment,
      now: '2026-09-20T01:00:00.000Z',
      leaseExpiresAt: '2026-09-20T01:05:00.000Z',
    })).toBe(true);
    await cancelByTrigger(db, {
      triggerType: 'booking',
      sourceId: 'bk-1',
      sourceEventId: 'bk-1',
      friendId: 'friend-1',
      startsAtIso: '2026-09-20T01:00:00.000Z',
      lineAccountId: ACCOUNT_1,
      cancelReason: 'booking_cancel:bk-1:by:staff-9',
    });
    const completed = await completeReminderDeliveryRunStatement(db, {
      id: run!.id,
      friendReminderId: enrollment,
      lineRequestId: null,
      messageLogId: 'log-1',
      now: '2026-09-20T01:00:00.000Z',
    }).run();
    expect(Number(completed.meta?.changes ?? 0)).toBe(0);
    expect(raw.prepare(`SELECT status FROM reminder_delivery_runs WHERE id = ?`).get(run!.id)).toEqual({
      status: 'cancelled',
    });
    // 取消ずみの実行行は握り直さない (二重送信なし)。
    expect(await claimReminderDeliveryRun(db, {
      lineAccountId: ACCOUNT_1,
      reminderId: 'rule-booking-1',
      friendReminderId: enrollment,
      friendId: 'friend-1',
      reminderStepId: 'step-rule-booking-1',
      scheduledAt: '2026-09-20T00:00:00.000Z',
      now: '2026-09-20T01:00:00.000Z',
      leaseExpiresAt: '2026-09-20T01:05:00.000Z',
    })).toBeNull();
  });

  it('登録だけの取消の後に確定は通さない (手動取消のすり抜け防止)', async () => {
    const { db, raw } = createTestD1();
    seedAccount(raw, ACCOUNT_1);
    insertFriend(raw, 'friend-1', { line_account_id: ACCOUNT_1 });
    seedTriggerRule(raw, 'rule-booking-1', 'booking');

    await enrollByTrigger(db, {
      triggerType: 'booking',
      friendId: 'friend-1',
      startsAtIso: '2026-09-20T01:00:00.000Z',
      sourceId: 'bk-1',
      sourceEventId: 'bk-1',
      lineAccountId: ACCOUNT_1,
    });
    const enrollment = enrollmentId(raw, 'friend-1');
    const run = await claimReminderDeliveryRun(db, {
      lineAccountId: ACCOUNT_1,
      reminderId: 'rule-booking-1',
      friendReminderId: enrollment,
      friendId: 'friend-1',
      reminderStepId: 'step-rule-booking-1',
      scheduledAt: '2026-09-20T00:00:00.000Z',
      now: '2026-09-20T01:00:00.000Z',
      leaseExpiresAt: '2026-09-20T01:05:00.000Z',
    });
    // 利用者の手動取消は登録だけ止め、実行行は claimed のまま残る。
    await cancelFriendReminder(db, enrollment);
    const completed = await completeReminderDeliveryRunStatement(db, {
      id: run!.id,
      friendReminderId: enrollment,
      lineRequestId: null,
      messageLogId: 'log-1',
      now: '2026-09-20T01:00:00.000Z',
    }).run();
    expect(Number(completed.meta?.changes ?? 0)).toBe(0);
    expect(raw.prepare(`SELECT status FROM reminder_delivery_runs WHERE id = ?`).get(run!.id)).toEqual({
      status: 'claimed',
    });
  });
});
