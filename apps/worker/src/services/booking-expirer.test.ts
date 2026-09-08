import { describe, expect, test, vi } from 'vitest';
import { runExpirer } from './booking-expirer.js';
import { createTestD1, insertFriend } from '../test-utils/d1-sqlite.js';
import { enrollByTrigger } from './reminder-trigger.js';

interface StaleRow {
  id: string;
  starts_at: string;
  menu_name: string;
  staff_name: string;
  channel_access_token: string;
  line_user_id: string;
}

function stubDB(stale: StaleRow[], idempotencyPurged = 0) {
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
          if (sql.includes('FROM bookings')) {
            return { results: stale };
          }
          return { results: [] };
        },
        async run() {
          updates.push({ sql, bound });
          if (sql.includes('DELETE FROM booking_idempotency_keys')) {
            return { success: true, meta: { changes: idempotencyPurged } };
          }
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

const NOW = new Date('2026-05-08T01:00:00Z');

describe('runExpirer', () => {
  test('24h 経過 requested を expired にし期限切れ通知を呼ぶ', async () => {
    const stale: StaleRow[] = [
      {
        id: 'B1',
        starts_at: '2026-05-12T05:00:00Z',
        menu_name: 'カット',
        staff_name: '山田',
        channel_access_token: 'tok',
        line_user_id: 'U',
      },
    ];
    const { db, updates } = stubDB(stale);
    const sender = vi.fn().mockResolvedValue(undefined);
    const result = await runExpirer(db, { now: NOW, sender });
    expect(result.expired).toBe(1);
    expect(sender).toHaveBeenCalledTimes(1);
    expect(sender).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'expired', toLineUserId: 'U' }),
    );
    // bookings UPDATE expired + reminders UPDATE cancelled が発行されている
    expect(updates.some((u) => u.sql.includes("status='expired'"))).toBe(true);
    expect(updates.some((u) => u.sql.includes("status='cancelled'"))).toBe(true);
  });

  test('idempotency expired keys 削除件数を返す', async () => {
    const { db } = stubDB([], 3);
    const sender = vi.fn();
    const result = await runExpirer(db, { now: NOW, sender });
    expect(result.idempotencyPurged).toBe(3);
  });

  test('通知失敗しても expired 化は実行される', async () => {
    const stale: StaleRow[] = [
      {
        id: 'B1',
        starts_at: '2026-05-12T05:00:00Z',
        menu_name: 'カット',
        staff_name: '山田',
        channel_access_token: 'tok',
        line_user_id: 'U',
      },
    ];
    const { db, updates } = stubDB(stale);
    const sender = vi.fn().mockRejectedValue(new Error('LINE 500'));
    const result = await runExpirer(db, { now: NOW, sender });
    expect(result.expired).toBe(1);
    expect(updates.some((u) => u.sql.includes("status='expired'"))).toBe(true);
  });
});

