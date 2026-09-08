/**
 * N-065 回帰テスト: 取消時の Calendar 削除は台帳駆動で回復する。
 *
 * 安定キー (`<bookingId>:google-calendar:delete`) で台帳行を1行に保つ。
 * ずみなら再実行せず、一時失敗は次の取消再試行で同じ鍵で直す。
 * 外部成功→台帳失敗の間も queued に残るため、相手先の 410 で回収できる。
 */
import { describe, expect, it } from 'vitest';

import { createTestD1 } from '../test-utils/d1-sqlite.js';
import {
  processPendingCalendarDeleteOperations,
  runCalendarDeleteOperation,
} from './booking-calendar-sync.js';

const ACCOUNT = 'cal-account-1';

function seed(raw: import('better-sqlite3').Database, bookingId: string, externalEventId: string | null): void {
  raw.prepare(
    `INSERT OR IGNORE INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
     VALUES (?, ?, ?, 'token', 'secret')`,
  ).run(ACCOUNT, `channel-${ACCOUNT}`, ACCOUNT);
  raw.prepare(
    `INSERT INTO bookings
       (id, line_account_id, friend_id, staff_id, menu_id,
        starts_at, ends_at, block_ends_at, status, price_at_booking, requested_at,
        external_event_id)
     VALUES (?, ?, 'cal-friend-1', 'cal-staff-1', 'cal-menu-1',
        '2026-09-20T01:00:00.000Z', '2026-09-20T02:00:00.000Z', '2026-09-20T02:00:00.000Z',
        'cancelled', 1000, '2026-09-01T00:00:00.000Z', ?)`,
  ).run(bookingId, ACCOUNT, externalEventId);
}

function opStatus(raw: import('better-sqlite3').Database, bookingId: string) {
  return raw.prepare(
    `SELECT status FROM booking_operation_runs
      WHERE line_account_id = ? AND idempotency_key = ?`,
  ).get(ACCOUNT, `${bookingId}:google-calendar:delete`) as { status: string } | undefined;
}

