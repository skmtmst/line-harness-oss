import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@line-crm/db', () => ({
  getLineAccountById: vi.fn().mockResolvedValue({
    id: 'acc-1', channel_id: '2011', name: 'TEST',
    channel_access_token: 'SECRET-TOKEN', channel_secret: 'SECRET-CHANNEL',
    login_channel_secret: 'SECRET-LOGIN',
    is_active: 1, country: 'JP', role: 'main', display_order: 0,
    created_at: '2026-08-15', updated_at: '2026-08-15',
  }),
  getLineAccounts: vi.fn().mockResolvedValue([{ id: 'acc-1', parent_line_account_id: null }]),
  getStaffById: vi.fn().mockResolvedValue({ account_scope: 'all' }),
  getStaffAccountScopeIds: vi.fn().mockResolvedValue([]),
  getLineAccountArchiveBlockers: vi.fn().mockResolvedValue([]),
  setDefaultLineAccount: vi.fn(),
  archiveLineAccount: vi.fn(),
  restoreLineAccount: vi.fn(),
  jstNow: () => '2026-08-15T00:00:00+09:00',
}));

import type { Env } from '../index.js';
import { lineAccounts } from './line-accounts.js';

/**
 * チャネルの鍵は「見えること自体が権限」。
 * 閲覧のみの人には、役割にかかわらずレスポンスへ含めない。
 * 画面で隠すだけでは API を直接叩けば取得できてしまう。
 */

type Role = 'owner' | 'admin' | 'staff';

async function fetchAccount(role: Role, readOnly: boolean) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 's1', name: 'N', role, readOnly });
    return next();
  });
  app.route('/', lineAccounts);
  const res = await app.request('/api/line-accounts/acc-1', {}, { DB: {} } as never);
  const body = (await res.json()) as { data: Record<string, unknown> };
  return body.data;
}

describe('GET /api/line-accounts/:id — 保存済み資格情報を返さない', () => {
  it('オーナーと管理者にも値を返さず、設定済みだけ返す', async () => {
    for (const role of ['owner', 'admin'] as const) {
      const data = await fetchAccount(role, false);
      expect(data.channelAccessToken, role).toBeUndefined();
      expect(data.channelSecret, role).toBeUndefined();
      expect(data.loginChannelSecret, role).toBeUndefined();
      expect(data.channelAccessTokenConfigured, role).toBe(true);
      expect(data.channelSecretConfigured, role).toBe(true);
      expect(data.loginChannelSecretConfigured, role).toBe(true);
    }
  });

  it('スタッフには鍵を返さない', async () => {
    const data = await fetchAccount('staff', false);
    expect(data.channelAccessToken).toBeUndefined();
    expect(data.channelSecret).toBeUndefined();
    expect(data.loginChannelSecret).toBeUndefined();
    expect(data.channelAccessTokenConfigured).toBe(true);
  });

  it('閲覧のみなら、オーナーでも鍵を返さない', async () => {
    // 役割と読み取り専用を分けた結果、ここを明示しないと
    // 「閲覧のみのオーナー」に鍵が渡ってしまう。
    for (const role of ['owner', 'admin', 'staff'] as const) {
      const data = await fetchAccount(role, true);
      expect(data.channelAccessToken, role).toBeUndefined();
      expect(data.channelSecret, role).toBeUndefined();
      expect(data.loginChannelSecret, role).toBeUndefined();
    }
  });

  it('鍵以外の情報は誰でも見られる', async () => {
    const data = await fetchAccount('staff', true);
    expect(data.id).toBe('acc-1');
    expect(data.name).toBe('TEST');
  });
});
