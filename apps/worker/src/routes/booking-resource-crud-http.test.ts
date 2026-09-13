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

function appFor(target: D1Database, role: 'owner' | 'admin' | 'staff' = 'owner') {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: `${role}-1`, name: role, role, readOnly: false });
    return next();
  });
  app.route('/', booking);
  return { app, env: { DB: target } as Env['Bindings'] };
}

/** 書込みRETURNINGが返った後にSELECTがあれば落とし、commit後再読込を検出する。 */
function rejectReadsAfterWrite(target: D1Database): D1Database {
  let written = false;
  const wrap = (statement: D1PreparedStatement, isWrite: boolean): D1PreparedStatement => new Proxy(statement, {
    get(inner, property) {
      if (property === 'bind') return (...values: unknown[]) => wrap(inner.bind(...values), isWrite);
      if (property === 'first') return async <T>() => {
        const value = await inner.first<T>();
        if (isWrite) written = true;
        return value;
      };
      const value = Reflect.get(inner, property, inner);
      return typeof value === 'function' ? value.bind(inner) : value;
    },
  });
  return new Proxy(target, {
    get(inner, property) {
      if (property === 'prepare') return (sql: string) => {
        if (written && /^\s*SELECT\b/i.test(sql)) throw new Error('post_write_read_forbidden');
        return wrap(inner.prepare(sql), /^\s*(?:INSERT|UPDATE)\b/i.test(sql));
      };
      const value = Reflect.get(inner, property, inner);
      return typeof value === 'function' ? value.bind(inner) : value;
    },
  });
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
  await db.prepare('DELETE FROM booking_resources').run();
  access.canAccessAllLineAccounts.mockClear();
});

describe('予約設備 CRUD HTTP', () => {
  test('ownerが作成・再読込・版付き編集・停止再開・削除できる', async () => {
    const { app, env } = appFor(db);
    const created = await app.request('/api/booking/admin/resources?account_id=account-a', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '個室', type: 'room', capacity: 2 }),
    }, env);
    expect(created.status).toBe(201);
    const item = (await created.json() as { data: { id: string; version: number; usage: unknown } }).data;
    expect(item).toMatchObject({ version: 1, usage: { menuCount: 0, bookingCount: 0, exceptionCount: 0, referenced: false } });

    const listed = await app.request('/api/booking/admin/resources?account_id=account-a', {}, env);
    await expect(listed.json()).resolves.toMatchObject({ data: { resources: [{ id: item.id, version: 1 }] } });

    const updated = await app.request(`/api/booking/admin/resources/${item.id}?account_id=account-a`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedVersion: 1, name: '大個室', capacity: 3, isActive: false }),
    }, env);
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({ data: { name: '大個室', capacity: 3, isActive: false, version: 2 } });

    const restarted = await app.request(`/api/booking/admin/resources/${item.id}?account_id=account-a`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedVersion: 2, isActive: true }),
    }, env);
    expect(restarted.status).toBe(200);
    await expect(restarted.json()).resolves.toMatchObject({ data: { isActive: true, version: 3 } });

    const removed = await app.request(`/api/booking/admin/resources/${item.id}?account_id=account-a`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedVersion: 3 }),
    }, env);
    expect(removed.status).toBe(200);
  });

  test('staff・別account・古いversionを拒否し、nullや余計な項目を省略扱いにしない', async () => {
    const owner = appFor(db);
    const created = await owner.app.request('/api/booking/admin/resources?account_id=account-a', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '席', type: 'seat', capacity: 1 }),
    }, owner.env);
    const id = (await created.json() as { data: { id: string } }).data.id;

    const staff = appFor(db, 'staff');
    expect((await staff.app.request('/api/booking/admin/resources?account_id=account-a', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '不可', type: 'seat', capacity: 1 }),
    }, staff.env)).status).toBe(403);
    expect((await owner.app.request('/api/booking/admin/resources?account_id=account-b', {}, owner.env)).status).toBe(403);
    expect((await owner.app.request(`/api/booking/admin/resources/${id}?account_id=account-a`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedVersion: 99, name: '古い変更' }),
    }, owner.env)).status).toBe(409);
    expect((await owner.app.request(`/api/booking/admin/resources/${id}?account_id=account-a`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedVersion: 1, name: null }),
    }, owner.env)).status).toBe(400);
    expect((await owner.app.request('/api/booking/admin/resources?account_id=account-a', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '余計', type: 'seat', capacity: 1, expectedVersion: 1 }),
    }, owner.env)).status).toBe(400);
  });

  test('作成・更新はcommit後SELECTなしで成功し、応答失敗を保存失敗と誤認させない', async () => {
    const guardedCreate = appFor(rejectReadsAfterWrite(db));
    const created = await guardedCreate.app.request('/api/booking/admin/resources?account_id=account-a', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '再試行安全', type: 'room', capacity: 2 }),
    }, guardedCreate.env);
    expect(created.status).toBe(201);
    const id = (await created.json() as { data: { id: string } }).data.id;

    const guardedUpdate = appFor(rejectReadsAfterWrite(db));
    const updated = await guardedUpdate.app.request(`/api/booking/admin/resources/${id}?account_id=account-a`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedVersion: 1, capacity: 3 }),
    }, guardedUpdate.env);
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({ data: { capacity: 3, version: 2 } });
  });
});