// N-065: 期限切れも通常取消と同じく V6 の未送信予定だけを止める。
// 本物の SQLite に当て、別予約・別アカウントへ触れないことと再実行の冪等を見る。
describe('runExpirer の V6 連動', () => {
  const ACCOUNT_1 = 'v6ex-account-1';
  const ACCOUNT_2 = 'v6ex-account-2';
  const NOW_V6 = new Date('2026-09-10T00:00:00.000Z');
  const STALE_AT = '2026-09-08T00:00:00.000Z';
  const STARTS_A = '2026-09-20T01:00:00.000Z';
  const STARTS_B = '2026-09-21T01:00:00.000Z';
  const STARTS_C = '2026-09-22T01:00:00.000Z';

  function seedBase(raw: import('better-sqlite3').Database): void {
    for (const id of [ACCOUNT_1, ACCOUNT_2]) {
      raw.prepare(
        `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
         VALUES (?, ?, ?, 'token', 'secret')`,
      ).run(id, `channel-${id}`, id);
    }
    insertFriend(raw, 'v6ex-f1', { line_account_id: ACCOUNT_1 });
    insertFriend(raw, 'v6ex-f2', { line_account_id: ACCOUNT_2 });
    raw.prepare(
      `INSERT INTO menus (id, line_account_id, name, duration_minutes, base_price)
       VALUES ('v6ex-menu-1', ?, 'カット', 60, 1000)`,
    ).run(ACCOUNT_1);
    raw.prepare(
      `INSERT INTO menus (id, line_account_id, name, duration_minutes, base_price)
       VALUES ('v6ex-menu-2', ?, 'カット', 60, 1000)`,
    ).run(ACCOUNT_2);
    raw.prepare(
      `INSERT INTO staff (id, line_account_id, name, display_name)
       VALUES ('v6ex-staff-1', ?, '山田', '山田')`,
    ).run(ACCOUNT_1);
    raw.prepare(
      `INSERT INTO staff (id, line_account_id, name, display_name)
       VALUES ('v6ex-staff-2', ?, '鈴木', '鈴木')`,
    ).run(ACCOUNT_2);
    raw.prepare(
      `INSERT INTO reminders
         (id, name, line_account_id, is_active, trigger_type, delivery_mode, lifecycle_status)
       VALUES ('v6ex-rule-1', 'rule', ?, 1, 'booking', 'countdown', 'published')`,
    ).run(ACCOUNT_1);
    raw.prepare(
      `INSERT INTO reminder_steps (id, reminder_id, offset_minutes, message_type, message_content)
       VALUES ('v6ex-step-1', 'v6ex-rule-1', -60, 'text', 'ご来店をお待ちしています')`,
    ).run();
  }

  function seedBooking(
    raw: import('better-sqlite3').Database,
    id: string,
    input: {
      accountId: string;
      friendId: string;
      menuId: string;
      staffId: string;
      startsAt: string;
      requestedAt: string;
      status: string;
    },
  ): void {
    const endsAt = new Date(new Date(input.startsAt).getTime() + 3600_000).toISOString();
    raw.prepare(
      `INSERT INTO bookings
         (id, line_account_id, friend_id, staff_id, menu_id, starts_at, ends_at,
          block_ends_at, status, price_at_booking, requested_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1000, ?)`,
    ).run(
      id, input.accountId, input.friendId, input.staffId, input.menuId,
      input.startsAt, endsAt, endsAt, input.status, input.requestedAt,
    );
  }

  function seedRun(
    raw: import('better-sqlite3').Database,
    id: string,
    enrollmentIdValue: string,
    friendId: string,
    status: string,
  ): void {
    raw.prepare(
      `INSERT INTO reminder_delivery_runs
         (id, line_account_id, reminder_id, friend_reminder_id, friend_id,
          reminder_step_id, scheduled_at, idempotency_key, line_retry_key,
          status, created_at, updated_at)
       VALUES (?, ?, 'v6ex-rule-1', ?, ?, 'v6ex-step-1', ?, ?, ?, ?, ?, ?)`,
    ).run(
      id, ACCOUNT_1, enrollmentIdValue, friendId,
      id.endsWith('-q') ? '2026-09-20T00:00:00.000Z' : '2026-09-19T00:00:00.000Z',
      `idem-${id}`, `retry-${id}`, status,
      '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z',
    );
  }

  function enrollmentBySource(raw: import('better-sqlite3').Database, sourceId: string) {
    return raw.prepare(
      `SELECT id, status, cancel_reason FROM friend_reminders WHERE source_event_id = ?`,
    ).get(sourceId) as { id: string; status: string; cancel_reason: string | null };
  }

  test('未送信だけ止め、送信済み履歴を残す。再実行は無変更', async () => {
    const { db, raw } = createTestD1();
    seedBase(raw);
    seedBooking(raw, 'v6ex-stale', {
      accountId: ACCOUNT_1, friendId: 'v6ex-f1', menuId: 'v6ex-menu-1',
      staffId: 'v6ex-staff-1', startsAt: STARTS_A, requestedAt: STALE_AT, status: 'requested',
    });
    seedBooking(raw, 'v6ex-fresh', {
      accountId: ACCOUNT_1, friendId: 'v6ex-f1', menuId: 'v6ex-menu-1',
      staffId: 'v6ex-staff-1', startsAt: STARTS_B, requestedAt: '2026-09-09T23:00:00.000Z', status: 'requested',
    });
    for (const [id, startsAt] of [['v6ex-stale', STARTS_A], ['v6ex-fresh', STARTS_B]] as const) {
      await enrollByTrigger(db, {
        triggerType: 'booking', friendId: 'v6ex-f1', startsAtIso: startsAt,
        sourceId: id, sourceEventId: id,
      });
    }
    const staleEnrollment = enrollmentBySource(raw, 'v6ex-stale');
    seedRun(raw, 'v6ex-run-q', staleEnrollment.id, 'v6ex-f1', 'queued');
    seedRun(raw, 'v6ex-run-sent', staleEnrollment.id, 'v6ex-f1', 'succeeded');
    raw.prepare(
      `INSERT INTO friend_reminder_deliveries (id, friend_reminder_id, reminder_step_id, delivered_at)
       VALUES ('v6ex-del-1', ?, 'v6ex-step-1', '2026-09-19T00:00:00.000Z')`,
    ).run(staleEnrollment.id);
    raw.prepare(
      `INSERT INTO booking_reminders (id, booking_id, kind, scheduled_at, status)
       VALUES ('v6ex-old-1', 'v6ex-stale', 'day_before', ?, 'pending')`,
    ).run(STARTS_A);

    const sender = vi.fn().mockResolvedValue(undefined);
    const result = await runExpirer(db, { now: NOW_V6, sender });
    expect(result.expired).toBe(1);
    expect(sender).toHaveBeenCalledTimes(1);

    expect(raw.prepare(`SELECT status FROM bookings WHERE id = 'v6ex-stale'`).get()).toEqual({
      status: 'expired',
    });
    expect(raw.prepare(`SELECT status FROM bookings WHERE id = 'v6ex-fresh'`).get()).toEqual({
      status: 'requested',
    });
    // V6 の未送信だけ止まり、送信済みと追跡が残る。
    expect(enrollmentBySource(raw, 'v6ex-stale')).toEqual({
      id: staleEnrollment.id, status: 'cancelled', cancel_reason: 'booking_expired:v6ex-stale:by:system',
    });
    expect(raw.prepare(`SELECT status FROM reminder_delivery_runs WHERE id = 'v6ex-run-q'`).get()).toEqual({
      status: 'cancelled',
    });
    expect(raw.prepare(`SELECT status FROM reminder_delivery_runs WHERE id = 'v6ex-run-sent'`).get()).toEqual({
      status: 'succeeded',
    });
    expect(raw.prepare(`SELECT COUNT(*) AS c FROM friend_reminder_deliveries`).get()).toEqual({ c: 1 });
    // 旧リマインダも止まる。
    expect(raw.prepare(`SELECT status FROM booking_reminders WHERE id = 'v6ex-old-1'`).get()).toEqual({
      status: 'cancelled',
    });
    // 新しい予約の予定は残る。
    expect(enrollmentBySource(raw, 'v6ex-fresh').status).toBe('active');

    // 再実行は期限切れ0件で何も変えない。
    const again = await runExpirer(db, { now: NOW_V6, sender });
    expect(again.expired).toBe(0);
    expect(sender).toHaveBeenCalledTimes(1);
    expect(enrollmentBySource(raw, 'v6ex-stale').status).toBe('cancelled');
    expect(enrollmentBySource(raw, 'v6ex-fresh').status).toBe('active');
  });

  test('別予約・別アカウントの予定へ触れない', async () => {
    const { db, raw } = createTestD1();
    seedBase(raw);
    seedBooking(raw, 'v6ex-stale', {
      accountId: ACCOUNT_1, friendId: 'v6ex-f1', menuId: 'v6ex-menu-1',
      staffId: 'v6ex-staff-1', startsAt: STARTS_A, requestedAt: STALE_AT, status: 'requested',
    });
    seedBooking(raw, 'v6ex-other-account', {
      accountId: ACCOUNT_2, friendId: 'v6ex-f2', menuId: 'v6ex-menu-2',
      staffId: 'v6ex-staff-2', startsAt: STARTS_A, requestedAt: STALE_AT, status: 'requested',
    });
    seedBooking(raw, 'v6ex-confirmed', {
      accountId: ACCOUNT_1, friendId: 'v6ex-f1', menuId: 'v6ex-menu-1',
      staffId: 'v6ex-staff-1', startsAt: STARTS_C, requestedAt: STALE_AT, status: 'confirmed',
    });
    await enrollByTrigger(db, {
      triggerType: 'booking', friendId: 'v6ex-f1', startsAtIso: STARTS_A,
      sourceId: 'v6ex-stale', sourceEventId: 'v6ex-stale',
    });
    await enrollByTrigger(db, {
      triggerType: 'booking', friendId: 'v6ex-f2', startsAtIso: STARTS_A,
      sourceId: 'v6ex-other-account', sourceEventId: 'v6ex-other-account',
    });
    await enrollByTrigger(db, {
      triggerType: 'booking', friendId: 'v6ex-f1', startsAtIso: STARTS_C,
      sourceId: 'v6ex-confirmed', sourceEventId: 'v6ex-confirmed',
    });

    const sender = vi.fn().mockResolvedValue(undefined);
    const result = await runExpirer(db, { now: NOW_V6, sender });
    expect(result.expired).toBe(2);

    // それぞれ自分の理由で止まる。
    expect(enrollmentBySource(raw, 'v6ex-stale').cancel_reason).toBe(
      'booking_expired:v6ex-stale:by:system',
    );
    expect(enrollmentBySource(raw, 'v6ex-other-account').cancel_reason).toBe(
      'booking_expired:v6ex-other-account:by:system',
    );
    // 確定済みの別予約は残る。
    expect(enrollmentBySource(raw, 'v6ex-confirmed').status).toBe('active');
  });

  test('V6 連動の失敗では期限切れ自体を止めない', async () => {
    const { db, raw } = createTestD1();
    seedBase(raw);
    seedBooking(raw, 'v6ex-stale', {
      accountId: ACCOUNT_1, friendId: 'v6ex-f1', menuId: 'v6ex-menu-1',
      staffId: 'v6ex-staff-1', startsAt: STARTS_A, requestedAt: STALE_AT, status: 'requested',
    });
    // friend_reminders を壊して V6 取消だけを失敗させる。
    raw.exec('DROP TABLE friend_reminders');
    const sender = vi.fn().mockResolvedValue(undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await runExpirer(db, { now: NOW_V6, sender });
      expect(result.expired).toBe(1);
      expect(raw.prepare(`SELECT status FROM bookings WHERE id = 'v6ex-stale'`).get()).toEqual({
        status: 'expired',
      });
      expect(sender).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });

  test('期限切れずみの取りこぼしは修復走査で止める', async () => {
    const { db, raw } = createTestD1();
    seedBase(raw);
    // 業務は期限切れずみだが V6 が active のまま (部分失敗の残り)。
    seedBooking(raw, 'v6ex-leftover', {
      accountId: ACCOUNT_1, friendId: 'v6ex-f1', menuId: 'v6ex-menu-1',
      staffId: 'v6ex-staff-1', startsAt: STARTS_A, requestedAt: STALE_AT, status: 'expired',
    });
    await enrollByTrigger(db, {
      triggerType: 'booking', friendId: 'v6ex-f1', startsAtIso: STARTS_A,
      sourceId: 'v6ex-leftover', sourceEventId: 'v6ex-leftover',
    });

    const sender = vi.fn().mockResolvedValue(undefined);
    const before = enrollmentBySource(raw, 'v6ex-leftover');
    const result = await runExpirer(db, { now: NOW_V6, sender });
    expect(result.expired).toBe(0);
    expect(sender).not.toHaveBeenCalled();
    expect(enrollmentBySource(raw, 'v6ex-leftover')).toEqual({
      id: before.id,
      status: 'cancelled',
      cancel_reason: 'booking_repair:v6ex-leftover:by:system',
    });
  });

  test('V6 失敗の行は次回 cron の修復走査で回復する (失敗注入)', async () => {
    const { db, raw } = createTestD1();
    seedBase(raw);
    seedBooking(raw, 'v6ex-stale', {
      accountId: ACCOUNT_1, friendId: 'v6ex-f1', menuId: 'v6ex-menu-1',
      staffId: 'v6ex-staff-1', startsAt: STARTS_A, requestedAt: STALE_AT, status: 'requested',
    });
    await enrollByTrigger(db, {
      triggerType: 'booking', friendId: 'v6ex-f1', startsAtIso: STARTS_A,
      sourceId: 'v6ex-stale', sourceEventId: 'v6ex-stale',
    });
    // 1回目: V6 層だけ壊す。業務は進み、V6 が残る。
    const flaky = {
      ...db,
      prepare: (sql: string) => {
        if (sql.includes('friend_reminders')) throw new Error('injected V6 failure');
        return (db as unknown as Record<string, (sql: string) => unknown>).prepare(sql);
      },
    } as unknown as D1Database;
    const sender = vi.fn().mockResolvedValue(undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const first = await runExpirer(flaky, { now: NOW_V6, sender });
      expect(first.expired).toBe(1);
      expect(raw.prepare(`SELECT status FROM bookings WHERE id = 'v6ex-stale'`).get()).toEqual({
        status: 'expired',
      });
      expect(enrollmentBySource(raw, 'v6ex-stale').status).toBe('active');

      // 2回目: 層を直して再実行。期限切れは0件だが修復走査が V6 を止める。
      const staleId = enrollmentBySource(raw, 'v6ex-stale').id;
      const second = await runExpirer(db, { now: NOW_V6, sender });
      expect(second.expired).toBe(0);
      expect(enrollmentBySource(raw, 'v6ex-stale')).toEqual({
        id: staleId,
        status: 'cancelled',
        cancel_reason: 'booking_repair:v6ex-stale:by:system',
      });
    } finally {
      error.mockRestore();
    }
  });
});
