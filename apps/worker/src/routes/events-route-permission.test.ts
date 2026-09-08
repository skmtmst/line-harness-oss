/**
 * N-065 回帰テスト (6件目): 本番 events ルートの権限を実認証で確かめる。
 *
 * 偽ルートではなく本物の events ルーター + 本物の authMiddleware に
 * Bearer トークンで叩く。司令塔裁定どおり、イベント操作は owner/admin または
 * /events 権限つき staff だけが通り、権限なし staff・閲覧専用・他店舗は止まる。
 * 外部 LINE・Calendar へは送らない。
 */
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { Env } from '../index.js';
import { authMiddleware } from '../middleware/auth.js';
import { createTestD1 } from '../test-utils/d1-sqlite.js';

const accountAccessMocks = vi.hoisted(() => ({
  canAccessAllLineAccounts: vi.fn(async () => true),
}));
vi.mock('../services/account-access.js', () => accountAccessMocks);

// 通知の外部送信は抑える (権限の検証が目的)。
const notifierMocks = vi.hoisted(() => ({ sendEventBookingNotification: vi.fn(async () => {}) }));
vi.mock('../services/event-booking-notifier.js', () => notifierMocks);

const { default: events } = await import('./events.js');

function seed(raw: import('better-sqlite3').Database): void {
  raw.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
     VALUES ('account-1', 'channel-1', '本店', 'token', 'secret'),
            ('account-2', 'channel-2', '支店', 'token2', 'secret2')`,
  ).run();
  raw.prepare(
    `INSERT INTO staff_members (id, name, role, access_level, api_key, permission_keys)
     VALUES ('owner-1', 'Owner', 'owner', 'full', 'key-owner', '[]'),
            ('staff-ev', 'Events Staff', 'staff', 'full', 'key-events', '["/events"]'),
            ('staff-no', 'No Permission', 'staff', 'full', 'key-none', '[]'),
            ('staff-ro', 'Read Only', 'staff', 'read_only', 'key-ro', '["/events"]')`,
  ).run();
  raw.prepare(
    `INSERT INTO friends (id, line_user_id, display_name, line_account_id, is_following)
     VALUES ('friend-1', 'U-friend-1', '田中さくら', 'account-1', 1)`,
  ).run();
  raw.prepare(
    `INSERT INTO events (id, line_account_id, name, target_type)
     VALUES ('ev-1', 'account-1', '体験会', 'single')`,
  ).run();
  raw.prepare(
    `INSERT INTO event_slots (id, event_id, starts_at, ends_at)
     VALUES ('slot-1', 'ev-1', '2026-09-20T01:00:00.000Z', '2026-09-20T02:00:00.000Z')`,
  ).run();
  // 取消用 (confirmed) と却下用 (requested) を操作ごとに分ける。
  const bookings = [
    ['eb-c1', 'confirmed'],
    ['eb-c2', 'confirmed'],
    ['eb-c3', 'confirmed'],
    ['eb-c4', 'confirmed'],
    ['eb-c5', 'confirmed'],
    ['eb-d1', 'requested'],
    ['eb-d2', 'requested'],
    ['eb-d3', 'requested'],
  ] as const;
  for (const [id, status] of bookings) {
    raw.prepare(
      `INSERT INTO event_bookings
         (id, line_account_id, event_id, slot_id, friend_id, status, requested_at)
       VALUES (?, 'account-1', 'ev-1', 'slot-1', 'friend-1', ?, '2026-09-01T00:00:00.000Z')`,
    ).run(id, status);
  }
  raw.prepare(
    `INSERT INTO reminders
       (id, name, line_account_id, is_active, trigger_type, delivery_mode, lifecycle_status)
     VALUES ('rule-event-1', 'rule', 'account-1', 1, 'event', 'countdown', 'published')`,
  ).run();
  raw.prepare(
    `INSERT INTO reminder_steps
       (id, reminder_id, offset_minutes, message_type, message_content)
     VALUES ('step-rule-event-1', 'rule-event-1', -60, 'text', 'お待ちしています')`,
  ).run();
}

function makeApp(db: D1Database) {
  const app = new Hono<Env>();
  app.use('*', authMiddleware);
  app.route('/', events);
  return { app, env: { DB: db } as unknown as Env };
}

function post(path: string, key?: string) {
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify({ action: 'reject' }),
  };
}

describe('本番 events ルートの権限 (実認証)', () => {
  it('cancel: 権限なしstaff・閲覧専用・無認証は止まり、状態を変えない', async () => {
    const { db, raw } = createTestD1();
    seed(raw);
    const { app, env } = makeApp(db);
    const cancel = (id: string, account: string, key?: string) =>
      app.request(`/api/events/admin/events/ev-1/bookings/${id}/cancel?account_id=${account}`, {
        method: 'POST',
        headers: key ? { Authorization: `Bearer ${key}` } : {},
      }, env);

    expect((await cancel('eb-c1', 'account-1')).status).toBe(401);
    expect((await cancel('eb-c1', 'account-1', 'key-none')).status).toBe(403);
    expect((await cancel('eb-c1', 'account-1', 'key-ro')).status).toBe(403);
    // 他店舗の枠は存在しない扱い (404)。
    expect((await cancel('eb-c1', 'account-2', 'key-events')).status).toBe(404);
    for (const id of ['eb-c1']) {
      expect(raw.prepare(`SELECT status FROM event_bookings WHERE id = ?`).get(id)).toEqual({
        status: 'confirmed',
      });
    }
  });

  it('cancel: /events権限つきstaff と owner は通る', async () => {
    const { db, raw } = createTestD1();
    seed(raw);
    const { app, env } = makeApp(db);
    const cancel = (id: string, key: string) =>
      app.request(`/api/events/admin/events/ev-1/bookings/${id}/cancel?account_id=account-1`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
      }, env);

    expect((await cancel('eb-c2', 'key-events')).status).toBe(200);
    expect(raw.prepare(`SELECT status FROM event_bookings WHERE id = 'eb-c2'`).get()).toEqual({
      status: 'cancelled',
    });
    expect((await cancel('eb-c3', 'key-owner')).status).toBe(200);
    expect(raw.prepare(`SELECT status FROM event_bookings WHERE id = 'eb-c3'`).get()).toEqual({
      status: 'cancelled',
    });
  });

  it('decide: 権限なしstaff は 403、owner と /events権限つきstaff は落選できる', async () => {
    const { db, raw } = createTestD1();
    seed(raw);
    const { app, env } = makeApp(db);
    const decide = (id: string, key?: string) =>
      app.request(`/api/events/admin/events/ev-1/bookings/${id}/decide?account_id=account-1`, post('', key), env);

    expect((await decide('eb-d1', 'key-none')).status).toBe(403);
    expect(raw.prepare(`SELECT status FROM event_bookings WHERE id = 'eb-d1'`).get()).toEqual({
      status: 'requested',
    });
    expect((await decide('eb-d2', 'key-events')).status).toBe(200);
    expect(raw.prepare(`SELECT status FROM event_bookings WHERE id = 'eb-d2'`).get()).toEqual({
      status: 'rejected',
    });
    expect((await decide('eb-d3', 'key-owner')).status).toBe(200);
    expect(raw.prepare(`SELECT status FROM event_bookings WHERE id = 'eb-d3'`).get()).toEqual({
      status: 'rejected',
    });
  });
});
