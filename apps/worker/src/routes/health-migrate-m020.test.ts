import { describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.js';
import { health } from './health.js';
import type { Env } from '../index.js';

vi.mock('@line-crm/db', () => ({
  getStaffByApiKey: vi.fn(async () => null),
  getAccountHealthLogs: vi.fn(async () => []),
  getLatestRiskLevel: vi.fn(async () => null),
  getLatestRiskLevels: vi.fn(async () => []),
  getAccountMigrations: vi.fn(async () => []),
  getAccountMigrationById: vi.fn(async () => null),
  createAccountMigration: vi.fn(),
  updateAccountMigration: vi.fn(),
}));

vi.mock('../services/account-access.js', () => ({
  getVisibleLineAccountScope: vi.fn(async () => ({
    accounts: [],
    allowedAccountIds: [],
    canSeeUnassigned: false,
    ids: [],
    isAccountScoped: true,
  })),
}));

function env(): Env['Bindings'] {
  return {
    DB: {
      prepare: () => ({ first: async () => ({ count: 0 }) }),
    } as unknown as D1Database,
    IMAGES: {} as R2Bucket,
    RAW_MAIL: {} as R2Bucket,
    ASSETS: {} as Fetcher,
    LINE_CHANNEL_SECRET: 'secret',
    LINE_CHANNEL_ACCESS_TOKEN: 'line-token',
    API_KEY: 'env-key',
    LIFF_URL: 'https://liff.example.test',
    LINE_CHANNEL_ID: 'line-channel',
    LINE_LOGIN_CHANNEL_ID: 'login-channel',
    LINE_LOGIN_CHANNEL_SECRET: 'login-secret',
    WORKER_URL: 'https://worker.example.test',
  };
}

function app() {
  const a = new Hono<Env>();
  a.use('*', authMiddleware);
  a.route('/', health);
  return a;
}

function postMigrate(fromAccountId: string, body: unknown) {
  return app().request(`/api/accounts/${fromAccountId}/migrate`, {
    method: 'POST',
    headers: { Authorization: 'Bearer env-key', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, env());
}

/**
 * M020：存在しないアカウントの移行が 201 で作られる。
 * 移行前に移行元の有無を見て、存在しないときは 404 にして作らない。
 */
describe('M020 存在しない移行元の移行は作らない', () => {
  test('範囲に無い移行元 → 404 で、行を作らない', async () => {
    const db = await import('@line-crm/db');
    const res = await postMigrate('ghost-account', { toAccountId: 'a2' });
    expect(res.status).toBe(404);
    expect(vi.mocked(db.createAccountMigration)).not.toHaveBeenCalled();
  });

  test('範囲内の移行元 → 201 で作る', async () => {
    const db = await import('@line-crm/db');
    const access = await import('../services/account-access.js');
    vi.mocked(access.getVisibleLineAccountScope).mockResolvedValue({
      accounts: [],
      allowedAccountIds: ['a1', 'a2'],
      canSeeUnassigned: false,
      ids: ['a1', 'a2'],
      isAccountScoped: true,
    });
    vi.mocked(db.createAccountMigration).mockResolvedValue({
      id: 'mig-1',
      from_account_id: 'a1',
      to_account_id: 'a2',
      status: 'pending',
      migrated_count: 0,
      total_count: 0,
      created_at: '2026-09-29T00:00:00.000+09:00',
      completed_at: null,
    });
    vi.mocked(db.updateAccountMigration).mockResolvedValue(undefined);
    const res = await postMigrate('a1', { toAccountId: 'a2' });
    expect(res.status).toBe(201);
    expect(vi.mocked(db.createAccountMigration)).toHaveBeenCalled();
  });
});
