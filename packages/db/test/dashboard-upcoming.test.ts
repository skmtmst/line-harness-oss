import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDashboardUpcoming } from '../src/dashboard-upcoming.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function asD1(sqlite: Database.Database): D1Database {
  return {
    prepare(query: string) {
      return {
        bind(...params: unknown[]) {
          const statement = sqlite.prepare(query);
          return {
            async run() { statement.run(...params); return { results: [], success: true, meta: {} }; },
            async first<T>() { return (statement.get(...params) as T) ?? null; },
            async all<T>() { return { results: statement.all(...params) as T[], success: true, meta: {} }; },
          };
        },
      };
    },
  } as unknown as D1Database;
}

const NOW = '2026-09-27T06:00:00.000Z';
const DAY = 86_400_000;
const at = (offsetDays: number, hour = 1) =>
  new Date(Date.parse(NOW) + offsetDays * DAY + hour * 3_600_000).toISOString();

// M (今後の予定): 06予約配信・07リマインダ・27予約を7日分だけ束ねる。読むだけ。
describe('dashboard upcoming', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(packageRoot, 'bootstrap.sql'), 'utf8'));
    sqlite.exec(`INSERT INTO tenants (id, name) VALUES ('tenant-a', '支社')`);
    sqlite.exec(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
       VALUES ('acc-1', 'channel-acc-1', 'acc-1', 'token', 'secret', 'tenant-a')`,
    );
    sqlite.exec(
      `INSERT INTO friends (id, line_user_id, display_name, is_following, is_hidden, line_account_id, created_at, updated_at)
       VALUES ('friend-a', 'Ua', 'あおい', 1, 0, 'acc-1', '${NOW}', '${NOW}')`,
    );
    sqlite.exec(
      `INSERT INTO menus (id, line_account_id, name, duration_minutes, base_price)
       VALUES ('menu-a', 'acc-1', '相談30分', 30, 3000)`,
    );
    sqlite.exec(`INSERT INTO reminders (id, name, is_active) VALUES ('rem-a', '来店前日', 1)`);
    sqlite.exec(
      `INSERT INTO staff (id, line_account_id, name, display_name)
       VALUES ('staff-1', 'acc-1', '担当', '担当者')`,
    );
    db = asD1(sqlite);
  });

  function seed(): void {
    sqlite.prepare(
      `INSERT INTO broadcasts (id, title, message_type, message_content, status, scheduled_at, line_account_id)
       VALUES ('bc-soon', '秋の案内', 'text', '本文', 'scheduled', ?, 'acc-1')`,
    ).run(at(2));
    sqlite.prepare(
      `INSERT INTO broadcasts (id, title, message_type, message_content, status, scheduled_at, line_account_id)
       VALUES ('bc-draft', '下書き', 'text', '本文', 'draft', ?, 'acc-1')`,
    ).run(at(1));
    sqlite.prepare(
      `INSERT INTO broadcasts (id, title, message_type, message_content, status, scheduled_at, line_account_id)
       VALUES ('bc-far', '遠い予定', 'text', '本文', 'scheduled', ?, 'acc-1')`,
    ).run(at(10));
    sqlite.prepare(
      `INSERT INTO friend_reminders (id, friend_id, reminder_id, target_date, status)
       VALUES ('fr-soon', 'friend-a', 'rem-a', ?, 'active')`,
    ).run(at(1));
    sqlite.prepare(
      `INSERT INTO friend_reminders (id, friend_id, reminder_id, target_date, status)
       VALUES ('fr-done', 'friend-a', 'rem-a', ?, 'completed')`,
    ).run(at(1, 2));
    sqlite.prepare(
      `INSERT INTO bookings (id, line_account_id, friend_id, staff_id, menu_id, starts_at, ends_at,
                             block_ends_at, status, price_at_booking, requested_at)
       VALUES ('bk-soon', 'acc-1', 'friend-a', 'staff-1', 'menu-a', ?, ?, ?, 'confirmed', 3000, ?)`,
    ).run(at(3), at(3, 2), at(3, 2), NOW);
    sqlite.prepare(
      `INSERT INTO bookings (id, line_account_id, friend_id, staff_id, menu_id, starts_at, ends_at,
                             block_ends_at, status, price_at_booking, requested_at)
       VALUES ('bk-cancel', 'acc-1', 'friend-a', 'staff-1', 'menu-a', ?, ?, ?, 'cancelled', 3000, ?)`,
    ).run(at(1, 3), at(1, 4), at(1, 4), NOW);
  }

  it('3つの機能を時刻順に束ねる', async () => {
    seed();
    const result = await getDashboardUpcoming(db, { lineAccountId: 'acc-1', now: NOW, days: 7 });
    expect(result.rangeDays).toBe(7);
    expect(result.asOf).toBe(NOW);
    expect(result.items.map((item) => item.id)).toEqual(['fr-soon', 'bc-soon', 'bk-soon']);
    expect(result.items[0]).toMatchObject({ kind: 'reminder', href: '/reminders' });
    expect(result.items[0].title).toContain('あおい');
    expect(result.items[1]).toMatchObject({ kind: 'broadcast', title: '秋の案内', href: '/broadcasts' });
    expect(result.items[2].title).toContain('相談30分');
  });

  it('下書き・済み・取消・期間外は出さない', async () => {
    seed();
    const result = await getDashboardUpcoming(db, { lineAccountId: 'acc-1', now: NOW, days: 7 });
    const ids = result.items.map((item) => item.id);
    expect(ids).not.toContain('bc-draft');
    expect(ids).not.toContain('bc-far');
    expect(ids).not.toContain('fr-done');
    expect(ids).not.toContain('bk-cancel');
  });

  it('何も無ければ空', async () => {
    const result = await getDashboardUpcoming(db, { lineAccountId: 'acc-1', now: NOW, days: 7 });
    expect(result.items).toEqual([]);
  });

  it('読むだけで表を変えず、二重実行でも同じ', async () => {
    seed();
    const countTables = () =>
      (['broadcasts', 'friend_reminders', 'bookings'] as const).map(
        (table) => (sqlite.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c,
      );
    const before = countTables();
    const first = await getDashboardUpcoming(db, { lineAccountId: 'acc-1', now: NOW, days: 7 });
    const second = await getDashboardUpcoming(db, { lineAccountId: 'acc-1', now: NOW, days: 7 });
    expect(countTables()).toEqual(before);
    expect(second).toEqual(first);
  });

  it('日数は1〜31に収める', async () => {
    const result = await getDashboardUpcoming(db, { lineAccountId: 'acc-1', now: NOW, days: 99 });
    expect(result.rangeDays).toBe(31);
  });
});
