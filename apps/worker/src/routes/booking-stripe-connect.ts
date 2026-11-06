import { fail } from '../lib/fail.js';
import type { Hono, MiddlewareHandler } from 'hono';
import type { Env } from '../worker-env.js';
import { adminSessionTokenHashFromRequest } from '../middleware/auth.js';
import { canAccessAllLineAccounts } from '../services/account-access.js';
import { inputJsonBoundary } from '../lib/input-errors.js';
import { connectHash, exchangeStripeConnectCode, revokeStripeConnect, STRIPE_CONNECT_CALLBACK, stripeConnectConfig, StripeConnectError } from '../features/booking/booking-stripe-connect/index.js';

type State = { line_account_id: string; state_hash: string };
const base = '/api/booking/admin/payment-connection';
const expiresAt = () => new Date(Date.now() + 10 * 60 * 1000).toISOString();
const opaqueState = () => crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');

/** 同じ店の外部操作を直列化。期限内の処理は保護し、停止した処理は期限後に取り直せる。 */
async function begin(db: D1Database, account: string, staff: string, session: string, state: string, status: 'pending' | 'disconnecting') {
  return db.prepare(`INSERT INTO booking_stripe_connect_states(line_account_id,state_hash,staff_id,session_hash,status,expires_at)
    VALUES(?,?,?,?,?,?) ON CONFLICT(line_account_id) DO UPDATE SET state_hash=excluded.state_hash,staff_id=excluded.staff_id,
    session_hash=excluded.session_hash,status=excluded.status,expires_at=excluded.expires_at,updated_at=datetime('now')
    WHERE booking_stripe_connect_states.status NOT IN ('exchanging','disconnecting')
      OR julianday(booking_stripe_connect_states.expires_at)<=julianday(?) RETURNING line_account_id`)
    .bind(account, state, staff, session, status, expiresAt(), new Date().toISOString()).first();
}

async function finish(db: D1Database, state: string, status: 'finished' | 'failed') {
  await db.prepare("UPDATE booking_stripe_connect_states SET status=?,updated_at=datetime('now') WHERE state_hash=?")
    .bind(status, state).run();
}

