/**
 * N-065 回帰テスト (5件目): イベント枠の日程変更は、枠更新より先に V6 を移す。
 *
 * 枠を先に更新すると、V6 の初回 batch 失敗後の同一リクエスト再送で
 * 旧起点が分からなくなり (old === new で reschedule を飛ばす)、
 * 移行前の行が旧日の active のまま残る。V6 先行なら失敗時は枠が untouched
 * のまま 500 になるため、再送がそのまま回復になる。
 *
 * 本物の SQLite (createTestD1) に Hono ルートを載せて確かめる。
 * 外部 LINE・Calendar へは送らない。
 */
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { Env } from '../index.js';
import { createTestD1 } from '../test-utils/d1-sqlite.js';

const accountAccessMocks = vi.hoisted(() => ({
  canAccessAllLineAccounts: vi.fn(async () => true),
}));
vi.mock('../services/account-access.js', () => accountAccessMocks);

const { default: events } = await import('./events.js');

const OLD_STARTS_AT = '2026-09-20T01:00:00.000Z';
const OLD_ENDS_AT = '2026-09-20T02:00:00.000Z';
const NEW_STARTS_AT = '2026-09-20T03:00:00.000Z';
const NEW_ENDS_AT = '2026-09-20T04:00:00.000Z';

function seed(raw: import('better-sqlite3').Database): void {
  raw.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
     VALUES ('account-1', 'channel-1', '本店', 'token', 'secret')`,
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
     VALUES ('slot-1', 'ev-1', ?, ?)`,
  ).run(OLD_STARTS_AT, OLD_ENDS_AT);
  raw.prepare(
    `INSERT INTO event_bookings
       (id, line_account_id, event_id, slot_id, friend_id, status, requested_at)
     VALUES ('eb-1', 'account-1', 'ev-1', 'slot-1', 'friend-1', 'confirmed', '2026-09-01T00:00:00.000Z')`,
  ).run();
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
  // 移行前の行 (source 未記録)。旧起点のまま残ると旧日程で送られる。
  raw.prepare(
    `INSERT INTO friend_reminders (id, friend_id, reminder_id, target_date, status)
     VALUES ('legacy-1', 'friend-1', 'rule-event-1', ?, 'active')`,
  ).run(OLD_STARTS_AT);
}

function seedTwoBookings(raw: import('better-sqlite3').Database): void {
  seed(raw);
  raw.prepare(
    `INSERT INTO friends (id, line_user_id, display_name, line_account_id, is_following)
     VALUES ('friend-2', 'U-friend-2', '佐藤たろう', 'account-1', 1)`,
  ).run();
  raw.prepare(
    `INSERT INTO event_bookings
       (id, line_account_id, event_id, slot_id, friend_id, status, requested_at)
     VALUES ('eb-2', 'account-1', 'ev-1', 'slot-1', 'friend-2', 'confirmed', '2026-09-01T00:00:00.000Z')`,
  ).run();
  raw.prepare(
    `INSERT INTO friend_reminders (id, friend_id, reminder_id, target_date, status)
     VALUES ('legacy-2', 'friend-2', 'rule-event-1', ?, 'active')`,
  ).run(OLD_STARTS_AT);
}

function makeApp(db: D1Database) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'staff-1', name: '担当者', role: 'owner', readOnly: false });
    return next();
  });
  app.route('/', events);
  return { app, env: { DB: db } };
}

async function putSlot(app: Hono<Env>, env: { DB: D1Database }) {
  return app.request('/api/events/admin/events/ev-1/slots/slot-1?account_id=account-1', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ starts_at: NEW_STARTS_AT, ends_at: NEW_ENDS_AT }),
  }, env);
}

describe('イベント枠の日程変更の再送可能性', () => {
  it('初回V6失敗では枠を変えず、同一リクエスト再送でlegacy行も新日時へ直る', async () => {
    const { db, raw } = createTestD1();
    seed(raw);
    const { app, env } = makeApp(db);

    // V6 の書き込みだけ落とす失敗注入 (枠更新は通る状態)。
    raw.exec(
      `CREATE TRIGGER v6_update_fail BEFORE UPDATE ON friend_reminders
       BEGIN SELECT RAISE(ABORT, 'injected-v6-failure'); END;`,
    );
    const failed = await putSlot(app, env);
    expect(failed.status).toBe(500);

    // 枠は untouched のまま (再送で旧起点が分かる)。
    expect(
      raw.prepare(`SELECT starts_at FROM event_slots WHERE id = 'slot-1'`).get(),
    ).toEqual({ starts_at: OLD_STARTS_AT });
    expect(
      raw.prepare(`SELECT target_date, status FROM friend_reminders WHERE id = 'legacy-1'`).get(),
    ).toEqual({ target_date: OLD_STARTS_AT, status: 'active' });

    // 同じリクエストの再送で回復する。
    raw.exec(`DROP TRIGGER v6_update_fail`);
    const retried = await putSlot(app, env);
    expect(retried.status).toBe(200);
    expect(
      raw.prepare(`SELECT starts_at FROM event_slots WHERE id = 'slot-1'`).get(),
    ).toEqual({ starts_at: NEW_STARTS_AT });
    expect(
      raw.prepare(`SELECT target_date, status FROM friend_reminders WHERE id = 'legacy-1'`).get(),
    ).toEqual({ target_date: NEW_STARTS_AT, status: 'active' });
  });

  it('2件目の失敗では1件目を旧起点へ戻し、枠は変えず再送で全件直る', async () => {
    const { db, raw } = createTestD1();
    seedTwoBookings(raw);
    const { app, env } = makeApp(db);

    // 2件目の行だけ落とす失敗注入 (1件目は通る)。
    raw.exec(
      `CREATE TRIGGER v6_second_fail BEFORE UPDATE ON friend_reminders
       WHEN OLD.id = 'legacy-2'
       BEGIN SELECT RAISE(ABORT, 'injected-second-failure'); END;`,
    );
    const failed = await putSlot(app, env);
    expect(failed.status).toBe(500);

    // 枠は untouched、1件目は補償で旧起点へ戻り、2件目も旧日のまま。
    expect(
      raw.prepare(`SELECT starts_at FROM event_slots WHERE id = 'slot-1'`).get(),
    ).toEqual({ starts_at: OLD_STARTS_AT });
    expect(
      raw.prepare(`SELECT target_date, status FROM friend_reminders WHERE id = 'legacy-1'`).get(),
    ).toEqual({ target_date: OLD_STARTS_AT, status: 'active' });
    expect(
      raw.prepare(`SELECT target_date, status FROM friend_reminders WHERE id = 'legacy-2'`).get(),
    ).toEqual({ target_date: OLD_STARTS_AT, status: 'active' });

    // 同じリクエストの再送で両件とも新日時へ直る。
    raw.exec(`DROP TRIGGER v6_second_fail`);
    const retried = await putSlot(app, env);
    expect(retried.status).toBe(200);
    expect(
      raw.prepare(`SELECT starts_at FROM event_slots WHERE id = 'slot-1'`).get(),
    ).toEqual({ starts_at: NEW_STARTS_AT });
    expect(
      raw.prepare(`SELECT target_date FROM friend_reminders WHERE id IN ('legacy-1', 'legacy-2') ORDER BY id`).all(),
    ).toEqual([
      { target_date: NEW_STARTS_AT },
      { target_date: NEW_STARTS_AT },
    ]);
  });
});
