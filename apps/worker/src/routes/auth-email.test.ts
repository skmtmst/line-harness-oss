import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { hashPassword } from '../services/password-hash.js';

const mail = vi.hoisted(() => ({
  sendPlainMail: vi.fn(async (_env: unknown, _message: { to: string; subject: string; body: string }) => {}),
}));
vi.mock('../services/plain-mail.js', () => ({ sendPlainMail: mail.sendPlainMail }));

const turnstile = vi.hoisted(() => ({ result: { ok: true } as { ok: true } | { ok: false; reason: 'not_configured' | 'missing_token' | 'rejected' | 'unavailable' } }));
vi.mock('../services/turnstile.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/turnstile.js')>();
  return { ...actual, verifyTurnstile: vi.fn(async () => turnstile.result) };
});

const { authEmail } = await import('./auth-email.js');

let testDb: SqliteD1;

function env(overrides: Partial<Env['Bindings']> = {}): Env['Bindings'] {
  return {
    DB: testDb.db,
    ADMIN_ORIGIN: 'https://admin.example.com',
    ADMIN_PUBLIC_URL: 'https://admin.example.com',
    TURNSTILE_SECRET_KEY: 'turnstile-secret-for-test',
    ...overrides,
  } as Env['Bindings'];
}

function app() {
  const instance = new Hono<Env>();
  instance.route('/', authEmail);
  return instance;
}

type AuthJson = {
  csrfToken: string;
  code: string;
  error: string;
  errors: Record<string, string>;
  data: {
    email: string;
    trialDays: number;
    deviceMarker: string;
    tenantId: string;
    twoFactor: boolean;
    challengeToken: string;
  };
};

async function json(response: Response): Promise<AuthJson> {
  return response.json() as Promise<AuthJson>;
}

