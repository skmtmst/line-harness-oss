import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const mocks = vi.hoisted(() => ({
  getTemplatesWithUsageCount: vi.fn(),
  getTemplateSendCounts: vi.fn(),
  getTemplateById: vi.fn(),
  getTemplateUsage: vi.fn(),
  createTemplate: vi.fn(),
  updateTemplate: vi.fn(),
  saveTemplateDraft: vi.fn(),
  publishTemplate: vi.fn(),
  hasTemplateDraft: vi.fn(),
  deleteTemplate: vi.fn(),
  getCarouselTapTotals: vi.fn(),
  getFolderById: vi.fn(),
  listTemplateVersions: vi.fn().mockResolvedValue([]),
  revertTemplateToVersion: vi.fn(),
  listTemplateReferences: vi.fn().mockResolvedValue([]),
  listBroadcastReferences: vi.fn().mockResolvedValue([]),
  getBroadcastDeleteBlockers: vi.fn().mockResolvedValue([]),
  getPinnedReminderDeleteBlockers: vi.fn().mockResolvedValue([]),
}));
vi.mock('@line-crm/db', () => mocks);

const accountAccess = vi.hoisted(() => ({
  canAccessAllLineAccounts: vi.fn(),
  getVisibleLineAccountScope: vi.fn(),
}));
vi.mock('../services/account-access.js', () => accountAccess);

import { templates } from './templates.js';

function app() {
  const hono = new Hono<Env>();
  hono.use('*', async (c, next) => {
    c.set('staff', { id: 'owner-1', name: 'Owner', role: 'owner', readOnly: false });
    await next();
  });
  hono.route('/', templates);
  return hono;
}

const bindings = { DB: {} as D1Database } as Env['Bindings'];

beforeEach(() => {
  vi.clearAllMocks();
  accountAccess.canAccessAllLineAccounts.mockResolvedValue(true);
  accountAccess.getVisibleLineAccountScope.mockResolvedValue({
    allowedAccountIds: ['account-1'],
    canSeeUnassigned: false,
  });
});

describe('F5 見本4件', () => {
  it('指定の4件を副作用なしで返す', async () => {
    const res = await app().request('/api/templates/examples', {}, bindings);
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; data: Array<{ id: string; name: string; body: string; imageSlot: string }> };
    expect(body.success).toBe(true);
    expect(body.data.map((item) => item.name)).toEqual([
      '営業時間のご案内',
      'キャンペーンのお知らせ',
      '予約の受付',
      '来店のお礼とクーポン',
    ]);
    const ids = body.data.map((item) => item.id);
    expect(new Set(ids).size).toBe(4);
    for (const item of body.data) {
      expect(item.body.trim()).not.toBe('');
      expect(item.imageSlot.trim()).not.toBe('');
    }
    expect(mocks.createTemplate).not.toHaveBeenCalled();
    expect(mocks.getTemplateById).not.toHaveBeenCalled();
  });

  it('各見本に内容に対応する種類を返す', async () => {
    const res = await app().request('/api/templates/examples', {}, bindings);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ id: string; messageType: string }> };
    expect(body.data.map(({ id, messageType }) => ({ id, messageType }))).toEqual([
      { id: 'template-example-business-hours', messageType: 'text' },
      { id: 'template-example-campaign', messageType: 'rich_message' },
      { id: 'template-example-booking', messageType: 'text' },
      { id: 'template-example-thanks-coupon', messageType: 'coupon' },
    ]);
  });

  it('固定routeが/:idより先で、examplesをID扱いしない', async () => {
    mocks.getTemplateById.mockResolvedValue(null);
    const res = await app().request('/api/templates/examples', {}, bindings);
    expect(res.status).toBe(200);
    expect(mocks.getTemplateById).not.toHaveBeenCalled();
  });
});
