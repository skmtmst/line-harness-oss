import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../worker-env.js';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import booking from './booking.js';

const opened: ReturnType<typeof createTestD1>[] = [];
afterEach(() => { opened.splice(0).forEach(db => db.raw.close()); vi.unstubAllGlobals(); });
const cases = [
  ['GET', '/api/liff/booking/me'],
  ['POST', '/api/liff/booking/requests'],
  ['GET', '/api/liff/booking/waitlist'],
  ['POST', '/api/liff/booking/waitlist'],
  ['DELETE', '/api/liff/booking/waitlist/other-person'],
  ['GET', '/api/liff/booking/seat-waitlist'],
  ['POST', '/api/liff/booking/other-person/reschedule'],
  ['POST', '/api/liff/booking/other-person/cancel'],
  ['POST', '/api/liff/booking/seat-waitlist'],
  ['DELETE', '/api/liff/booking/seat-waitlist/other-person'],
  ['POST', '/api/liff/booking/seat-waitlist/other-person/accept'],
  ['GET', '/api/liff/booking/last-booking'],
  ['GET', '/api/liff/booking/waitlist/mine'],
  ['GET', '/api/liff/booking/seat-availability'],
] as const;

describe('S15 booking LINE Login audience belongs to the requested LIFF account', () => {
  for (const tokenState of ['wrong-store', 'missing', 'expired'] as const) {
  it.each(cases)(`${tokenState}: rejects authentication on %s %s`, async (method, path) => {
    const db = createTestD1({ foreignKeys: false }); opened.push(db);
    db.raw.exec(`INSERT INTO line_accounts (id,channel_id,name,channel_access_token,channel_secret,liff_id,login_channel_id)
      VALUES ('account-a','channel-a','Fixture A','unused','unused','liff-a','login-a'),
      ('account-b','channel-b','Fixture B','unused','unused','liff-b','login-b');
      INSERT INTO friends (id,line_user_id,line_account_id,is_following) VALUES ('person-a','Ufixture','account-a',1);`);
    const verify = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const audience = new URLSearchParams(String(init?.body)).get('client_id');
      return tokenState === 'wrong-store' && audience === 'login-b'
        ? Response.json({ sub: 'Ufixture' }) : new Response('invalid token', { status: 400 });
    });
    vi.stubGlobal('fetch', verify);
    const app = new Hono<Env>(); app.route('/', booking);
    const response = await app.request(`${path}?liffId=liff-a`, {
      method, headers: { ...(tokenState !== 'missing' ? { Authorization: `Bearer ${tokenState}-token` } : {}), 'Content-Type': 'application/json', 'Idempotency-Key': 'fixture-request' },
      ...(method === 'POST' ? { body: '{}' } : {}),
    }, { DB: db.db, LINE_LOGIN_CHANNEL_ID: 'login-b' } as Env['Bindings']);
    expect(response.status).toBe(401);
    expect(verify).toHaveBeenCalledTimes(tokenState === 'missing' ? 0 : 1);
    if (tokenState !== 'missing') expect(new URLSearchParams(String(verify.mock.calls[0][1]?.body)).get('client_id')).toBe('login-a');
    expect(await response.text()).not.toContain('person-a');
  });

  }

  it('does not use an untrusted JWT audience as an additional login channel', async () => {
    const db = createTestD1({ foreignKeys: false }); opened.push(db);
    db.raw.exec(`INSERT INTO line_accounts (id,channel_id,name,channel_access_token,channel_secret,liff_id,login_channel_id)
      VALUES ('account-a','channel-a','Fixture A','unused','unused','liff-a','login-a');`);
    const verify = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const audience = new URLSearchParams(String(init?.body)).get('client_id');
      return audience === 'attacker-channel' ? Response.json({ sub: 'Ufixture' }) : new Response('', { status: 400 });
    });
    vi.stubGlobal('fetch', verify);
    const app = new Hono<Env>(); app.route('/', booking);
    const token = `e30.${btoa(JSON.stringify({ aud: 'attacker-channel' }))}.fixture-signature`;
    const response = await app.request('/api/liff/booking/me?liffId=liff-a', {
      headers: { Authorization: `Bearer ${token}` },
    }, { DB: db.db } as Env['Bindings']);
    expect(response.status).toBe(401);
    expect(verify).toHaveBeenCalledTimes(1);
  });
});
