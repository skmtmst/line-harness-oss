import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { hashPassword } from '../services/password-hash.js';
import { encryptTotpSecret, totpAtStep } from '../lib/totp.js';
import { adminAuth } from './admin-auth.js';
import { authEmail } from './auth-email.js';
import { sha256Hex } from '../middleware/auth.js';

/**
 * N-426/N-434: 管理者のMFA必須とセッション期限（既定8時間・記憶時7日）。
 *
 * - 管理者束（owner/admin・閲覧専用でない）はTOTP未登録のまま通常セッションを取れない
 * - 設定は setup 用途の合言葉経由で行い、確認が通った時点でセッションが出る
 * - verify 用途と setup 用途の合言葉は入れ替えて使えない
 * - 期限は cookie の Max-Age と admin_sessions.expires_at が一致する
 */

const MASTER_KEY = 'test-master-key-which-is-longer-than-32-characters';
const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

let testDb: SqliteD1;

function env(overrides: Partial<Env['Bindings']> = {}): Env['Bindings'] {
  return {
    DB: testDb.db,
    ADMIN_ORIGIN: 'https://admin.example.com',
    ADMIN_PUBLIC_URL: 'https://admin.example.com',
    LINE_LOGIN_CHANNEL_ID: 'login-channel',
    LINE_LOGIN_CHANNEL_SECRET: 'login-secret',
    TOTP_ENCRYPTION_KEY: MASTER_KEY,
    ...overrides,
  } as Env['Bindings'];
}

function app() {
  const instance = new Hono<Env>();
  instance.route('/', adminAuth);
  instance.route('/', authEmail);
  return instance;
}

