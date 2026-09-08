import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const mocks = {
  createAdPlatform: vi.fn(),
  updateAdPlatform: vi.fn(),
  getAdPlatformById: vi.fn(),
};
vi.mock('@line-crm/db', () => mocks);
vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: vi.fn(async () => true),
  getVisibleLineAccountScope: vi.fn(async () => ({ allowedAccountIds: [], canSeeUnassigned: true })),
}));

const { adPlatforms } = await import('./ad-platforms.js');
const app = new Hono<Env>();
// 書き込み系はオーナー限定。ここで見たいのは応答のマスクなので、
// 認証は通った状態にしてから渡す。権限の検証は role-guard.test.ts が持つ。
app.use('*', async (c, next) => {
  c.set('staff', { id: 'owner-1', name: 'Owner', role: 'owner', readOnly: false, tenantId: 'tenant-a' });
  return next();
});
app.route('/', adPlatforms);
const env = { DB: {} as D1Database };

beforeEach(() => vi.clearAllMocks());

// #514-18: GET は maskConfig を通すのに、書き込み応答だけ素通しだった。
// 将来の画面がそのまま表示しても秘密値が漏れないよう、書き込みも伏せる。
describe('POST/PUT /api/ad-platforms の応答マスク', () => {
  it('作成応答の長い文字列は伏せ、数値はそのまま返す', async () => {
    const config = { access_token: 'secret-token-12345', monthly_cost: 1000 };
    mocks.createAdPlatform.mockResolvedValue({
      id: 'platform-1', name: 'meta', display_name: 'Meta広告',
      config: JSON.stringify(config), is_active: 1,
      created_at: '2026-09-08T10:00:00.000', updated_at: '2026-09-08T10:00:00.000',
    });
    const response = await app.fetch(new Request('https://example.com/api/ad-platforms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'meta', config, lineAccountId: 'a1' }),
    }), env);
    expect(response.status).toBe(201);
    const body = await response.json() as { data: { config: Record<string, unknown> } };
    expect(body.data.config.access_token).toBe('secr****2345');
    expect(body.data.config.access_token).not.toContain('secret-token-12345');
    expect(body.data.config.monthly_cost).toBe(1000);
  });

  it('更新応答の長い文字列も伏せる', async () => {
    const config = { access_token: 'another-secret-99999' };
    mocks.getAdPlatformById.mockResolvedValue({ id: 'platform-1', line_account_id: 'a1' });
    mocks.updateAdPlatform.mockResolvedValue({
      id: 'platform-1', name: 'meta', display_name: 'Meta広告',
      config: JSON.stringify(config), is_active: 1,
      created_at: '2026-09-08T10:00:00.000', updated_at: '2026-09-08T11:00:00.000',
    });
    const response = await app.fetch(new Request('https://example.com/api/ad-platforms/platform-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config }),
    }), env);
    expect(response.status).toBe(200);
    const body = await response.json() as { data: { config: Record<string, unknown> } };
    expect(body.data.config.access_token).not.toContain('another-secret-99999');
  });
});
