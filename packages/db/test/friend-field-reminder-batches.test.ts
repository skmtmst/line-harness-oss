import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  enrollFriendsInReminderOnce,
  getFriendFieldReminders,
  getFriendsWithFieldValuePage,
  setFriendFieldReminderScanCursor,
} from '../src/reminders.js';
import { asD1 } from './d1-test-helper.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('友だち情報欄リマインダの分割走査', () => {
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
      VALUES ('field-birthday', '誕生日', 'birthday', 'date');
      INSERT INTO reminders
        (id, name, line_account_id, is_active, trigger_type, trigger_field_id,
         repeat_yearly, delivery_mode)
      VALUES ('reminder-1', '誕生日', 'account-1', 1, 'friend_field',
              'field-birthday', 1, 'countdown');
    `);

    const insertFriend = sqlite.prepare(
      `INSERT INTO friends (id, line_user_id, line_account_id)
       VALUES (?, ?, 'account-1')`,
    );
    const insertValue = sqlite.prepare(
      `INSERT INTO friend_field_values (friend_id, field_id, value)
       VALUES (?, 'field-birthday', '1990-05-03')`,
    );
    for (let i = 1; i <= 35; i++) {
      const id = `friend-${String(i).padStart(3, '0')}`;
      insertFriend.run(id, `U${String(i).padStart(3, '0')}`);
      insertValue.run(id);
    }
  });

  afterEach(() => sqlite.close());

  it('保存した友だちIDの続きから、指定件数だけ読む', async () => {
    const first = await getFriendsWithFieldValuePage(db, 'field-birthday', 'account-1', null, 10);
    expect(first).toHaveLength(10);
    expect(first[0]?.friend_id).toBe('friend-001');
    expect(first.at(-1)?.friend_id).toBe('friend-010');

    await setFriendFieldReminderScanCursor(db, 'reminder-1', 'friend-010');
    const reminders = await getFriendFieldReminders(db);
    expect(reminders[0]?.scan_cursor).toBe('friend-010');

    const second = await getFriendsWithFieldValuePage(
      db,
      'field-birthday',
      'account-1',
      reminders[0]?.scan_cursor ?? null,
      10,
    );
    expect(second[0]?.friend_id).toBe('friend-011');
    expect(second.at(-1)?.friend_id).toBe('friend-020');
  });

  it('共通の情報欄でも選択したLINEアカウントの友だちだけを読む', async () => {
    sqlite.exec(`
      INSERT INTO line_accounts
        (id, channel_id, name, channel_access_token, channel_secret)
      VALUES ('account-2', 'channel-2', '支店', 'token-2', 'secret-2');
      INSERT INTO friends (id, line_user_id, line_account_id)
      VALUES ('friend-other', 'U999', 'account-2');
      INSERT INTO friend_field_values (friend_id, field_id, value)
      VALUES ('friend-other', 'field-birthday', '1990-05-03');
    `);

    const friends = await getFriendsWithFieldValuePage(
      db,
      'field-birthday',
      'account-1',
      null,
      100,
    );

    expect(friends).toHaveLength(35);
    expect(friends.some((friend) => friend.friend_id === 'friend-other')).toBe(false);
  });

  it('30件を超える候補もbind上限内で登録し、同じ候補の再実行では増やさない', async () => {
    const candidates = Array.from({ length: 35 }, (_, i) => ({
      friendId: `friend-${String(i + 1).padStart(3, '0')}`,
      targetDate: '2026-05-03T00:00:00+09:00',
    }));

    expect(await enrollFriendsInReminderOnce(db, 'reminder-1', candidates)).toBe(35);
    expect(await enrollFriendsInReminderOnce(db, 'reminder-1', candidates)).toBe(0);
    expect(sqlite.prepare(
      `SELECT COUNT(*) AS count FROM friend_reminders WHERE reminder_id = 'reminder-1'`,
    ).get()).toEqual({ count: 35 });
  });

  it('旧形式のランダムIDで登録済みでも同じゴール日を増やさない', async () => {
    sqlite.prepare(
      `INSERT INTO friend_reminders (id, friend_id, reminder_id, target_date)
       VALUES ('old-random-id', 'friend-001', 'reminder-1', ?)`,
    ).run('2026-05-03T00:00:00+09:00');

    const added = await enrollFriendsInReminderOnce(db, 'reminder-1', [
      { friendId: 'friend-001', targetDate: '2026-05-03T00:00:00+09:00' },
    ]);

    expect(added).toBe(0);
    expect(sqlite.prepare(
      `SELECT COUNT(*) AS count FROM friend_reminders WHERE friend_id = 'friend-001'`,
    ).get()).toEqual({ count: 1 });
  });
});
