import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { NEN_CAMPAIGN_BODY_MAX_LENGTH } from '@line-crm/shared';

/*
 * 一覧の停止・再開（PUT .../enabled）が本文の長さに関わらず必ず実行できる
 * ことを見張る（#659 差し戻し2点目）。同じ設定を更新する通常のPUT
 * （本文検査あり）と挙動を比べる。
 */

const mocks = vi.hoisted(() => ({
  canAccess: vi.fn(),
  getNenCampaign: vi.fn(),
  saveNenCampaignAccountSetting: vi.fn(),
}));

vi.mock('../services/account-access.js', () => ({ canAccessAllLineAccounts: mocks.canAccess }));
vi.mock('@line-crm/db', () => ({
  getLineAccountById: vi.fn(),
  jstNow: vi.fn(() => '2026-09-11 12:00:00'),
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
    c.env = { DB: { prepare: vi.fn() } as unknown as D1Database };
    c.set('staff' as never, { id: 'owner', role: 'owner', tenantId: 'tenant-a' } as never);
    await next();
  });
  instance.route('/', nenCampaigns);
  return instance;
}

function toggleEnabled(isEnabled: boolean, accountId = 'own-account') {
  return app().request(`/api/nen-campaigns/settings/review_request/enabled?lineAccountId=${accountId}`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ isEnabled }),
  });
}

const OVER_LIMIT_BODY = 'あ'.repeat(NEN_CAMPAIGN_BODY_MAX_LENGTH + 500);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canAccess.mockResolvedValue(true);
  // 保存済みの本文が採用上限（4,500字）を超えている想定。上限を後から
  // 引き下げた場合や、既存データが旧仕様のまま残っている場合に相当する。
  mocks.getNenCampaign.mockResolvedValue({
    campaign_key: 'review_request', label: '口コミのお願い', category: 'review', trigger_event: 'ec.order.delivered',
    delay_days: 3, delivery_time: '10:00', is_enabled: 1, title: '見出し', body_text: OVER_LIMIT_BODY,
    button_label: null, button_url: null, image_url: null, updated_at: '2026-09-01 00:00:00',
  });
  mocks.saveNenCampaignAccountSetting.mockResolvedValue(undefined);
});

describe('NEN配信の停止・再開は本文の長さに依存しない（#659差し戻し2点目）', () => {
  test('保存済み本文が採用上限を超えていても停止できる', async () => {
    const response = await toggleEnabled(false);
    expect(response.status).toBe(200);
    expect(mocks.saveNenCampaignAccountSetting).toHaveBeenCalledTimes(1);
    const [, , saved] = mocks.saveNenCampaignAccountSetting.mock.calls[0];
    expect(saved.is_enabled).toBe(0);
    // 本文・題名など、他の項目は保存済みの値のまま変えない。
    expect(saved.body_text).toBe(OVER_LIMIT_BODY);
    expect(saved.title).toBe('見出し');
  });

  test('保存済み本文が採用上限を超えていても再開できる', async () => {
    mocks.getNenCampaign.mockResolvedValue({
      campaign_key: 'review_request', label: '口コミのお願い', category: 'review', trigger_event: 'ec.order.delivered',
      delay_days: 3, delivery_time: '10:00', is_enabled: 0, title: '見出し', body_text: OVER_LIMIT_BODY,
      button_label: null, button_url: null, image_url: null, updated_at: '2026-09-01 00:00:00',
    });
    const response = await toggleEnabled(true);
    expect(response.status).toBe(200);
    const [, , saved] = mocks.saveNenCampaignAccountSetting.mock.calls[0];
    expect(saved.is_enabled).toBe(1);
  });

  test('isEnabledが無いと拒否する', async () => {
    const response = await app().request('/api/nen-campaigns/settings/review_request/enabled?lineAccountId=own-account', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
    expect(mocks.saveNenCampaignAccountSetting).not.toHaveBeenCalled();
  });

  test('他アカウントの切り替えは権限なしで拒否する', async () => {
    mocks.canAccess.mockResolvedValue(false);
    const response = await toggleEnabled(false, 'other-account');
    expect(response.status).toBe(403);
    expect(mocks.saveNenCampaignAccountSetting).not.toHaveBeenCalled();
  });

  test('存在しない配信は404', async () => {
    mocks.getNenCampaign.mockResolvedValue(null);
    const response = await toggleEnabled(false);
    expect(response.status).toBe(404);
  });
});
