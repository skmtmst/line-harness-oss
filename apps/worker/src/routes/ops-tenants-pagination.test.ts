import { afterEach, beforeEach, expect, test } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../worker-env.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { ops } from './ops.js';

let fixture: SqliteD1;
beforeEach(() => {
  fixture = createTestD1();
  fixture.raw.exec(`INSERT INTO staff_members(id,name,role,api_key) VALUES('operator','Synthetic operator','owner','synthetic');
    INSERT INTO platform_admins(staff_id,is_active) VALUES('operator',1);`);
  const insert = fixture.raw.prepare(`INSERT INTO tenants(id,name,status,plan_status,created_at)
    VALUES(?,?,'active',?,'2026-01-01T00:00:00')`);
  fixture.raw.transaction(() => {
    for (let i = 0; i < 601; i++) insert.run('scale-' + String(i).padStart(4, '0'), 'Scale tenant ' + i, i === 600 ? 'past_due' : 'active');
  })();
});
afterEach(() => fixture.raw.close());

function request(query: URLSearchParams) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'operator', name: 'Synthetic operator', role: 'owner', tenantId: null, readOnly: false });
    await next();
  });
  app.route('/', ops);
  return app.request('/api/ops/tenants?' + query, {}, { DB: fixture.db } as Env['Bindings']);
}

test('同じ作成日時の601社を欠落・重複なしで読み、各ページで検索全体の集計を返す', async () => {
  const query = new URLSearchParams({ q: 'Scale', limit: '100' });
  const ids: string[] = [];
  let pages = 0;
  while (true) {
    const response = await request(query);
    expect(response.status).toBe(200);
    const body = await response.json() as { data: Array<{ id: string }>; total: number; nextCursor: string | null; summary: unknown };
    expect(body.total).toBe(601);
    expect(body.summary).toEqual({ active: 601, trialing: 0, suspended: 0, pastDue: 1 });
    expect(body.data.length).toBeLessThanOrEqual(100);
    ids.push(...body.data.map(row => row.id));
    pages++;
    if (!body.nextCursor) break;
    query.set('cursor', body.nextCursor);
    expect(pages).toBeLessThan(10);
  }
  expect(pages).toBe(7);
  expect(ids).toEqual(Array.from({ length: 601 }, (_, i) => 'scale-' + String(i).padStart(4, '0')));
});

test('状態絞り込みはページと全体集計へ同じ条件で適用する', async () => {
  fixture.raw.exec("UPDATE tenants SET status='suspended' WHERE id IN ('scale-0001','scale-0600')");
  const response = await request(new URLSearchParams({ q: 'Scale', status: 'suspended', limit: '1' }));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ total: 2, data: [{ id: 'scale-0001' }], summary: { active: 2, trialing: 0, suspended: 2, pastDue: 1 } });
});

test.each<Record<string, string>>([{ limit: '0' }, { limit: '201' }, { limit: '1.5' }, { cursor: 'invalid' }, { cursor: '[1,2]' }, { cursor: '["", "id"]' }])('不正なページ条件を拒否する: %j', async params => {
  expect((await request(new URLSearchParams(params))).status).toBe(400);
});
