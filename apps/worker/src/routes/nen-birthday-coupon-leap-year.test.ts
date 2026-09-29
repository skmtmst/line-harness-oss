import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

/*
 * 419: NEN誕生日クーポンの2月29日生まれの扱い（3択）を
 * GET/PUT で往復させ、壊れた値・省略時の既存値保護を確かめる。
 */

const mocks = vi.hoisted(() => ({
  canAccess: vi.fn(),
  getCoupon: vi.fn(),
  saveCoupon: vi.fn(),
}));

vi.mock('../services/account-access.js', () => ({ canAccessAllLineAccounts: mocks.canAccess }));
vi.mock('@line-crm/db', () => ({
  getLineAccountById: vi.fn(),
  jstNow: vi.fn(() => '2026-09-12 12:00:00'),
}));
vi.mock('../services/nen-engagement.js', () => ({
  buildDefaultColumnIntro: vi.fn(),
  buildNenDeliveryMessages: vi.fn(),
  getNenCampaign: vi.fn(),
  queueColumnDelivery: vi.fn(),
  saveNenCampaignAccountSetting: vi.fn(),
  getNenBirthdayCouponSetting: mocks.getCoupon,
  saveNenBirthdayCouponSetting: mocks.saveCoupon,
}));
vi.mock('../services/nen-tag-sync.js', () => ({ syncNenPetTags: vi.fn() }));
vi.mock('../services/line-proxy-send.js', () => ({ pushViaHarnessProxy: vi.fn() }));
vi.mock('../services/local-line-proxy.js', () => ({ dispatchLineProxyLocally: vi.fn() }));

const { nenCampaigns } = await import('./nen-campaigns.js');

function app() {
  const instance = new Hono<{ Bindings: { DB: D1Database } }>();
  instance.use('*', async (c, next) => {
    c.env = { DB: { prepare: vi.fn() } as unknown as D1Database };
    c.set('staff' as never, { id: 'owner', role: 'owner', tenantId: 'tenant-a' } as never);
    await next();
  });
  instance.route('/', nenCampaigns);
  return instance;
}

const couponRow = {
  is_enabled: 1, code_prefix: 'NENBDAY', benefit_label: '特典',
  discount_amount: 500, validity_days: 31, updated_at: '2026-08-01 00:00:00',
};

const validBody = {
  isEnabled: true, codePrefix: 'NENBDAY', benefitLabel: '特典',
  discountAmount: 500, validityDays: 31,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canAccess.mockResolvedValue(true);
});

describe('GET /api/nen-campaigns/birthday-coupon', () => {
  it('保存済みの方針をそのまま返す', async () => {
    mocks.getCoupon.mockResolvedValue({ ...couponRow, leap_year_policy: 'mar1' });
    const response = await app().request('/api/nen-campaigns/birthday-coupon?lineAccountId=account-1');
    expect(response.status).toBe(200);
    expect((await response.json() as { data: { leapYearPolicy: string } }).data.leapYearPolicy).toBe('mar1');
  });

  it('キー無しの既存設定は skip（従来は平年に届かなかった）', async () => {
    mocks.getCoupon.mockResolvedValue(couponRow);
    const response = await app().request('/api/nen-campaigns/birthday-coupon?lineAccountId=account-1');
    expect((await response.json() as { data: { leapYearPolicy: string } }).data.leapYearPolicy).toBe('skip');
  });

  it('設定が一度も無いアカウントは要件の既定 feb28 を見せる', async () => {
    mocks.getCoupon.mockResolvedValue(null);
    const response = await app().request('/api/nen-campaigns/birthday-coupon?lineAccountId=account-1');
    expect((await response.json() as { data: { leapYearPolicy: string } }).data.leapYearPolicy).toBe('feb28');
  });
});

describe('PUT /api/nen-campaigns/birthday-coupon', () => {
  function put(body: Record<string, unknown>) {
    return app().request('/api/nen-campaigns/birthday-coupon?lineAccountId=account-1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('3択の方針を保存層へ渡す', async () => {
    mocks.getCoupon.mockResolvedValue(couponRow);
    const response = await put({ ...validBody, leapYearPolicy: 'feb28' });
    expect(response.status).toBe(200);
    expect(mocks.saveCoupon).toHaveBeenCalledWith(
      expect.anything(), 'account-1',
      expect.objectContaining({ leap_year_policy: 'feb28' }),
    );
  });

  it('3択以外は 400 で保存しない', async () => {
    const response = await put({ ...validBody, leapYearPolicy: 'feb29' });
    expect(response.status).toBe(400);
    expect(mocks.saveCoupon).not.toHaveBeenCalled();
  });

  it('省略時は既存の方針を守る（旧クライアントの保存で無断変更しない）', async () => {
    mocks.getCoupon.mockResolvedValue({ ...couponRow, leap_year_policy: 'skip' });
    const response = await put(validBody);
    expect(response.status).toBe(200);
    expect(mocks.saveCoupon).toHaveBeenCalledWith(
      expect.anything(), 'account-1',
      expect.objectContaining({ leap_year_policy: 'skip' }),
    );
  });

  it('省略かつ既存設定が無ければ既定 feb28 で保存する', async () => {
    mocks.getCoupon.mockResolvedValue(null);
    const response = await put(validBody);
    expect(response.status).toBe(200);
    expect(mocks.saveCoupon).toHaveBeenCalledWith(
      expect.anything(), 'account-1',
      expect.objectContaining({ leap_year_policy: 'feb28' }),
    );
  });
});
