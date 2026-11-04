import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import ts from 'typescript';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import type { Env } from '../worker-env.js';
import type { AuthenticatedStaff } from '../middleware/auth/principal/auth.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

const actor = vi.hoisted(() => ({ role: 'staff' as 'owner' | 'admin' | 'staff', readOnly: true, edit: [] as string[], view: ['/scenarios'] as string[], proxy: false, tenant: 'count-tenant' }));
vi.mock('@line-crm/db', async original => {
  const actual = await original<typeof import('@line-crm/db')>();
  const member = () => ({ id: 'count-reader', name: '見る人', role: actor.role, tenant_id: actor.tenant, access_level: actor.readOnly ? 'read_only' : 'full', permission_keys: JSON.stringify(actor.edit), view_permission_keys: JSON.stringify(actor.view), account_scope: 'all', is_active: 1, tenant_status: 'active' });
  return { ...actual,
    getStaffByApiKey: async (_db: unknown, token: string) => token === 'count-token' ? member() : null,
    getStaffByAdminSession: async () => member(),
    getStaffById: async () => member(),
    getPlatformSetting: async () => 'false',
    getActiveImpersonation: async () => actor.proxy ? { id: 'count-proxy', staff_id: 'count-reader', tenant_id: 'count-tenant', mode: 'read', pii_revealed: 0, started_at: '2026-10-30T00:00:00Z' } : null,
    getPlatformAdminByStaffId: async () => actor.proxy ? { id: 'count-admin' } : null,
  };
});
import { authMiddleware, ADMIN_AUTH_COOKIE, CSRF_COOKIE, CSRF_HEADER } from '../middleware/auth.js';
import { broadcasts } from './broadcasts.js';
import { scenarios } from './scenarios.js';
import { requireReadOperationPermission } from '../middleware/role-guard.js';
import { app as productionApp } from '../index.js';
import { READ_OPERATION_PERMISSIONS, readOperationPermissions } from '../middleware/auth/permissions/auth.js';

let db: SqliteD1;
let statements: string[];
beforeEach(() => {
  actor.role = 'staff'; actor.readOnly = true; actor.edit = []; actor.view = ['/scenarios']; actor.proxy = false; actor.tenant = 'count-tenant';
  db = createTestD1();
  for (const id of ['count-tenant', 'other-tenant', DEFAULT_TENANT_ID]) db.raw.prepare('INSERT OR IGNORE INTO tenants(id,name) VALUES (?,?)').run(id, id);
  for (const [id, tenant] of [['count-account', 'count-tenant'], ['other-account', 'other-tenant']]) {
    db.raw.prepare('INSERT INTO line_accounts(id,name,channel_id,channel_secret,channel_access_token,tenant_id) VALUES (?,?,?,?,?,?)').run(id, id, id, 'unused', 'unused', tenant);
  }
  for (const [id, account] of [['count-one', 'count-account'], ['count-two', 'count-account'], ['other-one', 'other-account']]) {
    db.raw.prepare('INSERT INTO friends(id,line_user_id,display_name,line_account_id,is_following) VALUES (?,?,?,?,1)').run(id, id, id, account);
  }
  statements = [];
  const prepare = db.db.prepare.bind(db.db);
  vi.spyOn(db.db, 'prepare').mockImplementation(sql => { statements.push(sql); return prepare(sql); });
  // この要求は、実SQLiteでも書込のできない接続に当てる。
  db.raw.pragma('query_only = ON');
});
afterEach(() => { vi.restoreAllMocks(); db.raw.close(); });

