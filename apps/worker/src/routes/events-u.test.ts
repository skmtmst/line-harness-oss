// U の口（状態・変更確認・待ち手動操作・LIFF 開催回変更・URL 限定）の試験。
// 実 sqlite（bootstrap 適用済み）＋ LIFF 認証と待ち通知だけモック。
// 権限・範囲・失敗・二重実行をここで守る。判定ロジックの詳細は
// services の試験（event-change-review.test.ts）で守る。
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

const DUMMY_AUTH = "liff-dummy";

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

function seedFriend(id: string, lineUserId: string, accountId = 'la1'): void {
  sqlite.exec(`
    INSERT INTO friends (id, line_user_id, display_name, line_account_id)
    VALUES ('${id}', '${lineUserId}', '${id}さん', '${accountId}');
  `);
}

function seedEvent(id: string, accountId: string, published: boolean, extra?: string): void {
  sqlite.exec(`
    INSERT INTO events (id, line_account_id, name, is_published, venue_url,
      cancel_deadline_hours_before, requires_approval, waitlist_enabled)
    VALUES ('${id}', '${accountId}', 'イベント${id}', ${published ? 1 : 0},
      'https://example.test/room-${id}', 24, 0, 1);
  `);
  sqlite.exec(`UPDATE events SET venue_name = '店内スペース' WHERE id = '${id}';`);
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

function seedBooking(
  id: string,
  eventId: string,
  slotId: string,
  friendId: string,
  status: string,
  party = 1,
): void {
  sqlite.exec(`
    INSERT INTO event_bookings
      (id, line_account_id, event_id, slot_id, friend_id, status,
       requested_at, identity_key, party_size)
    VALUES ('${id}', 'la1', '${eventId}', '${slotId}', '${friendId}', '${status}',
      '${new Date().toISOString()}', 'solo:${friendId}', ${party});
  `);
}

function seedWaiting(id: string, eventId: string, slotId: string, friendId: string): void {
  const now = new Date().toISOString();
  sqlite.exec(`
    INSERT INTO event_waitlist
      (id, line_account_id, event_id, slot_id, friend_id, identity_key,
       status, created_at, updated_at)
    VALUES ('${id}', 'la1', '${eventId}', '${slotId}', '${friendId}', 'key-${friendId}',
      'waiting', '${now}', '${now}');
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

function postJson(app: ReturnType<typeof setupApp>, path: string, body: unknown, headers?: Record<string, string>) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(headers ?? {}) },
    body: JSON.stringify(body),
  });
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

describe('U 状態の切替口', () => {
  test('下書き→公開中で公開フラグが立ち記録が残る', async () => {
    seedAccount();
    seedEvent('e1', 'la1', false);
    const app = setupApp();
    const res = await postJson(app, '/api/events/admin/events/e1/lifecycle?account_id=la1', {
      to: 'published',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { lifecycle_status: string; version: number; log_id: string };
    expect(body.lifecycle_status).toBe('published');
    expect(body.version).toBe(2);
    const row = sqlite.prepare(`SELECT lifecycle_status, is_published, version FROM events WHERE id = 'e1'`).get() as {
      lifecycle_status: string; is_published: number; version: number;
    };
    expect(row).toMatchObject({ lifecycle_status: 'published', is_published: 1, version: 2 });
    const log = sqlite.prepare(`SELECT action, reason FROM event_change_logs WHERE event_id = 'e1'`).get() as {
      action: string; reason: string | null;
    };
    expect(log.action).toBe('lifecycle');
  });

  test('一時停止は理由なしで 422', async () => {
    seedAccount();
    seedEvent('e1', 'la1', true);
    const app = setupApp();
    const res = await postJson(app, '/api/events/admin/events/e1/lifecycle?account_id=la1', {
      to: 'paused',
    });
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({ error: 'lifecycle_reason_required' });
  });

  test('一時停止は公開フラグを落とす', async () => {
    seedAccount();
    seedEvent('e1', 'la1', true);
    const app = setupApp();
    const res = await postJson(app, '/api/events/admin/events/e1/lifecycle?account_id=la1', {
      to: 'paused',
      reason: '台風のため',
    });
    expect(res.status).toBe(200);
    const row = sqlite.prepare(`SELECT lifecycle_status, is_published FROM events WHERE id = 'e1'`).get() as {
      lifecycle_status: string; is_published: number;
    };
    expect(row).toMatchObject({ lifecycle_status: 'paused', is_published: 0 });
  });

  test('公開中→下書きの逆戻りは 409', async () => {
    seedAccount();
    seedEvent('e1', 'la1', true);
    const app = setupApp();
    const res = await postJson(app, '/api/events/admin/events/e1/lifecycle?account_id=la1', {
      to: 'draft',
    });
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: 'lifecycle_transition_invalid' });
  });

  test('所属外は 404、認証なしは 403', async () => {
    seedAccount();
    seedAccount('la2');
    seedEvent('e1', 'la2', false);
    const app = setupApp();
    const foreign = await postJson(app, '/api/events/admin/events/e1/lifecycle?account_id=la1', {
      to: 'published',
    });
    expect(foreign.status).toBe(404);

    const noAuth = new Hono<TestEnv>();
    noAuth.route('/', events);
    const denied = await noAuth.request(
      '/api/events/admin/events/e1/lifecycle?account_id=la1',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to: 'published' }),
      },
      { DB: db },
    );
    expect(denied.status).toBe(403);
  });

  test('同じ冪等キーは二重に切り替えない', async () => {
    seedAccount();
    seedEvent('e1', 'la1', false);
    const app = setupApp();
    const path = '/api/events/admin/events/e1/lifecycle?account_id=la1';
    const first = await postJson(app, path, { to: 'published', idempotency_key: 'life-1' });
    expect(first.status).toBe(200);
    const second = await postJson(app, path, { to: 'paused', reason: 'x', idempotency_key: 'life-1' });
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({ deduplicated: true });
    const row = sqlite.prepare(`SELECT lifecycle_status FROM events WHERE id = 'e1'`).get() as {
      lifecycle_status: string;
    };
    expect(row.lifecycle_status).toBe('published');
  });
});

describe('U 変更確認の口', () => {
  test('定員割れの事前表示は blocked で止める理由を返す', async () => {
    seedAccount();
    seedEvent('e1', 'la1', true);
    seedSlot('s1', 'e1', 7, 2);
    seedFriend('f1', 'U1');
    seedBooking('b1', 'e1', 's1', 'f1', 'confirmed', 2);
    const app = setupApp();
    const res = await postJson(app, '/api/events/admin/events/e1/change-review?account_id=la1', {
      slot_changes: [{ slot_id: 's1', capacity: 1 }],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      blocked: boolean;
      impacts: Array<{ errors: string[] }>;
      total_confirmed: number;
    };
    expect(body.blocked).toBe(true);
    expect(body.impacts[0]?.errors).toContain('slot_capacity_below_bookings');
    expect(body.total_confirmed).toBe(2);
  });

  test('適用は版を進めて記録し、公開中は理由を必須にする', async () => {
    seedAccount();
    seedEvent('e1', 'la1', true);
    seedSlot('s1', 'e1', 7, 4);
    const app = setupApp();
    const path = '/api/events/admin/events/e1/change-review/apply?account_id=la1';
    const noReason = await postJson(app, path, {
      expected_version: 1,
      idempotency_key: 'cr-1',
      slot_changes: [{ slot_id: 's1', capacity: 3 }],
    });
    expect(noReason.status).toBe(422);
    await expect(noReason.json()).resolves.toEqual({ error: 'change_reason_required' });

    const applied = await postJson(app, path, {
      expected_version: 1,
      change_reason: '会場の都合で少し減らす',
      idempotency_key: 'cr-1',
      slot_changes: [{ slot_id: 's1', capacity: 3 }],
    });
    expect(applied.status).toBe(200);
    const body = (await applied.json()) as { version: number; log_id: string };
    expect(body.version).toBe(2);

    const replay = await postJson(app, path, {
      expected_version: 1,
      change_reason: '会場の都合で少し減らす',
      idempotency_key: 'cr-1',
      slot_changes: [{ slot_id: 's1', capacity: 3 }],
    });
    await expect(replay.json()).resolves.toMatchObject({ deduplicated: true, log_id: body.log_id });

    const stale = await postJson(app, path, {
      expected_version: 1,
      change_reason: '古い版',
      idempotency_key: 'cr-2',
      slot_changes: [{ slot_id: 's1', capacity: 3 }],
    });
    expect(stale.status).toBe(409);
  });
});

describe('U 待ちの手動操作の口', () => {
  test('順番の変更は理由なしで 422、ありで並び替えて記録する', async () => {
    seedAccount();
    seedEvent('e1', 'la1', true);
    seedSlot('s1', 'e1', 7, 1);
    seedFriend('f1', 'U1');
    seedFriend('f2', 'U2');
    seedWaiting('w1', 'e1', 's1', 'f1');
    seedWaiting('w2', 'e1', 's1', 'f2');
    const app = setupApp('staff');
    const path = '/api/events/admin/occurrences/s1/waitlist/reorder?account_id=la1';
    const noReason = await postJson(app, path, { ordered_ids: ['w2', 'w1'] });
    expect(noReason.status).toBe(422);
    await expect(noReason.json()).resolves.toEqual({ error: 'waitlist_reason_required' });

    const res = await postJson(app, path, {
      ordered_ids: ['w2', 'w1'],
      reason: '車いすの方を先に',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { order: string[]; log_id: string };
    expect(body.order).toEqual(['w2', 'w1']);
    const log = sqlite
      .prepare(`SELECT action, reason FROM event_change_logs WHERE id = '${body.log_id}'`)
      .get() as { action: string; reason: string };
    expect(log).toMatchObject({ action: 'waitlist_reorder', reason: '車いすの方を先に' });
  });

  test('飛ばしは最後尾へ回す', async () => {
    seedAccount();
    seedEvent('e1', 'la1', true);
    seedSlot('s1', 'e1', 7, 1);
    seedFriend('f1', 'U1');
    seedFriend('f2', 'U2');
    seedWaiting('w1', 'e1', 's1', 'f1');
    seedWaiting('w2', 'e1', 's1', 'f2');
    const app = setupApp();
    const res = await postJson(app, '/api/events/admin/occurrences/s1/waitlist/skip?account_id=la1', {
      waitlist_id: 'w1',
      reason: '連絡がつかないため今回は見送る',
    });
    expect(res.status).toBe(200);
    const rows = sqlite
      .prepare(`SELECT id FROM event_waitlist WHERE slot_id = 's1'
                ORDER BY sort_order ASC, created_at ASC, id ASC`)
      .all() as Array<{ id: string }>;
    expect(rows.map((r) => r.id)).toEqual(['w2', 'w1']);
  });

  test('手動の繰り上げも理由なしで 422', async () => {
    seedAccount();
    seedEvent('e1', 'la1', true);
    seedSlot('s1', 'e1', 7, 1);
    const app = setupApp();
    const res = await postJson(
      app,
      '/api/events/admin/occurrences/s1/waitlist/promote?account_id=la1',
      { expectedVersion: 1 },
    );
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({ error: 'waitlist_reason_required' });
  });
});

describe('U-3 LIFF の開催回変更', () => {
  function seedChangeBase(): void {
    seedAccount('la1', 'liff1');
    seedFriend('f1', 'U1');
    seedEvent('e1', 'la1', true);
    seedSlot('s1', 'e1', 7, 2);
    seedSlot('s2', 'e1', 8, 2);
    seedBooking('b1', 'e1', 's1', 'f1', 'confirmed', 1);
  }

  function changeRequest(toSlot: string, key: string, body?: Record<string, unknown>) {
    const app = setupApp();
    return postJson(
      app,
      '/api/events/liff/bookings/b1/change?liffId=liff1',
      { to_slot_id: toSlot, ...(body ?? {}) },
      { 'Idempotency-Key': key, Authorization: DUMMY_AUTH },
    );
  }

  test('新しい席を確保できた時だけ元の申込を取り消す', async () => {
    seedChangeBase();
    liffAuthMocks.verifyCallerLineUserId.mockResolvedValue('U1');
    const res = await changeRequest('s2', 'change-1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; status: string };
    expect(body.status).toBe('confirmed');
    expect(body.id).not.toBe('b1');
    const old = sqlite.prepare(`SELECT status FROM event_bookings WHERE id = 'b1'`).get() as {
      status: string;
    };
    expect(old.status).toBe('cancelled');
    const moved = sqlite
      .prepare(`SELECT slot_id, status, party_size FROM event_bookings WHERE id = '${body.id}'`)
      .get() as { slot_id: string; status: string; party_size: number };
    expect(moved).toMatchObject({ slot_id: 's2', status: 'confirmed', party_size: 1 });
    const log = sqlite
      .prepare(`SELECT action, actor_role FROM event_change_logs WHERE event_id = 'e1'`)
      .get() as { action: string; actor_role: string };
    expect(log).toMatchObject({ action: 'booking_change', actor_role: 'friend' });
  });

  test('満席の回へは変えず元の申込を維持する', async () => {
    seedChangeBase();
    seedFriend('f2', 'U2');
    seedBooking('b2', 'e1', 's2', 'f2', 'confirmed', 2);
    liffAuthMocks.verifyCallerLineUserId.mockResolvedValue('U1');
    const res = await changeRequest('s2', 'change-full');
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: 'slot_full' });
    const old = sqlite.prepare(`SELECT status FROM event_bookings WHERE id = 'b1'`).get() as {
      status: string;
    };
    expect(old.status).toBe('confirmed');
  });

  test('同じ冪等キーの再送は同じ応答を返す', async () => {
    seedChangeBase();
    liffAuthMocks.verifyCallerLineUserId.mockResolvedValue('U1');
    const first = await changeRequest('s2', 'change-replay');
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { id: string };
    const second = await changeRequest('s2', 'change-replay');
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toEqual({ id: firstBody.id, status: 'confirmed' });
  });

  test('締切後は変えられない・鍵なしは 400・他人のは 404', async () => {
    seedAccount('la1', 'liff1');
    seedFriend('f1', 'U1');
    seedFriend('f2', 'U2');
    seedEvent('e1', 'la1', true);
    // 1時間後に始まる回：取消締切24時間前はとうに過ぎている
    sqlite.exec(`
      INSERT INTO event_slots (id, event_id, starts_at, ends_at, capacity)
      VALUES ('s1', 'e1', '${new Date(Date.now() + 3600_000).toISOString()}',
        '${new Date(Date.now() + 2 * 3600_000).toISOString()}', 4);
    `);
    seedSlot('s2', 'e1', 8, 4);
    seedBooking('b1', 'e1', 's1', 'f1', 'confirmed', 1);
    seedBooking('b9', 'e1', 's2', 'f2', 'confirmed', 1);
    liffAuthMocks.verifyCallerLineUserId.mockResolvedValue('U1');
    const app = setupApp();

    const late = await postJson(
      app,
      '/api/events/liff/bookings/b1/change?liffId=liff1',
      { to_slot_id: 's2' },
      { 'Idempotency-Key': 'change-late', Authorization: DUMMY_AUTH },
    );
    expect(late.status).toBe(409);
    await expect(late.json()).resolves.toEqual({ error: 'change_deadline_passed' });

    const noKey = await app.request('/api/events/liff/bookings/b1/change?liffId=liff1', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: DUMMY_AUTH },
      body: JSON.stringify({ to_slot_id: 's2' }),
    });
    expect(noKey.status).toBe(400);

    const foreign = await postJson(
      app,
      '/api/events/liff/bookings/b9/change?liffId=liff1',
      { to_slot_id: 's1' },
      { 'Idempotency-Key': 'change-foreign', Authorization: DUMMY_AUTH },
    );
    expect(foreign.status).toBe(404);
  });
});

describe('U オンライン URL の限定', () => {
  test('確定前には URL を渡さず、確定したら渡す', async () => {
    seedAccount('la1', 'liff1');
    seedFriend('f1', 'U1');
    seedEvent('e1', 'la1', true);
    seedSlot('s1', 'e1', 7, 4);
    liffAuthMocks.verifyCallerLineUserId.mockResolvedValue('U1');
    const app = setupApp();

    const anonymous = await app.request('/api/liff/events/e1?liffId=liff1');
    expect(anonymous.status).toBe(200);
    const anonymousBody = (await anonymous.json()) as { venue_url: string | null; venue_name: string | null };
    expect(anonymousBody.venue_url).toBeNull();
    // 会場名は消さない
    expect(anonymousBody.venue_name).toBe('店内スペース');

    seedBooking('b1', 'e1', 's1', 'f1', 'requested', 1);
    const requested = (await (
      await app.request('/api/liff/events/e1?liffId=liff1')
    ).json()) as { venue_url: string | null };
    expect(requested.venue_url).toBeNull();

    sqlite.exec(`UPDATE event_bookings SET status = 'confirmed' WHERE id = 'b1'`);
    const confirmed = (await (
      await app.request('/api/liff/events/e1?liffId=liff1')
    ).json()) as { venue_url: string | null };
    expect(confirmed.venue_url).toBe('https://example.test/room-e1');
  });

  test('自分の予約一覧でも確定分だけ URL が付く', async () => {
    seedAccount('la1', 'liff1');
    seedFriend('f1', 'U1');
    seedEvent('e1', 'la1', true);
    seedSlot('s1', 'e1', 7, 4);
    seedBooking('b1', 'e1', 's1', 'f1', 'requested', 1);
    liffAuthMocks.verifyCallerLineUserId.mockResolvedValue('U1');
    const app = setupApp();
    const res = await app.request('/api/liff/events/me?liffId=liff1&tab=upcoming', {
      headers: { Authorization: DUMMY_AUTH },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ venue_url: string | null }> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.venue_url).toBeNull();
  });
});
