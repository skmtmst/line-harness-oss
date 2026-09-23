import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { Miniflare } from 'miniflare';
import type { Env } from '../index.js';

/*
 * #1060: カレンダーがメニュー数ぶん往復していた空き枠取得を、
 * `menu_ids` 一括モードで1要求へまとめた口の試験。
 * 単独 `menu_id` の従来応答は変えない。
 */

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

function appFor() {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'owner-1', name: 'owner', role: 'owner', readOnly: false });
    return next();
  });
  app.route('/', booking);
  return { app, env: { DB: db } as Env['Bindings'] };
}

function getAvailability(query: string) {
  const { app, env } = appFor();
  return app.request(`/api/booking/admin/availability?account_id=account-a&${query}`, {}, env);
}

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    d1Databases: ['DB'],
  });
  db = await mf.getD1Database('DB');
  await applyBootstrap(db);
  await db.prepare(`INSERT INTO line_accounts
    (id,channel_id,name,channel_access_token,channel_secret)
    VALUES ('account-a','channel-a','A店','token','secret')`).run();
}, 120_000);

afterAll(async () => { await mf?.dispose(); });

beforeEach(async () => {
  await db.prepare("DELETE FROM menus WHERE id LIKE 'menu-%'").run();
  await db.batch([
    db.prepare(`INSERT INTO menus (id,line_account_id,name,duration_minutes,base_price)
      VALUES ('menu-a1','account-a','施術A1',60,1000)`),
    db.prepare(`INSERT INTO menus (id,line_account_id,name,duration_minutes,base_price)
      VALUES ('menu-a2','account-a','施術A2',30,2000)`),
  ]);
});

describe('空き枠の一括取得（#1060）', () => {
  test('menu_ids 指定は by_menu でメニューごとの結果を返す', async () => {
    const res = await getAvailability('menu_ids=menu-a1,menu-a2&from=2026-10-01&to=2026-10-07');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      by_menu: Array<{ menu_id: string; by_staff: unknown[] }>;
    };
    expect(body.by_menu.map((entry) => entry.menu_id)).toEqual(['menu-a1', 'menu-a2']);
    // 担当が未割当のメニューは空の by_staff を返す（落とさない）。
    for (const entry of body.by_menu) expect(entry.by_staff).toEqual([]);
  });

  test('menu_ids の重複は1件にまとめる', async () => {
    const res = await getAvailability('menu_ids=menu-a1,menu-a1&from=2026-10-01&to=2026-10-07');
    expect(res.status).toBe(200);
    const body = await res.json() as { by_menu: Array<{ menu_id: string }> };
    expect(body.by_menu).toHaveLength(1);
  });

  test('menu_ids だけで from/to が無いと400', async () => {
    const res = await getAvailability('menu_ids=menu-a1');
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'missing_params' });
  });

  test('menu_id も menu_ids も無いと400', async () => {
    const res = await getAvailability('from=2026-10-01&to=2026-10-07');
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'missing_params' });
  });

  test('menu_ids が上限（50）を超えると400', async () => {
    const ids = Array.from({ length: 51 }, (_, index) => `menu-x${index}`).join(',');
    const res = await getAvailability(`menu_ids=${ids}&from=2026-10-01&to=2026-10-07`);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'too_many_menus' });
  });

  test('menu_ids の範囲上限（28日超）は単独と同じく400', async () => {
    const res = await getAvailability('menu_ids=menu-a1&from=2026-10-01&to=2026-11-15');
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'range_too_wide' });
  });

  test('単独 menu_id の従来応答（by_staff）は変わらない', async () => {
    const res = await getAvailability('menu_id=menu-a1&from=2026-10-01&to=2026-10-07');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('by_staff');
    expect(body).not.toHaveProperty('by_menu');
  });
});
