import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDashboardComparisons, monthWindows, weekWindows } from './dashboard-comparisons.js';

const packageRoot = join(import.meta.dirname, '..');

function asD1(sqlite: Database.Database): D1Database {
  function prepare(query: string): D1PreparedStatement {
    const statement = sqlite.prepare(query);
    const bound = (params: unknown[]): D1PreparedStatement => ({
      bind: (...next: unknown[]) => bound(next),
      async all<T>() {
        return { results: statement.all(...params) as T[], success: true, meta: {} };
      },
      async first<T>() {
        return (statement.get(...params) as T | undefined) ?? null;
      },
      async run<T>() {
        const result = statement.run(...params);
        return { success: true, meta: { changes: result.changes }, results: [] } as T;
      },
    } as unknown as D1PreparedStatement);
    return bound([]);
  }
  return { prepare } as unknown as D1Database;
}

/** 日曜の 17:51（日本時間）に固定する。先週の同じ曜日は 7 日前の日曜。 */
const NOW = new Date('2026-10-25T08:51:00.000Z');
const ACCOUNT = 'account-a';

let sqlite: Database.Database;
let db: D1Database;

function seedAccount(id: string, createdAt: string): void {
  sqlite.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, created_at)
     VALUES (?, ?, ?, 'token', 'secret', ?)`,
  ).run(id, `channel-${id}`, id, createdAt);
}

let seq = 0;
function seedBooking(accountId: string, startsAtUtc: string, status: string, createdAt = '2026-01-01T00:00:00.000'): void {
  seq += 1;
  sqlite.prepare(
    `INSERT INTO bookings (id, line_account_id, friend_id, staff_id, menu_id, starts_at, ends_at, block_ends_at,
       status, price_at_booking, requested_at, created_at)
     VALUES (?, ?, 'friend-x', 'staff-x', 'menu-x', ?, ?, ?, ?, 0, ?, ?)`,
  ).run(`bk-${seq}`, accountId, startsAtUtc, startsAtUtc, startsAtUtc, status, startsAtUtc, createdAt);
}

function seedFriend(accountId: string, following: boolean): void {
  seq += 1;
  sqlite.prepare(
    `INSERT INTO friends (id, line_user_id, display_name, line_account_id, is_following)
     VALUES (?, ?, 'name', ?, ?)`,
  ).run(`f-${seq}`, `u-${seq}`, accountId, following ? 1 : 0);
}

function seedFailure(accountId: string, failedAt: string, mode = 'automatic', instance?: string): void {
  seq += 1;
  sqlite.prepare(
    `INSERT INTO notification_deliveries (id, line_account_id, instance_id, audience_type, recipient_type, recipient_id,
       channel, idempotency_key, status, queued_at, failed_at, execution_mode, updated_at)
     VALUES (?, ?, ?, 'customer', 'friend', 'r', 'line', ?, 'failed', ?, ?, ?, ?)`,
  ).run(`d-${seq}`, accountId, instance ?? `i-${seq}`, `k-${seq}`, '2026-01-01T00:00:00.000+09:00', failedAt, mode, failedAt);
}

function seedOutgoing(accountId: string, createdAt: string): void {
  seq += 1;
  sqlite.prepare(
    `INSERT INTO messages_log (id, friend_id, direction, message_type, content, line_account_id, created_at)
     VALUES (?, 'friend-x', 'outgoing', 'text', 'x', ?, ?)`,
  ).run(`m-${seq}`, accountId, createdAt);
}

function seedBroadcast(accountId: string, sentAt: string): void {
  seq += 1;
  sqlite.prepare(
    `INSERT INTO broadcasts (id, title, message_type, message_content, status, sent_at, line_account_id)
     VALUES (?, 't', 'text', 'x', 'sent', ?, ?)`,
  ).run(`b-${seq}`, sentAt, accountId);
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW.getTime());
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(packageRoot, 'bootstrap.sql'), 'utf8'));
  // 比べる数だけを確かめる。予約・送達の親の行は作らない。
  sqlite.pragma('foreign_keys = OFF');
  db = asD1(sqlite);
  seedAccount(ACCOUNT, '2026-01-01T00:00:00.000');
});

describe('数の期間', () => {
  it('先週の同じ曜日は丸 1 日と、0 時から同じ時刻までの 2 つ', () => {
    const week = weekWindows(NOW);
    expect(week.today).toBe('2026-10-25');
    expect(week.previousDay).toBe('2026-10-18');
    expect(week.wholeDay.previousFrom.toISOString()).toBe('2026-10-17T15:00:00.000Z');
    expect(week.wholeDay.previousTo.toISOString()).toBe('2026-10-18T15:00:00.000Z');
    expect(week.soFar.previousTo.toISOString()).toBe('2026-10-18T08:51:00.000Z');
  });

  it('月は前の月の同じ日・同じ時刻まで', () => {
    const month = monthWindows(NOW);
    expect(month.currentFromDay).toBe('2026-10-01');
    expect(month.previousFromDay).toBe('2026-09-01');
    expect(month.previousTo.toISOString()).toBe('2026-09-25T08:51:00.000Z');
  });

  it('前の月にその日が無い時は前の月の終わりまで（3/31 → 2 月）', () => {
    const month = monthWindows(new Date('2027-03-31T03:00:00.000Z'));
    expect(month.previousFromDay).toBe('2027-02-01');
    expect(month.previousTo.toISOString()).toBe('2027-02-28T15:00:00.000Z');
  });

  it('1 月は前の年の 12 月と比べる', () => {
    const month = monthWindows(new Date('2027-01-10T03:00:00.000Z'));
    expect(month.previousFromDay).toBe('2026-12-01');
    expect(month.previousTo.toISOString()).toBe('2026-12-10T03:00:00.000Z');
  });
});

describe('getDashboardComparisons', () => {
  it('予約が先週 10 件・今日 12 件なら 12 と 10（取り消しは数えない）', async () => {
    for (let i = 0; i < 12; i += 1) seedBooking(ACCOUNT, '2026-10-25T01:00:00.000Z', 'confirmed');
    for (let i = 0; i < 10; i += 1) seedBooking(ACCOUNT, '2026-10-18T01:00:00.000Z', i % 2 ? 'completed' : 'confirmed');
    seedBooking(ACCOUNT, '2026-10-18T02:00:00.000Z', 'cancelled');
    seedBooking(ACCOUNT, '2026-10-25T02:00:00.000Z', 'rejected');
    // 日本時間の 10-18 の終わり（UTC の 10-18 15:00 以降）は 10-19 として数えない。
    seedBooking(ACCOUNT, '2026-10-18T15:30:00.000Z', 'confirmed');

    const result = await getDashboardComparisons(db, { lineAccountId: ACCOUNT, now: NOW });
    expect(result.comparisons.todayBookings).toEqual({
      current: 12,
      previous: 10,
      basis: 'same_weekday_last_week',
      better: 'high',
      asOf: '2026-10-25T17:51:00.000+09:00',
      previousFrom: '2026-10-18T00:00:00.000+09:00',
      previousTo: '2026-10-19T00:00:00.000+09:00',
    });
    expect(result.generatedAt).toBe('2026-10-25T17:51:00.000+09:00');
  });

  it('先週の予約が 0 件でも記録があれば 0 と比べる', async () => {
    seedBooking(ACCOUNT, '2026-10-25T01:00:00.000Z', 'confirmed', '2026-09-01T10:00:00.000');
    const result = await getDashboardComparisons(db, { lineAccountId: ACCOUNT, now: NOW });
    expect(result.comparisons.todayBookings).toMatchObject({ current: 1, previous: 0 });
  });

  it('予約の記録が先週の同じ曜日より後に始まったら比べない（0 として比べない）', async () => {
    seedBooking(ACCOUNT, '2026-10-25T01:00:00.000Z', 'confirmed', '2026-10-22T10:00:00.000');
    const result = await getDashboardComparisons(db, { lineAccountId: ACCOUNT, now: NOW });
    expect(result.comparisons.todayBookings).toBeNull();
    expect(result.skipped.todayBookings).toBe('no_previous_record');
  });

  it('アカウントを作ったのが先週の同じ曜日より後なら、どの数も比べない', async () => {
    seedAccount('account-new', '2026-10-20T09:00:00.000');
    seedBooking('account-new', '2026-10-25T01:00:00.000Z', 'confirmed', '2026-10-20T10:00:00.000');
    seedFailure('account-new', '2026-10-25T10:00:00.000+09:00');
    seedOutgoing('account-new', '2026-10-21T10:00:00.000');
    const result = await getDashboardComparisons(db, { lineAccountId: 'account-new', now: NOW });
    expect(result.comparisons).toEqual({
      todayBookings: null,
      activeFriends: null,
      deliveryFailures: null,
      monthlySent: null,
      monthlyBroadcasts: null,
    });
    expect(result.skipped).toEqual({
      todayBookings: 'no_previous_record',
      activeFriends: 'no_previous_record',
      deliveryFailures: 'no_previous_record',
      monthlySent: 'no_previous_record',
      monthlyBroadcasts: 'no_previous_record',
    });
  });

  it('友だちは先週の同じ曜日の日次の記録と比べ、記録が無ければ比べない', async () => {
    seedFriend(ACCOUNT, true);
    seedFriend(ACCOUNT, true);
    seedFriend(ACCOUNT, false);
    const before = await getDashboardComparisons(db, { lineAccountId: ACCOUNT, now: NOW });
    expect(before.comparisons.activeFriends).toBeNull();
    expect(before.skipped.activeFriends).toBe('no_previous_record');

    sqlite.prepare(
      `INSERT INTO friend_daily_snapshots (date, line_account_id, active, total, updated_at)
       VALUES ('2026-10-18', ?, 5, 6, '2026-10-18T23:55:00.000')`,
    ).run(ACCOUNT);
    const after = await getDashboardComparisons(db, { lineAccountId: ACCOUNT, now: NOW });
    expect(after.comparisons.activeFriends).toMatchObject({ current: 2, previous: 5, better: 'high' });
  });

  it('配信の失敗は今日の 0 時から今までを、先週の同じ曜日の同じ時刻までと比べる', async () => {
    seedFailure(ACCOUNT, '2026-10-25T09:00:00.000+09:00');
    seedFailure(ACCOUNT, '2026-10-25T10:00:00.000+09:00', 'automatic', 'same');
    seedFailure(ACCOUNT, '2026-10-25T10:05:00.000+09:00', 'automatic', 'same');
    seedFailure(ACCOUNT, '2026-10-25T11:00:00.000+09:00', 'retry');
    seedFailure(ACCOUNT, '2026-10-18T09:00:00.000+09:00');
    seedFailure(ACCOUNT, '2026-10-18T17:50:00.000+09:00');
    // 先週の同じ曜日でも、今の時刻より後の失敗は数えない。
    seedFailure(ACCOUNT, '2026-10-18T17:52:00.000+09:00');
    seedFailure(ACCOUNT, '2026-10-17T23:59:00.000+09:00');

    const result = await getDashboardComparisons(db, { lineAccountId: ACCOUNT, now: NOW });
    expect(result.comparisons.deliveryFailures).toMatchObject({
      current: 2,
      previous: 2,
      better: 'low',
      previousFrom: '2026-10-18T00:00:00.000+09:00',
      previousTo: '2026-10-18T17:51:00.000+09:00',
    });
  });

  it('今月の送信数と一斉配信は前の月の同じ日・同じ時刻までと比べる', async () => {
    seedOutgoing(ACCOUNT, '2026-10-01T00:10:00.000');
    seedOutgoing(ACCOUNT, '2026-10-25T17:00:00.000');
    seedOutgoing(ACCOUNT, '2026-09-01T00:10:00.000');
    seedOutgoing(ACCOUNT, '2026-09-25T17:50:00.000');
    seedOutgoing(ACCOUNT, '2026-09-25T17:52:00.000');
    seedOutgoing(ACCOUNT, '2026-08-31T23:59:00.000');
    seedBroadcast(ACCOUNT, '2026-10-02T10:00:00.000');
    seedBroadcast(ACCOUNT, '2026-09-10T10:00:00.000');
    seedBroadcast(ACCOUNT, '2026-09-20T10:00:00.000');
    seedBroadcast(ACCOUNT, '2026-09-28T10:00:00.000');

    const result = await getDashboardComparisons(db, { lineAccountId: ACCOUNT, now: NOW });
    expect(result.comparisons.monthlySent).toMatchObject({
      current: 2,
      previous: 2,
      basis: 'same_day_last_month',
      better: 'neutral',
      previousFrom: '2026-09-01T00:00:00.000+09:00',
      previousTo: '2026-09-25T17:51:00.000+09:00',
    });
    expect(result.comparisons.monthlyBroadcasts).toMatchObject({ current: 1, previous: 2, better: 'neutral' });
  });

  it('別のアカウントの数は混ぜない', async () => {
    seedAccount('account-b', '2026-01-01T00:00:00.000');
    seedBooking('account-b', '2026-10-25T01:00:00.000Z', 'confirmed');
    seedBooking(ACCOUNT, '2026-10-18T01:00:00.000Z', 'confirmed');
    seedFailure('account-b', '2026-10-25T09:00:00.000+09:00');
    seedOutgoing('account-b', '2026-10-02T09:00:00.000');
    const result = await getDashboardComparisons(db, { lineAccountId: ACCOUNT, now: NOW });
    expect(result.comparisons.todayBookings).toMatchObject({ current: 0, previous: 1 });
    expect(result.comparisons.monthlySent).toMatchObject({ current: 0, previous: 0 });
  });

  it('1 つの数が取れなくても他の数は返し、取れない数は null（0 にしない）', async () => {
    seedBooking(ACCOUNT, '2026-10-25T01:00:00.000Z', 'confirmed');
    sqlite.exec('DROP TABLE notification_deliveries');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = await getDashboardComparisons(db, { lineAccountId: ACCOUNT, now: NOW });
    expect(result.comparisons.deliveryFailures).toBeNull();
    expect(result.skipped.deliveryFailures).toBe('source_failed');
    expect(result.comparisons.todayBookings).toMatchObject({ current: 1, previous: 0 });
    expect(errors).toHaveBeenCalled();
  });
});
