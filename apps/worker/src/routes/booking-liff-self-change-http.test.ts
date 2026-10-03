/**
 * F6 core（本人LIFF日時変更・取消）の局所mock試験。
 *
 * 実 SQLite（bootstrap.sql）＋実 route/DB で通し、外部だけを置き換える。
 * - LINE idToken 検証は fetch stub（sub を切替可能）
 * - 空き枠計算 getAvailability だけ mock（他は本物）
 * - 送信 sendBookingNotification は mock（実送信0）
 * - Google 同期 runBookingGoogleSync は既定 real、失敗系だけ mock で retry_wait
 * - 自動通知の許可 bookingAutomaticNotificationAllowed は mock で true
 *
 * 見ること: 本人/越境/期限/CAS/空き/再送冪等/Meet取消/通知（manual印なし）。
 * 待ち列は扱わない。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { Env } from '../index.js';

vi.mock('../services/booking-notifier.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/booking-notifier.js')>()),
  sendBookingNotification: vi.fn(async () => undefined),
}));
vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: vi.fn(async () => true),
}));

const availabilityMocks = { getAvailability: vi.fn() };
vi.mock('../services/availability.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/availability.js')>()),
  ...availabilityMocks,
}));

const calendarSyncMocks = { runBookingGoogleSync: vi.fn() };
vi.mock('../services/booking-calendar-sync.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/booking-calendar-sync.js')>()),
  ...calendarSyncMocks,
}));

const triggerState: { real?: (...args: never[]) => Promise<unknown> } = {};
const triggerMocks = { cancelByTrigger: vi.fn() };
vi.mock('../services/reminder-trigger.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../services/reminder-trigger.js')>();
  triggerState.real = orig.cancelByTrigger as unknown as typeof triggerState.real;
  return {
    ...orig,
    cancelByTrigger: (...args: Parameters<typeof orig.cancelByTrigger>) =>
      triggerMocks.cancelByTrigger(...args),
  };
});

vi.mock('../services/booking-channels.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/booking-channels.js')>()),
  bookingAutomaticNotificationAllowed: vi.fn(async () => true),
}));

const { default: booking } = await import('./booking.js');

function asD1(sqlite: Database.Database): D1Database {
  function call<T>(run: (...args: unknown[]) => T, params: unknown[]): T {
    try {
      return run(...params);
    } catch (error) {
      if (!/parameter/i.test(String((error as Error)?.message))) throw error;
      return run(Object.fromEntries(params.map((value, index) => [String(index + 1), value])));
    }
  }
  const db = {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      const bound = (params: unknown[]): D1PreparedStatement => ({
        bind: (...next: unknown[]) => bound(next),
        all: async <T>() => ({
          success: true,
          results: call((...a) => statement.all(...a), params) as T[],
          meta: {},
        }),
        first: async <T>() => (call((...a) => statement.get(...a), params) as T | undefined) ?? null,
        run: async <T>() => {
          const changes = statement.reader
            ? (call((...a) => statement.all(...a), params) as unknown[]).length
            : call((...a) => statement.run(...a), params).changes;
          return { success: true, results: [], meta: { changes } } as T;
        },
        raw: async () => [],
      } as unknown as D1PreparedStatement);
      return bound([]);
    },
    async batch(statements: D1PreparedStatement[]) {
      const out = [];
      for (const statement of statements) out.push(await statement.run());
      return out;
    },
  };
  return db as unknown as D1Database;
}

const execCtx = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
} as unknown as ExecutionContext;

const NY = 'America/New_York';
/** 基準時 2026-10-20T12:00Z。menu-ok の期限1h・締切1h。 */
const T1 = '2026-11-02T15:00:00.000Z';
const T2 = '2026-11-02T16:00:00.000Z';
const T3 = '2026-11-02T17:00:00.000Z';
/** 基準時の12時間後。menu-strict（期限48h）の内側。 */
const T_SOON = '2026-10-21T00:00:00.000Z';

let lineSub = 'U-self-1';

function slotAt(startUtc: string, date: string, start: string, end: string) {
  return {
    date, start, end, timeZone: NY, startUtc,
    endUtc: startUtc, capacity: 1, remaining: 1, state: 'available',
  };
}

function mockSlots(entries: Array<{ iso: string; date: string; start: string; end: string }>) {
  availabilityMocks.getAvailability.mockResolvedValue({
    by_staff: [{
      staff_id: 'staff-ny', display_name: '担当NY',
      slots: entries.map((e) => slotAt(e.iso, e.date, e.start, e.end)),
    }],
  });
}

