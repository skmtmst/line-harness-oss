import { describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Env } from '../index.js';

const bookingCustomerMocks = vi.hoisted(() => ({
  createBookingCustomer: vi.fn(),
  getBookingCustomer: vi.fn(),
  searchBookingCustomers: vi.fn(),
}));
vi.mock('@line-crm/db', async (importOriginal) => ({
  ...await importOriginal<typeof import('@line-crm/db')>(),
  ...bookingCustomerMocks,
}));

const availabilityMocks = {
  computeSlots: vi.fn(() => [] as { start: string; end: string }[]),
  // 候補の instant 契約に合わせる。route は壁時刻ではなく startUtc の
  // 完全一致で確定する（#651）ので、置き換えでも instant を付ける。
  // この試験の店舗は Asia/Tokyo。
  getAvailability: vi.fn(async (_db: unknown, params: { from: string; staffId?: string }) => ({
    by_staff: [{
      staff_id: params.staffId ?? 's1',
      display_name: 'A',
      slots: availabilityMocks.computeSlots().map((slot) => ({
        date: params.from,
        ...slot,
        timeZone: 'Asia/Tokyo',
        startUtc: `${params.from}T${slot.start}:00+09:00`,
        endUtc: `${params.from}T${slot.end}:00+09:00`,
      })),
    }],
  })),
  getAccountTimeZone: vi.fn(async () => 'Asia/Tokyo'),
};
vi.mock('../services/availability.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../services/availability.js')>(),
  ...availabilityMocks,
}));

const notifierMocks = { sendBookingNotification: vi.fn() };
vi.mock('../services/booking-notifier.js', () => notifierMocks);

const accountAccessMocks = {
  canAccessAllLineAccounts: vi.fn(async () => true),
};
vi.mock('../services/account-access.js', () => accountAccessMocks);

const { default: booking } = await import('./booking.js');

function makeApp(db: unknown) {
  const app = new Hono<Env>();
  // 予約の枠組みは管理者、承認はスタッフに限定した。ここで見たいのは本体の
  // 挙動なので、認証は通った状態にしてから渡す。権限の検証は
  // middleware/role-guard.test.ts が持つ。
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'owner-1', name: 'Owner', role: 'owner', readOnly: false });
    return next();
  });
  app.route('/', booking);
  return { app, env: { DB: db } };
}

const emptyDb = {
  prepare: () => ({
    bind: () => ({
      first: async () => null,
      all: async () => ({ results: [] }),
      run: async () => ({ meta: { changes: 0 } }),
    }),
  }),
};

describe('booking customers API', () => {
  const summary = {
    id: 'customer-1',
    line_account_id: 'acc1',
    friend_id: null,
    display_name: '山田 花子',
    phone_last4: '5678',
    pet_name: 'ポチ',
    is_line_linked: false,
    created_at: '2026-09-07T00:00:00.000Z',
    updated_at: '2026-09-07T00:00:00.000Z',
  };

  test('200で実データを返す', async () => {
    bookingCustomerMocks.searchBookingCustomers.mockResolvedValueOnce([summary]);
    const { app, env } = makeApp(emptyDb);
    const res = await app.request(
      '/api/booking/admin/customers?account_id=acc1&q=090-1234-5678',
      {},
      env,
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ customers: [summary] });
    expect(bookingCustomerMocks.searchBookingCustomers).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ lineAccountId: 'acc1', query: '090-1234-5678' }),
    );
  });

  test('検索結果0件は空配列、取得失敗は503で区別する', async () => {
    bookingCustomerMocks.searchBookingCustomers.mockResolvedValueOnce([]);
    const { app, env } = makeApp(emptyDb);
    const empty = await app.request('/api/booking/admin/customers?account_id=acc1&q=該当なし', {}, env);
    expect(empty.status).toBe(200);
    await expect(empty.json()).resolves.toEqual({ customers: [] });

    bookingCustomerMocks.searchBookingCustomers.mockRejectedValueOnce(new Error('db unavailable'));
    const failed = await app.request('/api/booking/admin/customers?account_id=acc1', {}, env);
    expect(failed.status).toBe(503);
    await expect(failed.json()).resolves.toEqual({ error: 'customer_data_unavailable' });
  });

  test('所属外アカウントは403で顧客検索へ進まない', async () => {
    accountAccessMocks.canAccessAllLineAccounts.mockResolvedValueOnce(false);
    const { app, env } = makeApp(emptyDb);
    const res = await app.request('/api/booking/admin/customers?account_id=other', {}, env);
    expect(res.status).toBe(403);
    expect(bookingCustomerMocks.searchBookingCustomers).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ lineAccountId: 'other' }),
    );
  });

  test('作成成功、入力不備、詳細なしを別状態で返す', async () => {
    bookingCustomerMocks.createBookingCustomer.mockResolvedValueOnce(summary);
    const { app, env } = makeApp(emptyDb);
    const created = await app.request(
      '/api/booking/admin/customers?account_id=acc1',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: '山田 花子',
          phone: '090-1234-5678',
          pet_name: 'ポチ',
        }),
      },
      env,
    );
    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toEqual({ customer: summary });

    bookingCustomerMocks.createBookingCustomer.mockRejectedValueOnce(
      new Error('booking_customer_phone_invalid'),
    );
    const invalid = await app.request(
      '/api/booking/admin/customers?account_id=acc1',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: '山田 花子', phone: 'abc' }),
      },
      env,
    );
    expect(invalid.status).toBe(422);

    bookingCustomerMocks.getBookingCustomer.mockResolvedValueOnce(null);
    const missing = await app.request('/api/booking/admin/customers/missing?account_id=acc1', {}, env);
    expect(missing.status).toBe(404);
  });
});

