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

async function putStaffMenus(staffId: string, menus: unknown, role: 'owner' | 'admin' | 'staff' = 'owner') {
  const { app, env } = appFor(role);
  return app.request(`/api/booking/admin/staff/${staffId}/menus?account_id=account-a`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ menus }),
  }, env);
}

async function putStaffMenusBulk(staff: unknown, role: 'owner' | 'admin' | 'staff' = 'owner') {
  const { app, env } = appFor(role);
  return app.request('/api/booking/admin/staff-menus?account_id=account-a', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ staff }),
  }, env);
}

async function getStaffMenusBulk(accountId = 'account-a', role: 'owner' | 'admin' | 'staff' = 'owner') {
  const { app, env } = appFor(role);
  return app.request(`/api/booking/admin/staff-menus?account_id=${accountId}`, {}, env);
}

async function staffMenuRows(staffId: string) {
  const { results } = await db
    .prepare('SELECT menu_id, is_offered, override_duration_minutes, override_price FROM staff_menus WHERE staff_id = ? ORDER BY menu_id')
    .bind(staffId)
    .all<{ menu_id: string; is_offered: number; override_duration_minutes: number | null; override_price: number | null }>();
  return results;
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
  await db.prepare("DELETE FROM staff_menus WHERE staff_id LIKE 'staff-%'").run();
  await db.prepare("DELETE FROM staff WHERE id LIKE 'staff-%'").run();
  await db.prepare("DELETE FROM menus WHERE id LIKE 'menu-%'").run();
  await db.batch([
    db.prepare(`INSERT INTO staff (id,line_account_id,name,display_name)
      VALUES ('staff-a1','account-a','スタッフA1','A1')`),
    db.prepare(`INSERT INTO staff (id,line_account_id,name,display_name)
      VALUES ('staff-a2','account-a','スタッフA2','A2')`),
    db.prepare(`INSERT INTO staff (id,line_account_id,name,display_name)
      VALUES ('staff-b1','account-b','スタッフB1','B1')`),
    db.prepare(`INSERT INTO staff (id,line_account_id,name,display_name,deleted_at)
      VALUES ('staff-deleted','account-a','削除済み','D','2026-09-01T00:00:00.000')`),
    db.prepare(`INSERT INTO menus (id,line_account_id,name,duration_minutes,base_price)
      VALUES ('menu-a1','account-a','施術A1',60,1000)`),
    db.prepare(`INSERT INTO menus (id,line_account_id,name,duration_minutes,base_price)
      VALUES ('menu-a2','account-a','施術A2',30,2000)`),
    db.prepare(`INSERT INTO menus (id,line_account_id,name,duration_minutes,base_price)
      VALUES ('menu-b1','account-b','施術B1',60,3000)`),
    db.prepare(`INSERT INTO staff_menus (staff_id,menu_id,is_offered,override_price)
      VALUES ('staff-a1','menu-a1',1,1500)`),
  ]);
  access.canAccessAllLineAccounts.mockClear();
});