async function call(
  method: string,
  path: string,
  body?: unknown,
  opts: { env?: Partial<Env['Bindings']>; headers?: Record<string, string> } = {},
) {
  return app().request(`https://api.example.com${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, env(opts.env));
}

function seedStaff(id: string, overrides: Record<string, unknown> = {}) {
  testDb.raw
    .prepare(`INSERT INTO staff_members (id, name, email, role, api_key, is_active, access_level) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(
      id,
      (overrides.name as string) ?? '権限者',
      (overrides.email as string) ?? `${id}@example.com`,
      (overrides.role as string) ?? 'owner',
      (overrides.api_key as string) ?? `key-${id}`,
      (overrides.is_active as number) ?? 1,
      (overrides.access_level as string) ?? 'full',
    );
}

async function seedOwnerWithPassword(password = 'Abcdefg1') {
  const hash = await hashPassword(password);
  testDb.raw
    .prepare(`INSERT INTO staff_members (id, name, email, role, api_key, is_active, password_hash) VALUES ('s1', '山田 太郎', 'owner@example.com', 'owner', 'key-1', 1, ?)`)
    .run(hash);
}

async function enableTotp(staffId: string) {
  testDb.raw
    .prepare(`UPDATE staff_members SET totp_secret_enc = ?, totp_enabled_at = '2026-09-01T00:00:00.000+09:00' WHERE id = ?`)
    .run(await encryptTotpSecret(SECRET, MASTER_KEY), staffId);
}

function sessionRows(): Array<{ token_hash: string; staff_id: string; expires_at: string }> {
  return testDb.raw.prepare('SELECT token_hash, staff_id, expires_at FROM admin_sessions').all() as Array<{ token_hash: string; staff_id: string; expires_at: string }>;
}

function challengeRows(): Array<{ token_hash: string; staff_id: string; purpose: string; remember: number }> {
  return testDb.raw.prepare('SELECT token_hash, staff_id, purpose, remember FROM admin_two_factor_challenges').all() as Array<{ token_hash: string; staff_id: string; purpose: string; remember: number }>;
}

function cookieFor(res: Response, name: string): string | undefined {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  const cookies = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [res.headers.get('set-cookie') ?? ''];
  return cookies.find((cookie) => cookie.startsWith(`${name}=`));
}

async function currentCode(secret = SECRET): Promise<string> {
  return totpAtStep(secret, Math.floor(Date.now() / 30_000));
}

beforeEach(() => {
  testDb = createTestD1();
});

describe('N-426: 管理者のTOTP未登録では通常セッションを発行しない', () => {
  it('メール+パスワード: オーナーが未登録なら設定用の合言葉だけ返し、セッションは出さない', async () => {
    await seedOwnerWithPassword();
    const res = await call('POST', '/api/auth/password/login', { email: 'owner@example.com', password: 'Abcdefg1' });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { twoFactorSetup?: boolean; challengeToken?: string } };
    expect(body.data.twoFactorSetup).toBe(true);
    expect(body.data.challengeToken).toBeTruthy();
    expect(cookieFor(res, 'lh_admin_session')).toBeUndefined();
    expect(sessionRows()).toEqual([]);
    expect(challengeRows()).toMatchObject([{ staff_id: 's1', purpose: 'setup', remember: 0 }]);
  });

  it('staff 役割は必須対象外のため、未登録でもそのままセッションが出る', async () => {
    const hash = await hashPassword('Abcdefg1');
    testDb.raw
      .prepare(`INSERT INTO staff_members (id, name, email, role, api_key, is_active, password_hash) VALUES ('st1', '受付', 'staff@example.com', 'staff', 'key-st1', 1, ?)`)
      .run(hash);
    const res = await call('POST', '/api/auth/password/login', { email: 'staff@example.com', password: 'Abcdefg1' });
    expect(res.status).toBe(200);
    expect(cookieFor(res, 'lh_admin_session')).toBeTruthy();
    expect(sessionRows()).toHaveLength(1);
  });

  it('閲覧専用のオーナー（view_only束）も必須対象外', async () => {
    const hash = await hashPassword('Abcdefg1');
    testDb.raw
      .prepare(`INSERT INTO staff_members (id, name, email, role, api_key, is_active, access_level, password_hash) VALUES ('ro1', '閲覧', 'ro@example.com', 'owner', 'key-ro1', 1, 'read_only', ?)`)
      .run(hash);
    const res = await call('POST', '/api/auth/password/login', { email: 'ro@example.com', password: 'Abcdefg1' });
    expect(res.status).toBe(200);
    expect(sessionRows()).toHaveLength(1);
  });

  it('APIキー経由でも管理者のMFA必須は迂回できない', async () => {
    seedStaff('s2', { role: 'admin' });
    const res = await call('POST', '/api/auth/login', { apiKey: 'key-s2' });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { twoFactorSetup?: boolean; challengeToken?: string } };
    expect(body.data.twoFactorSetup).toBe(true);
    expect(sessionRows()).toEqual([]);
    expect(challengeRows()).toMatchObject([{ staff_id: 's2', purpose: 'setup' }]);
  });

  it('TOTP登録済みなら従来どおり確認用の合言葉が返る', async () => {
    await seedOwnerWithPassword();
    await enableTotp('s1');
    const res = await call('POST', '/api/auth/password/login', { email: 'owner@example.com', password: 'Abcdefg1' });
    const body = await res.json() as { data: { twoFactor?: boolean; challengeToken?: string } };
    expect(body.data.twoFactor).toBe(true);
    expect(challengeRows()).toMatchObject([{ staff_id: 's1', purpose: 'verify' }]);
  });
});

