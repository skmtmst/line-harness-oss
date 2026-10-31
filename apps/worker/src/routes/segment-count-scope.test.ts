import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import type { Env } from '../worker-env.js';
import type { AuthenticatedStaff } from '../middleware/auth/principal/auth.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { broadcasts } from './broadcasts.js';

let fixture: SqliteD1;
let statements: string[];
const conditions = { operator: 'AND', rules: [] };

beforeEach(() => {
  fixture = createTestD1();
  for (const id of [DEFAULT_TENANT_ID, 'other-tenant']) {
    fixture.raw.prepare('INSERT OR IGNORE INTO tenants(id,name) VALUES (?,?)').run(id, id);
  }
  for (const [id, tenant] of [['own-a', DEFAULT_TENANT_ID], ['own-b', DEFAULT_TENANT_ID], ['foreign', 'other-tenant']]) {
    fixture.raw.prepare('INSERT INTO line_accounts(id,name,channel_id,channel_secret,channel_access_token,tenant_id) VALUES (?,?,?,?,?,?)')
      .run(id, id, id, 'unused', 'unused', tenant);
  }
  fixture.raw.prepare("INSERT INTO staff_members(id,name,role,api_key,tenant_id,account_scope) VALUES ('counter','集計者','owner','unused',?,'all')").run(DEFAULT_TENANT_ID);
  for (const [id, account] of [['own-a', 'own-a'], ['own-b1', 'own-b'], ['own-b2', 'own-b'], ['unassigned', null], ['foreign1', 'foreign'], ['foreign2', 'foreign'], ['foreign3', 'foreign']]) {
    fixture.raw.prepare('INSERT INTO friends(id,line_user_id,display_name,line_account_id,is_following) VALUES (?,?,?,?,1)').run(id, id, id, account);
  }
  statements = [];
  const prepare = fixture.db.prepare.bind(fixture.db);
  vi.spyOn(fixture.db, 'prepare').mockImplementation(sql => { statements.push(sql); return prepare(sql); });
  fixture.raw.pragma('query_only = ON');
});
afterEach(() => { vi.restoreAllMocks(); fixture.raw.close(); });

async function count(value: Record<string, unknown> = { conditions }, query = '', person: Partial<AuthenticatedStaff> = {}) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'counter', name: '集計者', role: 'owner', readOnly: false, tenantId: DEFAULT_TENANT_ID, ...person });
    await next();
  });
  app.route('/', broadcasts);
  return app.request('/api/segments/count' + query, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value),
  }, { DB: fixture.db } as Env['Bindings']);
}

function expectNoCount() {
  expect(statements.filter(sql => /SELECT COUNT\(\*\) AS count FROM \(/.test(sql))).toHaveLength(0);
}

it('本当の省略は既定統括の2アカウントと許された未割当だけを数え、他統括3件を含めない', async () => {
  const response = await count();
  expect(response.status, await response.clone().text()).toBe(200);
  expect(await response.json()).toEqual({ success: true, count: 4 });
  expect(statements.every(sql => /^\s*SELECT\b/i.test(sql))).toBe(true);
});

it('正のaccountIdはその1アカウントだけを数える', async () => {
  const response = await count({ conditions, accountId: 'own-a' });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ success: true, count: 1 });
});

it.each(['account_id', 'line_account_id', 'lineAccountId'])('本文の別名%sだけでは400で集計しない', async key => {
  expect((await count({ conditions, [key]: 'own-a' })).status).toBe(400);
  expectNoCount();
});

it.each(['accountId', 'account_id', 'line_account_id', 'lineAccountId', 'account'])('queryの%sだけでは400で集計しない', async key => {
  expect((await count({ conditions }, `?${key}=own-a`)).status).toBe(400);
  expectNoCount();
});

it.each(['account_id', 'line_account_id', 'lineAccountId'])('本文の別名%sの不一致を400にし、一致は維持する', async key => {
  expect((await count({ conditions, accountId: 'own-a', [key]: 'own-b' })).status).toBe(400);
  expectNoCount();
  const response = await count({ conditions, accountId: 'own-a', [key]: 'own-a' });
  expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ count: 1 });
});

