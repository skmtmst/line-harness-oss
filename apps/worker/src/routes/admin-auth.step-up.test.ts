import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

import type { Env } from '../index.js';
import { encryptTotpSecret, totpAtStep } from '../lib/totp.js';
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
    await expect(fifth.json()).resolves.toEqual({ success: false, error: LIMIT_ERROR });

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
