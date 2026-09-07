import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { Env } from '../index.js';

const accountAccessMocks = vi.hoisted(() => ({
  canAccessAllLineAccounts: vi.fn(async () => true),
}));
vi.mock('../services/account-access.js', () => accountAccessMocks);

const { default: booking } = await import('./booking.js');

function asD1(sqlite: Database.Database): D1Database {
  const db = {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      const bound = (params: unknown[]): D1PreparedStatement => ({
        bind: (...next: unknown[]) => bound(next),
        all: async <T>() => ({ success: true, results: statement.all(...params) as T[], meta: {} }),
        first: async <T>() => (statement.get(...params) as T | undefined) ?? null,
        run: async <T>() => {
          const result = statement.run(...params);
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

function makeApp(
  db: D1Database,
  role: 'owner' | 'admin' | 'staff' = 'owner',
) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'staff-1', name: '担当者', role, readOnly: false });
    return next();
  });
  app.route('/', booking);
  return { app, env: { DB: db } };
}

describe('店舗共通の予約設定API', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    vi.clearAllMocks();
    accountAccessMocks.canAccessAllLineAccounts.mockResolvedValue(true);
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    sqlite.exec(readFileSync(join(process.cwd(), '../../packages/db/bootstrap.sql'), 'utf8'));
    sqlite.exec(`
      INSERT INTO line_accounts
        (id, channel_id, name, channel_access_token, channel_secret)
      VALUES
        ('account-a', 'channel-a', '本店', 'token-a', 'secret-a'),
        ('account-b', 'channel-b', '支店', 'token-b', 'secret-b'),
        ('account-empty', 'channel-empty', '新店舗', 'token-empty', 'secret-empty');
      INSERT INTO booking_settings
        (id, line_account_id, booking_window_days, cutoff_minutes_before,
         cancel_deadline_minutes_before, approval_mode)
      VALUES ('settings-a', 'account-a', 60, 1440, 720, 'manual');
      INSERT INTO booking_business_hours
        (id, booking_settings_id, weekday, start_time, end_time)
      VALUES
        ('hours-a-1', 'settings-a', 1, '09:00', '12:00'),
        ('hours-a-2', 'settings-a', 1, '13:00', '19:00');
      INSERT INTO menus
        (id, line_account_id, name, duration_minutes, base_price,
         booking_window_days, cutoff_hours_before, is_active)
      VALUES
        ('menu-a', 'account-a', '相談', 60, 8000, NULL, 2, 1),
        ('menu-stop', 'account-a', '停止中', 30, 0, 30, NULL, 0),
        ('menu-b', 'account-b', '別店舗', 45, 5000, NULL, NULL, 1);
      INSERT INTO staff (id, line_account_id, name, display_name)
      VALUES ('staff-a', 'account-a', '担当A', '担当A');
      INSERT INTO staff_menus (staff_id, menu_id, is_offered)
      VALUES ('staff-a', 'menu-a', 1);
      INSERT INTO friends (id, line_user_id, display_name, line_account_id)
      VALUES ('friend-a', 'line-friend-a', '予約者', 'account-a');
      INSERT INTO bookings
        (id, line_account_id, friend_id, staff_id, menu_id, starts_at, ends_at,
         block_ends_at, status, price_at_booking, requested_at)
      VALUES
        ('booking-a', 'account-a', 'friend-a', 'staff-a', 'menu-a',
         '2026-09-20T01:00:00.000Z', '2026-09-20T02:00:00.000Z',
         '2026-09-20T02:00:00.000Z', 'confirmed', 8000,
         strftime('%Y-%m-%dT%H:%M:%f', 'now'));
      INSERT INTO booking_resources (id, line_account_id, name, resource_type, capacity)
      VALUES ('room-a', 'account-a', '相談室', 'room', 2);
      INSERT INTO booking_availability_exceptions
        (id, line_account_id, scope_kind, date_from, date_to, kind, hours_json, reason)
      VALUES
        ('exception-a', 'account-a', 'store', '2026-12-30', '2026-12-30',
         'closed', '[]', '年末休業');
    `);
    db = asD1(sqlite);
  });

  afterEach(() => sqlite.close());

  test('通常設定は店舗の営業時間・例外日・実メニュー件数を返す', async () => {
    const { app, env } = makeApp(db);
    const res = await app.request('/api/booking/admin/settings?account_id=account-a', {}, env);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      data: {
        lineAccountId: 'account-a',
        organizationName: '本店',
        version: 1,
        bookingWindowDays: 60,
        cutoffMinutesBefore: 1440,
        cancelDeadlineMinutesBefore: 720,
        approvalMode: 'manual',
        menuCount: 2,
        activeMenuCount: 1,
        inactiveMenuCount: 1,
        businessHours: expect.arrayContaining([{
          weekday: 1,
          intervals: [{ start: '09:00', end: '12:00', capacity: 1 }, { start: '13:00', end: '19:00', capacity: 1 }],
        }]),
        exceptions: [expect.objectContaining({ date: '2026-12-30', kind: 'closed' })],
      },
    });
  });

  test('未設定の新店舗は安全な既定値と空の営業時間・例外日を返す', async () => {
    const { app, env } = makeApp(db);
    const res = await app.request('/api/booking/admin/settings?account_id=account-empty', {}, env);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      data: {
        version: 0,
        bookingWindowDays: 60,
        businessHours: expect.arrayContaining([{ weekday: 0, intervals: [] }]),
        exceptions: [],
        menuCount: 0,
      },
    });
  });

  test('取得失敗はDB詳細を返さず、担当外アカウントは処理前に403', async () => {
    const broken = {
      prepare: () => { throw new Error('private database detail'); },
    } as unknown as D1Database;
    const failedApp = makeApp(broken);
    const failed = await failedApp.app.request(
      '/api/booking/admin/settings?account_id=account-a', {}, failedApp.env,
    );
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain('private database detail');

    accountAccessMocks.canAccessAllLineAccounts.mockResolvedValueOnce(false);
    const { app, env } = makeApp(db);
    const forbidden = await app.request(
      '/api/booking/admin/settings?account_id=account-b', {}, env,
    );
    expect(forbidden.status).toBe(403);
  });

  test('休業・短縮・臨時営業を保存し、重複時刻を拒否する', async () => {
    const { app, env } = makeApp(db, 'admin');
    const created = await app.request(
      '/api/booking/admin/exceptions?account_id=account-a',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scopeKind: 'staff',
          scopeId: 'staff-a',
          dateFrom: '2026-09-20',
          dateTo: '2026-09-21',
          kind: 'custom_hours',
          intervals: [{ start: '10:00', end: '16:00' }],
          reason: '研修期間',
        }),
      },
      env,
    );
    expect(created.status).toBe(201);
    const createdBody = await created.json() as { data: { id: string; version: number } };
    expect(createdBody.data.version).toBe(1);

    const invalid = await app.request(
      '/api/booking/admin/exceptions?account_id=account-a',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scopeKind: 'store',
          dateFrom: '2026-09-22',
          dateTo: '2026-09-22',
          kind: 'open',
          intervals: [{ start: '09:00', end: '12:00' }, { start: '11:00', end: '14:00' }],
        }),
      },
      env,
    );
    expect(invalid.status).toBe(400);

    const listed = await app.request('/api/booking/admin/exceptions?account_id=account-a', {}, env);
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({
      data: { items: expect.arrayContaining([expect.objectContaining({ scopeKind: 'staff' })]) },
    });
  });

  test('例外日は版付きで部分更新し、古い版は409、別店舗IDは404', async () => {
    const { app, env } = makeApp(db);
    const body = JSON.stringify({
      expectedVersion: 1,
      kind: 'open',
      intervals: [{ start: '10:00', end: '17:00' }],
      reason: '祝日営業',
    });
    const updated = await app.request(
      '/api/booking/admin/exceptions/exception-a?account_id=account-a',
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body },
      env,
    );
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({ data: { version: 2, kind: 'open' } });

    const conflict = await app.request(
      '/api/booking/admin/exceptions/exception-a?account_id=account-a',
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body },
      env,
    );
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      code: 'version_conflict', data: { currentVersion: 2 },
    });

    const hidden = await app.request(
      '/api/booking/admin/exceptions/exception-a?account_id=account-b',
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body },
      env,
    );
    expect(hidden.status).toBe(404);
  });

  test('スタッフは例外日を変更できない', async () => {
    const { app, env } = makeApp(db, 'staff');
    const res = await app.request(
      '/api/booking/admin/exceptions?account_id=account-a',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
      env,
    );
    expect(res.status).toBe(403);
  });

  test('メニューは価格種別と店舗既定の継承元を返す', async () => {
    const { app, env } = makeApp(db);
    const res = await app.request('/api/booking/admin/menus?account_id=account-a', {}, env);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      menus: expect.arrayContaining([expect.objectContaining({
        id: 'menu-a',
        price_mode: 'fixed',
        version: 1,
        effectiveBookingRules: {
          bookingWindowDays: 60,
          cutoffMinutesBefore: 120,
          cancelDeadlineMinutesBefore: 720,
          source: {
            bookingWindowDays: 'store',
            cutoffMinutesBefore: 'menu',
            cancelDeadlineMinutesBefore: 'store',
          },
        },
        assigned_staff: [{ id: 'staff-a', display_name: '担当A' }],
        booking_count_30_days: 1,
      })]),
    });
  });

  test('下書き作成と公開切替を保存し、別店舗タグと壊れた基本値を拒否する', async () => {
    sqlite.exec(`INSERT INTO tags (id, name, line_account_id) VALUES ('tag-b', '支店タグ', 'account-b')`);
    const { app, env } = makeApp(db);
    const invalidTag = await app.request('/api/booking/admin/menus?account_id=account-a', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '下書き', duration_minutes: 30, base_price: 0, is_active: 0, auto_tag_id: 'tag-b',
      }),
    }, env);
    expect(invalidTag.status).toBe(400);

    const invalidBase = await app.request('/api/booking/admin/menus?account_id=account-a', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: ' ', duration_minutes: 0, buffer_after_minutes: -1 }),
    }, env);
    expect(invalidBase.status).toBe(400);

    const draft = await app.request('/api/booking/admin/menus?account_id=account-a', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: ' 下書き ', duration_minutes: 30, base_price: 0, is_active: 0 }),
    }, env);
    expect(draft.status).toBe(201);
    const draftBody = await draft.json() as { id: string };
    expect(sqlite.prepare(`SELECT name, is_active FROM menus WHERE id = ?`).get(draftBody.id))
      .toEqual({ name: '下書き', is_active: 0 });

    const invalidPutTag = await app.request('/api/booking/admin/menus/menu-a?account_id=account-a', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '相談', duration_minutes: 60, base_price: 8000, is_active: 0, auto_tag_id: 'tag-b',
      }),
    }, env);
    expect(invalidPutTag.status).toBe(400);

    const numericInactive = await app.request('/api/booking/admin/menus/menu-a?account_id=account-a', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '相談', duration_minutes: 60, base_price: 8000, is_active: 0,
      }),
    }, env);
    expect(numericInactive.status).toBe(200);
    expect(sqlite.prepare(`SELECT is_active FROM menus WHERE id = 'menu-a'`).get())
      .toEqual({ is_active: 0 });

    const toggled = await app.request('/api/booking/admin/menus/menu-a?account_id=account-a', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedVersion: 1, is_active: false }),
    }, env);
    expect(toggled.status).toBe(200);
    expect(sqlite.prepare(`SELECT name, duration_minutes, base_price, is_active, version
      FROM menus WHERE id = 'menu-a'`).get()).toEqual({
      name: '相談', duration_minutes: 60, base_price: 8000, is_active: 0, version: 2,
    });
  });

  test('シフト一括保存は日付・時刻・件数を検証し、まとめて保存する', async () => {
    const { app, env } = makeApp(db);
    const valid = await app.request('/api/booking/admin/staff/staff-a/shifts?account_id=account-a', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shifts: [
        { work_date: '2026-09-20', start_time: '09:00', end_time: '18:00' },
        { work_date: '2026-09-21', start_time: '10:00', end_time: '17:00' },
      ] }),
    }, env);
    expect(valid.status).toBe(200);
    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM staff_shifts WHERE staff_id = 'staff-a'`).get())
      .toEqual({ count: 2 });

    const invalid = await app.request('/api/booking/admin/staff/staff-a/shifts?account_id=account-a', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shifts: [
        { work_date: '2026-02-30', start_time: '18:00', end_time: '09:00' },
      ] }),
    }, env);
    expect(invalid.status).toBe(400);

    const tooMany = await app.request('/api/booking/admin/staff/staff-a/shifts?account_id=account-a', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shifts: Array.from({ length: 367 }, () => ({
        work_date: '2026-09-20', start_time: '09:00', end_time: '18:00',
      })) }),
    }, env);
    expect(tooMany.status).toBe(400);
  });

  test('シフト自動生成は12週を上限にし、日付と時刻を検証する', async () => {
    const { app, env } = makeApp(db);
    const request = (body: unknown) => app.request(
      '/api/booking/admin/staff/staff-a/shifts/generate?account_id=account-a',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      env,
    );
    await expect(request({
      from_date: '2026-02-30', weeks: 1, weekly_template: {},
    }).then((response) => response.status)).resolves.toBe(400);
    await expect(request({
      from_date: '2026-09-20', weeks: 13, weekly_template: {},
    }).then((response) => response.status)).resolves.toBe(400);
    await expect(request({
      from_date: '2026-09-20', weeks: 1,
      weekly_template: { sun: { start: '18:00', end: '09:00' } },
    }).then((response) => response.status)).resolves.toBe(400);
    const generated = await request({
      from_date: '2026-09-20', weeks: 1,
      weekly_template: { sun: { start: '09:00', end: '18:00' } },
    });
    expect(generated.status).toBe(200);
    await expect(generated.json()).resolves.toEqual({ inserted: 1 });
  });

  test('無料・問い合わせ価格を0円と区別し、メニュー上書きを版付き更新する', async () => {
    const { app, env } = makeApp(db);
    const created = await app.request(
      '/api/booking/admin/menus?account_id=account-a',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: '料金相談', duration_minutes: 30, price_mode: 'inquiry', base_price: 9999,
          booking_window_days: null, cutoff_hours_before: null,
          cancel_deadline_hours_before: null,
        }),
      },
      env,
    );
    expect(created.status).toBe(201);
    const createdBody = await created.json() as { id: string; version: number };
    expect(createdBody.version).toBe(1);
    expect(sqlite.prepare(`SELECT price_mode, base_price FROM menus WHERE id = ?`)
      .get(createdBody.id)).toEqual({ price_mode: 'inquiry', base_price: 0 });

    const patchBody = JSON.stringify({
      expectedVersion: 1,
      price_mode: 'free',
      booking_window_days: 45,
      cutoff_hours_before: null,
      cancel_deadline_hours_before: 24,
    });
    const updated = await app.request(
      '/api/booking/admin/menus/menu-a?account_id=account-a',
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: patchBody },
      env,
    );
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({ data: { id: 'menu-a', version: 2 } });
    expect(sqlite.prepare(`SELECT price_mode, base_price, booking_window_days,
      cutoff_hours_before, cancel_deadline_hours_before FROM menus WHERE id = 'menu-a'`).get())
      .toEqual({
        price_mode: 'free', base_price: 0, booking_window_days: 45,
        cutoff_hours_before: null, cancel_deadline_hours_before: 24,
      });

    const conflict = await app.request(
      '/api/booking/admin/menus/menu-a?account_id=account-a',
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: patchBody },
      env,
    );
    expect(conflict.status).toBe(409);
  });
});
