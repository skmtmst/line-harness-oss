import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

import type { Env } from '../index.js';
import { encryptTotpSecret, totpAtStep } from '../lib/totp.js';
import { hashPassword } from '../services/password-hash.js';
import { sha256Hex } from '../middleware/auth.js';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { adminAuth } from './admin-auth.js';

const NOW = '2026-09-08T00:00:00.000Z';
const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const MASTER_KEY = 'test-master-key-which-is-longer-than-32-characters';
const LIMIT_ERROR = '入力回数を超えました。しばらく待ってからやり直してください';

let testDb: ReturnType<typeof createTestD1>;

function app() {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', {
      id: 'staff-1', name: 'Staff One', role: 'admin', readOnly: false,
    });
    await next();
  });
  instance.route('/', adminAuth);
  return instance;
}

function bindings(): Env['Bindings'] {
  return {
    DB: testDb.db,
    TOTP_ENCRYPTION_KEY: MASTER_KEY,
  } as Env['Bindings'];
}

async function requestStepUp(code: string, purpose = 'operations.control') {
  return app().request('/api/auth/step-up', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, purpose }),
  }, bindings());
}

async function currentCode(): Promise<string> {
  return totpAtStep(SECRET, Math.floor(Date.now() / 30_000));
}

async function wrongCode(): Promise<string> {
  return await currentCode() === '000000' ? '000001' : '000000';
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  testDb = createTestD1();
  testDb.raw.prepare(
    `INSERT INTO staff_members
       (id, name, role, api_key, is_active, totp_secret_enc, totp_enabled_at)
     VALUES (?, ?, 'admin', ?, 1, ?, ?)`,
  ).run(
    'staff-1', 'Staff One', 'staff-1-key',
    await encryptTotpSecret(SECRET, MASTER_KEY), NOW,
  );
});

afterEach(() => {
  testDb.raw.close();
  vi.useRealTimers();
});

describe('POST /api/auth/step-up の試行回数制限', () => {
  it('職員が5回目の認証に失敗した時点から429にする', async () => {
    const invalid = await wrongCode();
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      expect((await requestStepUp(invalid)).status).toBe(400);
    }

    const fifth = await requestStepUp(invalid, 'affiliate.payout.export');
    expect(fifth.status).toBe(429);
    // R503: 上限時は待ち秒数を本文と Retry-After の両方で返す。
    await expect(fifth.json()).resolves.toEqual({
      success: false, error: LIMIT_ERROR, data: { retryAfterSeconds: expect.any(Number) },
    });
    const retryAfter = Number(fifth.headers.get('Retry-After'));
    expect(Number.isInteger(retryAfter) && retryAfter > 0).toBe(true);

    const blocked = await requestStepUp(await currentCode(), 'photo.original.download');
    expect(blocked.status).toBe(429);
    expect(testDb.raw.prepare(
      'SELECT attempts FROM auth_step_up_attempts WHERE staff_id = ?',
    ).get('staff-1')).toEqual({ attempts: 5 });
  });

  it('5回目までに成功したら失敗回数を消す', async () => {
    const invalid = await wrongCode();
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      expect((await requestStepUp(invalid)).status).toBe(400);
    }

    const success = await requestStepUp(await currentCode());
    expect(success.status).toBe(201);
    await expect(success.json()).resolves.toMatchObject({
      success: true,
      data: { token: expect.any(String), purpose: 'operations.control' },
    });
    expect(testDb.raw.prepare(
      'SELECT * FROM auth_step_up_attempts WHERE staff_id = ?',
    ).get('staff-1')).toBeUndefined();
    // 発行した確認票には発行時の権限の版が残る（試験台にセッション行は無い）。
    expect(testDb.raw.prepare(
      'SELECT session_token_hash, issued_policy_version FROM auth_step_up_grants WHERE staff_id = ?',
    ).get('staff-1')).toEqual({ session_token_hash: null, issued_policy_version: 1 });
  });

  it('10分の窓が過ぎたら再び認証を試せる', async () => {
    const invalid = await wrongCode();
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await requestStepUp(invalid);
    }

    vi.advanceTimersByTime(10 * 60_000 + 1);
    const retried = await requestStepUp(await wrongCode());
    expect(retried.status).toBe(400);
    expect(testDb.raw.prepare(
      'SELECT attempts, window_started_at FROM auth_step_up_attempts WHERE staff_id = ?',
    ).get('staff-1')).toEqual({
      attempts: 1,
      window_started_at: new Date().toISOString(),
    });
  });
});

