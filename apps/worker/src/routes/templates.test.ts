import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const mocks = {
  getTemplatesWithUsageCount: vi.fn(),
  getTemplateById: vi.fn(),
  getTemplateUsage: vi.fn(),
  createTemplate: vi.fn(),
  updateTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
  getCarouselTapTotals: vi.fn(),
  getFolderById: vi.fn(),
};
vi.mock('@line-crm/db', () => mocks);

const accountAccess = {
  canAccessAllLineAccounts: vi.fn(),
  getVisibleLineAccountScope: vi.fn(),
};
vi.mock('../services/account-access.js', () => accountAccess);

const { templates } = await import('./templates.js');

function makeApp() {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'u-1', name: 'テスト', role: 'owner', readOnly: false });
    return next();
  });
  app.route('/', templates);
  return app;
}

const env = { DB: {} as D1Database };

const EMPTY_USAGE = {
  autoReplies: [],
  automations: [],
  scenarioSteps: [],
  reminderSteps: [],
  richMenuAreas: [],
  trackedLinks: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getTemplateUsage.mockResolvedValue(EMPTY_USAGE);
  mocks.getTemplateById.mockResolvedValue({ id: 'tpl-1', line_account_id: 'account-1' });
  accountAccess.canAccessAllLineAccounts.mockResolvedValue(true);
  accountAccess.getVisibleLineAccountScope.mockResolvedValue({
    allowedAccountIds: ['account-1'],
    canSeeUnassigned: false,
  });
});

describe('テンプレートの削除', () => {
  it.each([
    ['自動応答', { autoReplies: [{ id: 'ar-1' }] }],
    ['オートメーション', { automations: [{ id: 'au-1' }] }],
    ['シナリオ', { scenarioSteps: [{ stepId: 'ss-1' }] }],
    ['リマインダ', { reminderSteps: [{ stepId: 'rs-1' }] }],
    ['リッチメニュー', { richMenuAreas: [{ areaId: 'rm-1' }] }],
    ['流入リンク', { trackedLinks: [{ id: 'tl-1' }] }],
  ])('%sで使用中なら409で止める', async (_label, partial) => {
    mocks.getTemplateUsage.mockResolvedValue({ ...EMPTY_USAGE, ...partial });

    const response = await makeApp().fetch(
      new Request('https://example.com/api/templates/tpl-1', { method: 'DELETE' }),
      env,
    );
    const body = await response.json() as { code: string; usageCount: number };

    expect(response.status).toBe(409);
    expect(body).toMatchObject({ code: 'IN_USE', usageCount: 1 });
    expect(mocks.deleteTemplate).not.toHaveBeenCalled();
  });

  it('どこからも使われていなければ削除できる', async () => {
    const response = await makeApp().fetch(
      new Request('https://example.com/api/templates/tpl-1', { method: 'DELETE' }),
      env,
    );

    expect(response.status).toBe(200);
    expect(mocks.deleteTemplate).toHaveBeenCalledWith(env.DB, 'tpl-1');
  });
});

describe('テンプレートのLINEアカウント境界', () => {
  it('別統括のテンプレート詳細は存在しないものとして返す', async () => {
    accountAccess.canAccessAllLineAccounts.mockResolvedValue(false);
    const response = await makeApp().fetch(
      new Request('https://example.com/api/templates/tpl-1'),
      env,
    );

    expect(response.status).toBe(404);
    expect(mocks.getTemplateUsage).not.toHaveBeenCalled();
  });

  it('新規作成はLINEアカウント所属を必須にする', async () => {
    const response = await makeApp().fetch(
      new Request('https://example.com/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '挨拶', messageType: 'text', messageContent: 'こんにちは' }),
      }),
      env,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'account_id_required' });
    expect(mocks.createTemplate).not.toHaveBeenCalled();
  });

  it('一覧は選択中LINEアカウントだけをDB層へ渡す', async () => {
    mocks.getTemplatesWithUsageCount.mockResolvedValue([]);
    mocks.getCarouselTapTotals.mockResolvedValue(new Map());
    const response = await makeApp().fetch(
      new Request('https://example.com/api/templates?account_id=account-1'),
      env,
    );

    expect(response.status).toBe(200);
    expect(mocks.getTemplatesWithUsageCount).toHaveBeenCalledWith(env.DB, undefined, {
      accountIds: ['account-1'],
      includeUnassigned: false,
    });
  });
});
