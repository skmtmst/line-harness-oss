import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const mocks = vi.hoisted(() => ({
  getAccountSetting: vi.fn(),
  getVersionedAccountSetting: vi.fn(),
  getVisibleLineAccountScope: vi.fn(),
}));

vi.mock('@line-crm/db', async (importOriginal) => ({
  ...await importOriginal<typeof import('@line-crm/db')>(),
  getAccountSetting: mocks.getAccountSetting,
  getVersionedAccountSetting: mocks.getVersionedAccountSetting,
}));

vi.mock('../services/account-access.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../services/account-access.js')>(),
  getVisibleLineAccountScope: mocks.getVisibleLineAccountScope,
}));

import { featureEnforcementMiddleware } from './feature-enforcement.js';

function testApp(handler = vi.fn((c) => c.json({ success: true }))) {
  const app = new Hono<Env>();
  app.use('/api/*', async (c, next) => {
    c.set('staff', {
      id: 'staff-1', name: '管理者', role: 'owner', readOnly: false,
      assignedLineAccountId: null, canAccessDescendantAccounts: true,
    });
    await next();
  });
  app.use('/api/*', featureEnforcementMiddleware);
  app.get('/api/webinars', handler);
  app.post('/api/webinars', handler);
  app.get('/api/settings/features', handler);
  app.get('/api/not-in-manifest', handler);
  return { app, handler };
}

const env = { DB: {} as D1Database } as Env['Bindings'];

describe('featureEnforcementMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getVersionedAccountSetting.mockResolvedValue(null);
    mocks.getVisibleLineAccountScope.mockResolvedValue({ ids: ['account-1'], all: true });
  });

  test('会社設定がオフなら handler を実行せず 403 + FEATURE_DISABLED を返す', async () => {
    mocks.getAccountSetting.mockResolvedValue(JSON.stringify({ enabled: false }));
    const { app, handler } = testApp();
    const response = await app.request('/api/webinars?account_id=account-1', {}, env);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      success: false,
      error: 'この機能は設定でオフになっています',
      code: 'FEATURE_DISABLED',
      featureId: 'webinars',
    });
    expect(handler).not.toHaveBeenCalled();
  });

  test('会社設定がオンなら従来の handler と入力契約へ進む', async () => {
    mocks.getVersionedAccountSetting.mockResolvedValue({
      version: 2,
      data: { features: { webinars: true } },
    });
    const handler = vi.fn((c) => c.json({ success: false, code: 'CONTRACT_ERROR' }, 422));
    const { app } = testApp(handler);
    const response = await app.request('/api/webinars?accountId=account-1', {}, env);

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ success: false, code: 'CONTRACT_ERROR' });
    expect(handler).toHaveBeenCalledOnce();
  });

  test('機能付き管理 API の account 未指定を既定値へ寄せない', async () => {
    mocks.getVisibleLineAccountScope.mockResolvedValue({ ids: ['account-1', 'account-2'], all: true });
    const { app, handler } = testApp();
    const response = await app.request('/api/webinars', { method: 'POST' }, env);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'LINE_ACCOUNT_REQUIRED' });
    expect(handler).not.toHaveBeenCalled();
  });

  test('複数 account の GET 一覧はオフ分を可視範囲から除き meta に件数を返す', async () => {
    mocks.getVisibleLineAccountScope.mockResolvedValue({
      ids: ['account-1', 'account-2'],
      allowedAccountIds: ['account-1', 'account-2'],
      accounts: [],
      canSeeUnassigned: false,
      isAccountScoped: false,
    });
    mocks.getAccountSetting.mockImplementation(async (_db, accountId) => (
      accountId === 'account-1' ? '{"enabled":true}' : '{"enabled":false}'
    ));
    const handler = vi.fn((c) => c.json({
      success: true,
      data: c.get('staff').featureEnabledLineAccountIds,
    }));
    const { app } = testApp(handler);
    const response = await app.request('/api/webinars', {}, env);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: ['account-1'],
      meta: { featureDisabledAccounts: 1 },
    });
  });

  test('core API は機能設定に関係なく従来処理へ進む', async () => {
    const { app, handler } = testApp();
    const response = await app.request('/api/settings/features', {}, env);

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
    expect(mocks.getAccountSetting).not.toHaveBeenCalled();
  });

  test('manifest 完成後の未知管理 API は runtime でも fail closed', async () => {
    const { app, handler } = testApp();
    const response = await app.request('/api/not-in-manifest', {}, env);

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ code: 'ROUTE_FEATURE_UNCLASSIFIED' });
    expect(handler).not.toHaveBeenCalled();
  });
});
