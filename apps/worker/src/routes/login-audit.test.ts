import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const mocks = {
  getSupportMarks: vi.fn(),
  getSupportMarkById: vi.fn(),
  createSupportMark: vi.fn(),
  updateSupportMark: vi.fn(),
  deleteSupportMark: vi.fn(),
  replaceAndDeleteSupportMark: vi.fn(),
  getSupportMarkDeleteImpact: vi.fn(),
  deleteSupportMarkAtImpact: vi.fn(),
  countFriendsWithMark: vi.fn(),
  getDefaultSupportMark: vi.fn(),
  setFriendSupportMark: vi.fn(),
  setFriendSupportMarkBulk: vi.fn(),
  getSavedSearches: vi.fn(),
  getSavedSearchById: vi.fn(),
  createSavedSearch: vi.fn(),
  updateSavedSearch: vi.fn(),
  deleteSavedSearch: vi.fn(),
  countSavedSearches: vi.fn(),
  validateSearchConditions: () => ({ ok: true as const, value: {} }),
  SAVED_SEARCH_LIMIT: 50,
  SAVED_SEARCH_SCOPES: ['friends', 'chats', 'bookings'],
  getLoginAudit: vi.fn(),
  getStaffMembers: vi.fn(),
  LOGIN_AUDIT_ACTIONS: ['login', 'logout', 'fail', 'view_personal', 'export'],
  getFolders: vi.fn(),
  getFolderById: vi.fn(),
  createFolder: vi.fn(),
  updateFolder: vi.fn(),
  deleteFolder: vi.fn(),
  isFolderKind: () => true,
};
vi.mock('@line-crm/db', () => mocks);

const { friendAttributes } = await import('./friend-attributes.js');

function makeApp(role: 'owner' | 'admin' | 'staff') {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'u-1', name: 'テスト', role, readOnly: false });
    return next();
  });
  app.route('/', friendAttributes);
  return app;
}
const env = { DB: {} as D1Database };

function get(path: string, role: 'owner' | 'admin' | 'staff' = 'owner') {
  return makeApp(role).fetch(new Request(`https://example.com${path}`), env);
}

const ROW = {
  id: 'la-1',
  admin_user_id: 'u-1',
  action: 'login',
  screen: null,
  ip: '203.0.113.42',
  user_agent: 'test',
  result: 'ok',
  created_at: '2026-08-16T10:00:00.000',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getLoginAudit.mockResolvedValue([ROW]);
  mocks.getStaffMembers.mockResolvedValue([{ id: 'u-1', name: '山本', role: 'admin', access_level: 'full', line_user_id: 'line-1', is_active: 1 }]);
});

describe('ログイン履歴', () => {
  it('オーナーは見られる', async () => {
    const res = await get('/api/login-audit', 'owner');
    expect(res.status).toBe(200);
  });

  it('スタッフは見られない', async () => {
    // 誰がいつ入ったかは、それ自体が見せてよい情報とは限らない。
    const res = await get('/api/login-audit', 'staff');
    expect(res.status).toBe(403);
    expect(mocks.getLoginAudit).not.toHaveBeenCalled();
  });

  it('IPの末尾を伏せる', async () => {
    // 監査で見たいのは「いつもと違うところから入っていないか」で、
    // 完全な値は要らない。
    const res = await get('/api/login-audit');
    const body = (await res.json()) as { data: Array<{ ip: string }> };
    expect(body.data[0].ip).toBe('203.0.113.***');
  });

  it('IPv6も伏せる', async () => {
    mocks.getLoginAudit.mockResolvedValue([{ ...ROW, ip: '2001:db8:85a3:0:0:8a2e:370:7334' }]);
    const res = await get('/api/login-audit');
    const body = (await res.json()) as { data: Array<{ ip: string }> };
    expect(body.data[0].ip).toBe('2001:db8:85a3:***');
  });

  it('IPが無ければ null のまま', async () => {
    mocks.getLoginAudit.mockResolvedValue([{ ...ROW, ip: null }]);
    const res = await get('/api/login-audit');
    const body = (await res.json()) as { data: Array<{ ip: string | null }> };
    expect(body.data[0].ip).toBeNull();
  });

  it('接続元はIPと短縮したUser-Agentを返す', async () => {
    const res = await get('/api/login-audit');
    const body = (await res.json()) as { data: Array<Record<string, unknown>> };
    expect(body.data[0].connectionSource).toBe('203.0.113.*** / test');
  });

  it('知らない操作での絞り込みは無視する', async () => {
    await get('/api/login-audit?action=telepathy');
    expect(mocks.getLoginAudit).toHaveBeenCalledWith(
      env.DB,
      expect.objectContaining({ action: undefined }),
    );
  });

  it('操作で絞れる', async () => {
    await get('/api/login-audit?action=view_personal');
    expect(mocks.getLoginAudit).toHaveBeenCalledWith(
      env.DB,
      expect.objectContaining({ action: 'view_personal' }),
    );
  });
});
