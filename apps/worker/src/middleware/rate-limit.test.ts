import { describe, expect, test } from 'vitest';
import { Hono } from 'hono';
import { rateLimitMiddleware, authenticatedRateLimitMiddleware } from './rate-limit.js';
import type { Env } from '../worker-env.js';

function app() {
  const a = new Hono<Env>();
  a.use('*', rateLimitMiddleware);
  a.get('/api/protected', (c) => c.json({ success: true }));
  return a;
}

const env = {} as Env['Bindings'];

describe('rate-limit IP ceiling (pre-auth token rotation)', () => {
  test('rotating unvalidated session cookies from one IP cannot bypass the limiter', async () => {
    // A unique IP isolates this test from the module-level store. Each request
    // uses a DIFFERENT bogus cookie, so the per-token bucket never trips — only
    // the per-IP ceiling (3000) should eventually return 429.
    const ip = '203.0.113.77';
    const a = app();
    let saw429 = false;

    for (let i = 0; i < 3001; i++) {
      const res = await a.request('/api/protected', {
        headers: {
          'cf-connecting-ip': ip,
          Cookie: `lh_admin_session=bogus-${i}`,
        },
      }, env);
      if (res.status === 429) {
        saw429 = true;
        break;
      }
    }

    expect(saw429).toBe(true);
  });

  test('a single legitimate token keeps its full allowance from one IP', async () => {
    const ip = '198.51.100.42';
    const a = app();
    // Well under both AUTHENTICATED_MAX and the IP ceiling.
    for (let i = 0; i < 50; i++) {
      const res = await a.request('/api/protected', {
        headers: { 'cf-connecting-ip': ip, Cookie: 'lh_admin_session=stable-token' },
      }, env);
      expect(res.status).toBe(200);
    }
  });
});

test('SEC-03 forged Bearer sharing a prefix cannot consume another IP bucket',async()=>{
 const a=app();for(let i=0;i<1000;i++)await a.request('/api/protected',{headers:{'cf-connecting-ip':'192.0.2.200',Authorization:'Bearer shared-prefix-16-attacker'}},env);
 expect((await a.request('/api/protected',{headers:{'cf-connecting-ip':'192.0.2.201',Authorization:'Bearer shared-prefix-16-victim'}},env)).status).toBe(200);
});
test('unverified credential cannot mint a new IP allowance',async()=>{
 const a=app();for(let i=0;i<3000;i++)await a.request('/api/protected',{headers:{'cf-connecting-ip':'192.0.2.202'}},env);
 expect((await a.request('/api/protected',{headers:{'cf-connecting-ip':'192.0.2.202',Authorization:'Bearer rotated-bogus'}},env)).status).toBe(429);
});

test('shared NAT retains independent verified staff allowances',async()=>{
 const a=new Hono<Env>();a.use('*',rateLimitMiddleware);a.use('*',async(c,next)=>{c.set('staff',{id:c.req.header('x-test-staff')!,name:'Test',role:'admin',readOnly:false,tenantId:'tenant'});await next()});a.use('*',authenticatedRateLimitMiddleware);a.get('/api/protected',c=>c.json({success:true}));
 for(const [id,n] of [['a',600],['b',1000]] as const)for(let i=0;i<n;i++)expect((await a.request('/api/protected',{headers:{'cf-connecting-ip':'192.0.2.203','x-test-staff':id}},env)).status).toBe(200);
 expect((await a.request('/api/protected',{headers:{'cf-connecting-ip':'192.0.2.203','x-test-staff':'b'}},env)).status).toBe(429);
});

test('本人用ファイルとLIFF入口はID・未検証Bearerを変えても100回のIP枠を共有する', async () => {
  const a = new Hono<Env>();
  a.use('*', rateLimitMiddleware);
  a.get('*', c => c.text('fixture'));
  const paths = ['/liff/files/', '/liff/statements/', '/api/liff/files/'];
  for (let i = 0; i < 100; i++) {
    expect((await a.request(`${paths[i % 3]}${i}/download`, { headers: {
      'cf-connecting-ip': '192.0.2.220', Authorization: `Bearer unverified-${i}`,
    } }, env)).status).toBe(200);
  }
  const blocked = await a.request('/api/liff/files/next/download', { headers: { 'cf-connecting-ip': '192.0.2.220' } }, env);
  expect(blocked.status).toBe(429); expect(blocked.headers.get('retry-after')).toBeTruthy();
});