describe('N-426: 初回設定（setup合言葉 → 確認 → セッション）', () => {
  async function setupTokenFor(staffId: string, remember = false): Promise<string> {
    const res = await call('POST', '/api/auth/password/login', { email: 'owner@example.com', password: 'Abcdefg1', ...(remember ? { remember: true } : {}) });
    const body = await res.json() as { data: { challengeToken: string } };
    expect(challengeRows().find((row) => row.staff_id === staffId)?.purpose).toBe('setup');
    return body.data.challengeToken;
  }

  it('合言葉でQRの元（provisioningUri）を取り、正しいコードで登録完了＝セッション発行', async () => {
    await seedOwnerWithPassword();
    const token = await setupTokenFor('s1');

    const setup = await call('POST', '/api/auth/two-factor/setup', { challengeToken: token });
    expect(setup.status).toBe(200);
    const setupBody = await setup.json() as { data: { provisioningUri: string; manualKey: string } };
    expect(setupBody.data.provisioningUri).toContain('otpauth://totp/');
    expect(setupBody.data.manualKey.replace(/\s/g, '')).toMatch(/^[A-Z2-7]{32}$/);
    // サーバーには pending として暗号化して保存される
    const pending = testDb.raw.prepare('SELECT totp_pending_secret_enc, totp_enabled_at FROM staff_members WHERE id = ?').get('s1') as { totp_pending_secret_enc: string | null; totp_enabled_at: string | null };
    expect(pending.totp_pending_secret_enc).toBeTruthy();
    expect(pending.totp_enabled_at).toBeNull();

    // 手元で同じ秘密からコードを作る（provisioningUri の secret を使う）
    const secret = new URL(setupBody.data.provisioningUri).searchParams.get('secret')!;
    const confirm = await call('POST', '/api/auth/two-factor/setup/confirm', { challengeToken: token, code: await currentCode(secret) });
    expect(confirm.status).toBe(200);
    expect(cookieFor(confirm, 'lh_admin_session')).toBeTruthy();
    const sessions = sessionRows();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].staff_id).toBe('s1');
    const done = testDb.raw.prepare('SELECT totp_secret_enc, totp_pending_secret_enc, totp_enabled_at, totp_last_used_step FROM staff_members WHERE id = ?').get('s1') as Record<string, unknown>;
    expect(done.totp_secret_enc).toBeTruthy();
    expect(done.totp_pending_secret_enc).toBeNull();
    expect(done.totp_enabled_at).toBeTruthy();
    expect(done.totp_last_used_step).toBe(Math.floor(Date.now() / 30_000));
    expect(challengeRows()).toEqual([]);
  });

  it('コードが違うと400で試行回数が増え、5回で合言葉が消える', async () => {
    await seedOwnerWithPassword();
    const token = await setupTokenFor('s1');
    await call('POST', '/api/auth/two-factor/setup', { challengeToken: token });
    const wrong = (await currentCode()) === '000000' ? '000001' : '000000';
    for (let i = 0; i < 5; i += 1) {
      const res = await call('POST', '/api/auth/two-factor/setup/confirm', { challengeToken: token, code: wrong });
      expect(res.status).toBe(400);
    }
    // 6回目は上限で消える
    const res = await call('POST', '/api/auth/two-factor/setup/confirm', { challengeToken: token, code: wrong });
    expect(res.status).toBe(429);
    expect(challengeRows()).toEqual([]);
  });

  it('期限切れ・でたらめな合言葉は401。verify用途の合言葉では設定を始められない', async () => {
    await seedOwnerWithPassword();
    await enableTotp('s1');
    const login = await call('POST', '/api/auth/password/login', { email: 'owner@example.com', password: 'Abcdefg1' });
    const verifyToken = (await login.json() as { data: { challengeToken: string } }).data.challengeToken;

    // verify 用途を setup に使えない
    expect((await call('POST', '/api/auth/two-factor/setup', { challengeToken: verifyToken })).status).toBe(401);
    expect((await call('POST', '/api/auth/two-factor/setup/confirm', { challengeToken: verifyToken, code: '123456' })).status).toBe(401);

    // でたらめは401
    expect((await call('POST', '/api/auth/two-factor/setup', { challengeToken: 'x'.repeat(40) })).status).toBe(401);

    // 期限切れは401（未登録の別の管理者で setup 合言葉を用意する）
    const hash = await hashPassword('Abcdefg1');
    testDb.raw
      .prepare(`INSERT INTO staff_members (id, name, email, role, api_key, is_active, password_hash) VALUES ('s9', '別管理者', 's9@example.com', 'admin', 'key-s9', 1, ?)`)
      .run(hash);
    const otherLogin = await call('POST', '/api/auth/password/login', { email: 's9@example.com', password: 'Abcdefg1' });
    const setupToken = (await otherLogin.json() as { data: { challengeToken: string } }).data.challengeToken;
    testDb.raw.prepare(`UPDATE admin_two_factor_challenges SET expires_at = '2000-01-01T00:00:00.000+09:00' WHERE staff_id = 's9'`).run();
    expect((await call('POST', '/api/auth/two-factor/setup', { challengeToken: setupToken })).status).toBe(401);
    expect(challengeRows().filter((row) => row.staff_id === 's9')).toEqual([]);
  });

  it('setup用途の合言葉は verify では使えない（登録前に6桁を出しても401）', async () => {
    await seedOwnerWithPassword();
    const token = await setupTokenFor('s1');
    const res = await call('POST', '/api/auth/two-factor/verify', { challengeToken: token, code: '123456' });
    expect(res.status).toBe(401);
  });

  it('登録済みの人でも、用途を setup へ書き換えた合言葉は verify で通らない', async () => {
    await seedOwnerWithPassword();
    await enableTotp('s1');
    const login = await call('POST', '/api/auth/password/login', { email: 'owner@example.com', password: 'Abcdefg1' });
    const token = (await login.json() as { data: { challengeToken: string } }).data.challengeToken;
    // 合言葉の用途を setup へ書き換える（verify の用途判定がなければ正しいコードで抜けられる）
    testDb.raw.prepare(`UPDATE admin_two_factor_challenges SET purpose = 'setup' WHERE staff_id = 's1'`).run();
    const res = await call('POST', '/api/auth/two-factor/verify', { challengeToken: token, code: await currentCode() });
    expect(res.status).toBe(401);
    expect(sessionRows()).toEqual([]);
  });

  it('すでにTOTP登録済みの人には409', async () => {
    await seedOwnerWithPassword();
    const token = await setupTokenFor('s1');
    await enableTotp('s1');
    const res = await call('POST', '/api/auth/two-factor/setup', { challengeToken: token });
    expect(res.status).toBe(409);
  });

  it('別の権限者の合言葉では他人を設定できない（account境界）', async () => {
    await seedOwnerWithPassword();
    seedStaff('s2', { role: 'admin' });
    const token = await setupTokenFor('s1');
    await call('POST', '/api/auth/two-factor/setup', { challengeToken: token });
    const pending = testDb.raw.prepare('SELECT totp_pending_secret_enc FROM staff_members WHERE id = ?').get('s1') as { totp_pending_secret_enc: string };
    // s1 の合言葉で確認しても s2 には何も書かれない
    const pendingSecret = await import('../lib/totp.js').then((m) => m.decryptTotpSecret(pending.totp_pending_secret_enc, MASTER_KEY));
    const confirm = await call('POST', '/api/auth/two-factor/setup/confirm', { challengeToken: token, code: await currentCode(pendingSecret) });
    expect(confirm.status).toBe(200);
    const other = testDb.raw.prepare('SELECT totp_enabled_at FROM staff_members WHERE id = ?').get('s2') as { totp_enabled_at: string | null };
    expect(other.totp_enabled_at).toBeNull();
    // セッションは s1 のもの
    expect(sessionRows().map((row) => row.staff_id)).toEqual(['s1']);
  });
});

