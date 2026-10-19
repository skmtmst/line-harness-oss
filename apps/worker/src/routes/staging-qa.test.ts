import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { stagingQa } from './staging-qa.js';
import { lineProxy } from './line-proxy.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import type { Env } from '../worker-env.js';
import type { AuthenticatedStaff } from '../middleware/auth/principal/auth.js';
import { authenticateApiToken, sha256Hex } from '../middleware/auth.js';
import { resolveImpersonation } from '../middleware/impersonation.js';
import { QA_PREFIX, QA_STAGING_DATABASE, qaSafeBindings, withQaOutboundBoundary, type QaRun } from '../services/staging-qa-safety.js';

import { verifyPassword } from '../services/password-hash.js';
import { getVisibleLineAccountScope } from '../services/account-access.js';

const BASE = '/api/ops/staging-qa';
let fixture: SqliteD1;
let env: Env['Bindings'];
let staff: AuthenticatedStaff;
let app: Hono<Env>;
let network: ReturnType<typeof vi.fn>;

function request(path: string, method = 'GET', body?: unknown, overrides = {}) {
  return app.request(`https://stg-api.musubo.jp${BASE}${path}`, {
    method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined || method === 'GET' ? {} : { body: JSON.stringify(body) }),
  }, { ...env, ...overrides });
}
async function create(): Promise<QaRun> {
  const response = await request('/runs', 'POST', { passwords: { hq: 'HqPass123', store: 'Store123', viewer: 'Viewer123', impersonation: 'Proxy123' } });
  expect(response.status).toBe(201);
  const value = await response.json() as { data: QaRun };
  return value.data;
}

beforeEach(() => {
  fixture = createTestD1({ foreignKeys: true });
  fixture.raw.exec(`INSERT INTO staff_members(id,name,role,api_key) VALUES ('qa-operator','QA operator','owner','operator-key');
    INSERT INTO platform_admins(staff_id) VALUES ('qa-operator');
    INSERT INTO tenants(id,name) VALUES ('unrelated-tenant','Unrelated');
    INSERT INTO line_accounts(id,tenant_id,channel_id,name,channel_access_token,channel_secret) VALUES ('unrelated-account','unrelated-tenant','unrelated-channel','Unrelated','real-token','real-secret');`);
  staff = { id: 'qa-operator', name: 'QA operator', role: 'owner', readOnly: false };
  env = { DB: fixture.db, DEPLOY_ENV: 'staging', WORKER_NAME: 'nen-line-stg', D1_DATABASE_ID: QA_STAGING_DATABASE,
    WORKER_PUBLIC_URL: 'https://stg-api.musubo.jp', WORKER_URL: 'https://stg-api.musubo.jp',
    ADMIN_ORIGIN: 'https://stg-admin.musubo.jp', STAGING_QA_ENABLED: 'true', STAGING_QA_OUTBOUND_DISABLED: 'true', RESTAURANT_TEST_ENABLED: 'true',
  } as Env['Bindings'];
  network = vi.fn(async () => Response.json({ unexpected: true }));
  vi.stubGlobal('fetch', network);
  app = new Hono<Env>();
  app.use('*', async (c, next) => { c.set('staff', staff); c.env = qaSafeBindings(c.env); return withQaOutboundBoundary(c.env, next); });
  app.route('/', stagingQa);
  app.route('/', lineProxy);
  app.get('/api/qa-test-resolve-impersonation', async c => c.json(await resolveImpersonation(c, staff, '/api/friends')));
});
afterEach(() => { fixture.raw.close(); vi.unstubAllGlobals(); });