export function registerStripeConnectRoutes(app: Hono<Env>, guard: (write?: boolean) => MiddlewareHandler<Env>) {
  const headers: MiddlewareHandler<Env> = async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.header('Referrer-Policy', 'no-referrer');
    await next();
  };
  app.use(base + '/*', headers);

  app.post(base + '/authorize', guard(true), inputJsonBoundary(), async c => {
    const session = await adminSessionTokenHashFromRequest(c);
    if (c.get('staff').credential !== 'session' || !session) return fail(c, 403, 'stripe_connect_session_required');
    try {
      const config = stripeConnectConfig(c.env);
      const state = opaqueState(), hash = await connectHash(state);
      const account = c.req.query('account_id')!.trim();
      const existing = await c.env.DB.prepare('SELECT test_mode FROM booking_payment_connections WHERE line_account_id=? AND disconnected_at IS NULL').bind(account).first<{test_mode:number}>();
      if (existing?.test_mode === 0) return fail(c, 409, 'stripe_connect_test_only');
      if (!await begin(c.env.DB, account, c.get('staff').id, session, hash, 'pending')) return fail(c, 409, 'stripe_connect_busy');
      const url = new URL('https://connect.stripe.com/oauth/authorize');
      url.search = new URLSearchParams({ response_type: 'code', client_id: config.clientId, scope: 'read_write', redirect_uri: config.redirectUri, state }).toString();
      return c.json({ success: true, data: { authorizationUrl: url.href, expiresAt: expiresAt(), testMode: true } });
    } catch (error) {
      if (error instanceof StripeConnectError) return fail(c, 503, error.code);
      throw error;
    }
  });

  // GETはStripeからのブラウザの戻り。POSTは同じ管理セッションで受け取ったcode/stateの交換用。
  const callback: MiddlewareHandler<Env> = async c => {
    const staff = c.get('staff'), session = await adminSessionTokenHashFromRequest(c);
    if (!staff || staff.readOnly || !['owner', 'admin'].includes(staff.role) || staff.credential !== 'session' || !session) {
      return fail(c, 403, 'stripe_connect_session_required');
    }
    const body = c.req.method === 'GET' ? c.req.query() : await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!body || typeof body.state !== 'string' || !/^[a-f0-9]{64}$/.test(body.state)) return fail(c, 400, 'stripe_connect_invalid_state');
    const hash = await connectHash(body.state);
    const row = await c.env.DB.prepare(`SELECT line_account_id,state_hash FROM booking_stripe_connect_states
      WHERE state_hash=? AND staff_id=? AND session_hash=? AND status='pending' AND julianday(expires_at)>julianday(?)`)
      .bind(hash, staff.id, session, new Date().toISOString()).first<State>();
    if (!row) return fail(c, 400, 'stripe_connect_invalid_state');
    const account = row.line_account_id;
    if ((c.req.query('account_id') && c.req.query('account_id') !== account)
      || (staff.featureEnabledLineAccountIds && !staff.featureEnabledLineAccountIds.includes(account))
      || !await canAccessAllLineAccounts(c.env.DB, staff, [account])
      || !await c.env.DB.prepare('SELECT id FROM line_accounts WHERE id=?').bind(account).first()) return fail(c, 403, 'forbidden');
    if (body.error !== undefined) {
      if (body.error !== 'access_denied') return fail(c, 400, 'stripe_connect_invalid_callback');
      const denied = await c.env.DB.prepare("UPDATE booking_stripe_connect_states SET status='finished',updated_at=datetime('now') WHERE state_hash=? AND status='pending' RETURNING line_account_id").bind(hash).first();
      if (!denied) return fail(c, 400, 'stripe_connect_invalid_state');
      return fail(c, 400, 'stripe_connect_access_denied');
    }
    if (typeof body.code !== 'string' || !/^ac_[A-Za-z0-9]{1,1000}$/.test(body.code)) return fail(c, 400, 'stripe_connect_invalid_callback');
    try {
      const config = stripeConnectConfig(c.env);
      // codeはStripeで再利用すると接続が失効する。外部通信より先に一度だけ獲得する。
      const claimed = await c.env.DB.prepare("UPDATE booking_stripe_connect_states SET status='exchanging',updated_at=datetime('now') WHERE state_hash=? AND status='pending' RETURNING line_account_id").bind(hash).first();
      if (!claimed) return fail(c, 400, 'stripe_connect_invalid_state');
      const providerAccount = await exchangeStripeConnectCode(config, body.code,{db:c.env.DB,accountId:account,operationId:hash,
        authorize:()=>canAccessAllLineAccounts(c.env.DB,staff,[account])});
      const at = new Date().toISOString();
      // 別店で有効な同じStripeアカウントを上書きしない。選択と保存は1つのSQLで行う。
      const results = await c.env.DB.batch([
        c.env.DB.prepare(`INSERT INTO booking_payment_connections(line_account_id,provider,provider_account_id,test_mode,connected_at,disconnected_at,updated_at)
        SELECT ?,'stripe',?,1,?,NULL,? WHERE EXISTS(SELECT 1 FROM booking_stripe_connect_states WHERE state_hash=? AND status='exchanging')
          AND NOT EXISTS(SELECT 1 FROM booking_payment_connections WHERE provider_account_id=? AND line_account_id<>? AND disconnected_at IS NULL)
        ON CONFLICT(line_account_id) DO UPDATE SET provider_account_id=excluded.provider_account_id,test_mode=1,
          connected_at=excluded.connected_at,disconnected_at=NULL,updated_at=excluded.updated_at
        WHERE booking_payment_connections.test_mode=1
        RETURNING line_account_id`).bind(account, providerAccount, at, at, hash, providerAccount, account),
        c.env.DB.prepare("UPDATE booking_stripe_connect_states SET status='finished',updated_at=datetime('now') WHERE state_hash=? AND status='exchanging'").bind(hash),
      ]);
      if (!results[0].results.length) {
        await finish(c.env.DB, hash, 'failed');
        return fail(c, 409, 'stripe_connect_account_in_use');
      }
      return c.json({ success: true, data: { connected: true, testMode: true, accountIdTail: providerAccount.slice(-4), connectedAt: at, dashboardUrl: null } });
    } catch (error) {
      await finish(c.env.DB, hash, 'failed');
      if (error instanceof StripeConnectError) return fail(c, 503, error.code);
      throw error;
    }
  };
  app.get(STRIPE_CONNECT_CALLBACK, callback);
  app.post(STRIPE_CONNECT_CALLBACK, inputJsonBoundary(), callback);

  app.delete(base, guard(true), async c => {
    const staff = c.get('staff'), session = await adminSessionTokenHashFromRequest(c);
    if (staff.credential !== 'session' || !session) return fail(c, 403, 'stripe_connect_session_required');
    const account = c.req.query('account_id')!.trim();
    try {
      const config = stripeConnectConfig(c.env);
      const lock = await connectHash(opaqueState());
      if (!await begin(c.env.DB, account, staff.id, session, lock, 'disconnecting')) return fail(c, 409, 'stripe_connect_busy');
      try {
        const row = await c.env.DB.prepare('SELECT provider_account_id,test_mode,connected_at FROM booking_payment_connections WHERE line_account_id=? AND disconnected_at IS NULL')
          .bind(account).first<{provider_account_id:string;test_mode:number;connected_at:string}>();
        if (row && row.test_mode !== 1) throw new StripeConnectError('stripe_connect_test_only');
        if (row) {
          const shared = await c.env.DB.prepare('SELECT 1 FROM booking_payment_connections WHERE provider_account_id=? AND line_account_id<>? AND disconnected_at IS NULL').bind(row.provider_account_id, account).first();
          if (shared) throw new StripeConnectError('stripe_connect_account_in_use');
          await revokeStripeConnect(config, row.provider_account_id,{db:c.env.DB,accountId:account,
            operationId:`disconnect:${row.provider_account_id}:${row.connected_at}`,authorize:()=>canAccessAllLineAccounts(c.env.DB,staff,[account])});
          await c.env.DB.batch([
            c.env.DB.prepare("UPDATE booking_payment_connections SET disconnected_at=?,updated_at=datetime('now') WHERE line_account_id=? AND provider_account_id=?")
              .bind(new Date().toISOString(), account, row.provider_account_id),
            c.env.DB.prepare("UPDATE booking_stripe_connect_states SET status='finished',updated_at=datetime('now') WHERE state_hash=?").bind(lock),
          ]);
        } else {
          await finish(c.env.DB, lock, 'finished');
        }
      } catch (error) { await finish(c.env.DB, lock, 'failed'); throw error; }
      return c.json({ success: true, data: { connected: false, testMode: true, accountIdTail: null, connectedAt: null, dashboardUrl: null } });
    } catch (error) {
      if (error instanceof StripeConnectError) return fail(c, 503, error.code);
      throw error;
    }
  });
}
