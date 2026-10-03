/**
 * F6 core（本人LIFF日時変更・取消）の局所mock試験。
 *
 * 実 SQLite（bootstrap.sql）＋実 route/DB で通し、外部だけを置き換える。
 * - LINE idToken 検証は fetch stub（sub を切替可能）
 * - 空き枠計算 getAvailability だけ mock（他は本物）
 * - 送信 sendBookingNotification は mock（実送信0）
 * - Google 同期 runBookingGoogleSync は既定で skipped の mock。
 *   実 runner 結合は別 test で real に戻し、provider（fetch の googleapis）だけを
 *   有限失敗→成功させる
 * - 自動通知の許可 bookingAutomaticNotificationAllowed は mock で true
 * - 管理者 fixture 用 app と本人リクエスト用 app を分ける。
 *   本人 app には staff を設定しない（公開認証経路の証拠）
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

const notifierMocks = { sendBookingNotification: vi.fn() };
vi.mock('../services/booking-notifier.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/booking-notifier.js')>()),
  ...notifierMocks,
}));
vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: vi.fn(async () => true),
}));

const availabilityMocks = { getAvailability: vi.fn() };
vi.mock('../services/availability.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/availability.js')>()),
  ...availabilityMocks,
}));

const calendarState: { real?: (...args: never[]) => Promise<unknown> } = {};
const calendarSyncMocks = { runBookingGoogleSync: vi.fn() };
vi.mock('../services/booking-calendar-sync.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../services/booking-calendar-sync.js')>();
  calendarState.real = orig.runBookingGoogleSync as unknown as typeof calendarState.real;
  return {
    ...orig,
    runBookingGoogleSync: (...args: Parameters<typeof orig.runBookingGoogleSync>) =>
      calendarSyncMocks.runBookingGoogleSync(...args),
  };
});

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

const meetState: {
  realRegister?: (...args: never[]) => Promise<unknown>;
  realCancel?: (...args: never[]) => Promise<unknown>;
} = {};
const meetGate: { hook: (() => Promise<void>) | null } = { hook: null };
const meetCtl: { failCancelOnce: boolean } = { failCancelOnce: false };
vi.mock('../services/meet-consultation-reminders.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../services/meet-consultation-reminders.js')>();
  meetState.realRegister = orig.registerMeetConsultation as unknown as typeof meetState.realRegister;
  meetState.realCancel = orig.cancelMeetConsultation as unknown as typeof meetState.realCancel;
  return {
    ...orig,
    registerMeetConsultation: async (...args: Parameters<typeof orig.registerMeetConsultation>) => {
      if (meetGate.hook) await meetGate.hook();
      return (meetState.realRegister as (...a: unknown[]) => Promise<unknown>)(...args);
    },
    cancelMeetConsultation: async (...args: Parameters<typeof orig.cancelMeetConsultation>) => {
      if (meetCtl.failCancelOnce) {
        meetCtl.failCancelOnce = false;
        throw new Error('COMPENSATION_INJECTED_FAILURE');
      }
      return (meetState.realCancel as (...a: unknown[]) => Promise<unknown>)(...args);
    },
  };
});

vi.mock('../services/booking-channels.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/booking-channels.js')>()),
  bookingAutomaticNotificationAllowed: vi.fn(async () => true),
}));
vi.mock('../services/feature-enforcement.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/feature-enforcement.js')>()),
  featureJobCanRun: vi.fn(async () => true),
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

let waited: Array<Promise<unknown>> = [];
const execCtx = {
  waitUntil: (promise: Promise<unknown>) => {
    waited.push(Promise.resolve(promise));
  },
  passThroughOnException: () => undefined,
} as unknown as ExecutionContext;

async function drainWaits() {
  const pending = waited;
  waited = [];
  await Promise.all(pending);
}

/** 送信は mock 受信側で見る。fetch へ出た物はすべて記録する。 */
let fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
let googleFailCreate = 0;

