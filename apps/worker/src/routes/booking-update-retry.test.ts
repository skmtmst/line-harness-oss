// PATCH /api/booking/admin/bookings/:id（予約変更 N-389）と
// POST .../sync/retry（Google 再試行 N-392）、
// POST .../notifications/:runId/retry（LINE 通知再試行 N-393）、
// GET .../audit-logs（変更履歴 N-394）の route 試験。
//
// 実SQLite (bootstrap.sql) で動かし、ガードSQL・監査・台帳の実挙動を見る。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { Env } from '../index.js';

const availabilityMocks = vi.hoisted(() => ({
  computeSlots: vi.fn(() => [] as { start: string; end: string }[]),
  calls: [] as Array<Record<string, unknown>>,
  getAvailability: vi.fn(),
}));
vi.mock('../services/availability.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/availability.js')>();
  availabilityMocks.getAvailability = vi.fn(async (_db: unknown, params: {
    from: string;
    staffId?: string;
    excludeBookingId?: string;
  }) => {
    availabilityMocks.calls.push({ ...params });
    return {
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
    };
  });
  return { ...actual, getAvailability: availabilityMocks.getAvailability };
});

const notifierMocks = vi.hoisted(() => ({
  sendBookingNotification: vi.fn(async () => undefined),
}));
vi.mock('../services/booking-notifier.js', () => notifierMocks);

const accountAccessMocks = vi.hoisted(() => ({
  canAccessAllLineAccounts: vi.fn(async () => true),
}));
vi.mock('../services/account-access.js', () => accountAccessMocks);

const { default: booking } = await import('./booking.js');

function asD1(sqlite: Database.Database): D1Database {
  const db = {
    prepare(sql: string) {
      // route は ?1 ?2 ... の番号付きプレースホルダを使う。
      // better-sqlite3 は番号付きの位置バインドを受け付けないので、
      // 匿名 ? に書き換えて出現順に引数を並べ替える。
      const order: number[] = [];
      const rewritten = sql.replace(/\?(\d+)/g, (_m, n: string) => {
        order.push(Number(n));
        return '?';
      });
      const statement = sqlite.prepare(rewritten);
      const arrange = (params: unknown[]) =>
        order.length > 0 ? order.map((index) => params[index - 1]) : params;
      const bound = (params: unknown[]): D1PreparedStatement => ({
        bind: (...next: unknown[]) => bound(next),
        all: async <T>() => ({ success: true, results: statement.all(...arrange(params)) as T[], meta: {} }),
        first: async <T>() => (statement.get(...arrange(params)) as T | undefined) ?? null,
        run: async <T>() => {
          const result = statement.run(...arrange(params));
          return { success: true, results: [], meta: { changes: result.changes } } as T;
        },
        raw: async () => [],
      } as unknown as D1PreparedStatement);
      return bound([]);
    },
    async batch<T>(statements: D1PreparedStatement[]) {
      const results = [];
      sqlite.exec('BEGIN');
      try {
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
      return results as T;
    },
  };
  return db as unknown as D1Database;
}

function makeApp(db: D1Database, role: 'owner' | 'admin' | 'staff' = 'owner') {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'owner-1', name: 'Owner', role, readOnly: false });
    return next();
  });
  app.route('/', booking);
  return { app, env: { DB: db } };
}

const execCtx = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
} as unknown as ExecutionContext;

// 未来7日後の JST 11:00（= 02:00Z）。固定日は期限切れになるため動的に作る。
function futureStartsAt(days = 7, utcHour = 2): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(utcHour, 0, 0, 0);
  return d.toISOString();
}

function seed(sqlite: Database.Database) {
  sqlite.exec(readFileSync(join(process.cwd(), '../../packages/db/bootstrap.sql'), 'utf8'));
  sqlite.exec(`
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
    VALUES ('acc1','channel-1','A店','token','secret'),
           ('acc2','channel-2','B店','token2','secret2');
    INSERT INTO staff (id, line_account_id, name, display_name)
    VALUES ('s1','acc1','担当A','担当A'),
           ('s2','acc1','担当B','担当B'),
           ('s9','acc2','他店担当','他店担当'),
           ('owner-1','acc1','Owner','Owner');
    INSERT INTO menus (
      id, line_account_id, name, duration_minutes, buffer_after_minutes,
      base_price, concurrent_capacity
    ) VALUES ('m1','acc1','相談',60,10,8000,1),
             ('m2','acc1','カット',30,10,5000,1);
    INSERT INTO staff_menus (staff_id, menu_id, is_offered)
    VALUES ('s1','m1',1), ('s2','m1',1), ('s1','m2',1);
    INSERT INTO booking_settings (id, line_account_id, timezone)
    VALUES ('bs1','acc1','Asia/Tokyo');
    INSERT INTO friends (id, line_user_id, display_name, line_account_id, is_following, created_at, updated_at)
    VALUES ('f1','U1','花子','acc1',1,'2026-01-01T00:00:00.000','2026-01-01T00:00:00.000');
    INSERT INTO booking_customers (
      id, line_account_id, display_name, phone_normalized_hash,
      phone_encrypted, phone_last4, pet_name
    ) VALUES ('customer-1','acc1','山田 花子','hash','cipher','5678','ポチ');
  `);
}

