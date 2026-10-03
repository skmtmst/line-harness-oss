import { beforeEach, describe, expect, it } from 'vitest';
import { createTestD1, insertFriend, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { buildReminderStepMessage } from './reminder-delivery.js';
import { validateReminderDraft } from './reminder-draft.js';
import type { ReminderDraftSettings, ReminderStepRow, ReminderVersionRow } from '@line-crm/db';

/*
 * F10: リマインダの差し込みに予約日時・Google Meet URLを足す。
 * 送る側で置き換え、公開前に「差し込みの値が空の人」を検査する。
 * 既存のF6・Meet送信版・lease・日時変更/取消ガードには触らない。
 */
const MEET_URL = 'https://meet.google.com/xxx-yyyy-zzz';
const STARTS_AT = '2026-10-10T10:00:00+09:00';

function seedBase(raw: SqliteD1['raw']): void {
  raw.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-1', '統括1')`).run();
  raw.prepare(
    `INSERT INTO line_accounts
       (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
     VALUES ('account-1', 'channel-1', '店舗1', '', '', 1, 'tenant-1')`,
  ).run();
  insertFriend(raw, 'friend-10a', { line_account_id: 'account-1', display_name: '山田 太郎' });
  insertFriend(raw, 'friend-10b', { line_account_id: 'account-1', display_name: '鈴木 次郎' });
  raw.prepare(
    `INSERT INTO meet_consultations
      (id, external_event_id, friend_id, title, starts_at, ends_at, meet_url, status)
     VALUES ('meet-1', 'event-1', 'friend-10a', '個別相談',
             '2026-10-10T01:00:00.000Z', '2026-10-10T01:30:00.000Z', ?, 'confirmed')`,
  ).run(MEET_URL);
}

function settingsWith(content: string): ReminderDraftSettings {
  return {
    name: '予約前のお知らせ',
    lineAccountId: 'account-1',
    triggerType: 'booking',
    deliveryMode: 'time',
    stopConditions: {
      bookingCancelled: true,
      supportMarkCompleted: false,
      daysAfterTarget: null,
      friendBlocked: false,
    },
    steps: [{
      stableStepId: 'step-1',
      offsetDays: 1,
      sendAtTime: '10:00',
      offsetMinutes: 0,
      messageType: 'text',
      messageContent: content,
      templateId: null,
      targetCondition: {},
      action: {},
    }],
  } as unknown as ReminderDraftSettings;
}

const version = {
  id: 'version-10',
  reminder_id: 'reminder-10',
  version_number: 1,
  status: 'draft',
  settings_snapshot: '{}',
  last_test_status: 'succeeded',
  last_tested_at: '2026-10-01T10:00:00.000Z',
  last_tested_by_staff_id: 'staff-1',
  published_at: null,
  published_by_staff_id: null,
  created_at: '2026-10-01T09:00:00.000Z',
  updated_at: '2026-10-01T10:00:00.000Z',
} as unknown as ReminderVersionRow;

function stepRow(content: string): ReminderStepRow {
  return {
    id: 'step-10',
    reminder_id: 'reminder-10',
    offset_minutes: -60,
    message_type: 'text',
    message_content: content,
    created_at: '2026-10-01T09:00:00.000Z',
    offset_days: 1,
    send_at_time: '10:00',
    template_id: null,
  };
}

async function friendRow(db: D1Database, id: string) {
  const { getFriendById } = await import('@line-crm/db');
  const friend = await getFriendById(db, id);
  if (!friend) throw new Error(`friend not found: ${id}`);
  return friend;
}

describe('F10: 予約日時・Meet URLの差し込み', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    testDb = createTestD1();
    seedBase(testDb.raw);
  });

  it('送る側で予約日時とMeet URLに置き換わる', async () => {
    const built = await buildReminderStepMessage(
      testDb.db,
      stepRow('ご予約は{{reservation_datetime}}です。こちらから{{meet_url}}'),
      await friendRow(testDb.db, 'friend-10a'),
      new Date('2026-10-09T10:00:00+09:00'),
      'reminder',
    );
    expect(built.messageContent).toContain('10月10日');
    expect(built.messageContent).toContain('10:00');
    expect(built.messageContent).toContain(MEET_URL);
    expect(built.messageContent).not.toContain('{{');
  });

  it('予定が無い人には空で送りプレースホルダは残らない', async () => {
    const built = await buildReminderStepMessage(
      testDb.db,
      stepRow('ご予約は{{reservation_datetime}}です。こちらから{{meet_url}}'),
      await friendRow(testDb.db, 'friend-10b'),
      new Date('2026-10-09T10:00:00+09:00'),
      'reminder',
    );
    expect(built.messageContent).not.toContain('{{');
    expect(built.messageContent).not.toContain(MEET_URL);
  });

  it('公開前チェックは差し込みが空の人を落とす', async () => {
    const result = await validateReminderDraft(
      testDb.db,
      settingsWith('ご予約は{{reservation_datetime}}です。こちらから{{meet_url}}'),
      version,
    );
    expect(result.valid).toBe(false);
    const booking = result.checks.find((item) => item.key === 'booking_placeholders');
    expect(booking?.status).toBe('failed');
    expect(booking?.message).toContain('1人');
  });

  it('差し込みを使わなければ公開前チェックは通る', async () => {
    const result = await validateReminderDraft(
      testDb.db,
      settingsWith('予約の前日です'),
      version,
    );
    expect(result.valid).toBe(true);
  });

  it('全員に予定があれば公開前チェックは通る', async () => {
    testDb.raw.prepare(
      `INSERT INTO meet_consultations
        (id, external_event_id, friend_id, title, starts_at, ends_at, meet_url, status)
       VALUES ('meet-2', 'event-2', 'friend-10b', '個別相談',
               '2026-10-11T01:00:00.000Z', '2026-10-11T01:30:00.000Z', ?, 'confirmed')`,
    ).run(MEET_URL);
    const result = await validateReminderDraft(
      testDb.db,
      settingsWith('ご予約は{{reservation_datetime}}です'),
      version,
    );
    expect(result.valid).toBe(true);
  });

  it('取消済みの予定は空扱いになる', async () => {
    testDb.raw.prepare(`UPDATE meet_consultations SET status = 'cancelled' WHERE id = 'meet-1'`).run();
    const built = await buildReminderStepMessage(
      testDb.db,
      stepRow('ご予約は{{reservation_datetime}}です'),
      await friendRow(testDb.db, 'friend-10a'),
      new Date('2026-10-09T10:00:00+09:00'),
      'reminder',
    );
    expect(built.messageContent).not.toContain('{{');
    expect(built.messageContent).not.toContain('10月10日');
  });
});