describe('GET /api/booking/admin/menus/:id/staff', () => {
  test('400 without account_id', async () => {
    const { app, env } = makeApp(emptyDb);
    const res = await app.request('/api/booking/admin/menus/m1/staff', {}, env);
    expect(res.status).toBe(400);
  });

  test('403 when the selected LINE account is outside the operator scope', async () => {
    accountAccessMocks.canAccessAllLineAccounts.mockResolvedValueOnce(false);
    const { app, env } = makeApp(emptyDb);
    const res = await app.request('/api/booking/admin/menus/m1/staff?account_id=other', {}, env);
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: 'forbidden_account' });
  });

  test('200 with staff list', async () => {
    const db = {
      prepare: () => ({
        bind: () => ({
          all: async () => ({ results: [{ id: 's1', display_name: 'スタッフA' }] }),
        }),
      }),
    };
    const { app, env } = makeApp(db);
    const res = await app.request('/api/booking/admin/menus/m1/staff?account_id=acc1', {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { staff: unknown[] };
    expect(body.staff).toHaveLength(1);
  });
});

describe('GET /api/booking/admin/availability', () => {
  test('400 without params', async () => {
    const { app, env } = makeApp(emptyDb);
    const res = await app.request('/api/booking/admin/availability?account_id=acc1', {}, env);
    expect(res.status).toBe(400);
  });

  test('200 delegates to getAvailability with minLeadTimeMinutes 0', async () => {
    const { app, env } = makeApp(emptyDb);
    const res = await app.request(
      '/api/booking/admin/availability?account_id=acc1&menu_id=m1&from=2026-07-08&to=2026-07-14',
      {},
      env,
    );
    expect(res.status).toBe(200);
    expect(availabilityMocks.getAvailability).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ lineAccountId: 'acc1', menuId: 'm1', minLeadTimeMinutes: 0 }),
    );
  });

  test('400 when range wider than 28 days', async () => {
    const { app, env } = makeApp(emptyDb);
    const res = await app.request(
      '/api/booking/admin/availability?account_id=acc1&menu_id=m1&from=2026-07-01&to=2026-08-15',
      {},
      env,
    );
    expect(res.status).toBe(400);
  });
});

// ----------------------------------------------------------------
// POST /api/booking/admin/bookings

type Handler = {
  first?: unknown;
  all?: { results: unknown[] };
  run?: { meta: { changes: number } };
};

// SQL 断片マッチで応答を返す scripted D1。マッチしない SQL は空応答。
function scriptedDb(handlers: [string, Handler][]) {
  const calls: { sql: string; params: unknown[] }[] = [];
  return {
    calls,
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          calls.push({ sql, params });
          const h = handlers.find(([frag]) => sql.includes(frag))?.[1] ?? {};
          return {
            first: async () => h.first ?? null,
            all: async () => h.all ?? { results: [] },
            run: async () => h.run ?? { meta: { changes: 0 } },
          };
        },
      };
    },
    async batch(stmts: unknown[]) {
      return stmts;
    },
  };
}

function sqliteAsD1(sqlite: Database.Database): D1Database {
  const sqliteParams = (sql: string, params: unknown[]) => {
    if (!/\?\d+/.test(sql)) return params;
    return [Object.fromEntries(params.map((value, index) => [String(index + 1), value]))];
  };
  const prepare = (sql: string): D1PreparedStatement => {
    const make = (params: unknown[]): D1PreparedStatement => ({
      bind: (...next: unknown[]) => make(next),
      first: async <T>() => (sqlite.prepare(sql).get(...sqliteParams(sql, params)) as T | undefined) ?? null,
      all: async <T>() => ({ results: sqlite.prepare(sql).all(...sqliteParams(sql, params)) as T[], success: true, meta: {} }),
      run: async <T>() => {
        const info = sqlite.prepare(sql).run(...sqliteParams(sql, params));
        return { success: true, results: [], meta: { changes: info.changes } } as T;
      },
      raw: async () => [],
    } as unknown as D1PreparedStatement);
    return make([]);
  };
  return {
    prepare,
    batch: async <T>(statements: D1PreparedStatement[]) => {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results as T;
    },
  } as unknown as D1Database;
}

const execCtx = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
} as unknown as ExecutionContext;

