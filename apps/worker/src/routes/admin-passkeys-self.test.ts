import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { createStepUpGrant } from '@line-crm/db';
import { authMiddleware, sha256Hex } from '../middleware/auth.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import type { Env } from '../worker-env.js';
import { adminPasskeysSelf } from './admin-passkeys-self.js';
import { verifyRegistrationResponse } from '@simplewebauthn/server';

vi.mock('@simplewebauthn/server', async original => {
  const actual = await original<typeof import('@simplewebauthn/server')>();
  return { ...actual,
    verifyRegistrationResponse: vi.fn(async () => ({ verified: true, registrationInfo: {
      userVerified: true, credential: { id: 'fixture-credential', publicKey: Uint8Array.from([1, 2, 3]), counter: 0, transports: ['internal'] },
      credentialDeviceType: 'multiDevice', credentialBackedUp: true,
    } })),
  };
});

const ADMIN = 'https://stg-admin.example.com';
const API = 'https://stg-api.example.com';
let fixture: SqliteD1;
function app() { const instance = new Hono<Env>(); instance.use('*', authMiddleware); instance.route('/', adminPasskeysSelf); return instance; }
function request(path: string, body: unknown, token?: string, origin = ADMIN, method = 'POST') {
  return app().request(`${API}${path}`, { method, headers: { Origin: origin, 'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer lh_session:${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) },
  { DB: fixture.db, ADMIN_ORIGIN: ADMIN, ADMIN_PUBLIC_URL: ADMIN, WORKER_URL: API,
    TOTP_ENCRYPTION_KEY: 'fixture-master-key-which-is-long-enough', DEPLOY_ENV: 'test' } as Env['Bindings']);
}
beforeEach(async () => {
  fixture = createTestD1();
  fixture.raw.prepare(`INSERT INTO staff_members(id,name,email,role,api_key,is_active,totp_enabled_at,totp_secret_enc)
    VALUES ('owner','Owner','owner@example.com','owner','key',1,?,?)`).run(new Date().toISOString(), 'fixture-secret');
});
afterEach(() => fixture.raw.close());

describe('passkey boundaries', () => {
  it('binds registration to the current session and a one-use step-up grant', async () => {
    const token = 'fixture-session';
    const sessionHash = await sha256Hex(token);
    fixture.raw.prepare('INSERT INTO admin_sessions(token_hash,staff_id,expires_at) VALUES (?,?,?)')
      .run(sessionHash, 'owner', new Date(Date.now() + 3600_000).toISOString());
    fixture.raw.prepare('INSERT INTO platform_settings(key,value) VALUES (?,?)').run(`auth.mfa.session:${sessionHash}`, 'owner');
    const otherHash = await sha256Hex('other-session');
    fixture.raw.prepare('INSERT INTO admin_sessions(token_hash,staff_id,expires_at) VALUES (?,?,?)')
      .run(otherHash, 'owner', new Date(Date.now() + 3600_000).toISOString());
    fixture.raw.prepare('INSERT INTO platform_settings(key,value) VALUES (?,?)').run(`auth.mfa.session:${otherHash}`, 'owner');
    const grant = 'fixture-stepup';
    await createStepUpGrant(fixture.db, { tokenHash: await sha256Hex(grant), staffId: 'owner', purpose: 'auth.passkey.register',
      sessionTokenHash: sessionHash, expiresAt: new Date(Date.now() + 300_000).toISOString() });
    const begin = await request('/api/auth/passkeys/register/options', {}, token);
    expect(begin.status, await begin.clone().text()).toBe(200);
    const { data: registration } = await begin.json() as { data: { challengeToken: string } };
    const wrongSession = await request('/api/auth/passkeys/register/verify', { challengeToken: registration.challengeToken, response: { id: 'fixture-credential' } }, 'other-session');
    expect(wrongSession.status).toBe(401);
    // A different valid session cannot use the challenge; the failed binding consumes it.
    const replayBinding = await request('/api/auth/passkeys/register/verify', { challengeToken: registration.challengeToken, response: { id: 'fixture-credential' } }, token);
    expect(replayBinding.status).toBe(401);
    const renewed = await request('/api/auth/passkeys/register/options', {}, token);
    const { data: next } = await renewed.json() as { data: { challengeToken: string } };
    const finish = await request('/api/auth/passkeys/register/verify', { challengeToken: next.challengeToken, response: { id: 'fixture-credential' } }, token);
    expect(finish.status).toBe(401); // no step-up grant was supplied
    const third = await request('/api/auth/passkeys/register/options', {}, token);
    const { data: valid } = await third.json() as { data: { challengeToken: string } };
    const verified = await app().request(`${API}/api/auth/passkeys/register/verify`, { method: 'POST', headers: { Origin: ADMIN,
      Authorization: `Bearer lh_session:${token}`, 'X-Step-Up-Token': grant, 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeToken: valid.challengeToken, response: { id: 'fixture-credential' } }) },
    { DB: fixture.db, ADMIN_ORIGIN: ADMIN, ADMIN_PUBLIC_URL: ADMIN, WORKER_URL: API,
      TOTP_ENCRYPTION_KEY: 'fixture-master-key-which-is-long-enough', DEPLOY_ENV: 'test' } as Env['Bindings']);
    expect(verified.status, await verified.clone().text()).toBe(200);
    expect(vi.mocked(verifyRegistrationResponse).mock.calls.at(-1)?.[0]).toMatchObject({
      expectedOrigin: ADMIN, expectedRPID: 'stg-admin.example.com', requireUserVerification: true,
    });
    expect(fixture.raw.prepare('SELECT COUNT(*) n FROM staff_passkeys').get()).toEqual({ n: 1 });
  });

  it('lists, deletes and re-registers only the logged-in owner’s passkey', async () => {
    const token = 'fixture-session';
    const sessionHash = await sha256Hex(token);
    fixture.raw.prepare('INSERT INTO admin_sessions(token_hash,staff_id,expires_at) VALUES (?,?,?)')
      .run(sessionHash, 'owner', new Date(Date.now() + 3600_000).toISOString());
    fixture.raw.prepare('INSERT INTO platform_settings(key,value) VALUES (?,?)').run(`auth.mfa.session:${sessionHash}`, 'owner');

    async function grant(purpose: 'auth.passkey.register' | 'auth.passkey.remove') {
      const value = `${purpose}-${crypto.randomUUID()}`;
      await createStepUpGrant(fixture.db, { tokenHash: await sha256Hex(value), staffId: 'owner', purpose,
        sessionTokenHash: sessionHash, expiresAt: new Date(Date.now() + 300_000).toISOString() });
      return value;
    }
    async function register() {
      const begin = await request('/api/auth/passkeys/register/options', {}, token);
      expect(begin.status).toBe(200);
      const { data } = await begin.json() as { data: { challengeToken: string } };
      const result = await app().request(`${API}/api/auth/passkeys/register/verify`, { method: 'POST', headers: {
        Origin: ADMIN, Authorization: `Bearer lh_session:${token}`, 'X-Step-Up-Token': await grant('auth.passkey.register'),
        'Content-Type': 'application/json',
      }, body: JSON.stringify({ challengeToken: data.challengeToken, response: { id: 'fixture-credential' } }) },
      { DB: fixture.db, ADMIN_ORIGIN: ADMIN, ADMIN_PUBLIC_URL: ADMIN, WORKER_URL: API,
        TOTP_ENCRYPTION_KEY: 'fixture-master-key-which-is-long-enough', DEPLOY_ENV: 'test' } as Env['Bindings']);
      expect(result.status, await result.clone().text()).toBe(200);
    }

    await register();
    const listed = await request('/api/auth/passkeys/self', undefined, token, ADMIN, 'GET');
    expect(listed.status).toBe(200);
    expect((await listed.json() as { data: Array<{ id: string }> }).data).toEqual([
      expect.objectContaining({ id: 'fixture-credential' }),
    ]);
    const refused = await request('/api/auth/passkeys/self', { id: 'fixture-credential' }, token, 'https://elsewhere.example.com', 'DELETE');
    expect(refused.status).toBe(403);
    const removed = await app().request(`${API}/api/auth/passkeys/self`, { method: 'DELETE', headers: {
      Origin: ADMIN, Authorization: `Bearer lh_session:${token}`, 'X-Step-Up-Token': await grant('auth.passkey.remove'),
      'Content-Type': 'application/json',
    }, body: JSON.stringify({ id: 'fixture-credential' }) },
    { DB: fixture.db, ADMIN_ORIGIN: ADMIN, ADMIN_PUBLIC_URL: ADMIN, WORKER_URL: API,
      TOTP_ENCRYPTION_KEY: 'fixture-master-key-which-is-long-enough', DEPLOY_ENV: 'test' } as Env['Bindings']);
    expect(removed.status, await removed.clone().text()).toBe(200);
    expect(fixture.raw.prepare('SELECT COUNT(*) n FROM staff_passkeys').get()).toEqual({ n: 0 });
    await register();
    expect(fixture.raw.prepare('SELECT COUNT(*) n FROM staff_passkeys').get()).toEqual({ n: 1 });
  });

});
