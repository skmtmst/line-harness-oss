import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { Miniflare } from 'miniflare';
import type { Env } from '../index.js';

const access = vi.hoisted(() => ({
  canAccessAllLineAccounts: vi.fn(async (_db: unknown, _staff: unknown, ids: string[]) => (
    ids.every((id) => id === 'account-a')
  )),
}));
vi.mock('../services/account-access.js', () => access);

const { default: booking } = await import('./booking.js');
type RealD1 = Awaited<ReturnType<Miniflare['getD1Database']>>;
let mf: Miniflare;
let db: RealD1;

async function applyBootstrap(target: RealD1): Promise<void> {
  const sql = readFileSync(resolve(process.cwd(), '../../packages/db/bootstrap.sql'), 'utf8')
    .split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n');
  const statements = sql.split('\n').reduce<string[]>((out, line) => {
    const last = out.length - 1;
    out[last] = out[last] ? `${out[last]}\n${line}` : line;
    if (line.trimEnd().endsWith(';')) out.push('');
    return out;
  }, ['']).map((statement) => statement.trim()).filter(Boolean);
  for (let index = 0; index < statements.length; index += 50) {
    await target.batch(statements.slice(index, index + 50).map((statement) => target.prepare(statement)));
  }
}

function appFor(role: 'owner' | 'admin' | 'staff' = 'owner') {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: `${role}-1`, name: role, role, readOnly: false });
    return next();
  });
  app.route('/', booking);
  return { app, env: { DB: db } as Env['Bindings'] };
}

async function save(body: unknown, menuId = 'menu-a') {
  const { app, env } = appFor();
  return app.request(`/api/booking/admin/menus/${menuId}/resources?account_id=account-a`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }, env);
}

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    d1Databases: ['DB'],
  });
  db = await mf.getD1Database('DB');
  await applyBootstrap(db);
  await db.batch([
    db.prepare(`INSERT INTO line_accounts
      (id,channel_id,name,channel_access_token,channel_secret)
      VALUES ('account-a','channel-a','A店','token','secret')`),
    db.prepare(`INSERT INTO line_accounts
      (id,channel_id,name,channel_access_token,channel_secret)
      VALUES ('account-b','channel-b','B店','token','secret')`),
  ]);
}, 120_000);

afterAll(async () => { await mf?.dispose(); });

beforeEach(async () => {
  await db.prepare("DELETE FROM booking_resource_consumptions WHERE line_account_id IN ('account-a','account-b')").run();
  await db.prepare("DELETE FROM booking_menu_resources WHERE menu_id LIKE 'menu-%'").run();
  await db.prepare("DELETE FROM bookings WHERE line_account_id IN ('account-a','account-b')").run();
  await db.prepare("DELETE FROM staff_menus WHERE menu_id LIKE 'menu-%'").run();
  await db.prepare("DELETE FROM menus WHERE id LIKE 'menu-%'").run();
  await db.prepare("DELETE FROM booking_resources WHERE line_account_id IN ('account-a','account-b')").run();
  await db.batch([
    db.prepare(`INSERT INTO menus (id,line_account_id,name,duration_minutes,buffer_after_minutes,base_price)
      VALUES ('menu-a','account-a','施術A',60,0,1000)`),
    db.prepare(`INSERT INTO menus (id,line_account_id,name,duration_minutes,buffer_after_minutes,base_price)
      VALUES ('menu-b','account-b','施術B',60,0,1000)`),
    db.prepare(`INSERT INTO booking_resources (id,line_account_id,name,resource_type,capacity,is_active)
      VALUES ('room-a','account-a','個室A','room',3,1)`),
    db.prepare(`INSERT INTO booking_resources (id,line_account_id,name,resource_type,capacity,is_active)
      VALUES ('seat-a','account-a','席A','seat',2,1)`),
    db.prepare(`INSERT INTO booking_resources (id,line_account_id,name,resource_type,capacity,is_active)
      VALUES ('stopped-a','account-a','停止中','room',5,0)`),
    db.prepare(`INSERT INTO booking_resources (id,line_account_id,name,resource_type,capacity,is_active)
      VALUES ('room-b','account-b','個室B','room',9,1)`),
    db.prepare(`INSERT INTO booking_menu_resources (menu_id,resource_id,quantity)
      VALUES ('menu-a','room-a',1)`),
  ]);
  access.canAccessAllLineAccounts.mockClear();
});

