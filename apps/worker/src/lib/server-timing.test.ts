import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../worker-env.js';
import { timingHandler, timingMiddleware, timingSpan, timingStart } from './server-timing.js';

const env = { ADMIN_ORIGIN: 'https://admin.example' } as Env['Bindings'];
afterEach(() => vi.restoreAllMocks());

function build(handler: (c: import('hono').Context<Env>) => Response | Promise<Response>) {
  const app = new Hono<Env>();
  app.use('*', timingStart());
  app.use('*', timingMiddleware('auth', async (c, next) => {
    if (c.req.header('X-Deny')) return c.json({ ok: false }, 401);
    await next();
  }));
  app.use('*', timingHandler());
  app.get('/api/x', handler);
  app.onError((_error, c) => c.json({ ok: false }, 500));
  return app;
}

describe('Server-Timing', () => {
  it.each([200, 401, 403, 404, 429, 500] as const)('認証の有無にかかわらず%sにも固定名と数値だけを付ける', async status => {
    const res = await build(c => c.json({ ok: true }, status)).request('/api/x', {}, env);
    expect(res.status).toBe(status);
    const header = res.headers.get('Server-Timing')!;
    expect(header).toMatch(/auth;dur=\d+\.\d+/);
    expect(header).toMatch(/handler;dur=\d+\.\d+/);
    expect(header).toMatch(/total;dur=\d+\.\d+/);
    expect(header).toContain('d1_count;desc="0"');
    expect(header).toContain('d1_sql_count;desc="0"');
    expect(header).not.toContain('d1_sql;dur=');
    for (const metric of header.split(', ')) expect(metric).toMatch(/^[a-z1-9_]+;(?:dur=\d+\.\d+|desc="\d+")$/);
  });

  it('早期拒否と例外を本体の時間へ混ぜず、実行した段へ付ける', async () => {
    let now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const app = new Hono<Env>();
    app.use('*', timingStart());
    app.use('*', timingMiddleware('auth', async c => {
      now += 120;
      return c.json({ ok: false }, 401);
    }));
    app.get('/api/x', () => { throw new Error('must not run'); });
    const res = await app.request('/api/x', {}, env);
    expect(res.status).toBe(401);
    expect(res.headers.get('Server-Timing')).toContain('auth;dur=120.00');
    expect(res.headers.get('Server-Timing')).toContain('handler;dur=0.00');
    const error = await build(() => { throw new Error('private detail'); }).request('/api/x', {}, env);
    expect(error.status).toBe(500);
    expect(error.headers.get('Server-Timing')).not.toContain('private detail');
  });

  it('段は下流を除き、session/staffの内訳と応答加工を測る', async () => {
    let now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const app = new Hono<Env>();
    app.use('*', timingStart());
    app.use('*', timingMiddleware('auth', async (c, next) => {
      await timingSpan(c, 'session', async () => {
        now += 10;
        await timingSpan(c, 'staff', async () => { now += 30; });
      });
      await next();
      now += 5;
    }));
    app.use('*', timingHandler());
    app.get('/api/x', c => { now += 80; return c.text('ok'); });
    const response = await app.request('/api/x', {}, env);
    const header = response.headers.get('Server-Timing');
    for (const metric of ['auth;dur=45.00', 'session;dur=40.00', 'staff;dur=30.00', 'handler;dur=80.00', 'total;dur=125.00']) {
      expect(header).toContain(metric);
    }
  });

  it('許可した管理画面のoriginにだけブラウザ計測を公開する', async () => {
    const app = build(c => c.text('ok'));
    for (const origin of ['https://admin.example', 'https://evil.example', 'null']) {
      const response = await app.request('/api/x', { headers: { Origin: origin } }, env);
      expect(response.headers.get('Timing-Allow-Origin')).toBe(origin === 'https://admin.example' ? origin : null);
    }
  });

  it('書換え不可の応答を本文や状態を変えずに包み直す', async () => {
    const res = await build(() => {
      const response = new Response('proxied', { status: 202, headers: { 'X-Upstream': 'kept' } });
      response.headers.set = () => { throw new TypeError('immutable'); };
      return response;
    }).request('/api/x', {}, env);
    expect(res.status).toBe(202);
    expect(await res.text()).toBe('proxied');
    expect(res.headers.get('X-Upstream')).toBe('kept');
    expect(res.headers.get('Server-Timing')).toContain('total;dur=');
  });
});
