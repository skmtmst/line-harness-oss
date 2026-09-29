import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { friendAttributes } from './friend-attributes.js';
import type { Env } from '../index.js';

/*
 * V6R-S2-c: 隣り合う2つのフォルダの並びを1回で入れ替える。
 * 以前は画面が PATCH を2回送り、1回目だけ成功すると同じ番号が2つ残った。
 * 番号が同じ2つは交換しても並びが変わらなかった。
 */

let fixture: SqliteD1;
let actor: { id: string; name: string; role: 'owner' | 'admin' | 'staff'; readOnly: boolean; tenantId: string };
let app: Hono<Env>;

function req(path: string, method = 'GET', body?: unknown) {
  return app.request(path, { method, headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, { DB: fixture.db });
}
function folder(id: string, opts: { account?: string | null; order?: number; kind?: string; parent?: string | null; name?: string } = {}) {
  fixture.raw.prepare(`INSERT INTO folders(id,kind,name,account_id,parent_id,display_order,created_at,updated_at)
    VALUES(?,?,?,?,?,?,'2026-01-01','2026-01-01')`).run(
    id, opts.kind ?? 'template', opts.name ?? id, opts.account === undefined ? 'a' : opts.account, opts.parent ?? null, opts.order ?? 0);
}
function order(kind = 'template', account = 'a') {
  return (fixture.raw.prepare(`SELECT id FROM folders WHERE kind=? AND account_id=? AND parent_id IS NULL ORDER BY display_order, name`)
    .all(kind, account) as { id: string }[]).map((row) => row.id);
}

beforeEach(() => {
  fixture = createTestD1({ foreignKeys: true });
  for (const id of ['a', 'b']) {
    fixture.raw.prepare(`INSERT INTO line_accounts(id,name,channel_id,channel_secret,channel_access_token,tenant_id,created_at,updated_at)
      VALUES(?,?,?,'test-secret','test-token',?,'2026-01-01','2026-01-01')`).run(id, id, id, DEFAULT_TENANT_ID);
  }
  fixture.raw.prepare(`INSERT INTO staff_members(id,name,role,api_key,tenant_id,account_scope)
    VALUES('limited','Limited','admin','test-api-key',?,'accounts')`).run(DEFAULT_TENANT_ID);
  fixture.raw.prepare(`INSERT INTO staff_account_scopes(staff_id,line_account_id,created_at) VALUES('limited','a','2026-01-01')`).run();
  actor = { id: 'limited', name: 'Limited', role: 'admin', readOnly: false, tenantId: DEFAULT_TENANT_ID };
  app = new Hono<Env>();
  app.use('*', async (c, next) => { c.set('staff', actor); return next(); });
  app.route('/', friendAttributes);
});
afterEach(() => fixture.raw.close());

describe('フォルダの並びの入れ替え（V6R-S2-c）', () => {
  it('番号が違う2つは番号を交換し、並びが入れ替わる', async () => {
    folder('f1', { order: 1 }); folder('f2', { order: 2 }); folder('f3', { order: 3 });
    const res = await req('/api/folders/f1/swap-order', 'POST', { withId: 'f2', accountId: 'a' });
    expect(res.status).toBe(200);
    expect(order()).toEqual(['f2', 'f1', 'f3']);
  });

  it('番号が同じ2つでも並びが入れ替わる（以前は変わらなかった）', async () => {
    folder('alpha', { order: 0 }); folder('beta', { order: 0 });
    expect(order()).toEqual(['alpha', 'beta']);
    expect((await req('/api/folders/alpha/swap-order', 'POST', { withId: 'beta', accountId: 'a' })).status).toBe(200);
    expect(order()).toEqual(['beta', 'alpha']);
    // 逆向きにも戻せる
    expect((await req('/api/folders/alpha/swap-order', 'POST', { withId: 'beta', accountId: 'a' })).status).toBe(200);
    expect(order()).toEqual(['alpha', 'beta']);
  });

  it('他アカウント・種類違い・親違いのフォルダとは入れ替えない', async () => {
    folder('mine', { order: 1 }); folder('other', { account: 'b', order: 2 });
    folder('broadcast', { kind: 'broadcast', order: 3 });
    folder('parent', { order: 4 }); folder('child', { parent: 'parent', order: 5 });
    expect((await req('/api/folders/mine/swap-order', 'POST', { withId: 'other', accountId: 'a' })).status).toBe(404);
    expect((await req('/api/folders/mine/swap-order', 'POST', { withId: 'broadcast', accountId: 'a' })).status).toBe(400);
    expect((await req('/api/folders/mine/swap-order', 'POST', { withId: 'child', accountId: 'a' })).status).toBe(400);
    expect((await req('/api/folders/mine/swap-order', 'POST', { withId: 'mine', accountId: 'a' })).status).toBe(400);
    expect((await req('/api/folders/mine/swap-order', 'POST', { accountId: 'a' })).status).toBe(400);
    // どれも番号は変わらない
    expect(fixture.raw.prepare('SELECT display_order FROM folders WHERE id=?').get('mine')).toEqual({ display_order: 1 });
  });

  it('担当者（staff）は入れ替えられない', async () => {
    folder('f1', { order: 1 }); folder('f2', { order: 2 });
    actor = { ...actor, role: 'staff' };
    expect((await req('/api/folders/f1/swap-order', 'POST', { withId: 'f2', accountId: 'a' })).status).toBe(403);
    expect(order()).toEqual(['f1', 'f2']);
  });
});
