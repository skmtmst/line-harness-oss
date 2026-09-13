import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { Miniflare } from 'miniflare';

import {
  BOOKING_RESOURCE_CAPACITY_GUARD_SQL,
  bookingResourceGuardBindings,
  insertBookingWithResourceSnapshot,
} from './booking-resource-capacity.js';

type RealD1 = Awaited<ReturnType<Miniflare['getD1Database']>>;

let mf: Miniflare;
let native: RealD1;

async function applyBootstrap(db: RealD1): Promise<void> {
  const sql = readFileSync(resolve(process.cwd(), '../../packages/db/bootstrap.sql'), 'utf8')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
  const statements = sql.split('\n').reduce<string[]>((out, line) => {
    const last = out.length - 1;
    out[last] = out[last] ? `${out[last]}\n${line}` : line;
    if (line.trimEnd().endsWith(';')) out.push('');
    return out;
  }, ['']).map((statement) => statement.trim()).filter(Boolean);
  for (let index = 0; index < statements.length; index += 50) {
    await db.batch(statements.slice(index, index + 50).map((statement) => db.prepare(statement)));
  }
}

function bookingInsert(
  db: D1Database,
  input: { id: string; staffId: string; menuId: string },
): D1PreparedStatement {
  const startsAt = '2030-01-01T01:00:00.000Z';
  const blockEndsAt = '2030-01-01T02:00:00.000Z';
  return db.prepare(
    `INSERT INTO bookings
       (id,line_account_id,friend_id,staff_id,menu_id,starts_at,ends_at,
        block_ends_at,status,price_at_booking,requested_at)
     SELECT ?,?,?,?,?,?,?,?,?,?,?
      WHERE 1=1
      ${BOOKING_RESOURCE_CAPACITY_GUARD_SQL}`,
  ).bind(
    input.id, 'account-d1', 'friend-d1', input.staffId, input.menuId,
    startsAt, blockEndsAt, blockEndsAt, 'confirmed', 1000, '2029-01-01T00:00:00Z',
    ...bookingResourceGuardBindings({
      menuId: input.menuId,
      lineAccountId: 'account-d1',
      startsAt,
      blockEndsAt,
    }),
  );
}

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    d1Databases: ['DB'],
  });
  native = await mf.getD1Database('DB');
  await applyBootstrap(native);
  await native.batch([
    native.prepare(`INSERT INTO line_accounts
      (id,channel_id,name,channel_access_token,channel_secret)
    VALUES ('account-d1','channel-d1','D1店','token','secret')`),
    native.prepare(`INSERT INTO friends (id,line_user_id,display_name,line_account_id)
    VALUES ('friend-d1','U-d1','D1客','account-d1')`),
    native.prepare(`INSERT INTO staff (id,line_account_id,name,display_name)
    VALUES
      ('staff-d1-a','account-d1','担当A','担当A'),
      ('staff-d1-b','account-d1','担当B','担当B')`),
    native.prepare(`INSERT INTO menus
      (id,line_account_id,name,duration_minutes,buffer_after_minutes,base_price)
    VALUES
      ('menu-d1-a','account-d1','施術A',60,0,1000),
      ('menu-d1-b','account-d1','施術B',60,0,1000)`),
    native.prepare(`INSERT INTO booking_resources
      (id,line_account_id,name,resource_type,capacity)
    VALUES
      ('room-d1','account-d1','共用室','room',1),
      ('machine-d1','account-d1','機械','equipment',2)`),
    native.prepare(`INSERT INTO booking_menu_resources (menu_id,resource_id,quantity)
    VALUES
      ('menu-d1-a','room-d1',1), ('menu-d1-a','machine-d1',2),
      ('menu-d1-b','room-d1',1), ('menu-d1-b','machine-d1',2)`),
  ]);
}, 120_000);

afterAll(async () => { await mf?.dispose(); });

describe('予約資源の実Miniflare D1 transaction', () => {
  test('LIFF/管理相当の同時batchをメニュー・担当横断で1件だけ通す', async () => {
    const attempts = [
      { id: 'booking-d1-a', staffId: 'staff-d1-a', menuId: 'menu-d1-a' },
      { id: 'booking-d1-b', staffId: 'staff-d1-b', menuId: 'menu-d1-b' },
    ];
    const results = await Promise.all(attempts.map((attempt) =>
      insertBookingWithResourceSnapshot(native, {
        bookingInsert: bookingInsert(native, attempt),
        bookingId: attempt.id,
        lineAccountId: 'account-d1',
        menuId: attempt.menuId,
      })));
    expect(results.map((result) => result.inserted).sort()).toEqual([false, true]);
    expect(await native.prepare(`SELECT COUNT(*) AS count FROM bookings`).first())
      .toEqual({ count: 1 });
    expect(await native.prepare(`SELECT resource_id,quantity,snapshot_source
      FROM booking_resource_consumptions ORDER BY resource_id`).all()).toMatchObject({
      results: [
        { resource_id: 'machine-d1', quantity: 2, snapshot_source: 'booking' },
        { resource_id: 'room-d1', quantity: 1, snapshot_source: 'booking' },
      ],
    });
  }, 30_000);

  test('snapshot挿入が失敗したbatchは予約本体もrollbackする', async () => {
    await native.prepare(`UPDATE bookings SET status='cancelled'`).run();
    await native.prepare(`CREATE TRIGGER test_snapshot_failure
      BEFORE INSERT ON booking_resource_consumptions
      WHEN NEW.booking_id = 'booking-d1-fail'
      BEGIN SELECT RAISE(ABORT, 'forced_snapshot_failure'); END`).run();
    await expect(insertBookingWithResourceSnapshot(native, {
      bookingInsert: bookingInsert(native, {
        id: 'booking-d1-fail', staffId: 'staff-d1-a', menuId: 'menu-d1-a',
      }),
      bookingId: 'booking-d1-fail',
      lineAccountId: 'account-d1',
      menuId: 'menu-d1-a',
    })).rejects.toThrow(/forced_snapshot_failure/);
    expect(await native.prepare(`SELECT id FROM bookings WHERE id='booking-d1-fail'`).first())
      .toBeNull();
  }, 30_000);
});