describe('N-434: セッション期限（既定8時間・明示選択で7日・cookieとサーバー一致）', () => {
  it('未選択は8時間: cookie Max-Age=28800 と admin_sessions.expires_at が一致', async () => {
    const hash = await hashPassword('Abcdefg1');
    testDb.raw
      .prepare(`INSERT INTO staff_members (id, name, email, role, api_key, is_active, password_hash) VALUES ('st1', '受付', 'staff@example.com', 'staff', 'key-st1', 1, ?)`)
      .run(hash);
    const res = await call('POST', '/api/auth/password/login', { email: 'staff@example.com', password: 'Abcdefg1' });
    expect(res.status).toBe(200);
    const cookie = cookieFor(res, 'lh_admin_session') ?? '';
    expect(cookie).toContain('Max-Age=28800');
    const expiresAt = Date.parse(sessionRows()[0].expires_at);
    expect(expiresAt - Date.now()).toBeGreaterThan(7.9 * 3600 * 1000);
    expect(expiresAt - Date.now()).toBeLessThan(8.1 * 3600 * 1000);
  });

  it('remember=true で7日: cookie Max-Age=604800 と DB が一致', async () => {
    const hash = await hashPassword('Abcdefg1');
    testDb.raw
      .prepare(`INSERT INTO staff_members (id, name, email, role, api_key, is_active, password_hash) VALUES ('st1', '受付', 'staff@example.com', 'staff', 'key-st1', 1, ?)`)
      .run(hash);
    const res = await call('POST', '/api/auth/password/login', { email: 'staff@example.com', password: 'Abcdefg1', remember: true });
    const cookie = cookieFor(res, 'lh_admin_session') ?? '';
    expect(cookie).toContain('Max-Age=604800');
    const expiresAt = Date.parse(sessionRows()[0].expires_at);
    expect(expiresAt - Date.now()).toBeGreaterThan(6.9 * 24 * 3600 * 1000);
  });

  it('TOTP確認経路でも記憶の選択が引き継がれる（合言葉→verify→7日）', async () => {
    await seedOwnerWithPassword();
    await enableTotp('s1');
    const login = await call('POST', '/api/auth/password/login', { email: 'owner@example.com', password: 'Abcdefg1', remember: true });
    const token = (await login.json() as { data: { challengeToken: string } }).data.challengeToken;
    expect(challengeRows()[0].remember).toBe(1);
    const verify = await call('POST', '/api/auth/two-factor/verify', { challengeToken: token, code: await currentCode() });
    expect(verify.status).toBe(200);
    expect(cookieFor(verify, 'lh_admin_session') ?? '').toContain('Max-Age=604800');
    const expiresAt = Date.parse(sessionRows()[0].expires_at);
    expect(expiresAt - Date.now()).toBeGreaterThan(6.9 * 24 * 3600 * 1000);
  });

  it('初回設定経路でも記憶の選択が引き継がれる（setup→confirm→7日）', async () => {
    await seedOwnerWithPassword();
    const login = await call('POST', '/api/auth/password/login', { email: 'owner@example.com', password: 'Abcdefg1', remember: true });
    const token = (await login.json() as { data: { challengeToken: string } }).data.challengeToken;
    const setup = await call('POST', '/api/auth/two-factor/setup', { challengeToken: token });
    const uri = (await setup.json() as { data: { provisioningUri: string } }).data.provisioningUri;
    const secret = new URL(uri).searchParams.get('secret')!;
    const confirm = await call('POST', '/api/auth/two-factor/setup/confirm', { challengeToken: token, code: await currentCode(secret) });
    expect(confirm.status).toBe(200);
    expect(cookieFor(confirm, 'lh_admin_session') ?? '').toContain('Max-Age=604800');
  });
});

