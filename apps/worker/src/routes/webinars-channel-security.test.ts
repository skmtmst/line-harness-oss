import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../worker-env.js';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { webinarRoutes } from './webinars.js';
const opened: ReturnType<typeof createTestD1>[] = [];
afterEach(() => { opened.splice(0).forEach(db => db.raw.close()); vi.unstubAllGlobals(); });
const cases = [
  ['GET', ''], ['POST', '/register'], ['POST', '/heartbeat'], ['GET', '/audience'],
  ['POST', '/comments'], ['POST', '/cta-click'], ['POST', '/funnel-event'],
] as const;
describe('S15 webinar tokens must belong to the webinar store', () => {
  for (const state of ['wrong-store', 'missing', 'expired'] as const) {
    it.each(cases)(`${state}: %s %s`, async (method, suffix) => {
      const db = createTestD1({ foreignKeys: false }); opened.push(db);
      db.raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,login_channel_id)
        VALUES ('a','ca','Fixture A','unused','unused','login-a'),('b','cb','Fixture B','unused','unused','login-b');
        INSERT INTO friends(id,line_user_id,line_account_id) VALUES ('fa','Ufixture','a');
        INSERT INTO webinars(id,account_id,title,slug,status,created_at,updated_at)
        VALUES ('wa','a','Fixture webinar','fixture','active','2026-10-16','2026-10-16');`);
      vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init?: RequestInit) => {
        const channel = new URLSearchParams(String(init?.body)).get('client_id');
        return state === 'wrong-store' && channel === 'login-b'
          ? Response.json({ sub: 'Ufixture' }) : new Response('invalid', { status: 400 });
      }));
      const app = new Hono<Env>(); app.route('/', webinarRoutes);
      const response = await app.request('/api/liff/webinars/fixture' + suffix, {
        method, headers: { ...(state !== 'missing' ? { Authorization: 'Bearer fixture-token' } : {}), 'Content-Type': 'application/json' },
        ...(method === 'POST' ? { body: '{}' } : {}),
      }, { DB: db.db, LINE_LOGIN_CHANNEL_ID: 'login-b' } as Env['Bindings']);
      expect(response.status).toBe(401);
      expect(db.raw.prepare('SELECT COUNT(*) n FROM webinar_viewers').get()).toEqual({ n: 0 });
    });
  }
});