const body = (accountId = 'count-account') => ({ accountId, conditions: { operator: 'AND', rules: [] } });
function app(auth = true, person?: AuthenticatedStaff) {
  const a = new Hono<Env>();
  if (auth) a.use('*', authMiddleware);
  else a.use('*', async (c, next) => { if (person) c.set('staff', person); await next(); });
  a.route('/', broadcasts); a.route('/', scenarios);
  a.post('/api/unregistered-read', requireReadOperationPermission(), c => c.json({ success: true }));
  return a;
}
async function request(path = '/api/segments/count', options: { account?: string; anonymous?: boolean; cookie?: boolean; csrf?: boolean; proxy?: boolean } = {}, value: unknown = body(options.account)) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (!options.anonymous) {
    if (options.cookie) { headers.Cookie = `${ADMIN_AUTH_COOKIE}=count-session; ${CSRF_COOKIE}=count-csrf`; if (options.csrf) headers[CSRF_HEADER] = 'count-csrf'; }
    else headers.Authorization = options.proxy ? 'Bearer lh_session:count-session' : 'Bearer count-token';
  }
  return app().request(path, { method: 'POST', headers, body: JSON.stringify(value) }, { DB: db.db } as Env['Bindings']);
}
function expectOnlySelectCount() {
  const counts = statements.filter(sql => /SELECT COUNT\(\*\) AS count FROM \(/.test(sql));
  expect(counts).toHaveLength(1);
  expect(counts[0]).toContain('f.line_account_id = ?');
  expect(statements.every(sql => /^\s*SELECT\b/i.test(sql))).toBe(true);
}

it.each([{keys:['/scenarios']}, {keys:['/broadcasts']}, {keys:['/scenarios', '/broadcasts']}])('閲覧鍵%sだけで自分の人数は200、保存は403のまま', async ({keys}) => {
  actor.view = keys;
  const counted = await request();
  expect(counted.status, await counted.clone().text()).toBe(200);
  expect(await counted.json()).toEqual({ success: true, count: 2 });
  expectOnlySelectCount();
  const before = statements.length;
  const saved = await request('/api/scenarios', {}, { name: '保存しない', lineAccountId: 'count-account' });
  expect(saved.status).toBe(403); expect(statements.length).toBe(before);
});

it.each([{keys:[]}, {keys:['/friends']}, {keys:['scenario.definition.edit']}])('どちらの閲覧鍵もない%sは403で集計しない', async ({keys}) => {
  actor.view = keys;
  expect((await request()).status).toBe(403);
  expect(statements).toHaveLength(0);
});

it.each(['owner', 'admin'] as const)('%sの閲覧のみでも人数は200、保存は403', async role => {
  actor.role = role; actor.view = [];
  const counted = await request(); expect(counted.status).toBe(200); expect(await counted.json()).toMatchObject({ count: 2 }); expectOnlySelectCount();
  const before = statements.length; expect((await request('/api/scenarios', {}, { name: '保存しない' })).status).toBe(403); expect(statements.length).toBe(before);
});

it('read代理は人数を読めて、保存しない', async () => {
  actor.proxy = true; actor.role = 'owner'; actor.readOnly = false; actor.view = [];
  const counted = await request('/api/segments/count', { proxy: true });
  expect(counted.status, await counted.clone().text()).toBe(200); expect(await counted.json()).toMatchObject({ count: 2 }); expectOnlySelectCount();
  const before = statements.length; expect((await request('/api/scenarios', { proxy: true }, { name: '保存しない' })).status).toBe(403); expect(statements.length).toBe(before);
});

it('他の統括のアカウントは403で、人数のSELECTを実行しない', async () => {
  expect((await request('/api/segments/count', { account: 'other-account' })).status).toBe(403);
  expect(statements.some(sql => /SELECT COUNT\(\*\) AS count FROM \(/.test(sql))).toBe(false);
});
it('匿名は401でDBを読まない', async () => { expect((await request('/api/segments/count', { anonymous: true })).status).toBe(401); expect(statements).toHaveLength(0); });
it('Cookieの読取POSTにもCSRFが必要で、正しい時だけ200', async () => {
  expect((await request('/api/segments/count', { cookie: true })).status).toBe(403);
  expect(statements).toHaveLength(0);
  expect((await request('/api/segments/count', { cookie: true, csrf: true })).status).toBe(200); expectOnlySelectCount();
});
it('入力形式の拒否は400のまま', async () => {
  const response = await request('/api/segments/count', {}, { accountId: [] }); expect(response.status).toBe(400);
  expect(statements.some(sql => /SELECT COUNT\(\*\) AS count FROM \(/.test(sql))).toBe(false);
});

it.each([{keys:['/scenarios']}, {keys:['/broadcasts']}])('共通authを省いた対照でも専用の門が%sを許可し、鍵無しを断る', async ({keys}) => {
  const person: AuthenticatedStaff = { id: 'count-reader', name: '見る人', role: 'staff', readOnly: true, tenantId: 'count-tenant', permissionKeys: [], viewPermissionKeys: keys };
  const counted = await app(false, person).request('/api/segments/count', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body()) }, { DB: db.db } as Env['Bindings']);
  expect(counted.status).toBe(200); expect(await counted.json()).toMatchObject({ count: 2 }); expectOnlySelectCount();
  statements = [];
  const denied = await app(false, { ...person, viewPermissionKeys: [] }).request('/api/segments/count', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body()) }, { DB: db.db } as Env['Bindings']);
  expect(denied.status).toBe(403); expect(statements).toHaveLength(0);
});
it('未登録の門はownerでも拒否し、書込や似た経路を読取にしない', async () => {
  const person: AuthenticatedStaff = { id: 'owner', name: '持ち主', role: 'owner', readOnly: false };
  expect((await app(false, person).request('/api/unregistered-read', { method: 'POST' }, { DB: db.db } as Env['Bindings'])).status).toBe(403);
  for (const [method, path] of [['GET', '/api/segments/count'], ['PUT', '/api/segments/count'], ['POST', '/api/segments/count-extra'], ['POST', '/api/segments/count/child'], ['POST', '/api/scenarios']]) expect(readOperationPermissions(method, path)).toBeNull();
  expect(statements).toHaveLength(0);
});

