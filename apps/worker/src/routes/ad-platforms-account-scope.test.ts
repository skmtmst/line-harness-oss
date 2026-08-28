import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const dbMocks = vi.hoisted(() => ({
  getAdPlatforms: vi.fn(),
  getAdPlatformById: vi.fn(),
  createAdPlatform: vi.fn(),
  updateAdPlatform: vi.fn(),
  deleteAdPlatform: vi.fn(),
  getAdConversionLogs: vi.fn(),
  getAdPlatformByName: vi.fn(),
}));
const accessMocks = vi.hoisted(() => ({
  canAccess: vi.fn(),
}));

vi.mock('@line-crm/db', () => dbMocks);
vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: accessMocks.canAccess,
}));
vi.mock('../services/ad-conversion.js', () => ({
  sendAdConversions: vi.fn(),
}));

const { adPlatforms } = await import('./ad-platforms.js');

function makeApp() {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', {
      id: 'owner', name: 'Owner', role: 'owner', readOnly: false, tenantId: 'tenant-a',
    });
    await next();
  });
  app.route('/', adPlatforms);
  return app;
}

const env = { DB: {} as D1Database } as Env['Bindings'];

beforeEach(() => {
  vi.clearAllMocks();
  accessMocks.canAccess.mockResolvedValue(true);
  dbMocks.getAdPlatforms.mockResolvedValue([]);
});

describe('広告接続のLINEアカウント境界', () => {
  it('選択中アカウントが無い一覧要求をDBへ流さない', async () => {
    const response = await makeApp().request('/api/ad-platforms', {}, env);

    expect(response.status).toBe(400);
    expect(dbMocks.getAdPlatforms).not.toHaveBeenCalled();
  });

  it('権限の無いアカウントを拒否する', async () => {
    accessMocks.canAccess.mockResolvedValue(false);
    const response = await makeApp().request(
      '/api/ad-platforms?lineAccountId=account-b',
      {},
      env,
    );

    expect(response.status).toBe(403);
    expect(dbMocks.getAdPlatforms).not.toHaveBeenCalled();
  });

  it('一覧と履歴を同じ選択中アカウントへ限定する', async () => {
    const app = makeApp();
    const listResponse = await app.request(
      '/api/ad-platforms?lineAccountId=account-a',
      {},
      env,
    );
    expect(listResponse.status).toBe(200);
    expect(dbMocks.getAdPlatforms).toHaveBeenCalledWith(env.DB, 'account-a');

    dbMocks.getAdPlatformById.mockResolvedValue({ id: 'platform-a' });
    dbMocks.getAdConversionLogs.mockResolvedValue([]);
    const logsResponse = await app.request(
      '/api/ad-platforms/platform-a/logs?lineAccountId=account-a&limit=20',
      {},
      env,
    );
    expect(logsResponse.status).toBe(200);
    expect(dbMocks.getAdPlatformById).toHaveBeenCalledWith(env.DB, 'platform-a', 'account-a');
    expect(dbMocks.getAdConversionLogs).toHaveBeenCalledWith(
      env.DB,
      'platform-a',
      'account-a',
      20,
    );
  });

  it('別アカウントの接続IDを404として扱う', async () => {
    dbMocks.getAdPlatformById.mockResolvedValue(null);
    const response = await makeApp().request(
      '/api/ad-platforms/platform-b/logs?lineAccountId=account-a',
      {},
      env,
    );

    expect(response.status).toBe(404);
    expect(dbMocks.getAdConversionLogs).not.toHaveBeenCalled();
  });
});
