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
    DB: {} as D1Database,
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

// The liveness endpoints are what `create-line-harness update` and the
// self-update verify phase probe after a deploy — they must answer 200
// with no credentials, or every update ends in a bogus health warning
// (CLI) or rollback (self-update).
describe('liveness endpoints are public', () => {
  test.each(['/health', '/api/health'])('GET %s → 200 without credentials', async (path) => {
    const res = await app().request(path, {}, env());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: { status: string } };
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('ok');
  });
});

describe('account health stays auth-guarded', () => {
  test('GET /api/accounts/:id/health without credentials → 401', async () => {
    const res = await app().request('/api/accounts/a1/health', {}, env());
    expect(res.status).toBe(401);
  });

  test('GET /api/accounts/health-summary without credentials → 401', async () => {
    const res = await app().request('/api/accounts/health-summary', {}, env());
    expect(res.status).toBe(401);
  });
});

describe('GET /api/accounts/health-summary', () => {
  test('staff可視範囲だけを1回で数え、ログ本文を返さない', async () => {
    const db = await import('@line-crm/db');
    const access = await import('../services/account-access.js');
    vi.mocked(access.getVisibleLineAccountScope).mockResolvedValue({
      accounts: [],
      allowedAccountIds: ['a1', 'a2'],
      canSeeUnassigned: false,
      ids: ['a1', 'a2'],
      isAccountScoped: true,
    });
    vi.mocked(db.getLatestRiskLevels).mockResolvedValue([
      { line_account_id: 'a1', risk_level: 'danger' },
      // 範囲外の行が混ざっても数えない。
      { line_account_id: 'a9', risk_level: 'warning' },
    ]);

    const res = await app().request(
      '/api/accounts/health-summary',
      { headers: { Authorization: 'Bearer env-key' } },
      env(),
    );
    expect(res.status).toBe(200);
    expect(db.getLatestRiskLevels).toHaveBeenCalledWith(expect.anything(), ['a1', 'a2']);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        items: Array<{ lineAccountId: string; riskLevel: string | null }>;
        warningCount: number;
        dangerCount: number;
      };
    };
    expect(body.success).toBe(true);
    // a2 は記録なし → null で並ぶ。a9 は範囲外なので出ない。
    expect(body.data.items).toEqual([
      { lineAccountId: 'a1', riskLevel: 'danger' },
      { lineAccountId: 'a2', riskLevel: null },
    ]);
    expect(body.data.warningCount).toBe(0);
    expect(body.data.dangerCount).toBe(1);
    // ログ本文なし = logs という鍵を持たない。
    expect(JSON.stringify(body)).not.toContain('"logs"');
  });
});
