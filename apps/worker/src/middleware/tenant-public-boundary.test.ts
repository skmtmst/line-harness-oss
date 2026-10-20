import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../worker-env.js';
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

describe('F03 public selector input is bounded before parsing or tenant lookup', () => {
  it.each(['absent', 'false-small', 'declared'] as const)('rejects a %s Content-Length overflow before D1 or the handler', async mode => {
    const target = app('active');
    const body = JSON.stringify({ liffId: 'fixture', pad: 'x'.repeat(1024 * 1024) });
    const response = await target.hono.request('/api/liff/booking/requests', {
      method: 'POST', body, headers: { 'Content-Type': 'application/json',
        ...(mode === 'absent' ? {} : { 'Content-Length': mode === 'false-small' ? '2' : String(body.length) }) },
    }, target.env);
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: 'liff_body_too_large' });
    expect(target.prepare).not.toHaveBeenCalled();
  });
  it('does not let query selectors bypass the JSON byte budget', async () => {
    const target = app('active');
    const response = await target.hono.request('/api/liff/booking/requests?liffId=fixture', {
      method: 'POST', body: JSON.stringify({ pad: 'x'.repeat(1024 * 1024) }), headers: { 'Content-Type': 'application/json' },
    }, target.env);
    expect(response.status).toBe(413);
    expect(target.prepare).not.toHaveBeenCalled();
  });
  it('cancels an oversized unknown-length stream without reading its tail', async () => {
    const target = app('active');
    let reads = 0;
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { reads++; controller.enqueue(new Uint8Array(600_000)); }, cancel,
    }, { highWaterMark: 0 });
    const request = new Request('https://fixture.test/api/liff/booking/requests', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body, duplex: 'half',
    } as RequestInit);
    expect((await target.hono.fetch(request, target.env)).status).toBe(413);
    expect(reads).toBe(2);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(target.prepare).not.toHaveBeenCalled();
  });
  it('preserves bytes and route-level JSON validation after selecting a tenant', async () => {
    const target = app('active');
    const { inputJsonBoundary, validatedInputBody } = await import('../lib/input-errors.js');
    target.hono.post('/api/liff/test-body', inputJsonBoundary(), async c => c.json({
      body: await c.req.json(), validated: validatedInputBody(c), raw: await c.req.text(),
    }));
    const raw = '{ "liffId": "fixture", "label": "通常の入力" }';
    const response = await target.hono.request('/api/liff/test-body', {
      method: 'POST', body: raw, headers: { 'Content-Type': 'application/json' },
    }, target.env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ body: JSON.parse(raw), validated: JSON.parse(raw), raw });
    for (const path of ['/api/liff/test-body', '/api/liff/test-body?liffId=fixture']) {
      for (const body of ['', '{broken']) {
        const malformed = await target.hono.request(path, {
          method: 'POST', body, headers: { 'Content-Type': 'application/json' },
        }, target.env);
        expect(malformed.status).toBe(400);
        expect(await malformed.json()).toMatchObject({ code: 'INVALID_JSON' });
      }
    }
  });
  it.each([
    ['/api/liff/nen/pets', Math.ceil(1_500_000 / 3) * 4 + 4096],
    ['/api/liff/nen/pets/pet-a/photo', Math.ceil(1_500_000 / 3) * 4 + 4096],
    ['/api/liff/nen/photos', Math.ceil((8 * 1024 * 1024) / 3) * 4 + 4096],
  ] as const)('keeps the existing upload JSON boundary for %s', async (path, max) => {
    const target = app('active');
    target.hono.post(path, async c => c.json({ bytes: (await c.req.text()).length }));
    const body = JSON.stringify({ liffId: 'fixture', data: 'x'.repeat(max - 100) });
    const response = await target.hono.request(path, { method: 'POST', body, headers: { 'Content-Type': 'application/json' } }, target.env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ bytes: body.length });
    expect((await target.hono.request(path, {
      method: 'POST', body: body + ' '.repeat(101), headers: { 'Content-Type': 'application/json' },
    }, target.env)).status).toBe(413);
  });
  it('leaves multipart intact for the bounded upload handler', async () => {
    const target = app('active');
    const form = new FormData(); form.set('file', new Blob(['fixture']), 'fixture.txt');
    target.hono.post('/api/liff/multipart', async c => {
      const file = (await c.req.parseBody()).file;
      return c.json({ filename: file instanceof File ? file.name : null });
    });
    const response = await target.hono.request('/api/liff/multipart', { method: 'POST', body: form }, target.env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ filename: 'fixture.txt' });
    expect(target.prepare).not.toHaveBeenCalled();
  });
});

// Content-Type cannot bypass the selector's existing tenant suspension check.
it.each(['text/plain', 'application/octet-stream', 'multipart/form-data; boundary=fixture'])('mislabeled JSON retains the tenant wall: %s', async contentType => {
  const target = app('suspended');
  const response = await target.hono.request('/api/liff/booking/requests', {
    method: 'POST', headers: { 'Content-Type': contentType }, body: JSON.stringify({ liffId: 'fixture' }),
  }, target.env);
  expect(response.status).toBe(503);
});

it('preserves the existing 5 MiB paper-photo multipart budget byte for byte', async () => {
  const target = app('active');
  const path = '/api/liff/visit-stamps/cards/fixture/paper-photos';
  const payload = new Uint8Array(5 * 1024 * 1024); payload[0] = 0xff; payload[1] = 0xfe;
  target.hono.post(path, async c => {
    const file = (await c.req.parseBody()).file;
    if (!(file instanceof File)) return c.json({ ok: false }, 400);
    const received = new Uint8Array(await file.arrayBuffer());
    return c.json({ size: received.length, prefix: Array.from(received.slice(0, 2)) });
  });
  const form = new FormData(); form.set('file', new File([payload], 'fixture.jpg', { type: 'image/jpeg' }));
  const response = await target.hono.request(path, { method: 'POST', body: form }, target.env);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ size: payload.length, prefix: [255, 254] });
});

it.each(['liffId=&liff_id=ignored', 'accountId=&account_id=ignored'])('empty canonical selector still delegates to the JSON body: %s', async query => {
  const target = app('suspended');
  const response = await target.hono.request('/api/liff/booking/requests?' + query, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '\ufeff  ' + JSON.stringify({ liffId: 'fixture' }),
  }, target.env);
  expect(response.status).toBe(503);
});
