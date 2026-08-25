import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';

const mocks = vi.hoisted(() => ({
  canAccess: vi.fn(),
  getLineAccountById: vi.fn(),
  getNenCampaign: vi.fn(),
  queueColumnDelivery: vi.fn(),
}));

vi.mock('../services/account-access.js', () => ({ canAccessAllLineAccounts: mocks.canAccess }));
vi.mock('@line-crm/db', () => ({
  getLineAccountById: mocks.getLineAccountById,
  jstNow: vi.fn(() => '2026-08-25 12:00:00'),
}));
vi.mock('../services/nen-engagement.js', () => ({
  buildDefaultColumnIntro: vi.fn(),
  buildNenDeliveryMessages: vi.fn(),
  getNenCampaign: mocks.getNenCampaign,
  queueColumnDelivery: mocks.queueColumnDelivery,
}));
vi.mock('../services/nen-tag-sync.js', () => ({ syncNenPetTags: vi.fn() }));

const { nenCampaigns } = await import('./nen-campaigns.js');

function app() {
  const instance = new Hono<{ Bindings: { DB: D1Database } }>();
  instance.use('*', async (c, next) => {
    const statement = {
      bind: () => statement,
      first: vi.fn(async () => null),
    };
    c.env = { DB: { prepare: () => statement } as unknown as D1Database };
    c.set('staff' as never, { id: 'owner', role: 'owner', tenantId: 'tenant-a' } as never);
    await next();
  });
  instance.route('/', nenCampaigns);
  return instance;
}

function json(body: unknown) {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canAccess.mockResolvedValue(true);
  mocks.queueColumnDelivery.mockResolvedValue(1);
});

describe('NEN campaign tenant scope', () => {
  test('rejects another tenant test-send before account lookup or LINE work starts', async () => {
    mocks.canAccess.mockResolvedValue(false);
    const response = await app().request('/api/nen-campaigns/test-send', json({
      campaignKey: 'column', accountId: 'other-account', friendId: 'friend-1',
    }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: 'このLINEアカウントを操作する権限がありません' });
    expect(mocks.getLineAccountById).not.toHaveBeenCalled();
    expect(mocks.getNenCampaign).not.toHaveBeenCalled();
  });

  test('allows an own-tenant test-send to continue through target lookup', async () => {
    mocks.getNenCampaign.mockResolvedValue(null);
    mocks.getLineAccountById.mockResolvedValue(null);
    const response = await app().request('/api/nen-campaigns/test-send', json({
      campaignKey: 'column', accountId: 'own-account', friendId: 'friend-1',
    }));
    expect(response.status).toBe(404);
    expect(mocks.getLineAccountById).toHaveBeenCalledWith(expect.anything(), 'own-account');
    expect(mocks.getNenCampaign).toHaveBeenCalled();
  });

  test('rejects another tenant column delivery before it is queued', async () => {
    mocks.canAccess.mockResolvedValue(false);
    const response = await app().request('/api/nen-campaigns/columns/column-1/deliver', json({
      accountId: 'other-account',
    }));
    expect(response.status).toBe(403);
    expect(mocks.queueColumnDelivery).not.toHaveBeenCalled();
  });

  test('continues to queue an own-tenant column delivery', async () => {
    const response = await app().request('/api/nen-campaigns/columns/column-1/deliver', json({
      accountId: 'own-account',
    }));
    expect(response.status).toBe(200);
    expect(mocks.queueColumnDelivery).toHaveBeenCalledWith(expect.anything(), 'column-1', 'own-account', expect.any(String));
  });
});