function insertBooking(
  sqlite: Database.Database,
  input: {
    id: string;
    friend?: string | null;
    customer?: string | null;
    status?: string;
    startsAt?: string;
    lockVersion?: number;
    policy?: string;
    externalEventId?: string | null;
    externalCalendarId?: string | null;
  },
) {
  const startsAt = input.startsAt ?? futureStartsAt();
  const ends = new Date(new Date(startsAt).getTime() + 60 * 60_000);
  const block = new Date(ends.getTime() + 10 * 60_000);
  sqlite.prepare(`
    INSERT INTO bookings (
      id, line_account_id, friend_id, booking_customer_id, staff_id, menu_id,
      starts_at, ends_at, block_ends_at, status, price_at_booking, requested_at,
      lock_version, notification_policy_snapshot,
      external_event_id, external_calendar_id, source
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    input.id,
    'acc1',
    input.friend ?? null,
    input.customer ?? null,
    's1',
    'm1',
    startsAt,
    ends.toISOString(),
    block.toISOString(),
    input.status ?? 'confirmed',
    8000,
    '2026-09-01T00:00:00.000Z',
    input.lockVersion ?? 0,
    input.policy ?? '{}',
    input.externalEventId ?? null,
    input.externalCalendarId ?? null,
    input.friend ? 'liff' : 'phone',
  );
}

function patchBooking(
  app: ReturnType<typeof makeApp>['app'],
  env: unknown,
  id: string,
  body: unknown,
  accountId = 'acc1',
) {
  return app.request(
    `/api/booking/admin/bookings/${id}?account_id=${accountId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    },
    env as never,
    execCtx,
  );
}

