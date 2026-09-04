import { describe, it, expect, vi, beforeEach } from 'vitest';

const getFriendFieldReminders = vi.fn();
const getFriendsWithFieldValuePage = vi.fn();
const setFriendFieldReminderScanCursor = vi.fn();
const enrollFriendsInReminderOnce = vi.fn();

vi.mock('@line-crm/db', () => ({
  getFriendFieldReminders: (...a: unknown[]) => getFriendFieldReminders(...a),
  getFriendsWithFieldValuePage: (...a: unknown[]) => getFriendsWithFieldValuePage(...a),
  setFriendFieldReminderScanCursor: (...a: unknown[]) => setFriendFieldReminderScanCursor(...a),
  enrollFriendsInReminderOnce: (...a: unknown[]) => enrollFriendsInReminderOnce(...a),
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
    scan_cursor: null,
    ...patch,
  };
}

beforeEach(() => {
  getFriendFieldReminders.mockReset();
  getFriendsWithFieldValuePage.mockReset();
  setFriendFieldReminderScanCursor.mockReset().mockResolvedValue(undefined);
  enrollFriendsInReminderOnce.mockReset().mockImplementation(
    async (_db: D1Database, _reminderId: string, candidates: unknown[]) => candidates.length,
  );
});

describe('processFriendFieldReminders', () => {
  it('リマインダが無ければ何もしない', async () => {
    getFriendFieldReminders.mockResolvedValue([]);
    const result = await processFriendFieldReminders(db, jst('2026-05-01T00:05'));
    expect(result).toEqual({ enrolled: 0, skipped: 0, scanned: 0, hasMore: false });
    expect(getFriendsWithFieldValuePage).not.toHaveBeenCalled();
  });

  describe('毎年くり返す（誕生日）', () => {
    it('生まれ年に関係なく、今年のその日をゴールに立てる', async () => {
      getFriendFieldReminders.mockResolvedValue([reminder()]);
      getFriendsWithFieldValuePage.mockResolvedValue([
        { friend_id: 'f-1', value: '1990-05-03' },
      ]);

      const result = await processFriendFieldReminders(db, jst('2026-04-01T00:05'));

      expect(result.enrolled).toBe(1);
      expect(enrollFriendsInReminderOnce).toHaveBeenCalledWith(db, 'rem-1', [{
        friendId: 'f-1',
        // 年ごと比べると一度も当たらない。月日だけを見る。
        targetDate: '2026-05-03T00:00:00+09:00',
      }]);
    });

    it('過ぎていれば来年ぶんを立てる', async () => {
      getFriendFieldReminders.mockResolvedValue([reminder()]);
      getFriendsWithFieldValuePage.mockResolvedValue([
        { friend_id: 'f-1', value: '1990-05-03' },
      ]);

      await processFriendFieldReminders(db, jst('2026-05-04T00:05'));

      expect(enrollFriendsInReminderOnce).toHaveBeenCalledWith(
        db,
        'rem-1',
        [expect.objectContaining({ targetDate: '2027-05-03T00:00:00+09:00' })],
      );
    });

    it('同じ年に二重に立てない', async () => {
      getFriendFieldReminders.mockResolvedValue([reminder()]);
      getFriendsWithFieldValuePage.mockResolvedValue([
        { friend_id: 'f-1', value: '1990-05-03' },
      ]);
      enrollFriendsInReminderOnce.mockResolvedValue(0);

      const result = await processFriendFieldReminders(db, jst('2026-04-01T00:05'));

      expect(result).toEqual({ enrolled: 0, skipped: 1, scanned: 1, hasMore: false });
    });
  });

  describe('くり返さない（契約更新日など）', () => {
    it('その日が今日なら立てる', async () => {
      getFriendFieldReminders.mockResolvedValue([reminder({ repeat_yearly: 0 })]);
      getFriendsWithFieldValuePage.mockResolvedValue([
        { friend_id: 'f-1', value: '2026-05-03' },
      ]);

      const result = await processFriendFieldReminders(db, jst('2026-05-03T00:05'));

      expect(result.enrolled).toBe(1);
    });

    it('今日でなければ立てない', async () => {
      getFriendFieldReminders.mockResolvedValue([reminder({ repeat_yearly: 0 })]);
      getFriendsWithFieldValuePage.mockResolvedValue([
        { friend_id: 'f-1', value: '2026-05-03' },
      ]);

      const result = await processFriendFieldReminders(db, jst('2026-05-02T00:05'));

      expect(result).toEqual({ enrolled: 0, skipped: 1, scanned: 1, hasMore: false });
    });
  });

  it('読めない値の人は飛ばして、残りは続ける', async () => {
    getFriendFieldReminders.mockResolvedValue([reminder()]);
    getFriendsWithFieldValuePage.mockResolvedValue([
      { friend_id: 'f-1', value: '未記入' },
      { friend_id: 'f-2', value: '1988-05-03' },
    ]);

    const result = await processFriendFieldReminders(db, jst('2026-04-01T00:05'));

    expect(result).toEqual({ enrolled: 1, skipped: 1, scanned: 2, hasMore: false });
  });

  it('1つのリマインダで転んでも、残りのリマインダは続ける', async () => {
    getFriendFieldReminders.mockResolvedValue([
      reminder({ id: 'rem-broken' }),
      reminder({ id: 'rem-ok', trigger_field_id: 'field-2' }),
    ]);
    getFriendsWithFieldValuePage
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce([{ friend_id: 'f-1', value: '1990-05-03' }]);

    const result = await processFriendFieldReminders(db, jst('2026-04-01T00:05'));

    expect(result.enrolled).toBe(1);
  });

  it('UTC で前日になる時刻でも、日本時間の日付で見る', async () => {
    getFriendFieldReminders.mockResolvedValue([reminder({ repeat_yearly: 0 })]);
    getFriendsWithFieldValuePage.mockResolvedValue([
      { friend_id: 'f-1', value: '2026-05-03' },
    ]);

    // 2026-05-02T15:30Z = 2026-05-03 00:30 JST
    const result = await processFriendFieldReminders(db, new Date('2026-05-02T15:30:00Z'));

    expect(result.enrolled).toBe(1);
  });
});

describe('分割と再開', () => {
  it('4,000人の走査枠を複数リマインダへ均等に割り当てる', async () => {
    getFriendFieldReminders.mockResolvedValue([
      reminder({ id: 'rem-a', trigger_field_id: 'field-a', line_account_id: 'account-a' }),
      reminder({ id: 'rem-b', trigger_field_id: 'field-b', line_account_id: 'account-b' }),
    ]);
    getFriendsWithFieldValuePage.mockImplementation(
      async (
        _db: D1Database,
        fieldId: string,
        _lineAccountId: string | null,
        _after: string | null,
        limit: number,
      ) => (
        Array.from({ length: limit }, (_, index) => ({
          friend_id: `${fieldId}-friend-${index + 1}`,
          value: '1990-05-03',
        }))
      ),
    );

    const result = await processFriendFieldReminders(db, jst('2026-04-01T00:05'));

    expect(result).toEqual({ enrolled: 4_000, skipped: 0, scanned: 4_000, hasMore: true });
    expect(getFriendsWithFieldValuePage).toHaveBeenNthCalledWith(
      1, db, 'field-a', 'account-a', null, 2_000,
    );
    expect(getFriendsWithFieldValuePage).toHaveBeenNthCalledWith(
      2, db, 'field-b', 'account-b', null, 2_000,
    );
  });

  it('5,001人を4,000人と1,001人の2回に分け、保存カーソルから再開する', async () => {
    const friends = Array.from({ length: 5_001 }, (_, i) => ({
      friend_id: `f-${String(i + 1).padStart(5, '0')}`,
      value: '1990-05-03',
    }));
    let cursor: string | null = null;
    getFriendFieldReminders.mockImplementation(async () => [reminder({ scan_cursor: cursor })]);
    getFriendsWithFieldValuePage.mockImplementation(
      async (
        _db: D1Database,
        _fieldId: string,
        _lineAccountId: string | null,
        after: string | null,
        limit: number,
      ) => {
        const start = after === null
          ? 0
          : friends.findIndex((friend) => friend.friend_id === after) + 1;
        return friends.slice(start, start + limit);
      },
    );
    setFriendFieldReminderScanCursor.mockImplementation(
      async (_db: D1Database, _reminderId: string, next: string | null) => {
        cursor = next;
      },
    );

    const first = await processFriendFieldReminders(db, jst('2026-04-01T00:05'));
    const second = await processFriendFieldReminders(db, jst('2026-04-02T00:05'));

    expect(first).toEqual({ enrolled: 4_000, skipped: 0, scanned: 4_000, hasMore: true });
    expect(second).toEqual({ enrolled: 1_001, skipped: 0, scanned: 1_001, hasMore: false });
    expect(getFriendsWithFieldValuePage).toHaveBeenNthCalledWith(
      2,
      db,
      'field-birthday',
      null,
      'f-04000',
      4_000,
    );
    expect(cursor).toBeNull();
  });

  it('カーソル保存前に止まったページを再実行しても登録数を増やさない', async () => {
    getFriendFieldReminders.mockResolvedValue([reminder()]);
    getFriendsWithFieldValuePage.mockResolvedValue([
      { friend_id: 'f-1', value: '1990-05-03' },
    ]);
    enrollFriendsInReminderOnce
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);
    setFriendFieldReminderScanCursor
      .mockRejectedValueOnce(new Error('cursor write failed'))
      .mockResolvedValueOnce(undefined);

    const first = await processFriendFieldReminders(db, jst('2026-04-01T00:05'));
    const resumed = await processFriendFieldReminders(db, jst('2026-04-01T00:05'));

    expect(first).toEqual({ enrolled: 1, skipped: 0, scanned: 1, hasMore: true });
    expect(resumed).toEqual({ enrolled: 0, skipped: 1, scanned: 1, hasMore: false });
  });
});