describe('取消時の Calendar 削除の台帳', () => {
  it('成功は1回だけ外部へ出し、再試行では触らない', async () => {
    const { db, raw } = createTestD1();
    seed(raw, 'cal-bk-1', 'google-event-1');
    let calls = 0;
    const remove = async () => { calls++; };

    expect(await runCalendarDeleteOperation(db, {
      bookingId: 'cal-bk-1', lineAccountId: ACCOUNT, remove,
    })).toBe('succeeded');
    expect(await runCalendarDeleteOperation(db, {
      bookingId: 'cal-bk-1', lineAccountId: ACCOUNT, remove,
    })).toBe('succeeded');
    expect(calls).toBe(1);
    expect(opStatus(raw, 'cal-bk-1')).toEqual({ status: 'succeeded' });
    expect(
      raw.prepare(`SELECT COUNT(*) AS c FROM booking_operation_runs`).get(),
    ).toEqual({ c: 1 });
  });

  it('一時失敗は台帳に残し、次の再試行で同じ鍵で直す', async () => {
    const { db, raw } = createTestD1();
    seed(raw, 'cal-bk-2', 'google-event-2');
    let calls = 0;
    const flaky = async () => {
      calls++;
      if (calls === 1) throw new Error('transient network error');
    };

    expect(await runCalendarDeleteOperation(db, {
      bookingId: 'cal-bk-2', lineAccountId: ACCOUNT, remove: flaky,
    })).toBe('retry_wait');
    expect(opStatus(raw, 'cal-bk-2')).toEqual({ status: 'retry_wait' });
    expect(await runCalendarDeleteOperation(db, {
      bookingId: 'cal-bk-2', lineAccountId: ACCOUNT, remove: flaky,
    })).toBe('succeeded');
    expect(calls).toBe(2);
    expect(opStatus(raw, 'cal-bk-2')).toEqual({ status: 'succeeded' });
    expect(
      raw.prepare(`SELECT COUNT(*) AS c FROM booking_operation_runs`).get(),
    ).toEqual({ c: 1 });
  });

  it('cron が retry_wait を拾い、安定キーのまま直す', async () => {
    const { db, raw } = createTestD1();
    seed(raw, 'cal-bk-4', 'google-event-4');
    let calls = 0;
    const flaky = async () => {
      calls++;
      if (calls === 1) throw new Error('transient network error');
    };

    // 初回は外部失敗で残る (200 後の残留)。
    expect(await runCalendarDeleteOperation(db, {
      bookingId: 'cal-bk-4', lineAccountId: ACCOUNT, remove: flaky,
    })).toBe('retry_wait');

    // cron が自動で再試行し、同じ鍵のまま成功へ閉じる (二重削除なし)。
    const drained = await processPendingCalendarDeleteOperations(db, {
      now: new Date('2026-09-02T00:00:00.000Z'),
      remove: async () => { await flaky(); },
    });
    expect(drained).toEqual({ processed: 1, succeeded: 1, retrying: 0, skipped: 0 });
    expect(calls).toBe(2);
    expect(opStatus(raw, 'cal-bk-4')).toEqual({ status: 'succeeded' });
    // もう拾わない。
    const again = await processPendingCalendarDeleteOperations(db, {
      now: new Date('2026-09-02T00:01:00.000Z'),
      remove: async () => { calls++; },
    });
    expect(again.processed).toBe(0);
    expect(calls).toBe(2);
  });

  it('lease中の行は取らず、古い lease は回収する', async () => {
    const { db, raw } = createTestD1();
    seed(raw, 'cal-bk-5', 'google-event-5');
    seed(raw, 'cal-bk-6', 'google-event-6');
    const failOnce = (() => {
      let n = 0;
      return async () => { n++; if (n === 1) throw new Error('transient'); };
    })();
    // 両方とも retry_wait で残す (bk-5 の remove は1回失敗させる)。
    await runCalendarDeleteOperation(db, { bookingId: 'cal-bk-5', lineAccountId: ACCOUNT, remove: failOnce });
    await runCalendarDeleteOperation(db, {
      bookingId: 'cal-bk-6', lineAccountId: ACCOUNT,
      remove: async () => { throw new Error('transient'); },
    });
    expect(opStatus(raw, 'cal-bk-5')).toEqual({ status: 'retry_wait' });
    expect(opStatus(raw, 'cal-bk-6')).toEqual({ status: 'retry_wait' });

    // cal-bk-5 は別 worker が掴んだばかり (lease 有効)、bk-6 は止まったまま。
    raw.prepare(`UPDATE booking_operation_runs SET opened_at = ?, updated_at = ? WHERE booking_id = ?`)
      .run('2026-09-02T00:00:00.000Z', '2026-09-02T00:00:00.000Z', 'cal-bk-5');
    raw.prepare(`UPDATE booking_operation_runs SET opened_at = ?, updated_at = ? WHERE booking_id = ?`)
      .run('2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', 'cal-bk-6');

    let calls = 0;
    const drained = await processPendingCalendarDeleteOperations(db, {
      now: new Date('2026-09-02T00:00:00.000Z'),
      remove: async () => { calls++; },
    });
    // 古い方だけ拾い、外部はもう消しずみ扱いで成功へ閉じる (410 相当)。
    expect(drained.processed).toBe(1);
    expect(calls).toBe(1);
    expect(opStatus(raw, 'cal-bk-5')).toEqual({ status: 'retry_wait' });
    expect(opStatus(raw, 'cal-bk-6')).toEqual({ status: 'succeeded' });
  });

  it('消す物が無ければ外部へ出ず skipped で閉じる', async () => {
    const { db, raw } = createTestD1();
    seed(raw, 'cal-bk-3', null);
    let calls = 0;

    expect(await runCalendarDeleteOperation(db, {
      bookingId: 'cal-bk-3', lineAccountId: ACCOUNT, remove: async () => { calls++; },
    })).toBe('skipped');
    expect(calls).toBe(0);
    expect(opStatus(raw, 'cal-bk-3')).toEqual({ status: 'skipped' });
  });
});
