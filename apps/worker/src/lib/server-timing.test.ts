import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { timingMark, timingStart } from './server-timing.js';

/*
 * V6R-CX-a: 段ごとの経過時間を Server-Timing で返す。
 * ログイン済みの職員への応答だけに付け、未ログインには付けない。
 */
function build(handler: (c: import('hono').Context<Env>) => Response | Promise<Response>) {
  const app = new Hono<Env>();
  app.use('*', timingStart());
  app.use('*', async (c, next) => {
    // 認証の代わり。ヘッダがあればログイン済みとみなす。
    if (c.req.header('X-Test-Staff')) c.set('staff', { id: 's1', name: 'S', role: 'admin', readOnly: false, tenantId: 't' } as never);
    await next();
  });
  app.use('*', timingMark('auth'));
  app.get('/api/x', handler);
  return app;
}

const env = { ADMIN_ORIGIN: 'https://admin.example' } as never;

describe('Server-Timing（V6R-CX-a）', () => {
  it('ログイン済みの応答に、段・本体・全体の時間を付ける', async () => {
    const res = await build((c) => c.json({ ok: true })).request('http://worker.example/api/x', { headers: { 'X-Test-Staff': '1' } }, env);
    const header = res.headers.get('Server-Timing') ?? '';
    expect(header).toMatch(/auth;dur=\d+/);
    expect(header).toMatch(/handler;dur=\d+/);
    expect(header).toMatch(/total;dur=\d+/);
  });

  it('未ログインの応答には付けない（認証の時間差を見せない）', async () => {
    const res = await build((c) => c.json({ ok: true })).request('http://worker.example/api/x', {}, env);
    expect(res.headers.get('Server-Timing')).toBeNull();
    expect(res.headers.get('Timing-Allow-Origin')).toBeNull();
  });

  it('許可した管理画面の origin にだけ Timing-Allow-Origin を付ける', async () => {
    const app = build((c) => c.json({ ok: true }));
    const allowed = await app.request('http://worker.example/api/x', { headers: { 'X-Test-Staff': '1', Origin: 'https://admin.example' } }, env);
    expect(allowed.headers.get('Timing-Allow-Origin')).toBe('https://admin.example');
    const other = await app.request('http://worker.example/api/x', { headers: { 'X-Test-Staff': '1', Origin: 'https://evil.example' } }, env);
    expect(other.headers.get('Timing-Allow-Origin')).toBeNull();
  });

  it('ヘッダを書き換えられない応答でも、500にせずそのまま返す', async () => {
    let tried = 0;
    const res = await build(() => {
      const response = new Response('proxied', { status: 200 });
      const locked = new Headers();
      locked.append = () => { tried += 1; throw new TypeError('immutable'); };
      locked.set = () => { tried += 1; throw new TypeError('immutable'); };
      Object.defineProperty(response, 'headers', { value: locked });
      return response;
    }).request('http://worker.example/api/x', { headers: { 'X-Test-Staff': '1' } }, env);
    expect(tried).toBeGreaterThan(0);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('proxied');
  });
});
