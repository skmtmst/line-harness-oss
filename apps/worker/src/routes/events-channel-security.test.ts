import { mockLineIdToken } from '../test-utils/liff-oauth.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../worker-env.js';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import events from './events.js';
import { app as mountedApp } from '../index.js';

const opened: ReturnType<typeof createTestD1>[] = [];
afterEach(() => { opened.splice(0).forEach(db => db.raw.close()); vi.unstubAllGlobals(); });
const cases = [
  ['GET', '/api/liff/events/me'],
  ['GET', '/api/liff/events/me/foreign-booking'],
  ['POST', '/api/liff/events/me/foreign-booking/cancel'],
  ['GET', '/api/liff/events/me/waitlist'],
  ['GET', '/api/liff/events/me/waitlist/foreign-waitlist'],
  ['POST', '/api/liff/events/me/waitlist/foreign-waitlist/cancel'],
  ['POST', '/api/events/liff/bookings/foreign-booking/change'],
  ['POST', '/api/liff/events/foreign-event/bookings'],
] as const;

describe('S15 event callers must use the requested store login channel', () => {
  it('the mounted compatibility URL reaches LINE customer verification without an administrator session', async () => {
    const db = createTestD1({ foreignKeys: false }); opened.push(db);
    db.raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,liff_id,login_channel_id)
      VALUES ('account-a','channel-a','Fixture','unused','unused','liff-a','login-a');`);
    const verify = vi.fn(async () => Response.json({ sub: 'Ufixture' }));
    vi.stubGlobal('fetch', verify);
    const response = await mountedApp.request('/api/events/liff/bookings/foreign/change?liffId=liff-a', {
      method: 'POST', headers: { Authorization: 'Bearer fixture-line-token', 'Content-Type': 'application/json',
        'Idempotency-Key': 'fixture-event-request', 'CF-Connecting-IP': 'fixture-event' }, body: '{}',
    }, { DB: db.db } as Env['Bindings']);
    expect(response.status).toBe(404);
    expect((await response.json() as { error: { code: string } }).error.code).toBe('friend_not_found');
    expect(verify).toHaveBeenCalledTimes(1);
  });
  for (const state of ['wrong-store', 'missing', 'expired'] as const) {
    it.each(cases)(`${state}: %s %s`, async (method, path) => {
      const db = createTestD1({ foreignKeys: false }); opened.push(db);
      db.raw.exec(`INSERT INTO line_accounts (id,channel_id,name,channel_access_token,channel_secret,liff_id,login_channel_id)
        VALUES ('account-a','channel-a','Fixture A','unused','unused','liff-a','login-a'),
        ('account-b','channel-b','Fixture B','unused','unused','liff-b','login-b');`);
      const verify = vi.fn(async (_input: unknown, init?: RequestInit) => {
        const audience = new URLSearchParams(String(init?.body)).get('client_id');
        return state === 'wrong-store' && audience === 'login-b'
          ? Response.json({ sub: 'Ufixture' }) : new Response('invalid', { status: 400 });
      });
      vi.stubGlobal('fetch', verify);
      const app = new Hono<Env>(); app.route('/', events);
      const result = await app.request(`${path}?liffId=liff-a`, {
        method, headers: { ...(state !== 'missing' ? { Authorization: 'Bearer fixture-token' } : {}), 'Content-Type': 'application/json', 'Idempotency-Key': 'fixture-event-request' },
        ...(method === 'POST' ? { body: '{}' } : {}),
      }, { DB: db.db, LINE_LOGIN_CHANNEL_ID: 'login-b' } as Env['Bindings']);
      expect(result.status).toBe(401);
      expect(verify).toHaveBeenCalledTimes(state === 'missing' ? 0 : 1);
      if (state !== 'missing') expect(new URLSearchParams(String(verify.mock.calls[0][1]?.body)).get('client_id')).toBe('login-a');
    });
  }
});

it.each(['GET', 'POST'])('S15 %s waitlist offer verifies its stored account even without a LIFF query', async method => {
  const db = createTestD1({ foreignKeys: false }); opened.push(db);
  db.raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,login_channel_id)
    VALUES ('a','ca','Fixture A','unused','unused','login-a'), ('b','cb','Fixture B','unused','unused','login-b');`);
  const token = 'fixture-waitlist-offer-token-long-enough';
  const { sha256Hex } = await import('../middleware/auth.js');
  db.raw.prepare(`INSERT INTO event_waitlist(id,line_account_id,event_id,slot_id,friend_id,identity_key,status,offer_token_hash,created_at,updated_at)
    VALUES ('w','a','e','s','f','fixture','offered',?,'2026-10-16','2026-10-16')`).run(await sha256Hex(token));
  const verify = vi.fn(async (_input: unknown, init?: RequestInit) => {
    const channel = new URLSearchParams(String(init?.body)).get('client_id');
    return channel === 'login-b' ? Response.json({ sub: 'Ufixture' }) : new Response('invalid', { status: 400 });
  });
  vi.stubGlobal('fetch', verify);
  const app = new Hono<Env>(); app.route('/', events);
  const response = await app.request(`/api/liff/events/waitlist/${token}${method === 'POST' ? '/accept' : ''}`, {
    method, headers: { Authorization: `Bearer ${mockLineIdToken('login-b')}`, 'Content-Type': 'application/json' },
    ...(method === 'POST' ? { body: '{}' } : {}),
  }, { DB: db.db, LINE_LOGIN_CHANNEL_ID: 'login-b' } as Env['Bindings']);
  expect(response.status).toBe(401);
  expect(verify).toHaveBeenCalledTimes(1);
  expect(new URLSearchParams(String(verify.mock.calls[0][1]?.body)).get('client_id')).toBe('login-b');
  expect(db.raw.prepare("SELECT status,version FROM event_waitlist WHERE id='w'").get()).toEqual({status:'offered',version:1});
});

