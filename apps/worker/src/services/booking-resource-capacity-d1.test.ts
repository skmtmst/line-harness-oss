import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { Miniflare } from 'miniflare';

import { updateBookingResourceSafely } from '@line-crm/db';

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

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

/** 予約batchがDBへ入る直前で止め、資源更新を先に確定させる。 */
function gateBookingBatch(
  db: D1Database,
  entered: () => void,
  release: Promise<void>,
): D1Database {
  return new Proxy(db, {
    get(target, property) {
      if (property === 'batch') {
        return async <T>(statements: D1PreparedStatement[]) => {
          entered();
          await release;
          return target.batch<T>(statements);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/** 資源UPDATEがDBへ入る直前で止め、予約batchを先に確定させる。 */
function gateResourceUpdate(
  db: D1Database,
  entered: () => void,
  release: Promise<void>,
): D1Database {
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement => new Proxy(statement, {
    get(target, property) {
      if (property === 'bind') {
        return (...values: unknown[]) => wrap(target.bind(...values));
      }
      if (property === 'run') {
        return async <T>() => {
          entered();
          await release;
          return target.run<T>();
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return new Proxy(db, {
    get(target, property) {
      if (property === 'prepare') {
        return (sql: string) => sql.startsWith('UPDATE booking_resources')
          ? wrap(target.prepare(sql))
          : target.prepare(sql);
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function createBooking(db: D1Database, id: string) {
  return insertBookingWithResourceSnapshot(db, {
    bookingInsert: bookingInsert(db, {
      id,
      staffId: 'staff-d1-a',
      menuId: 'menu-d1-a',
    }),
    bookingId: id,
    lineAccountId: 'account-d1',
    menuId: 'menu-d1-a',
  });
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

beforeEach(async () => {
  await native.batch([
    native.prepare(`DELETE FROM bookings`),
    native.prepare(`UPDATE booking_resources SET is_active=1, capacity=1 WHERE id='room-d1'`),
    native.prepare(`UPDATE booking_resources SET is_active=1, capacity=2 WHERE id='machine-d1'`),
  ]);
});

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

  test('停止が先に確定する競合では、進行中の予約batchをfail-closedにする', async () => {
    const entered = deferred();
    const release = deferred();
    const gated = gateBookingBatch(native, entered.resolve, release.promise);
    const bookingPromise = createBooking(gated, 'booking-d1-stop-first');
    await entered.promise;
    const stopped = await updateBookingResourceSafely(native, {
      lineAccountId: 'account-d1', resourceId: 'room-d1', capacity: 1, isActive: false,
      now: new Date('2029-01-01T00:00:00Z'),
    });
    release.resolve();
    const booking = await bookingPromise;
    expect(stopped).toEqual({ status: 'updated' });
    expect(booking.inserted).toBe(false);
    expect(await native.prepare(`SELECT COUNT(*) AS count FROM bookings`).first())
      .toEqual({ count: 0 });
  }, 30_000);

  test('予約が先に確定する停止競合では、snapshotを残して新規予約だけ止める', async () => {
    const entered = deferred();
    const release = deferred();
    const gated = gateResourceUpdate(native, entered.resolve, release.promise);
    const stopPromise = updateBookingResourceSafely(gated, {
      lineAccountId: 'account-d1', resourceId: 'room-d1', capacity: 1, isActive: false,
      now: new Date('2029-01-01T00:00:00Z'),
    });
    await entered.promise;
    const booking = await createBooking(native, 'booking-d1-before-stop');
    release.resolve();
    const stopped = await stopPromise;
    expect(booking.inserted).toBe(true);
    expect(stopped).toEqual({ status: 'updated' });
    expect(await native.prepare(`SELECT COUNT(*) AS count FROM booking_resource_consumptions
      WHERE booking_id='booking-d1-before-stop'`).first()).toEqual({ count: 2 });
    await expect(createBooking(native, 'booking-d1-after-stop')).resolves.toMatchObject({ inserted: false });
  }, 30_000);

  test('縮小が先に確定する競合では、必要数超過になる予約batchをfail-closedにする', async () => {
    const entered = deferred();
    const release = deferred();
    const gated = gateBookingBatch(native, entered.resolve, release.promise);
    const bookingPromise = createBooking(gated, 'booking-d1-shrink-first');
    await entered.promise;
    const shrunk = await updateBookingResourceSafely(native, {
      lineAccountId: 'account-d1', resourceId: 'machine-d1', capacity: 1, isActive: true,
      now: new Date('2029-01-01T00:00:00Z'),
    });
    release.resolve();
    const booking = await bookingPromise;
    expect(shrunk).toEqual({ status: 'updated' });
    expect(booking.inserted).toBe(false);
    expect(await native.prepare(`SELECT COUNT(*) AS count FROM bookings`).first())
      .toEqual({ count: 0 });
  }, 30_000);

  test('予約が先に確定する縮小競合では、予約snapshotを根拠に縮小を409相当で止める', async () => {
    const entered = deferred();
    const release = deferred();
    const gated = gateResourceUpdate(native, entered.resolve, release.promise);
    const shrinkPromise = updateBookingResourceSafely(gated, {
      lineAccountId: 'account-d1', resourceId: 'machine-d1', capacity: 1, isActive: true,
      now: new Date('2029-01-01T00:00:00Z'),
    });
    await entered.promise;
    const booking = await createBooking(native, 'booking-d1-before-shrink');
    release.resolve();
    const shrunk = await shrinkPromise;
    expect(booking.inserted).toBe(true);
    expect(shrunk).toEqual({ status: 'capacity_conflict', peakQuantity: 2 });
    expect(await native.prepare(`SELECT capacity FROM booking_resources WHERE id='machine-d1'`).first())
      .toEqual({ capacity: 2 });
    expect(await native.prepare(`SELECT quantity FROM booking_resource_consumptions
      WHERE booking_id='booking-d1-before-shrink' AND resource_id='machine-d1'`).first())
      .toEqual({ quantity: 2 });
  }, 30_000);
});
