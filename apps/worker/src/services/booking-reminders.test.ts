import { describe, expect, test, vi } from 'vitest';
import { processDueReminders } from './booking-reminders.js';

interface DueRow {
  id: string;
  booking_id: string;
  kind: 'day_before' | 'hours_before';
  retry_count: number;
  starts_at: string;
  menu_name: string;
  staff_name: string;
  channel_access_token: string;
  line_user_id: string;
  /** 店舗のタイムゾーン。文面の日時と相対表現に使う (R332/R333)。 */
  timezone?: string | null;
}

function stubDB(due: DueRow[]) {
  const updates: Array<{ sql: string; bound: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          bound = args;
          return stmt;
        },
        async all() {
          if (sql.includes('FROM booking_reminders')) {
            return { results: due };
          }
          return { results: [] };
        },
        async run() {
          updates.push({ sql, bound });
          return { success: true, meta: { changes: 1 } };
        },
        async first() {
          return null;
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
  return { db, updates };
}

const NOW = new Date('2026-05-10T05:01:00Z');

describe('processDueReminders', () => {
  test('due な reminder を sent にし sender を呼ぶ', async () => {
    const due: DueRow[] = [
      {
        id: 'R1',
        booking_id: 'B1',
        kind: 'day_before',
        retry_count: 0,
        starts_at: '2026-05-10T05:00:00Z',
        menu_name: 'カット',
        staff_name: '山田',
        channel_access_token: 'tok',
        line_user_id: 'U_xyz',
      },
    ];
    const { db, updates } = stubDB(due);
    const sender = vi.fn().mockResolvedValue(undefined);
    const result = await processDueReminders(db, {
      now: NOW,
      sender,
    });
    expect(result).toEqual({ sent: 1, failed: 0 });
    expect(sender).toHaveBeenCalledTimes(1);
    expect(sender).toHaveBeenCalledWith(
      expect.objectContaining({
        channelAccessToken: 'tok',
        toLineUserId: 'U_xyz',
        kind: 'day_before',
      }),
    );
    expect(updates.find((u) => u.sql.includes("status='sent'"))).toBeTruthy();
  });

  test('未来の reminder は対象外（DB が返さない前提なので空入力）', async () => {
    const { db } = stubDB([]);
    const sender = vi.fn();
    const result = await processDueReminders(db, {
      now: NOW,
      sender,
    });
    expect(result).toEqual({ sent: 0, failed: 0 });
    expect(sender).not.toHaveBeenCalled();
  });

  test('送信失敗 1 回目: status=failed, retry_count=1', async () => {
    const due: DueRow[] = [
      {
        id: 'R1',
        booking_id: 'B1',
        kind: 'day_before',
        retry_count: 0,
        starts_at: '2026-05-10T05:00:00Z',
        menu_name: 'カット',
        staff_name: '山田',
        channel_access_token: 'tok',
        line_user_id: 'U',
      },
    ];
    const { db, updates } = stubDB(due);
    const sender = vi.fn().mockRejectedValue(new Error('LINE 500'));
    const result = await processDueReminders(db, {
      now: NOW,
      sender,
    });
    expect(result).toEqual({ sent: 0, failed: 1 });
    const failedUpdate = updates.find((u) => u.sql.includes('SET status = ?, retry_count = ?'));
    expect(failedUpdate).toBeTruthy();
    expect(failedUpdate!.bound[0]).toBe('failed');
    expect(failedUpdate!.bound[1]).toBe(1); // retry_count
  });

  // R333: 文面の残り時間は送信時点の実測。店舗設定のオフセットは
  // 通知予定を作る側だけが使い、文面には混入しない。
  test('残り時間は設定値ではなく送信時点からの実測 (R333)', async () => {
    const due: DueRow[] = [
      {
        id: 'R1',
        booking_id: 'B1',
        kind: 'hours_before',
        retry_count: 0,
        // 送信時点 05:01Z → 開始 09:00Z、実測で約4時間
        starts_at: '2026-05-10T09:00:00Z',
        menu_name: 'カット',
        staff_name: '山田',
        channel_access_token: 'tok',
        line_user_id: 'U',
      },
    ];
    const { db } = stubDB(due);
    const sender = vi.fn().mockResolvedValue(undefined);
    await processDueReminders(db, {
      now: NOW,
      sender,
    });
    expect(sender).toHaveBeenCalledTimes(1);
    const ctx = sender.mock.calls[0][0].ctx;
    expect(ctx.hoursUntil).toBe(4);
    expect(ctx.daysUntil).toBe(0);
  });

  // R332: 文面の日時は店舗の時間帯。日本以外の店舗では現地日時を出す。
  test('店舗がニューヨークなら日時は現地時間で組み立てる (R332)', async () => {
    const due: DueRow[] = [
      {
        id: 'R1',
        booking_id: 'B1',
        kind: 'day_before',
        retry_count: 0,
        // NY 現地 2026-05-10 10:00 (EDT=-4) = 14:00Z
        starts_at: '2026-05-10T14:00:00Z',
        menu_name: 'カット',
        staff_name: '山田',
        channel_access_token: 'tok',
        line_user_id: 'U',
        timezone: 'America/New_York',
      },
    ];
    const { db } = stubDB(due);
    const sender = vi.fn().mockResolvedValue(undefined);
    await processDueReminders(db, {
      now: NOW,
      sender,
    });
    const ctx = sender.mock.calls[0][0].ctx;
    expect(ctx.startsAt).toBe('2026-05-10 10:00');
    expect(ctx.daysUntil).toBe(0); // NY の暦日では当日
  });

  // R333: 前日通知の送信が遅れて予約当日になっても「明日」とは言わせない。
  test('遅れて当日になった前日リマインダは daysUntil=0 (R333)', async () => {
    const lateNow = new Date('2026-05-11T00:00:00Z'); // JST 09:00
    const due: DueRow[] = [
      {
        id: 'R1',
        booking_id: 'B1',
        kind: 'day_before',
        retry_count: 1,
        starts_at: '2026-05-11T02:00:00Z', // JST 11:00、JST では当日
        menu_name: 'カット',
        staff_name: '山田',
        channel_access_token: 'tok',
        line_user_id: 'U',
      },
    ];
    const { db } = stubDB(due);
    const sender = vi.fn().mockResolvedValue(undefined);
    await processDueReminders(db, {
      now: lateNow,
      sender,
    });
    const ctx = sender.mock.calls[0][0].ctx;
    expect(ctx.daysUntil).toBe(0);
    expect(ctx.startsAt).toBe('2026-05-11 11:00');
  });

  test('送信失敗 3 回目: failed_permanent', async () => {
    const due: DueRow[] = [
      {
        id: 'R1',
        booking_id: 'B1',
        kind: 'hours_before',
        retry_count: 2, // 3回目
        starts_at: '2026-05-10T05:00:00Z',
        menu_name: 'カット',
        staff_name: '山田',
        channel_access_token: 'tok',
        line_user_id: 'U',
      },
    ];
    const { db, updates } = stubDB(due);
    const sender = vi.fn().mockRejectedValue(new Error('LINE 500'));
    const result = await processDueReminders(db, {
      now: NOW,
      sender,
    });
    const u = updates.find((x) => x.sql.includes('SET status = ?, retry_count = ?'));
    expect(u!.bound[0]).toBe('failed_permanent');
    expect(u!.bound[1]).toBe(3);
  });
});
