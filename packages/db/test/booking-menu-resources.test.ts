import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  listBookingMenuResourceAssignments,
  replaceBookingMenuResources,
} from '../src/index.js';
import { asD1 } from './d1-test-helper.js';

describe('予約メニューの資源割当', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    sqlite.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
    sqlite.exec(`
      INSERT INTO line_accounts (id,channel_id,name,channel_access_token,channel_secret)
      VALUES ('account-a','channel-a','A店','token','secret'),
             ('account-b','channel-b','B店','token','secret');
      INSERT INTO menus (id,line_account_id,name,duration_minutes,buffer_after_minutes,base_price)
      VALUES ('menu-a','account-a','施術A',60,0,1000),
             ('menu-b','account-b','施術B',60,0,1000);
      INSERT INTO booking_resources (id,line_account_id,name,resource_type,capacity,is_active)
      VALUES ('room-a','account-a','個室A','room',3,1),
             ('seat-a','account-a','席A','seat',2,1),
             ('stopped-a','account-a','停止中','room',5,0),
             ('room-b','account-b','個室B','room',9,1);
      INSERT INTO booking_menu_resources (menu_id,resource_id,quantity)
      VALUES ('menu-a','room-a',1);
    `);
    db = asD1(sqlite);
  });

  afterEach(() => sqlite.close());

  test('複数資源を原子的に置換し、空配列で解除してmenu版を進める', async () => {
    await expect(replaceBookingMenuResources(db, {
      menuId: 'menu-a', lineAccountId: 'account-a', expectedVersion: 1,
      resources: [{ resourceId: 'room-a', quantity: 2 }, { resourceId: 'seat-a', quantity: 1 }],
    })).resolves.toMatchObject({
      status: 'updated', version: 2,
      resources: [
        { resourceId: 'room-a', quantity: 2 },
        { resourceId: 'seat-a', quantity: 1 },
      ],
    });
    expect(sqlite.prepare('SELECT version FROM menus WHERE id=?').get('menu-a')).toEqual({ version: 2 });

    await expect(replaceBookingMenuResources(db, {
      menuId: 'menu-a', lineAccountId: 'account-a', expectedVersion: 2, resources: [],
    })).resolves.toMatchObject({ status: 'updated', version: 3, resources: [] });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM booking_menu_resources WHERE menu_id=?')
      .get('menu-a')).toEqual({ count: 0 });
  });

  test.each([
    ['別account', [{ resourceId: 'room-b', quantity: 1 }]],
    ['停止中', [{ resourceId: 'stopped-a', quantity: 1 }]],
    ['不存在', [{ resourceId: 'missing', quantity: 1 }]],
    ['capacity超過', [{ resourceId: 'room-a', quantity: 4 }]],
    ['重複', [{ resourceId: 'room-a', quantity: 1 }, { resourceId: 'room-a', quantity: 1 }]],
  ])('%s資源は存在の詳細を返さず、割当・版・更新日時を変えない', async (_label, resources) => {
    const before = sqlite.prepare('SELECT version,updated_at FROM menus WHERE id=?').get('menu-a');
    await expect(replaceBookingMenuResources(db, {
      menuId: 'menu-a', lineAccountId: 'account-a', expectedVersion: 1, resources,
    })).resolves.toEqual({ status: 'invalid_resource' });
    expect(sqlite.prepare('SELECT resource_id,quantity FROM booking_menu_resources WHERE menu_id=?').all('menu-a'))
      .toEqual([{ resource_id: 'room-a', quantity: 1 }]);
    expect(sqlite.prepare('SELECT version,updated_at FROM menus WHERE id=?').get('menu-a')).toEqual(before);
  });

  test('別accountのmenuは404、古いversionは409で旧割当を変えない', async () => {
    await expect(replaceBookingMenuResources(db, {
      menuId: 'menu-a', lineAccountId: 'account-b', expectedVersion: 1, resources: [],
    })).resolves.toEqual({ status: 'not_found' });
    await expect(replaceBookingMenuResources(db, {
      menuId: 'menu-a', lineAccountId: 'account-a', expectedVersion: 9, resources: [],
    })).resolves.toEqual({ status: 'conflict', currentVersion: 1 });
    expect(sqlite.prepare('SELECT resource_id,quantity FROM booking_menu_resources WHERE menu_id=?').all('menu-a'))
      .toEqual([{ resource_id: 'room-a', quantity: 1 }]);
  });

  test('INSERT途中失敗と最終version更新失敗はDELETEを含めてrollbackする', async () => {
    const assertOriginal = () => {
      expect(sqlite.prepare('SELECT resource_id,quantity FROM booking_menu_resources WHERE menu_id=?').all('menu-a'))
        .toEqual([{ resource_id: 'room-a', quantity: 1 }]);
      expect(sqlite.prepare('SELECT version FROM menus WHERE id=?').get('menu-a')).toEqual({ version: 1 });
    };
    sqlite.exec(`CREATE TRIGGER fail_assignment BEFORE INSERT ON booking_menu_resources
      WHEN NEW.resource_id = 'seat-a' BEGIN SELECT RAISE(ABORT, 'injected_insert_failure'); END;`);
    await expect(replaceBookingMenuResources(db, {
      menuId: 'menu-a', lineAccountId: 'account-a', expectedVersion: 1,
      resources: [{ resourceId: 'room-a', quantity: 2 }, { resourceId: 'seat-a', quantity: 1 }],
    })).rejects.toThrow(/injected_insert_failure/);
    assertOriginal();
    sqlite.exec('DROP TRIGGER fail_assignment');

    sqlite.exec(`CREATE TRIGGER fail_version BEFORE UPDATE OF version ON menus
      WHEN NEW.version > OLD.version BEGIN SELECT RAISE(ABORT, 'injected_version_failure'); END;`);
    await expect(replaceBookingMenuResources(db, {
      menuId: 'menu-a', lineAccountId: 'account-a', expectedVersion: 1,
      resources: [{ resourceId: 'seat-a', quantity: 1 }],
    })).rejects.toThrow(/injected_version_failure/);
    assertOriginal();
  });

  test('停止後も既存割当を読めて警告し、黙って削除しない', async () => {
    sqlite.prepare("UPDATE booking_resources SET is_active=0 WHERE id='room-a'").run();
    await expect(listBookingMenuResourceAssignments(db, 'account-a')).resolves.toEqual([
      expect.objectContaining({
        menuId: 'menu-a', resourceId: 'room-a', isActive: false, warning: 'resource_inactive',
      }),
    ]);
  });

  test('割当が先なら必要数未満のcapacity縮小を拒否し、停止は許可する', async () => {
    await expect(replaceBookingMenuResources(db, {
      menuId: 'menu-a', lineAccountId: 'account-a', expectedVersion: 1,
      resources: [{ resourceId: 'room-a', quantity: 3 }],
    })).resolves.toMatchObject({ status: 'updated' });
    const { updateBookingResourceSafely } = await import('../src/index.js');
    await expect(updateBookingResourceSafely(db, {
      lineAccountId: 'account-a', resourceId: 'room-a', expectedVersion: 1,
      capacity: 2, isActive: true,
    })).resolves.toEqual({ status: 'assignment_conflict', requiredQuantity: 3 });
    await expect(updateBookingResourceSafely(db, {
      lineAccountId: 'account-a', resourceId: 'room-a', expectedVersion: 1,
      capacity: 2, isActive: false,
    })).resolves.toMatchObject({ status: 'updated' });
  });

  test('helperで割当を変えても、作成済み予約の消費snapshotは不変', async () => {
    sqlite.exec(`
      INSERT INTO friends (id,line_user_id,display_name,line_account_id)
      VALUES ('friend-a','Ua','客A','account-a');
      INSERT INTO staff (id,line_account_id,name,display_name)
      VALUES ('staff-a','account-a','担当A','担当A');
      INSERT INTO bookings
        (id,line_account_id,friend_id,staff_id,menu_id,starts_at,ends_at,block_ends_at,
         status,price_at_booking,requested_at)
      VALUES ('booking-a','account-a','friend-a','staff-a','menu-a',
        '2030-01-01T01:00:00Z','2030-01-01T02:00:00Z','2030-01-01T02:00:00Z',
        'confirmed',1000,'2029-01-01T00:00:00Z');
      INSERT INTO booking_resource_consumptions
        (booking_id,line_account_id,resource_id,quantity,snapshot_source)
      VALUES ('booking-a','account-a','room-a',1,'booking');
    `);
    await expect(replaceBookingMenuResources(db, {
      menuId: 'menu-a', lineAccountId: 'account-a', expectedVersion: 1,
      resources: [{ resourceId: 'seat-a', quantity: 2 }],
    })).resolves.toMatchObject({ status: 'updated' });
    expect(sqlite.prepare(`SELECT resource_id,quantity,snapshot_source
      FROM booking_resource_consumptions WHERE booking_id='booking-a'`).all()).toEqual([
      { resource_id: 'room-a', quantity: 1, snapshot_source: 'booking' },
    ]);
  });
});
