/*
 * N-146: 口を直接叩かれても、空の名前・空の本文・空の種別で
 * テンプレートを作ったり書き換えたりさせない。
 *
 * 画面側は保存前に止めているが、PUT /api/templates/:id は部分更新を
 * 受けるので「来た項目が空」はサーバー側で断る必要がある。
 * 断ったときは DB 層（updateTemplate / saveTemplateDraft / createTemplate）
 * を一度も呼ばないことまで見る——呼ばれていれば空で上書きされている。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const mocks = {
  getTemplatesWithUsageCount: vi.fn(),
  getTemplateSendCounts: vi.fn(),
  getTemplateById: vi.fn(),
  getTemplateUsage: vi.fn(),
  createTemplate: vi.fn(),
  updateTemplate: vi.fn(),
  saveTemplateDraft: vi.fn(),
  publishTemplate: vi.fn(),
  hasTemplateDraft: vi.fn().mockReturnValue(false),
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

const row = {
  id: 'tpl-1',
  name: '案内',
  category: 'general',
  message_type: 'text',
  message_content: 'こんにちは',
  question_json: null,
  question_status: 'published',
  folder_id: null,
  line_account_id: 'account-1',
  carousel_actions_json: null,
  carousel_tap_limit_mode: 'none',
  carousel_tap_limit_text: null,
  created_at: '2026-01-13T00:00:00.000Z',
  updated_at: '2026-01-13T00:00:00.000Z',
};

const put = (body: unknown) =>
  makeApp().fetch(
    new Request('https://example.com/api/templates/tpl-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    env,
  );

const post = (body: unknown) =>
  makeApp().fetch(
    new Request('https://example.com/api/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    env,
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getTemplateById.mockResolvedValue(row);
  mocks.hasTemplateDraft.mockReturnValue(false);
  accountAccess.canAccessAllLineAccounts.mockResolvedValue(true);
  accountAccess.getVisibleLineAccountScope.mockResolvedValue({
    allowedAccountIds: ['account-1'],
    canSeeUnassigned: false,
  });
});

describe('N-146: 更新で空の値を受け付けない', () => {
  it.each([
    ['空文字の名前', { name: '' }],
    ['空白だけの名前', { name: '   ' }],
    ['文字列でない名前', { name: 123 }],
    ['空文字の本文', { messageContent: '' }],
    ['空白だけの本文', { messageContent: '  \n  ' }],
    ['空文字の種別', { messageType: '' }],
  ])('%sは400で断り、DBへ何も書かない', async (_label, patch) => {
    const response = await put(patch);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false });
    expect(mocks.updateTemplate).not.toHaveBeenCalled();
    expect(mocks.saveTemplateDraft).not.toHaveBeenCalled();
  });

  it('来なかった項目は今のまま残す（部分更新はこれまでどおり）', async () => {
    const response = await put({ name: '案内（改）' });

    expect(response.status).toBe(200);
    expect(mocks.updateTemplate).toHaveBeenCalledWith(env.DB, 'tpl-1', { name: '案内（改）' });
    expect(mocks.saveTemplateDraft).not.toHaveBeenCalled();
  });
});

describe('N-146: 作成でも空白だけの必須項目を受け付けない', () => {
  const base = {
    accountId: 'account-1',
    name: '案内',
    category: 'general',
    messageType: 'text',
    messageContent: 'こんにちは',
  };

  it.each([
    ['空白だけの名前', { name: '   ' }],
    ['空白だけの本文', { messageContent: '　 ' }],
    ['空白だけの種別', { messageType: ' ' }],
  ])('%sは400で断り、作成しない', async (_label, patch) => {
    const response = await post({ ...base, ...patch });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: 'name, messageType, messageContent are required',
    });
    expect(mocks.createTemplate).not.toHaveBeenCalled();
  });
});
