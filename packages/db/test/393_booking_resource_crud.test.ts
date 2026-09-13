import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  createBookingResource,
  deleteBookingResourceSafely,
  listBookingAdminResources,
  updateBookingResourceSafely,
} from '../src/index.js';
import { asD1 } from './d1-test-helper.js';

describe('migration 393 予約資源CRUD', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    sqlite.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
    sqlite.exec(`
      INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
      VALUES ('account-a','channel-a','A店','token','secret'),
             ('account-b','channel-b','B店','token','secret');
      INSERT INTO friends (id,line_user_id,display_name,line_account_id)
      VALUES ('friend-a','Ua','客A','account-a');
      INSERT INTO staff (id,line_account_id,name,display_name)
      VALUES ('staff-a','account-a','担当A','担当A');
      INSERT INTO menus (id,line_account_id,name,duration_minutes,buffer_after_minutes,base_price)
      VALUES ('menu-a','account-a','施術A',60,0,1000);
      INSERT INTO booking_resources (id,line_account_id,name,resource_type,capacity)
      VALUES ('room-a','account-a','部屋A','room',5),
             ('room-b','account-b','部屋B','room',9);
      INSERT INTO booking_menu_resources (menu_id,resource_id,quantity)
      VALUES ('menu-a','room-a',2);
      INSERT INTO bookings
        (id,line_account_id,friend_id,staff_id,menu_id,starts_at,ends_at,block_ends_at,
         status,price_at_booking,requested_at)
      VALUES ('booking-a','account-a','friend-a','staff-a','menu-a',
        '2030-01-01T01:00:00Z','2030-01-01T02:00:00Z','2030-01-01T02:00:00Z',
        'confirmed',1000,'2029-01-01T00:00:00Z');
      INSERT INTO booking_resource_consumptions
        (booking_id,line_account_id,resource_id,quantity,snapshot_source)
      VALUES ('booking-a','account-a','room-a',2,'booking');
      INSERT INTO booking_availability_exceptions
        (id,line_account_id,scope_kind,scope_id,date_from,date_to,kind,hours_json)
      VALUES ('exception-a','account-a','resource','room-a','2030-01-02','2030-01-02','closed','[]');
    `);
    db = asD1(sqlite);
  });

  afterEach(() => sqlite.close());

  test('一覧は対象accountだけを一括集計し、版・更新日時・利用件数を返す', async () => {
    await expect(listBookingAdminResources(db, 'account-a')).resolves.toEqual([
      expect.objectContaining({
        id: 'room-a', lineAccountId: 'account-a', version: 1,
        usage: { menuCount: 1, bookingCount: 1, exceptionCount: 1, referenced: true },
      }),
    ]);
    await expect(listBookingAdminResources(db, 'account-b')).resolves.toEqual([
      expect.objectContaining({
        id: 'room-b', lineAccountId: 'account-b', capacity: 9,
        usage: { menuCount: 0, bookingCount: 0, exceptionCount: 0, referenced: false },
      }),
    ]);
  });

  test('作成はRETURNINGで同じ文から版付き結果を返し、再読込を必要としない', async () => {
    const created = await createBookingResource(db, {
      lineAccountId: 'account-a', name: ' 個室 ', type: ' room ', capacity: 3, isActive: true,
    });
    expect(created).toMatchObject({ lineAccountId: 'account-a', name: ' 個室 ', type: ' room ', capacity: 3, version: 1 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM booking_resources WHERE id=?').get(created.id))
      .toEqual({ count: 1 });
  });

  test('account条件とversion条件をSQLに含め、他店舗・古い画面から変更しない', async () => {
    await expect(updateBookingResourceSafely(db, {
      lineAccountId: 'account-b', resourceId: 'room-a', expectedVersion: 1,
      name: '越境', type: 'room', capacity: 5, isActive: true,
    })).resolves.toEqual({ status: 'not_found' });
    await expect(updateBookingResourceSafely(db, {
      lineAccountId: 'account-a', resourceId: 'room-a', expectedVersion: 99,
      name: '古い変更', type: 'room', capacity: 5, isActive: true,
    })).resolves.toEqual({ status: 'version_conflict', currentVersion: 1 });
    expect(sqlite.prepare('SELECT name,version FROM booking_resources WHERE id=?').get('room-a'))
      .toEqual({ name: '部屋A', version: 1 });
  });

  test('使用中縮小を拒否し、停止はsnapshotを残したまま新しい版にする', async () => {
    await expect(updateBookingResourceSafely(db, {
      lineAccountId: 'account-a', resourceId: 'room-a', expectedVersion: 1,
      name: '部屋A', type: 'room', capacity: 1, isActive: true,
      now: new Date('2029-01-01T00:00:00Z'),
    })).resolves.toEqual({ status: 'capacity_conflict', peakQuantity: 2 });
    const stopped = await updateBookingResourceSafely(db, {
      lineAccountId: 'account-a', resourceId: 'room-a', expectedVersion: 1,
      name: '部屋A', type: 'room', capacity: 1, isActive: false,
      now: new Date('2029-01-01T00:00:00Z'),
    });
    expect(stopped).toMatchObject({ status: 'updated', version: 2, item: { isActive: false, version: 2 } });
    expect(sqlite.prepare('SELECT quantity FROM booking_resource_consumptions WHERE booking_id=?').get('booking-a'))
      .toEqual({ quantity: 2 });
  });

  test('参照中は物理削除を拒否し、未参照なら版一致時だけ削除する', async () => {
    await expect(deleteBookingResourceSafely(db, {
      lineAccountId: 'account-a', resourceId: 'room-a', expectedVersion: 1,
    })).resolves.toEqual({
      status: 'reference_conflict', menuCount: 1, bookingCount: 1, exceptionCount: 1,
    });
    sqlite.prepare(`DELETE FROM booking_menu_resources WHERE resource_id = 'room-a'`).run();
    await expect(deleteBookingResourceSafely(db, {
      lineAccountId: 'account-a', resourceId: 'room-a', expectedVersion: 1,
    })).resolves.toEqual({
      status: 'reference_conflict', menuCount: 0, bookingCount: 1, exceptionCount: 1,
    });
    sqlite.prepare(`DELETE FROM booking_resource_consumptions WHERE resource_id = 'room-a'`).run();
    await expect(deleteBookingResourceSafely(db, {
      lineAccountId: 'account-a', resourceId: 'room-a', expectedVersion: 1,
    })).resolves.toEqual({
      status: 'reference_conflict', menuCount: 0, bookingCount: 0, exceptionCount: 1,
    });
    sqlite.prepare(`DELETE FROM booking_availability_exceptions WHERE scope_id = 'room-a'`).run();
    await expect(deleteBookingResourceSafely(db, {
      lineAccountId: 'account-a', resourceId: 'room-a', expectedVersion: 1,
    })).resolves.toEqual({ status: 'deleted' });

    const created = await createBookingResource(db, {
      lineAccountId: 'account-a', name: '未使用', type: 'seat', capacity: 1, isActive: true,
    });
    await expect(deleteBookingResourceSafely(db, {
      lineAccountId: 'account-a', resourceId: created.id, expectedVersion: 2,
    })).resolves.toEqual({ status: 'version_conflict', currentVersion: 1 });
    await expect(deleteBookingResourceSafely(db, {
      lineAccountId: 'account-a', resourceId: created.id, expectedVersion: 1,
    })).resolves.toEqual({ status: 'deleted' });
  });
});
