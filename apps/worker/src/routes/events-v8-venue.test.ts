import { Hono } from 'hono';
import { expect, it, vi } from 'vitest';
import type { Env } from '../index.js';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
vi.mock('../services/account-access.js', () => ({ canAccessAllLineAccounts: async (_db: unknown, _staff: unknown, ids: string[]) => ids.every(x => x === 'a') }));
import events from './events.js';
function app() {
 const app = new Hono<Env>();
 app.use('*', async (c,next) => { c.set('staff', { id:'o', name:'Owner', role:'owner', readOnly:false }); await next(); });
 app.route('/', events); return app;
}
it('住所を保存・再取得し、版付き更新でも保つ', async () => {
 const { db, raw } = createTestD1();
 try {
  raw.exec("INSERT INTO line_accounts (id,channel_id,name,channel_access_token,channel_secret) VALUES ('a','c','test','token','secret')");
  const request = (path: string, method: string, body?: unknown) => app().request(path, { method, headers:{'content-type':'application/json'}, body:body == null ? undefined : JSON.stringify(body) }, { DB:db });
  const create = await request('/api/events/admin/events?account_id=a','POST',{name:'教室',venue_name:'会場',venue_address:'テスト住所',venue_url:'https://example.com/venue'});
  expect(create.status).toBe(201);
  const created = await create.json() as any;
  const get = await request(`/api/events/admin/events/${created.id}?account_id=a`,'GET');
  expect((await get.json() as any).venue_address).toBe('テスト住所');
  const update = await request(`/api/events/admin/events/${created.id}?account_id=a`,'PUT',{expected_version:1,venue_address:'変更した住所'});
  expect(update.status).toBe(200);
  expect((await update.json() as any).venue_address).toBe('変更した住所');
 } finally { raw.close(); }
});
it('保存前の見本でDBを変えず、他アカウント・危険URLを拒む', async () => {
 const { db, raw } = createTestD1();
 try {
  const body = { name:'教室',venue_address:'テスト住所', slot:{starts_at:'2026-10-12T05:00:00Z',ends_at:'2026-10-12T06:00:00Z',capacity:20} };
  const request = (account: string, payload: unknown) => app().request(`/api/events/admin/application-preview?account_id=${account}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)},{DB:db});
  expect((await request('a',body)).status).toBe(200);
  expect(raw.prepare('SELECT COUNT(*) n FROM events').get()).toEqual({n:0});
  expect((await request('b',body)).status).toBe(403);
  expect((await request('a',{...body,venue_url:'javascript:alert(1)'})).status).toBe(422);
 } finally { raw.close(); }
});
