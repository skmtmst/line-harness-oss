// 直接E2E: 実 SQLite に対する予約作成 HTTP（LIFF / 管理）を、
// 非JST店舗（America/New_York）で通す。
//
// 空き枠計算（availability）は置き換えない。route → getAvailability → SQL →
// 実DB まで通した上で、確定直前の照合が「要求 instant と、いま計算し直した
// 候補の startUtc の完全一致」であることを確かめる。
//
// ここで見張る崩れ方（#651 の司令塔再現）:
//   - NY の壁時刻 10:00 を +09:00 で読んだ instant を送ると、営業時間外・
//     休業例外・既存予約を迂回して予約が入る（偽装 instant）。
//   - 夏時間の終わる日は壁時刻 01:30 が2回ある。壁時刻で照合すると、
//     候補に出ていない方の 01:30 が通る。
//   - UTC より遅れた店舗の夜（現地 21:00 = 翌 02:00Z）の予約が、既存予約の
//     取得範囲から落ちて空き枠に見える。
//   - 担当の Google カレンダーの予定（busy）が枠計算へ届かず、外の予定と
//     重なる時間に予約が入る。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { Env } from '../index.js';

// 送る側（LINE 通知・自動化）は、この試験の対象ではない。
vi.mock('../services/booking-notifier.js', () => ({
  sendBookingNotification: vi.fn(async () => ({ ok: true })),
}));
vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: vi.fn(async () => true),
}));

const { default: booking } = await import('./booking.js');

/**
 * better-sqlite3 を D1 の口に合わせる。
 *
 * D1 は `?` と `?1` を同じ順番の値の並びで受ける。better-sqlite3 は
 * `?1` を「名前付き」と数えるため、並びで渡すと "Too many parameter
 * values" になる。並びで通らなかったときだけ 1 始まりの名前へ組み替える。
 */
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
/** NY 2026-11-02（EST, UTC-5）の 10:00。 */
const NY_NOV2_1000 = '2026-11-02T15:00:00.000Z';
/** 同じ壁時刻を +09:00 の店舗として読んだ instant（偽装）。 */
const FAKE_JST_NOV2_1000 = '2026-11-02T01:00:00.000Z';
/** NY 2026-11-02（EST）の 14:00。Google の予定と重なる時間。 */
const NY_NOV2_1400 = '2026-11-02T19:00:00.000Z';

