import { describe, expect, test, vi } from 'vitest';
import { runEventBookingExpirer } from './event-booking-expirer.js';
import { createTestD1, insertFriend } from '../test-utils/d1-sqlite.js';
import { enrollByTrigger } from './reminder-trigger.js';

interface BookingRow {
  id: string;
  status: string;
  requested_at: string;
  decided_at: string | null;
  updated_at: string | null;
}
interface ReminderRow {
  id: string;
  booking_id: string;
  status: string;
}
interface IdemRow {
  key: string;
  expires_at: string;
}

function memDB(state: { bookings: BookingRow[]; reminders: ReminderRow[]; idem: IdemRow[] }): D1Database {
  return {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) { bound = args; return stmt; },
        async first<T>() { return null as T | null; },
        async all<T>() {
          if (sql.includes('FROM event_bookings')) {
            const [cutoff] = bound as [string];
            const items = state.bookings.filter(
              (b) => b.status === 'requested' && b.requested_at < cutoff,
            );
            return { results: items as unknown as T[] };
          }
          return { results: [] };
        },
        async run() {
          if (sql.includes('UPDATE event_bookings\n            SET status = \'expired\'')) {
            const [decided_at, _updated_at, id] = bound as [string, string, string];
            const b = state.bookings.find((x) => x.id === id && x.status === 'requested');
            if (!b) return { success: true, meta: { changes: 0 } };
            b.status = 'expired';
            b.decided_at = decided_at;
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.includes('UPDATE event_booking_reminders')) {
            const [booking_id] = bound as [string];
            let n = 0;
            for (const r of state.reminders) {
              if (r.booking_id === booking_id && (r.status === 'pending' || r.status === 'failed')) {
                r.status = 'cancelled';
                n++;
              }
            }
            return { success: true, meta: { changes: n } };
          }
          if (sql.startsWith('DELETE FROM event_booking_idempotency_keys')) {
            const [cutoff] = bound as [string];
            let n = 0;
            for (let i = state.idem.length - 1; i >= 0; i--) {
              if (state.idem[i].expires_at <= cutoff) {
                state.idem.splice(i, 1);
                n++;
              }
            }
            return { success: true, meta: { changes: n } };
          }
          return { success: true, meta: {} };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
}

describe('runEventBookingExpirer', () => {
  test('expires requested bookings older than 24h', async () => {
    const now = new Date('2026-05-09T12:00:00Z');
    const stale = '2026-05-08T11:00:00Z'; // > 24h ago
    const fresh = '2026-05-09T11:30:00Z'; // 30min ago
    const state = {
      bookings: [
        { id: 'b1', status: 'requested', requested_at: stale, decided_at: null, updated_at: null },
        { id: 'b2', status: 'requested', requested_at: fresh, decided_at: null, updated_at: null },
      ],
      reminders: [{ id: 'r1', booking_id: 'b1', status: 'pending' }],
      idem: [{ key: 'k1', expires_at: '2026-05-09T00:00:00Z' }],
    };
    const result = await runEventBookingExpirer(memDB(state), { now });
    expect(result.expired).toBe(1);
    expect(state.bookings[0].status).toBe('expired');
    expect(state.bookings[1].status).toBe('requested');
  });

  test('cancels related pending reminders', async () => {
    const now = new Date('2026-05-09T12:00:00Z');
    const state = {
      bookings: [{ id: 'b1', status: 'requested', requested_at: '2026-05-08T00:00:00Z', decided_at: null, updated_at: null }],
      reminders: [
        { id: 'r1', booking_id: 'b1', status: 'pending' },
        { id: 'r2', booking_id: 'b1', status: 'sent' },
        { id: 'r3', booking_id: 'b2', status: 'pending' },
      ],
      idem: [],
    };
    await runEventBookingExpirer(memDB(state), { now });
    expect(state.reminders[0].status).toBe('cancelled');
    expect(state.reminders[1].status).toBe('sent');
    expect(state.reminders[2].status).toBe('pending');
  });

  test('purges expired idempotency keys', async () => {
    const now = new Date('2026-05-09T12:00:00Z');
    const state = {
      bookings: [],
      reminders: [],
      idem: [
        { key: 'old', expires_at: '2026-05-08T00:00:00Z' },
        { key: 'new', expires_at: '2099-01-01T00:00:00Z' },
      ],
    };
    const result = await runEventBookingExpirer(memDB(state), { now });
    expect(result.idempotencyPurged).toBe(1);
    expect(state.idem.map((x) => x.key)).toEqual(['new']);
  });

  test('does nothing when no stale bookings', async () => {
    const now = new Date('2026-05-09T12:00:00Z');
    const state = {
      bookings: [
        { id: 'b1', status: 'confirmed', requested_at: '2026-01-01T00:00:00Z', decided_at: null, updated_at: null },
      ],
      reminders: [],
      idem: [],
    };
    const result = await runEventBookingExpirer(memDB(state), { now });
    expect(result.expired).toBe(0);
  });
});

// N-065: 期限切れも通常取消と同じく V6 の未送信予定だけを止める。
// 本物の SQLite に当て、別予約・別アカウントへ触れないことと再実行の冪等を見る。
describe('runEventBookingExpirer の V6 連動', () => {
  const ACCOUNT_1 = 'v6ev-account-1';
  const ACCOUNT_2 = 'v6ev-account-2';
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
    insertFriend(raw, 'v6ev-f1', { line_account_id: ACCOUNT_1 });
    insertFriend(raw, 'v6ev-f2', { line_account_id: ACCOUNT_2 });
    raw.prepare(
      `INSERT INTO events (id, line_account_id, name) VALUES ('v6ev-event-1', ?, '説明会')`,
    ).run(ACCOUNT_1);
    raw.prepare(
      `INSERT INTO events (id, line_account_id, name) VALUES ('v6ev-event-2', ?, '説明会')`,
    ).run(ACCOUNT_2);
    const slot = (id: string, eventId: string, startsAt: string) => {
      const endsAt = new Date(new Date(startsAt).getTime() + 3600_000).toISOString();
      raw.prepare(
        `INSERT INTO event_slots (id, event_id, starts_at, ends_at) VALUES (?, ?, ?, ?)`,
      ).run(id, eventId, startsAt, endsAt);
    };
    slot('v6ev-slot-a', 'v6ev-event-1', STARTS_A);
    slot('v6ev-slot-b', 'v6ev-event-1', STARTS_B);
    slot('v6ev-slot-c', 'v6ev-event-1', STARTS_C);
    slot('v6ev-slot-o', 'v6ev-event-2', STARTS_A);
    raw.prepare(
      `INSERT INTO reminders
         (id, name, line_account_id, is_active, trigger_type, delivery_mode, lifecycle_status)
       VALUES ('v6ev-rule-1', 'rule', ?, 1, 'event', 'countdown', 'published')`,
    ).run(ACCOUNT_1);
    raw.prepare(
      `INSERT INTO reminder_steps (id, reminder_id, offset_minutes, message_type, message_content)
       VALUES ('v6ev-step-1', 'v6ev-rule-1', -60, 'text', 'お待ちしています')`,
    ).run();
  }

  function seedEventBooking(
    raw: import('better-sqlite3').Database,
    id: string,
    input: { accountId: string; eventId: string; slotId: string; friendId: string; requestedAt: string; status: string },
  ): void {
    raw.prepare(
      `INSERT INTO event_bookings
         (id, line_account_id, event_id, slot_id, friend_id, status, requested_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, input.accountId, input.eventId, input.slotId, input.friendId, input.status, input.requestedAt);
  }

  function enrollmentBySource(raw: import('better-sqlite3').Database, sourceId: string) {
    return raw.prepare(
      `SELECT id, status, cancel_reason FROM friend_reminders WHERE source_event_id = ?`,
    ).get(sourceId) as { id: string; status: string; cancel_reason: string | null };
  }

  test('未送信だけ止め、送信済み履歴を残す。再実行は無変更', async () => {
    const { db, raw } = createTestD1();
    seedBase(raw);
    seedEventBooking(raw, 'v6ev-stale', {
      accountId: ACCOUNT_1, eventId: 'v6ev-event-1', slotId: 'v6ev-slot-a',
      friendId: 'v6ev-f1', requestedAt: STALE_AT, status: 'requested',
    });
    seedEventBooking(raw, 'v6ev-fresh', {
      accountId: ACCOUNT_1, eventId: 'v6ev-event-1', slotId: 'v6ev-slot-b',
      friendId: 'v6ev-f1', requestedAt: '2026-09-09T23:00:00.000Z', status: 'requested',
    });
    for (const [id, startsAt] of [['v6ev-stale', STARTS_A], ['v6ev-fresh', STARTS_B]] as const) {
      await enrollByTrigger(db, {
        triggerType: 'event', friendId: 'v6ev-f1', startsAtIso: startsAt,
        sourceId: id, sourceEventId: id,
      });
    }
    const staleEnrollment = enrollmentBySource(raw, 'v6ev-stale');
    raw.prepare(
      `INSERT INTO reminder_delivery_runs
         (id, line_account_id, reminder_id, friend_reminder_id, friend_id,
          reminder_step_id, scheduled_at, idempotency_key, line_retry_key,
          status, created_at, updated_at)
       VALUES ('v6ev-run-q', ?, 'v6ev-rule-1', ?, 'v6ev-f1', 'v6ev-step-1', ?, 'idem-q', 'retry-q',
               'queued', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`,
    ).run(ACCOUNT_1, staleEnrollment.id, '2026-09-20T00:00:00.000Z');
    raw.prepare(
      `INSERT INTO reminder_delivery_runs
         (id, line_account_id, reminder_id, friend_reminder_id, friend_id,
          reminder_step_id, scheduled_at, idempotency_key, line_retry_key,
          status, created_at, updated_at)
       VALUES ('v6ev-run-sent', ?, 'v6ev-rule-1', ?, 'v6ev-f1', 'v6ev-step-1', ?, 'idem-s', 'retry-s',
               'succeeded', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`,
    ).run(ACCOUNT_1, staleEnrollment.id, '2026-09-19T00:00:00.000Z');
    raw.prepare(
      `INSERT INTO event_booking_reminders (id, booking_id, kind, scheduled_at, status)
       VALUES ('v6ev-old-1', 'v6ev-stale', 'day_before', ?, 'pending')`,
    ).run(STARTS_A);

    const result = await runEventBookingExpirer(db, { now: NOW_V6 });
    expect(result.expired).toBe(1);

    expect(raw.prepare(`SELECT status FROM event_bookings WHERE id = 'v6ev-stale'`).get()).toEqual({
      status: 'expired',
    });
    expect(raw.prepare(`SELECT status FROM event_bookings WHERE id = 'v6ev-fresh'`).get()).toEqual({
      status: 'requested',
    });
    // V6 の未送信だけ止まり、送信済みが残る。
    expect(enrollmentBySource(raw, 'v6ev-stale')).toEqual({
      id: staleEnrollment.id, status: 'cancelled', cancel_reason: 'event_expired:v6ev-stale:by:system',
    });
    expect(raw.prepare(`SELECT status FROM reminder_delivery_runs WHERE id = 'v6ev-run-q'`).get()).toEqual({
      status: 'cancelled',
    });
    expect(raw.prepare(`SELECT status FROM reminder_delivery_runs WHERE id = 'v6ev-run-sent'`).get()).toEqual({
      status: 'succeeded',
    });
    expect(raw.prepare(`SELECT status FROM event_booking_reminders WHERE id = 'v6ev-old-1'`).get()).toEqual({
      status: 'cancelled',
    });
    expect(enrollmentBySource(raw, 'v6ev-fresh').status).toBe('active');

    // 再実行は期限切れ0件で何も変えない。
    const again = await runEventBookingExpirer(db, { now: NOW_V6 });
    expect(again.expired).toBe(0);
    expect(enrollmentBySource(raw, 'v6ev-stale').status).toBe('cancelled');
    expect(enrollmentBySource(raw, 'v6ev-fresh').status).toBe('active');
  });

  test('別予約・別アカウントの予定へ触れない', async () => {
    const { db, raw } = createTestD1();
    seedBase(raw);
    seedEventBooking(raw, 'v6ev-stale', {
      accountId: ACCOUNT_1, eventId: 'v6ev-event-1', slotId: 'v6ev-slot-a',
      friendId: 'v6ev-f1', requestedAt: STALE_AT, status: 'requested',
    });
    seedEventBooking(raw, 'v6ev-other-account', {
      accountId: ACCOUNT_2, eventId: 'v6ev-event-2', slotId: 'v6ev-slot-o',
      friendId: 'v6ev-f2', requestedAt: STALE_AT, status: 'requested',
    });
    seedEventBooking(raw, 'v6ev-confirmed', {
      accountId: ACCOUNT_1, eventId: 'v6ev-event-1', slotId: 'v6ev-slot-c',
      friendId: 'v6ev-f1', requestedAt: STALE_AT, status: 'confirmed',
    });
    await enrollByTrigger(db, {
      triggerType: 'event', friendId: 'v6ev-f1', startsAtIso: STARTS_A,
      sourceId: 'v6ev-stale', sourceEventId: 'v6ev-stale',
    });
    await enrollByTrigger(db, {
      triggerType: 'event', friendId: 'v6ev-f2', startsAtIso: STARTS_A,
      sourceId: 'v6ev-other-account', sourceEventId: 'v6ev-other-account',
    });
    await enrollByTrigger(db, {
      triggerType: 'event', friendId: 'v6ev-f1', startsAtIso: STARTS_C,
      sourceId: 'v6ev-confirmed', sourceEventId: 'v6ev-confirmed',
    });

    const result = await runEventBookingExpirer(db, { now: NOW_V6 });
    expect(result.expired).toBe(2);

    expect(enrollmentBySource(raw, 'v6ev-stale').cancel_reason).toBe(
      'event_expired:v6ev-stale:by:system',
    );
    expect(enrollmentBySource(raw, 'v6ev-other-account').cancel_reason).toBe(
      'event_expired:v6ev-other-account:by:system',
    );
    expect(enrollmentBySource(raw, 'v6ev-confirmed').status).toBe('active');
  });

  test('V6 連動の失敗では期限切れ自体を止めない', async () => {
    const { db, raw } = createTestD1();
    seedBase(raw);
    seedEventBooking(raw, 'v6ev-stale', {
      accountId: ACCOUNT_1, eventId: 'v6ev-event-1', slotId: 'v6ev-slot-a',
      friendId: 'v6ev-f1', requestedAt: STALE_AT, status: 'requested',
    });
    // friend_reminders を壊して V6 取消だけを失敗させる。
    raw.exec('DROP TABLE friend_reminders');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await runEventBookingExpirer(db, { now: NOW_V6 });
      expect(result.expired).toBe(1);
      expect(raw.prepare(`SELECT status FROM event_bookings WHERE id = 'v6ev-stale'`).get()).toEqual({
        status: 'expired',
      });
      expect(error).toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });

  test('期限切れ・取消ずみの取りこぼしは修復走査で止める', async () => {
    const { db, raw } = createTestD1();
    seedBase(raw);
    // 業務は終わっているのに V6 が active のまま (部分失敗・手動取消の残り)。
    seedEventBooking(raw, 'v6ev-leftover', {
      accountId: ACCOUNT_1, eventId: 'v6ev-event-1', slotId: 'v6ev-slot-a',
      friendId: 'v6ev-f1', requestedAt: STALE_AT, status: 'expired',
    });
    seedEventBooking(raw, 'v6ev-cancelled', {
      accountId: ACCOUNT_1, eventId: 'v6ev-event-1', slotId: 'v6ev-slot-b',
      friendId: 'v6ev-f1', requestedAt: STALE_AT, status: 'cancelled',
    });
    for (const [id, startsAt] of [['v6ev-leftover', STARTS_A], ['v6ev-cancelled', STARTS_B]] as const) {
      await enrollByTrigger(db, {
        triggerType: 'event', friendId: 'v6ev-f1', startsAtIso: startsAt,
        sourceId: id, sourceEventId: id,
      });
    }
    const leftoverId = enrollmentBySource(raw, 'v6ev-leftover').id;
    const cancelledId = enrollmentBySource(raw, 'v6ev-cancelled').id;

    const result = await runEventBookingExpirer(db, { now: NOW_V6 });
    expect(result.expired).toBe(0);
    expect(enrollmentBySource(raw, 'v6ev-leftover')).toEqual({
      id: leftoverId, status: 'cancelled', cancel_reason: 'event_repair:v6ev-leftover:by:system',
    });
    expect(enrollmentBySource(raw, 'v6ev-cancelled')).toEqual({
      id: cancelledId, status: 'cancelled', cancel_reason: 'event_repair:v6ev-cancelled:by:system',
    });
  });
});
