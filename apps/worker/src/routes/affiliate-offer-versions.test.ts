import { describe, it, expect, vi, beforeEach } from 'vitest';

// Route-level test for the offer version endpoints (#823):
//   GET  /api/affiliate-offers/:id/versions
//   GET  /api/affiliate-offers/:id/cap-status
//   POST /api/affiliate-offers/:id/versions
// The db layer is mocked — real version/cap behaviour is covered against
// SQLite in packages/db/test/472_473_affiliate_rules.test.ts. Here we assert
// wiring, validation, serialization, permission (owner/admin only for POST),
// and the 404 for a missing offer.
const dbMocks = {
  getLineAccounts: vi.fn().mockResolvedValue([]),
  getLineAccountScopeEntries: vi.fn(async (...args: unknown[]) => dbMocks.getLineAccounts(...args)),
  getAccountSetting: vi.fn().mockResolvedValue(null),
  getVersionedAccountSetting: vi.fn().mockResolvedValue({
    version: 1,
    data: { features: { affiliates: true } },
  }),
  getStaffByApiKey: vi.fn(),
  getActiveImpersonation: vi.fn(async () => null),
  recoverStalledBroadcasts: vi.fn(),
  recoverStuckDeliveries: vi.fn(),
  // offer route deps
  createAffiliateOffer: vi.fn(),
  updateAffiliateOffer: vi.fn(),
  listAffiliateOffers: vi.fn(),
  getAffiliateOfferById: vi.fn(),
  createOfferVersion: vi.fn(),
  getCurrentOfferVersion: vi.fn(),
  listOfferVersions: vi.fn(),
  getOfferCapStatus: vi.fn(),
};
vi.mock('@line-crm/db', () => dbMocks);

const worker = (await import('../index.js')).default;

const API_KEY = 'test-owner-key';
const env = {
  DB: {} as D1Database,
  LINE_LOGIN_CHANNEL_ID: '2000000000',
  API_KEY,
  WORKER_URL: 'https://worker.example.com',
} as unknown as import('../index.js').Env['Bindings'];