describe('N-426: LINEログイン経路でも同じ門を通る', () => {
  function lineFetchMock(sub: string) {
    return vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ id_token: 'id-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sub }), { status: 200 }));
  }

  const oauthCookies = 'lh_line_state=expected; lh_line_nonce=nonce; lh_line_verifier=verifier';

  it('TOTP未登録の管理者は設定画面へ回され、セッションは発行されない', async () => {
    seedStaff('s1', { role: 'admin' });
    testDb.raw.prepare(`UPDATE staff_members SET line_user_id = 'U-admin' WHERE id = 's1'`).run();
    const spy = lineFetchMock('U-admin');
    const res = await app().request('https://api.example.com/api/auth/line/callback?code=abc&state=expected', {
      headers: { Cookie: oauthCookies },
    }, env());
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('Location')!);
    expect(location.pathname).toBe('/login/two-factor/setup');
    expect(new URLSearchParams(location.hash.slice(1)).get('lh_2fa')).toBeTruthy();
    expect(sessionRows()).toEqual([]);
    expect(challengeRows()).toMatchObject([{ staff_id: 's1', purpose: 'setup' }]);
    spy.mockRestore();
  });

  it('必須対象でない staff はそのままセッションが出る', async () => {
    seedStaff('s3', { role: 'staff' });
    testDb.raw.prepare(`UPDATE staff_members SET line_user_id = 'U-staff' WHERE id = 's3'`).run();
    const spy = lineFetchMock('U-staff');
    const res = await app().request('https://api.example.com/api/auth/line/callback?code=abc&state=expected', {
      headers: { Cookie: oauthCookies },
    }, env());
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toContain('admin.example.com');
    expect(res.headers.get('Location')).not.toContain('two-factor');
    expect(sessionRows()).toHaveLength(1);
    spy.mockRestore();
  });

  it('?remember=1 の印がcallbackの合言葉へ引き継がれる', async () => {
    seedStaff('s1', { role: 'admin' });
    testDb.raw.prepare(`UPDATE staff_members SET line_user_id = 'U-admin' WHERE id = 's1'`).run();
    // /api/auth/line?remember=1 が lh_line_remember cookie を立てる
    const start = await app().request('https://api.example.com/api/auth/line?remember=1', {}, env());
    expect(cookieFor(start, 'lh_line_remember')).toBeTruthy();
    const spy = lineFetchMock('U-admin');
    const res = await app().request('https://api.example.com/api/auth/line/callback?code=abc&state=expected', {
      headers: { Cookie: `${oauthCookies}; lh_line_remember=1` },
    }, env());
    expect(res.status).toBe(302);
    expect(challengeRows()).toMatchObject([{ staff_id: 's1', purpose: 'setup', remember: 1 }]);
    spy.mockRestore();
  });
});

