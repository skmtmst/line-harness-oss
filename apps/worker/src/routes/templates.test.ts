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
};
vi.mock('@line-crm/db', () => mocks);

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
