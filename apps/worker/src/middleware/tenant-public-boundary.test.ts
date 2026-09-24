import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { tenantPublicBoundaryMiddleware } from './tenant-public-boundary.js';

function app(status: 'active' | 'suspended' | 'archived' | null) {
  const first = vi.fn().mockResolvedValue(status ? { tenant_status: status } : null);
  const bind = vi.fn().mockReturnValue({ first });
  const prepare = vi.fn().mockReturnValue({ bind });
  const hono = new Hono<Env>();
  hono.use('/api/liff/*', tenantPublicBoundaryMiddleware);
  hono.post('/api/liff/booking/requests', (c) => c.json({ success: true }));
  return { hono, env: { DB: { prepare } as unknown as D1Database } as Env['Bindings'], prepare };
}

describe('LIFF tenant public boundary', () => {
  it.each(['suspended', 'archived'] as const)('%s は書き込み前に503で止める', async (status) => {
    const target = app(status);
    const res = await target.hono.request('/api/liff/booking/requests?liffId=liff-stopped', {
      method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' },
    }, target.env);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      success: false, code: 'TENANT_SUSPENDED', error: '現在ご利用いただけません',
    });
  });

  it('active は従来のLIFF handlerへ通す', async () => {
    const target = app('active');
    expect((await target.hono.request('/api/liff/booking/requests?liffId=liff-active', {
      method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' },
    }, target.env)).status).toBe(200);
  });

  it('JSON bodyの liffId でも書き込み前に停止する', async () => {
    const target = app('archived');
    const res = await target.hono.request('/api/liff/booking/requests', {
      method: 'POST',
      body: JSON.stringify({ liffId: 'liff-archived', value: 'not-written' }),
      headers: { 'Content-Type': 'application/json' },
    }, target.env);
    expect(res.status).toBe(503);
  });

  it('liffIdを使わない経路は個別routeの本人確認へ委ねる', async () => {
    const target = app('suspended');
    expect((await target.hono.request('/api/liff/booking/requests', {
      method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' },
    }, target.env)).status).toBe(200);
    expect(target.prepare).not.toHaveBeenCalled();
  });
});
