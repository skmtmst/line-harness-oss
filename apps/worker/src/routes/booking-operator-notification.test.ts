/*
 * N-327 #663: 予約の受付から運用者通知が自動発火することを、実 SQLite と
 * 実ルートで見張る。
 *
 * ここで止めたい崩れ方:
 *   1. 予約は成立したのに運用者通知が出ない(接続が外れる・条件が狭すぎる)。
 *   2. 同じ予約から通知インスタンスが二重に作られる。
 *   3. 通知が落ちたときに予約まで失敗する(副作用が本体を巻き込む)。
 *   4. 別アカウントの予約が、こちらのアカウントの通知として出る。
 *   5. 予約が成立しなかったとき(枠競合・権限なし)にも通知が出る。
 *
 * 発火は waitUntil の中なので、ExecutionContext は渡された Promise を集めて
 * 明示的に待つ。投げっぱなしにすると「出ていない」のか「まだ走っていない」
 * のか見分けられない。
 *
 * 通知の中身(誰へどの経路で送るか)は
 * services/operator-notification-dispatch.test.ts が実 DB で見ている。
 * ここは「予約という業務イベントから、正しい引数で1回だけ入るか」に絞る。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { Env } from '../index.js';

const dispatchOperatorEvent = vi.hoisted(() => vi.fn());
vi.mock('../services/operator-notification-dispatch.js', () => ({ dispatchOperatorEvent }));
// 送る側(顧客への LINE 通知)は対象外。予約の成否と運用者通知だけを見る。
vi.mock('../services/booking-notifier.js', () => ({
  sendBookingNotification: vi.fn(async () => ({ ok: true })),
}));
vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: vi.fn(async () => true),
}));

const { default: booking } = await import('./booking.js');

/** better-sqlite3 を D1 の口へ。`?` と `?1` の両方の並びを受ける。 */
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

/**
 * waitUntil に渡された Promise を集めて、明示的に待てるようにする。
 *
 * 拒否は握り潰さず `settle()` の戻りで返す。allSettled で飲み込むと
 * 「副作用が自分で後始末しているか」を見張れなくなり、.catch を外しても
 * 緑のままになる。本番の Worker では waitUntil の中の未処理拒否が
 * そのまま実行の失敗として残るので、ここでも表に出す。
 */
function collectingExecCtx() {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => { pending.push(promise); },
    passThroughOnException: () => undefined,
  } as unknown as ExecutionContext;
  return {
    ctx,
    /** @returns waitUntil の外まで漏れた拒否の理由。空なら誰も漏らしていない。 */
    async settle(): Promise<unknown[]> {
      const escaped: unknown[] = [];
      // waitUntil の中でさらに waitUntil が積まれても取りこぼさない。
      while (pending.length > 0) {
        const results = await Promise.allSettled(pending.splice(0));
        for (const result of results) {
          if (result.status === 'rejected') escaped.push(result.reason);
        }
      }
      return escaped;
    },
  };
}

const ACCOUNT = 'account-a';
const OTHER_ACCOUNT = 'account-b';
/** JST 2026-11-02(月) 11:00 = 02:00Z。下のシフト 10:00-19:00 の中。 */
const SLOT_UTC = '2026-11-02T02:00:00.000Z';