function mockFetch() {
  fetchCalls = [];
  googleFailCreate = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('api.line.me/oauth2/v2.1/verify')) {
      return new Response(JSON.stringify({ sub: lineSub }), { status: 200 });
    }
    if (url.includes('www.googleapis.com/calendar/v3')) {
      fetchCalls.push({ url, init });
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'DELETE') return new Response(null, { status: 204 });
      if (method === 'POST' && url.endsWith('/events')) {
        if (googleFailCreate > 0) {
          googleFailCreate -= 1;
          return new Response('provider error', { status: 500 });
        }
        const body = JSON.parse(String(init?.body ?? '{}')) as { id?: string };
        return new Response(JSON.stringify({ id: body.id ?? 'evt-new' }), { status: 200 });
      }
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    }
    fetchCalls.push({ url, init });
    throw new Error(`想定外の外部呼び出し: ${url}`);
  }));
}

function headerOf(init?: RequestInit, name?: string): string | null {
  if (!init?.headers || !name) return null;
  if (typeof (init.headers as Headers).get === 'function') {
    return (init.headers as Headers).get(name);
  }
  const record = init.headers as Record<string, string>;
  const key = Object.keys(record).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? record[key] : null;
}

/** 自動送信の fetch に manual 印が無いこと。 */
function expectNoManualHeader() {
  for (const call of fetchCalls) {
    expect(headerOf(call.init, 'X-Line-Harness-Source')).toBeNull();
  }
}