describe('POST /api/booking/admin/bookings', () => {
  // Always 7 days in the future at 02:00Z (= JST 11:00, inside the mocked
  // 10:00-19:00 shift). A fixed date here becomes a time bomb: the route
  // rejects past slots with 422 once the calendar catches up.
  const futureStartsAt = (() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 7);
    d.setUTCHours(2, 0, 0, 0);
    return d.toISOString();
  })();
  const validBody = {
    friend_id: 'f1',
    menu_id: 'm1',
    staff_id: 's1',
    starts_at: futureStartsAt, // JST 11:00
  };

  function happyDb(insertChanges = 1) {
    return scriptedDb([
      ['FROM friends', { first: { id: 'f1', is_following: 1 } }],
      ['FROM staff WHERE', { first: { ok: 1 } }],
      [
        'FROM menus m',
        {
          first: {
            duration_minutes: 60,
            buffer_after_minutes: 10,
            dur: 60,
            price: 8000,
            is_offered: 1,
          },
        },
      ],
      ['FROM staff_shifts', { first: { start_time: '10:00', end_time: '19:00' } }],
      ['SELECT starts_at, block_ends_at FROM bookings', { all: { results: [] } }],
      ['INSERT INTO booking_idempotency_keys', { run: { meta: { changes: 1 } } }],
      ['UPDATE booking_idempotency_keys', { run: { meta: { changes: 1 } } }],
      ['INSERT INTO bookings', { run: { meta: { changes: insertChanges } } }],
    ]);
  }

  function happyCustomerDb(insertChanges = 1) {
    return scriptedDb([
      ['FROM booking_customers', { first: { id: 'customer-1', friend_id: null } }],
      ['FROM staff WHERE', { first: { ok: 1 } }],
      [
        'FROM menus m',
        {
          first: {
            duration_minutes: 60,
            buffer_after_minutes: 10,
            dur: 60,
            price: 8000,
            is_offered: 1,
          },
        },
      ],
      ['FROM staff_shifts', { first: { start_time: '10:00', end_time: '19:00' } }],
      ['SELECT starts_at, block_ends_at FROM bookings', { all: { results: [] } }],
      ['INSERT INTO booking_idempotency_keys', { run: { meta: { changes: 1 } } }],
      ['UPDATE booking_idempotency_keys', { run: { meta: { changes: 1 } } }],
      ['INSERT INTO bookings', { run: { meta: { changes: insertChanges } } }],
    ]);
  }

  test('400 without Idempotency-Key', async () => {
    const { app, env } = makeApp(emptyDb);
    const res = await app.request(
      '/api/booking/admin/bookings?account_id=acc1',
      {
        method: 'POST',
        body: JSON.stringify(validBody),
        headers: { 'Content-Type': 'application/json' },
      },
      env,
      execCtx,
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'missing_idempotency_key' });
  });

  test('400 without account_id', async () => {
    const { app, env } = makeApp(emptyDb);
    const res = await app.request(
      '/api/booking/admin/bookings',
      {
        method: 'POST',
        body: JSON.stringify(validBody),
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'booking-create-1' },
      },
      env,
      execCtx,
    );
    expect(res.status).toBe(400);
  });

  test('404 when friend not found', async () => {
    const db = scriptedDb([['FROM friends', { first: null }]]);
    const { app, env } = makeApp(db);
    const res = await app.request(
      '/api/booking/admin/bookings?account_id=acc1',
      {
        method: 'POST',
        body: JSON.stringify(validBody),
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'booking-create-2' },
      },
      env,
      execCtx,
    );
    expect(res.status).toBe(404);
  });

  test('201 creates confirmed booking and inserts reminders', async () => {
    availabilityMocks.computeSlots.mockReturnValue([{ start: '11:00', end: '12:00' }]);
    const db = happyDb();
    const { app, env } = makeApp(db);
    const res = await app.request(
      '/api/booking/admin/bookings?account_id=acc1',
      {
        method: 'POST',
        body: JSON.stringify(validBody),
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'booking-create-3' },
      },
      env,
      execCtx,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { booking_id: string; status: string };
    expect(body.status).toBe('confirmed');
    const insert = db.calls.find((c) => c.sql.includes('INSERT INTO bookings'));
    expect(insert?.params).toContain('confirmed');
    // booking_reminders INSERT が走っている(未来の予約なので day_before + hours_before)
    const reminders = db.calls.filter((c) => c.sql.includes('INSERT INTO booking_reminders'));
    expect(reminders.length).toBeGreaterThan(0);
  });

  test('同じキーの再送は保存済みの予約を返し、予約を追加しない', async () => {
    const db = scriptedDb([
      ['FROM friends', { first: { id: 'f1', is_following: 1 } }],
      ['FROM booking_idempotency_keys', {
        first: {
          response_status: 201,
          response_body: JSON.stringify({ booking_id: 'existing', status: 'confirmed', calendar_sync: 'synced' }),
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        },
      }],
    ]);
    const { app, env } = makeApp(db);
    const res = await app.request(
      '/api/booking/admin/bookings?account_id=acc1',
      {
        method: 'POST',
        body: JSON.stringify(validBody),
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'same-booking' },
      },
      env,
      execCtx,
    );
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({ booking_id: 'existing' });
    expect(db.calls.some((call) => call.sql.includes('INSERT INTO bookings'))).toBe(false);
  });

  test('409 on slot conflict (atomic insert 0 rows)', async () => {
    availabilityMocks.computeSlots.mockReturnValue([{ start: '11:00', end: '12:00' }]);
    const db = happyDb(0);
    const { app, env } = makeApp(db);
    const res = await app.request(
      '/api/booking/admin/bookings?account_id=acc1',
      {
        method: 'POST',
        body: JSON.stringify(validBody),
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'booking-create-4' },
      },
      env,
      execCtx,
    );
    expect(res.status).toBe(409);
  });

  test('409と候補データ when slot not in availability', async () => {
    availabilityMocks.computeSlots.mockReturnValue([{ start: '14:00', end: '15:00' }]);
    const db = happyDb();
    const { app, env } = makeApp(db);
    const res = await app.request(
      '/api/booking/admin/bookings?account_id=acc1',
      {
        method: 'POST',
        body: JSON.stringify(validBody),
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'booking-create-5' },
      },
      env,
      execCtx,
    );
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: 'slot_not_available',
      data: { conflict: { count: 1 }, nearbySlots: expect.any(Array), alternateStaff: expect.any(Array) },
    });
  });

  test('404 when staff belongs to another account', async () => {
    availabilityMocks.computeSlots.mockReturnValue([{ start: '11:00', end: '12:00' }]);
    // friend exists, but the staff-in-account assertion returns no row.
    const db = scriptedDb([
      ['FROM friends', { first: { id: 'f1', is_following: 1 } }],
      ['FROM staff WHERE', { first: null }],
    ]);
    const { app, env } = makeApp(db);
    const res = await app.request(
      '/api/booking/admin/bookings?account_id=acc1',
      {
        method: 'POST',
        body: JSON.stringify(validBody),
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'booking-create-6' },
      },
      env,
      execCtx,
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('staff_not_found');
  });

  test('server-side availability recheck receives the correct September JST date', async () => {
    availabilityMocks.computeSlots.mockReturnValue([{ start: '11:00', end: '12:00' }]);
    const db = happyDb();
    const { app, env } = makeApp(db);
    // September exercises the old `.replace('-09', ...)` mangling bug, but the
    // year must stay in the future (past slots are rejected with 422 before the
    // window query runs) — pick this year's Sep 10 or next year's once passed.
    const now = new Date();
    const sepYear =
      now.getTime() < Date.UTC(now.getUTCFullYear(), 8, 1) // before Sep 1
        ? now.getUTCFullYear()
        : now.getUTCFullYear() + 1;
    const res = await app.request(
      '/api/booking/admin/bookings?account_id=acc1',
      {
        method: 'POST',
        body: JSON.stringify({ ...validBody, starts_at: `${sepYear}-09-10T02:00:00.000Z` }),
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'booking-create-7' },
      },
      env,
      execCtx,
    );
    expect(res.status).toBe(201);
    expect(availabilityMocks.getAvailability).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ from: `${sepYear}-09-10`, to: `${sepYear}-09-10` }),
    );
  });

  test('LINE未連携客を予約へ結び、LINE通知とリマインダは作らない', async () => {
    availabilityMocks.computeSlots.mockReturnValue([{ start: '11:00', end: '12:00' }]);
    const db = happyCustomerDb();
    const { app, env } = makeApp(db);
    const res = await app.request(
      '/api/booking/admin/bookings?account_id=acc1',
      {
        method: 'POST',
        body: JSON.stringify({
          booking_customer_id: 'customer-1',
          menu_id: 'm1',
          staff_id: 's1',
          starts_at: futureStartsAt,
          send_line_confirmation: false,
        }),
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'phone-booking-1' },
      },
      env,
      execCtx,
    );

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({
      booking_customer_id: 'customer-1',
      status: 'confirmed',
      line_notification: 'not_applicable',
    });
    const insert = db.calls.find((call) => call.sql.includes('INSERT INTO bookings'));
    expect(insert?.params).toContain('customer-1');
    expect(insert?.params).toContain('phone');
    expect(db.calls.some((call) => call.sql.includes('INSERT INTO booking_reminders'))).toBe(false);
  });

  test('実SQLiteでも電話客予約を保存し、予約一覧へ顧客名を返す', async () => {
    availabilityMocks.computeSlots.mockReturnValue([{ start: '11:00', end: '12:00' }]);
    const sqlite = new Database(':memory:');
    try {
      sqlite.exec(readFileSync(join(process.cwd(), '../../packages/db/bootstrap.sql'), 'utf8'));
      sqlite.exec(`
        INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
        VALUES ('acc1','channel-1','A店','token','secret');
        INSERT INTO staff (id, line_account_id, name, display_name)
        VALUES ('s1','acc1','担当A','担当A'), ('owner-1','acc1','Owner','Owner');
        INSERT INTO menus (
          id, line_account_id, name, duration_minutes, buffer_after_minutes,
          base_price, concurrent_capacity
        ) VALUES ('m1','acc1','相談',60,10,8000,1);
        INSERT INTO staff_menus (staff_id, menu_id, is_offered)
        VALUES ('s1','m1',1);
        INSERT INTO booking_customers (
          id, line_account_id, display_name, phone_normalized_hash,
          phone_encrypted, phone_last4, pet_name
        ) VALUES ('customer-1','acc1','山田 花子','hash','cipher','5678','ポチ');
      `);
      const { app, env } = makeApp(sqliteAsD1(sqlite));
      const created = await app.request(
        '/api/booking/admin/bookings?account_id=acc1',
        {
          method: 'POST',
          body: JSON.stringify({
            booking_customer_id: 'customer-1',
            menu_id: 'm1',
            staff_id: 's1',
            starts_at: futureStartsAt,
            send_line_confirmation: false,
          }),
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'phone-booking-real' },
        },
        env,
        execCtx,
      );
      expect(created.status).toBe(201);

      const listed = await app.request(
        '/api/booking/admin/requests?account_id=acc1&status=all',
        {},
        env,
      );
      expect(listed.status).toBe(200);
      await expect(listed.json()).resolves.toMatchObject({
        requests: [expect.objectContaining({
          booking_customer_id: 'customer-1',
          friend_id: null,
          friend_name: '山田 花子',
          customer_phone_last4: '5678',
          customer_pet_name: 'ポチ',
          is_line_linked: 0,
        })],
      });
      sqlite.exec(`
        WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n + 1 FROM seq WHERE n < 200)
        INSERT INTO bookings (
          id, line_account_id, booking_customer_id, staff_id, menu_id,
          starts_at, ends_at, block_ends_at, status, price_at_booking, requested_at, source
        )
        SELECT printf('bulk-%03d', n), 'acc1', 'customer-1', 's1', 'm1',
               strftime('%Y-%m-%dT%H:%M:%fZ', '2099-01-01T00:00:00Z', '+' || n || ' minutes'),
               strftime('%Y-%m-%dT%H:%M:%fZ', '2099-01-01T01:00:00Z', '+' || n || ' minutes'),
               strftime('%Y-%m-%dT%H:%M:%fZ', '2099-01-01T01:10:00Z', '+' || n || ' minutes'),
               'confirmed', 8000, '2098-12-01T00:00:00.000Z', 'phone'
          FROM seq;
      `);
      const afterTwoHundred = await app.request(
        '/api/booking/admin/requests?account_id=acc1&status=all&limit=1&offset=200', {}, env,
      );
      expect(afterTwoHundred.status).toBe(200);
      await expect(afterTwoHundred.json()).resolves.toMatchObject({
        total: 201,
        requests: [expect.objectContaining({ id: 'bulk-200', friend_id: null })],
      });
      expect(sqlite.prepare('SELECT COUNT(*) AS count FROM booking_reminders').get())
        .toEqual({ count: 0 });
    } finally {
      sqlite.close();
    }
  });

  test('LINE未連携客へのLINE送信指定は422で予約を作らない', async () => {
    const db = happyCustomerDb();
    const { app, env } = makeApp(db);
    const res = await app.request(
      '/api/booking/admin/bookings?account_id=acc1',
      {
        method: 'POST',
        body: JSON.stringify({
          booking_customer_id: 'customer-1',
          menu_id: 'm1',
          staff_id: 's1',
          starts_at: futureStartsAt,
          send_line_confirmation: true,
        }),
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'phone-booking-2' },
      },
      env,
      execCtx,
    );
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({ error: 'line_notification_unavailable' });
    expect(db.calls.some((call) => call.sql.includes('INSERT INTO bookings'))).toBe(false);
  });

  test('別アカウントの電話客IDは404で予約へ結び付けない', async () => {
    const db = scriptedDb([['FROM booking_customers', { first: null }]]);
    const { app, env } = makeApp(db);
    const res = await app.request(
      '/api/booking/admin/bookings?account_id=acc1',
      {
        method: 'POST',
        body: JSON.stringify({
          booking_customer_id: 'customer-other',
          menu_id: 'm1',
          staff_id: 's1',
          starts_at: futureStartsAt,
        }),
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'phone-booking-3' },
      },
      env,
      execCtx,
    );
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'booking_customer_not_found' });
  });
});

