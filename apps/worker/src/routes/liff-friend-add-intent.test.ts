import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const db = vi.hoisted(() => ({
  getLineAccounts: vi.fn(),
  getFriendByLineUserIdForAccount: vi.fn(),
  getEntryRouteByRefCode: vi.fn(),
  recordFriendAddAttributionCandidate: vi.fn(),
}));
vi.mock('@line-crm/db', () => db);

const { liffRoutes } = await import('./liff.js');
const app = new Hono<Env>();
app.route('/', liffRoutes);

const env = {
  DB: {} as D1Database,
  LINE_LOGIN_CHANNEL_ID: 'login-channel-1',
} as Env['Bindings'];

beforeEach(() => {
  vi.clearAllMocks();
  db.getLineAccounts.mockResolvedValue([
    { id: 'account-1', login_channel_id: 'login-channel-1' },
  ]);
  db.getFriendByLineUserIdForAccount.mockResolvedValue({
    id: 'friend-1', line_account_id: 'account-1', line_user_id: 'U-1',
  });
  db.getEntryRouteByRefCode.mockResolvedValue({ id: 'route-1' });
  db.recordFriendAddAttributionCandidate.mockResolvedValue({
    id: 'candidate-1', status: 'pending', refCode: 'summer', entryRouteId: 'route-1',
    expiresAt: '2026-08-24T12:10:00.000+09:00',
  });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ sub: 'U-1' }), { status: 200 })));
});

function request(authorization?: string) {
  return app.request('/api/liff/friend-add-intent', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authorization ? { Authorization: authorization } : {}),
    },
    body: JSON.stringify({ ref: 'summer', source: 'liff' }),
  }, env);
}

describe('POST /api/liff/friend-add-intent', () => {
  test('IDトークンが無ければ候補を保存しない', async () => {
    const response = await request();
    expect(response.status).toBe(401);
    expect(db.recordFriendAddAttributionCandidate).not.toHaveBeenCalled();
  });

  test('検証した本人とLINEアカウントで今回リンク候補を保存する', async () => {
    const response = await request('Bearer valid-id-token');
    expect(response.status).toBe(200);
    expect(db.getFriendByLineUserIdForAccount).toHaveBeenCalledWith(env.DB, 'U-1', 'account-1');
    expect(db.recordFriendAddAttributionCandidate).toHaveBeenCalledWith(env.DB, {
      lineAccountId: 'account-1', friendId: 'friend-1', refCode: 'summer',
      entryRouteId: 'route-1', source: 'liff',
    });
  });
});