it('S15 a token-only offer cannot access a suspended tenant', async () => {
  const db = createTestD1({ foreignKeys: false }); opened.push(db);
  const token = 'fixture-suspended-offer-token-long-enough';
  const { sha256Hex } = await import('../middleware/auth.js');
  db.raw.exec(`INSERT INTO tenants(id,name,status) VALUES('paused','Fixture','suspended');
    INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,login_channel_id,tenant_id)
    VALUES ('a','ca','Fixture','unused','unused','login-a','paused');
    INSERT INTO friends(id,line_user_id,line_account_id) VALUES ('f','Ufixture','a');
    INSERT INTO events(id,line_account_id,name,target_type) VALUES ('e','a','Fixture event','single');
    INSERT INTO event_slots(id,event_id,starts_at,ends_at,capacity)
      VALUES ('s','e','2099-01-01T00:00:00Z','2099-01-01T01:00:00Z',1);`);
  db.raw.prepare(`INSERT INTO event_waitlist(id,line_account_id,event_id,slot_id,friend_id,identity_key,status,offer_token_hash,created_at,updated_at)
    VALUES ('w','a','e','s','f','fixture','offered',?,'2026-10-16','2026-10-16')`).run(await sha256Hex(token));
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ sub: 'Ufixture' })));
  // A complete offer must exist, otherwise a broken tenant gate could still
  // return 404 simply because a required join row was missing from the fixture.
  const { getEventWaitlistOffer } = await import('../services/event-waitlist.js');
  expect(await getEventWaitlistOffer(db.db, { token, callerLineUserId: 'Ufixture' })).not.toBeNull();
  const app = new Hono<Env>(); app.route('/', events);
  for (const method of ['GET','POST']) {
    const response = await app.request(`/api/liff/events/waitlist/${token}${method === 'POST' ? '/accept' : ''}`, {
      method, headers: { Authorization: `Bearer ${mockLineIdToken('login-a')}`, 'Content-Type': 'application/json' },
      ...(method === 'POST' ? { body: '{}' } : {}),
    }, { DB: db.db } as Env['Bindings']);
    expect(response.status).toBe(404);
    expect(db.raw.prepare("SELECT status,version FROM event_waitlist WHERE id='w'").get()).toEqual({status:'offered',version:1});
  }
});
