import { afterEach, beforeEach, expect, it } from 'vitest';
import booking from './booking.js';
import { gapApp, gapCall, gapFixture, gapOwner } from '../test-utils/gap1.js';
import type { SqliteD1 } from '../test-utils/d1-sqlite.js';

let fixture: SqliteD1;
const path = '/api/booking/admin/menus?account_id=a';
const settings = { enabled: true, freqs: ['biweekly', 'monthly_nth'], maxCount: 6 };
const body = { name: '教室', duration_minutes: 60, base_price: 3000 };
const stored = { customer_recurring_enabled: 1, recurring_freqs_json: '["biweekly","monthly_nth"]', recurring_max_count: 6 };
beforeEach(() => { fixture = gapFixture(); });
afterEach(() => { fixture.raw.close(); });
async function readMenu(app: ReturnType<typeof gapApp>, id: string) {
  const response = await gapCall(app, path);
  expect(response.status).toBe(200);
  const result = await response.json() as { menus: Array<Record<string, unknown>> };
  return result.menus.find(menu => menu.id === id)!;
}

it('作成の保存値を一覧から読み直し、同じキーの再送ではメニューを増やさない', async () => {
  const app = gapApp(fixture, [booking]);
  const first = await gapCall(app, path, 'POST', { ...body, recurring: settings }, 'create-class');
  expect(first.status).toBe(201);
  const created = await first.json() as { id: string; version: number };
  const replay = await gapCall(app, path, 'POST', { ...body, recurring: settings }, 'create-class');
  expect(await replay.json()).toEqual(created);
  expect(await readMenu(app, created.id)).toMatchObject(stored);
  expect(fixture.raw.prepare('SELECT count(*) AS n FROM menus WHERE name=?').get('教室')).toEqual({ n: 1 });
});

it('繰り返しを保存後、関係ない項目だけ更新しても保存値を上書きしない', async () => {
  const app = gapApp(fixture, [booking]);
  const edit = '/api/booking/admin/menus/menu?account_id=a';
  expect((await gapCall(app, edit, 'PUT', { ...body, expectedVersion: 1, recurring: settings })).status).toBe(200);
  expect(await readMenu(app, 'menu')).toMatchObject(stored);
  expect((await gapCall(app, edit, 'PUT', { ...body, name: '教室の名前だけ変更', expectedVersion: 2 })).status).toBe(200);
  expect(await readMenu(app, 'menu')).toMatchObject({ ...stored, name: '教室の名前だけ変更', version: 3 });
  expect((await gapCall(app, edit, 'PUT', { ...body, expectedVersion: 2, recurring: { enabled: false, freqs: ['weekly'], maxCount: 12 } })).status).toBe(409);
  expect(await readMenu(app, 'menu')).toMatchObject({ ...stored, version: 3 });
});

it('未設定と、明示的にオフにした設定の違いをそのまま返す', async () => {
  const app = gapApp(fixture, [booking]);
  expect(await readMenu(app, 'menu')).toMatchObject({ customer_recurring_enabled: 0, recurring_freqs_json: '["weekly"]', recurring_max_count: 12 });
  expect((await gapCall(app, '/api/booking/admin/menus/menu?account_id=a', 'PUT', { ...body, expectedVersion: 1, recurring: { ...settings, enabled: false } })).status).toBe(200);
  expect(await readMenu(app, 'menu')).toMatchObject({ ...stored, customer_recurring_enabled: 0 });
});

it.each([
  { enabled: true, freqs: ['daily'], maxCount: 6 },
  { enabled: true, freqs: ['weekly'], maxCount: 13 },
])('正しくない設定は保存せず、再読取も元のまま', async recurring => {
  const app = gapApp(fixture, [booking]);
  expect((await gapCall(app, '/api/booking/admin/menus/menu?account_id=a', 'PUT', { ...body, expectedVersion: 1, recurring })).status).toBe(400);
  expect(await readMenu(app, 'menu')).toMatchObject({ customer_recurring_enabled: 0, recurring_max_count: 12, version: 1 });
});

it('閲覧のみは保存値を読めても変更できず、別店舗の一覧も読めない', async () => {
  fixture.raw.prepare('UPDATE menus SET customer_recurring_enabled=1,recurring_freqs_json=?,recurring_max_count=6').run('["biweekly","monthly_nth"]');
  const viewer = gapApp(fixture, [booking], { ...gapOwner, readOnly: true });
  expect(await readMenu(viewer, 'menu')).toMatchObject(stored);
  expect((await gapCall(viewer, '/api/booking/admin/menus/menu?account_id=a', 'PUT', { ...body, expectedVersion: 1, recurring: settings })).status).toBe(403);
  expect((await gapCall(viewer, '/api/booking/admin/menus?account_id=b')).status).toBe(403);
  expect(await readMenu(viewer, 'menu')).toMatchObject({ ...stored, version: 1 });
});