/** provider（googleapis）への外部呼出し回数。 */
function googleCallCount() {
  return fetchCalls.filter((call) => call.url.includes('www.googleapis.com')).length;
}

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
  let adminApp: Hono<Env>;
  let selfApp: Hono<Env>;
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
    meetGate.hook = null;
    notifierMocks.sendBookingNotification.mockResolvedValue(undefined);
    calendarSyncMocks.runBookingGoogleSync.mockImplementation(async () => 'skipped');
    meetCtl.failCancelOnce = false;

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

    // 管理者 fixture 用は staff あり。本人リクエスト用は staff 無し。
    // staff 無しで本人操作が通ることが、公開認証経路（authMiddleware が
    // /api/liff/ を外す＋idToken 検証）の証拠になる。
    adminApp = new Hono<Env>();
    adminApp.use('*', async (c, next) => {
      c.set('staff', { id: 'staff-ny', name: '担当NY', role: 'owner', readOnly: false });
      return next();
    });
    adminApp.route('/', booking);
    selfApp = new Hono<Env>();
    selfApp.route('/', booking);
    env = { DB: db };

    // LIFF の id_token 検証と Google provider だけ通す。ほかは落とす。
    mockFetch();
  });

  afterEach(() => {
    sqlite.close();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function adminCreate(menuId: string, startsAt: string, key: string): Promise<string> {
    const res = await adminApp.request(
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
    return selfApp.request(
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
    // waitUntil を回収し、mock 受信と stub 記録の範囲で自動送信に manual 印が
    // 無いことを見る（実LINE推送の確認ではない）。
    await drainWaits();
    expect(notifierMocks.sendBookingNotification).toHaveBeenCalledTimes(1);
    const sent = notifierMocks.sendBookingNotification.mock.calls[0][0] as Record<string, unknown>;
    expect(JSON.stringify(sent)).not.toContain('manual');
    expectNoManualHeader();
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
    const res = await selfApp.request(
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

  function linkCalendar() {
    sqlite.prepare(
      `INSERT INTO google_calendar_connections
         (id, calendar_id, line_account_id, staff_id, access_token, auth_type, is_active)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
    ).run('conn-1', 'cal-1', 'account-ny', 'staff-ny', 'tok-test', 'oauth');
  }

  function useRealGoogleRunner() {
    calendarSyncMocks.runBookingGoogleSync.mockImplementation((...args: never[]) =>
      (calendarState.real as (...a: never[]) => Promise<unknown>)(...args),
    );
  }

  function linkMeet(bookingId: string, eventId = 'evt-1') {
    sqlite.prepare('UPDATE bookings SET external_event_id = ? WHERE id = ?')
      .run(eventId, bookingId);
    sqlite.prepare(
      `INSERT INTO meet_consultations
         (id, external_event_id, friend_id, title, starts_at, ends_at, meet_url, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed')`,
    ).run(
      'consult-1', eventId, 'friend-self', '個別相談',
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
    // 前日・1時間前の予定が新日時に組み直される。
    const reminders = sqlite.prepare(
      'SELECT kind, scheduled_at, status FROM meet_consultation_reminders WHERE consultation_id = ? ORDER BY kind',
    ).all('consult-1') as Array<{ kind: string; scheduled_at: string; status: string }>;
    expect(reminders).toEqual([
      { kind: 'day_before', scheduled_at: '2026-11-01T16:00:00.000Z', status: 'pending' },
      { kind: 'hour_before', scheduled_at: '2026-11-02T15:00:00.000Z', status: 'pending' },
    ]);
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

  test('実runner結合: provider有限失敗→同日時再送で回復（台帳1行・重複0）', async () => {
    useRealGoogleRunner();
    linkCalendar();
    mockSlots([D11, D12]);
    const id = await adminCreate('menu-ok', T1, 'rs-real');
    const createdCalls = googleCallCount();
    googleFailCreate = 1;
    const first = await selfPost(`/api/liff/booking/${id}/reschedule`, {
      starts_at: T2, lock_version: 0,
    });
    expect(first.status).toBe(200);
    expect((await first.json<Record<string, unknown>>()).calendar_sync).toBe('failed');
    expect(bookingRow(id).external_event_id).toBeNull();
    // 失敗時は delete＋create の2回だけ外部へ出る。
    expect(googleCallCount() - createdCalls).toBe(2);
    const replay = await selfPost(`/api/liff/booking/${id}/reschedule`, {
      starts_at: T2, lock_version: 1,
    });
    expect(replay.status).toBe(200);
    const body = await replay.json<Record<string, unknown>>();
    expect(body.changed).toBe(false);
    expect(body.calendar_sync).toBe('synced');
    const evt = bookingRow(id).external_event_id as string;
    expect(evt).toMatch(/^lh/);
    // 回復の再送は create の1回だけ外部へ出る。
    expect(googleCallCount() - createdCalls).toBe(3);
    // 版ごとの冪等キーで台帳は2行（作成v0・変更v1）。v1行は成功で閉じる。
    const calOps = sqlite.prepare(
      "SELECT idempotency_key, status FROM booking_operation_runs WHERE booking_id = ? AND kind = 'google_calendar' ORDER BY created_at",
    ).all(id) as Array<{ idempotency_key: string; status: string }>;
    expect(calOps.length).toBe(2);
    expect(new Set(calOps.map((op) => op.idempotency_key)).size).toBe(2);
    expect(calOps[1].status).toBe('succeeded');
    // 通知は初回だけ、予定の重複なし。
    const notices = sqlite.prepare(
      "SELECT COUNT(*) AS n FROM booking_operation_runs WHERE booking_id = ? AND kind = 'confirmation_line'",
    ).get(id) as { n: number };
    expect(notices.n).toBe(1);
    const pending = sqlite.prepare(
      "SELECT kind, scheduled_at FROM booking_reminders WHERE booking_id = ? AND status = 'pending' ORDER BY kind",
    ).all(id) as Array<{ kind: string; scheduled_at: string }>;
    expect(pending.length).toBe(2);
    expect(new Set(pending.map((r) => `${r.kind}@${r.scheduled_at}`)).size).toBe(2);
    await drainWaits();
    expectNoManualHeader();
  });

  test('成功ずみ同日時再送は外部呼出し0（guard）', async () => {
    useRealGoogleRunner();
    linkCalendar();
    mockSlots([D11, D12]);
    const id = await adminCreate('menu-ok', T1, 'rs-guard');
    const createdCalls = googleCallCount();
    const first = await selfPost(`/api/liff/booking/${id}/reschedule`, {
      starts_at: T2, lock_version: 0,
    });
    expect(first.status).toBe(200);
    expect((await first.json<Record<string, unknown>>()).calendar_sync).toBe('synced');
    const evt = bookingRow(id).external_event_id as string;
    // 作成時1回＋変更時 delete/create 2回。
    expect(googleCallCount() - createdCalls).toBe(2);
    const replay = await selfPost(`/api/liff/booking/${id}/reschedule`, {
      starts_at: T2, lock_version: 1,
    });
    expect(replay.status).toBe(200);
    const body = await replay.json<Record<string, unknown>>();
    expect(body.changed).toBe(false);
    expect(body.calendar_sync).toBe('synced');
    // 成功ずみ再送は外部へ出ない。予定IDも採番し直さない。台帳も増えない。
    expect(googleCallCount() - createdCalls).toBe(2);
    expect(bookingRow(id).external_event_id).toBe(evt);
    const ops = sqlite.prepare(
      'SELECT COUNT(*) AS n FROM booking_operation_runs WHERE booking_id = ? AND kind = ?',
    ).get(id, 'google_calendar') as { n: number };
    expect(ops.n).toBe(2);
  });

  test('予定作り直しでは同一相談を新eventへ登録し直す（URL継続・両reminder）', async () => {
    useRealGoogleRunner();
    linkCalendar();
    mockSlots([D11, D12]);
    const id = await adminCreate('menu-ok', T1, 'rs-recreate');
    linkMeet(id, 'evt-old');
    const res = await selfPost(`/api/liff/booking/${id}/reschedule`, {
      starts_at: T2, lock_version: 0,
    });
    expect(res.status).toBe(200);
    expect((await res.json<Record<string, unknown>>()).meet_sync).toBe('recreated');
    const newEvt = bookingRow(id).external_event_id as string;
    expect(newEvt).not.toBe('evt-old');
    // 古い相談は止まり、新予定ID・本人・新日時・同じ Meet URL で登録される。
    const old = sqlite.prepare(
      'SELECT status FROM meet_consultations WHERE external_event_id = ?',
    ).get('evt-old') as { status: string };
    expect(old.status).toBe('cancelled');
    const next = sqlite.prepare(
      'SELECT * FROM meet_consultations WHERE external_event_id = ?',
    ).get(newEvt) as Record<string, unknown>;
    expect(next.status).toBe('confirmed');
    expect(next.friend_id).toBe('friend-self');
    expect(next.starts_at).toBe(T2);
    expect(next.meet_url).toBe('https://meet.google.com/aaa-bbbb-ccc');
    const reminders = sqlite.prepare(
      'SELECT kind, scheduled_at, status FROM meet_consultation_reminders WHERE consultation_id = ? ORDER BY kind',
    ).all(next.id) as Array<{ kind: string; scheduled_at: string; status: string }>;
    expect(reminders).toEqual([
      { kind: 'day_before', scheduled_at: '2026-11-01T16:00:00.000Z', status: 'pending' },
      { kind: 'hour_before', scheduled_at: '2026-11-02T15:00:00.000Z', status: 'pending' },
    ]);
  });

  test('register直前の取消は書込み後に補償され、相談は復活しない', async () => {
    mockSlots([D11, D12]);
    const id = await adminCreate('menu-ok', T1, 'race-meet');
    linkMeet(id);
    // register の直前で取消を完走させる有限barrier。
    meetGate.hook = async () => {
      meetGate.hook = null;
      const cancelRes = await selfPost(`/api/liff/booking/${id}/cancel`, { lock_version: 1 });
      expect(cancelRes.status).toBe(200);
    };
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('race timeout')), 15000);
    });
    const res = await Promise.race([
      selfPost(`/api/liff/booking/${id}/reschedule`, { starts_at: T2, lock_version: 0 }),
      timeout,
    ]);
    expect(res.status).toBe(200);
    // 予約の変更は成立したが、間に勝った取消をMeetが覆さない。
    expect((await res.json<Record<string, unknown>>()).meet_sync).toBe('superseded');
    expect(bookingRow(id).status).toBe('cancelled');
    const consults = sqlite.prepare(
      'SELECT status FROM meet_consultations',
    ).all() as Array<{ status: string }>;
    expect(consults.every((c) => c.status === 'cancelled')).toBe(true);
    const pending = sqlite.prepare(
      "SELECT COUNT(*) AS n FROM meet_consultation_reminders WHERE status IN ('pending','failed')",
    ).get() as { n: number };
    expect(pending.n).toBe(0);
    await drainWaits();
  });

  test('先行失敗のrollbackは後発成功の取消を巻き戻さない', async () => {
    mockSlots([D11]);
    const id = await adminCreate('menu-ok', T1, 'race-rollback');
    let enteredFlag = false;
    let gateResolve: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { gateResolve = resolve; });
    let calls = 0;
    triggerMocks.cancelByTrigger.mockImplementation(async (...args: unknown[]) => {
      calls += 1;
      if (calls === 1) {
        enteredFlag = true;
        await gate;
        throw new Error('REMINDER_SEND_IN_FLIGHT');
      }
      return (triggerState.real as (...a: unknown[]) => Promise<unknown>)(...args);
    });
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('race timeout')), 15000);
    });
    const aPromise = selfPost(`/api/liff/booking/${id}/cancel`, { lock_version: 0 });
    for (let i = 0; i < 200; i++) {
      if (enteredFlag) break;
      await new Promise((r) => setTimeout(r, 10));
      if (i === 199) throw new Error('cancelByTrigger に到達しませんでした');
    }
    // 後発が先に成功する。時刻は Frozen のまま（同msでも所有権で区別する）。
    const b = await Promise.race([
      selfPost(`/api/liff/booking/${id}/cancel`, { lock_version: 0 }),
      timeout,
    ]);
    expect(b.status).toBe(200);
    const decidedAfterB = (bookingRow(id) as Record<string, unknown>).decided_at;
    // 先行の rollback は後発の decided_at を消さない。
    gateResolve();
    const a = await Promise.race([aPromise, timeout]);
    expect(a.status).toBe(409);
    expect(bookingRow(id).status).toBe('cancelled');
    expect((bookingRow(id) as Record<string, unknown>).decided_at).toBe(decidedAfterB);
  });

  test('補償の失敗は隠さず、取消再送で回収できる', async () => {
    mockSlots([D11, D12]);
    const id = await adminCreate('menu-ok', T1, 'race-comp-fail');
    linkMeet(id);
    // register 直前で取消を完走させ、直後の補償だけ失敗させる。
    meetGate.hook = async () => {
      meetGate.hook = null;
      const cancelRes = await selfPost(`/api/liff/booking/${id}/cancel`, { lock_version: 1 });
      expect(cancelRes.status).toBe(200);
      meetCtl.failCancelOnce = true;
    };
    const res = await selfPost(`/api/liff/booking/${id}/reschedule`, {
      starts_at: T2, lock_version: 0,
    });
    expect(res.status).toBe(200);
    expect((await res.json<Record<string, unknown>>()).meet_sync).toBe('failed');
    // 失敗は正直に残る（復活したまま）。監査に記録される。
    const consult = sqlite.prepare(
      'SELECT status FROM meet_consultations WHERE id = ?',
    ).get('consult-1') as { status: string };
    expect(consult.status).toBe('confirmed');
    const audit = sqlite.prepare(
      "SELECT COUNT(*) AS n FROM booking_audit_logs WHERE booking_id = ? AND action = 'meet_sync_failed'",
    ).get(id) as { n: number };
    expect(audit.n).toBe(1);
    // 取消再送が回収口になる。
    const retry = await selfPost(`/api/liff/booking/${id}/cancel`, { lock_version: 1 });
    expect(retry.status).toBe(200);
    const healed = sqlite.prepare(
      'SELECT status FROM meet_consultations WHERE id = ?',
    ).get('consult-1') as { status: string };
    expect(healed.status).toBe('cancelled');
    await drainWaits();
  });

  test('取消ずみ予約の相談はdue送信の対象外（可視フェンス＋spy send0）', async () => {
    const { processDueMeetConsultationReminders } = await import(
      '../services/meet-consultation-reminders.js'
    );
    mockSlots([D11, D12]);
    const deadId = await adminCreate('menu-ok', T1, 'due-dead');
    linkMeet(deadId, 'evt-dead');
    // 復活 window を再現：予約だけ取消ずみ、相談は confirmed のまま。
    sqlite.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(deadId);
    sqlite.prepare(
      `UPDATE meet_consultations SET starts_at = ?, ends_at = ? WHERE external_event_id = ?`,
    ).run('2026-10-21T00:00:00.000Z', '2026-10-21T01:00:00.000Z', 'evt-dead');
    sqlite.prepare(
      `UPDATE meet_consultation_reminders SET scheduled_at = ? WHERE consultation_id = ?`,
    ).run('2026-10-20T11:00:00.000Z', 'consult-1');
    // 対照：有効な予約の相談は送られる。
    const liveId = await adminCreate('menu-ok', T1, 'due-live');
    sqlite.prepare('UPDATE bookings SET external_event_id = ? WHERE id = ?').run('evt-live', liveId);
    sqlite.prepare(
      `INSERT INTO meet_consultations
         (id, external_event_id, friend_id, title, starts_at, ends_at, meet_url, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed')`,
    ).run(
      'consult-2', 'evt-live', 'friend-other', '対照相談',
      '2026-10-21T00:00:00.000Z', '2026-10-21T01:00:00.000Z', 'https://meet.google.com/aaa-bbbb-ccc',
    );
    sqlite.prepare(
      `INSERT INTO meet_consultation_reminders
         (id, consultation_id, kind, scheduled_at, status)
       VALUES (?, ?, ?, ?, 'pending')`,
    ).run('mr-live', 'consult-2', 'hour_before', '2026-10-20T11:00:00.000Z');
    const sent: Request[] = [];
    const dispatch = vi.fn(async (request: Request) => {
      sent.push(request);
      return new Response('{}', { status: 200 });
    });
    const result = await processDueMeetConsultationReminders(db, {
      now: new Date('2026-10-20T12:00:00.000Z'),
      proxyBaseUrl: 'https://proxy.example.com',
      proxyDispatch: dispatch,
    });
    expect(result.sent).toBe(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
    const body = await sent[0].json() as { to: string };
    expect(body.to).toBe('U-other-1');
    expect(sent[0].headers.get('x-line-harness-source')).toBeNull();
    // 取消ずみ側は送られず、pending のまま残る（回収は取消再送の役目）。
    const dead = sqlite.prepare(
      "SELECT COUNT(*) AS n FROM meet_consultation_reminders WHERE consultation_id = ? AND status IN ('pending','failed')",
    ).get('consult-1') as { n: number };
    expect(dead.n).toBe(2);
  });

  test('変更対取消の交差は片方だけ通り、敗者は副作用を残さない', async () => {
    mockSlots([D11, D12]);
    const id = await adminCreate('menu-ok', T1, 'race-1');
    linkMeet(id);
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('race timeout')), 15000);
    });
    const [a, b] = await Promise.race([
      Promise.all([
        selfPost(`/api/liff/booking/${id}/reschedule`, { starts_at: T2, lock_version: 0 }),
        selfPost(`/api/liff/booking/${id}/cancel`, { lock_version: 0 }),
      ]),
      timeout,
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    await drainWaits();
    const row = bookingRow(id);
    if (row.status === 'cancelled') {
      expect(row.starts_at).toBe(T1);
    } else {
      expect(row.starts_at).toBe(T2);
    }
    // Meet 相談は増えない。通知も最大1件。
    const consults = sqlite.prepare('SELECT COUNT(*) AS n FROM meet_consultations').get() as { n: number };
    expect(consults.n).toBe(1);
    const notices = sqlite.prepare(
      "SELECT COUNT(*) AS n FROM booking_operation_runs WHERE booking_id = ? AND kind = 'confirmation_line'",
    ).get(id) as { n: number };
    expect(notices.n).toBeLessThanOrEqual(1);
    expectNoManualHeader();
  });

  test('取消対取消再送の交差は確定を壊さず、カレンダー台帳は1行', async () => {
    mockSlots([D11]);
    const id = await adminCreate('menu-ok', T1, 'race-2');
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('race timeout')), 15000);
    });
    const [a, b] = await Promise.race([
      Promise.all([
        selfPost(`/api/liff/booking/${id}/cancel`, { lock_version: 0 }),
        selfPost(`/api/liff/booking/${id}/cancel`, { lock_version: 0 }),
      ]),
      timeout,
    ]);
    // 勝者は200。敗者は再送200か送信フェンス409。どちらも確定を壊さない。
    const sorted = [a.status, b.status].sort();
    expect([JSON.stringify([200, 200]), JSON.stringify([200, 409])]).toContain(JSON.stringify(sorted));
    for (const res of [a, b]) {
      if (res.status === 409) {
        expect((await res.json<{ error: string }>()).error).toBe('send_in_flight_retry');
      }
    }
    const retry = await selfPost(`/api/liff/booking/${id}/cancel`, { lock_version: 0 });
    expect(retry.status).toBe(200);
    expect(bookingRow(id).status).toBe('cancelled');
    // 削除の安定キーは1行に集約される（作成時sync鍵と削除鍵の2鍵・各1行）。
    const calOps = sqlite.prepare(
      'SELECT idempotency_key, COUNT(*) AS n FROM booking_operation_runs WHERE booking_id = ? AND kind = ? GROUP BY idempotency_key',
    ).all(id, 'google_calendar') as Array<{ idempotency_key: string; n: number }>;
    expect(calOps.length).toBe(2);
    expect(calOps.every((op) => op.n === 1)).toBe(true);
  });
});