describe('POST /api/auth/step-up のパスワード経路（V）', () => {
  const PASSWORD = 'Passw0rd-test';

  beforeEach(async () => {
    // 2段階認証なし・パスワードありの職員に差し替える。
    testDb.raw.prepare(
      `UPDATE staff_members SET totp_secret_enc = NULL, totp_enabled_at = NULL, password_hash = ?
       WHERE id = 'staff-1'`,
    ).run(await hashPassword(PASSWORD));
  });

  it('正しいパスワードなら grant を発行し、セッションに再確認時刻を刻む', async () => {
    // セッション行を用意し、cookie の持ち主として刻まれることを確かめる。
    const sessionToken = 'session-token-for-step-up';
    testDb.raw.prepare(
      `INSERT INTO admin_sessions (token_hash, staff_id, expires_at) VALUES (?, ?, ?)`,
    ).run(await sha256Hex(sessionToken), 'staff-1', '2999-01-01T00:00:00.000Z');

    const res = await app().request('/api/auth/step-up', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `lh_admin_session=${sessionToken}`,
      },
      body: JSON.stringify({ password: PASSWORD, purpose: 'line_account.credentials' }),
    }, bindings());
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      data: { token: expect.any(String), purpose: 'line_account.credentials' },
    });
    expect(testDb.raw.prepare(
      'SELECT step_up_at FROM admin_sessions WHERE staff_id = ?',
    ).get('staff-1')).toEqual({ step_up_at: NOW });
    // 成功で試行枠は解放される。
    expect(testDb.raw.prepare(
      'SELECT * FROM auth_step_up_attempts WHERE staff_id = ?',
    ).get('staff-1')).toBeUndefined();
  });

  it('間違ったパスワードは400で、試行回数を消費する', async () => {
    const res = await app().request('/api/auth/step-up', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong-pass1', purpose: 'operations.control' }),
    }, bindings());
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ success: false, error: 'パスワードが正しくありません' });
    expect(testDb.raw.prepare(
      'SELECT attempts FROM auth_step_up_attempts WHERE staff_id = ?',
    ).get('staff-1')).toEqual({ attempts: 1 });
  });

  it('空のパスワードは形式エラーで、試行回数を消費しない', async () => {
    const res = await app().request('/api/auth/step-up', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: '', purpose: 'operations.control' }),
    }, bindings());
    expect(res.status).toBe(400);
    expect(testDb.raw.prepare(
      'SELECT * FROM auth_step_up_attempts WHERE staff_id = ?',
    ).get('staff-1')).toBeUndefined();
  });

  it('登録されていない目的は400で拒否する', async () => {
    const res = await app().request('/api/auth/step-up', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD, purpose: 'anything.goes' }),
    }, bindings());
    expect(res.status).toBe(400);
    expect(testDb.raw.prepare(
      'SELECT * FROM auth_step_up_attempts WHERE staff_id = ?',
    ).get('staff-1')).toBeUndefined();
  });

  it('二段階認証もパスワードも無い職員は403で止める', async () => {
    testDb.raw.prepare('UPDATE staff_members SET password_hash = NULL WHERE id = ?').run('staff-1');
    const res = await app().request('/api/auth/step-up', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD, purpose: 'operations.control' }),
    }, bindings());
    expect(res.status).toBe(403);
  });
});

describe('POST /api/auth/step-up の優先順位（V）', () => {
  it('二段階認証を設定済みの人にパスワードは聞かず、6桁コードを求める', async () => {
    // beforeEach で TOTP 設定済み。パスワードを送っても TOTP 経路の形式検査に掛かる。
    const res = await requestStepUp('not-a-code');
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ success: false, error: '6桁の認証コードを入力してください' });
  });
});

describe('POST /api/auth/step-up のstaff文脈ガード', () => {
  /*
   * #1058: 再認証フローの401は管理画面の共通「セッション喪失」合図と
   * 区別できるよう、機械コードを本文へ付ける。
   * （本番では認証middlewareが先に401を返すため、ここは保険の経路）
   */
  it('staff文脈が無い呼び出しは STEP_UP_UNAUTHORIZED 付きの401を返す', async () => {
    const bare = new Hono<Env>();
    bare.route('/', adminAuth);
    const res = await bare.request('/api/auth/step-up', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: '123456', purpose: 'operations.control' }),
    }, bindings());
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({
      success: false,
      code: 'STEP_UP_UNAUTHORIZED',
    });
  });
});
