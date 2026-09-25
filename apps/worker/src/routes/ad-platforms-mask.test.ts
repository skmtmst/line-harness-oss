import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const mocks = {
  createAdPlatform: vi.fn(),
  updateAdPlatformCAS: vi.fn(),
  getAdPlatformById: vi.fn(),
};
// 秘密の扱い（検証・分割・暗号化）は本物を使い、DBの読み書きだけ差し替える。
// 形だけのモックにすると、応答に秘密が混ざるか検証できないため。
vi.mock('@line-crm/db', async () => {
  const actual = await vi.importActual<typeof import('@line-crm/db')>('@line-crm/db');
  return { ...actual, ...mocks };
});
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
const env = {
  DB: {} as D1Database,
  LINE_CREDENTIAL_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
} as unknown as Env['Bindings'];

beforeEach(() => vi.clearAllMocks());

// #514-18: 書き込み応答で秘密が漏れないこと。秘密は応答に出さず、
// 設定済みの鍵名だけ出す（部分マスクは前後4文字が漏れるためやめた）。
describe('POST/PUT /api/ad-platforms の応答マスク', () => {
  it('作成応答に秘密値は出さず、数値はそのまま返す', async () => {
    const config = { access_token: 'secret-token-12345', monthly_cost: 1000 };
    mocks.createAdPlatform.mockImplementation(async (_db: unknown, input: Record<string, unknown>) => ({
      id: 'platform-1', name: 'meta', display_name: 'Meta広告',
      config: JSON.stringify(input.config), config_encrypted: input.configEncrypted ?? null,
      is_active: 0, verified_at: null, line_account_id: 'a1',
      created_at: '2026-09-08T10:00:00.000', updated_at: '2026-09-08T10:00:00.000',
    }));
    const response = await app.fetch(new Request('https://example.com/api/ad-platforms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'meta', config, lineAccountId: 'a1' }),
    }), env);
    expect(response.status).toBe(201);
    // DBへ渡る時点で秘密は平文JSONから外れている。
    const saved = mocks.createAdPlatform.mock.calls[0][1] as Record<string, unknown>;
    expect(JSON.stringify(saved.config)).not.toContain('secret-token-12345');
    expect(saved.configEncrypted).toBeTruthy();
    const body = await response.json() as { data: { config: Record<string, unknown>; secretKeys: string[] } };
    expect(JSON.stringify(body.data.config)).not.toContain('secret-token-12345');
    expect(body.data.config.monthly_cost).toBe(1000);
    expect(body.data.secretKeys).toContain('access_token');
  });

  it('更新応答にも秘密値は出さない', async () => {
    const config = { access_token: 'another-secret-99999' };
    mocks.getAdPlatformById.mockResolvedValue({
      id: 'platform-1', name: 'meta', line_account_id: 'a1',
      config: '{}', config_encrypted: null, is_active: 0, verified_at: null,
    });
    mocks.updateAdPlatformCAS.mockImplementation(
      async (_db: unknown, _id: string, _scope: unknown, input: Record<string, unknown>) => ({
        applied: true,
        platform: {
          id: 'platform-1', name: 'meta', display_name: 'Meta広告',
          config: JSON.stringify(input.config), config_encrypted: input.configEncrypted ?? null,
          is_active: 0, verified_at: null, line_account_id: 'a1',
          created_at: '2026-09-08T10:00:00.000', updated_at: '2026-09-08T11:00:00.000',
        },
      }),
    );
    const response = await app.fetch(new Request('https://example.com/api/ad-platforms/platform-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config }),
    }), env);
    expect(response.status).toBe(200);
    const body = await response.json() as { data: { config: Record<string, unknown>; secretKeys: string[] } };
    expect(JSON.stringify(body.data)).not.toContain('another-secret-99999');
    expect(body.data.secretKeys).toContain('access_token');
  });
});