describe('Q-75 control boundary', () => {
  test.each([
    { DEPLOY_ENV: 'production' }, { DEPLOY_ENV: undefined }, { DEPLOY_ENV: 'development' },
    { WORKER_NAME: 'nen-line' }, { D1_DATABASE_ID: '5b0fcea8-e05e-42bf-9efa-f2bc4c459552' },
    { WORKER_PUBLIC_URL: 'https://api.musubo.jp' }, { STAGING_QA_ENABLED: 'false' }, { STAGING_QA_OUTBOUND_DISABLED: 'false' },
  ])('拒否: %j。DBにも外部にも書き込まない', async overrides => {
    const before = fixture.raw.prepare('SELECT COUNT(*) n FROM tenants').get();
    for (const [path, method] of [['/safety', 'GET'], ['/runs', 'POST'], ['/runs/fake', 'DELETE'], ['/runs/fake/cron', 'POST'], ['/runs/fake/session', 'POST']] as const) {
      expect((await request(path, method, {}, overrides)).status).toBe(404);
    }
    expect(fixture.raw.prepare('SELECT COUNT(*) n FROM tenants').get()).toEqual(before);
    expect(network).not.toHaveBeenCalled();
  });
  test('運営以外・閲覧のみ・環境APIキーの疑似ownerは操作不可', async () => {
    for (const user of [
      { ...staff, id: 'other-owner', tenantId: 'unrelated-tenant' }, { ...staff, readOnly: true }, { ...staff, id: 'env-owner' },
    ]) {
      staff = user;
      expect((await request('/safety')).status).toBe(403);
      expect((await request('/runs', 'POST', {})).status).toBe(403);
    }
  });
  test('不正な本文と人数・任意IDを拒否', async () => {
    expect((await request('/runs', 'POST', {})).status).toBe(400);
    expect((await request('/runs', 'POST', { passwords: {} })).status).toBe(400);
    const run = await create();
    expect((await request(`/runs/${run.id}/friends`, 'POST', { count: 21 })).status).toBe(400);
    expect((await request(`/runs/${crypto.randomUUID()}/friends`, 'POST', { count: 1 })).status).toBe(404);
    expect((await request(`/runs/${run.id}/cron`, 'POST', { job: '* * * * *', requestId: 'all' })).status).toBe(400);
  });
});

test('4役と模擬接続を隔離して作る。既存の認証・スコープで役割を確かめる', async () => {
  const run = await create();
  expect(JSON.stringify(run)).not.toMatch(/password|token|secret|api_key|Pass123/);
  for (const user of run.users) {
    const row = fixture.raw.prepare('SELECT * FROM staff_members WHERE id=?').get(user.id) as { password_hash: string; api_key: string; access_level: string; role: string };
    const passwords = { hq: 'HqPass123', store: 'Store123', viewer: 'Viewer123', impersonation: 'Proxy123' };
    expect(await verifyPassword(passwords[user.role], row.password_hash)).toBe(true);
    const authenticated = await authenticateApiToken({ env, req: { path: '/api/friends' } } as import('hono').Context<Env>, row.api_key);
    expect(authenticated).not.toBeNull();
    expect(authenticated?.readOnly).toBe(user.role === 'viewer' || user.role === 'impersonation');
    const scope = await getVisibleLineAccountScope(fixture.db, authenticated!);
    expect(scope.ids).toEqual([run.accountId]);
  }
  expect(fixture.raw.prepare('SELECT COUNT(*) n FROM platform_admins').get()).toEqual({ n: 1 });
  expect(network).not.toHaveBeenCalled();
});

test('試験セッションは運営だけが発行し、秘密は本文に出さない。取消でセッションを失効', async () => {
  const run = await create();
  const response = await request(`/runs/${run.id}/session`, 'POST', { role: 'viewer' });
  expect(response.status).toBe(200);
  expect(response.headers.get('set-cookie')).toMatch(/HttpOnly/);
  expect(JSON.stringify(await response.json())).not.toMatch(/sessionToken|csrfToken|password|secret/);
  expect(fixture.raw.prepare('SELECT COUNT(*) n FROM admin_sessions').get()).toEqual({ n: 1 });
  expect((await request(`/runs/${run.id}`, 'DELETE')).status).toBe(200);
  expect(fixture.raw.prepare('SELECT COUNT(*) n FROM admin_sessions').get()).toEqual({ n: 0 });
  expect((await request(`/runs/${run.id}/session`, 'POST', { role: 'viewer' })).status).toBe(404);
});