function req(method: string, path: string, body?: unknown, apiKey = API_KEY) {
  const separator = path.includes('?') ? '&' : '?';
  const scopedPath = `${path}${separator}accountId=account-1`;
  const headers = new Headers({ Authorization: `Bearer ${apiKey}` });
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  return worker.fetch(
    new Request(`https://worker.example.com${scopedPath}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
    env,
    { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext,
  );
}

const OFFER_ROW = {
  id: 'off-1',
  name: '定期便',
  description: null,
  reward_amount: 1000,
  reward_miles: 50,
  mileage_program_id: 'default',
  line_account_id: 'account-1',
  tag_id: null,
  scenario_id: null,
  is_active: 1,
  created_at: '2026-09-01T00:00:00.000+09:00',
};

const VERSION_ROW = {
  id: 'ver-2',
  offer_id: 'off-1',
  version_number: 2,
  reward_amount: 2000,
  reward_miles: 50,
  window_days: 30,
  cap_total: 200,
  cap_monthly_per_affiliate: 10,
  reception_from: '2026-10-01T00:00:00.000+09:00',
  reception_to: '2026-12-31T23:59:59.000+09:00',
  effective_from: null,
  created_by_staff_id: 'staff-1',
  idempotency_key: null,
  created_at: '2026-09-27T00:00:00.000+09:00',
};

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getLineAccounts.mockResolvedValue([
    { id: 'account-1', tenant_id: '00000000-0000-4000-8000-000000000001' },
  ]);
  dbMocks.getAffiliateOfferById.mockResolvedValue(OFFER_ROW);
});

describe('GET /api/affiliate-offers/:id/versions', () => {
  it('returns versions newest-first with camelCase keys', async () => {
    dbMocks.listOfferVersions.mockResolvedValue([VERSION_ROW]);
    const res = await req('GET', '/api/affiliate-offers/off-1/versions');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: Array<Record<string, unknown>> };
    expect(body.success).toBe(true);
    expect(body.data[0]).toMatchObject({
      id: 'ver-2',
      offerId: 'off-1',
      versionNumber: 2,
      rewardAmount: 2000,
      windowDays: 30,
      capTotal: 200,
      capMonthlyPerAffiliate: 10,
    });
    expect(dbMocks.listOfferVersions).toHaveBeenCalledWith(expect.anything(), 'off-1');
  });

  it('returns 404 for an offer outside the visible scope', async () => {
    dbMocks.getAffiliateOfferById.mockResolvedValue(null);
    const res = await req('GET', '/api/affiliate-offers/hidden/versions');
    expect(res.status).toBe(404);
    expect(dbMocks.listOfferVersions).not.toHaveBeenCalled();
  });
});

describe('GET /api/affiliate-offers/:id/cap-status', () => {
  it('returns the current version with remaining caps', async () => {
    dbMocks.getCurrentOfferVersion.mockResolvedValue(VERSION_ROW);
    dbMocks.getOfferCapStatus.mockResolvedValue({
      capped: false,
      capTotal: 200,
      totalUsed: 162,
      totalRemaining: 38,
      capMonthlyPerAffiliate: 10,
      monthlyUsed: 3,
      monthlyRemaining: 7,
    });
    const res = await req('GET', '/api/affiliate-offers/off-1/cap-status?affiliateId=aff-1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: Record<string, unknown> };
    expect(body.data).toMatchObject({
      capped: false,
      totalUsed: 162,
      totalRemaining: 38,
      monthlyRemaining: 7,
    });
    expect((body.data.version as Record<string, unknown>).versionNumber).toBe(2);
    expect(dbMocks.getOfferCapStatus).toHaveBeenCalledWith(
      expect.anything(),
      'off-1',
      { affiliateId: 'aff-1' },
    );
  });
});

describe('POST /api/affiliate-offers/:id/versions', () => {
  it('saves a new version and returns 201', async () => {
    dbMocks.createOfferVersion.mockResolvedValue(VERSION_ROW);
    const res = await req('POST', '/api/affiliate-offers/off-1/versions', {
      rewardAmount: 2000,
      capTotal: 200,
      capMonthlyPerAffiliate: 10,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { success: boolean; data: Record<string, unknown> };
    expect(body.data).toMatchObject({ versionNumber: 2, rewardAmount: 2000 });
    expect(dbMocks.createOfferVersion).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ offerId: 'off-1', rewardAmount: 2000, capTotal: 200 }),
    );
  });

  it('rejects an out-of-range windowDays with 400', async () => {
    const res = await req('POST', '/api/affiliate-offers/off-1/versions', { windowDays: 400 });
    expect(res.status).toBe(400);
    expect(dbMocks.createOfferVersion).not.toHaveBeenCalled();
  });

  it('rejects a non-positive cap with 400', async () => {
    const res = await req('POST', '/api/affiliate-offers/off-1/versions', { capTotal: 0 });
    expect(res.status).toBe(400);
    expect(dbMocks.createOfferVersion).not.toHaveBeenCalled();
  });

  it('returns 404 for a missing offer', async () => {
    dbMocks.createOfferVersion.mockRejectedValue(new Error('offer not found'));
    const res = await req('POST', '/api/affiliate-offers/off-1/versions', { rewardAmount: 1 });
    expect(res.status).toBe(404);
  });

  it('refuses a non-admin writer with 403', async () => {
    dbMocks.getStaffByApiKey.mockResolvedValue({
      id: 'staff-1',
      name: '担当者',
      role: 'staff',
      access_level: 'full',
      permission_keys: '["/conversions"]',
    });
    const res = await req('POST', '/api/affiliate-offers/off-1/versions', { rewardAmount: 1 }, 'staff-key');
    expect(res.status).toBe(403);
    expect(dbMocks.createOfferVersion).not.toHaveBeenCalled();
  });
});
