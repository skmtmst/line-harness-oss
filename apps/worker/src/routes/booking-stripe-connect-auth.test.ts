import { Hono } from 'hono';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Env } from '../worker-env.js';
import { authMiddleware, sha256Hex } from '../middleware/auth.js';
import { tenantScopeMiddleware } from '../middleware/tenant-scope.js';
import { featureEnforcementMiddleware } from '../middleware/feature-enforcement.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { seedAssignmentFixture } from '../test-utils/assignment-fixture.js';
import { bookingPaymentAdmin } from './booking-payment-admin.js';

let f: SqliteD1;
const base = '/api/booking/admin/payment-connection';
const app = new Hono<Env>();
app.use('*', authMiddleware);
app.use('*', tenantScopeMiddleware);
app.use('*', featureEnforcementMiddleware);
app.route('/', bookingPaymentAdmin);
function request(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  return app.request(path, { method, headers: { Cookie: 'lh_admin_session=fixture; lh_csrf=csrf', 'X-CSRF-Token': 'csrf', 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, { DB: f.db,
    BOOKING_STRIPE_TEST_SECRET_KEY: 'sk_test_fixture', BOOKING_STRIPE_TEST_CLIENT_ID: 'ca_fixture',
    BOOKING_STRIPE_CONNECT_REDIRECT_URI: 'https://api.example.test' + base + '/callback' } as Env['Bindings']);
}
beforeEach(async () => {
  f = createTestD1(); seedAssignmentFixture(f);
  f.raw.exec(`INSERT INTO staff_members(id,name,role,api_key,is_active) VALUES('operator','試験','owner','fixture-key',1);
    INSERT INTO account_settings(line_account_id,key,value) VALUES('a','feature.booking','{"enabled":true}'),('b','feature.booking','{"enabled":true}')`);
  f.raw.prepare("INSERT INTO admin_sessions(token_hash,staff_id,expires_at) VALUES(?,'operator','2099-01-01T00:00:00Z')").run(await sha256Hex('fixture'));
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ stripe_user_id: 'acct_fixture1234', livemode: false, scope: 'read_write' })));
});
afterEach(() => { f.raw.close(); vi.unstubAllGlobals(); });

it('実認証・CSRF・所属/機能の境界を通して接続し、無効化・ログアウト・閲覧のみを拒否する', async () => {
  expect((await request(base + '/authorize?account_id=a', 'POST', {}, { Cookie: '' })).status).toBe(401);
  expect((await request(base + '/authorize?account_id=a', 'POST', {}, { 'X-CSRF-Token': '' })).status).toBe(403);
  const start = await request(base + '/authorize?account_id=a', 'POST', {});
  expect(start.status).toBe(200);
  const result = await start.json() as { data: { authorizationUrl: string } };
  const state = new URL(result.data.authorizationUrl).searchParams.get('state')!;
  const path = base + '/callback?state=' + state + '&code=ac_fixture';
  f.raw.exec("UPDATE account_settings SET value='{\"enabled\":false}' WHERE line_account_id='a' AND key='feature.booking'");
  // bは有効のまま。GETの「どれかの店で有効」をaへの接続許可にしない。
  expect((await request(path)).status).toBe(403);
  expect(fetch).not.toHaveBeenCalled();
  f.raw.exec("UPDATE account_settings SET value='{\"enabled\":true}' WHERE line_account_id='a' AND key='feature.booking'");
  f.raw.exec("UPDATE staff_members SET access_level='read_only' WHERE id='operator'");
  expect((await request(path)).status).toBe(403);
  f.raw.exec("UPDATE staff_members SET access_level='full' WHERE id='operator'");
  expect((await request(path, 'GET', undefined, { Cookie: '' })).status).toBe(401);
  const connected = await request(path); expect(connected.status).toBe(200);
  expect(await connected.json()).toMatchObject({ data: { connected: true, testMode: true, accountIdTail: '1234' } });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect((await request(path)).status).toBe(400); expect(fetch).toHaveBeenCalledTimes(1);
});
