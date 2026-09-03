import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../index.js';

const dbMocks = {
  getAffiliates: vi.fn(),
  getAffiliateById: vi.fn(),
  getAffiliateByCode: vi.fn(),
  createAffiliate: vi.fn(),
  createAffiliateWithRandomCode: vi.fn(),
  createAffiliateLink: vi.fn(),
  updateAffiliate: vi.fn(),
  recordAffiliateClick: vi.fn(),
  getAffiliateReport: vi.fn(),
  getAffiliateReportV2: vi.fn(),
  getFriendById: vi.fn(),
  getFriendJourney: vi.fn(),
  getAffiliateByFriendId: vi.fn(),
  getAffiliateJourneys: vi.fn(),
  getAffiliatePaymentSummaries: vi.fn(),
  listAffiliateLinks: vi.fn(),
  listAffiliateOffers: vi.fn(),
};
const accountAccess = { getVisibleLineAccountScope: vi.fn() };

vi.mock('@line-crm/db', () => dbMocks);
vi.mock('../services/account-access.js', () => accountAccess);

const { affiliates } = await import('./affiliates.js');

function makeApp(role: 'owner' | 'admin' | 'staff' = 'owner') {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'staff-1', name: '担当', role, readOnly: false, tenantId: 'tenant-1' });
    return next();
  });
  app.route('/', affiliates);
  return app;
}

const env = { DB: {} as D1Database };

function get(path: string, role?: 'owner' | 'admin' | 'staff') {
  return makeApp(role).fetch(new Request(`https://example.com${path}`), env);
}

beforeEach(() => {
  vi.clearAllMocks();
  accountAccess.getVisibleLineAccountScope.mockResolvedValue({
    accounts: [{ id: 'account-1' }],
    allowedAccountIds: ['account-1'],
    canSeeUnassigned: false,
    ids: ['account-1'],
  });
  dbMocks.getAffiliatePaymentSummaries.mockResolvedValue([{ affiliateId: 'affiliate-1' }]);
});

describe('GET /api/affiliate-payments', () => {
  it('選択中アカウントを再認可して支払い集計を返す', async () => {
    const res = await get('/api/affiliate-payments?lineAccountId=account-1');
    expect(res.status).toBe(200);
    expect(dbMocks.getAffiliatePaymentSummaries).toHaveBeenCalledWith(env.DB, 'account-1');
    expect(await res.json()).toMatchObject({
      success: true,
      data: [{ affiliateId: 'affiliate-1' }],
      limitations: { payoutHistory: false, bankDestination: false, settlementSchedule: false },
    });
  });

  it('アカウント未選択と閲覧範囲外を空配列にしない', async () => {
    expect((await get('/api/affiliate-payments')).status).toBe(400);
    expect((await get('/api/affiliate-payments?lineAccountId=account-2')).status).toBe(404);
    expect(dbMocks.getAffiliatePaymentSummaries).not.toHaveBeenCalled();
  });

  it('スタッフ権限では閲覧できない', async () => {
    const res = await get('/api/affiliate-payments?lineAccountId=account-1', 'staff');
    expect(res.status).toBe(403);
    expect(dbMocks.getAffiliatePaymentSummaries).not.toHaveBeenCalled();
  });

  it('取得失敗を0件として返さない', async () => {
    dbMocks.getAffiliatePaymentSummaries.mockRejectedValue(new Error('db unavailable'));
    const res = await get('/api/affiliate-payments?lineAccountId=account-1');
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ success: false });
  });
});
