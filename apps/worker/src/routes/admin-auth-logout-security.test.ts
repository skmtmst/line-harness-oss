import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../worker-env.js';
import { authMiddleware, sha256Hex } from '../middleware/auth.js';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { adminAuth } from './admin-auth.js';

let db: ReturnType<typeof createTestD1>;
const url = 'https://api.example.test/api/auth/logout';
const cookies = 'lh_admin_session=cookie-session; lh_csrf=csrf-fixture';
const headers = { Cookie: cookies, 'x-csrf-token': 'csrf-fixture', Origin: 'https://admin.example.test' };
function request(customHeaders: HeadersInit = headers) {
  const app = new Hono<Env>();
  app.use('*', authMiddleware);
  app.route('/', adminAuth);
  return app.request(url, { method: 'POST', headers: customHeaders }, {
    DB: db.db, ADMIN_ORIGIN: 'https://admin.example.test', API_KEY: 'emergency-fixture',
  } as Env['Bindings']);
}
async function exists(token: string) {
  return db.raw.prepare('SELECT token_hash FROM admin_sessions WHERE token_hash=?').get(await sha256Hex(token));
}
beforeEach(async () => {
  db = createTestD1();
  db.raw.exec("INSERT INTO staff_members(id,name,role,api_key) VALUES ('actor','Fixture','staff','actor-key'),('other','Other fixture','staff','other-key')");
  for (const token of ['cookie-session', 'bearer-session']) {
    db.raw.prepare('INSERT INTO admin_sessions(token_hash,staff_id,expires_at) VALUES (?,?,?)')
      .run(await sha256Hex(token), token === 'cookie-session' ? 'actor' : 'other', new Date(Date.now() + 60_000).toISOString());
  }
});
afterEach(() => db.raw.close());

describe('F07 cookie logout checks before revocation, audit and Set-Cookie', () => {
  it.each<Record<string, string>>([
    { Cookie: cookies, Origin: 'https://attacker.example' },
    { ...headers, 'x-csrf-token': 'wrong' },
    { ...headers, Origin: 'https://attacker.example' },
    { ...headers, Origin: 'null' },
    { ...headers, Origin: '' },
    { Cookie: cookies },
  ])('rejects forged cookie logout %# without side effects', async supplied => {
    const response = await request(supplied);
    expect(response.status).toBe(403);
    expect(await exists('cookie-session')).toBeDefined();
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(db.raw.prepare("SELECT count(*) AS n FROM login_audit WHERE action='logout'").get()).toEqual({ n: 0 });
  });
  it('accepts the configured admin origin and matching double-submit token', async () => {
    const response = await request();
    expect(response.status).toBe(200);
    expect(await exists('cookie-session')).toBeUndefined();
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect((await request()).status).toBe(200);
  });
  it('keeps the existing credentialed browser logout with its trusted Origin and no CSRF header', async () => {
    expect((await request({ Cookie: cookies, Origin: 'https://admin.example.test' })).status).toBe(200);
    expect(await exists('cookie-session')).toBeUndefined();
  });
  it('accepts a same-origin cookie logout', async () => {
    expect((await request({ ...headers, Origin: 'https://api.example.test' })).status).toBe(200);
    expect(await exists('cookie-session')).toBeUndefined();
  });
  it('keeps expired/unknown/no-cookie logout idempotent without a CSRF token', async () => {
    db.raw.prepare('UPDATE admin_sessions SET expires_at=?').run('2000-01-01T00:00:00.000Z');
    for (const Cookie of [cookies, 'lh_admin_session=unknown', '']) {
      expect((await request({ Cookie })).status).toBe(200);
    }
  });
  it('revokes only the selected Bearer session when a different cookie is attached', async () => {
    expect((await request({ Cookie: cookies, Authorization: 'Bearer lh_session:bearer-session' })).status).toBe(200);
    expect(await exists('bearer-session')).toBeUndefined();
    expect(await exists('cookie-session')).toBeDefined();
  });
  it('keeps API-key Bearer logout independent of an incidental cookie', async () => {
    expect((await request({ Cookie: cookies, Authorization: 'Bearer actor-key' })).status).toBe(200);
    expect(await exists('cookie-session')).toBeDefined();
  });
  it('protects the legacy emergency API-key cookie too', async () => {
    expect((await request({ Cookie: 'lh_admin_session=emergency-fixture' })).status).toBe(403);
  });
});