describe('N-426: 復旧導線（認証アプリを失くしても詰まない）', () => {
  it('パスワード再設定は登録済みTOTPも外し、次のログインは再設定へ進む', async () => {
    await seedOwnerWithPassword();
    await enableTotp('s1');
    // reset token を直接作る（メール送信経路は auth-email.test.ts が担保）
    const token = 'reset-token-for-test-0000000000000000';
    await testDb.db.prepare(
      `INSERT INTO auth_email_tokens (id, purpose, token_hash, email, staff_id, expires_at) VALUES ('t1', 'password_reset', ?, 'owner@example.com', 's1', '2999-01-01T00:00:00.000+09:00')`,
    ).bind(await sha256Hex(token)).run();

    const res = await call('POST', '/api/auth/password/reset', { token, password: 'Newpass99' });
    expect(res.status).toBe(200);
    const staff = testDb.raw.prepare('SELECT totp_secret_enc, totp_enabled_at FROM staff_members WHERE id = ?').get('s1') as Record<string, unknown>;
    expect(staff.totp_secret_enc).toBeNull();
    expect(staff.totp_enabled_at).toBeNull();
    // 復旧でTOTPを外した記録が高危険監査へ残る
    const audit = testDb.raw.prepare(`SELECT COUNT(*) AS n FROM audit_events WHERE action = 'auth.totp_reset' AND actor_principal_id = 's1' AND risk_level = 'high'`).get() as { n: number };
    expect(audit.n).toBe(1);
    // 次のログインは設定用の合言葉へ
    const login = await call('POST', '/api/auth/password/login', { email: 'owner@example.com', password: 'Newpass99' });
    expect((await login.json() as { data: { twoFactorSetup?: boolean } }).data.twoFactorSetup).toBe(true);
  });
});