// 既知の門の呼出し・返されたmiddleware・変数aliasを、登録の引数からだけたどる。
function readGateUses(source: string) {
  const file = ts.createSourceFile('route.ts', source, ts.ScriptTarget.Latest, true);
  const imports = new Set<string>(); const aliases = new Map<string, ts.Expression>(); const calls: ts.CallExpression[] = [];
  function walk(node: ts.Node) {
    if (ts.isImportSpecifier(node) && (node.propertyName ?? node.name).text === 'requireReadOperationPermission') imports.add(node.name.text);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) aliases.set(node.name.text, node.initializer);
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ['get', 'head', 'post', 'put', 'patch', 'delete', 'all', 'use'].includes(node.expression.name.text)) calls.push(node);
    ts.forEachChild(node, walk);
  }
  walk(file);
  function isGate(node: ts.Node, seen = new Set<string>()): boolean {
    if (ts.isCallExpression(node)) return isGate(node.expression, seen);
    if (!ts.isIdentifier(node) || seen.has(node.text)) return false;
    if (imports.has(node.text)) return true;
    seen.add(node.text); const alias = aliases.get(node.text); return alias ? isGate(alias, seen) : false;
  }
  return calls.filter(call => call.arguments.slice(1).some(arg => isGate(arg))).map(call => ({
    method: (call.expression as ts.PropertyAccessExpression).name.text.toUpperCase(),
    path: call.arguments[0] && ts.isStringLiteral(call.arguments[0]) ? call.arguments[0].text : '<dynamic>',
  }));
}
it('本物の読む門は人数のPOST1経路だけに使う', () => {
  const root = resolve(import.meta.dirname, '..');
  function sources(dir: string): string[] {
    return readdirSync(dir, {withFileTypes: true}).flatMap(entry => entry.isDirectory()
      ? sources(join(dir, entry.name)) : entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [join(dir, entry.name)] : []);
  }
  const paths = sources(root);
  expect(paths.flatMap(path => readGateUses(readFileSync(path, 'utf8')))).toEqual([{ method: 'POST', path: '/api/segments/count' }]);
}, 30_000);
it('別の経路・別名での追加も棚卸しが拾い、importだけは拾わない', () => {
  const header = "import {requireReadOperationPermission as readGate} from './role-guard.js'; const stored = readGate(); const alias = readGate;";
  expect(readGateUses(header)).toEqual([]);
  expect(readGateUses(header + " app.post('/api/segments/count', stored, handler); app.put('/api/other', alias(), handler);")).toEqual([
    { method: 'POST', path: '/api/segments/count' }, { method: 'PUT', path: '/api/other' },
  ]);
});

