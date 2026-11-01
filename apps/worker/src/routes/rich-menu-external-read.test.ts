import { afterEach, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../worker-env.js';

vi.mock('@line-crm/db', async importOriginal => ({
  ...await importOriginal<typeof import('@line-crm/db')>(),
  getLineAccountById: vi.fn(async () => ({ channel_access_token: 'fake-line-token' })),
}));
vi.mock('../services/account-access.js', () => ({ canAccessAllLineAccounts: vi.fn(async () => true) }));
const { richMenuGroups } = await import('./rich-menu-groups.js');
afterEach(() => vi.restoreAllMocks());

// 実際のGET入口を呼び、外部LINEの応答だけを固定する。実通信・書き込みはしない。
test.each([
  [401, 'INVALID_LINE_ACCESS_TOKEN', 'LINE連携の認証情報を確認できません。連携の設定を確認してください。'],
  [429, 'LINE_RATE_LIMITED', 'LINEへの問い合わせが集中しています。少し待ってから、もう一度読み込んでください。'],
  [503, 'LINE_RICH_MENU_LIST_FAILED', 'LINEのリッチメニューを取得できませんでした。連携の状態を確認してください。'],
])('LINE読取の失敗理由を安全な符号で保ち、HTTP500を維持する（%i）', async (status, code, message) => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response('upstream-private-token', { status: Number(status) }))
    .mockResolvedValueOnce(new Response('', { status: 404 }));
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'staff-1', role: 'owner' } as Env['Variables']['staff']);
    c.env = { DB: {} } as Env['Bindings'];
    await next();
  });
  app.route('/', richMenuGroups);
  const res = await app.request('/api/rich-menu-groups/external?accountId=acc-1');
  expect(res.status).toBe(500);
  const body = await res.json() as { code?: string; error?: unknown };
  expect(body.code).toBe(code);
  expect(body.error).toBe(message);
  expect(JSON.stringify(body)).not.toContain('upstream-private-token');
  expect(fetchSpy).toHaveBeenCalledTimes(2);
});