describe('GET /api/booking/admin/resources', () => {
  test('200で{success,data:{resources}}の包みで返す', async () => {
    const { app, env } = makeApp(emptyDb);
    const res = await app.request('/api/booking/admin/resources?account_id=acc1', {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: { resources: unknown[] } };
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data.resources)).toBe(true);
  });

  test('400 without account_id', async () => {
    const { app, env } = makeApp(emptyDb);
    const res = await app.request('/api/booking/admin/resources', {}, env);
    expect(res.status).toBe(400);
  });
});

describe('jstDayWindowUtc', () => {
  test('July date: bounds cover the full JST calendar day', async () => {
    const { jstDayWindowUtc } = await import('./booking.js');
    const w = jstDayWindowUtc('2026-07-10');
    expect(w.startUtc).toBe('2026-07-09T15:00:00.000Z');
    expect(w.endUtc).toBe('2026-07-10T15:00:00Z');
  });

  test('September/November dates are not corrupted', async () => {
    const { jstDayWindowUtc } = await import('./booking.js');
    expect(jstDayWindowUtc('2026-09-10').startUtc).toBe('2026-09-09T15:00:00.000Z');
    expect(jstDayWindowUtc('2026-11-09').startUtc).toBe('2026-11-08T15:00:00.000Z');
  });
});