describe('予約メニュー資源割当 HTTP', () => {
  test('複数保存・GET再読込・空配列解除を実D1で行う', async () => {
    const response = await save({
      expectedVersion: 1,
      resources: [{ resourceId: 'room-a', quantity: 2 }, { resourceId: 'seat-a', quantity: 1 }],
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { version: 2, resources: [{ resourceId: 'room-a', quantity: 2 }, { resourceId: 'seat-a', quantity: 1 }] },
    });
    const { app, env } = appFor();
    const listed = await app.request('/api/booking/admin/menus?account_id=account-a', {}, env);
    const listedBody = await listed.json() as { menus: Array<{ assigned_resources: Array<{ isActive: unknown }> }> };
    expect(listedBody).toMatchObject({ menus: [{
      id: 'menu-a', version: 2,
      assigned_resources: [
        { resourceId: 'room-a', quantity: 2, isActive: true },
        { resourceId: 'seat-a', quantity: 1, isActive: true },
      ],
    }] });
    expect(listedBody.menus[0].assigned_resources.every((item) => typeof item.isActive === 'boolean')).toBe(true);
    expect((await save({ expectedVersion: 2, resources: [] })).status).toBe(200);
    await expect(db.prepare('SELECT COUNT(*) AS count FROM booking_menu_resources WHERE menu_id=?')
      .bind('menu-a').first()).resolves.toEqual({ count: 0 });
  });

  test.each([
    ['空ID', [{ resourceId: ' ', quantity: 1 }]],
    ['重複', [{ resourceId: 'room-a', quantity: 1 }, { resourceId: 'room-a', quantity: 2 }]],
    ['小数', [{ resourceId: 'room-a', quantity: 1.5 }]],
    ['0', [{ resourceId: 'room-a', quantity: 0 }]],
    ['1001', [{ resourceId: 'room-a', quantity: 1001 }]],
  ])('%sを400にして旧割当を残す', async (_label, resources) => {
    expect((await save({ expectedVersion: 1, resources })).status).toBe(400);
    await expect(db.prepare('SELECT resource_id,quantity FROM booking_menu_resources WHERE menu_id=?')
      .bind('menu-a').all()).resolves.toMatchObject({ results: [{ resource_id: 'room-a', quantity: 1 }] });
  });

  test('別account・停止・不存在・capacity超過を同じ400にし、menu不存在を404にする', async () => {
    const bodies = [
      [{ resourceId: 'room-b', quantity: 1 }],
      [{ resourceId: 'stopped-a', quantity: 1 }],
      [{ resourceId: 'missing', quantity: 1 }],
      [{ resourceId: 'room-a', quantity: 4 }],
    ];
    const errors: string[] = [];
    for (const resources of bodies) {
      const response = await save({ expectedVersion: 1, resources });
      expect(response.status).toBe(400);
      errors.push((await response.json() as { error: string }).error);
    }
    expect(new Set(errors).size).toBe(1);
    expect((await save({ expectedVersion: 1, resources: [] }, 'missing')).status).toBe(404);
  });

  test('同じversionの同時保存は1件だけ成功し、敗者は409・勝者応答へ別保存を混ぜない', async () => {
    const [first, second] = await Promise.all([
      save({ expectedVersion: 1, resources: [{ resourceId: 'room-a', quantity: 2 }] }),
      save({ expectedVersion: 1, resources: [{ resourceId: 'seat-a', quantity: 1 }] }),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const winner = first.status === 200 ? first : second;
    const body = await winner.json() as { data: { resources: Array<{ resourceId: string }> } };
    const stored = await db.prepare('SELECT resource_id FROM booking_menu_resources WHERE menu_id=?')
      .bind('menu-a').all<{ resource_id: string }>();
    expect(body.data.resources.map((item) => item.resourceId)).toEqual(
      (stored.results ?? []).map((item) => item.resource_id),
    );
  });

  test('割当後に資源を停止しても割当を残して警告し、新しい保存では停止資源を拒否する', async () => {
    expect((await save({ expectedVersion: 1, resources: [{ resourceId: 'room-a', quantity: 2 }] })).status).toBe(200);
    const { app, env } = appFor();
    const stopped = await app.request('/api/booking/admin/resources/room-a?account_id=account-a', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedVersion: 1, isActive: false }),
    }, env);
    expect(stopped.status).toBe(200);
    const listed = await app.request('/api/booking/admin/menus?account_id=account-a', {}, env);
    await expect(listed.json()).resolves.toMatchObject({ menus: [{ assigned_resources: [{
      resourceId: 'room-a', isActive: false, warning: 'resource_inactive',
    }] }] });
    expect((await save({ expectedVersion: 2, resources: [{ resourceId: 'room-a', quantity: 1 }] })).status).toBe(400);
  });

  test('割当が先ならcapacity縮小を409、縮小が先なら超過割当を400にする', async () => {
    const { app, env } = appFor();
    expect((await save({ expectedVersion: 1, resources: [{ resourceId: 'room-a', quantity: 3 }] })).status).toBe(200);
    const shrinkAfterAssignment = await app.request('/api/booking/admin/resources/room-a?account_id=account-a', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedVersion: 1, capacity: 2 }),
    }, env);
    expect(shrinkAfterAssignment.status).toBe(409);
    await expect(shrinkAfterAssignment.json()).resolves.toMatchObject({
      code: 'assignment_conflict', data: { requiredQuantity: 3 },
    });

    expect((await save({ expectedVersion: 2, resources: [] })).status).toBe(200);
    const shrinkFirst = await app.request('/api/booking/admin/resources/room-a?account_id=account-a', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedVersion: 1, capacity: 2 }),
    }, env);
    expect(shrinkFirst.status).toBe(200);
    expect((await save({ expectedVersion: 3, resources: [{ resourceId: 'room-a', quantity: 3 }] })).status).toBe(400);
  });

  test('資源削除が先なら割当400、割当が先なら削除409にする', async () => {
    const { app, env } = appFor();
    const deletedFirst = await app.request('/api/booking/admin/resources/seat-a?account_id=account-a', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedVersion: 1 }),
    }, env);
    expect(deletedFirst.status).toBe(200);
    expect((await save({ expectedVersion: 1, resources: [{ resourceId: 'seat-a', quantity: 1 }] })).status).toBe(400);

    expect((await save({ expectedVersion: 1, resources: [{ resourceId: 'room-a', quantity: 2 }] })).status).toBe(200);
    const assignmentFirst = await app.request('/api/booking/admin/resources/room-a?account_id=account-a', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedVersion: 1 }),
    }, env);
    expect(assignmentFirst.status).toBe(409);
    await expect(assignmentFirst.json()).resolves.toMatchObject({ code: 'resource_in_use' });
  });

  test('staffは保存できず、INSERT・最終UPDATE失敗は実D1で全rollbackする', async () => {
    const staff = appFor('staff');
    expect((await staff.app.request('/api/booking/admin/menus/menu-a/resources?account_id=account-a', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedVersion: 1, resources: [] }),
    }, staff.env)).status).toBe(403);

    await db.prepare(`CREATE TRIGGER fail_assignment BEFORE INSERT ON booking_menu_resources
      WHEN NEW.resource_id = 'seat-a' BEGIN SELECT RAISE(ABORT, 'injected_insert_failure'); END`).run();
    expect((await save({ expectedVersion: 1, resources: [{ resourceId: 'seat-a', quantity: 1 }] })).status).toBe(503);
    await db.prepare('DROP TRIGGER fail_assignment').run();
    await expect(db.prepare('SELECT resource_id,quantity FROM booking_menu_resources WHERE menu_id=?')
      .bind('menu-a').all()).resolves.toMatchObject({ results: [{ resource_id: 'room-a', quantity: 1 }] });

    await db.prepare(`CREATE TRIGGER fail_version BEFORE UPDATE OF version ON menus
      WHEN NEW.version > OLD.version BEGIN SELECT RAISE(ABORT, 'injected_version_failure'); END`).run();
    expect((await save({ expectedVersion: 1, resources: [] })).status).toBe(503);
    await db.prepare('DROP TRIGGER fail_version').run();
    await expect(db.prepare('SELECT version FROM menus WHERE id=?').bind('menu-a').first()).resolves.toEqual({ version: 1 });
    await expect(db.prepare('SELECT resource_id FROM booking_menu_resources WHERE menu_id=?')
      .bind('menu-a').all()).resolves.toMatchObject({ results: [{ resource_id: 'room-a' }] });
  });
});
