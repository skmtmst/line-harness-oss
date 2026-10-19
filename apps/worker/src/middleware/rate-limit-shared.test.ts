import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../worker-env.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { rateLimitMiddleware, authenticatedRateLimitMiddleware } from './rate-limit.js';
import { pruneSensitiveRateLimits } from './sensitive-rate-limit.js';

describe('S13 shared sensitive request budgets', () => {
  let fixture: SqliteD1;
  beforeEach(() => { fixture = createTestD1(); });
  afterEach(() => fixture.raw.close());
  function app(staff = false) {
    const instance = new Hono<Env>();
    instance.use('*', rateLimitMiddleware);
    if (staff) instance.use('*', async (c, next) => {
      c.set('staff', { id: 'synthetic-staff', role: 'admin', name: 'Synthetic', readOnly: false, tenantId: 'synthetic-tenant' });
      await next();
    });
    instance.use('*', authenticatedRateLimitMiddleware);
    instance.all('*', c => c.json({ success: true }));
    return instance;
  }
  function request(instance: Hono<Env>, path: string, ip = '192.0.2.11', body?: unknown) {
    return instance.request(path, { method: body ? 'POST' : 'GET', headers: {
      'cf-connecting-ip': ip, ...(body ? { 'content-type': 'application/json' } : {}),
    }, ...(body ? { body: JSON.stringify(body) } : {}) }, { DB: fixture.db } as Env['Bindings']);
  }
  it('shares the login IP allowance between fresh app instances', async () => {
    for (let n = 0; n < 30; n++) expect((await request(app(), '/api/auth/login', '192.0.2.21', { apiKey: `synthetic-${n}` })).status).toBe(200);
    const denied = await request(app(), '/api/auth/login', '192.0.2.21', { apiKey: 'synthetic-new' });
    expect(denied.status).toBe(429); expect(Number(denied.headers.get('Retry-After'))).toBeGreaterThan(0);
  });
  it('cannot evade the email login budget by rotating IPs or email casing', async () => {
    for (let n = 0; n < 10; n++) expect((await request(app(), '/api/auth/password/login', `192.0.2.${30+n}`, { email: 'Synthetic@invalid.test', password: 'synthetic' })).status).toBe(200);
    expect((await request(app(), '/api/auth/password/login', '192.0.2.50', { email: ' synthetic@invalid.test ', password: 'synthetic' })).status).toBe(429);
  });
  it.each(['/api/auth/two-factor/verify', '/api/auth/two-factor/setup/confirm'])('shares MFA and recovery request attempts for %s', async path => {
    for (let n=0;n<30;n++) expect((await request(app(), path, '192.0.2.61', { challengeToken: `synthetic-${n}`, recoveryCode: 'synthetic' })).status).toBe(200);
    expect((await request(app(), path, '192.0.2.61', { challengeToken: 'synthetic-next' })).status).toBe(429);
  });
  it.each(['/api/friends/export', '/api/images'])('shares the verified principal budget for %s across IPs', async path => {
    for (let n=0;n<30;n++) expect((await request(app(true), path, `198.51.100.${n+1}`, path.endsWith('images') ? { data: 'synthetic' } : undefined)).status).toBe(200);
    expect((await request(app(true), path, '198.51.100.99', path.endsWith('images') ? { data: 'synthetic' } : undefined)).status).toBe(429);
  });
  it('fails closed if the shared counter cannot be updated', async () => {
    const instance=app();
    const res=await instance.request('/api/auth/login', { method:'POST', headers: { 'content-type':'application/json', 'cf-connecting-ip':'192.0.2.90' }, body:'{}' }, {
      DB:{ prepare:()=>{ throw new Error('synthetic database failure'); } },
    } as unknown as Env['Bindings']);
    expect(res.status).toBe(503);
  });
  it('atomically reserves password reset requests during concurrent attempts', async () => {
    const responses = await Promise.all(Array.from({ length: 12 }, (_, n) => request(app(), '/api/auth/password/forgot', `203.0.113.${n+1}`, { email:'synthetic-reset@invalid.test' })));
    expect(responses.filter(res => res.status === 200)).toHaveLength(3);
    expect(responses.filter(res => res.status === 429)).toHaveLength(9);
    const keys=fixture.raw.prepare("SELECT key FROM auth_throttles WHERE key LIKE 'sensitive:%'").all() as {key:string}[];
    expect(keys.every(({key})=>!key.includes('@')&&!key.includes('203.0.113.'))).toBe(true);
  });
  it('does not trust a client-supplied forwarding header to create fresh budgets', async () => {
    const instance=app();
    for(let n=0;n<31;n++) {
      const res=await instance.request('/api/auth/login',{method:'POST',headers:{'content-type':'application/json','x-forwarded-for':`203.0.113.${n+1}`},body:'{}'},{DB:fixture.db} as Env['Bindings']);
      expect(res.status).toBe(n<30?200:429);
    }
  });
  it('cleans only expired security counters and preserves live budgets and other authentication state', async () => {
    for(const [key,at] of [['sensitive:expired','2026-10-10T09:00:00'],['sensitive:active','2026-10-13T09:00:00'],['signup:other','2026-10-01T09:00:00']])
      fixture.raw.prepare('INSERT INTO auth_throttles(key,count,window_start,updated_at) VALUES (?,1,?,?)').run(key,at,at);
    await pruneSensitiveRateLimits(fixture.db,new Date('2026-10-13T00:00:00Z'));
    expect(fixture.raw.prepare('SELECT key FROM auth_throttles ORDER BY key').all()).toEqual([{key:'sensitive:active'},{key:'signup:other'}]);
  });
});