describe('PATCH /api/booking/admin/requests/:id の再試行 (N-065)', () => {
  test('取消ずみへの再送は409にせずV6だけ止める', async () => {
    const sqlite = new Database(':memory:');
    try {
      sqlite.exec(readFileSync(join(process.cwd(), '../../packages/db/bootstrap.sql'), 'utf8'));
      sqlite.exec(`
        INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
        VALUES ('acc1','channel-1','A店','token','secret');
        INSERT INTO staff (id, line_account_id, name, display_name)
        VALUES ('s1','acc1','担当A','担当A'), ('owner-1','acc1','Owner','Owner');
        INSERT INTO friends (id, line_user_id, display_name, line_account_id, is_following, created_at, updated_at)
        VALUES ('f1','U1','花子','acc1',1,'2026-01-01T00:00:00.000','2026-01-01T00:00:00.000');
        INSERT INTO menus (
          id, line_account_id, name, duration_minutes, buffer_after_minutes,
          base_price, concurrent_capacity
        ) VALUES ('m1','acc1','相談',60,10,8000,1);
        INSERT INTO reminders
          (id, name, line_account_id, is_active, trigger_type, delivery_mode, lifecycle_status)
        VALUES ('rb-rule','rule','acc1',1,'booking','countdown','published');
        INSERT INTO reminder_steps (id, reminder_id, offset_minutes, message_type, message_content)
        VALUES ('rb-step','rb-rule',-60,'text','ご来店をお待ちしています');
        INSERT INTO bookings (
          id, line_account_id, friend_id, staff_id, menu_id,
          starts_at, ends_at, block_ends_at, status, price_at_booking, requested_at
        ) VALUES (
          'RB1','acc1','f1','s1','m1',
          '2026-09-20T01:00:00.000Z','2026-09-20T02:00:00.000Z','2026-09-20T02:00:00.000Z',
          'cancelled',8000,'2026-09-01T00:00:00.000Z'
        );
        INSERT INTO friend_reminders (
          id, friend_id, reminder_id, target_date, status,
          source_kind, source_id, source_event_id
        ) VALUES (
          'FR1','f1','rb-rule','2026-09-20T01:00:00.000Z','active',
          'booking','RB1','RB1'
        );
        INSERT INTO reminder_delivery_runs (
          id, line_account_id, reminder_id, friend_reminder_id, friend_id,
          reminder_step_id, scheduled_at, idempotency_key, line_retry_key,
          status, created_at, updated_at
        ) VALUES (
          'RUN1','acc1','rb-rule','FR1','f1',
          'rb-step','2026-09-20T00:00:00.000Z','idem-1','retry-1',
          'queued','2026-09-01T00:00:00.000Z','2026-09-01T00:00:00.000Z'
        );
      `);
      const { app, env } = makeApp(sqliteAsD1(sqlite));
      const send = () => app.request(
        '/api/booking/admin/requests/RB1?account_id=acc1',
        {
          method: 'PATCH',
          body: JSON.stringify({ action: 'cancel' }),
          headers: { 'Content-Type': 'application/json' },
        },
        env,
        execCtx,
      );
      // 業務は取消ずみだが V6 が残っている (部分失敗の残り)。再送で V6 を止める。
      const res = await send();
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ status: 'cancelled' });
      expect(sqlite.prepare(`SELECT status FROM friend_reminders WHERE id = 'FR1'`).get()).toEqual({
        status: 'cancelled',
      });
      expect(sqlite.prepare(`SELECT status FROM reminder_delivery_runs WHERE id = 'RUN1'`).get()).toEqual({
        status: 'cancelled',
      });
      // 2回目は無変更でも200 (冪等)。
      const again = await send();
      expect(again.status).toBe(200);
    } finally {
      sqlite.close();
    }
  });

  test('却下でもV6の未送信予定を止める (N-065)', async () => {
    const sqlite = new Database(':memory:');
    try {
      sqlite.exec(readFileSync(join(process.cwd(), '../../packages/db/bootstrap.sql'), 'utf8'));
      sqlite.exec(`
        INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
        VALUES ('acc1','channel-1','A店','token','secret');
        INSERT INTO staff (id, line_account_id, name, display_name)
        VALUES ('s1','acc1','担当A','担当A'), ('owner-1','acc1','Owner','Owner');
        INSERT INTO friends (id, line_user_id, display_name, line_account_id, is_following, created_at, updated_at)
        VALUES ('f1','U1','花子','acc1',1,'2026-01-01T00:00:00.000','2026-01-01T00:00:00.000');
        INSERT INTO menus (
          id, line_account_id, name, duration_minutes, buffer_after_minutes,
          base_price, concurrent_capacity
        ) VALUES ('m1','acc1','相談',60,10,8000,1);
        INSERT INTO reminders
          (id, name, line_account_id, is_active, trigger_type, delivery_mode, lifecycle_status)
        VALUES ('rb-rule','rule','acc1',1,'booking','countdown','published');
        INSERT INTO reminder_steps (id, reminder_id, offset_minutes, message_type, message_content)
        VALUES ('rb-step','rb-rule',-60,'text','ご来店をお待ちしています');
        INSERT INTO bookings (
          id, line_account_id, friend_id, staff_id, menu_id,
          starts_at, ends_at, block_ends_at, status, price_at_booking, requested_at
        ) VALUES (
          'RB2','acc1','f1','s1','m1',
          '2026-09-20T01:00:00.000Z','2026-09-20T02:00:00.000Z','2026-09-20T02:00:00.000Z',
          'requested',8000,'2026-09-01T00:00:00.000Z'
        );
        INSERT INTO friend_reminders (
          id, friend_id, reminder_id, target_date, status,
          source_kind, source_id, source_event_id
        ) VALUES (
          'FR2','f1','rb-rule','2026-09-20T01:00:00.000Z','active',
          'booking','RB2','RB2'
        );
      `);
      const { app, env } = makeApp(sqliteAsD1(sqlite));
      const res = await app.request(
        '/api/booking/admin/requests/RB2?account_id=acc1',
        {
          method: 'PATCH',
          body: JSON.stringify({ action: 'reject' }),
          headers: { 'Content-Type': 'application/json' },
        },
        env,
        execCtx,
      );
      // 却下ずみになり、V6 の未送信予定が止まる (通知だけでは残る不具合の修正)。
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ status: 'rejected' });
      expect(sqlite.prepare(`SELECT status FROM friend_reminders WHERE id = 'FR2'`).get()).toEqual({
        status: 'cancelled',
      });
    } finally {
      sqlite.close();
    }
  });

  test('送信権の貸出中は409で再試行させ、送信後に取消せる (N-065 fencing)', async () => {
    const sqlite = new Database(':memory:');
    try {
      sqlite.exec(readFileSync(join(process.cwd(), '../../packages/db/bootstrap.sql'), 'utf8'));
      sqlite.exec(`
        INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
        VALUES ('acc1','channel-1','A店','token','secret');
        INSERT INTO staff (id, line_account_id, name, display_name)
        VALUES ('s1','acc1','担当A','担当A'), ('owner-1','acc1','Owner','Owner');
        INSERT INTO friends (id, line_user_id, display_name, line_account_id, is_following, created_at, updated_at)
        VALUES ('f1','U1','花子','acc1',1,'2026-01-01T00:00:00.000','2026-01-01T00:00:00.000');
        INSERT INTO menus (
          id, line_account_id, name, duration_minutes, buffer_after_minutes,
          base_price, concurrent_capacity
        ) VALUES ('m1','acc1','相談',60,10,8000,1);
        INSERT INTO reminders
          (id, name, line_account_id, is_active, trigger_type, delivery_mode, lifecycle_status)
        VALUES ('rb-rule','rule','acc1',1,'booking','countdown','published');
        INSERT INTO reminder_steps (id, reminder_id, offset_minutes, message_type, message_content)
        VALUES ('rb-step','rb-rule',-60,'text','ご来店をお待ちしています');
        INSERT INTO bookings (
          id, line_account_id, friend_id, staff_id, menu_id,
          starts_at, ends_at, block_ends_at, status, price_at_booking, requested_at
        ) VALUES (
          'RB3','acc1','f1','s1','m1',
          '2026-09-20T01:00:00.000Z','2026-09-20T02:00:00.000Z','2026-09-20T02:00:00.000Z',
          'confirmed',8000,'2026-09-01T00:00:00.000Z'
        );
        INSERT INTO friend_reminders (
          id, friend_id, reminder_id, target_date, status,
          source_kind, source_id, source_event_id
        ) VALUES (
          'FR3','f1','rb-rule','2026-09-20T01:00:00.000Z','active',
          'booking','RB3','RB3'
        );
        INSERT INTO reminder_delivery_runs (
          id, line_account_id, reminder_id, friend_reminder_id, friend_id,
          reminder_step_id, scheduled_at, idempotency_key, line_retry_key,
          status, lease_expires_at, created_at, updated_at
        ) VALUES (
          'RUN3','acc1','rb-rule','FR3','f1',
          'rb-step','2026-09-20T00:00:00.000Z','idem-3','retry-3',
          'claimed','2099-01-01T00:00:00.000Z','2026-09-01T00:00:00.000Z','2026-09-01T00:00:00.000Z'
        );
      `);
      const { app, env } = makeApp(sqliteAsD1(sqlite));
      const send = () => app.request(
        '/api/booking/admin/requests/RB3?account_id=acc1',
        {
          method: 'PATCH',
          body: JSON.stringify({ action: 'cancel' }),
          headers: { 'Content-Type': 'application/json' },
        },
        env,
        execCtx,
      );
      // 送信権の貸出中は状態更新を巻き戻して 409 (取消確定後の送信を起こさない)。
      const conflicted = await send();
      expect(conflicted.status).toBe(409);
      await expect(conflicted.json()).resolves.toEqual({ error: 'send_in_flight_retry' });
      expect(sqlite.prepare(`SELECT status FROM bookings WHERE id = 'RB3'`).get()).toEqual({
        status: 'confirmed',
      });
      expect(sqlite.prepare(`SELECT status FROM friend_reminders WHERE id = 'FR3'`).get()).toEqual({
        status: 'active',
      });
      // 送信が終われば再試行で止まる。
      sqlite.prepare(`UPDATE reminder_delivery_runs SET status = 'succeeded', lease_expires_at = NULL WHERE id = 'RUN3'`).run();
      const retried = await send();
      expect(retried.status).toBe(200);
      expect(sqlite.prepare(`SELECT status FROM friend_reminders WHERE id = 'FR3'`).get()).toEqual({
        status: 'cancelled',
      });
    } finally {
      sqlite.close();
    }
  });
});