describe('非JST店舗の予約作成 HTTP E2E（実DB・America/New_York）', () => {
  let sqlite: Database.Database;
  let db: D1Database;
  let app: Hono<Env>;
  let env: { DB: D1Database };

  beforeEach(() => {
    // 夏時間の日付を固定で書くため、時計も固定する。固定しないと
    // 「過去日時」で 422 になる時限式の試験になる。
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T12:00:00.000Z'));

    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    sqlite.exec(readFileSync(join(process.cwd(), '../../packages/db/bootstrap.sql'), 'utf8'));
    sqlite.exec(`
      INSERT INTO line_accounts
        (id, channel_id, name, channel_access_token, channel_secret, liff_id, timezone)
      VALUES ('account-ny', 'channel-ny', 'NY店', 'token-ny', 'secret-ny', 'liff-ny-1', '${NY}');
      INSERT INTO booking_settings (id, line_account_id, timezone)
      VALUES ('settings-ny', 'account-ny', '${NY}');
      INSERT INTO menus (id, line_account_id, name, duration_minutes, buffer_after_minutes, base_price)
      VALUES
        ('menu-ny', 'account-ny', '相談', 60, 0, 8000),
        ('menu-other', 'account-ny', '別施術', 60, 0, 5000);
      INSERT INTO staff (id, line_account_id, name, display_name)
      VALUES ('staff-ny', 'account-ny', '担当NY', '担当NY');
      INSERT INTO staff_menus (staff_id, menu_id, is_offered)
      VALUES ('staff-ny', 'menu-ny', 1), ('staff-ny', 'menu-other', 1);
      INSERT INTO friends (id, line_user_id, display_name, line_account_id, is_following)
      VALUES ('friend-ny', 'U-ny-1', '予約者NY', 'account-ny', 1);
      INSERT INTO staff_shifts (id, staff_id, work_date, start_time, end_time)
      VALUES
        ('shift-nov2', 'staff-ny', '2026-11-02', '09:00', '23:00'),
        ('shift-nov1', 'staff-ny', '2026-11-01', '01:00', '03:00');
    `);
    db = asD1(sqlite);

    app = new Hono<Env>();
    app.use('*', async (c, next) => {
      // bookings.created_by_staff_id は staff(id) を参照する。実在の担当を使う。
      c.set('staff', { id: 'staff-ny', name: '担当NY', role: 'owner', readOnly: false });
      return next();
    });
    app.route('/', booking);
    env = { DB: db };
  });

  afterEach(() => {
    sqlite.close();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function adminCreate(startsAt: string, key: string) {
    return app.request(
      '/api/booking/admin/bookings?account_id=account-ny',
      {
        method: 'POST',
        body: JSON.stringify({
          friend_id: 'friend-ny',
          menu_id: 'menu-ny',
          staff_id: 'staff-ny',
          starts_at: startsAt,
          send_line_confirmation: false,
        }),
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      },
      env,
      execCtx,
    );
  }

  /**
   * 外の窓口だけを固定する。DB もルートも本物のまま。
   *
   * - LINE の id_token 検証（LIFF の認証）
   * - Google Calendar の freeBusy（担当の外の予定）
   * - Google Calendar の events 作成（確定後の書き出し）
   *
   * 想定外の外部呼び出しは落とす。実際の Google/LINE を叩かない。
   */
  function stubExternal(busy: Array<{ start: string; end: string }> = []) {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('api.line.me/oauth2/v2.1/verify')) {
        return new Response(JSON.stringify({ sub: 'U-ny-1' }), { status: 200 });
      }
      if (url.includes('googleapis.com/calendar/v3/freeBusy')) {
        return new Response(JSON.stringify({ calendars: { 'cal-ny': { busy } } }), { status: 200 });
      }
      if (url.includes('googleapis.com/calendar/v3/calendars/')) {
        return new Response(JSON.stringify({ id: 'gcal-event-1' }), { status: 200 });
      }
      throw new Error(`想定外の外部呼び出し: ${url}`);
    }));
  }

  /**
   * 担当の Google カレンダー接続を実 DB へ作る。
   *
   * `getStaffGoogleBusy` はこの行が無いと null を返して外の予定を見ない。
   * 行があってはじめて freeBusy を引きに行くので、Google busy の回帰は
   * この行を実 DB に入れたうえでルートを通す必要がある。
   * auth_type = 'oauth' なら access_token をそのまま使う（署名の窓口を挟まない）。
   */
  function insertGoogleConnection() {
    sqlite.exec(`
      INSERT INTO google_calendar_connections
        (id, calendar_id, line_account_id, staff_id, access_token, auth_type, is_active)
      VALUES ('gcal-ny', 'cal-ny', 'account-ny', 'staff-ny', 'token-gcal', 'oauth', 1);
    `);
  }

  function liffCreate(startsAt: string, key: string) {
    return app.request(
      '/api/liff/booking/requests?liffId=liff-ny-1',
      {
        method: 'POST',
        body: JSON.stringify({
          menu_id: 'menu-ny',
          staff_id: 'staff-ny',
          starts_at: startsAt,
        }),
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': key,
          Authorization: 'Bearer dummy-id-token',
        },
      },
      env,
      execCtx,
    );
  }

  function bookingRows() {
    return sqlite.prepare(`SELECT id, starts_at, status FROM bookings ORDER BY starts_at`).all() as
      Array<{ id: string; starts_at: string; status: string }>;
  }

  test('管理: NY 10:00 の正規 instant で予約が入る', async () => {
    const res = await adminCreate(NY_NOV2_1000, 'ny-ok-1');
    expect(res.status).toBe(201);
    expect(bookingRows()).toEqual([
      expect.objectContaining({ starts_at: NY_NOV2_1000, status: 'confirmed' }),
    ]);
  });

  test('管理: 壁時刻を +09:00 で読んだ偽装 instant は営業時間外として断る', async () => {
    // 2026-11-02T01:00Z は NY では 11/01 20:00。この日の勤務は 01:00-03:00 で、
    // 20:00 の枠は無い。壁時刻 10:00 の照合ではここが素通りしていた。
    const res = await adminCreate(FAKE_JST_NOV2_1000, 'ny-fake-1');
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: 'slot_not_available' });
    expect(bookingRows()).toEqual([]);
  });

  test('管理: fold 日は候補に出ていない方の 01:30 を断る', async () => {
    // 11/01 の NY は 01:30 が2回ある。候補になるのは EDT の 01:30
    //（05:30Z）だけ。EST の 01:30（06:30Z）は壁時刻が同じでも別の瞬間。
    const available = await app.request(
      '/api/booking/admin/availability?account_id=account-ny&menu_id=menu-ny'
        + '&staff_id=staff-ny&from=2026-11-01&to=2026-11-01',
      {},
      env,
      execCtx,
    );
    const body = await available.json() as {
      by_staff: Array<{ slots: Array<{ start: string; startUtc: string }> }>;
    };
    const offered = body.by_staff[0].slots.filter((slot) => slot.start === '01:30');
    expect(offered).toHaveLength(1);
    expect(new Date(offered[0].startUtc).toISOString()).toBe('2026-11-01T05:30:00.000Z');

    const res = await adminCreate('2026-11-01T06:30:00.000Z', 'ny-fold-1');
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: 'slot_not_available' });
    expect(bookingRows()).toEqual([]);
  });

  test('管理: 店舗休業の例外日は正規 instant でも断る', async () => {
    sqlite.exec(`
      INSERT INTO booking_availability_exceptions
        (id, line_account_id, scope_kind, date_from, date_to, kind, hours_json, reason)
      VALUES ('exc-ny-1', 'account-ny', 'store', '2026-11-02', '2026-11-02', 'closed', '[]', '棚卸');
    `);
    const res = await adminCreate(NY_NOV2_1000, 'ny-closed-1');
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: 'slot_not_available' });
    expect(bookingRows()).toEqual([]);
  });

  test('管理: 現地の夜（翌日 02:00Z）に入っている予約の枠は、空きにも出ず確定もしない', async () => {
    // NY 11/02 21:00 は 11/03 02:00Z。暦日を UTC で切ると既存予約の取得範囲
    // から落ちて、空き枠として出ていた（#651 の夜間二重予約）。
    sqlite.exec(`
      INSERT INTO bookings
        (id, line_account_id, friend_id, staff_id, menu_id, starts_at, ends_at,
         block_ends_at, status, price_at_booking, requested_at)
      VALUES ('booking-night', 'account-ny', 'friend-ny', 'staff-ny', 'menu-other',
              '2026-11-03T02:00:00.000Z', '2026-11-03T03:00:00.000Z',
              '2026-11-03T03:00:00.000Z', 'confirmed', 5000, '2026-10-01T00:00:00.000Z');
    `);
    const available = await app.request(
      '/api/booking/admin/availability?account_id=account-ny&menu_id=menu-ny'
        + '&staff_id=staff-ny&from=2026-11-02&to=2026-11-02',
      {},
      env,
      execCtx,
    );
    const body = await available.json() as {
      by_staff: Array<{ slots: Array<{ start: string }> }>;
    };
    expect(body.by_staff[0].slots.map((slot) => slot.start)).not.toContain('21:00');

    const res = await adminCreate('2026-11-03T02:00:00.000Z', 'ny-night-1');
    expect(res.status).toBe(409);
    expect(bookingRows().filter((row) => row.id !== 'booking-night')).toEqual([]);
  });

  test('管理: 担当の Google の予定と重なる枠は、空きにも出ず確定もしない', async () => {
    // 接続は実 DB へ作る。行が無いと getStaffGoogleBusy は null を返し、
    // 外の予定を一切見ない（＝この回帰が空振りになる）。
    insertGoogleConnection();
    // NY 11/02 14:00-15:00（EST）に外の予定。19:00Z-20:00Z。
    stubExternal([{ start: '2026-11-02T19:00:00.000Z', end: '2026-11-02T20:00:00.000Z' }]);

    const available = await app.request(
      '/api/booking/admin/availability?account_id=account-ny&menu_id=menu-ny'
        + '&staff_id=staff-ny&from=2026-11-02&to=2026-11-02',
      {},
      env,
      execCtx,
    );
    const body = await available.json() as {
      by_staff: Array<{ slots: Array<{ start: string }> }>;
    };
    const starts = body.by_staff[0].slots.map((slot) => slot.start);
    // 60 分の枠が 14:00-15:00 と重なるのは 13:30 / 14:00 / 14:30。
    expect(starts).not.toContain('13:30');
    expect(starts).not.toContain('14:00');
    expect(starts).not.toContain('14:30');
    // 外の予定と重ならない時間は残る（全部塞いだのではない）。
    expect(starts).toContain('10:00');
    expect(starts).toContain('13:00');

    const blocked = await adminCreate(NY_NOV2_1400, 'ny-gcal-blocked-1');
    expect(blocked.status).toBe(409);
    await expect(blocked.json()).resolves.toMatchObject({ error: 'slot_not_available' });
    expect(bookingRows()).toEqual([]);

    // 同じ日の空いている時間は通る。
    const ok = await adminCreate(NY_NOV2_1000, 'ny-gcal-ok-1');
    expect(ok.status).toBe(201);
    expect(bookingRows()).toEqual([
      expect.objectContaining({ starts_at: NY_NOV2_1000, status: 'confirmed' }),
    ]);
  });

  test('LIFF: 担当の Google の予定と重なる instant を断る', async () => {
    insertGoogleConnection();
    stubExternal([{ start: '2026-11-02T19:00:00.000Z', end: '2026-11-02T20:00:00.000Z' }]);

    const blocked = await liffCreate(NY_NOV2_1400, 'ny-liff-gcal-1');
    expect(blocked.status).toBe(422);
    await expect(blocked.json()).resolves.toEqual({ error: 'slot_not_available' });
    expect(bookingRows()).toEqual([]);

    const ok = await liffCreate(NY_NOV2_1000, 'ny-liff-gcal-ok-1');
    expect(ok.status).toBe(201);
    expect(bookingRows()).toEqual([
      expect.objectContaining({ starts_at: NY_NOV2_1000, status: 'requested' }),
    ]);
  });

  test('LIFF: NY 10:00 の正規 instant で申込みが入り、偽装 instant は断る', async () => {
    stubExternal();
    const ok = await liffCreate(NY_NOV2_1000, 'ny-liff-ok-1');
    expect(ok.status).toBe(201);
    expect(bookingRows()).toEqual([
      expect.objectContaining({ starts_at: NY_NOV2_1000, status: 'requested' }),
    ]);

    const fake = await liffCreate(FAKE_JST_NOV2_1000, 'ny-liff-fake-1');
    expect(fake.status).toBe(422);
    await expect(fake.json()).resolves.toEqual({ error: 'slot_not_available' });
    expect(bookingRows()).toHaveLength(1);
  });
});
