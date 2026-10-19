import { createTestD1, type SqliteD1 } from '../../test-utils/d1-sqlite.js';
import { afterEach, describe, expect, test, vi } from 'vitest';
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

const fixtures: SqliteD1[] = [];
afterEach(() => { for (const fixture of fixtures.splice(0)) fixture.raw.close(); });
function stubDB(due: DueRow[]) {
  const fixture=createTestD1();fixtures.push(fixture);
  const {raw,db}=fixture;
  raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('a','c','A','tok','secret');
    INSERT INTO friends(id,line_user_id,line_account_id,is_following) VALUES('f','U','a',1);
    INSERT INTO staff(id,line_account_id,name,display_name) VALUES('s','a','S','S');
    INSERT INTO menus(id,line_account_id,name,duration_minutes,base_price) VALUES('m','a','M',60,100);
    INSERT INTO booking_settings(id,line_account_id,timezone) VALUES('settings','a','Asia/Tokyo');`);
  for(const row of due) {
    raw.prepare('UPDATE friends SET line_user_id=?').run(row.line_user_id);
    raw.prepare('UPDATE menus SET name=?').run(row.menu_name);raw.prepare('UPDATE staff SET display_name=?').run(row.staff_name);
    raw.prepare('UPDATE booking_settings SET timezone=?').run(row.timezone??'Asia/Tokyo');
    raw.prepare(`INSERT INTO bookings(id,line_account_id,friend_id,staff_id,menu_id,starts_at,ends_at,block_ends_at,status,price_at_booking,requested_at)
      VALUES(?,'a','f','s','m',?,?,?,'confirmed',100,'2026-01-01')`).run(row.booking_id,row.starts_at,new Date(Date.parse(row.starts_at)+3600000).toISOString(),new Date(Date.parse(row.starts_at)+3600000).toISOString());
    raw.prepare(`INSERT INTO booking_reminders(id,booking_id,kind,scheduled_at,retry_count,last_error)
      VALUES(?,?,?,'2026-05-09',?,'notification_preflight_failed')`).run(row.id,row.booking_id,row.kind,row.retry_count);
  }
  return {db,raw};
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
        starts_at: '2026-05-10T05:10:00Z',
        menu_name: 'カット',
        staff_name: '山田',
        channel_access_token: 'tok',
        line_user_id: 'U_xyz',
      },
    ];
    const { db, raw } = stubDB(due);
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
    expect(raw.prepare("SELECT status FROM booking_reminders").get()).toEqual({status:"sent"});
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

  test('送信後の失敗は初回でも結果不明で停止し、retry_count=1', async () => {
    const due: DueRow[] = [
      {
        id: 'R1',
        booking_id: 'B1',
        kind: 'day_before',
        retry_count: 0,
        starts_at: '2026-05-10T05:10:00Z',
        menu_name: 'カット',
        staff_name: '山田',
        channel_access_token: 'tok',
        line_user_id: 'U',
      },
    ];
    const { db, raw } = stubDB(due);
    const sender = vi.fn().mockRejectedValue(new Error('LINE 500'));
    const result = await processDueReminders(db, {
      now: NOW,
      sender,
    });
    expect(result).toEqual({ sent: 0, failed: 1 });
    expect(raw.prepare('SELECT status,retry_count,last_error FROM booking_reminders').get())
      .toEqual({status:'failed_permanent',retry_count:1,last_error:'delivery_unknown'});
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
        starts_at: '2026-05-10T05:10:00Z',
        menu_name: 'カット',
        staff_name: '山田',
        channel_access_token: 'tok',
        line_user_id: 'U',
      },
    ];
    const { db, raw } = stubDB(due);
    const sender = vi.fn().mockRejectedValue(new Error('LINE 500'));
    const result = await processDueReminders(db, {
      now: NOW,
      sender,
    });
    expect(raw.prepare('SELECT status,retry_count FROM booking_reminders').get())
      .toEqual({status:'failed_permanent',retry_count:3});
  });
});
