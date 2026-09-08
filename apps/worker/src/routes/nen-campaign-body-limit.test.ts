import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { NEN_CAMPAIGN_BODY_MAX_LENGTH } from '@line-crm/shared';

const mocks = vi.hoisted(() => ({
  canAccess: vi.fn(),
  getLineAccountById: vi.fn(),
  getNenCampaign: vi.fn(),
  saveNenCampaignAccountSetting: vi.fn(),
  prepare: vi.fn(),
}));

vi.mock('../services/account-access.js', () => ({ canAccessAllLineAccounts: mocks.canAccess }));
vi.mock('@line-crm/db', () => ({
  getLineAccountById: mocks.getLineAccountById,
  jstNow: vi.fn(() => '2026-09-08 12:00:00'),
}));
vi.mock('../services/nen-engagement.js', () => ({
  buildDefaultColumnIntro: vi.fn(),
  buildNenDeliveryMessages: vi.fn(),
  getNenCampaign: mocks.getNenCampaign,
  queueColumnDelivery: vi.fn(),
  saveNenCampaignAccountSetting: mocks.saveNenCampaignAccountSetting,
  getNenBirthdayCouponSetting: vi.fn(),
  saveNenBirthdayCouponSetting: vi.fn(),
}));
vi.mock('../services/nen-tag-sync.js', () => ({ syncNenPetTags: vi.fn() }));
vi.mock('../services/line-proxy-send.js', () => ({ pushViaHarnessProxy: vi.fn() }));
vi.mock('../services/local-line-proxy.js', () => ({ dispatchLineProxyLocally: vi.fn() }));

const { nenCampaigns } = await import('./nen-campaigns.js');

function app() {
  const instance = new Hono<{ Bindings: { DB: D1Database } }>();
  instance.use('*', async (c, next) => {
    c.env = { DB: { prepare: mocks.prepare } as unknown as D1Database };
    c.set('staff' as never, { id: 'owner', role: 'owner', tenantId: 'tenant-a' } as never);
    await next();
  });
  instance.route('/', nenCampaigns);
  return instance;
}

function putSetting(bodyText: string, accountId = 'own-account') {
  return app().request(`/api/nen-campaigns/settings/review_request?lineAccountId=${accountId}`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      isEnabled: true, title: '見出し', bodyText,
      delayDays: 3, deliveryTime: '10:00', buttonLabel: '', buttonUrl: '', imageUrl: '',
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canAccess.mockResolvedValue(true);
  mocks.getNenCampaign.mockResolvedValue({
    campaign_key: 'review_request', label: '口コミのお願い', category: 'review', trigger_event: 'ec.order.delivered',
    delay_days: 3, delivery_time: '10:00', is_enabled: 1, title: '見出し', body_text: '本文',
    button_label: null, button_url: null, image_url: null, updated_at: '2026-09-01 00:00:00',
  });
  mocks.saveNenCampaignAccountSetting.mockResolvedValue(undefined);
});

describe('NEN本文の保存上限（#659）', () => {
  test('採用上限ちょうど（4500字）は保存できる', async () => {
    const response = await putSetting('あ'.repeat(NEN_CAMPAIGN_BODY_MAX_LENGTH));
    expect(response.status).toBe(200);
    expect(mocks.saveNenCampaignAccountSetting).toHaveBeenCalled();
  });

  test('旧上限ちょうど（1500字）は保存できる', async () => {
    const response = await putSetting('あ'.repeat(1500));
    expect(response.status).toBe(200);
  });

  test('採用上限の1字超え（4501字）は字数つきの理由で拒否し、保存しない', async () => {
    const response = await putSetting('あ'.repeat(NEN_CAMPAIGN_BODY_MAX_LENGTH + 1));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining('4,500字以内'),
    });
    expect(mocks.saveNenCampaignAccountSetting).not.toHaveBeenCalled();
  });

  test('絵文字は1字と数える（4500字ぶんの絵文字は保存できる）', async () => {
    const response = await putSetting('🌿'.repeat(NEN_CAMPAIGN_BODY_MAX_LENGTH));
    expect(response.status).toBe(200);
  });

  test('他アカウントの保存は権限なしで拒否し、保存しない', async () => {
    mocks.canAccess.mockResolvedValue(false);
    const response = await putSetting('あ'.repeat(100), 'other-account');
    expect(response.status).toBe(403);
    expect(mocks.saveNenCampaignAccountSetting).not.toHaveBeenCalled();
  });
});
