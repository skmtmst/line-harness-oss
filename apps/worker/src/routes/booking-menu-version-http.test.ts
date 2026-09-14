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

function menuBody(overrides: Record<string, unknown> = {}) {
  return {
    expectedVersion: 1,
    name: 'カット',
    duration_minutes: 60,
    base_price: 8000,
    price_mode: 'fixed',
    ...overrides,
  };
}

async function saveMenu(body: unknown, menuId = 'menu-a', role: 'owner' | 'admin' | 'staff' = 'owner') {
  const { app, env } = appFor(role);
  return app.request(`/api/booking/admin/menus/${menuId}?account_id=account-a`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }, env);
}

async function menuRow(menuId = 'menu-a') {
  return db.prepare('SELECT name, price_mode, base_price, version FROM menus WHERE id = ?')
    .bind(menuId).first<{ name: string; price_mode: string; base_price: number; version: number }>();
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
  await db.prepare("DELETE FROM bookings WHERE line_account_id IN ('account-a','account-b')").run();
  await db.prepare("DELETE FROM staff_menus WHERE menu_id LIKE 'menu-%'").run();
  await db.prepare("DELETE FROM menus WHERE id LIKE 'menu-%'").run();
  await db.batch([
    db.prepare(`INSERT INTO menus (id,line_account_id,name,duration_minutes,buffer_after_minutes,base_price)
      VALUES ('menu-a','account-a','施術A',60,0,1000)`),
    db.prepare(`INSERT INTO menus (id,line_account_id,name,duration_minutes,buffer_after_minutes,base_price)
      VALUES ('menu-b','account-b','施術B',60,0,1000)`),
    db.prepare(`INSERT INTO menus (id,line_account_id,name,duration_minutes,buffer_after_minutes,base_price,deleted_at)
      VALUES ('menu-deleted','account-a','削除済み',60,0,1000,'2026-09-01T00:00:00.000')`),
  ]);
  access.canAccessAllLineAccounts.mockClear();
});

describe('予約メニュー編集の版管理 HTTP', () => {
  test('expectedVersion が無い・整数でない要求は400で、内容もversionも変えない', async () => {
    for (const body of [
      { name: 'カット', duration_minutes: 60, base_price: 8000 },
      menuBody({ expectedVersion: 0 }),
      menuBody({ expectedVersion: 1.5 }),
      menuBody({ expectedVersion: 'x' }),
    ]) {
      expect((await saveMenu(body)).status).toBe(400);
    }
    await expect(menuRow()).resolves.toEqual({ name: '施術A', price_mode: 'fixed', base_price: 1000, version: 1 });
  });

  test('同じversionへの2回目の全体PUTは409で、先の変更を消さず現在版を返す', async () => {
    const first = await saveMenu(menuBody({ name: '先に保存した名前' }));
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({ ok: true, version: 2 });

    const second = await saveMenu(menuBody({ name: '後から来た古い版', expectedVersion: 1 }));
    expect(second.status).toBe(409);
    await expect(second.json()).resolves.toMatchObject({
      success: false,
      code: 'version_conflict',
      data: { currentVersion: 2 },
    });

    await expect(menuRow()).resolves.toEqual({
      name: '先に保存した名前', price_mode: 'fixed', base_price: 8000, version: 2,
    });
  });

  test('409のあと現在版で送り直すと200で保存できる', async () => {
    expect((await saveMenu(menuBody({ name: '一度目' }))).status).toBe(200);
    expect((await saveMenu(menuBody({ name: '古い版' }))).status).toBe(409);
    const retry = await saveMenu(menuBody({ name: '読み直し後の保存', expectedVersion: 2 }));
    expect(retry.status).toBe(200);
    await expect(retry.json()).resolves.toMatchObject({ ok: true, version: 3 });
    await expect(menuRow()).resolves.toMatchObject({ name: '読み直し後の保存', version: 3 });
  });

  test('別account・不存在・削除済みのメニューは404で存在を漏らさない', async () => {
    for (const menuId of ['menu-b', 'menu-missing', 'menu-deleted']) {
      const response = await saveMenu(menuBody(), menuId);
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({ error: 'not_found' });
    }
    await expect(menuRow('menu-b')).resolves.toMatchObject({ name: '施術B', version: 1 });
  });

  test('staffはPUTできず403', async () => {
    expect((await saveMenu(menuBody(), 'menu-a', 'staff')).status).toBe(403);
    await expect(menuRow()).resolves.toMatchObject({ name: '施術A', version: 1 });
  });

  test('料金モードを fixed→free→inquiry→fixed と往復でき、free/inquiryは base_price=0 になる', async () => {
    const toFree = await saveMenu(menuBody({ price_mode: 'free', base_price: 0 }));
    expect(toFree.status).toBe(200);
    await expect(menuRow()).resolves.toMatchObject({ price_mode: 'free', base_price: 0, version: 2 });

    const toInquiry = await saveMenu(menuBody({ expectedVersion: 2, price_mode: 'inquiry', base_price: 0 }));
    expect(toInquiry.status).toBe(200);
    await expect(menuRow()).resolves.toMatchObject({ price_mode: 'inquiry', base_price: 0, version: 3 });

    const backToFixed = await saveMenu(menuBody({ expectedVersion: 3, price_mode: 'fixed', base_price: 5000 }));
    expect(backToFixed.status).toBe(200);
    await expect(menuRow()).resolves.toMatchObject({ price_mode: 'fixed', base_price: 5000, version: 4 });

    const { app, env } = appFor();
    const listed = await app.request('/api/booking/admin/menus?account_id=account-a', {}, env);
    await expect(listed.json()).resolves.toMatchObject({
      menus: [{ id: 'menu-a', price_mode: 'fixed', base_price: 5000, version: 4 }],
    });
  });

  test('free/inquiry は base_price を送っても 0 に揃え、fixed は 0〜1億の整数だけ受ける', async () => {
    const free = await saveMenu(menuBody({ price_mode: 'free', base_price: 9999 }));
    expect(free.status).toBe(200);
    await expect(menuRow()).resolves.toMatchObject({ price_mode: 'free', base_price: 0 });

    for (const basePrice of [-1, 1.5, 100_000_001]) {
      expect((await saveMenu(menuBody({ expectedVersion: 2, price_mode: 'fixed', base_price: basePrice }))).status).toBe(400);
    }
    await expect(menuRow()).resolves.toMatchObject({ price_mode: 'free', base_price: 0, version: 2 });
  });
});