describe('N-327 #663 予約の受付から運用者通知を自動発火する', () => {
  let sqlite: Database.Database;
  let app: Hono<Env>;
  let env: { DB: D1Database };

  beforeEach(() => {
    // 「過去日時」で 422 になる時限式の試験にしないため時計を固定する。
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T03:00:00.000Z'));
    dispatchOperatorEvent.mockReset();
    dispatchOperatorEvent.mockResolvedValue(undefined);

    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    sqlite.exec(readFileSync(join(process.cwd(), '../../packages/db/bootstrap.sql'), 'utf8'));
    sqlite.exec(`
      INSERT INTO line_accounts
        (id, channel_id, name, channel_access_token, channel_secret, liff_id, timezone)
      VALUES
        ('${ACCOUNT}', 'channel-a', 'A店', 'token-a', 'secret-a', 'liff-a-1', 'Asia/Tokyo'),
        ('${OTHER_ACCOUNT}', 'channel-b', 'B店', 'token-b', 'secret-b', 'liff-b-1', 'Asia/Tokyo');
      INSERT INTO booking_settings (id, line_account_id, timezone)
      VALUES ('settings-a', '${ACCOUNT}', 'Asia/Tokyo'),
             ('settings-b', '${OTHER_ACCOUNT}', 'Asia/Tokyo');

      INSERT INTO staff (id, line_account_id, name, display_name)
      VALUES ('staff-a', '${ACCOUNT}', '担当A', '担当A'),
             ('staff-b', '${OTHER_ACCOUNT}', '担当B', '担当B');
      INSERT INTO friends (id, line_user_id, display_name, line_account_id, is_following)
      VALUES ('friend-a', 'U-a-1', '予約者A', '${ACCOUNT}', 1),
             ('friend-b', 'U-b-1', '予約者B', '${OTHER_ACCOUNT}', 1);
      INSERT INTO staff_shifts (id, staff_id, work_date, start_time, end_time)
      VALUES ('shift-a', 'staff-a', '2026-11-02', '10:00', '19:00'),
             ('shift-b', 'staff-b', '2026-11-02', '10:00', '19:00');

      INSERT INTO menus (id, line_account_id, name, duration_minutes, buffer_after_minutes, base_price)
      VALUES ('menu-a', '${ACCOUNT}', 'カット', 60, 0, 8000),
             ('menu-b', '${OTHER_ACCOUNT}', 'カット', 60, 0, 8000);
      INSERT INTO staff_menus (staff_id, menu_id, is_offered)
      VALUES ('staff-a', 'menu-a', 1), ('staff-b', 'menu-b', 1);
    `);

    app = new Hono<Env>();
    app.route('/', booking);
    env = { DB: asD1(sqlite) };
  });

  afterEach(() => {
    sqlite.close();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** LINE の id_token 検証だけ差し替える。DB もルートも本物のまま。 */
  function stubLineVerify(sub: string) {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('api.line.me/oauth2/v2.1/verify')) {
        return new Response(JSON.stringify({ sub }), { status: 200 });
      }
      throw new Error(`想定外の外部呼び出し: ${url}`);
    }));
  }

  function liffBook(
    exec: ExecutionContext,
    options: { key: string; liffId?: string; menuId?: string; staffId?: string },
  ) {
    return app.request(
      `/api/liff/booking/requests?liffId=${options.liffId ?? 'liff-a-1'}`,
      {
        method: 'POST',
        body: JSON.stringify({
          menu_id: options.menuId ?? 'menu-a',
          staff_id: options.staffId ?? 'staff-a',
          starts_at: SLOT_UTC,
        }),
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': options.key,
          Authorization: 'Bearer dummy-id-token',
        },
      },
      env,
      exec,
    );
  }

  function bookingRows() {
    return sqlite.prepare(`SELECT id, line_account_id, status FROM bookings ORDER BY id`).all() as
      Array<{ id: string; line_account_id: string; status: string }>;
  }

  test('予約が成立したら、予約IDを発生元にして運用者通知を1回出す', async () => {
    stubLineVerify('U-a-1');
    const { ctx, settle } = collectingExecCtx();

    const response = await liffBook(ctx, { key: 'key-1' });
    await settle();

    expect(response.status).toBe(201);
    const rows = bookingRows();
    expect(rows).toHaveLength(1);
    expect(dispatchOperatorEvent).toHaveBeenCalledTimes(1);
    expect(dispatchOperatorEvent).toHaveBeenCalledWith(
      env.DB,
      expect.anything(),
      expect.objectContaining({
        lineAccountId: ACCOUNT,
        eventType: 'booking_created',
        sourceEventId: rows[0].id,
        executionMode: 'automatic',
      }),
    );
  });

  test('同じ Idempotency-Key の再送では予約も通知も増えない', async () => {
    stubLineVerify('U-a-1');
    const first = collectingExecCtx();
    await liffBook(first.ctx, { key: 'key-same' });
    await first.settle();

    const second = collectingExecCtx();
    const response = await liffBook(second.ctx, { key: 'key-same' });
    await second.settle();

    expect(response.status).toBe(201);
    expect(bookingRows()).toHaveLength(1);
    expect(dispatchOperatorEvent).toHaveBeenCalledTimes(1);
  });

  test('枠が埋まって予約が成立しなかったときは通知を出さない', async () => {
    stubLineVerify('U-a-1');
    const first = collectingExecCtx();
    expect((await liffBook(first.ctx, { key: 'key-a' })).status).toBe(201);
    await first.settle();
    dispatchOperatorEvent.mockClear();

    // 同じ枠へ別の Idempotency-Key で入れる。1件目で埋まっているので、
    // 確定直前の空き枠再検証で断られる。
    const second = collectingExecCtx();
    const response = await liffBook(second.ctx, { key: 'key-b' });
    await second.settle();

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: 'slot_not_available' });
    expect(bookingRows()).toHaveLength(1);
    expect(dispatchOperatorEvent).not.toHaveBeenCalled();
  });

  test('通知が落ちても予約は成立させ、拒否を外へ漏らさない', async () => {
    stubLineVerify('U-a-1');
    dispatchOperatorEvent.mockRejectedValueOnce(new Error('dispatch unavailable'));
    const { ctx, settle } = collectingExecCtx();

    const response = await liffBook(ctx, { key: 'key-fail' });
    const escaped = await settle();

    expect(response.status).toBe(201);
    expect(bookingRows()).toHaveLength(1);
    expect(bookingRows()[0].status).toBe('requested');
    // 通知の失敗は発火側で後始末する。ここへ漏れていたら .catch が外れている。
    expect(escaped).toEqual([]);
  });

  test('別アカウントの予約は、そのアカウントの通知として出す', async () => {
    stubLineVerify('U-b-1');
    const { ctx, settle } = collectingExecCtx();

    const response = await liffBook(ctx, {
      key: 'key-other', liffId: 'liff-b-1', menuId: 'menu-b', staffId: 'staff-b',
    });
    await settle();

    expect(response.status).toBe(201);
    expect(dispatchOperatorEvent).toHaveBeenCalledTimes(1);
    const [, , input] = dispatchOperatorEvent.mock.calls[0] as [
      unknown, unknown, { lineAccountId: string },
    ];
    expect(input.lineAccountId).toBe(OTHER_ACCOUNT);
  });

  test('認証が通らない要求では予約も通知も作らない', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 400 })));
    const { ctx, settle } = collectingExecCtx();

    const response = await liffBook(ctx, { key: 'key-unauth' });
    await settle();

    expect(response.status).toBe(401);
    expect(bookingRows()).toHaveLength(0);
    expect(dispatchOperatorEvent).not.toHaveBeenCalled();
  });
});
