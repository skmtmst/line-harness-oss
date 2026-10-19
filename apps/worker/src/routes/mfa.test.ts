import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../worker-env.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { authMiddleware, sha256Hex } from '../middleware/auth.js';
import { adminAuth } from './admin-auth.js';
import { authEmail } from './auth-email.js';
import { hashPassword } from '../services/password-hash.js';
import { encryptTotpSecret, decryptTotpEnrollment, totpAtStep } from '../lib/totp.js';
import { staff } from './staff.js';
import { createStepUpGrant } from '@line-crm/db';
import { mfaPolicyKey } from '../services/login-mfa.js';

// Keep real token/config validation; simulate only Cloudflare's network response.
vi.mock('../services/turnstile.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/turnstile.js')>();
  const verify: typeof actual.verifyTurnstile = (environment, token, ip) => actual.verifyTurnstile(environment, token, ip, async (url, init) => {
    const sent = new URLSearchParams(String(init?.body ?? ''));
    return Response.json({ success: String(url) === 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
      && init?.method === 'POST' && sent.get('secret') === 'fixture-turnstile-secret' && sent.get('response') === 'fixture-login-robot' });
  });
  return { ...actual, verifyTurnstile: verify };
});

const key = 'test-encryption-key-at-least-thirty-two-characters';
const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
let db: SqliteD1;
type MfaJson = { data: { challengeToken: string; provisioningUri: string; recoveryCodes: string[]; twoFactor: boolean; twoFactorSetup: boolean; token: string } };
async function json(response: Response): Promise<MfaJson> { return response.json() as Promise<MfaJson>; }
function app() {
  const a = new Hono<Env>(); a.use('*', authMiddleware); a.route('/', adminAuth); a.route('/', authEmail); a.route('/', staff);
  a.get('/api/friends', c => c.json({ success: true })); return a;
}
function request(path: string, body?: unknown, token?: string, method = body ? 'POST' : 'GET', overrides = {}) {
  return app().request(`https://api.example.com${path}`, { method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer lh_session:${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }, { DB: db.db, TURNSTILE_SECRET_KEY: 'fixture-turnstile-secret', TOTP_ENCRYPTION_KEY: key, ADMIN_ORIGIN: 'https://admin.example.com', ADMIN_PUBLIC_URL: 'https://admin.example.com', ...overrides } as Env['Bindings']);
}
async function seed(id = 'owner', role = 'owner', tenantId: string | null = null) {
  db.raw.prepare('INSERT INTO staff_members(id,name,email,role,api_key,is_active,password_hash,tenant_id) VALUES (?,?,?,?,?,1,?,?)')
    .run(id, 'Fixture', `${id}@example.com`, role, `fixture-key-${id}`, await hashPassword('Fixture-pass123'), tenantId);
}
function off(tenantId?: string) { db.raw.prepare('INSERT OR REPLACE INTO platform_settings(key,value) VALUES (?,?)').run(mfaPolicyKey(tenantId), 'false'); }
async function login(id = 'owner') {
  return request('/api/auth/password/login', { email: `${id}@example.com`, password: 'Fixture-pass123', turnstileToken: 'fixture-login-robot' });
}
async function session(id = 'owner') {
  const token = `session-fixture-${id}`;
  db.raw.prepare('INSERT INTO admin_sessions(token_hash,staff_id,expires_at) VALUES (?,?,?)').run(await sha256Hex(token), id, new Date(Date.now() + 3600000).toISOString());
  db.raw.prepare('INSERT INTO platform_settings(key,value) VALUES (?,?)').run(`auth.mfa.session:${await sha256Hex(token)}`, id);
  return token;
}
async function enroll() {
  const primary = await login(); const { data } = await json(primary);
  const setup = await request('/api/auth/two-factor/setup', { challengeToken: data.challengeToken });
  const setupData = (await json(setup)).data;
  const enrolledSecret = new URL(setupData.provisioningUri).searchParams.get('secret')!;
  const confirm = await request('/api/auth/two-factor/setup/confirm', { challengeToken: data.challengeToken, code: await totpAtStep(enrolledSecret, Math.floor(Date.now() / 30000)) });
  expect(confirm.status).toBe(200); return (await json(confirm)).data.recoveryCodes as string[];
}
beforeEach(() => { db = createTestD1(); }); afterEach(() => db.raw.close());

describe('MFA policy and recovery', () => {
  it.each(['owner', 'admin', 'staff'])('default-On with %s issues only a challenge and no usable session', async role => {
    await seed('owner', role); const primary = await login();
    expect((await json(primary)).data.twoFactorSetup).toBe(true);
    expect(primary.headers.get('set-cookie')).toBeNull();
    expect(db.raw.prepare('SELECT COUNT(*) n FROM admin_sessions').get()).toEqual({ n: 0 });
    expect((await request('/api/friends', undefined, 'not-a-session')).status).toBe(401);
  });
  it('Off permits unenrolled login while an enrolled person still gets a challenge', async () => {
    await seed(); off(); const normal = await login();
    expect((await json(normal)).data.twoFactor).toBe(false);
    expect(normal.headers.get('set-cookie')).toContain('lh_admin_session');
    db.raw.prepare('UPDATE staff_members SET totp_secret_enc=?,totp_enabled_at=? WHERE id=?').run(await encryptTotpSecret(secret, key), new Date().toISOString(), 'owner');
    const enrolled = await login(); expect((await json(enrolled)).data.twoFactor).toBe(true);
    expect(enrolled.headers.get('set-cookie')).toBeNull();
  });
  it('first enrollment issues recovery codes only once; a recovery code has one concurrent winner', async () => {
    await seed(); const codes = await enroll(); expect(codes).toHaveLength(8);
    const row = db.raw.prepare('SELECT totp_secret_enc FROM staff_members WHERE id=?').get('owner') as { totp_secret_enc: string };
    const stored = await decryptTotpEnrollment(row.totp_secret_enc, key);
    expect(stored.recoveryHashes).toHaveLength(8); expect(stored.recoveryHashes).not.toContain(codes[0]);
    const { data } = await json(await login());
    const attempts = await Promise.all([0, 1].map(() => request('/api/auth/two-factor/verify', { challengeToken: data.challengeToken, code: codes[0] })));
    expect(attempts.filter(r => r.status === 200)).toHaveLength(1);
    const next = (await json(await login())).data;
    expect((await request('/api/auth/two-factor/verify', { challengeToken: next.challengeToken, code: codes[0] })).status).toBe(400);
    expect(db.raw.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='auth.mfa.recovery' AND result='success'").get()).toEqual({ n: 1 });
  });
  it('TOTP step cannot be replayed even in a fresh challenge', async () => {
    await seed(); await enroll();
    const row = db.raw.prepare('SELECT totp_secret_enc,totp_last_used_step FROM staff_members WHERE id=?').get('owner') as { totp_secret_enc: string; totp_last_used_step: number };
    const enrolled = await decryptTotpEnrollment(row.totp_secret_enc, key);
    const { data } = await json(await login());
    const replay = await request('/api/auth/two-factor/verify', { challengeToken: data.challengeToken, code: await totpAtStep(enrolled.secret, row.totp_last_used_step) });
    expect(replay.status).toBe(400);
  });
  it('failure limit persists across fresh challenges and different primary logins', async () => {
    await seed(); db.raw.prepare('UPDATE staff_members SET totp_secret_enc=?,totp_enabled_at=? WHERE id=?').run(await encryptTotpSecret(secret, key), new Date().toISOString(), 'owner');
    for (let i = 0; i < 5; i++) {
      const { data } = await json(await login());
      expect((await request('/api/auth/two-factor/verify', { challengeToken: data.challengeToken, code: 'bad' })).status).toBe(400);
    }
    const { data } = await json(await login());
    expect((await request('/api/auth/two-factor/verify', { challengeToken: data.challengeToken, code: await totpAtStep(secret, Math.floor(Date.now() / 30000)) })).status).toBe(429);
    expect(db.raw.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='auth.mfa.verify' AND result='failed'").get()).toEqual({ n: 5 });
  });
  it.each(['admin', 'staff'])('%s cannot change the policy', async role => {
    await seed('other', role); off(); const token = await session('other');
    expect((await request('/api/auth/two-factor/policy', { required: true }, token, 'PUT')).status).toBe(403);
    expect(db.raw.prepare('SELECT value FROM platform_settings WHERE key=?').get(mfaPolicyKey())).toEqual({ value: 'false' });
  });
  it('an owner limited to stores cannot weaken the organization policy', async () => {
    await seed(); off(); db.raw.prepare("UPDATE staff_members SET account_scope='accounts' WHERE id='owner'").run();
    const token = await session();
    expect((await request('/api/auth/two-factor/policy', { required: false }, token, 'PUT')).status).toBe(403);
    expect((await json(await request('/api/auth/two-factor/policy', undefined, token))).data).toMatchObject({ canEdit: false });
  });
  it('registered platform operators can change their organization policy', async () => {
    await seed('operator', 'staff'); off();
    db.raw.prepare("INSERT INTO platform_admins(staff_id,is_active,activation_state) VALUES ('operator',1,'active')").run();
    const token = await session('operator');
    expect((await request('/api/auth/two-factor/policy', { required: true }, token, 'PUT')).status).toBe(200);
  });
  it('owner authority is checked atomically even if revoked just before saving', async () => {
    await seed(); off(); const token = await session();
    const batch = db.db.batch.bind(db.db);
    vi.spyOn(db.db, 'batch').mockImplementationOnce(async statements => {
      db.raw.prepare("UPDATE staff_members SET role='admin' WHERE id='owner'").run();
      return batch(statements);
    });
    expect((await request('/api/auth/two-factor/policy', { required: true }, token, 'PUT')).status).toBe(409);
    expect(db.raw.prepare('SELECT value FROM platform_settings WHERE key=?').get(mfaPolicyKey())).toEqual({ value: 'false' });
    expect(db.raw.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='auth.mfa.policy' AND result='success'").get()).toEqual({ n: 0 });
  });
  it('owner needs a fresh password confirmation to turn Off; grant is single-use; changes are audited', async () => {
    await seed(); off(); const token = await session();
    expect((await request('/api/auth/two-factor/policy', { required: false }, token, 'PUT')).status).toBe(401);
    const confirmed = await request('/api/auth/step-up', { purpose: 'auth.mfa.policy', password: 'Fixture-pass123' }, token);
    expect(confirmed.status).toBe(201); const grant = (await json(confirmed)).data.token;
    const put = () => app().request('https://api.example.com/api/auth/two-factor/policy', { method: 'PUT', headers: {
      Authorization: `Bearer lh_session:${token}`, 'Content-Type': 'application/json', 'X-Step-Up-Token': grant,
    }, body: JSON.stringify({ required: false }) }, { DB: db.db, TOTP_ENCRYPTION_KEY: key, ADMIN_ORIGIN: 'https://admin.example.com' } as Env['Bindings']);
    expect((await put()).status).toBe(200); expect((await put()).status).toBe(401);
    expect(db.raw.prepare("SELECT after_json FROM audit_events WHERE action='auth.mfa.policy' AND result='success'").get()).toEqual({ after_json: '{"required":false}' });
  });
  it('turning On revokes existing organization sessions and leaves other organizations alone', async () => {
    await seed(); off(); const token = await session();
    db.raw.prepare('INSERT INTO tenants(id,name) VALUES (?,?)').run('other-tenant', 'Fixture tenant');
    await seed('other', 'owner', 'other-tenant'); await session('other');
    expect((await request('/api/auth/two-factor/policy', { required: true }, token, 'PUT')).status).toBe(200);
    expect(db.raw.prepare('SELECT staff_id FROM admin_sessions').all()).toEqual([{ staff_id: 'other' }]);
  });
  it('On blocks direct staff and emergency keys; the key login can only issue a challenge', async () => {
    await seed();
    const raw = (token: string, path = '/api/friends') => app().request(`https://api.example.com${path}`, { headers: { Authorization: `Bearer ${token}` } }, { DB: db.db, API_KEY: 'emergency-fixture', TOTP_ENCRYPTION_KEY: key } as Env['Bindings']);
    expect((await raw('fixture-key-owner')).status).toBe(401);
    expect((await raw('emergency-fixture')).status).toBe(401);
    const challenge = await request('/api/auth/login', { apiKey: 'fixture-key-owner' });
    expect(challenge.status).toBe(200); expect(challenge.headers.get('set-cookie')).toBeNull();
    expect((await json(challenge)).data.twoFactorSetup).toBe(true);
  });
  it('default-On rejects sessions minted before MFA was restored, including enrolled people', async () => {
    await seed(); const token = await session();
    db.raw.prepare('DELETE FROM platform_settings WHERE key LIKE ?').run('auth.mfa.session:%');
    expect((await request('/api/friends', undefined, token)).status).toBe(401);
    db.raw.prepare('UPDATE staff_members SET totp_secret_enc=?,totp_enabled_at=? WHERE id=?').run(await encryptTotpSecret(secret, key), new Date().toISOString(), 'owner');
    const enrolledToken = await session();
    db.raw.prepare('DELETE FROM platform_settings WHERE key LIKE ?').run('auth.mfa.session:%');
    expect((await request('/api/friends', undefined, enrolledToken)).status).toBe(401);
  });
  it('cannot enable MFA until enrollment is ready; retains Off and the current session', async () => {
    await seed(); off(); const token = await session();
    expect((await request('/api/auth/two-factor/policy', { required: true }, token, 'PUT', { TOTP_ENCRYPTION_KEY: undefined })).status).toBe(400);
    expect(db.raw.prepare('SELECT value FROM platform_settings WHERE key=?').get(mfaPolicyKey())).toEqual({ value: 'false' });
    expect(db.raw.prepare('SELECT COUNT(*) n FROM admin_sessions').get()).toEqual({ n: 1 });
  });
  it.each([undefined, 'short', ' '.repeat(32)])('missing or short key %s permits an unenrolled primary login and usable session', async missing => {
    await seed(); const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const overrides = { TOTP_ENCRYPTION_KEY: missing };
    const res = await request('/api/auth/password/login', { email: 'owner@example.com', password: 'Fixture-pass123', turnstileToken: 'fixture-login-robot' }, undefined, 'POST', overrides);
    expect(res.status).toBe(200); expect((await json(res)).data.twoFactorSetup).toBeUndefined();
    expect(db.raw.prepare('SELECT COUNT(*) n FROM admin_sessions').get()).toEqual({ n: 1 });
    const token = await session();
    expect((await request('/api/friends', undefined, token, 'GET', overrides)).status).toBe(200);
    expect((await json(await request('/api/auth/two-factor/policy', undefined, token, 'GET', overrides))).data).toMatchObject({ required: false, configured: false, notice: '二段階認証の鍵が未設定のため、必須にできません' });
    expect((await request('/api/auth/two-factor/policy', { required: true }, token, 'PUT', overrides)).status).toBe(400);
    expect(log.mock.calls.map(([raw]) => JSON.parse(String(raw)))).toContainEqual({ code: 'mfa_key_unavailable', timestamp: expect.any(String), level: 'warn', requestId: null, invocationId: null, source: 'background' }); log.mockRestore();
  });
  it('a missing key does not bypass an existing personal enrollment', async () => {
    await seed(); await enroll();
    const res = await request('/api/auth/password/login', { email: 'owner@example.com', password: 'Fixture-pass123', turnstileToken: 'fixture-login-robot' }, undefined, 'POST', { TOTP_ENCRYPTION_KEY: undefined });
    expect(res.status).toBe(500); expect(res.headers.get('set-cookie')).toBeNull();
  });
  it('regeneration needs a one-use self confirmation, invalidates all old codes and returns only counts afterwards', async () => {
    await seed(); const old = await enroll(); expect(old.every(code => /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code))).toBe(true);
    const token = await session();
    expect((await request('/api/auth/two-factor/recovery', {}, token)).status).toBe(401);
    const grant = 'fixture-recovery-grant';
    await createStepUpGrant(db.db, { tokenHash: await sha256Hex(grant), staffId: 'owner', purpose: 'auth.mfa.recovery', expiresAt: new Date(Date.now()+60000).toISOString(), sessionTokenHash: await sha256Hex(token) });
    const regenerate = () => app().request('https://api.example.com/api/auth/two-factor/recovery', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer lh_session:${token}`, 'X-Step-Up-Token': grant }, body: '{}' }, { DB: db.db, TOTP_ENCRYPTION_KEY: key } as Env['Bindings']);
    const refreshed = await regenerate(); expect(refreshed.status).toBe(200); expect(refreshed.headers.get('cache-control')).toBe('private, no-store');
    const codes = (await json(refreshed)).data.recoveryCodes; expect(codes).toHaveLength(8);
    expect((await regenerate()).status).toBe(401);
    const self = await request('/api/auth/two-factor/self', undefined, token); expect((await json(self)).data).toMatchObject({ remaining: 8, total: 8 });
    const start = (await json(await login())).data;
    expect((await request('/api/auth/two-factor/verify', { challengeToken: start.challengeToken, code: old[0] })).status).toBe(400);
    for (const code of codes.slice(0, 6)) {
      const start = (await json(await login())).data;
      const res = await request('/api/auth/two-factor/verify', { challengeToken: start.challengeToken, code }); expect(res.status).toBe(200);
    }
    expect((await json(await request('/api/auth/session', undefined, token))).data).toMatchObject({ recoveryCodesRemaining: 2 });
    expect(db.raw.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='auth.mfa.recovery.regenerate'").get()).toEqual({ n: 1 });
  });
});

 it('re-enrollment preserves the working app until a confirmed replacement, requires self confirmation and revokes sessions after replacing', async () => {
    await seed(); await enroll(); const token = await session();
    const previous = db.raw.prepare("SELECT totp_secret_enc FROM staff_members WHERE id='owner'").get() as { totp_secret_enc: string };
    expect((await request('/api/staff/owner/two-factor/setup', {}, token)).status).toBe(428);
    const grant = 'fixture-reenroll-grant';
    await createStepUpGrant(db.db, { tokenHash: await sha256Hex(grant), staffId: 'owner', purpose: 'auth.mfa.reenroll', expiresAt: new Date(Date.now()+60000).toISOString(), sessionTokenHash: await sha256Hex(token) });
    const start = await app().request('https://api.example.com/api/staff/owner/two-factor/setup', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer lh_session:${token}`, 'X-Step-Up-Token': grant }, body: '{}' }, { DB: db.db, TOTP_ENCRYPTION_KEY: key } as Env['Bindings']);
    expect(start.status).toBe(200);
    expect(db.raw.prepare("SELECT totp_secret_enc FROM staff_members WHERE id='owner'").get()).toEqual(previous);
    const replacement = new URL((await json(start)).data.provisioningUri).searchParams.get('secret')!;
    const confirmed = await request('/api/staff/owner/two-factor/confirm', { code: await totpAtStep(replacement, Math.floor(Date.now()/30000)) }, token);
    expect(confirmed.status).toBe(200); expect((await json(confirmed)).data.recoveryCodes).toHaveLength(8);
    expect(db.raw.prepare('SELECT COUNT(*) n FROM admin_sessions').get()).toEqual({ n: 0 });
    expect((await decryptTotpEnrollment((db.raw.prepare("SELECT totp_secret_enc FROM staff_members WHERE id='owner'").get() as { totp_secret_enc: string }).totp_secret_enc, key)).secret).toBe(replacement);
  });

it('staff can inspect and regenerate only their own codes without an organization-management permission', async () => {
  await seed('owner', 'staff'); const codes = await enroll(); const token = await session();
  expect((await json(await request('/api/auth/two-factor/self?staffId=other', undefined, token))).data).toMatchObject({ staffId: 'owner', remaining: 8 });
  expect((await request('/api/auth/two-factor/recovery', { staffId: 'other' }, token)).status).toBe(401);
  const grant = 'fixture-staff-grant';
  await createStepUpGrant(db.db, { tokenHash: await sha256Hex(grant), staffId: 'owner', purpose: 'auth.mfa.recovery', expiresAt: new Date(Date.now()+60000).toISOString(), sessionTokenHash: await sha256Hex(token) });
  const res = await app().request('https://api.example.com/api/auth/two-factor/recovery', { method: 'POST', headers: { Authorization: `Bearer lh_session:${token}`, 'Content-Type': 'application/json', 'X-Step-Up-Token': grant }, body: JSON.stringify({ staffId: 'other' }) }, { DB: db.db, TOTP_ENCRYPTION_KEY: key } as Env['Bindings']);
  expect(res.status).toBe(200); expect((await json(res)).data.recoveryCodes).toHaveLength(8);
  expect(codes).toHaveLength(8);
});

it.each(['expired', 'different-session'])('re-enrollment %s proof leaves the old app and recovery codes intact', async scenario => {
  await seed(); await enroll(); const token = await session();
  const old = db.raw.prepare("SELECT totp_secret_enc FROM staff_members WHERE id='owner'").get() as { totp_secret_enc: string };
  const grant = `reenroll-${scenario}`;
  await createStepUpGrant(db.db, { tokenHash: await sha256Hex(grant), staffId: 'owner', purpose: 'auth.mfa.reenroll', expiresAt: new Date(Date.now()+60000).toISOString(), sessionTokenHash: await sha256Hex(token) });
  const started = await app().request('https://api.example.com/api/staff/owner/two-factor/setup', { method: 'POST', headers: { Authorization: `Bearer lh_session:${token}`, 'Content-Type': 'application/json', 'X-Step-Up-Token': grant }, body: '{}' }, { DB: db.db, TOTP_ENCRYPTION_KEY: key } as Env['Bindings']);
  expect(started.status).toBe(200);
  const nextSecret = new URL((await json(started)).data.provisioningUri).searchParams.get('secret')!;
  let currentToken = token;
  if (scenario === 'expired') {
    const row = db.raw.prepare("SELECT value FROM platform_settings WHERE key='auth.mfa.reenroll:owner'").get() as { value: string };
    const proof = JSON.parse(row.value); proof.expiresAt = '2000-01-01T00:00:00Z';
    db.raw.prepare("UPDATE platform_settings SET value=? WHERE key='auth.mfa.reenroll:owner'").run(JSON.stringify(proof));
  } else {
    currentToken = 'fixture-second-session';
    const hash = await sha256Hex(currentToken);
    db.raw.prepare('INSERT INTO admin_sessions(token_hash,staff_id,expires_at) VALUES (?,?,?)').run(hash,'owner',new Date(Date.now()+60000).toISOString());
    db.raw.prepare('INSERT INTO platform_settings(key,value) VALUES (?,?)').run(`auth.mfa.session:${hash}`,'owner');
  }
  const denied = await request('/api/staff/owner/two-factor/confirm', { code: await totpAtStep(nextSecret, Math.floor(Date.now()/30000)) }, currentToken);
  expect(denied.status).toBe(401);
  expect(db.raw.prepare("SELECT totp_secret_enc FROM staff_members WHERE id='owner'").get()).toEqual(old);
  expect(db.raw.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='auth.mfa.reenroll'").get()).toEqual({ n: 0 });
});
