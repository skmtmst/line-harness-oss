import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../worker-env.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { seedAssignmentFixture } from '../test-utils/assignment-fixture.js';
import { connectHash, STRIPE_CONNECT_CALLBACK } from '../features/booking/booking-stripe-connect.js';
const access = vi.hoisted(() => ({ allow: true }));
vi.mock('../services/account-access.js', () => ({ canAccessAllLineAccounts: vi.fn(async () => access.allow) }));
import { bookingPaymentAdmin } from './booking-payment-admin.js';

let f: SqliteD1;
let role: 'owner' | 'admin' | 'staff', readOnly: boolean, actor: string, credential: 'session' | 'api-key';
const env = { BOOKING_STRIPE_TEST_SECRET_KEY: 'sk_test_fixture', BOOKING_STRIPE_TEST_CLIENT_ID: 'ca_fixture',
  BOOKING_STRIPE_CONNECT_REDIRECT_URI: 'https://api.example.test' + STRIPE_CONNECT_CALLBACK };
const base = '/api/booking/admin/payment-connection';
const fetchMock = vi.fn<typeof fetch>();
function request(path: string, method = 'GET', body?: unknown, extra: Record<string, string | undefined> = {}, session = 'login-session') {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: actor, name: '試験', role, readOnly, credential });
    await next();
  });
  app.route('/', bookingPaymentAdmin);
  return app.request(path, { method, headers: { Cookie: `lh_admin_session=${session}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, { DB: f.db, ...env, ...extra } as Env['Bindings']);
}
async function start(account = 'a') {
  const response = await request(`${base}/authorize?account_id=${account}`, 'POST', {});
  expect(response.status).toBe(200);
  const { data } = await response.json() as { data: { authorizationUrl: string; expiresAt: string; testMode: true } };
  return { state: new URL(data.authorizationUrl).searchParams.get('state')!, data };
}
const callback = (state: string, code = 'ac_fixture') => request(STRIPE_CONNECT_CALLBACK, 'POST', { state, code });
function token(account = 'acct_fixture1234', extra: Record<string, unknown> = {}) {
  return Response.json({ stripe_user_id: account, livemode: false, scope: 'read_write', access_token: 'DO_NOT_STORE', refresh_token: 'DO_NOT_STORE', ...extra });
}
function connection(account = 'acct_old1234', testMode = 1) {
  f.raw.prepare(`INSERT INTO booking_payment_connections(line_account_id,provider,provider_account_id,test_mode,connected_at)
    VALUES('a','stripe',?,?,'2026-10-01T00:00:00Z')`).run(account, testMode);
}
beforeEach(() => {
  f = createTestD1(); seedAssignmentFixture(f);
  role = 'owner'; readOnly = false; actor = 'operator'; credential = 'session'; access.allow = true;
  fetchMock.mockReset(); fetchMock.mockImplementation(async () => { throw new Error('外部通信は禁止'); });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { f.raw.close(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Stripe Connectの本人・店・state', () => {
  const locks = (['exchanging', 'disconnecting'] as const)
    .flatMap(status => (['authorize', 'disconnect'] as const).map(operation => ({ status, operation })));
  it.each(['exchanging', 'disconnecting'])('有効期限ちょうどの%sも取り直せる', async status => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-16T00:00:00Z'));
    await start();
    f.raw.prepare('UPDATE booking_stripe_connect_states SET status=?,expires_at=?').run(status, new Date().toISOString());
    await start();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(locks)('期限切れの$statusを$operationで取り直し、古いstateを失効させる', async ({ status, operation }) => {
    const previous = await start();
    connection();
    f.raw.prepare('UPDATE booking_stripe_connect_states SET status=?,expires_at=?')
      .run(status, '2000-01-01T00:00:00Z');
    if (operation === 'authorize') {
      const next = await start();
      expect(next.state).not.toBe(previous.state);
      expect(f.raw.prepare('SELECT state_hash,status,expires_at FROM booking_stripe_connect_states').get())
        .toEqual({ state_hash: await connectHash(next.state), status: 'pending', expires_at: expect.any(String) });
      expect(fetchMock).not.toHaveBeenCalled();
      fetchMock.mockResolvedValueOnce(token());
      expect((await callback(next.state)).status).toBe(200);
    } else {
      fetchMock.mockResolvedValueOnce(Response.json({ stripe_user_id: 'acct_old1234' }));
      expect((await request(`${base}?account_id=a`, 'DELETE')).status).toBe(200);
      expect(f.raw.prepare('SELECT state_hash,status FROM booking_stripe_connect_states').get())
        .toEqual({ state_hash: expect.not.stringMatching(await connectHash(previous.state)), status: 'finished' });
      expect(f.raw.prepare('SELECT disconnected_at FROM booking_payment_connections').get())
        .toEqual({ disconnected_at: expect.any(String) });
    }
    expect((await callback(previous.state)).status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each(locks)('期限内の$statusは$operationを409で拒否し、接続とロックを変えない', async ({ status, operation }) => {
    await start(); connection();
    f.raw.prepare('UPDATE booking_stripe_connect_states SET status=?,expires_at=?')
      .run(status, '2999-01-01T00:00:00Z');
    const previous = f.raw.prepare('SELECT * FROM booking_stripe_connect_states').get();
    const response = operation === 'authorize'
      ? await request(`${base}/authorize?account_id=a`, 'POST', {})
      : await request(`${base}?account_id=a`, 'DELETE');
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'stripe_connect_busy' });
    expect(f.raw.prepare('SELECT * FROM booking_stripe_connect_states').get()).toEqual(previous);
    expect(f.raw.prepare('SELECT provider_account_id,disconnected_at FROM booking_payment_connections').get())
      .toEqual({ provider_account_id: 'acct_old1234', disconnected_at: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('固定URL・test設定でURLを作り、生state/セッションを保存せず、旧pendingは失効する', async () => {
    const first = await start(), second = await start();
    const url = new URL(second.data.authorizationUrl);
    expect(url.origin + url.pathname).toBe('https://connect.stripe.com/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('ca_fixture');
    expect(url.searchParams.get('scope')).toBe('read_write');
    expect(url.searchParams.get('redirect_uri')).toBe(env.BOOKING_STRIPE_CONNECT_REDIRECT_URI);
    const row = f.raw.prepare('SELECT * FROM booking_stripe_connect_states').get();
    expect(row).toMatchObject({ state_hash: await connectHash(second.state), session_hash: await connectHash('login-session'), status: 'pending' });
    expect(JSON.stringify(row)).not.toContain(second.state); expect(JSON.stringify(row)).not.toContain('login-session');
    expect((await callback(first.state)).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(['role', 'readOnly', 'credential', 'access'] as const)('開始時の%s不足を拒否し、保存も通信もしない', async kind => {
    if (kind === 'role') role = 'staff';
    if (kind === 'readOnly') readOnly = true;
    if (kind === 'credential') credential = 'api-key';
    if (kind === 'access') access.allow = false;
    expect([403, 404]).toContain((await request(`${base}/authorize?account_id=a`, 'POST', {})).status);
    expect(f.raw.prepare('SELECT count(*) n FROM booking_stripe_connect_states').get()).toEqual({ n: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(['actor', 'session', 'access', 'readOnly', 'role', 'expired', 'account', 'modified'] as const)('callbackで%sの変化を拒否し、Stripeに接続しない', async kind => {
    const { state } = await start();
    if (kind === 'actor') actor = 'other';
    if (kind === 'access') access.allow = false;
    if (kind === 'readOnly') readOnly = true;
    if (kind === 'role') role = 'staff';
    if (kind === 'expired') f.raw.exec("UPDATE booking_stripe_connect_states SET expires_at='2000-01-01T00:00:00Z'");
    const response = await request(STRIPE_CONNECT_CALLBACK + (kind === 'account' ? '?account_id=b' : ''), 'POST',
      { state: kind === 'modified' ? 'a'.repeat(64) : state, code: 'ac_fixture' }, {}, kind === 'session' ? 'other-session' : 'login-session');
    expect([400, 403]).toContain(response.status); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('利用者の拒否は一度だけ消費し、外部のerror_descriptionを返さない', async () => {
    const { state } = await start();
    const r = await request(STRIPE_CONNECT_CALLBACK, 'POST', { state, error: 'access_denied', error_description: 'PRIVATE' });
    expect(r.status).toBe(400); expect(await r.text()).not.toContain('PRIVATE');
    expect((await callback(state)).status).toBe(400); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('認可コードを交換し末尾だけ返す。ブラウザGETの戻りも同じセッションを照合する', async () => {
    const { state } = await start(); fetchMock.mockResolvedValueOnce(token());
    const r = await request(`${STRIPE_CONNECT_CALLBACK}?state=${state}&code=ac_fixture`);
    expect(r.status).toBe(200); expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('referrer-policy')).toBe('no-referrer');
    const data = await r.json(); expect(data).toMatchObject({ data: { connected: true, testMode: true, accountIdTail: '1234' } });
    expect(JSON.stringify(data)).not.toContain('acct_fixture');
    const row = f.raw.prepare('SELECT * FROM booking_payment_connections').get();
    expect(row).toMatchObject({ provider_account_id: 'acct_fixture1234', test_mode: 1, disconnected_at: null });
    expect(JSON.stringify(row)).not.toContain('DO_NOT_STORE');
    expect(fetchMock).toHaveBeenCalledWith('https://connect.stripe.com/oauth/token', expect.objectContaining({ method: 'POST', redirect: 'error', body: 'grant_type=authorization_code&code=ac_fixture' }));
    expect((await callback(state)).status).toBe(400); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('同時callbackの交換は1件。処理中はつなぎ直しと切断を拒否する', async () => {
    const { state } = await start();
    let release!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const first = callback(state);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect((await callback(state)).status).toBe(400);
    expect((await request(`${base}/authorize?account_id=a`, 'POST', {})).status).toBe(409);
    expect((await request(`${base}?account_id=a`, 'DELETE')).status).toBe(409);
    release(token()); expect((await first).status).toBe(200);
  });
  it('つなぎ直し成功で新しい接続へ更新し、途中の拒否では元の接続を維持する', async () => {
    connection(); let flow = await start();
    await request(STRIPE_CONNECT_CALLBACK, 'POST', { state: flow.state, error: 'access_denied' });
    expect(f.raw.prepare('SELECT provider_account_id FROM booking_payment_connections').get()).toEqual({ provider_account_id: 'acct_old1234' });
    flow = await start(); fetchMock.mockResolvedValueOnce(token('acct_new5678'));
    expect((await callback(flow.state)).status).toBe(200);
    expect(f.raw.prepare('SELECT provider_account_id FROM booking_payment_connections').get()).toEqual({ provider_account_id: 'acct_new5678' });
  });
});

describe('test限定・障害時・切断', () => {
  it.each([
    { BOOKING_STRIPE_TEST_SECRET_KEY: 'sk_live_REJECT' }, { BOOKING_STRIPE_TEST_SECRET_KEY: '' },
    { BOOKING_STRIPE_TEST_CLIENT_ID: '' }, { BOOKING_STRIPE_CONNECT_REDIRECT_URI: 'https://evil.test/callback' },
    { BOOKING_STRIPE_CONNECT_REDIRECT_URI: 'http://api.example.test' + STRIPE_CONNECT_CALLBACK },
  ])('鍵/設定が不正ならURLを発行しない: %j', async extra => {
    const r = await request(`${base}/authorize?account_id=a`, 'POST', {}, extra);
    expect(r.status).toBe(503); expect(await r.text()).not.toContain('sk_'); expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([{ livemode: true }, { livemode: undefined }, { scope: 'read_only' }, { stripe_user_id: 'INVALID' }])('試験用以外/不正なStripe応答を保存しない: %j', async data => {
    const { state } = await start(); fetchMock.mockResolvedValueOnce(token('acct_fixture', data));
    expect((await callback(state)).status).toBe(503);
    expect(f.raw.prepare('SELECT count(*) n FROM booking_payment_connections').get()).toEqual({ n: 0 });
    expect((await callback(state)).status).toBe(400); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('通信/HTTP障害は固定コード。認可コードを自動再送せず新しい開始で回復できる', async () => {
    const flow = await start(); fetchMock.mockResolvedValueOnce(Response.json({ error_description: 'SECRET_RESPONSE' }, { status: 500 }));
    const response = await callback(flow.state); expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('SECRET_RESPONSE');
    expect((await callback(flow.state)).status).toBe(400);
    const next = await start(); fetchMock.mockRejectedValueOnce(new Error('sk_test_PRIVATE'));
    expect(await (await callback(next.state)).text()).not.toContain('PRIVATE');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('同じStripeアカウントが他店で使われていれば保存しない', async () => {
    f.raw.exec(`INSERT INTO booking_payment_connections(line_account_id,provider,provider_account_id,test_mode,connected_at)
      VALUES('b','stripe','acct_fixture1234',1,'2026-10-01T00:00:00Z')`);
    const { state } = await start(); fetchMock.mockResolvedValueOnce(token());
    expect((await callback(state)).status).toBe(409);
    expect(f.raw.prepare("SELECT count(*) n FROM booking_payment_connections WHERE line_account_id='a'").get()).toEqual({ n: 0 });
  });
  it('開始後に本番の接続記録が入ってもcallbackで上書きしない', async () => {
    const { state } = await start(); connection('acct_live', 0);
    fetchMock.mockResolvedValueOnce(token());
    expect((await callback(state)).status).toBe(409);
    expect(f.raw.prepare('SELECT provider_account_id,test_mode FROM booking_payment_connections').get())
      .toEqual({ provider_account_id: 'acct_live', test_mode: 0 });
  });
  it('切断成功後に日時を保存。再切断は外部通信せず、pending callbackも失効する', async () => {
    connection(); const { state } = await start();
    fetchMock.mockResolvedValueOnce(Response.json({ stripe_user_id: 'acct_old1234' }));
    expect((await request(`${base}?account_id=a`, 'DELETE')).status).toBe(200);
    expect(f.raw.prepare('SELECT disconnected_at FROM booking_payment_connections').get()).toMatchObject({ disconnected_at: expect.any(String) });
    expect(fetchMock).toHaveBeenCalledWith('https://connect.stripe.com/oauth/deauthorize', expect.objectContaining({ body: 'client_id=ca_fixture&stripe_user_id=acct_old1234' }));
    expect((await callback(state)).status).toBe(400);
    expect((await request(`${base}?account_id=a`, 'DELETE')).status).toBe(200); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('切断の結果不明では接続中を保ち、別のlockでも自動再切断しない', async () => {
    connection();
    expect((await request(`${base}?account_id=a`, 'DELETE')).status).toBe(503);
    expect(f.raw.prepare('SELECT disconnected_at FROM booking_payment_connections').get()).toEqual({ disconnected_at: null });
    fetchMock.mockResolvedValueOnce(Response.json({ stripe_user_id: 'acct_old1234' }));
    expect((await request(`${base}?account_id=a`, 'DELETE')).status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('本番の接続・閲覧のみ・API鍵は切断させない', async () => {
    connection('acct_live', 0);
    expect((await request(`${base}?account_id=a`, 'DELETE')).status).toBe(503);
    readOnly = true; expect((await request(`${base}?account_id=a`, 'DELETE')).status).toBe(403);
    readOnly = false; credential = 'api-key'; expect((await request(`${base}?account_id=a`, 'DELETE')).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('未移行は503。保存障害後も同じ認可コードは交換し直さない', async () => {
    const { state } = await start();
    f.raw.exec("CREATE TRIGGER connection_crash BEFORE INSERT ON booking_payment_connections BEGIN SELECT RAISE(ABORT,'fixture'); END");
    fetchMock.mockResolvedValueOnce(token());
    expect((await callback(state)).status).toBe(503);
    expect((await callback(state)).status).toBe(400); expect(fetchMock).toHaveBeenCalledTimes(1);
    f.raw.exec('DROP TABLE booking_stripe_connect_states');
    expect(await (await request(`${base}/authorize?account_id=a`, 'POST', {})).json()).toMatchObject({ code: 'stripe_connect_storage_not_ready' });
  });
});