const D11 = { iso: T1, date: '2026-11-02', start: '10:00', end: '11:00' };
const D12 = { iso: T2, date: '2026-11-02', start: '11:00', end: '12:00' };
const D13 = { iso: T3, date: '2026-11-02', start: '12:00', end: '13:00' };
const DSOON = { iso: T_SOON, date: '2026-10-20', start: '19:00', end: '20:00' };

describe('F6 本人日時変更・取消（mock局所）', () => {
  let sqlite: Database.Database;
  let db: D1Database;
  let app: Hono<Env>;
  let env: { DB: D1Database };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T12:00:00.000Z'));
    vi.clearAllMocks();
    lineSub = 'U-self-1';
    calendarSyncMocks.runBookingGoogleSync.mockImplementation(async () => 'skipped');
    triggerMocks.cancelByTrigger.mockImplementation((...args: unknown[]) =>
      (triggerState.real as (...a: unknown[]) => Promise<unknown>)(...args),
    );

    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    sqlite.exec(readFileSync(join(process.cwd(), '../../packages/db/bootstrap.sql'), 'utf8'));
    sqlite.exec(`
      INSERT INTO line_accounts
        (id, channel_id, name, channel_access_token, channel_secret, liff_id, timezone)
      VALUES
        ('account-ny', 'channel-ny', 'NY店', 'token-ny', 'secret-ny', 'liff-ny-1', '${NY}'),
        ('account-b', 'channel-b', 'B店', 'token-b', 'secret-b', 'liff-b-1', '${NY}');
      INSERT INTO booking_settings (id, line_account_id, timezone)
      VALUES ('settings-ny', 'account-ny', '${NY}'), ('settings-b', 'account-b', '${NY}');
      INSERT INTO menus
        (id, line_account_id, name, duration_minutes, buffer_after_minutes, base_price,
         cancel_deadline_hours_before, cutoff_hours_before)
      VALUES
        ('menu-ok', 'account-ny', '相談', 60, 0, 8000, 1, 1),
        ('menu-strict', 'account-ny', '厳格相談', 60, 0, 8000, 48, 1);
      INSERT INTO staff (id, line_account_id, name, display_name)
      VALUES ('staff-ny', 'account-ny', '担当NY', '担当NY');
      INSERT INTO staff_menus (staff_id, menu_id, is_offered)
      VALUES ('staff-ny', 'menu-ok', 1), ('staff-ny', 'menu-strict', 1);
      INSERT INTO friends (id, line_user_id, display_name, line_account_id, is_following)
      VALUES
        ('friend-self', 'U-self-1', '本人', 'account-ny', 1),
        ('friend-other', 'U-other-1', '他人', 'account-ny', 1),
        ('friend-b', 'U-b-1', '本人B', 'account-b', 1);
    `);
    db = asD1(sqlite);

    app = new Hono<Env>();
    app.use('*', async (c, next) => {
      c.set('staff', { id: 'staff-ny', name: '担当NY', role: 'owner', readOnly: false });
      return next();
    });
    app.route('/', booking);
    env = { DB: db };

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('api.line.me/oauth2/v2.1/verify')) {
        return new Response(JSON.stringify({ sub: lineSub }), { status: 200 });
      }
      throw new Error(`想定外の外部呼び出し: ${url}`);
    }));
  });

  afterEach(() => {
    sqlite.close();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function adminCreate(menuId: string, startsAt: string, key: string): Promise<string> {
    const res = await app.request(
      '/api/booking/admin/bookings?account_id=account-ny',
      {
        method: 'POST',
        body: JSON.stringify({
          friend_id: 'friend-self', menu_id: menuId, staff_id: 'staff-ny',
          starts_at: startsAt, send_line_confirmation: false,
        }),
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      },
      env,
      execCtx,
    );
    expect(res.status).toBe(201);
    const body = await res.json<{ booking_id: string }>();
    return body.booking_id;
  }

  function selfPost(path: string, body: unknown, liff = 'liff-ny-1') {
    return app.request(
      `${path}?liffId=${liff}`,
      {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-id-token' },
      },
      env,
      execCtx,
    );
  }

  function bookingRow(id: string) {
    return sqlite.prepare('SELECT * FROM bookings WHERE id = ?').get(id) as Record<string, unknown>;
  }

  test('日時変更が成立し、版が進み、変更通知が自動で積まれる（manual印なし）', async () => {
    mockSlots([D11, D12]);
    const id = await adminCreate('menu-ok', T1, 'rs-ok');
    const res = await selfPost(`/api/liff/booking/${id}/reschedule`, {
      starts_at: T2, lock_version: 0,
    });
    expect(res.status).toBe(200);
    const body = await res.json<Record<string, unknown>>();
    expect(body.lock_version).toBe(1);
    expect(body.meet_sync).toBe('not_linked');
    expect(body.change_notification).toBe('queued');
    expect(bookingRow(id).starts_at).toBe(T2);
    const ops = sqlite.prepare(
      "SELECT kind, result_json FROM booking_operation_runs WHERE booking_id = ?",
    ).all(id) as Array<{ kind: string; result_json: string }>;
    const notice = ops.find((op) => op.kind === 'confirmation_line');
    expect(notice).toBeDefined();
    expect(notice!.result_json).toContain('changed');
    expect(notice!.result_json).not.toContain('manual');
  });

  test('別人の予約・別店舗の予約は404で見せない', async () => {
    mockSlots([D11, D12]);
    const id = await adminCreate('menu-ok', T1, 'rs-cross');
    lineSub = 'U-other-1';
    const other = await selfPost(`/api/liff/booking/${id}/reschedule`, {
      starts_at: T2, lock_version: 0,
    });
    expect(other.status).toBe(404);
    lineSub = 'U-self-1';
    const cross = await selfPost(`/api/liff/booking/${id}/reschedule`, {
      starts_at: T2, lock_version: 0,
    }, 'liff-b-1');
    expect(cross.status).toBe(404);
    expect(bookingRow(id).starts_at).toBe(T1);
  });

  test('idTokenが無ければ401', async () => {
    const res = await app.request(
      '/api/liff/booking/xxx/reschedule?liffId=liff-ny-1',
      {
        method: 'POST',
        body: JSON.stringify({ starts_at: T2, lock_version: 0 }),
        headers: { 'Content-Type': 'application/json' },
      },
      env,
      execCtx,
    );
    expect(res.status).toBe(401);
  });

  test('期限を過ぎた予約の変更は403', async () => {
    mockSlots([DSOON, D11]);
    const id = await adminCreate('menu-strict', T_SOON, 'rs-deadline');
    const res = await selfPost(`/api/liff/booking/${id}/reschedule`, {
      starts_at: T1, lock_version: 0,
    });
    expect(res.status).toBe(403);
    expect((await res.json<{ error: string }>()).error).toBe('self_deadline_passed');
  });

  test('古い版での変更は409（CAS）', async () => {
    mockSlots([D11, D12, D13]);
    const id = await adminCreate('menu-ok', T1, 'rs-cas');
    const first = await selfPost(`/api/liff/booking/${id}/reschedule`, {
      starts_at: T2, lock_version: 0,
    });
    expect(first.status).toBe(200);
    const stale = await selfPost(`/api/liff/booking/${id}/reschedule`, {
      starts_at: T3, lock_version: 0,
    });
    expect(stale.status).toBe(409);
    expect(bookingRow(id).starts_at).toBe(T2);
  });

  test('同じ日時の再送は200で二重更新しない（冪等）', async () => {
    mockSlots([D11, D12]);
    const id = await adminCreate('menu-ok', T1, 'rs-replay');
    const first = await selfPost(`/api/liff/booking/${id}/reschedule`, {
      starts_at: T2, lock_version: 0,
    });
    expect(first.status).toBe(200);
    const replay = await selfPost(`/api/liff/booking/${id}/reschedule`, {
      starts_at: T2, lock_version: 1,
    });
    expect(replay.status).toBe(200);
    const body = await replay.json<Record<string, unknown>>();
    expect(body.changed).toBe(false);
    expect(body.lock_version).toBe(1);
  });

  test('空きが無ければ409（監視表示ではなく空き正本で判定）', async () => {
    mockSlots([D11]);
    const id = await adminCreate('menu-ok', T1, 'rs-noslot');
    availabilityMocks.getAvailability.mockResolvedValue({ by_staff: [] });
    const res = await selfPost(`/api/liff/booking/${id}/reschedule`, {
      starts_at: T2, lock_version: 0,
    });
    expect(res.status).toBe(409);
  });

  test('Google失敗はcalendar_sync=failedで残し、予約は成立のまま', async () => {
    mockSlots([D11, D12]);
    calendarSyncMocks.runBookingGoogleSync.mockResolvedValue('retry_wait');
    const id = await adminCreate('menu-ok', T1, 'rs-gfail');
    const res = await selfPost(`/api/liff/booking/${id}/reschedule`, {
      starts_at: T2, lock_version: 0,
    });
    expect(res.status).toBe(200);
    const body = await res.json<Record<string, unknown>>();
    expect(body.calendar_sync).toBe('failed');
    expect(bookingRow(id).starts_at).toBe(T2);
  });

  function linkMeet(bookingId: string) {
    sqlite.prepare('UPDATE bookings SET external_event_id = ? WHERE id = ?')
      .run('evt-1', bookingId);
    sqlite.prepare(
      `INSERT INTO meet_consultations
         (id, external_event_id, friend_id, title, starts_at, ends_at, meet_url, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed')`,
    ).run(
      'consult-1', 'evt-1', 'friend-self', '個別相談',
      T1, '2026-11-02T16:00:00.000Z', 'https://meet.google.com/aaa-bbbb-ccc',
    );
    sqlite.prepare(
      `INSERT INTO meet_consultation_reminders
         (id, consultation_id, kind, scheduled_at, status)
       VALUES (?, ?, ?, ?, 'pending'), (?, ?, ?, ?, 'pending')`,
    ).run(
      'mr-day', 'consult-1', 'day_before', '2026-11-01T15:00:00.000Z',
      'mr-hour', 'consult-1', 'hour_before', '2026-11-02T14:00:00.000Z',
    );
  }

  test('取消が成立し、予約・旧予定・Meetが止まり、カレンダー削除が台帳に残る', async () => {
    mockSlots([D11, D12]);
    const id = await adminCreate('menu-ok', T1, 'cx-ok');
    linkMeet(id);
    const res = await selfPost(`/api/liff/booking/${id}/cancel`, { lock_version: 0 });
    expect(res.status).toBe(200);
    const body = await res.json<Record<string, unknown>>();
    expect(body.status).toBe('cancelled');
    expect(body.meet_sync).toBe('cancelled');
    expect(bookingRow(id).status).toBe('cancelled');
    const pending = sqlite.prepare(
      "SELECT COUNT(*) AS n FROM booking_reminders WHERE booking_id = ? AND status IN ('pending','failed')",
    ).get(id) as { n: number };
    expect(pending.n).toBe(0);
    const consult = sqlite.prepare(
      'SELECT status FROM meet_consultations WHERE id = ?',
    ).get('consult-1') as { status: string };
    expect(consult.status).toBe('cancelled');
    const meetPending = sqlite.prepare(
      "SELECT COUNT(*) AS n FROM meet_consultation_reminders WHERE consultation_id = ? AND status IN ('pending','failed')",
    ).get('consult-1') as { n: number };
    expect(meetPending.n).toBe(0);
    const calOps = sqlite.prepare(
      "SELECT status FROM booking_operation_runs WHERE booking_id = ? AND kind = 'google_calendar'",
    ).all(id) as Array<{ status: string }>;
    expect(calOps.length).toBeGreaterThan(0);
  });

  test('結び付きの無い取消はmeet_sync=not_linked（作らない）', async () => {
    mockSlots([D11]);
    const id = await adminCreate('menu-ok', T1, 'cx-nolink');
    const res = await selfPost(`/api/liff/booking/${id}/cancel`, { lock_version: 0 });
    expect(res.status).toBe(200);
    expect((await res.json<Record<string, unknown>>()).meet_sync).toBe('not_linked');
    expect((sqlite.prepare('SELECT COUNT(*) AS n FROM meet_consultations').get() as { n: number }).n).toBe(0);
  });

  test('取消ずみの再送は200で副作用をそろえる（冪等）', async () => {
    mockSlots([D11]);
    const id = await adminCreate('menu-ok', T1, 'cx-retry');
    const first = await selfPost(`/api/liff/booking/${id}/cancel`, { lock_version: 0 });
    expect(first.status).toBe(200);
    const retry = await selfPost(`/api/liff/booking/${id}/cancel`, { lock_version: 0 });
    expect(retry.status).toBe(200);
    expect((await retry.json<Record<string, unknown>>()).retried).toBe(true);
  });

  test('期限を過ぎた予約の取消は403、版違いは409', async () => {
    mockSlots([DSOON]);
    const id = await adminCreate('menu-strict', T_SOON, 'cx-deadline');
    const denied = await selfPost(`/api/liff/booking/${id}/cancel`, { lock_version: 0 });
    expect(denied.status).toBe(403);
    mockSlots([D11]);
    const id2 = await adminCreate('menu-ok', T1, 'cx-ver');
    const conflict = await selfPost(`/api/liff/booking/${id2}/cancel`, { lock_version: 9 });
    expect(conflict.status).toBe(409);
    expect(bookingRow(id2).status).not.toBe('cancelled');
  });

  test('Meetに結び付く予約の日時変更は相談の日時も移す', async () => {
    mockSlots([D11, D12]);
    const id = await adminCreate('menu-ok', T1, 'rs-meet');
    linkMeet(id);
    const res = await selfPost(`/api/liff/booking/${id}/reschedule`, {
      starts_at: T2, lock_version: 0,
    });
    expect(res.status).toBe(200);
    expect((await res.json<Record<string, unknown>>()).meet_sync).toBe('updated');
    const consult = sqlite.prepare(
      'SELECT starts_at, status FROM meet_consultations WHERE id = ?',
    ).get('consult-1') as { starts_at: string; status: string };
    expect(consult.starts_at).toBe(T2);
    expect(consult.status).toBe('confirmed');
  });

  test('送信中の取消再送は409で、副作用は未実施のまま残る', async () => {
    mockSlots([D11]);
    const id = await adminCreate('menu-ok', T1, 'cx-inflight');
    const first = await selfPost(`/api/liff/booking/${id}/cancel`, { lock_version: 0 });
    expect(first.status).toBe(200);
    triggerMocks.cancelByTrigger.mockRejectedValueOnce(
      new Error('REMINDER_SEND_IN_FLIGHT'),
    );
    const retry = await selfPost(`/api/liff/booking/${id}/cancel`, { lock_version: 0 });
    expect(retry.status).toBe(409);
    expect((await retry.json<{ error: string }>()).error).toBe('send_in_flight_retry');
    // 取消ずみのまま。未実施を適用対象外にしない（再送で回復できる）。
    expect(bookingRow(id).status).toBe('cancelled');
  });

  test('送信中の初回取消は409で確定を取り消す（version/state契約）', async () => {
    mockSlots([D11]);
    const id = await adminCreate('menu-ok', T1, 'cx-inflight-first');
    triggerMocks.cancelByTrigger.mockRejectedValueOnce(
      new Error('REMINDER_SEND_IN_FLIGHT'),
    );
    const res = await selfPost(`/api/liff/booking/${id}/cancel`, { lock_version: 0 });
    expect(res.status).toBe(409);
    // rollback: 状態は確定前（confirmed）のまま、版も進んでいない。
    expect(bookingRow(id).status).toBe('confirmed');
    expect(bookingRow(id).lock_version).toBe(0);
    // 送信が終われば同じ版で取消できる。
    const retry = await selfPost(`/api/liff/booking/${id}/cancel`, { lock_version: 0 });
    expect(retry.status).toBe(200);
  });

  test('失敗後の同日時再送はCalendarを回復し、二重通知を作らない', async () => {
    mockSlots([D11, D12]);
    calendarSyncMocks.runBookingGoogleSync.mockResolvedValueOnce('retry_wait');
    const id = await adminCreate('menu-ok', T1, 'rs-recover');
    const first = await selfPost(`/api/liff/booking/${id}/reschedule`, {
      starts_at: T2, lock_version: 0,
    });
    expect(first.status).toBe(200);
    expect((await first.json<Record<string, unknown>>()).calendar_sync).toBe('failed');
    calendarSyncMocks.runBookingGoogleSync.mockResolvedValue('succeeded');
    const replay = await selfPost(`/api/liff/booking/${id}/reschedule`, {
      starts_at: T2, lock_version: 1,
    });
    expect(replay.status).toBe(200);
    const body = await replay.json<Record<string, unknown>>();
    expect(body.changed).toBe(false);
    expect(body.calendar_sync).toBe('synced');
    // 通知は初回だけ。再送で二重に積まない。
    const notices = sqlite.prepare(
      "SELECT COUNT(*) AS n FROM booking_operation_runs WHERE booking_id = ? AND kind = 'confirmation_line'",
    ).get(id) as { n: number };
    expect(notices.n).toBe(1);
  });

  test('取消ずみの予約への古い日時変更は409', async () => {
    mockSlots([D11]);
    const id = await adminCreate('menu-ok', T1, 'rs-after-cancel');
    const cancelled = await selfPost(`/api/liff/booking/${id}/cancel`, { lock_version: 0 });
    expect(cancelled.status).toBe(200);
    const res = await selfPost(`/api/liff/booking/${id}/reschedule`, {
      starts_at: T2, lock_version: 0,
    });
    expect(res.status).toBe(409);
  });
});
