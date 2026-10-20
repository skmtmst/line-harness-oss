import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { Miniflare } from 'miniflare';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { Env } from '../worker-env.js';
vi.mock('../services/account-access.js', () => ({ canAccessAllLineAccounts: vi.fn(async () => true) }));
import { bookingPaymentAdmin } from './booking-payment-admin.js';

let mf: Miniflare, db: D1Database;
const base = '/api/booking/admin/payment-connection';
const app = new Hono<Env>();
app.use('*', async (c, next) => { c.set('staff', { id: 'operator', name: '試験', role: 'owner', readOnly: false, credential: 'session' }); await next(); });
app.route('/', bookingPaymentAdmin);
function request(path: string, method = 'POST', body: unknown = {}) {
  return app.request(path, { method, headers: { Cookie: 'lh_admin_session=session', 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    { DB: db, BOOKING_STRIPE_TEST_SECRET_KEY: 'sk_test_fixture', BOOKING_STRIPE_TEST_CLIENT_ID: 'ca_fixture',
      BOOKING_STRIPE_CONNECT_REDIRECT_URI: 'https://api.example.test' + base + '/callback' } as Env['Bindings']);
}
async function start() {
  const r = await request(base + '/authorize?account_id=a'); expect(r.status).toBe(200);
  const data = await r.json() as { data: { authorizationUrl: string } };
  return new URL(data.data.authorizationUrl).searchParams.get('state')!;
}
beforeAll(async () => {
  mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("ok")}}', d1Databases: ['DB'] });
  db = await mf.getD1Database('DB') as unknown as D1Database;
  await db.prepare('CREATE TABLE line_accounts(id TEXT PRIMARY KEY)').run();
  await db.prepare("INSERT INTO line_accounts VALUES('a')").run();
  const workflow=readFileSync(new URL('../../../../packages/db/migrations/615_workflow_steps.sql',import.meta.url),'utf8').split('-- Banner-specific')[0];
  await db.prepare(workflow).run();
  for (const file of ['663_booking_payment_connections.sql', '682_booking_stripe_connect_states.sql']) {
    const sql = readFileSync(new URL('../../../../packages/db/migrations/' + file, import.meta.url), 'utf8')
      .split('\n').filter(line => !line.startsWith('--')).join('\n');
    await db.prepare(sql).run();
  }
}, 30000);
afterAll(async () => { await mf?.dispose(); });
beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('外部通信は禁止'); }));
  await db.prepare('DROP TRIGGER IF EXISTS finish_crash').run();
  await db.prepare('DELETE FROM workflow_steps').run();
  await db.prepare('DELETE FROM booking_stripe_connect_states').run();
  await db.prepare('DELETE FROM booking_payment_connections').run();
});
afterEach(() => vi.unstubAllGlobals());

it.each(['exchanging', 'disconnecting'])('実D1で期限内の%sは409、期限切れ後は新しい要求で取り直せる', async status => {
  const previous = await start();
  await db.prepare('UPDATE booking_stripe_connect_states SET status=?,expires_at=?').bind(status, '2999-01-01T00:00:00Z').run();
  expect((await request(base + '/authorize?account_id=a')).status).toBe(409);
  expect((await request(base + '?account_id=a', 'DELETE')).status).toBe(409);
  await db.prepare("UPDATE booking_stripe_connect_states SET expires_at='2000-01-01T00:00:00Z'").run();
  const next = await start();
  expect(next).not.toBe(previous);
  expect((await request(base + '/callback', 'POST', { state: previous, code: 'ac_old' })).status).toBe(400);
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ stripe_user_id: 'acct_fixture1234', livemode: false, scope: 'read_write' }));
  vi.stubGlobal('fetch', fetchMock);
  expect((await request(base + '/callback', 'POST', { state: next, code: 'ac_new' })).status).toBe(200);
  expect(fetchMock).toHaveBeenCalledTimes(1);
}, 30000);

it('実D1で同時callbackは交換1回。保存batch失敗は接続と状態を巻き戻しコードを再交換しない', async () => {
  const state = await start();
  let release!: (response: Response) => void;
  const fetchMock = vi.fn<typeof fetch>().mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  vi.stubGlobal('fetch', fetchMock);
  const callback = () => request(base + '/callback', 'POST', { state, code: 'ac_fixture' });
  const first = callback();
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect((await callback()).status).toBe(400);
  expect((await request(base + '?account_id=a', 'DELETE')).status).toBe(409);
  release(Response.json({ stripe_user_id: 'acct_fixture1234', livemode: false, scope: 'read_write' }));
  expect((await first).status).toBe(200);
  expect(await db.prepare('SELECT provider_account_id,test_mode FROM booking_payment_connections').first())
    .toEqual({ provider_account_id: 'acct_fixture1234', test_mode: 1 });
  const next = await start();
  await db.prepare("CREATE TRIGGER finish_crash BEFORE UPDATE ON booking_stripe_connect_states WHEN NEW.status='finished' BEGIN SELECT RAISE(ABORT,'fixture'); END").run();
  fetchMock.mockResolvedValueOnce(Response.json({ stripe_user_id: 'acct_NEW5678', livemode: false, scope: 'read_write' }));
  expect((await request(base + '/callback', 'POST', { state: next, code: 'ac_next' })).status).toBe(503);
  expect(await db.prepare('SELECT provider_account_id FROM booking_payment_connections').first()).toEqual({ provider_account_id: 'acct_fixture1234' });
  expect(await db.prepare('SELECT status FROM booking_stripe_connect_states').first()).toEqual({ status: 'failed' });
  expect((await request(base + '/callback', 'POST', { state: next, code: 'ac_next' })).status).toBe(400);
  expect(fetchMock).toHaveBeenCalledTimes(2);
}, 30000);
