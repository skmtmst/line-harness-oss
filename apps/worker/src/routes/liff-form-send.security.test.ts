import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { tenantPublicBoundaryMiddleware } from '../middleware/tenant-public-boundary.js';
import { liffRoutes } from './liff.js';

let db: ReturnType<typeof createTestD1>;
let push = vi.fn<(body: { to: string; messages: Array<{ type: string }> }, auth: string | null) => void>();
let identity = 'user-a';
let tokenValid = true;
function send(body: Record<string, unknown>) {
  const app = new Hono<Env>();
  app.use('/api/liff/*', tenantPublicBoundaryMiddleware);
  app.route('/', liffRoutes);
  return app.request('https://api.fixture.test/api/liff/send-form-link', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }, { DB: db.db, LINE_LOGIN_CHANNEL_ID: 'channel-a', LINE_CHANNEL_ACCESS_TOKEN: 'unused' } as Env['Bindings']);
}
const valid = { lineUserId: 'user-a', formId: 'form-fixture', idToken: 'fixture-token' };
beforeEach(() => {
  db = createTestD1({ foreignKeys: false }); identity = 'user-a'; tokenValid = true; push = vi.fn();
  db.raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,liff_id,login_channel_id)
    VALUES ('account-a','bot-a','Fixture A','fixture-token-a','unused','liff-a','channel-a'),
           ('account-b','bot-b','Fixture B','fixture-token-b','unused','liff-b','channel-b');
    INSERT INTO friends(id,line_user_id,display_name,line_account_id)
    VALUES ('friend-a','user-a','Fixture A','account-a'),('friend-b','user-b','Fixture B','account-b');`);
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === 'https://api.line.me/oauth2/v2.1/verify') {
      const channel = new URLSearchParams(init?.body as string).get('client_id');
      return channel === 'channel-a' && tokenValid
        ? new Response(JSON.stringify({ sub: identity }), { status: 200 }) : new Response('{}', { status: 400 });
    }
    if (url === 'https://api.line.me/v2/bot/message/push') {
      push(JSON.parse(init?.body as string), new Headers(init?.headers).get('Authorization'));
      return new Response('{}', { status: 200 });
    }
    throw new Error('Unexpected external call in mocked test');
  }));
});
afterEach(() => { db.raw.close(); vi.unstubAllGlobals(); });

describe('Q03 form send keeps identity and account validation before the narrowed payload', () => {
  it('sends the correct account message only to its verified friend', async () => {
    expect((await send(valid)).status).toBe(200);
    expect(push).toHaveBeenCalledTimes(1);
    const [body, auth] = push.mock.calls[0];
    expect(body.to).toBe('user-a');
    expect(body.messages[0].type).toBe('flex');
    expect(JSON.stringify(body)).toContain('liff-a');
    expect(auth).toBe('Bearer fixture-token-a');
  });
  it.each([
    [{ ...valid, idToken: undefined }, 401],
    [{ ...valid, lineUserId: 42 }, 400],
    [{ ...valid, formId: {} }, 400],
    [{ ...valid, lineUserId: 'user-b' }, 403],
  ] as const)('rejects missing/invalid input or another identity %# without sending', async (body, status) => {
    expect((await send(body)).status).toBe(status);
    expect(push).not.toHaveBeenCalled();
  });
  it('rejects a token for another channel without sending', async () => {
    tokenValid = false;
    expect((await send(valid)).status).toBe(401);
    expect(push).not.toHaveBeenCalled();
  });
  it('cannot borrow a friend from another account even for a verified matching subject', async () => {
    identity = 'user-b';
    expect((await send({ ...valid, lineUserId: 'user-b' })).status).toBe(404);
    expect(push).not.toHaveBeenCalled();
  });
});
