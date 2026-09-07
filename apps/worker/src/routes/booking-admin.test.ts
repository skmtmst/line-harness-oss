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
  getAvailability: vi.fn(async (_db: unknown, params: { from: string }) => ({
    by_staff: [{
      staff_id: 's1',
      display_name: 'A',
      slots: availabilityMocks.computeSlots().map((slot) => ({ date: params.from, ...slot })),
    }],
  })),
};
vi.mock('../services/availability.js', () => availabilityMocks);

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
