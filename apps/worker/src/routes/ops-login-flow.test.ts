import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.js';
import { encryptTotpSecret, totpAtStep } from '../lib/totp.js';
import { hashPassword } from '../services/password-hash.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import type { Env } from '../index.js';
import { authEmail } from './auth-email.js';
import { adminAuth } from './admin-auth.js';
import { ops } from './ops.js';

const PAGES = 'https://nen-line-stg-admin.pages.dev';
const WORKER = 'https://nen-line-stg.example.workers.dev';
const MASTER_KEY = 'test-master-key-which-is-longer-than-32-characters';
const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

let testDb: SqliteD1;

function environment(): Env['Bindings'] {
  return {
    DB: testDb.db,
    ADMIN_ORIGIN: PAGES,
    ADMIN_PUBLIC_URL: PAGES,
    WORKER_URL: WORKER,
    ADMIN_ALLOW_CROSS_SITE: 'true',
    TOTP_ENCRYPTION_KEY: MASTER_KEY,
  } as Env['Bindings'];
}

function app() {
  const instance = new Hono<Env>();
  instance.use('*', authMiddleware);
  instance.route('/', authEmail);
  instance.route('/', adminAuth);
  instance.route('/', ops);
  return instance;
}

beforeEach(async () => {
  testDb = createTestD1();
  const passwordHash = await hashPassword('Abcdefg1');
  const encryptedSecret = await encryptTotpSecret(SECRET, MASTER_KEY);
  testDb.raw.prepare(
    `INSERT INTO staff_members
       (id, name, email, role, api_key, is_active, invite_status, password_hash, totp_secret_enc, totp_enabled_at)
     VALUES ('ops-login-e2e', '運営テスト', 'ops-e2e@example.com', 'owner', 'ops-e2e-key', 1, 'active', ?, ?, ?)`,
  ).run(passwordHash, encryptedSecret, new Date().toISOString());
  testDb.raw.prepare(
    `INSERT INTO platform_admins (staff_id, is_active, activation_state)
     VALUES ('ops-login-e2e', 1, 'active')`,
  ).run();
});

/*
 * 二段階認証は一時解除中（利用者指示 2026-10-03）。運営ログインもパスワードが
 * 合えばその場でセッションが出る。再有効化したら合言葉→/api/auth/two-factor/verify
 * →セッションの順に戻す（`totpAtStep` と `SECRET` はそのために残している）。
 */
describe('運営コンソールのメールログイン', () => {
  it('パスワードでsessionを受け取り、そのBearerでsession確認とops認可まで通る', async () => {
    const login = await app().request(`${WORKER}/api/auth/password/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: PAGES },
      body: JSON.stringify({ email: 'ops-e2e@example.com', password: 'Abcdefg1', next: 'ops' }),
    }, environment());
    expect(login.status, await login.clone().text()).toBe(200);
    const loginBody = await login.json() as { data: { twoFactor: boolean; sessionToken: string }; csrfToken: string };
    expect(loginBody.data.twoFactor).toBe(false);
    expect(loginBody.data.sessionToken).toBeTruthy();
    expect(loginBody.csrfToken).toBeTruthy();

    const authorization = `Bearer lh_session:${loginBody.data.sessionToken}`;
    const session = await app().request(`${WORKER}/api/auth/session`, {
      headers: { Authorization: authorization, Origin: PAGES },
    }, environment());
    expect(session.status, await session.clone().text()).toBe(200);
    expect(await session.json()).toMatchObject({
      success: true,
      data: { id: 'ops-login-e2e', platformAdmin: true, platformAdminState: 'active' },
    });

    const me = await app().request(`${WORKER}/api/ops/me`, {
      headers: { Authorization: authorization, Origin: PAGES },
    }, environment());
    expect(me.status, await me.clone().text()).toBe(200);
    expect(await me.json()).toMatchObject({ success: true, data: { id: 'ops-login-e2e' } });
  });
});
