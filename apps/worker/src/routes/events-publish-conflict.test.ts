// m26g: イベント公開表示の一致と枠編集の競合検出の再現・回帰試験。
// 実 sqlite（bootstrap 適用済み）＋実 Hono ルートで、監査 R576/R577 を守る。
// - R576: 通常 PUT の is_published 保存と lifecycle_status・顧客 GET の一致。
// - R577: 枠 PUT の期待版による競合検出（一方だけ確定・敗者は 409）。
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const liffAuthMocks = {
  verifyCallerLineUserId: vi.fn(),
};
vi.mock('../services/liff-auth.js', () => liffAuthMocks);

vi.mock('../services/event-waitlist.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/event-waitlist.js')>();
  return {
    ...actual,
    createEventWaitlistOfferSender: vi.fn(() => vi.fn()),
    enqueueEventWaitlistPromotion: vi.fn(async () => true),
  };
});

const notifierMocks = {
  sendEventBookingNotification: vi.fn(),
};
vi.mock('../services/event-booking-notifier.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/event-booking-notifier.js')>();
  return { ...actual, sendEventBookingNotification: notifierMocks.sendEventBookingNotification };
});

const applicantSnapshotMocks = {
  createEventApplicantSnapshot: vi.fn(),
  getEventApplicantSnapshot: vi.fn(),
};
vi.mock('../services/event-applicant-snapshot.js', () => applicantSnapshotMocks);

const { default: events } = await import('./events.js');

type TestEnv = {
  Variables: { staff: { id: string; role: 'owner' | 'admin' | 'staff' } };
  Bindings: { DB: D1Database };
};

function asD1(sqlite: Database.Database): D1Database {
  function prepare(query: string): D1PreparedStatement {
    const statement = sqlite.prepare(query);
    const make = (params: unknown[]): D1PreparedStatement => ({
      bind: (...next: unknown[]) => make(next),
      async all<T>() {
        return { results: statement.all(...params) as T[], success: true, meta: {} };
      },
      async first<T>() {
        return (statement.get(...params) as T | undefined) ?? null;
      },
      async run<T>() {
        const info = statement.run(...params);
        return { success: true, meta: { changes: info.changes }, results: [] } as T;
      },
      raw: async () => [],
    } as unknown as D1PreparedStatement);
    return make([]);
  }
  return {
    prepare,
    async batch(statements: D1PreparedStatement[]) {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    },
  } as unknown as D1Database;
}

const DAY_MS = 24 * 3600_000;
const futureIso = (days: number) => new Date(Date.now() + days * DAY_MS).toISOString();

let sqlite: Database.Database;
let db: D1Database;

function seedAccount(id = 'la1', liffId: string | null = null): void {
  sqlite.exec(`
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, liff_id)
    VALUES ('${id}', 'ch-${id}', '${id}店', 'token-${id}', 'secret-${id}', ${liffId ? `'${liffId}'` : 'NULL'});
  `);
}

function seedEvent(id: string, accountId: string, published: boolean, extra?: string): void {
  sqlite.exec(`
    INSERT INTO events (id, line_account_id, name, is_published, venue_url,
      cancel_deadline_hours_before, requires_approval, waitlist_enabled)
    VALUES ('${id}', '${accountId}', 'イベント${id}', ${published ? 1 : 0},
      'https://example.test/room-${id}', 24, 0, 1);
  `);
  if (published) {
    sqlite.exec(`UPDATE events SET lifecycle_status = 'published' WHERE id = '${id}';`);
  }
  if (extra) sqlite.exec(extra);
}

function seedSlot(id: string, eventId: string, days: number, capacity: number | null): void {
  sqlite.exec(`
    INSERT INTO event_slots (id, event_id, starts_at, ends_at, capacity)
    VALUES ('${id}', '${eventId}', '${futureIso(days)}', '${futureIso(days + 0.1)}',
      ${capacity === null ? 'NULL' : capacity});
  `);
}

function setupApp(staffRole: 'owner' | 'admin' | 'staff' = 'owner') {
  const app = new Hono<TestEnv>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'staff-1', role: staffRole } as never);
    c.env = { DB: db } as TestEnv['Bindings'];
    await next();
  });
  app.route('/', events);
  return app;
}

function putJson(app: ReturnType<typeof setupApp>, path: string, body: unknown) {
  return app.request(path, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function eventRow(id: string): { is_published: number; lifecycle_status: string | null; version: number } {
  return sqlite.prepare(`SELECT is_published, lifecycle_status, version FROM events WHERE id = ?`).get(id) as {
    is_published: number;
    lifecycle_status: string | null;
    version: number;
  };
}

/** 編集画面と同じ式：lifecycle_status を優先し、無いときだけ公開フラグで決める。 */
function displayStatus(row: { is_published: number; lifecycle_status: string | null }): string {
  return row.lifecycle_status ?? (row.is_published === 1 ? 'published' : 'draft');
}

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(import.meta.dirname, '../../../../packages/db/bootstrap.sql'), 'utf8'));
  sqlite.pragma('foreign_keys = ON');
  db = asD1(sqlite);
  for (const fn of Object.values(liffAuthMocks)) fn.mockReset();
  for (const fn of Object.values(notifierMocks)) fn.mockReset();
  liffAuthMocks.verifyCallerLineUserId.mockResolvedValue(null);
});

