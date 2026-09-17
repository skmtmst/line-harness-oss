import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createReminderWithDraftVersion,
  getReminderById,
  getReminderDraftVersion,
  publishReminderDraftVersion,
  saveReminderDraftVersion,
} from '../src/reminders.js';
import { asD1 } from './d1-test-helper.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function settings(overrides: Record<string, unknown> = {}) {
  return {
    name: 'イベント前のお知らせ',
    description: null,
    lineAccountId: 'account-1',
    triggerType: 'event' as const,
    deliveryMode: 'time' as const,
    triggerFieldId: null,
    triggerEventId: 'event-1',
    repeatYearly: false,
    triggerOffsetMinutes: null,
    sendAtTime: '18:00',
    targetTagId: null,
    folderId: null,
    stopConditions: {
      bookingCancelled: true,
      supportMarkCompleted: false,
      daysAfterTarget: 7,
      friendBlocked: true,
    },
    steps: [
      {
        stableStepId: 's-1',
        offsetMinutes: 0,
        offsetDays: -1,
        sendAtTime: '18:00',
        messageType: 'text',
        messageContent: '前日です',
      },
    ],
    ...overrides,
  };
}

describe('418: イベント起点リマインダ', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(ROOT, 'bootstrap.sql'), 'utf8'));
    db = asD1(sqlite);
    sqlite.exec(`
      INSERT INTO line_accounts
        (id, channel_id, name, channel_access_token, channel_secret)
      VALUES ('account-1', 'channel-1', '本店', 'token', 'secret');
    `);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('下書き作成でイベントidを reminders 行と版スナップショットへ保存する', async () => {
    const { reminder } = await createReminderWithDraftVersion(db, settings());

    const row = await getReminderById(db, reminder.id);
    expect(row?.trigger_event_id).toBe('event-1');
    const draftVersion = await getReminderDraftVersion(db, reminder.id);
    expect(JSON.parse(draftVersion!.settings_snapshot).triggerEventId).toBe('event-1');
  });

  it('イベント未指定(NULL)の従来動作も保存できる', async () => {
    const { reminder } = await createReminderWithDraftVersion(
      db,
      settings({ triggerEventId: null }),
    );
    const row = await getReminderById(db, reminder.id);
    expect(row?.trigger_event_id).toBeNull();
  });

  it('公開でイベントidを reminders 行へ引き継ぐ', async () => {
    const { reminder, version } = await createReminderWithDraftVersion(db, settings());
    sqlite.exec(`UPDATE reminder_versions SET last_test_status = 'succeeded' WHERE id = '${version.id}'`);
    await publishReminderDraftVersion(db, reminder.id, 'staff-1');
    const row = await getReminderById(db, reminder.id);
    expect(row?.trigger_event_id).toBe('event-1');
  });

  it('expectedVersionId が今の下書き版と一致すれば保存する', async () => {
    const { reminder, version } = await createReminderWithDraftVersion(db, settings());
    const saved = await saveReminderDraftVersion(
      db,
      reminder.id,
      settings({ name: '改名後' }),
      { expectedVersionId: version.id },
    );
    expect(JSON.parse(saved.settings_snapshot).name).toBe('改名後');
  });

  it('expectedVersionId がずれていたら保存せず衝突を返す', async () => {
    const { reminder } = await createReminderWithDraftVersion(db, settings());
    await expect(
      saveReminderDraftVersion(db, reminder.id, settings({ name: '古い画面の内容' }), {
        expectedVersionId: 'version-old',
      }),
    ).rejects.toThrow('REMINDER_DRAFT_CONFLICT');
    const draftVersion = await getReminderDraftVersion(db, reminder.id);
    expect(JSON.parse(draftVersion!.settings_snapshot).name).toBe('イベント前のお知らせ');
  });

  it('下書き版が無い状態へ expectedVersionId 指定の保存は衝突を返す', async () => {
    // 別画面で公開済み(下書き版が消えた)あと、古い画面からの保存を止める。
    const { reminder, version } = await createReminderWithDraftVersion(db, settings());
    sqlite.exec(`UPDATE reminder_versions SET last_test_status = 'succeeded' WHERE id = '${version.id}'`);
    await publishReminderDraftVersion(db, reminder.id, 'staff-1');
    await expect(
      saveReminderDraftVersion(db, reminder.id, settings(), { expectedVersionId: 'version-1' }),
    ).rejects.toThrow('REMINDER_DRAFT_CONFLICT');
  });
});