test('代理ログインは本人の既存セッションと再確認を必須にして、実際の代理機構を使う', async () => {
  const run = await create();
  expect((await request(`/runs/${run.id}/session`, 'POST', { role: 'impersonation' })).status).toBe(403);
  const token = 'qa-operator-session', tokenHash = await sha256Hex(token);
  fixture.raw.prepare('INSERT INTO admin_sessions(token_hash,staff_id,expires_at) VALUES (?,?,?)')
    .run(tokenHash, staff.id, new Date(Date.now() + 60_000).toISOString());
  const proxySession = () => app.request(`https://stg-api.musubo.jp${BASE}/runs/${run.id}/session`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer lh_session:${token}` }, body: JSON.stringify({ role: 'impersonation' }),
  }, env);
  expect((await proxySession()).status).toBe(401);
  fixture.raw.prepare('UPDATE admin_sessions SET step_up_at=? WHERE token_hash=?').run(new Date().toISOString(), tokenHash);
  expect((await proxySession()).status).toBe(200);
  const resolved = await app.request('https://stg-api.musubo.jp/api/qa-test-resolve-impersonation', { headers: { Authorization: `Bearer lh_session:${token}` } }, env);
  expect(await resolved.json()).toMatchObject({ staff: { id: staff.id, readOnly: true, tenantId: run.tenantId }, context: { mode: 'read', tenantId: run.tenantId } });
  await request(`/runs/${run.id}`, 'DELETE');
  expect(fixture.raw.prepare('SELECT COUNT(*) n FROM impersonation_sessions WHERE tenant_id=? AND ended_at IS NULL').get(run.tenantId)).toEqual({ n: 0 });
});

test('台帳から作成分を再取得でき、一覧・詳細にも秘密の値が含まれない', async () => {
  const run = await create();
  const list = await request('/runs');
  expect(list.status).toBe(200);
  const serialized = JSON.stringify(await list.json());
  expect(serialized).toContain(run.id);
  expect(serialized).not.toMatch(/password|token|secret|api_key|Pass123/);
  expect(await (await request(`/runs/${run.id}`)).json()).toMatchObject({ data: run });
  expect((await request('/runs?after=bad')).status).toBe(400);
});

test('試験友だちだけLINE模擬成功。通常の送り先・実トークンは遮断し、外部通信0', async () => {
  const run = await create();
  const created = await request(`/runs/${run.id}/friends`, 'POST', { count: 2 });
  expect(created.status).toBe(201);
  const { data } = await created.json() as { data: { friends: Array<{ id: string; lineUserId: string }> } };
  const token = (fixture.raw.prepare('SELECT channel_access_token token FROM line_accounts WHERE id=?').get(run.accountId) as { token: string }).token;
  const send = (token: string, to: string) => withQaOutboundBoundary(env, () => fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ to, messages: [{ type: 'text', text: 'QA synthetic' }] }),
  }));
  expect((await send(token, data.friends[0]!.lineUserId)).headers.get('x-staging-qa-simulated')).toBe('true');
  await expect(send(token, `U${'b'.repeat(32)}`)).rejects.toThrow('STAGING_QA_OUTBOUND_BLOCKED');
  await expect(send('real-token', data.friends[0]!.lineUserId)).rejects.toThrow('STAGING_QA_OUTBOUND_BLOCKED');
  // Exercise the actual Harness proxy as well: it must preserve its history and manual-source behavior.
  const proxy = await app.request('https://stg-api.musubo.jp/line-api/v2/bot/message/push', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Line-Harness-Source': 'manual' },
    body: JSON.stringify({ to: data.friends[0]!.lineUserId, messages: [{ type: 'text', text: 'QA reply' }] }),
  }, env);
  expect(proxy.status).toBe(200);
  expect(fixture.raw.prepare('SELECT COUNT(*) n FROM messages_log WHERE friend_id=?').get(data.friends[0]!.id)).toEqual({ n: 1 });
  expect((await request(`/runs/${run.id}`, 'DELETE')).status).toBe(200);
  await expect(send(token, data.friends[0]!.lineUserId)).rejects.toThrow('STAGING_QA_OUTBOUND_BLOCKED');
  expect(fixture.raw.prepare('SELECT is_active FROM line_accounts WHERE id=?').get('unrelated-account')).toEqual({ is_active: 1 });
  expect(network).not.toHaveBeenCalled();
});

test('cronは作成アカウントだけを1回処理。同じIDの再送・同時起動・取消を拒否', async () => {
  const run = await create();
  const tick = { job: 'booking_waitlists', requestId: 'qa-1' };
  const response = await request(`/runs/${run.id}/cron`, 'POST', tick);
  expect(response.status).toBe(200);
  const first = await response.json();
  expect(first).toMatchObject({ success: true, replayed: false, data: { accountId: run.accountId } });
  expect(await (await request(`/runs/${run.id}/cron`, 'POST', tick)).json()).toMatchObject({ success: true, replayed: true, data: (first as { data: unknown }).data });
  expect((await request(`/runs/${run.id}/cron`, 'POST', { ...tick, job: 'restaurant_holds' })).status).toBe(409);
  fixture.raw.prepare('UPDATE platform_settings SET value=? WHERE key=?').run('another-invocation', `${QA_PREFIX}lock:${run.id}`);
  expect((await request(`/runs/${run.id}/cron`, 'POST', { ...tick, requestId: 'qa-2' })).status).toBe(409);
  expect((await request(`/runs/${run.id}`, 'DELETE')).status).toBe(409);
  fixture.raw.prepare("UPDATE platform_settings SET value='idle' WHERE key=?").run(`${QA_PREFIX}lock:${run.id}`);
  expect((await request(`/runs/${run.id}`, 'DELETE')).status).toBe(200);
  expect((await request(`/runs/${run.id}/cron`, 'POST', tick)).status).toBe(404);
  expect(network).not.toHaveBeenCalled();
});

test('期限切れの本物の処理は試験店だけ更新し、別の店の仮押さえを変えない', async () => {
  const run = await create();
  fixture.raw.exec(`INSERT INTO rt_organizations(id,account_id,tenant_id,name) VALUES ('unrelated-org','unrelated-account','unrelated-tenant','Unrelated');
    INSERT INTO rt_stores(id,organization_id,line_account_id,name,code) VALUES ('unrelated-store','unrelated-org','unrelated-account','Unrelated','unrelated');`);
  const add = fixture.raw.prepare(`INSERT INTO rt_reservations(id,store_id,source,customer_name,guest_count,starts_at,ends_at,status,hold_expires_at)
    VALUES (?,?,'manual','QA synthetic',1,'2026-01-01T10:00:00Z','2026-01-01T11:00:00Z','pending','2026-01-01T09:00:00Z')`);
  add.run('qa-hold', run.storeId); add.run('unrelated-hold', 'unrelated-store');
  const response = await request(`/runs/${run.id}/cron`, 'POST', { job: 'restaurant_holds', requestId: 'holds-1' });
  expect(response.status).toBe(200);
  expect(fixture.raw.prepare('SELECT status FROM rt_reservations WHERE id=?').get('qa-hold')).toEqual({ status: 'cancelled' });
  expect(fixture.raw.prepare('SELECT status FROM rt_reservations WHERE id=?').get('unrelated-hold')).toEqual({ status: 'pending' });
  const concurrent = await Promise.all([request(`/runs/${run.id}/cron`, 'POST', { job: 'restaurant_holds', requestId: 'holds-2' }),
    request(`/runs/${run.id}/cron`, 'POST', { job: 'restaurant_holds', requestId: 'holds-3' })]);
  expect(concurrent.map(response => response.status).sort()).toEqual([200, 409]);
  expect(network).not.toHaveBeenCalled();
});

test('待ちの期限処理へ試験アカウントを渡し、時刻を進めても別店の待ちは更新しない', async () => {
  const run = await create();
  const created = await request(`/runs/${run.id}/friends`, 'POST', { count: 1 });
  const { data } = await created.json() as { data: { friends: Array<{ id: string }> } };
  const startsAt = new Date(Date.now() + 2 * 86_400_000).toISOString();
  fixture.raw.prepare('INSERT INTO friends(id,line_user_id,line_account_id,display_name) VALUES (?,?,?,?)')
    .run('outside-friend', 'outside-line-user', 'unrelated-account', 'Synthetic outside friend');
  for (const [prefix, accountId, friendId] of [['qa', run.accountId, data.friends[0]!.id], ['outside', 'unrelated-account', 'outside-friend']]) {
    fixture.raw.prepare('INSERT INTO staff(id,line_account_id,name,display_name) VALUES (?,?,?,?)').run(`${prefix}-staff`, accountId, 'QA staff', 'QA staff');
    fixture.raw.prepare('INSERT INTO menus(id,line_account_id,name,duration_minutes,base_price) VALUES (?,?,?,60,0)').run(`${prefix}-menu`, accountId, 'QA menu');
    fixture.raw.prepare('INSERT INTO booking_waitlist(id,line_account_id,staff_id,menu_id,starts_at,friend_id,identity_key) VALUES (?,?,?,?,?,?,?)')
      .run(`${prefix}-wait`, accountId, `${prefix}-staff`, `${prefix}-menu`, startsAt, friendId, `friend:${friendId}`);
  }
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(Date.parse(startsAt) + 86_400_000));
  try {
    expect((await request(`/runs/${run.id}/cron`, 'POST', { job: 'booking_waitlists', requestId: 'scoped-waitlists' })).status).toBe(200);
    expect(fixture.raw.prepare('SELECT status FROM booking_waitlist WHERE id=?').get('qa-wait')).toEqual({ status: 'finished' });
    expect(fixture.raw.prepare('SELECT status FROM booking_waitlist WHERE id=?').get('outside-wait')).toEqual({ status: 'waiting' });
    expect(network).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});

test('失敗した処理と中断した記録は同じrequestIdで再実行せず、店の所属変更も拒否する', async () => {
  const run = await create();
  fixture.raw.prepare('UPDATE rt_stores SET line_account_id=? WHERE id=?').run('unrelated-account', run.storeId);
  const tick = { job: 'restaurant_holds', requestId: 'failed-scope' };
  expect((await request(`/runs/${run.id}/cron`, 'POST', tick)).status).toBe(500);
  // Restoring membership does not make a failed operation safe to replay.
  fixture.raw.prepare('UPDATE rt_stores SET line_account_id=? WHERE id=?').run(run.accountId, run.storeId);
  const retry = await request(`/runs/${run.id}/cron`, 'POST', tick);
  expect(retry.status).toBe(409);
  expect(await retry.json()).toMatchObject({ success: false, replayed: true, data: { job: tick.job, status: 'failed' } });
  fixture.raw.prepare('INSERT INTO platform_settings(key,value) VALUES (?,?)')
    .run(`${QA_PREFIX}cron:${run.id}:interrupted`, JSON.stringify({ job: tick.job, status: 'running' }));
  const interrupted = await request(`/runs/${run.id}/cron`, 'POST', { ...tick, requestId: 'interrupted' });
  expect(interrupted.status).toBe(409);
  expect(await interrupted.json()).toMatchObject({ success: false, replayed: true, data: { status: 'running' } });
  expect(network).not.toHaveBeenCalled();
});

test('承認済み価格の期限処理は試験店だけに適用し、別店と再送時の価格を保つ', async () => {
  const run = await create();
  fixture.raw.exec(`INSERT INTO rt_organizations(id,account_id,tenant_id,name) VALUES ('outside-org','unrelated-account','unrelated-tenant','Outside');
    INSERT INTO rt_stores(id,organization_id,line_account_id,name,code) VALUES ('outside-store','outside-org','unrelated-account','Outside','outside');`);
  for (const [prefix, storeId, organizationId] of [['qa-price', run.storeId, run.organizationId], ['outside-price', 'outside-store', 'outside-org']]) {
    fixture.raw.prepare("INSERT INTO rt_menu_items(id,store_id,kind,name,price) VALUES (?,?,'course','Synthetic course',1000)")
      .run(`${prefix}-menu`, storeId);
    fixture.raw.prepare("INSERT INTO rt_approval_requests(id,organization_id,store_id,kind,title,status) VALUES (?,?,?,'menu_change','Synthetic price','approved')")
      .run(`${prefix}-approval`, organizationId, storeId);
    fixture.raw.prepare(`INSERT INTO rt_menu_change_requests(id,approval_id,menu_id,store_id,before_price,after_price,requested_by,status,effective_at)
      VALUES (?,?,?,?,1000,2000,'qa-operator','approved','2020-01-01T00:00:00Z')`)
      .run(prefix, `${prefix}-approval`, `${prefix}-menu`, storeId);
  }
  const tick = { job: 'restaurant_menu_prices', requestId: 'prices-1' };
  expect((await request(`/runs/${run.id}/cron`, 'POST', tick)).status).toBe(200);
  expect(fixture.raw.prepare('SELECT price FROM rt_menu_items WHERE id=?').get('qa-price-menu')).toEqual({ price: 2000 });
  expect(fixture.raw.prepare('SELECT price FROM rt_menu_items WHERE id=?').get('outside-price-menu')).toEqual({ price: 1000 });
  expect((await request(`/runs/${run.id}/cron`, 'POST', tick)).status).toBe(200);
  expect(fixture.raw.prepare('SELECT status FROM rt_menu_change_requests WHERE id=?').get('qa-price')).toEqual({ status: 'applied' });
  expect(network).not.toHaveBeenCalled();
});
