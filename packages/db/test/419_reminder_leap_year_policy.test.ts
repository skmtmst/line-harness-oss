import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createReminderWithDraftVersion,
  getFriendFieldReminders,
  getReminderById,
  getReminderDraftVersion,
  publishReminderDraftVersion,
  saveReminderDraftVersion,
} from '../src/reminders.js';
import { asD1 } from './d1-test-helper.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function settings(overrides: Record<string, unknown> = {}) {
  return {
    name: '誕生日リマインダ',
    description: null,
    lineAccountId: 'account-1',
    triggerType: 'friend_field' as const,
    deliveryMode: 'time' as const,
    triggerFieldId: 'field-1',
    triggerEventId: null,
    repeatYearly: true,
    leapYearPolicy: 'feb28' as const,
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

describe('419: 2月29日の扱い（3択）', () => {
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
      INSERT INTO friend_fields (id, name, field_key, type)
      VALUES ('field-1', '誕生日', 'birthday', 'date');
    `);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('列の既定は mar1（設定ができる前からあるリマインダの動作を守る）', () => {
    const column = sqlite
      .prepare(`SELECT dflt_value FROM pragma_table_info('reminders') WHERE name = 'leap_year_policy'`)
      .get() as { dflt_value: string };
    expect(column.dflt_value).toBe("'mar1'");
  });

  it('3択以外の値は CHECK で書けない', () => {
    expect(() => sqlite.exec(`
      INSERT INTO reminders
        (id, line_account_id, name, trigger_type, delivery_mode, send_at_time, leap_year_policy, is_active)
      VALUES ('r-bad', 'account-1', 'x', 'friend_field', 'time', '18:00', 'feb29', 1)
    `)).toThrow();
  });

  it('新規作成で選んだ方針を行と版スナップショットへ保存する', async () => {
    const { reminder } = await createReminderWithDraftVersion(db, settings({ leapYearPolicy: 'skip' }));
    expect((await getReminderById(db, reminder.id))?.leap_year_policy).toBe('skip');
    const draft = await getReminderDraftVersion(db, reminder.id);
    expect(JSON.parse(draft!.settings_snapshot).leapYearPolicy).toBe('skip');
  });

  it('下書き保存で方針を書き換えられる', async () => {
    const { reminder, version } = await createReminderWithDraftVersion(db, settings());
    const saved = await saveReminderDraftVersion(
      db, reminder.id,
      settings({ leapYearPolicy: 'mar1' }),
      { expectedVersionId: version.id },
    );
    expect(JSON.parse(saved.settings_snapshot).leapYearPolicy).toBe('mar1');
  });

  it('公開で reminders 行へ方針を引き継ぐ', async () => {
    const { reminder, version } = await createReminderWithDraftVersion(db, settings({ leapYearPolicy: 'skip' }));
    sqlite.exec(`UPDATE reminder_versions SET last_test_status = 'succeeded' WHERE id = '${version.id}'`);
    await publishReminderDraftVersion(db, reminder.id, 'staff-1');
    expect((await getReminderById(db, reminder.id))?.leap_year_policy).toBe('skip');
  });

  it('419 より前のスナップショット（方針キー無し）は行の方針で公開される', async () => {
    const { reminder, version } = await createReminderWithDraftVersion(db, settings({ leapYearPolicy: 'skip' }));
    // 旧形式のスナップショットを再現（leapYearPolicy を消す）
    const draft = await getReminderDraftVersion(db, reminder.id);
    const snapshot = JSON.parse(draft!.settings_snapshot);
    delete snapshot.leapYearPolicy;
    sqlite.prepare(`UPDATE reminder_versions SET settings_snapshot = ?, last_test_status = 'succeeded' WHERE id = ?`)
      .run(JSON.stringify(snapshot), version.id);
    await publishReminderDraftVersion(db, reminder.id, 'staff-1');
    // 行の方針（mar1 の列既定ではなく作成時に書いた値）にフォールバックして保存される
    expect((await getReminderById(db, reminder.id))?.leap_year_policy).toBe('mar1');
  });

  it('友だち情報欄起点の一覧が方針を返す', async () => {
    const { reminder, version } = await createReminderWithDraftVersion(db, settings({ leapYearPolicy: 'feb28' }));
    sqlite.exec(`UPDATE reminder_versions SET last_test_status = 'succeeded' WHERE id = '${version.id}'`);
    await publishReminderDraftVersion(db, reminder.id, 'staff-1');
    const rows = await getFriendFieldReminders(db);
    expect(rows.map((row) => [row.id, row.leap_year_policy])).toEqual([[reminder.id, 'feb28']]);
  });
});