describe('PATCH /api/booking/admin/bookings/:id (N-389)', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    vi.clearAllMocks();
    availabilityMocks.calls.length = 0;
    availabilityMocks.computeSlots.mockReturnValue([{ start: '11:00', end: '12:00' }]);
    accountAccessMocks.canAccessAllLineAccounts.mockResolvedValue(true);
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    seed(sqlite);
    db = asD1(sqlite);
  });

  afterEach(() => sqlite.close());

  test('lock_version 無しは400', async () => {
    insertBooking(sqlite, { id: 'B1', friend: 'f1' });
    const { app, env } = makeApp(db);
    const res = await patchBooking(app, env, 'B1', { customer_note: 'x' });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'missing_lock_version' });
  });

  test('他アカウントの予約は404、版が古い予約は409', async () => {
    insertBooking(sqlite, { id: 'B1', friend: 'f1', lockVersion: 3 });
    const { app, env } = makeApp(db);
    const other = await patchBooking(app, env, 'B1', { lock_version: 3, customer_note: 'x' }, 'acc2');
    expect(other.status).toBe(404);

    const stale = await patchBooking(app, env, 'B1', { lock_version: 1, customer_note: 'x' });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toEqual({ error: 'version_conflict' });
  });

  test('終端の予約は変更できない (409 not_editable)', async () => {
    insertBooking(sqlite, { id: 'B1', friend: 'f1', status: 'cancelled' });
    const { app, env } = makeApp(db);
    const res = await patchBooking(app, env, 'B1', { lock_version: 0, customer_note: 'x' });
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: 'not_editable' });
  });

  test('メモだけの変更は版を上げて監査へ残す', async () => {
    insertBooking(sqlite, { id: 'B1', friend: 'f1' });
    const { app, env } = makeApp(db);
    const res = await patchBooking(app, env, 'B1', {
      lock_version: 0,
      internal_note: 'アレルギー対応要',
      reason: '電話で確認',
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ booking_id: 'B1', lock_version: 1 });
    expect(sqlite.prepare(`SELECT internal_note, lock_version, updated_by_staff_id
      FROM bookings WHERE id = 'B1'`).get()).toEqual({
      internal_note: 'アレルギー対応要',
      lock_version: 1,
      updated_by_staff_id: 'owner-1',
    });
    const audit = sqlite.prepare(`SELECT action, actor_type, actor_name, before_json, after_json, reason
      FROM booking_audit_logs WHERE booking_id = 'B1'`).get() as {
      action: string; actor_type: string; actor_name: string;
      before_json: string; after_json: string; reason: string;
    };
    expect(audit.action).toBe('updated');
    expect(audit.actor_type).toBe('staff');
    expect(audit.actor_name).toBe('Owner');
    expect(audit.reason).toBe('電話で確認');
    expect(JSON.parse(audit.after_json)).toMatchObject({ internal_note: 'アレルギー対応要' });
    // 日時を変えていないので空き再照合は走らない
    expect(availabilityMocks.getAvailability).not.toHaveBeenCalled();
  });

  test('同じ日時のままの変更は自予約と衝突しない', async () => {
    const startsAt = futureStartsAt();
    insertBooking(sqlite, { id: 'B1', friend: 'f1', startsAt });
    const { app, env } = makeApp(db);
    const res = await patchBooking(app, env, 'B1', {
      lock_version: 0,
      starts_at: startsAt,
      customer_note: '時間はそのまま',
    });
    expect(res.status).toBe(200);
    expect(sqlite.prepare(`SELECT customer_note FROM bookings WHERE id = 'B1'`).get())
      .toEqual({ customer_note: '時間はそのまま' });
  });

  test('日時変更は空きを再照合し、リマインダを作り直す', async () => {
    const oldStart = futureStartsAt(7);
    const newStart = futureStartsAt(8);
    insertBooking(sqlite, { id: 'B1', friend: 'f1', startsAt: oldStart });
    const { app, env } = makeApp(db);
    const res = await patchBooking(app, env, 'B1', {
      lock_version: 0,
      starts_at: newStart,
    });
    expect(res.status).toBe(200);
    // 再照合は変更対象を除いて呼ばれる（自予約との衝突を避ける）
    expect(availabilityMocks.getAvailability).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ excludeBookingId: 'B1' }),
    );
    expect(sqlite.prepare(`SELECT starts_at FROM bookings WHERE id = 'B1'`).get())
      .toEqual({ starts_at: newStart });
    const reminders = sqlite.prepare(`SELECT kind, status FROM booking_reminders
      WHERE booking_id = 'B1' ORDER BY kind`).all() as Array<{ kind: string; status: string }>;
    expect(reminders.map((row) => row.kind)).toEqual(['day_before', 'hours_before']);
    expect(reminders.every((row) => row.status === 'pending')).toBe(true);
    const audit = sqlite.prepare(`SELECT after_json FROM booking_audit_logs
      WHERE booking_id = 'B1' AND action = 'updated'`).get() as { after_json: string };
    expect(JSON.parse(audit.after_json)).toMatchObject({ starts_at: newStart });
  });

  test('通知方針をOFFにすると未送信リマインダは作らない (N-391)', async () => {
    insertBooking(sqlite, {
      id: 'B1',
      friend: 'f1',
      policy: '{"send_line_confirmation":true,"day_before":true,"hours_before":true}',
    });
    const { app, env } = makeApp(db);
    const res = await patchBooking(app, env, 'B1', {
      lock_version: 0,
      notification_policy: { day_before: false, hours_before: false },
    });
    expect(res.status).toBe(200);
    expect(sqlite.prepare(`SELECT notification_policy_snapshot FROM bookings WHERE id = 'B1'`).get())
      .toEqual({
        notification_policy_snapshot:
          '{"send_line_confirmation":true,"day_before":false,"hours_before":false}',
      });
    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM booking_reminders
      WHERE booking_id = 'B1' AND status = 'pending'`).get()).toEqual({ count: 0 });
  });

  test('LINE未連携の予約で送信をオンにはできない (422)', async () => {
    insertBooking(sqlite, { id: 'B2', customer: 'customer-1' });
    const { app, env } = makeApp(db);
    const res = await patchBooking(app, env, 'B2', {
      lock_version: 0,
      notification_policy: { day_before: true },
    });
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({ error: 'line_notification_unavailable' });
  });

  test('未連携の予約でもメモは変更でき、お知らせは作らない', async () => {
    insertBooking(sqlite, { id: 'B2', customer: 'customer-1' });
    const { app, env } = makeApp(db);
    const res = await patchBooking(app, env, 'B2', {
      lock_version: 0,
      internal_note: '電話で日時確認済み',
    });
    expect(res.status).toBe(200);
    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM booking_reminders
      WHERE booking_id = 'B2'`).get()).toEqual({ count: 0 });
    expect(sqlite.prepare(`SELECT notification_policy_snapshot FROM bookings WHERE id = 'B2'`).get())
      .toEqual({
        notification_policy_snapshot:
          '{"send_line_confirmation":false,"day_before":false,"hours_before":false}',
      });
  });

  test('別店舗のスタッフへは変えられない (404)', async () => {
    insertBooking(sqlite, { id: 'B1', friend: 'f1' });
    const { app, env } = makeApp(db);
    const res = await patchBooking(app, env, 'B1', { lock_version: 0, staff_id: 's9' });
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'staff_not_found' });
  });
});

