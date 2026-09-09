// ルート試験: 候補の `startUtc` が欠落・不正なとき、LIFF と管理の両方が
// 予約を作らないこと（fail-closed）を見る。
//
// 実 SQLite（bootstrap.sql）へ NY 店舗を作り、route と DB は本物のまま通す。
// 空き枠計算だけを置き換える。壊れた候補は実 DB からは作れないため
//（availability は必ず offset 付き instant を組み立てる）、
// 「壊れた候補が返ってきたとき route がどうするか」はここでしか見られない。
//
// 候補の暦日と壁時刻（date / start）は要求と一致させてある。
// つまり壁時刻で照合する実装なら通ってしまう配置で、`startUtc` を見て
// 断っていることだけを取り出している。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { Env } from '../index.js';

vi.mock('../services/booking-notifier.js', () => ({
  sendBookingNotification: vi.fn(async () => ({ ok: true })),
}));
vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: vi.fn(async () => true),
}));

/** 空き枠計算だけを置き換える。timezone の解決は本物（booking_settings を読む）。 */
const availabilityMocks = {
  getAvailability: vi.fn(),
};
vi.mock('../services/availability.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../services/availability.js')>(),
  ...availabilityMocks,
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
/** NY 2026-11-02（EST, UTC-5）の 10:00。要求する instant。 */
const NY_NOV2_1000 = '2026-11-02T15:00:00.000Z';

/** 壁時刻は要求と同じで、開始 instant だけが壊れている候補を作る。 */
function slotWithStartUtc(startUtc: unknown) {
  return {
    date: '2026-11-02',
    start: '10:00',
    end: '11:00',
    timeZone: NY,
    startUtc,
    endUtc: '2026-11-02T11:00:00-05:00',
    capacity: 1,
    remaining: 1,
    state: 'available',
  };
}

/**
 * 司令塔が挙げた「欠落・不正値」の並び。
 * 3 つめは Idempotency-Key に使う札。ヘッダーは ASCII しか通らない。
 */
const BROKEN_START_UTC: Array<[string, unknown, string]> = [
  ['欠落（キーが無い）', undefined, 'missing'],
  ['null', null, 'null'],
  ['空文字', '', 'empty'],
  ['空白だけ', '   ', 'blank'],
  ['日付として読めない文字列', 'not-a-date', 'unparsable'],
  // 要求と同じ瞬間を数値で書いたもの。文字列かどうかを見ずに
  // `new Date(...)` へ渡す実装だと、これだけが一致してしまう。
  ['同じ瞬間を表す数値', 1_793_631_600_000, 'number'],
  ['オブジェクト', { iso: NY_NOV2_1000 }, 'object'],
];

describe('候補の startUtc が欠落・不正なら予約を作らない（実DB・NY店舗）', () => {
  let sqlite: Database.Database;
  let db: D1Database;
  let app: Hono<Env>;
  let env: { DB: D1Database };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T12:00:00.000Z'));
    vi.clearAllMocks();

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
      VALUES ('menu-ny', 'account-ny', '相談', 60, 0, 8000);
      INSERT INTO staff (id, line_account_id, name, display_name)
      VALUES ('staff-ny', 'account-ny', '担当NY', '担当NY');
      INSERT INTO staff_menus (staff_id, menu_id, is_offered)
      VALUES ('staff-ny', 'menu-ny', 1);
      INSERT INTO friends (id, line_user_id, display_name, line_account_id, is_following)
      VALUES ('friend-ny', 'U-ny-1', '予約者NY', 'account-ny', 1);
      INSERT INTO staff_shifts (id, staff_id, work_date, start_time, end_time)
      VALUES ('shift-nov2', 'staff-ny', '2026-11-02', '09:00', '23:00');
    `);
    db = asD1(sqlite);

    app = new Hono<Env>();
    app.use('*', async (c, next) => {
      c.set('staff', { id: 'staff-ny', name: '担当NY', role: 'owner', readOnly: false });
      return next();
    });
    app.route('/', booking);
    env = { DB: db };

    // LIFF の id_token 検証だけ通す。ほかの外部呼び出しは落とす。
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('api.line.me/oauth2/v2.1/verify')) {
        return new Response(JSON.stringify({ sub: 'U-ny-1' }), { status: 200 });
      }
      throw new Error(`想定外の外部呼び出し: ${url}`);
    }));
  });

  afterEach(() => {
    sqlite.close();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** 空き枠計算が返す候補を固定する。 */
  function respondWithSlot(startUtc: unknown) {
    const slot = slotWithStartUtc(startUtc);
    if (startUtc === undefined) delete (slot as Record<string, unknown>).startUtc;
    availabilityMocks.getAvailability.mockResolvedValue({
      by_staff: [{ staff_id: 'staff-ny', display_name: '担当NY', slots: [slot] }],
    });
  }

  function adminCreate(key: string) {
    return app.request(
      '/api/booking/admin/bookings?account_id=account-ny',
      {
        method: 'POST',
        body: JSON.stringify({
          friend_id: 'friend-ny',
          menu_id: 'menu-ny',
          staff_id: 'staff-ny',
          starts_at: NY_NOV2_1000,
          send_line_confirmation: false,
        }),
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      },
      env,
      execCtx,
    );
  }

  function liffCreate(key: string) {
    return app.request(
      '/api/liff/booking/requests?liffId=liff-ny-1',
      {
        method: 'POST',
        body: JSON.stringify({
          menu_id: 'menu-ny',
          staff_id: 'staff-ny',
          starts_at: NY_NOV2_1000,
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

  function bookingCount(): number {
    return (sqlite.prepare(`SELECT COUNT(*) AS n FROM bookings`).get() as { n: number }).n;
  }

  test.each(BROKEN_START_UTC)('管理: startUtc が %s なら 409 で作らない', async (_label, value, key) => {
    respondWithSlot(value);
    const res = await adminCreate(`admin-broken-${key}`);
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: 'slot_not_available' });
    expect(bookingCount()).toBe(0);
  });

  test.each(BROKEN_START_UTC)('LIFF: startUtc が %s なら 422 で作らない', async (_label, value, key) => {
    respondWithSlot(value);
    const res = await liffCreate(`liff-broken-${key}`);
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({ error: 'slot_not_available' });
    expect(bookingCount()).toBe(0);
  });

  test('管理: 同じ配置でも startUtc が正しければ作る（断りすぎていない）', async () => {
    respondWithSlot('2026-11-02T10:00:00-05:00');
    const res = await adminCreate('admin-valid-1');
    expect(res.status).toBe(201);
    expect(bookingCount()).toBe(1);
  });

  test('LIFF: 同じ配置でも startUtc が正しければ作る（断りすぎていない）', async () => {
    respondWithSlot('2026-11-02T10:00:00-05:00');
    const res = await liffCreate('liff-valid-1');
    expect(res.status).toBe(201);
    expect(bookingCount()).toBe(1);
  });
});
