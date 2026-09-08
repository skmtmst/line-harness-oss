/**
 * N-065 契約テスト: 予約・イベント・Meet の取消/日程変更を V6 へ同期する。
 *
 * 本物の SQLite (createTestD1) に当て、SQL そのものが約束を守るか確かめる。
 * 外部 LINE・顧客・Calendar へは送らない。対象は enroll / cancel / reschedule
 * の DB 連携だけで、通知送信は触らない。
 */
import { describe, expect, it } from 'vitest';

import { createTestD1, insertFriend } from '../test-utils/d1-sqlite.js';
import { cancelByTrigger, enrollByTrigger, rescheduleByTrigger } from './reminder-trigger.js';
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
): void {
  raw.prepare(
    `INSERT INTO reminders
       (id, name, line_account_id, is_active, trigger_type, delivery_mode, lifecycle_status)
     VALUES (?, ?, ?, 1, ?, 'countdown', 'published')`,
  ).run(id, `rule-${id}`, ACCOUNT_1, triggerType);
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

function seedRun(
  raw: import('better-sqlite3').Database,
  id: string,
  enrollmentIdValue: string,
  friendId: string,
  reminderId: string,
  status: 'queued' | 'succeeded',
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
    seedTriggerRule(raw, 'rule-booking-1', 'booking');

    await enrollByTrigger(db, {
      triggerType: 'booking',
      friendId: 'friend-1',
      startsAtIso: '2026-09-20T01:00:00.000Z',
      sourceId: 'bk-1',
      sourceEventId: 'bk-1',
    });
    await enrollByTrigger(db, {
      triggerType: 'booking',
      friendId: 'friend-2',
      startsAtIso: '2026-09-20T01:00:00.000Z',
      sourceId: 'bk-2',
      sourceEventId: 'bk-2',
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
    });
    await enrollByTrigger(db, {
      triggerType: 'booking',
      friendId: 'friend-1',
      startsAtIso: '2026-09-21T01:00:00.000Z',
      sourceId: 'bk-2',
      sourceEventId: 'bk-2',
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