it('読む操作の表の全行は人数POSTと2つの閲覧鍵だけ', () => {
  expect([...READ_OPERATION_PERMISSIONS]).toEqual([['POST /api/segments/count', ['/scenarios', '/broadcasts']]]);
});

it.each(['/scenarios', '/broadcasts'])('full staffでも閲覧鍵%sだけなら集計200・他の作成/保存/削除/送信403', async key => {
  actor.readOnly = false; actor.view = [key];
  expect((await request()).status).toBe(200); expectOnlySelectCount();
  const before = statements.length;
  for (const [method, path] of [
    ['POST', '/api/broadcasts'], ['PUT', '/api/broadcasts/count-draft'], ['DELETE', '/api/broadcasts/count-draft'],
    ['POST', '/api/scenarios'], ['PUT', '/api/scenarios/count-draft'], ['DELETE', '/api/scenarios/count-draft'],
    ['POST', '/api/broadcasts/count-draft/send'], ['POST', '/api/broadcasts/preflight'],
  ]) {
    const response = await app().request(path, { method, headers: { Authorization: 'Bearer count-token', 'content-type': 'application/json' }, body: JSON.stringify({ lineAccountId: 'count-account' }) }, { DB: db.db } as Env['Bindings']);
    expect(response.status, `${key} ${method} ${path}`).toBe(403);
  }
  expect(statements.length).toBe(before);
});

it.each([
  ['GET', '/api/segments/count'], ['HEAD', '/api/segments/count'], ['OPTIONS', '/api/segments/count'],
  ['PUT', '/api/segments/count'], ['PATCH', '/api/segments/count'], ['DELETE', '/api/segments/count'],
  ['POST', '/api/segments/count/'], ['POST', '/api/segments/count-extra'], ['POST', '/api/segments/count/child'],
  ['POST', '/API/segments/count'], ['POST', '/api/Segments/Count'],
])('HTTPの別形%s %sでは人数のSQLへ届かない', async (method, path) => {
  actor.readOnly = false;
  const response = await app().request(path, {
    method, headers: { Authorization: 'Bearer count-token', 'content-type': 'application/json' },
    ...(['GET', 'HEAD'].includes(method) ? {} : { body: JSON.stringify(body()) }),
  }, { DB: db.db } as Env['Bindings']);
  expect([403, 404]).toContain(response.status);
  expect(statements.some(sql => /SELECT COUNT\(\*\) AS count FROM \(/.test(sql))).toBe(false);
});

it('HTTPのqueryは経路の鍵を変えず200、methodの正規化は表の関数で確かめる', async () => {
  actor.readOnly = false;
  expect(readOperationPermissions('post', '/api/segments/count')).toEqual(['/scenarios', '/broadcasts']);
  const response = await app().request('/api/segments/count?x=1', {
    method: 'post', headers: { Authorization: 'Bearer count-token', 'content-type': 'application/json' }, body: JSON.stringify(body()),
  }, { DB: db.db } as Env['Bindings']);
  expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ count: 2 }); expectOnlySelectCount();
});