describe('POST /api/booking/admin/bookings/:id/sync/retry (N-392)', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    vi.clearAllMocks();
    accountAccessMocks.canAccessAllLineAccounts.mockResolvedValue(true);
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    seed(sqlite);
    db = asD1(sqlite);
  });

  afterEach(() => sqlite.close());

  const retry = (app: ReturnType<typeof makeApp>['app'], env: unknown, id: string, accountId = 'acc1') =>
    app.request(
      `/api/booking/admin/bookings/${id}/sync/retry?account_id=${accountId}`,
      { method: 'POST' },
      env as never,
      execCtx,
    );

  test('失敗行がなければ409、queued 行があれば409', async () => {
    insertBooking(sqlite, { id: 'B1', friend: 'f1' });
    const { app, env } = makeApp(db);
    const none = await retry(app, env, 'B1');
    expect(none.status).toBe(409);
    await expect(none.json()).resolves.toEqual({ error: 'no_retryable_operation' });

    sqlite.prepare(`INSERT INTO booking_operation_runs
      (id, booking_id, line_account_id, kind, status, idempotency_key)
      VALUES ('op-q','B1','acc1','google_calendar','queued','k1')`).run();
    const inFlight = await retry(app, env, 'B1');
    expect(inFlight.status).toBe(409);
    await expect(inFlight.json()).resolves.toEqual({ error: 'operation_in_progress' });
  });

  test('失敗行を再実行し、接続が無ければ skipped で閉じる', async () => {
    insertBooking(sqlite, { id: 'B1', friend: 'f1' });
    sqlite.prepare(`INSERT INTO booking_operation_runs
      (id, booking_id, line_account_id, kind, status, idempotency_key)
      VALUES ('op-f','B1','acc1','google_calendar','permanent_failed','k2')`).run();
    const { app, env } = makeApp(db);
    const res = await retry(app, env, 'B1');
    expect(res.status).toBe(200);
    // Google 接続の無い店舗は「設定なし」で閉じる（失敗のまま残さない）
    await expect(res.json()).resolves.toEqual({ status: 'skipped' });
    expect(sqlite.prepare(`SELECT status FROM booking_operation_runs WHERE id = 'op-f'`).get())
      .toEqual({ status: 'skipped' });
    const audit = sqlite.prepare(`SELECT action FROM booking_audit_logs
      WHERE booking_id = 'B1'`).get() as { action: string } | undefined;
    expect(audit?.action).toBe('sync_retried');
  });

  test('取消ずみ予約は削除を再実行する (外部予定あり)', async () => {
    insertBooking(sqlite, {
      id: 'B1',
      friend: 'f1',
      status: 'cancelled',
      externalEventId: 'evt-1',
      externalCalendarId: 'cal-1',
    });
    sqlite.prepare(`INSERT INTO booking_operation_runs
      (id, booking_id, line_account_id, kind, status, idempotency_key, result_json)
      VALUES ('op-d','B1','acc1','google_calendar','retry_wait','B1:google-calendar:delete','{"direction":"delete"}')`).run();
    const { app, env } = makeApp(db);
    const res = await retry(app, env, 'B1');
    expect(res.status).toBe(200);
    // 接続が無いので削除は no-op 扱いで成功に閉じる（外部予定は相手先で消えたものとして扱う）
    await expect(res.json()).resolves.toEqual({ status: 'succeeded' });
  });

  test('他アカウントの予約は404', async () => {
    insertBooking(sqlite, { id: 'B1', friend: 'f1' });
    const { app, env } = makeApp(db);
    const res = await retry(app, env, 'B1', 'acc2');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/booking/admin/bookings/:id/notifications/:runId/retry (N-393)', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    vi.clearAllMocks();
    accountAccessMocks.canAccessAllLineAccounts.mockResolvedValue(true);
    notifierMocks.sendBookingNotification.mockResolvedValue(undefined);
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    seed(sqlite);
    db = asD1(sqlite);
  });

  afterEach(() => sqlite.close());

  const retry = (
    app: ReturnType<typeof makeApp>['app'],
    env: unknown,
    id: string,
    runId: string,
    accountId = 'acc1',
  ) => app.request(
    `/api/booking/admin/bookings/${id}/notifications/${runId}/retry?account_id=${accountId}`,
    { method: 'POST' },
    env as never,
    execCtx,
  );

  test('成功ずみは409、対象外の種別は404、未連携予約は422', async () => {
    insertBooking(sqlite, { id: 'B1', friend: 'f1' });
    insertBooking(sqlite, { id: 'B2', customer: 'customer-1' });
    sqlite.prepare(`INSERT INTO booking_operation_runs
      (id, booking_id, line_account_id, kind, status, idempotency_key)
      VALUES ('op-ok','B1','acc1','confirmation_line','succeeded','n1'),
             ('op-g','B1','acc1','google_calendar','permanent_failed','n2')`).run();
    const { app, env } = makeApp(db);

    const succeeded = await retry(app, env, 'B1', 'op-ok');
    expect(succeeded.status).toBe(409);
    await expect(succeeded.json()).resolves.toEqual({ error: 'already_succeeded' });

    const wrongKind = await retry(app, env, 'B1', 'op-g');
    expect(wrongKind.status).toBe(404);
    await expect(wrongKind.json()).resolves.toEqual({ error: 'operation_not_found' });

    const phoneOnly = await retry(app, env, 'B2', 'op-x');
    expect(phoneOnly.status).toBe(422);
    await expect(phoneOnly.json()).resolves.toEqual({ error: 'line_notification_unavailable' });
  });

  test('失敗した通知を同じ行のまま再送し、監査へ残す', async () => {
    insertBooking(sqlite, { id: 'B1', friend: 'f1' });
    sqlite.prepare(`INSERT INTO booking_operation_runs
      (id, booking_id, line_account_id, kind, status, idempotency_key, result_json, error_code)
      VALUES ('op-f','B1','acc1','confirmation_line','permanent_failed','n3','{"notificationKind":"approved"}','Error')`).run();
    const { app, env } = makeApp(db);
    const res = await retry(app, env, 'B1', 'op-f');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      status: 'succeeded',
      operation_status: 'succeeded',
    });
    expect(notifierMocks.sendBookingNotification).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'approved' }),
    );
    // 同じ台帳行のまま仕上げる（新しい行を作らない）
    expect(sqlite.prepare(`SELECT status, error_code FROM booking_operation_runs WHERE id = 'op-f'`).get())
      .toEqual({ status: 'succeeded', error_code: null });
    const audit = sqlite.prepare(`SELECT action, actor_type FROM booking_audit_logs
      WHERE booking_id = 'B1'`).get() as { action: string; actor_type: string } | undefined;
    expect(audit?.action).toBe('notification_retried');
    expect(audit?.actor_type).toBe('staff');
  });

  test('再送が失敗しても行に error_code を残して 200 で実状態を返す', async () => {
    notifierMocks.sendBookingNotification.mockRejectedValueOnce(new Error('line_api_500'));
    insertBooking(sqlite, { id: 'B1', friend: 'f1' });
    sqlite.prepare(`INSERT INTO booking_operation_runs
      (id, booking_id, line_account_id, kind, status, idempotency_key)
      VALUES ('op-f2','B1','acc1','confirmation_line','retry_wait','n4')`).run();
    const { app, env } = makeApp(db);
    const res = await retry(app, env, 'B1', 'op-f2');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      status: 'failed',
      operation_status: 'permanent_failed',
      error_code: 'Error',
    });
  });
});

describe('GET /api/booking/admin/bookings/:id/audit-logs (N-394)', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    vi.clearAllMocks();
    accountAccessMocks.canAccessAllLineAccounts.mockResolvedValue(true);
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    seed(sqlite);
    db = asD1(sqlite);
  });

  afterEach(() => sqlite.close());

  test('他アカウントは404、更新した内容が履歴で読める', async () => {
    insertBooking(sqlite, { id: 'B1', friend: 'f1' });
    const { app, env } = makeApp(db);
    const other = await app.request('/api/booking/admin/bookings/B1/audit-logs?account_id=acc2', {}, env as never);
    expect(other.status).toBe(404);

    await patchBooking(app, env, 'B1', {
      lock_version: 0,
      internal_note: '履歴の確認用',
    });
    const res = await app.request('/api/booking/admin/bookings/B1/audit-logs?account_id=acc1', {}, env as never);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      audit_logs: Array<{ action: string; actorType: string; after: Record<string, unknown> | null }>;
    };
    expect(body.audit_logs).toHaveLength(1);
    expect(body.audit_logs[0]).toMatchObject({
      action: 'updated',
      actorType: 'staff',
      after: { internal_note: '履歴の確認用' },
    });
  });
});
