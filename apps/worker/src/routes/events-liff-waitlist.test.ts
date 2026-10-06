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
test('待ち一覧と個別取得は本人の行だけを返し、案内中の順番はnull', async () => {
  const res = await request('me/waitlist');
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ items: [{ id: 'w', queue_position: null, source: 'waitlist' }] });
  expect((await request('me/waitlist/w')).status).toBe(200);
  auth.verifyCallerLineUserId.mockResolvedValue('Uother');
  expect(await (await request('me/waitlist')).json()).toEqual({ items: [] });
  expect((await request('me/waitlist/w')).status).toBe(404);
  expect((await request('me/waitlist/w/cancel', 'POST')).status).toBe(404);
});
test('取り下げは再送しても成功し、一度だけ次候補のjobを残す', async () => {
  expect(await (await request('me/waitlist/w/cancel', 'POST')).json()).toEqual({ ok: true });
  expect(await (await request('me/waitlist/w/cancel', 'POST')).json()).toEqual({ ok: true });
  expect(fixture.raw.prepare(`SELECT status FROM event_waitlist WHERE id = 'w'`).get()).toEqual({ status: 'cancelled' });
  expect(fixture.raw.prepare(`SELECT COUNT(*) AS count FROM event_waitlist_promotion_jobs`).get()).toEqual({ count: 1 });
});
test('別店・未認証・受諾中の取り下げを拒否する', async () => {
  const foreign = await app.request('/api/liff/events/me/waitlist/w/cancel?liffId=L2',
    { method: 'POST' }, { DB: fixture.db } as Env['Bindings']);
  expect(foreign.status).toBe(404);
  auth.verifyCallerLineUserId.mockResolvedValue(null);
  expect((await request('me/waitlist')).status).toBe(401);
  expect((await request('me/waitlist/w/cancel', 'POST')).status).toBe(401);
  auth.verifyCallerLineUserId.mockResolvedValue('Utest');
  fixture.raw.exec(`UPDATE event_waitlist SET status = 'accepted' WHERE id = 'w'`);
  expect((await request('me/waitlist/w/cancel', 'POST')).status).toBe(409);
});
test('自分のイベントに予約の旧形式と順番つきの待ちを日時順で返す', async () => {
  fixture.raw.exec(`
    UPDATE event_waitlist SET status = 'waiting' WHERE id = 'w';
    INSERT INTO event_waitlist (id, line_account_id, event_id, slot_id, friend_id, identity_key, status, sort_order, created_at, updated_at)
      VALUES ('ahead', 'a', 'e', 's', 'g', 'g', 'waiting', -1, '2026-10-02', '2026-10-02');
    INSERT INTO event_slots (id, event_id, starts_at, ends_at) VALUES ('earlier', 'e', '2099-05-01T00:00:00.000Z', '2099-05-01T01:00:00.000Z');
    INSERT INTO event_bookings (id, line_account_id, event_id, slot_id, friend_id, identity_key, status, requested_at)
      VALUES ('booking', 'a', 'e', 'earlier', 'f', 'f', 'confirmed', '2026-10-01');
  `);
  const res = await request('me?tab=upcoming');
  expect(res.status).toBe(200);
  const { items } = await res.json() as { items: Record<string, unknown>[] };
  expect(items.map(row => row.id)).toEqual(['booking', 'w']);
  expect(items[0]).not.toHaveProperty('source');
  expect(items[0]).toMatchObject({ status: 'confirmed', customer_note: null, event_name: '試験イベント' });
  expect(items[1]).toMatchObject({ source: 'waitlist', queue_position: 2, party_size: 2 });
});
test('終了・取消の待ちは過去に出し、予約化済みは二重表示しない', async () => {
  fixture.raw.exec(`UPDATE event_waitlist SET status = 'cancelled' WHERE id = 'w'`);
  expect(await (await request('me?tab=upcoming')).json()).toEqual({ items: [] });
  expect(await (await request('me?tab=past')).json()).toMatchObject({ items: [{ id: 'w', status: 'cancelled', queue_position: null }] });
  fixture.raw.exec(`UPDATE event_waitlist SET status = 'expired' WHERE id = 'w'`);
  expect(await (await request('me?tab=past')).json()).toMatchObject({ items: [{ id: 'w', status: 'expired' }] });
  fixture.raw.exec(`UPDATE event_waitlist SET status = 'waiting' WHERE id = 'w';
    UPDATE event_slots SET starts_at = '2020-06-01T00:00:00.000Z' WHERE id = 's'`);
  expect(await (await request('me?tab=past')).json()).toMatchObject({ items: [{ id: 'w' }] });
  fixture.raw.exec(`UPDATE event_waitlist SET status = 'converted' WHERE id = 'w'`);
  expect(await (await request('me?tab=past')).json()).toEqual({ items: [] });
});
test('イベント編集後も待ち一覧の日時と名称は申込時のsnapshotに従う', async () => {
  fixture.raw.prepare(`UPDATE event_waitlist SET status = 'waiting', event_snapshot_json = ?`).run(JSON.stringify({
    eventName: '申込時の体験会', slotStartsAt: '2099-07-01T00:00:00.000Z', slotEndsAt: '2099-07-01T01:00:00.000Z',
    eventImageUrl: null, venueName: '申込時の会場', venueAddress: null,
  }));
  expect(await (await request('me?tab=upcoming')).json()).toMatchObject({ items: [{
    id: 'w', event_name: '申込時の体験会', slot_starts_at: '2099-07-01T00:00:00.000Z', queue_position: 1,
  }] });
});
