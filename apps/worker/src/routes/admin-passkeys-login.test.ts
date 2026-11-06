import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { sha256Hex } from '../middleware/auth.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import type { Env } from '../worker-env.js';
import { adminPasskeysLogin } from './admin-passkeys-login.js';

vi.mock('@simplewebauthn/server', async original => {
  const actual = await original<typeof import('@simplewebauthn/server')>();
  return { ...actual, verifyAuthenticationResponse: vi.fn(async () => ({ verified: true,
    authenticationInfo: { userVerified: true, newCounter: 1 } })) };
});

const ADMIN = 'https://stg-admin.example.com';
const API = 'https://stg-api.example.com';
const primaryToken = 'a'.repeat(48);
let fixture: SqliteD1;
function request(path: string, body: unknown, origin = ADMIN) {
  const app = new Hono<Env>(); app.route('/', adminPasskeysLogin);
  return app.request(`${API}${path}`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    { DB: fixture.db, ADMIN_ORIGIN: ADMIN, ADMIN_PUBLIC_URL: ADMIN, WORKER_URL: API,
      TOTP_ENCRYPTION_KEY: 'fixture-master-key-which-is-long-enough', DEPLOY_ENV: 'test' } as Env['Bindings']);
}

beforeEach(async () => {
  fixture = createTestD1();
  fixture.raw.prepare(`INSERT INTO staff_members(id,name,email,role,api_key,is_active,totp_enabled_at,totp_secret_enc)
    VALUES ('owner','Owner','owner@example.com','owner','key',1,?,?)`).run(new Date().toISOString(), 'fixture-secret');
  fixture.raw.prepare(`INSERT INTO admin_two_factor_challenges(token_hash,staff_id,expires_at,purpose,remember)
    VALUES (?,?,?,?,?)`).run(await sha256Hex(primaryToken), 'owner', new Date(Date.now() + 300_000).toISOString(), 'verify', 0);
});
afterEach(() => fixture.raw.close());

describe('login passkey after primary authentication', () => {
  it('requires the primary challenge and the canonical admin origin', async () => {
    expect((await request('/api/auth/passkeys/login/options', { challengeToken: 'bad' })).status).toBe(401);
    expect((await request('/api/auth/passkeys/login/options', { challengeToken: primaryToken }, 'https://other.example.com')).status).toBe(401);
    const noKey = await request('/api/auth/passkeys/login/options', { challengeToken: primaryToken });
    expect((await noKey.json() as { data: { available: boolean } }).data.available).toBe(false);
  });

  it('binds a single-use WebAuthn challenge to the primary login and stored credential', async () => {
    fixture.raw.prepare(`INSERT INTO staff_passkeys(credential_id,staff_id,public_key,counter,transports,device_type,backed_up,created_at)
      VALUES (?,?,?,?,?,?,?,?)`).run('key-1', 'owner', 'AQID', 0, '["internal"]', 'multiDevice', 1, new Date().toISOString());
    const options = await request('/api/auth/passkeys/login/options', { challengeToken: primaryToken });
    expect(options.status, await options.clone().text()).toBe(200);
    const { data } = await options.json() as { data: { available: boolean; challengeToken: string } };
    expect(data.available).toBe(true);
    const wrongCredential = await request('/api/auth/passkeys/login/verify', { loginChallengeToken: primaryToken,
      challengeToken: data.challengeToken, response: { id: 'other-user-key' } });
    expect(wrongCredential.status).toBe(401);
    const replay = await request('/api/auth/passkeys/login/verify', { loginChallengeToken: primaryToken,
      challengeToken: data.challengeToken, response: { id: 'key-1' } });
    expect(replay.status).toBe(401);
    const renewed = await request('/api/auth/passkeys/login/options', { challengeToken: primaryToken });
    const next = await renewed.json() as { data: { challengeToken: string } };
    const verified = await request('/api/auth/passkeys/login/verify', { loginChallengeToken: primaryToken,
      challengeToken: next.data.challengeToken, response: { id: 'key-1' } });
    expect(verified.status, await verified.clone().text()).toBe(200);
    expect(vi.mocked(verifyAuthenticationResponse).mock.calls.at(-1)?.[0]).toMatchObject({
      expectedOrigin: ADMIN, expectedRPID: 'stg-admin.example.com', requireUserVerification: true,
    });
    expect((await request('/api/auth/passkeys/login/options', { challengeToken: primaryToken })).status).toBe(401);
    expect(fixture.raw.prepare('SELECT counter FROM staff_passkeys WHERE credential_id=?').get('key-1')).toEqual({ counter: 1 });
  });
});
