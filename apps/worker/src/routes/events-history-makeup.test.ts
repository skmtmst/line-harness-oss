import { Hono } from 'hono';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Env } from '../worker-env.js';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
const auth = vi.hoisted(() => ({ verifyCallerLineUserId: vi.fn() }));
vi.mock('../services/liff-auth.js', () => auth);
import events from './events.js';
import { eventBookingMakeupView } from './events/history-makeup.js';
let fixture: ReturnType<typeof createTestD1>;
const rule = { enabled: true, cutoffHours: 3, validDays: 30, monthlyCap: 2, target: 'same_kind', targetIds: [] };
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-01T03:00:00.000Z'));
  fixture = createTestD1({ now: () => new Date() });
  fixture.raw.exec(`
    INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,liff_id) VALUES('a','ch-a','教室','mock','mock','L1'),('b','ch-b','別の教室','mock','mock','L2');
    INSERT INTO friends(id,line_user_id,line_account_id) VALUES('f','Utest','a'),('g','Uother','a'),('fb','Utest-b','b');
    INSERT INTO events(id,line_account_id,name) VALUES('enabled','a','有効クラス'),('disabled','a','無効クラス'),('unset','a','既定クラス'),('invalid','a','不正設定クラス'),('foreign','b','別アカウント');
    INSERT INTO event_slots(id,event_id,starts_at,ends_at,capacity) VALUES
      ('on-slot','enabled','2026-11-01T08:00:00.000Z','2026-11-01T09:00:00.000Z',10),
      ('off-slot','disabled','2026-11-02T08:00:00.000Z','2026-11-02T09:00:00.000Z',10),
      ('unset-slot','unset','2026-11-03T08:00:00.000Z','2026-11-03T09:00:00.000Z',10),
      ('invalid-slot','invalid','2026-11-04T08:00:00.000Z','2026-11-04T09:00:00.000Z',10),
      ('past-slot','enabled','2026-11-01T02:00:00.000Z','2026-11-01T03:00:00.000Z',10),
      ('now-slot','enabled','2026-11-01T03:00:00.000Z','2026-11-01T04:00:00.000Z',10),
      ('foreign-slot','foreign','2026-11-01T08:00:00.000Z','2026-11-01T09:00:00.000Z',10);
    INSERT INTO event_bookings(id,line_account_id,event_id,slot_id,friend_id,status,requested_at) VALUES
      ('on-booking','a','enabled','on-slot','f','confirmed','2026-10-01'),
      ('off-booking','a','disabled','off-slot','f','confirmed','2026-10-01'),
      ('unset-booking','a','unset','unset-slot','f','requested','2026-10-01'),
      ('invalid-booking','a','invalid','invalid-slot','f','confirmed','2026-10-01'),
      ('past-booking','a','enabled','past-slot','f','confirmed','2026-10-01'),
      ('now-booking','a','enabled','now-slot','f','requested','2026-10-01'),
      ('other-friend','a','enabled','on-slot','g','confirmed','2026-10-01'),
      ('other-account','b','foreign','foreign-slot','fb','confirmed','2026-10-01');
    INSERT INTO event_waitlist(id,line_account_id,event_id,slot_id,friend_id,identity_key,status,created_at,updated_at) VALUES('waiting','a','enabled','on-slot','f','f','waiting','2026-10-01','2026-10-01');
  `);
  fixture.raw.prepare('UPDATE events SET makeup_rule_json=? WHERE id=?').run(JSON.stringify(rule), 'enabled');
  fixture.raw.prepare('UPDATE events SET makeup_rule_json=? WHERE id=?').run(JSON.stringify({ ...rule, enabled: false, cutoffHours: 1 }), 'disabled');
  fixture.raw.prepare("UPDATE events SET makeup_rule_json='{}' WHERE id='invalid'").run();
  auth.verifyCallerLineUserId.mockResolvedValue('Utest');
});
afterEach(() => { fixture.raw.close(); vi.useRealTimers(); vi.restoreAllMocks(); });
function app() { const router = new Hono<Env>(); router.route('/', events); return router; }
async function read(path = '/api/liff/events/me?liffId=L1&tab=upcoming') {
  return app().request(path, { headers: { Authorization: 'Bearer mock' } }, { DB: fixture.db } as Env['Bindings']);
}
async function rows(tab = 'upcoming') {
  const response = await read(`/api/liff/events/me?liffId=L1&tab=${tab}`);
  expect(response.status).toBe(200);
  return (await response.json() as { items: Array<Record<string, unknown>> }).items;
}
function noPrivate(value: unknown) { expect(JSON.stringify(value)).not.toMatch(/_makeup|makeup_rule_json|cutoffHours|targetIds/); }
it('本人の有効設定から一覧と詳細に同じ締めと期限を返し、GETで書き込まない', async () => {
  const external = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('external_forbidden'));
  const before = fixture.raw.prepare('SELECT total_changes() AS n').get();
  const items = await rows();
  const on = items.find(row => row.id === 'on-booking');
  expect(on?.makeup).toEqual({ enabled: true, cutoff_at: '2026-11-01T05:00:00.000Z', valid_until: '2026-12-01T08:00:00.000Z' });
  const detail = await read('/api/liff/events/me/on-booking?liffId=L1');
  expect(detail.status).toBe(200);
  const value = await detail.json();
  expect(value).toMatchObject({ makeup: on?.makeup });
  noPrivate(items); noPrivate(value);
  expect(fixture.raw.prepare('SELECT total_changes() AS n').get()).toEqual(before);
  expect(fixture.raw.prepare('SELECT COUNT(*) AS n FROM booking_makeup_credits').get()).toEqual({ n: 0 });
  expect(external).not.toHaveBeenCalled();
});
it('無効・既定無効・不正の設定で入口を作らず、待ち行は元のまま返す', async () => {
  const items = await rows();
  for (const id of ['off-booking', 'unset-booking']) expect(items.find(row => row.id === id)?.makeup).toMatchObject({ enabled: false });
  expect(items.find(row => row.id === 'invalid-booking')).not.toHaveProperty('makeup');
  expect(items.find(row => row.id === 'waiting')).not.toHaveProperty('makeup');
  expect(items.find(row => row.id === 'on-booking')?.makeup).toMatchObject({ enabled: true });
  const invalid = await read('/api/liff/events/me/invalid-booking?liffId=L1');
  expect(invalid.status).toBe(200); expect(await invalid.json()).not.toHaveProperty('makeup');
});
it('過去・現在・未来は既存実行側と同じ境界で扱い、tabと順序を変えない', async () => {
  const upcoming = await rows();
  expect(upcoming.map(row => row.id)).toEqual(['now-booking','on-booking','waiting','off-booking','unset-booking','invalid-booking']);
  expect(upcoming[0]).toMatchObject({ status: 'requested', makeup: { enabled: true, cutoff_at: '2026-11-01T00:00:00.000Z' } });
  const past = await rows('past');
  expect(past.map(row => row.id)).toEqual(['past-booking']);
  expect(past[0]).toMatchObject({ status: 'confirmed', slot_starts_at: '2026-11-01T02:00:00.000Z' });
  expect(past[0]).not.toHaveProperty('makeup');
});
it('snapshot日時を保ったまま現在の枠の開始で締めと期限を返し、現在開始が過去なら付けない', async () => {
  fixture.raw.prepare('UPDATE event_bookings SET event_snapshot_json=? WHERE id=?').run(JSON.stringify({ eventName:'控えは未来', slotStartsAt:'2026-11-05T08:00:00.000Z', slotEndsAt:'2026-11-05T09:00:00.000Z' }), 'past-booking');
  fixture.raw.prepare('UPDATE event_bookings SET event_snapshot_json=? WHERE id=?').run(JSON.stringify({ eventName:'控えは過去', slotStartsAt:'2026-10-01T08:00:00.000Z', slotEndsAt:'2026-10-01T09:00:00.000Z' }), 'on-booking');
  const future = (await rows()).find(row => row.id === 'past-booking');
  expect(future).toMatchObject({ event_name:'控えは未来', slot_starts_at:'2026-11-05T08:00:00.000Z' });
  expect(future).not.toHaveProperty('makeup');
  const past = (await rows('past')).find(row => row.id === 'on-booking');
  expect(past).toMatchObject({ event_name:'控えは過去', slot_starts_at:'2026-10-01T08:00:00.000Z', makeup: { cutoff_at:'2026-11-01T05:00:00.000Z', valid_until:'2026-12-01T08:00:00.000Z' } });
  const detail = await read('/api/liff/events/me/past-booking?liffId=L1');
  expect(await detail.json()).toMatchObject({ slot_starts_at:future?.slot_starts_at });
});
it('他人・他accountの予約を一覧と詳細に混ぜず、認証失敗を隠さない', async () => {
  const items = await rows();
  expect(items.some(row => ['other-friend','other-account'].includes(String(row.id)))).toBe(false);
  expect((await read('/api/liff/events/me/other-friend?liffId=L1')).status).toBe(404);
  expect((await read('/api/liff/events/me/other-account?liffId=L1')).status).toBe(404);
  auth.verifyCallerLineUserId.mockResolvedValue(null);
  expect((await read()).status).toBe(401);
});

it.each(['not-json', '{}', JSON.stringify({ ...rule, validDays: 0 })])('不正な決まり%sはその行だけ省き、私的な値を返さない', rawRule => {
  const row = eventBookingMakeupView({ id:'bad', _makeup_rule_json:rawRule, _makeup_starts_at:'2026-11-01T08:00:00.000Z' }, Date.now());
  expect(row).toEqual({ id:'bad' });
});
it.each(['not-a-date', '+275760-09-13T00:00:00.000Z'])('開始%sから有効な案内日時を作れないときは推測しない', startsAt => {
  const row = eventBookingMakeupView({ id:'bad-time', _makeup_rule_json:JSON.stringify(rule), _makeup_starts_at:startsAt }, Date.now());
  expect(row).toEqual({ id:'bad-time' });
});
it('DBや認証の実障害を不正設定として隠さない', async () => {
  const prepare = vi.spyOn(fixture.db, 'prepare').mockImplementation(() => { throw new Error('database_unavailable'); });
  expect((await read()).status).toBe(500);
  prepare.mockRestore();
  auth.verifyCallerLineUserId.mockRejectedValue(new Error('auth_unavailable'));
  expect((await read()).status).toBe(500);
});
