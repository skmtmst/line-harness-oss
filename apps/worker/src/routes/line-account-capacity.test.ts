import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const mocks = {
  getLineAccounts: vi.fn(),
  getLineAccountById: vi.fn(),
  createLineAccount: vi.fn(),
  updateLineAccount: vi.fn(),
  updateLineAccountFields: vi.fn(),
  updateLineAccountOrder: vi.fn(),
  deleteUncommittedLineAccount: vi.fn(),
  getLineAccountArchiveBlockers: vi.fn(),
  setDefaultLineAccount: vi.fn(),
  archiveLineAccount: vi.fn(),
  restoreLineAccount: vi.fn(),
  countFriendsByLineAccount: vi.fn(),
  getStaffById: vi.fn(),
  getStaffAccountScopeIds: vi.fn(),
};
vi.mock('@line-crm/db', () => mocks);

const { lineAccounts } = await import('./line-accounts.js');
const app = new Hono<Env>();
app.use('*', async (c, next) => {
  c.set('staff', { id: 'owner-1', name: 'Owner', role: 'owner', readOnly: false });
  return next();
});
app.route('/', lineAccounts);
const env = { DB: {} as D1Database };

const ACCOUNT = {
  id: 'acc-1',
  channel_id: 'c1',
  name: 'A店',
  channel_access_token: 'tok',
  channel_secret: 'sec',
  login_channel_id: null,
  login_channel_secret: null,
  liff_id: null,
  is_active: 1,
  country: null,
  role: null,
  display_order: 0,
  token_expires_at: null,
  og_site_name: null,
  og_default_image_url: null,
  og_default_description: null,
  friend_capacity: null,
  capacity_warn_at: null,
  icon_url: null,
  created_at: '2026-08-16',
  updated_at: '2026-08-16',
};

function patch(body: unknown) {
  return app.fetch(
    new Request('https://example.com/api/line-accounts/acc-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    env,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getLineAccounts.mockResolvedValue([{ ...ACCOUNT, parent_line_account_id: null }]);
  mocks.getStaffById.mockResolvedValue({ account_scope: 'all' });
  mocks.getStaffAccountScopeIds.mockResolvedValue([]);
  mocks.getLineAccountById.mockResolvedValue(ACCOUNT);
  mocks.updateLineAccountFields.mockResolvedValue(ACCOUNT);
  mocks.updateLineAccount.mockResolvedValue(ACCOUNT);
});

describe('友だち数の上限', () => {
  it('上限と警告値を保存できる', async () => {
    const res = await patch({ friendCapacity: 50000, capacityWarnAt: 45000 });
    expect(res.status).toBe(200);
    expect(mocks.updateLineAccountFields).toHaveBeenCalledWith(
      env.DB,
      'acc-1',
      expect.objectContaining({ friendCapacity: 50000, capacityWarnAt: 45000 }),
    );
  });

  it('警告値が上限を超えていたら弾く', async () => {
    // 超えた値は永久に鳴らない。設定したつもりで一度も警告が出ない、
    // という壊れ方をする。
    const res = await patch({ friendCapacity: 1000, capacityWarnAt: 2000 });
    expect(res.status).toBe(400);
    expect(mocks.updateLineAccountFields).not.toHaveBeenCalled();
  });

  it('上限だけを下げたとき、既存の警告値と突き合わせる', async () => {
    mocks.getLineAccountById.mockResolvedValue({
      ...ACCOUNT,
      friend_capacity: 50000,
      capacity_warn_at: 45000,
    });
    const res = await patch({ friendCapacity: 10000 });
    expect(res.status).toBe(400);
  });

  it('空文字は「管理しない」に戻す', async () => {
    const res = await patch({ friendCapacity: '', capacityWarnAt: '' });
    expect(res.status).toBe(200);
    expect(mocks.updateLineAccountFields).toHaveBeenCalledWith(
      env.DB,
      'acc-1',
      expect.objectContaining({ friendCapacity: null, capacityWarnAt: null }),
    );
  });

  it('0 や小数は弾く', async () => {
    expect((await patch({ friendCapacity: 0 })).status).toBe(400);
    expect((await patch({ friendCapacity: 1.5 })).status).toBe(400);
  });

  it('上限に触れないリクエストでもアーカイブ・既定状態を検査する', async () => {
    // ライフサイクル制約を守るため、更新前の状態を1回だけ確認する。
    await patch({ isActive: false });
    expect(mocks.getLineAccountById).toHaveBeenCalledTimes(1);
  });
});

describe('アイコン', () => {
  it('保存できる', async () => {
    await patch({ iconUrl: 'https://example.com/icon.png' });
    expect(mocks.updateLineAccountFields).toHaveBeenCalledWith(
      env.DB,
      'acc-1',
      expect.objectContaining({ iconUrl: 'https://example.com/icon.png' }),
    );
  });

  it('空文字で未設定に戻す', async () => {
    await patch({ iconUrl: '' });
    expect(mocks.updateLineAccountFields).toHaveBeenCalledWith(
      env.DB,
      'acc-1',
      expect.objectContaining({ iconUrl: null }),
    );
  });
});

describe('レスポンスの中身', () => {
  it('上限とアイコンは鍵ではないので、そのまま返る', async () => {
    // channel_secret などとは違い、役割で隠す必要がない。
    mocks.updateLineAccountFields.mockResolvedValue({
      ...ACCOUNT,
      friend_capacity: 50000,
      capacity_warn_at: 45000,
      icon_url: 'https://e/i.png',
    });
    const res = await patch({ friendCapacity: 50000, capacityWarnAt: 45000 });
    const body = (await res.json()) as {
      data: { friendCapacity: number; capacityWarnAt: number; iconUrl: string };
    };
    expect(body.data).toMatchObject({
      friendCapacity: 50000,
      capacityWarnAt: 45000,
      iconUrl: 'https://e/i.png',
    });
  });

  it('鍵は含めない', async () => {
    const res = await patch({ iconUrl: 'https://e/i.png' });
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data).not.toHaveProperty('channelSecret');
    expect(body.data).not.toHaveProperty('channelAccessToken');
  });
});