async function call(
  method: string,
  path: string,
  body?: unknown,
  opts: { env?: Partial<Env['Bindings']>; headers?: Record<string, string>; ip?: string } = {},
) {
  return app().request(
    `https://api.example.com${path}`,
    {
      method,
      headers: {
        'Content-Type': 'application/json',
        'cf-connecting-ip': opts.ip ?? '203.0.113.10',
        ...(opts.headers ?? {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env(opts.env),
  );
}

/** 送ったメールの本文から URL のトークンを取り出す。 */
function lastMailToken(): string {
  const last = mail.sendPlainMail.mock.calls.at(-1)?.[1] as { body: string } | undefined;
  const match = last?.body.match(/token=([A-Za-z0-9_%-]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

function lastMailSubject(): string {
  return (mail.sendPlainMail.mock.calls.at(-1)?.[1] as { subject: string } | undefined)?.subject ?? '';
}

beforeEach(() => {
  testDb = createTestD1();
  mail.sendPlainMail.mockClear();
  turnstile.result = { ok: true };
});

const validRequest = { email: 'Owner@Example.com', turnstileToken: 'tok', agreed: true };

describe('会員登録（36-4）', () => {
  it('メールを入れると本登録 URL のメールを送り、URL から統括とオーナーができてログイン状態になる', async () => {
    const requested = await call('POST', '/api/auth/register/request', validRequest);
    expect(requested.status).toBe(200);
    expect(lastMailSubject()).toBe('【musubo】メールアドレスの確認と本登録');
    const token = lastMailToken();
    expect(token.length).toBeGreaterThan(20);

    const check = await call('GET', `/api/auth/register/check?token=${encodeURIComponent(token)}`);
    expect(check.status).toBe(200);
    expect((await json(check)).data).toEqual({ email: 'owner@example.com', trialDays: 30 });

    const completed = await call('POST', '/api/auth/register/complete', {
      token,
      tenantName: 'Shed Products株式会社',
      name: '坂本 真人',
      password: 'Abcdefg1',
    });
    expect(completed.status).toBe(200);
    const body = await json(completed);
    expect(body.csrfToken).toBeTruthy();
    expect(body.data.deviceMarker).toMatch(/^[A-Za-z0-9_-]{16,}$/);
    expect(completed.headers.get('set-cookie')).toContain('lh_admin_session=');
    expect(completed.headers.get('set-cookie')).toContain('lh_signup_marker=');

    const tenant = testDb.raw.prepare('SELECT name, plan_status, trial_ends_at, signup_device_marker FROM tenants WHERE id = ?').get(body.data.tenantId) as Record<string, string>;
    expect(tenant.name).toBe('Shed Products株式会社');
    expect(tenant.plan_status).toBe('trialing');
    expect(Date.parse(tenant.trial_ends_at) - Date.now()).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
    expect(tenant.signup_device_marker).toBe(body.data.deviceMarker);

    const staff = testDb.raw.prepare('SELECT role, is_active, invite_status, email, email_verified_at, password_hash, tenant_id FROM staff_members WHERE email = ?').get('owner@example.com') as Record<string, string | number>;
    expect(staff.role).toBe('owner');
    expect(staff.is_active).toBe(1);
    expect(staff.invite_status).toBe('active');
    expect(staff.tenant_id).toBe(body.data.tenantId);
    expect(staff.email_verified_at).toBeTruthy();
    expect(String(staff.password_hash)).toContain('pbkdf2-sha256$');

    // 同じ URL は 2 回使えない
    const again = await call('POST', '/api/auth/register/complete', { token, tenantName: 'x', name: 'y', password: 'Abcdefg1' });
    expect(again.status).toBe(410);
  });

  it('登録済みのメールでも返事は同じで、本人には「すでに登録されています」のメールが届く', async () => {
    testDb.raw.prepare(`INSERT INTO staff_members (id, name, email, role, api_key) VALUES ('s1', '既存', 'owner@example.com', 'owner', 'key-1')`).run();
    const res = await call('POST', '/api/auth/register/request', validRequest);
    expect(res.status).toBe(200);
    expect(lastMailSubject()).toBe('【musubo】このメールアドレスはすでに登録されています');
    expect(testDb.raw.prepare('SELECT COUNT(*) AS n FROM auth_email_tokens').get()).toEqual({ n: 0 });
  });

  it('Turnstile が通らないと受け付けない。鍵が無いときは 503 で理由を分ける', async () => {
    turnstile.result = { ok: false, reason: 'rejected' };
    expect((await call('POST', '/api/auth/register/request', validRequest)).status).toBe(400);
    turnstile.result = { ok: false, reason: 'not_configured' };
    expect((await call('POST', '/api/auth/register/request', validRequest)).status).toBe(503);
    expect(mail.sendPlainMail).not.toHaveBeenCalled();
  });

  it('同意が無い・メールの形が違うと 400', async () => {
    expect((await call('POST', '/api/auth/register/request', { ...validRequest, agreed: false })).status).toBe(400);
    expect((await call('POST', '/api/auth/register/request', { ...validRequest, email: 'not-an-email' })).status).toBe(400);
  });

  it('同じブラウザ（印）からの 2 回目は 409 で断る。localStorage の印でも Cookie の印でも', async () => {
    await call('POST', '/api/auth/register/request', validRequest);
    const token = lastMailToken();
    const completed = await call('POST', '/api/auth/register/complete', { token, tenantName: 'A', name: 'a', password: 'Abcdefg1' });
    const marker = (await json(completed)).data.deviceMarker;

    const viaBody = await call('POST', '/api/auth/register/request', { ...validRequest, email: 'second@example.com', deviceMarker: marker });
    expect(viaBody.status).toBe(409);
    expect((await json(viaBody)).code).toBe('device_registered');

    const viaCookie = await call('POST', '/api/auth/register/request', { ...validRequest, email: 'third@example.com' }, { headers: { cookie: `lh_signup_marker=${marker}` } });
    expect(viaCookie.status).toBe(409);

    // 印が無ければ別の人として通る
    const fresh = await call('POST', '/api/auth/register/request', { ...validRequest, email: 'fourth@example.com' }, { ip: '198.51.100.7' });
    expect(fresh.status).toBe(200);
  });

  it('同じ接続元は 1 日 5 件、同じメールは 1 日 3 件まで', async () => {
    for (let i = 0; i < 3; i += 1) {
      expect((await call('POST', '/api/auth/register/request', validRequest)).status).toBe(200);
    }
    expect((await call('POST', '/api/auth/register/request', validRequest)).status).toBe(429);
    expect((await call('POST', '/api/auth/register/request', { ...validRequest, email: 'b@example.com' })).status).toBe(200);
    expect((await call('POST', '/api/auth/register/request', { ...validRequest, email: 'c@example.com' })).status).toBe(429);
  });

  it('本登録の入力: 会社名・名前・パスワードの決まり', async () => {
    await call('POST', '/api/auth/register/request', validRequest);
    const token = lastMailToken();
    const res = await call('POST', '/api/auth/register/complete', { token, tenantName: '', name: '', password: 'short' });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.errors).toMatchObject({ tenantName: expect.any(String), name: expect.any(String), password: expect.any(String) });
    // 失敗しても URL は消費されない
    expect((await call('GET', `/api/auth/register/check?token=${token}`)).status).toBe(200);
  });

  it('期限切れ・でたらめな URL は 410／404', async () => {
    await call('POST', '/api/auth/register/request', validRequest);
    const token = lastMailToken();
    testDb.raw.prepare(`UPDATE auth_email_tokens SET expires_at = '2000-01-01T00:00:00.000+09:00'`).run();
    expect((await call('GET', `/api/auth/register/check?token=${token}`)).status).toBe(410);
    expect((await call('GET', '/api/auth/register/check?token=zzzzzzzzzzzzzzzzzzzzzzzz')).status).toBe(404);
  });
});

describe('メール＋パスワードのログイン', () => {
  async function seedOwner(overrides: Record<string, unknown> = {}) {
    const hash = await hashPassword('Abcdefg1');
    testDb.raw
      .prepare(`INSERT INTO staff_members (id, name, email, role, api_key, is_active, password_hash) VALUES ('s1', '坂本 真人', 'owner@example.com', 'owner', 'key-1', ?, ?)`)
      .run((overrides.is_active as number) ?? 1, hash);
  }

  it('正しい組み合わせでセッションが出る。大文字小文字は区別しない', async () => {
    await seedOwner();
    const res = await call('POST', '/api/auth/password/login', { email: 'OWNER@example.com', password: 'Abcdefg1' });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.csrfToken).toBeTruthy();
    expect(body.data.twoFactor).toBe(false);
    expect(res.headers.get('set-cookie')).toContain('lh_admin_session=');
    expect(testDb.raw.prepare(`SELECT COUNT(*) AS n FROM login_audit WHERE action = 'login'`).get()).toEqual({ n: 1 });
  });

  it('違うパスワード・知らないメール・無効な権限者は同じ言葉で 401', async () => {
    await seedOwner();
    const wrong = await call('POST', '/api/auth/password/login', { email: 'owner@example.com', password: 'Abcdefg2' });
    expect(wrong.status).toBe(401);
    const unknown = await call('POST', '/api/auth/password/login', { email: 'nobody@example.com', password: 'Abcdefg1' });
    expect(unknown.status).toBe(401);
    expect((await json(wrong)).error).toBe((await json(unknown)).error);
    expect(testDb.raw.prepare(`SELECT COUNT(*) AS n FROM login_audit WHERE action = 'fail'`).get()).toEqual({ n: 2 });
  });

  it('LINE だけの権限者（パスワード無し）はメールでは入れない', async () => {
    testDb.raw.prepare(`INSERT INTO staff_members (id, name, email, role, api_key, line_user_id) VALUES ('s2', 'LINEの人', 'line@example.com', 'admin', 'key-2', 'U1')`).run();
    expect((await call('POST', '/api/auth/password/login', { email: 'line@example.com', password: 'Abcdefg1' })).status).toBe(401);
  });

  it('15 分に 10 回失敗すると 429 で止め、成功すると数が消える', async () => {
    await seedOwner();
    for (let i = 0; i < 10; i += 1) {
      expect((await call('POST', '/api/auth/password/login', { email: 'owner@example.com', password: 'wrong0000' })).status).toBe(401);
    }
    expect((await call('POST', '/api/auth/password/login', { email: 'owner@example.com', password: 'Abcdefg1' })).status).toBe(429);
    // 別の接続元は別に数える
    expect((await call('POST', '/api/auth/password/login', { email: 'owner@example.com', password: 'Abcdefg1' }, { ip: '198.51.100.7' })).status).toBe(200);
  });

  it('二段階認証を有効にしている人は合言葉を返し、セッションはまだ出さない', async () => {
    await seedOwner();
    testDb.raw.prepare(`UPDATE staff_members SET totp_secret_enc = 'enc', totp_enabled_at = '2026-09-01T00:00:00.000+09:00' WHERE id = 's1'`).run();
    const res = await call('POST', '/api/auth/password/login', { email: 'owner@example.com', password: 'Abcdefg1' }, { env: { TOTP_ENCRYPTION_KEY: 'k' } });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.twoFactor).toBe(true);
    expect(body.data.challengeToken).toBeTruthy();
    expect(res.headers.get('set-cookie') ?? '').not.toContain('lh_admin_session=');
    expect(testDb.raw.prepare('SELECT COUNT(*) AS n FROM admin_two_factor_challenges').get()).toEqual({ n: 1 });
  });
});

describe('パスワード再設定（36-6）', () => {
  it('メールの URL から新しいパスワードを設定でき、古いセッションは消える', async () => {
    const hash = await hashPassword('Abcdefg1');
    testDb.raw.prepare(`INSERT INTO staff_members (id, name, email, role, api_key, password_hash) VALUES ('s1', '坂本 真人', 'owner@example.com', 'owner', 'key-1', ?)`).run(hash);
    testDb.raw.prepare(`INSERT INTO admin_sessions (token_hash, staff_id, expires_at) VALUES ('old', 's1', '2099-01-01T00:00:00.000Z')`).run();

    const forgot = await call('POST', '/api/auth/password/forgot', { email: 'owner@example.com', turnstileToken: 'tok' });
    expect(forgot.status).toBe(200);
    expect(lastMailSubject()).toBe('【musubo】パスワードの再設定');
    const token = lastMailToken();

    expect((await call('GET', `/api/auth/password/reset/check?token=${token}`)).status).toBe(200);
    const reset = await call('POST', '/api/auth/password/reset', { token, password: 'Newpass99' });
    expect(reset.status).toBe(200);
    expect(testDb.raw.prepare('SELECT COUNT(*) AS n FROM admin_sessions').get()).toEqual({ n: 0 });

    expect((await call('POST', '/api/auth/password/login', { email: 'owner@example.com', password: 'Abcdefg1' })).status).toBe(401);
    expect((await call('POST', '/api/auth/password/login', { email: 'owner@example.com', password: 'Newpass99' })).status).toBe(200);
    expect((await call('POST', '/api/auth/password/reset', { token, password: 'Another11' })).status).toBe(410);
  });

  it('LINE だけの権限者もパスワードを持てる（そのメールの有効な人が 1 人のとき）', async () => {
    testDb.raw.prepare(`INSERT INTO staff_members (id, name, email, role, api_key, line_user_id) VALUES ('s2', 'LINEの人', 'line@example.com', 'admin', 'key-2', 'U1')`).run();
    await call('POST', '/api/auth/password/forgot', { email: 'line@example.com', turnstileToken: 'tok' });
    const token = lastMailToken();
    expect(token).toBeTruthy();
    expect((await call('POST', '/api/auth/password/reset', { token, password: 'Newpass99' })).status).toBe(200);
    expect((await call('POST', '/api/auth/password/login', { email: 'line@example.com', password: 'Newpass99' })).status).toBe(200);
  });

  it('知らないメールでも返事は同じで、メールは送らない', async () => {
    const res = await call('POST', '/api/auth/password/forgot', { email: 'nobody@example.com', turnstileToken: 'tok' });
    expect(res.status).toBe(200);
    expect(mail.sendPlainMail).not.toHaveBeenCalled();
  });

  it('同じメールに複数の権限者がいてどれも パスワード無しなら送らない（誰宛か決められない）', async () => {
    testDb.raw.prepare(`INSERT INTO staff_members (id, name, email, role, api_key) VALUES ('a', 'A', 'dup@example.com', 'admin', 'k1'), ('b', 'B', 'dup@example.com', 'admin', 'k2')`).run();
    await call('POST', '/api/auth/password/forgot', { email: 'dup@example.com', turnstileToken: 'tok' });
    expect(mail.sendPlainMail).not.toHaveBeenCalled();
  });

  it('Turnstile が通らないと再設定のメールも送らない', async () => {
    turnstile.result = { ok: false, reason: 'rejected' };
    expect((await call('POST', '/api/auth/password/forgot', { email: 'owner@example.com', turnstileToken: 'tok' })).status).toBe(400);
  });
});
