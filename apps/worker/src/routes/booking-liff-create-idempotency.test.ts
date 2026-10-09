import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

const availability = vi.hoisted(() => ({ getAvailability: vi.fn() }));
vi.mock('../services/availability.js', async (original) => ({
  ...await original<typeof import('../services/availability.js')>(), ...availability,
}));
const { default: booking } = await import('./booking.js');
const startsAt = '2026-10-26T01:00:00.000Z';
let sql: SqliteD1;
let app: Hono<Env>;
let db: D1Database;
let tasks: Promise<unknown>[];
let failCompletion: boolean;
let failInsert: boolean;
let loseInsertResponse: boolean;
let failRescueRead: boolean;
let verifiedUserId: string;
let pauseInsert: (() => Promise<void>) | undefined;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-20T12:00:00.000Z'));
  sql = createTestD1({ foreignKeys: true });
  tasks = []; failCompletion = false; failInsert = false; loseInsertResponse = false; failRescueRead = false; verifiedUserId = 'Uw1'; pauseInsert = undefined;
  sql.raw.exec(`
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, liff_id)
    VALUES ('w1-account', 'w1-channel', '試験', 'token', 'secret', 'w1-liff');
    INSERT INTO booking_settings (id, line_account_id, timezone, approval_mode)
    VALUES ('w1-settings', 'w1-account', 'Asia/Tokyo', 'manual');
    INSERT INTO menus (id, line_account_id, name, duration_minutes, buffer_after_minutes, base_price, concurrent_capacity)
    VALUES ('w1-menu', 'w1-account', '相談', 60, 0, 8000, 2);
    INSERT INTO staff (id, line_account_id, name, display_name) VALUES ('w1-staff', 'w1-account', '担当', '担当');
    INSERT INTO staff_menus (staff_id, menu_id, is_offered) VALUES ('w1-staff', 'w1-menu', 1);
    INSERT INTO friends (id, line_user_id, display_name, line_account_id, is_following)
    VALUES ('w1-friend', 'Uw1', '予約者', 'w1-account', 1);
    INSERT INTO staff_shifts (id, staff_id, work_date, start_time, end_time)
    VALUES ('w1-shift', 'w1-staff', '2026-10-26', '09:00', '23:00');
  `);
  const original = sql.db;
  db = { ...original, prepare(query: string) {
    const wrap = (statement: D1PreparedStatement): D1PreparedStatement => ({ ...statement,
      bind: (...args: unknown[]) => wrap(statement.bind(...args)),
      first: async <T>() => {
        if (failRescueRead && /SELECT id FROM bookings WHERE id/.test(query)) { failRescueRead = false; throw new Error('rescue read unavailable'); }
        return statement.first<T>();
      },
      run: async () => {
        if (failCompletion && /(?:UPDATE|INSERT INTO) booking_idempotency_keys/.test(query)
          && !query.includes('202')) { failCompletion = false; throw new Error('completion write lost'); }
        return statement.run();
      },
    } as D1PreparedStatement);
    return wrap(original.prepare(query));
  }, async batch(statements: D1PreparedStatement[]) {
    if (statements.some((statement) => /INSERT INTO bookings/.test((statement as unknown as { sql: string }).sql))) {
      if (pauseInsert) { const pause = pauseInsert; pauseInsert = undefined; await pause(); }
      if (failInsert) { failInsert = false; throw new Error('insert transaction failed'); }
    }
    const result = await original.batch(statements);
    if (loseInsertResponse && statements.some((statement) => /INSERT INTO bookings/.test((statement as unknown as { sql: string }).sql))) {
      loseInsertResponse = false; throw new Error('committed insert response lost');
    }
    return result;
  } } as D1Database;
  app = new Hono<Env>(); app.route('/', booking);
  availability.getAvailability.mockResolvedValue({ by_staff: [{ staff_id: 'w1-staff', display_name: '担当', slots: [{
    date: '2026-10-26', start: '10:00', end: '11:00', timeZone: 'Asia/Tokyo', startUtc: startsAt,
    endUtc: '2026-10-26T02:00:00.000Z', capacity: 2, remaining: 2, state: 'available',
  }] }] });
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/oauth2/v2.1/verify')) return Response.json({ sub: verifiedUserId });
    throw new Error('external network forbidden');
  });
});
afterEach(async () => { await Promise.allSettled(tasks); sql.raw.close(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function create(key = 'w1-key') {
  return app.request('/api/liff/booking/requests?liffId=w1-liff', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key, Authorization: 'Bearer local-token' },
    body: JSON.stringify({ menu_id: 'w1-menu', staff_id: 'w1-staff', starts_at: startsAt }),
  }, { DB: db } as Env['Bindings'], { waitUntil: (task: Promise<unknown>) => tasks.push(task), passThroughOnException() {} } as unknown as ExecutionContext);
}
function count(table: 'bookings' | 'booking_audit_logs') {
  return (sql.raw.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
}

describe('W1 LIFF予約のキー確保と保存失敗回収（実SQL・FK有効）', () => {
  it('定員2の枠でも同じキーの並行要求は予約1件だけを残す', async () => {
    let started!: () => void; let resume!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const gate = new Promise<void>((resolve) => { resume = resolve; });
    pauseInsert = async () => { started(); await gate; };
    const first = create(); await entered;
    const second = await create(); resume(); const winner = await first;
    expect(count('bookings')).toBe(1);
    expect(winner.status).toBe(201); expect(second.status).toBe(409); expect(count('booking_audit_logs')).toBe(1);
    const replay = await create(); expect(replay.status).toBe(201);
    expect(await replay.json()).toEqual(await winner.json()); expect(count('bookings')).toBe(1);
  });
  it('予約保存後に完成応答の保存だけ落ちても同じ予約を回収する', async () => {
    failCompletion = true;
    await create();
    const created = sql.raw.prepare('SELECT id, status FROM bookings').get() as { id: string; status: string };
    expect(created).toBeDefined();
    const replay = await create(); expect(replay.status).toBe(201);
    expect(await replay.json()).toMatchObject({ booking_id: created.id, status: created.status });
    expect(count('bookings')).toBe(1); expect(count('booking_audit_logs')).toBe(1);
  });
  it('commit済みINSERTの応答消失ではキーを消さず予約を作り直さない', async () => {
    loseInsertResponse = true; expect((await create()).status).toBe(500);
    const row = sql.raw.prepare('SELECT id FROM bookings').get() as { id: string };
    expect(sql.raw.prepare('SELECT response_status FROM booking_idempotency_keys').get()).toEqual({ response_status: 202 });
    const replay = await create(); expect(replay.status).toBe(201);
    expect(await replay.json()).toMatchObject({ booking_id: row.id }); expect(count('bookings')).toBe(1);
  });
  it('救出読取が不明ならキーを残し新規予約へ進めない', async () => {
    failInsert = true; failRescueRead = true; expect((await create()).status).toBe(500);
    expect(count('bookings')).toBe(0);
    expect(sql.raw.prepare('SELECT response_status FROM booking_idempotency_keys').get()).toEqual({ response_status: 202 });
    expect((await create()).status).toBe(409); expect(count('bookings')).toBe(0);
  });
  it('別の本人による同じキーの再利用では予約IDを返さず行も増やさない', async () => {
    expect((await create()).status).toBe(201);
    sql.raw.exec(`INSERT INTO friends (id, line_user_id, display_name, line_account_id, is_following)
      VALUES ('other-w1-friend', 'Uw1-other', '別', 'w1-account', 1);`);
    verifiedUserId = 'Uw1-other';
    const result = await create(); expect(result.status).toBe(409);
    expect(await result.json()).toEqual({ error: 'idempotency_key_conflict' }); expect(count('bookings')).toBe(1);
  });
  it('予約INSERTの失敗では自分の確保だけを解放して再送できる', async () => {
    failInsert = true; expect((await create()).status).toBe(500);
    expect(count('bookings')).toBe(0);
    expect(sql.raw.prepare('SELECT key FROM booking_idempotency_keys').all()).toEqual([]);
    expect((await create()).status).toBe(201); expect(count('bookings')).toBe(1);
  });
});
