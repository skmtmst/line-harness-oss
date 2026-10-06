import { Hono } from 'hono';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Env } from '../index.js';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
const auth = vi.hoisted(() => ({ verifyCallerLineUserId: vi.fn<() => Promise<string | null>>() }));
vi.mock('../services/liff-auth.js', () => auth);
import events from './events.js';
let fixture: ReturnType<typeof createTestD1>;
let app: Hono<Env>;
const token = 'test-offer-token-12345678901234567890123456789';
beforeEach(async () => {
  fixture = createTestD1();
  fixture.raw.exec(`
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, liff_id)
    VALUES ('a', 'ch-a', '試験店', 'test', 'test', 'L1'), ('b', 'ch-b', '試験別店', 'test', 'test', 'L2');
    INSERT INTO friends (id, line_user_id, line_account_id) VALUES ('f', 'Utest', 'a'), ('g', 'Uother', 'a'), ('fb', 'Utest-b', 'b');
    INSERT INTO events (id, line_account_id, name) VALUES ('e', 'a', '試験イベント');
    INSERT INTO event_slots (id, event_id, starts_at, ends_at, capacity)
    VALUES ('s', 'e', '2099-06-01T00:00:00.000Z', '2099-06-01T01:00:00.000Z', 5);
    INSERT INTO event_waitlist (id, line_account_id, event_id, slot_id, friend_id, identity_key, status, party_size, offer_expires_at, created_at, updated_at)
    VALUES ('w', 'a', 'e', 's', 'f', 'f', 'offered', 2, '2099-05-31T23:00:00.000Z', '2026-10-01', '2026-10-01');
  `);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  fixture.raw.prepare(`UPDATE event_waitlist SET offer_token_hash = ?`).run(hash);
  auth.verifyCallerLineUserId.mockResolvedValue('Utest');
  app = new Hono<Env>();
  app.route('/', events);
});
afterEach(() => fixture.raw.close());
function request(path: string, method = 'GET') {
  return app.request(`/api/liff/events/${path}${path.includes('?') ? '&' : '?'}liffId=L1`,
    { method, headers: { Authorization: 'Bearer test' } }, { DB: fixture.db } as Env['Bindings']);
}
test('本人へ案内詳細を返し、tokenのハッシュや個人情報を含めない', async () => {
  const res = await request(`waitlist/${token}`);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ success: true, data: {
    waitlistId: 'w', eventId: 'e', slotId: 's', partySize: 2, status: 'offered',
    eventName: '試験イベント', startsAt: '2099-06-01T00:00:00.000Z', endsAt: '2099-06-01T01:00:00.000Z',
    venueName: null, expiresAt: '2099-05-31T23:00:00.000Z', remainingSeconds: expect.any(Number), canAccept: true,
  } });
});
test('未認証は401、別人と存在しない案内は404', async () => {
  auth.verifyCallerLineUserId.mockResolvedValue(null);
  expect((await request(`waitlist/${token}`)).status).toBe(401);
  auth.verifyCallerLineUserId.mockResolvedValue('Uother');
  expect((await request(`waitlist/${token}`)).status).toBe(404);
  expect((await request('waitlist/missing')).status).toBe(404);
});
