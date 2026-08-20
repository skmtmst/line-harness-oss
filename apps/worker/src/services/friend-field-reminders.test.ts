import { describe, it, expect, vi, beforeEach } from 'vitest';

const getFriendFieldReminders = vi.fn();
const getFriendsWithFieldValue = vi.fn();
const hasReminderEnrollment = vi.fn();
const enrollFriendInReminder = vi.fn();

vi.mock('@line-crm/db', () => ({
  getFriendFieldReminders: (...a: unknown[]) => getFriendFieldReminders(...a),
  getFriendsWithFieldValue: (...a: unknown[]) => getFriendsWithFieldValue(...a),
  hasReminderEnrollment: (...a: unknown[]) => hasReminderEnrollment(...a),
  enrollFriendInReminder: (...a: unknown[]) => enrollFriendInReminder(...a),
}));

import { processFriendFieldReminders } from './friend-field-reminders.js';

const db = {} as D1Database;
const jst = (text: string) => new Date(`${text}:00+09:00`);

function reminder(patch: Record<string, unknown> = {}) {
  return {
    id: 'rem-1',
    name: '誕生日',
    trigger_field_id: 'field-birthday',
    repeat_yearly: 1,
    line_account_id: null,
    ...patch,
  };
}

beforeEach(() => {
  getFriendFieldReminders.mockReset();
  getFriendsWithFieldValue.mockReset();
  hasReminderEnrollment.mockReset().mockResolvedValue(false);
  enrollFriendInReminder.mockReset().mockResolvedValue({ id: 'fr-1' });
});

describe('processFriendFieldReminders', () => {
  it('リマインダが無ければ何もしない', async () => {
    getFriendFieldReminders.mockResolvedValue([]);
    const result = await processFriendFieldReminders(db, jst('2026-05-01T00:05'));
    expect(result).toEqual({ enrolled: 0, skipped: 0 });
    expect(getFriendsWithFieldValue).not.toHaveBeenCalled();
  });

  describe('毎年くり返す（誕生日）', () => {
    it('生まれ年に関係なく、今年のその日をゴールに立てる', async () => {
      getFriendFieldReminders.mockResolvedValue([reminder()]);
      getFriendsWithFieldValue.mockResolvedValue([
        { friend_id: 'f-1', value: '1990-05-03' },
      ]);

      const result = await processFriendFieldReminders(db, jst('2026-04-01T00:05'));

      expect(result.enrolled).toBe(1);
      expect(enrollFriendInReminder).toHaveBeenCalledWith(db, {
        friendId: 'f-1',
        reminderId: 'rem-1',
        // 年ごと比べると一度も当たらない。月日だけを見る。
        targetDate: '2026-05-03T00:00:00+09:00',
      });
    });

    it('過ぎていれば来年ぶんを立てる', async () => {
      getFriendFieldReminders.mockResolvedValue([reminder()]);
      getFriendsWithFieldValue.mockResolvedValue([
        { friend_id: 'f-1', value: '1990-05-03' },
      ]);

      await processFriendFieldReminders(db, jst('2026-05-04T00:05'));

      expect(enrollFriendInReminder).toHaveBeenCalledWith(
        db,
        expect.objectContaining({ targetDate: '2027-05-03T00:00:00+09:00' }),
      );
    });

    it('同じ年に二重に立てない', async () => {
      getFriendFieldReminders.mockResolvedValue([reminder()]);
      getFriendsWithFieldValue.mockResolvedValue([
        { friend_id: 'f-1', value: '1990-05-03' },
      ]);
      hasReminderEnrollment.mockResolvedValue(true);

      const result = await processFriendFieldReminders(db, jst('2026-04-01T00:05'));

      expect(result).toEqual({ enrolled: 0, skipped: 1 });
      expect(enrollFriendInReminder).not.toHaveBeenCalled();
    });
  });

  describe('くり返さない（契約更新日など）', () => {
    it('その日が今日なら立てる', async () => {
      getFriendFieldReminders.mockResolvedValue([reminder({ repeat_yearly: 0 })]);
      getFriendsWithFieldValue.mockResolvedValue([
        { friend_id: 'f-1', value: '2026-05-03' },
      ]);

      const result = await processFriendFieldReminders(db, jst('2026-05-03T00:05'));

      expect(result.enrolled).toBe(1);
    });

    it('今日でなければ立てない', async () => {
      getFriendFieldReminders.mockResolvedValue([reminder({ repeat_yearly: 0 })]);
      getFriendsWithFieldValue.mockResolvedValue([
        { friend_id: 'f-1', value: '2026-05-03' },
      ]);

      const result = await processFriendFieldReminders(db, jst('2026-05-02T00:05'));

      expect(result).toEqual({ enrolled: 0, skipped: 1 });
    });
  });

  it('読めない値の人は飛ばして、残りは続ける', async () => {
    getFriendFieldReminders.mockResolvedValue([reminder()]);
    getFriendsWithFieldValue.mockResolvedValue([
      { friend_id: 'f-1', value: '未記入' },
      { friend_id: 'f-2', value: '1988-05-03' },
    ]);

    const result = await processFriendFieldReminders(db, jst('2026-04-01T00:05'));

    expect(result).toEqual({ enrolled: 1, skipped: 1 });
  });

  it('1つのリマインダで転んでも、残りのリマインダは続ける', async () => {
    getFriendFieldReminders.mockResolvedValue([
      reminder({ id: 'rem-broken' }),
      reminder({ id: 'rem-ok', trigger_field_id: 'field-2' }),
    ]);
    getFriendsWithFieldValue
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce([{ friend_id: 'f-1', value: '1990-05-03' }]);

    const result = await processFriendFieldReminders(db, jst('2026-04-01T00:05'));

    expect(result.enrolled).toBe(1);
  });

  it('UTC で前日になる時刻でも、日本時間の日付で見る', async () => {
    getFriendFieldReminders.mockResolvedValue([reminder({ repeat_yearly: 0 })]);
    getFriendsWithFieldValue.mockResolvedValue([
      { friend_id: 'f-1', value: '2026-05-03' },
    ]);

    // 2026-05-02T15:30Z = 2026-05-03 00:30 JST
    const result = await processFriendFieldReminders(db, new Date('2026-05-02T15:30:00Z'));

    expect(result.enrolled).toBe(1);
  });
});
