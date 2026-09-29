import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../index.js';

// #554 点検#505中9: 紹介者の成績・動線の参照に権限検査を付ける。
// owner・admin は素通し、staff は鍵 affiliate.report.view が要る。
// db 層はモックし、鍵の有無とアカウント範囲の振る舞いだけ確かめる。
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
  getAffiliateArchiveImpact: vi.fn(),
  updateAffiliateLifecycle: vi.fn(),
  previewAffiliateSettlement: vi.fn(),
  confirmAffiliateSettlement: vi.fn(),
  listAffiliateLinks: vi.fn(),
  listAffiliateOffers: vi.fn().mockResolvedValue([]),
};
const accountAccess = { getVisibleLineAccountScope: vi.fn() };

vi.mock('@line-crm/db', () => dbMocks);
vi.mock('../services/account-access.js', () => accountAccess);

const { affiliates } = await import('./affiliates.js');

function app(role: 'owner' | 'admin' | 'staff' = 'owner', permissionKeys: string[] = []) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', {
      id: 'staff-1', name: '担当', role, readOnly: false,
      tenantId: 'tenant-1', permissionKeys,
    });
    await next();
  });
  instance.route('/', affiliates);
  return instance;
}

function request(
  path: string,
  options: { role?: 'owner' | 'admin' | 'staff'; permissions?: string[] } = {},
) {
  return app(options.role, options.permissions).fetch(
    new Request(`https://example.com${path}`),
    { DB: {} } as unknown as Env['Bindings'],
  );
}

const AFFILIATE_ROW = { id: 'aff-1', line_account_id: 'account-1' };

beforeEach(() => {
  vi.clearAllMocks();
  accountAccess.getVisibleLineAccountScope.mockResolvedValue({
    allowedAccountIds: ['account-1'], canSeeUnassigned: false,
  });
  dbMocks.getAffiliateById.mockResolvedValue(AFFILIATE_ROW);
  dbMocks.getAffiliateReportV2.mockResolvedValue({ affiliateId: 'aff-1' });
  dbMocks.getAffiliateJourneys.mockResolvedValue({ items: [], nextCursor: null });
  dbMocks.listAffiliateLinks.mockResolvedValue([]);
});

describe('紹介者の成績・動線の参照権限', () => {
  it.each(['/api/affiliates/aff-1/report', '/api/affiliates/aff-1/journeys', '/api/affiliates/aff-1/links'])(
    '%s は鍵のないstaffに403を返す', async (path) => {
      expect((await request(path, { role: 'staff' })).status).toBe(403);
    },
  );

  it.each(['/api/affiliates/aff-1/report', '/api/affiliates/aff-1/journeys', '/api/affiliates/aff-1/links'])(
    '%s は affiliate.report.view の鍵で見られる', async (path) => {
      const res = await request(path, { role: 'staff', permissions: ['affiliate.report.view'] });
      expect(res.status).toBe(200);
    },
  );

  it('範囲外のアカウントは鍵があっても存在を明かさない', async () => {
    dbMocks.getAffiliateById.mockResolvedValue(null);
    const res = await request('/api/affiliates/aff-1/report', {
      role: 'staff', permissions: ['affiliate.report.view'],
    });
    expect(res.status).toBe(404);
  });
});