// 本番の組立てを通し、既存の監査だけを許し、業務テーブルの変化を分けて見る。
async function productionRequest(path = '/api/segments/count', value: unknown = body()) {
  db.raw.pragma('query_only = OFF');
  const tasks: Promise<unknown>[] = [];
  const response = await productionApp.request(path, {
    method: 'POST', headers: { Authorization: 'Bearer count-token', 'content-type': 'application/json' }, body: JSON.stringify(value),
  }, { DB: db.db } as Env['Bindings'], { waitUntil: (task: Promise<unknown>) => { tasks.push(task); }, passThroughOnException() {} } as ExecutionContext);
  await Promise.all(tasks);
  return response;
}
function businessRows() {
  return ['friends', 'broadcasts', 'scenarios'].map(table => db.raw.prepare(`SELECT * FROM ${table} ORDER BY id`).all());
}
it.each(['/scenarios', '/broadcasts'])('本番appで%s閲覧鍵staffは集計200、監査1行だけ・業務更新0・保存403', async key => {
  actor.readOnly = false; actor.view = [key];
  const before = businessRows();
  const response = await productionRequest();
  expect(response.status, await response.clone().text()).toBe(200); expect(await response.json()).toMatchObject({ count: 2 });
  expect(db.raw.prepare("SELECT action,result,line_account_id FROM audit_events WHERE category='business'").all()).toEqual([
    { action: 'api.post./api/segments/count', result: 'success', line_account_id: null },
  ]);
  expect(businessRows()).toEqual(before);
  expect(statements.filter(sql => /^(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql.trim())).every(sql => /\baudit_events\b/.test(sql))).toBe(true);
  const auditCount = db.raw.prepare('SELECT COUNT(*) AS count FROM audit_events').get();
  for (const path of ['/api/scenarios', '/api/broadcasts']) expect((await productionRequest(path, { lineAccountId: 'count-account' })).status).toBe(403);
  expect(businessRows()).toEqual(before); expect(db.raw.prepare('SELECT COUNT(*) AS count FROM audit_events').get()).toEqual(auditCount);
});

it('本番appで他統括403・既定統括の別名/query/配列のみ400・自然な省略も既存400', async () => {
  actor.readOnly = false;
  expect((await productionRequest('/api/segments/count', body('other-account'))).status).toBe(403);
  db.raw.prepare('UPDATE line_accounts SET tenant_id=? WHERE id=?').run(DEFAULT_TENANT_ID, 'count-account');
  actor.tenant = DEFAULT_TENANT_ID;
  statements = [];
  expect((await productionRequest('/api/segments/count', { conditions: body().conditions, account_id: 'count-account' })).status).toBe(400);
  expect((await productionRequest('/api/segments/count?account_id=count-account', { conditions: body().conditions })).status).toBe(400);
  expect(statements.some(sql => /SELECT COUNT\(\*\) AS count FROM \(/.test(sql))).toBe(false);
  for (const key of ['accountIds', 'lineAccountIds']) expect((await productionRequest('/api/segments/count', { conditions: body().conditions, [key]: ['count-account'] })).status).toBe(400);
  const response = await productionRequest('/api/segments/count', { conditions: body().conditions });
  expect(response.status, await response.clone().text()).toBe(400); expect(await response.text()).toContain('LINE_ACCOUNT_REQUIRED');
  expect(statements.some(sql => /SELECT COUNT\(\*\) AS count FROM \(/.test(sql))).toBe(false);
});

it('本番appでbroadcasts機能OFFは既存契約の403を保ち、scenarios閲覧鍵でも集計しない', async () => {
  actor.readOnly = false;
  db.raw.pragma('query_only = OFF');
  db.raw.prepare("INSERT INTO account_settings(id,line_account_id,key,value) VALUES ('feature-off','count-account','feature.broadcasts',?)").run(JSON.stringify({ enabled: false }));
  const before = businessRows();
  const response = await productionRequest();
  expect(response.status, await response.clone().text()).toBe(403);
  expect(await response.text()).toContain('FEATURE_DISABLED');
  expect(statements.some(sql => /SELECT COUNT\(\*\) AS count FROM \(/.test(sql))).toBe(false);
  expect(businessRows()).toEqual(before);
});