describe('staff×menu 割り当て保存の原子性', () => {
  test('単独PUTでINSERTが失敗しても既存の割り当てが消えない', async () => {
    // menu_id 重複で2回目のINSERTが主キー違反になる。DELETEとINSERTが
    // 別トランザクションだと、ここで既存行だけが消えてしまう。
    const res = await putStaffMenus('staff-a1', [
      { menu_id: 'menu-a1', is_offered: false },
      { menu_id: 'menu-a1', is_offered: true },
    ]);
    expect(res.status).not.toBe(200);
    await expect(staffMenuRows('staff-a1')).resolves.toEqual([
      { menu_id: 'menu-a1', is_offered: 1, override_duration_minutes: null, override_price: 1500 },
    ]);
  });

  test('単独PUTはDELETE+INSERTをまとめて適用し、account外のmenu_idは従来どおり無視する', async () => {
    const res = await putStaffMenus('staff-a1', [
      { menu_id: 'menu-a2', is_offered: true, override_duration_minutes: 45, override_price: null },
      { menu_id: 'menu-b1', is_offered: true },
      { menu_id: 'menu-missing', is_offered: true },
    ]);
    expect(res.status).toBe(200);
    await expect(staffMenuRows('staff-a1')).resolves.toEqual([
      { menu_id: 'menu-a2', is_offered: 1, override_duration_minutes: 45, override_price: null },
    ]);
  });

  test('一括口は全スタッフ分を1要求で保存する', async () => {
    const res = await putStaffMenusBulk([
      { staff_id: 'staff-a1', menus: [
        { menu_id: 'menu-a2', is_offered: true, override_price: 2500 },
      ] },
      { staff_id: 'staff-a2', menus: [
        { menu_id: 'menu-a1', is_offered: true },
        { menu_id: 'menu-a2', is_offered: false },
      ] },
    ]);
    expect(res.status).toBe(200);
    await expect(staffMenuRows('staff-a1')).resolves.toEqual([
      { menu_id: 'menu-a2', is_offered: 1, override_duration_minutes: null, override_price: 2500 },
    ]);
    await expect(staffMenuRows('staff-a2')).resolves.toEqual([
      { menu_id: 'menu-a1', is_offered: 1, override_duration_minutes: null, override_price: null },
      { menu_id: 'menu-a2', is_offered: 0, override_duration_minutes: null, override_price: null },
    ]);
  });

  test('一括口は別account・不存在・削除済みのstaff_idを含むと全体を拒否し、既存行を変えない', async () => {
    for (const staffId of ['staff-b1', 'staff-missing', 'staff-deleted']) {
      const res = await putStaffMenusBulk([
        { staff_id: 'staff-a1', menus: [{ menu_id: 'menu-a2', is_offered: true }] },
        { staff_id: staffId, menus: [{ menu_id: 'menu-a1', is_offered: true }] },
      ]);
      expect(res.status).toBe(404);
      await expect(res.json()).resolves.toMatchObject({ error: 'staff_not_found_in_account' });
    }
    // 拒否されたので staff-a1 の既存割り当てはそのまま。
    await expect(staffMenuRows('staff-a1')).resolves.toEqual([
      { menu_id: 'menu-a1', is_offered: 1, override_duration_minutes: null, override_price: 1500 },
    ]);
    await expect(staffMenuRows('staff-b1')).resolves.toEqual([]);
  });

  test('一括口は別account・不存在のmenu_idを含むと全体を拒否し、既存行を変えない', async () => {
    for (const menuId of ['menu-b1', 'menu-missing']) {
      const res = await putStaffMenusBulk([
        { staff_id: 'staff-a1', menus: [{ menu_id: 'menu-a2', is_offered: true }] },
        { staff_id: 'staff-a2', menus: [{ menu_id: menuId, is_offered: true }] },
      ]);
      expect(res.status).toBe(404);
      await expect(res.json()).resolves.toMatchObject({ error: 'menu_not_found_in_account' });
    }
    await expect(staffMenuRows('staff-a1')).resolves.toEqual([
      { menu_id: 'menu-a1', is_offered: 1, override_duration_minutes: null, override_price: 1500 },
    ]);
    await expect(staffMenuRows('staff-a2')).resolves.toEqual([]);
  });

  test('一括口は同じstaff_idの重複を422で拒否する', async () => {
    const res = await putStaffMenusBulk([
      { staff_id: 'staff-a1', menus: [] },
      { staff_id: 'staff-a1', menus: [] },
    ]);
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({ error: 'duplicate_staff_id' });
  });

  test('一括口もstaffロールでは403', async () => {
    const res = await putStaffMenusBulk([{ staff_id: 'staff-a1', menus: [] }], 'staff');
    expect(res.status).toBe(403);
    await expect(staffMenuRows('staff-a1')).resolves.toEqual([
      { menu_id: 'menu-a1', is_offered: 1, override_duration_minutes: null, override_price: 1500 },
    ]);
  });
});

describe('担当割り当ての一括読み取り（#1060: 一覧のN+1解消）', () => {
  test('全スタッフ分のmatrixを1応答で返す（未割当はis_offered=0）', async () => {
    const res = await getStaffMenusBulk();
    expect(res.status).toBe(200);
    const body = await res.json() as {
      staff: Array<{
        staff_id: string;
        matrix: Array<{
          menu_id: string; name: string; is_offered: number;
          override_duration_minutes: number | null; override_price: number | null;
        }>;
      }>;
    };
    // 削除済みは含めず、アカウント内のスタッフ全員が出る。
    expect(body.staff.map((entry) => entry.staff_id).sort()).toEqual(['staff-a1', 'staff-a2']);
    const a1 = body.staff.find((entry) => entry.staff_id === 'staff-a1');
    const a2 = body.staff.find((entry) => entry.staff_id === 'staff-a2');
    // 全メニュー分の行を返す（単独GETと同じ器）。
    expect(a1?.matrix.map((row) => row.menu_id).sort()).toEqual(['menu-a1', 'menu-a2']);
    expect(a1?.matrix.find((row) => row.menu_id === 'menu-a1')).toMatchObject({
      is_offered: 1, override_price: 1500,
    });
    expect(a1?.matrix.find((row) => row.menu_id === 'menu-a2')).toMatchObject({ is_offered: 0 });
    expect(a2?.matrix.every((row) => row.is_offered === 0)).toBe(true);
  });

  test('アクセス権の無いアカウントには403（別アカウントの行は出ない）', async () => {
    // canAccessAllLineAccounts のモックは account-a だけを許可する。
    const res = await getStaffMenusBulk('account-b');
    expect(res.status).toBe(403);
  });

  test('account_id が無ければ400', async () => {
    const { app, env } = appFor();
    const res = await app.request('/api/booking/admin/staff-menus', {}, env);
    expect(res.status).toBe(400);
  });
});
