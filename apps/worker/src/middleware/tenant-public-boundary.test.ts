import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { tenantPublicBoundaryMiddleware } from './tenant-public-boundary.js';
import { createTestD1 } from '../test-utils/d1-sqlite.js';

function app(status: 'active' | 'suspended' | 'archived' | null) {
  const first = vi.fn().mockResolvedValue(status ? { tenant_status: status } : null);
  const bind = vi.fn().mockReturnValue({ first });
  const prepare = vi.fn().mockReturnValue({ bind });
  const hono = new Hono<Env>();
  hono.use('/api/liff/*', tenantPublicBoundaryMiddleware);
  hono.use('/api/events/liff/*', tenantPublicBoundaryMiddleware);
  hono.post('/api/liff/booking/requests', (c) => c.json({ success: true }));
  hono.post('/api/events/liff/bookings/:id/change', (c) => c.json({ success: true }));
  return { hono, env: { DB: { prepare } as unknown as D1Database } as Env['Bindings'], prepare };
}

describe('LIFF tenant public boundary', () => {
  it('S15 an active account query cannot hide the suspended account selected by LIFF', async () => {
    const db = createTestD1({ foreignKeys: false });
    try {
      db.raw.exec(`INSERT INTO tenants(id,name,status) VALUES ('paused','Fixture paused','suspended'),('live','Fixture live','active');
        INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,liff_id,tenant_id)
        VALUES ('a','ca','Fixture A','unused','unused','liff-a','paused'),('b','cb','Fixture B','unused','unused','liff-b','live');`);
      const target = new Hono<Env>(); target.use('/api/liff/*', tenantPublicBoundaryMiddleware);
      const write = vi.fn(); target.post('/api/liff/booking/requests', c => { write(); return c.json({ success: true }); });
      const env = { DB: db.db } as Env['Bindings'];
      expect((await target.request('/api/liff/booking/requests?liffId=liff-a&accountId=b', { method: 'POST' }, env)).status).toBe(403);
      expect((await target.request('/api/liff/booking/requests?liffId=liff-a&accountId=a', { method: 'POST' }, env)).status).toBe(503);
      expect(write).not.toHaveBeenCalled();
      expect((await target.request('/api/liff/booking/requests?liffId=liff-b&accountId=b', { method: 'POST' }, env)).status).toBe(200);
      expect(write).toHaveBeenCalledTimes(1);
    } finally { db.raw.close(); }
  });
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
  it.each(['suspended', 'archived'] as const)('event compatibility URL also rejects a %s tenant before any write', async status => {
    const target = app(status);
    const response = await target.hono.request('/api/events/liff/bookings/fixture/change?liffId=fixture', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    }, target.env);
    expect(response.status).toBe(503);
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
