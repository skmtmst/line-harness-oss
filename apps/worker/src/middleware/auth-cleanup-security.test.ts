import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../worker-env.js';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { authMiddleware, toAuthenticatedStaff } from './auth.js';
import { parseCookieHeader, readCookie } from './auth-http.js';
import { preAuthSensitiveLimit } from './sensitive-rate-limit.js';

let db: ReturnType<typeof createTestD1>;
beforeEach(() => {
  db = createTestD1();
  db.raw.exec("INSERT INTO staff_members(id,name,role,api_key,view_permission_keys) VALUES ('actor','Fixture','staff','fixture-key','[]')");
});
afterEach(() => db.raw.close());

describe('auth cleanup preserves fail-closed input boundaries', () => {
  it.each(['null', '{}', '42', 'true', '"/friends,/chats"', 'malformed'])('stored view permission %s never grants a route or crashes auth', async raw => {
    db.raw.prepare('UPDATE staff_members SET view_permission_keys=? WHERE id=?').run(raw, 'actor');
    const app = new Hono<Env>();
    let reached = 0;
    app.use('*', authMiddleware);
    app.get('/api/friends', c => { reached++; return c.text('private'); });
    const response = await app.request('/api/friends', { headers: { Authorization: 'Bearer fixture-key' } }, { DB: db.db } as Env['Bindings']);
    expect(response.status).toBe(403);
    expect(reached).toBe(0);
  });

  it('keeps string keys, role and read-only separate when narrowing stored JSON', () => {
    const staff = toAuthenticatedStaff({
      id: 'actor', name: 'Fixture', role: 'admin', access_level: 'read_only',
      permission_keys: '["/friends",null,42]', view_permission_keys: '["/chats",false,{}]',
    });
    expect(staff).toMatchObject({ role: 'admin', readOnly: true, permissionKeys: ['/friends'], viewPermissionKeys: ['/chats'] });
  });

  it('retains the distinct OAuth/signup and session cookie parsing contracts', () => {
    const cookies = 'state=first%3Dvalue; state=second; bad=%';
    expect(readCookie(cookies, 'state')).toBe('first=value');
    expect(readCookie(cookies, 'bad')).toBeNull();
    expect(readCookie(cookies, 'missing')).toBeNull();
    expect(parseCookieHeader(cookies)).toMatchObject({ state: 'second', bad: '%' });
  });

  it.each(['declared', 'streamed'])('rejects an oversized %s login before the login handler', async mode => {
    const app = new Hono<Env>();
    let reached = 0;
    app.use('*', async (c, next) => {
      const denied = await preAuthSensitiveLimit(c);
      if (denied) return denied;
      return next();
    });
    app.post('/api/auth/login', c => { reached++; return c.json({ success: true }); });
    const body = JSON.stringify({ token: 'x'.repeat(16 * 1024) });
    const response = await app.request('/api/auth/login', {
      method: 'POST', body, headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.251',
        ...(mode === 'declared' ? { 'Content-Length': String(new TextEncoder().encode(body).length) } : {}) },
    }, { DB: db.db } as Env['Bindings']);
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: 'auth_body_too_large' });
    expect(reached).toBe(0);
  });
});

it('extracted authentication code retains the existing manual-review gate', async () => {
  const { prohibitedPullRequestChange } = await import('../services/codex-auto-merge.js');
  for (const filename of [
    'apps/worker/src/middleware/auth.ts',
    'apps/worker/src/middleware/auth/credentials/auth.ts',
    'apps/worker/src/middleware/auth/permissions/auth.ts',
    'apps/worker/src/middleware/auth/principal/auth.ts',
  ]) expect(prohibitedPullRequestChange([{ filename }])).toEqual({ reason: 'protected_file', filename });
});

it.each([
  ['GET', '/api/forms/fixture', 200],
  ['PUT', '/api/forms/fixture', 401],
  ['DELETE', '/api/forms/fixture', 401],
  ['POST', '/api/events/liff/bookings/fixture/change', 200],
  ['GET', '/api/events/liff/bookings/fixture/change', 401],
  ['PUT', '/api/events/liff/bookings/fixture/change', 401],
  ['POST', '/api/events/liff/bookings/fixture/change/extra', 401],
  ['GET', '/api/liff/files/fixture/download', 200],
])('public %s %s retains its original administrator boundary (%i)', async (method, path, status) => {
  const app = new Hono<Env>();
  app.use('*', authMiddleware);
  app.all('*', c => c.json({ delegated: true }));
  expect((await app.request(path, { method }, { DB: db.db } as Env['Bindings'])).status).toBe(status);
});