it.each(['accountId', 'account_id', 'line_account_id', 'lineAccountId', 'account'])('queryの%sは重複値も全て正のaccountIdと照合する', async key => {
  expect((await count({ conditions, accountId: 'own-a' }, `?${key}=own-a&${key}=own-b`)).status).toBe(400);
  expectNoCount();
  const response = await count({ conditions, accountId: 'own-a' }, `?${key}=own-a&${key}=own-a`);
  expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ count: 1 });
});

it.each([null, '', ' ', []])('正のaccountIdが不正な時は省略に化けず400: %j', async accountId => {
  expect((await count({ conditions, accountId })).status).toBe(400); expectNoCount();
});

it('他統括のaccountIdは既存の範囲の門で403にする', async () => {
  expect((await count({ conditions, accountId: 'foreign' })).status).toBe(403); expectNoCount();
});

it('既定以外の統括では本当の省略も403のまま', async () => {
  expect((await count({ conditions }, '', { tenantId: 'other-tenant' })).status).toBe(403); expectNoCount();
});

it('アカウント割当がある時は本当の省略を403のままにする', async () => {
  fixture.raw.pragma('query_only = OFF');
  fixture.raw.prepare("UPDATE staff_members SET account_scope='accounts' WHERE id='counter'").run();
  fixture.raw.prepare("INSERT INTO staff_account_scopes(staff_id,line_account_id,created_at) VALUES ('counter','own-a','2026-10-31T00:00:00Z')").run();
  fixture.raw.pragma('query_only = ON');
  expect((await count()).status).toBe(403); expectNoCount();
});

it('可視アカウントが0でも許された未割当だけを数える', async () => {
  fixture.raw.pragma('query_only = OFF');
  fixture.raw.prepare('UPDATE line_accounts SET tenant_id=? WHERE tenant_id=?').run('other-tenant', DEFAULT_TENANT_ID);
  fixture.raw.pragma('query_only = ON');
  const response = await count(); expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ count: 1 });
});

it.each([undefined, 'own-a'])('ORの条件でも集計範囲を広げない: %s', async accountId => {
  const orConditions = { operator: 'OR', rules: ['own-a', 'foreign'].map(text => ({ type: 'name', value: { text, targets: ['display'] } })) };
  const response = await count({ conditions: orConditions, ...(accountId ? { accountId } : {}) });
  expect(response.status, await response.clone().text()).toBe(200); expect(await response.json()).toMatchObject({ count: 1 });
});

it.each(['accountIds', 'lineAccountIds'])('本文の配列%sは省略に化けず400', async key => {
  for (const value of [[], ['own-a'], ['own-a', 'own-b'], null]) {
    expect((await count({ conditions, [key]: value })).status).toBe(400);
    expect((await count({ conditions, accountId: 'own-a', [key]: value })).status).toBe(400);
  }
  expectNoCount();
});

it('条件SQLの形が変わって範囲の適用ができない時は、集計せず400', async () => {
  fixture.raw.pragma('query_only = OFF');
  fixture.raw.prepare('UPDATE line_accounts SET tenant_id=? WHERE tenant_id=?').run('other-tenant', DEFAULT_TENANT_ID);
  fixture.raw.pragma('query_only = ON');
  vi.spyOn(await import('../services/segment-query.js'), 'buildPublicSegmentQuery')
    .mockReturnValue({ sql: 'SELECT f.id FROM friends AS f WHERE 1=1', bindings: [] });
  expect((await count()).status).toBe(400); expectNoCount();
});

it.each([
  { conditions: { operator: 'AND', rules: [{ type: 'tag_not_exists', value: 'missing-tag' }] } },
  { conditions: { operator: 'OR', rules: [], groups: [{ operator: 'OR', rules: ['own-a', 'foreign'].map(text => ({ type: 'name', value: { text, targets: ['display'] } })) }] } },
])('副問い合わせ・NOT・入れ子ORでも他統括を数えない: %j', async value => {
  const response = await count({ ...value, accountId: 'own-a' });
  expect(response.status, await response.clone().text()).toBe(200); expect(await response.json()).toMatchObject({ count: 1 });
});

it('大文字違いの未知のキーは範囲を広げず自然な省略と同じ', async () => {
  const response = await count({ conditions, AccountId: 'foreign' });
  expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ count: 4 });
});
