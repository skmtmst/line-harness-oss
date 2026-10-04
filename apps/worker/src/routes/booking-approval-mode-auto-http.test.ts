/**
 * 予約のルール「お店が承認してから確定する」(approvalMode) の route 試験。
 *
 * 実 SQLite（bootstrap.sql）＋実 route/DB で通し、外部だけを置き換える。
 * - LINE idToken 検証は fetch stub
 * - 空き枠計算 getAvailability だけ mock（要求 instant と一致する候補を返す）
 * - Google 同期は未接続店舗なので skipped（外部呼び出しなし）
 * - waitUntil は noop のため、LINE 送信自体は走らない。DB に残る行を見る。
 *
 * 見ること:
 * 1. manual の店は今までどおり requested で作られる
 * 2. automatic の店は未承認を通さず confirmed＋decided_at になる
 * 3. automatic の店は確定の付随物（前日・当日のお知らせ・カレンダー台帳）がそろう
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { Env } from '../index.js';

vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: vi.fn(async () => true),
}));

const availabilityMocks = {
  getAvailability: vi.fn(),
};
vi.mock('../services/availability.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/availability.js')>()),
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

/** 2026-10-26 10:00 JST。fake now（10-20）の 6 日後。 */
const STARTS_AT = '2026-10-26T01:00:00.000Z';

function matchingSlot() {
  return {
    date: '2026-10-26',
    start: '10:00',
    end: '11:00',
    timeZone: 'Asia/Tokyo',
    startUtc: STARTS_AT,
    endUtc: '2026-10-26T02:00:00.000Z',
    capacity: 1,
    remaining: 1,
    state: 'available',
  };
}

describe('予約のルール approvalMode', () => {
  let sqlite: Database.Database;
  let db: D1Database;
  let app: Hono<Env>;
  let env: { DB: D1Database };

  function seed(approvalMode: 'automatic' | 'manual') {
    sqlite.exec(`
      INSERT INTO line_accounts
        (id, channel_id, name, channel_access_token, channel_secret, liff_id, timezone)
      VALUES ('account-am', 'channel-am', '承認店', 'token-am', 'secret-am', 'liff-am-1', 'Asia/Tokyo');
      INSERT INTO booking_settings (id, line_account_id, timezone, approval_mode)
      VALUES ('settings-am', 'account-am', 'Asia/Tokyo', '${approvalMode}');
      INSERT INTO menus (id, line_account_id, name, duration_minutes, buffer_after_minutes, base_price)
      VALUES ('menu-am', 'account-am', '相談', 60, 0, 8000);
      INSERT INTO staff (id, line_account_id, name, display_name)
      VALUES ('staff-am', 'account-am', '担当AM', '担当AM');
      INSERT INTO staff_menus (staff_id, menu_id, is_offered)
      VALUES ('staff-am', 'menu-am', 1);
      INSERT INTO friends (id, line_user_id, display_name, line_account_id, is_following)
      VALUES ('friend-am', 'U-am-1', '予約者AM', 'account-am', 1);
      INSERT INTO staff_shifts (id, staff_id, work_date, start_time, end_time)
      VALUES ('shift-oct26', 'staff-am', '2026-10-26', '09:00', '23:00');
    `);
  }

  function setup(approvalMode: 'automatic' | 'manual') {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T12:00:00.000Z'));
    vi.clearAllMocks();

    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    sqlite.exec(readFileSync(join(process.cwd(), '../../packages/db/bootstrap.sql'), 'utf8'));
    seed(approvalMode);
    db = asD1(sqlite);

    app = new Hono<Env>();
    app.use('*', async (c, next) => {
      c.set('staff', { id: 'staff-am', name: '担当AM', role: 'owner', readOnly: false });
      return next();
    });
    app.route('/', booking);
    env = { DB: db };

    availabilityMocks.getAvailability.mockResolvedValue({
      by_staff: [{ staff_id: 'staff-am', display_name: '担当AM', slots: [matchingSlot()] }],
    });

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('api.line.me/oauth2/v2.1/verify')) {
        return new Response(JSON.stringify({ sub: 'U-am-1' }), { status: 200 });
      }
      throw new Error(`想定外の外部呼び出し: ${url}`);
    }));
  }

  afterEach(() => {
    sqlite.close();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function liffCreate(key: string) {
    return app.request(
      '/api/liff/booking/requests?liffId=liff-am-1',
      {
        method: 'POST',
        body: JSON.stringify({
          menu_id: 'menu-am',
          staff_id: 'staff-am',
          starts_at: STARTS_AT,
        }),
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': key,
          Authorization: 'Bearer [REDACTED]',
        },
      },
      env,
      execCtx,
    );
  }

  function getBooking(id: string): Record<string, unknown> {
    return sqlite.prepare('SELECT * FROM bookings WHERE id = ?').get(id) as Record<string, unknown>;
  }

  test('manual の店は今までどおり requested で作られる', async () => {
    setup('manual');
    const res = await liffCreate('am-manual');
    expect(res.status).toBe(201);
    const body = (await res.json()) as { booking_id: string; status: string };
    expect(body.status).toBe('requested');
    const row = getBooking(body.booking_id);
    expect(row.status).toBe('requested');
    expect(row.decided_at).toBeNull();
  });

  test('automatic の店は未承認を通さず confirmed になる', async () => {
    setup('automatic');
    const res = await liffCreate('am-auto');
    expect(res.status).toBe(201);
    const body = (await res.json()) as { booking_id: string; status: string };
    expect(body.status).toBe('confirmed');
    const row = getBooking(body.booking_id);
    expect(row.status).toBe('confirmed');
    expect(row.decided_at).not.toBeNull();
  });

  test('automatic の店は確定の付随物がそろう', async () => {
    setup('automatic');
    const res = await liffCreate('am-auto-side');
    const body = (await res.json()) as { booking_id: string; status: string };
    // 前日・当日のお知らせの行が作られる
    const reminders = sqlite
      .prepare('SELECT COUNT(*) AS n FROM booking_reminders WHERE booking_id = ?')
      .get(body.booking_id) as { n: number };
    expect(reminders.n).toBeGreaterThan(0);
    // カレンダー同期の台帳行も積まれる（未接続なので skipped の見込み）
    const ops = sqlite
      .prepare(`SELECT COUNT(*) AS n FROM booking_operation_runs WHERE booking_id = ? AND kind = 'google_calendar'`)
      .get(body.booking_id) as { n: number };
    expect(ops.n).toBe(1);
  });
});
