import { Hono } from 'hono';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Env } from '../worker-env.js';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import booking from './booking.js';
let f: ReturnType<typeof createTestD1>, app: Hono<Env>;
beforeEach(() => {
  f = createTestD1();
  f.raw.exec(
    `INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,liff_id,login_channel_id) VALUES('a','channel','店','token','secret','L1','login');INSERT INTO friends(id,line_user_id,line_account_id,is_following) VALUES('f','Uf','a',1);INSERT INTO menus(id,line_account_id,name,duration_minutes,base_price,is_active) VALUES('m','a','予約',60,0,1);`,
  );
  app = new Hono<Env>();
  app.route('/', booking);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === 'https://api.line.me/oauth2/v2.1/verify')
        return Response.json({ sub: 'Uf' });
      throw new Error('unexpected_external_request');
    }),
  );
});
afterEach(() => {
  f.raw.close();
  vi.unstubAllGlobals();
});
const send = (method: string, path: string, body?: unknown, auth = true) =>
  app.request(
    '/api/liff/booking/' + path + '?liffId=L1',
    {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(auth ? { Authorization: 'Bearer stub' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
    { DB: f.db, LINE_LOGIN_CHANNEL_ID: 'login' } as Env['Bindings'],
  );
test('page views derive the friend from verified identity and refuse missing auth or foreign menus', async () => {
  expect(
    (await send('POST', 'page-views', { menuId: 'm' }, false)).status,
  ).toBe(401);
  expect((await send('POST', 'page-views', { menuId: 'missing' })).status).toBe(
    404,
  );
  expect(
    (
      await send('POST', 'page-views', {
        menuId: 'm',
        entryPoint: 'rich_menu',
        friendId: 'impostor',
      })
    ).status,
  ).toBe(201);
  expect(
    f.raw
      .prepare(
        'SELECT friend_id,line_account_id,entry_point FROM booking_page_views',
      )
      .all(),
  ).toEqual([
    { friend_id: 'f', line_account_id: 'a', entry_point: 'rich_menu' },
  ]);
});
test('unconfigured customer entry returns a preparing state with a readable message', async () => {
  const r = await send('GET', 'style-readiness&feature=booking');
  expect(r.status).toBe(404);
  const result = await app.request(
    '/api/liff/booking/style-readiness?liffId=L1&feature=booking',
    { headers: { Authorization: 'Bearer stub' } },
    { DB: f.db, LINE_LOGIN_CHANNEL_ID: 'login' } as Env['Bindings'],
  );
  expect(result.status).toBe(200);
  expect(await result.json()).toMatchObject({
    success: true,
    data: { ready: false, state: 'preparing', message: '現在準備中です' },
  });
});