describe('m26g R576 公開保存と顧客表示の一致', () => {
  test('公開保存で保存状態も公開になり、顧客GETで取得できる', async () => {
    seedAccount('la1', 'liff1');
    seedEvent('e1', 'la1', false);
    const app = setupApp();
    const res = await putJson(app, '/api/events/admin/events/e1?account_id=la1', {
      is_published: 1,
      expected_version: 1,
    });
    expect(res.status).toBe(200);
    const row = eventRow('e1');
    expect(row.is_published).toBe(1);
    // 管理表示（lifecycle 優先）と顧客可視性が一致すること。
    expect(displayStatus(row)).toBe('published');
    const customer = await app.request('/api/liff/events/e1?liffId=liff1');
    expect(customer.status).toBe(200);
  });

  test('非公開保存で保存状態も下書きになり、顧客GETでは取得できない', async () => {
    seedAccount('la1', 'liff1');
    seedEvent('e1', 'la1', true);
    const app = setupApp();
    const res = await putJson(app, '/api/events/admin/events/e1?account_id=la1', {
      is_published: 0,
      expected_version: 1,
    });
    expect(res.status).toBe(200);
    const row = eventRow('e1');
    expect(row.is_published).toBe(0);
    expect(displayStatus(row)).toBe('draft');
    const customer = await app.request('/api/liff/events/e1?liffId=liff1');
    expect(customer.status).toBe(404);
  });

  test('古い不整合行（公開フラグ1・下書き表示）は顧客GETで取得できない', async () => {
    seedAccount('la1', 'liff1');
    seedEvent('e1', 'la1', true);
    sqlite.exec(`UPDATE events SET lifecycle_status = 'draft' WHERE id = 'e1';`);
    const app = setupApp();
    expect(displayStatus(eventRow('e1'))).toBe('draft');
    const customer = await app.request('/api/liff/events/e1?liffId=liff1');
    expect(customer.status).toBe(404);
    const slots = await app.request('/api/liff/events/e1/slots?liffId=liff1');
    expect(slots.status).toBe(404);
  });

  test('一時停止中の内容保存では公開の状態を壊さない', async () => {
    seedAccount();
    seedEvent('e1', 'la1', false, `UPDATE events SET lifecycle_status = 'paused' WHERE id = 'e1';`);
    const app = setupApp();
    const res = await putJson(app, '/api/events/admin/events/e1?account_id=la1', {
      name: '名前だけ直す',
      is_published: 0,
      expected_version: 1,
    });
    expect(res.status).toBe(200);
    expect(eventRow('e1').lifecycle_status).toBe('paused');
  });
});

describe('m26g R577 枠の並行編集は一方だけ確定する', () => {
  test('同じ期待版の容量変更は先勝ち・後者は409で最新が返る', async () => {
    seedAccount();
    seedEvent('e1', 'la1', true);
    seedSlot('s1', 'e1', 7, 10);
    const app = setupApp();
    const first = await putJson(app, '/api/events/admin/events/e1/slots/s1?account_id=la1', {
      capacity: 12,
      expected_version: 1,
    });
    expect(first.status).toBe(200);
    const second = await putJson(app, '/api/events/admin/events/e1/slots/s1?account_id=la1', {
      capacity: 13,
      expected_version: 1,
    });
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: string; data?: { current?: { capacity: number | null } } };
    expect(body.error).toBe('version_conflict');
    // 敗者に差分（最新の枠）を示す。
    expect(body.data?.current?.capacity).toBe(12);
    const row = sqlite.prepare(`SELECT capacity, version FROM event_slots WHERE id = 's1'`).get() as {
      capacity: number;
      version: number;
    };
    expect(row.capacity).toBe(12);
    expect(row.version).toBe(2);
  });

  test('古い版の有効切替は409し、読み直した版では通る', async () => {
    seedAccount();
    seedEvent('e1', 'la1', true);
    seedSlot('s1', 'e1', 7, 10);
    const app = setupApp();
    const stop = await putJson(app, '/api/events/admin/events/e1/slots/s1?account_id=la1', {
      is_active: 0,
      expected_version: 1,
    });
    expect(stop.status).toBe(200);
    // 古い画面からの再有効化は競合で止める。
    const stale = await putJson(app, '/api/events/admin/events/e1/slots/s1?account_id=la1', {
      is_active: 1,
      expected_version: 1,
    });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { error: string }).error).toBe('version_conflict');
    // 読み直した版では通る。
    const retried = await putJson(app, '/api/events/admin/events/e1/slots/s1?account_id=la1', {
      is_active: 1,
      expected_version: 2,
    });
    expect(retried.status).toBe(200);
    const row = sqlite.prepare(`SELECT is_active, version FROM event_slots WHERE id = 's1'`).get() as {
      is_active: number;
      version: number;
    };
    expect(row).toMatchObject({ is_active: 1, version: 3 });
  });

  test('期待版が無い枠更新は422', async () => {
    seedAccount();
    seedEvent('e1', 'la1', true);
    seedSlot('s1', 'e1', 7, 10);
    const app = setupApp();
    const res = await putJson(app, '/api/events/admin/events/e1/slots/s1?account_id=la1', { capacity: 9 });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe('expected_version_required');
  });
});