describe('staff breaks API (N-405 #655)', () => {
  function seedBreaks(sqlite: Database.Database) {
    sqlite.exec(readFileSync(join(process.cwd(), '../../packages/db/bootstrap.sql'), 'utf8'));
    sqlite.exec(`
      INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
      VALUES ('acc1','channel-1','A店','token','secret'),
             ('acc2','channel-2','B店','token2','secret2');
      INSERT INTO staff (id, line_account_id, name, display_name)
      VALUES ('s1','acc1','担当A','担当A'),
             ('s2','acc2','担当B','担当B'),
             ('owner-1','acc1','Owner','Owner');
      INSERT INTO booking_settings (id, line_account_id, timezone)
      VALUES ('bs1','acc1','Asia/Tokyo');
      INSERT INTO staff_availability_rules (id, staff_id, weekday, start_time, end_time, is_active)
      VALUES ('r1','s1',1,'09:00','19:00',1),
             ('r2','s1',2,'09:00','19:00',1);
      INSERT INTO staff_shifts (id, staff_id, work_date, start_time, end_time)
      VALUES ('sh1','s1','2026-09-23','10:00','17:00');
    `);
  }

  const getVersion = async (app: ReturnType<typeof makeApp>['app'], env: unknown, kind: 'breaks' | 'break-dates') => {
    const res = await app.request(
      `/api/booking/admin/staff/s1/${kind}?account_id=acc1`, {}, env as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { version: string; breaks: Array<{ id: string }> };
    return body;
  };

  const putKind = (
    app: ReturnType<typeof makeApp>['app'],
    env: unknown,
    kind: 'breaks' | 'break-dates',
    body: unknown,
  ) => app.request(
    `/api/booking/admin/staff/s1/${kind}?account_id=acc1`,
    { method: 'PUT', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } },
    env as never,
    execCtx,
  );

  test('実SQLiteで保存し、読み直しに残る(2回目の保存も残る)', async () => {
    const sqlite = new Database(':memory:');
    try {
      seedBreaks(sqlite);
      const { app, env } = makeApp(sqliteAsD1(sqlite));
      const first = await getVersion(app, env, 'breaks');
      const saved = await putKind(app, env, 'breaks', {
        expectedVersion: first.version,
        breaks: [{ weekday: 1, start_time: '12:00', end_time: '13:00' }],
      });
      expect(saved.status).toBe(200);
      const savedBody = await saved.json() as { ok: boolean; count: number; version: string };
      expect(savedBody).toMatchObject({ ok: true, count: 1 });
      expect(savedBody.version).not.toBe(first.version);

      const second = await putKind(app, env, 'breaks', {
        expectedVersion: savedBody.version,
        breaks: [
          { weekday: 1, start_time: '12:00', end_time: '13:00' },
          { weekday: 2, start_time: '12:00', end_time: '13:00' },
        ],
      });
      expect(second.status).toBe(200);

      const got = await getVersion(app, env, 'breaks');
      expect(got.breaks).toHaveLength(2);
    } finally {
      sqlite.close();
    }
  });

  test('古い版での保存は409で最新を返す', async () => {
    const sqlite = new Database(':memory:');
    try {
      seedBreaks(sqlite);
      const { app, env } = makeApp(sqliteAsD1(sqlite));
      const first = await getVersion(app, env, 'breaks');
      const saved = await putKind(app, env, 'breaks', {
        expectedVersion: first.version,
        breaks: [{ weekday: 1, start_time: '12:00', end_time: '13:00' }],
      });
      expect(saved.status).toBe(200);

      const stale = await putKind(app, env, 'breaks', {
        expectedVersion: first.version,
        breaks: [{ weekday: 1, start_time: '15:00', end_time: '16:00' }],
      });
      expect(stale.status).toBe(409);
      const staleBody = await stale.json() as {
        error: string;
        data: { version: string; breaks: Array<{ start_time: string }> };
      };
      expect(staleBody.error).toBe('version_conflict');
      expect(staleBody.data.breaks).toHaveLength(1);
      expect(staleBody.data.breaks[0].start_time).toBe('12:00');
    } finally {
      sqlite.close();
    }
  });

  test('重なり・勤務外・逆転は422、形の誤りは400', async () => {
    const sqlite = new Database(':memory:');
    try {
      seedBreaks(sqlite);
      const { app, env } = makeApp(sqliteAsD1(sqlite));
      const { version } = await getVersion(app, env, 'breaks');

      const overlap = await putKind(app, env, 'breaks', {
        expectedVersion: version,
        breaks: [
          { weekday: 1, start_time: '12:00', end_time: '13:00' },
          { weekday: 1, start_time: '12:30', end_time: '13:30' },
        ],
      });
      expect(overlap.status).toBe(422);
      await expect(overlap.json()).resolves.toEqual({ error: 'break_overlap' });

      const outside = await putKind(app, env, 'breaks', {
        expectedVersion: version,
        breaks: [{ weekday: 3, start_time: '12:00', end_time: '13:00' }],
      });
      expect(outside.status).toBe(422);
      await expect(outside.json()).resolves.toEqual({ error: 'break_outside_working_hours' });

      const inverted = await putKind(app, env, 'breaks', {
        expectedVersion: version,
        breaks: [{ weekday: 1, start_time: '13:00', end_time: '12:00' }],
      });
      expect(inverted.status).toBe(422);
      await expect(inverted.json()).resolves.toEqual({ error: 'invalid_time_range' });

      const noVersion = await putKind(app, env, 'breaks', {
        breaks: [{ weekday: 1, start_time: '12:00', end_time: '13:00' }],
      });
      expect(noVersion.status).toBe(400);
      await expect(noVersion.json()).resolves.toEqual({ error: 'invalid_version' });
    } finally {
      sqlite.close();
    }
  });

  test('別のアカウントの担当者は404、範囲外のアカウントは403', async () => {
    const sqlite = new Database(':memory:');
    try {
      seedBreaks(sqlite);
      const { app, env } = makeApp(sqliteAsD1(sqlite));
      const other = await app.request(
        '/api/booking/admin/staff/s2/breaks?account_id=acc1', {}, env as never,
      );
      expect(other.status).toBe(404);
      await expect(other.json()).resolves.toEqual({ error: 'staff_not_found_in_account' });

      accountAccessMocks.canAccessAllLineAccounts.mockResolvedValueOnce(false);
      const forbidden = await app.request(
        '/api/booking/admin/staff/s1/breaks?account_id=other', {}, env as never,
      );
      expect(forbidden.status).toBe(403);
    } finally {
      sqlite.close();
    }
  });

  test('日付指定の休憩はシフト内なら保存でき、DSTのgapは拒否する', async () => {
    const sqlite = new Database(':memory:');
    try {
      seedBreaks(sqlite);
      sqlite.exec(`
        UPDATE booking_settings SET timezone = 'America/New_York' WHERE id = 'bs1';
      `);
      const { app, env } = makeApp(sqliteAsD1(sqlite));
      const { version } = await getVersion(app, env, 'break-dates');

      // 2026-09-23 はシフト(10:00〜17:00)がある日。通常の休憩は通る。
      const ok = await putKind(app, env, 'break-dates', {
        expectedVersion: version,
        breaks: [{ work_date: '2026-09-23', start_time: '12:00', end_time: '13:00' }],
      });
      expect(ok.status).toBe(200);
      const okBody = await ok.json() as {
        ok: boolean;
        breaks: Array<{ start_utc_offset: string; end_utc_offset: string; time_zone: string }>;
      };
      expect(okBody.ok).toBe(true);
      expect(okBody.breaks[0].time_zone).toBe('America/New_York');
      expect(okBody.breaks[0].start_utc_offset).toBe('-04:00');

      // 2026-03-08 02:30 は New York の春のgap(存在しない時刻)。
      const gapVersion = (await getVersion(app, env, 'break-dates')).version;
      const gap = await putKind(app, env, 'break-dates', {
        expectedVersion: gapVersion,
        breaks: [{ work_date: '2026-03-08', start_time: '02:30', end_time: '03:30' }],
      });
      expect(gap.status).toBe(422);
      await expect(gap.json()).resolves.toEqual({ error: 'dst_gap' });
    } finally {
      sqlite.close();
    }
  });

  test('日付指定の休憩はシフトが無い日は通常勤務で判定し、無い日は拒否する', async () => {
    const sqlite = new Database(':memory:');
    try {
      seedBreaks(sqlite);
      const { app, env } = makeApp(sqliteAsD1(sqlite));
      const { version } = await getVersion(app, env, 'break-dates');

      // 2026-09-24(木曜)に勤務もシフトも無い → 拒否。
      const noWork = await putKind(app, env, 'break-dates', {
        expectedVersion: version,
        breaks: [{ work_date: '2026-09-24', start_time: '12:00', end_time: '13:00' }],
      });
      expect(noWork.status).toBe(422);
      await expect(noWork.json()).resolves.toEqual({ error: 'break_outside_working_hours' });
    } finally {
      sqlite.close();
    }
  });
});
