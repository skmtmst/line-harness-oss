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
  hasTemplateDraft: vi.fn().mockReturnValue(false),
  deleteTemplate: vi.fn(),
  getCarouselTapTotals: vi.fn(),
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

const VALID_BUBBLE = JSON.stringify({
  type: 'bubble',
  body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: 'こんにちは' }] },
});

function storedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tpl-1',
    name: 'カードの案内',
    category: 'general',
    message_type: 'flex',
    message_content: VALID_BUBBLE,
    question_json: null,
    question_status: null,
    carousel_actions_json: null,
    carousel_tap_limit_mode: 'none',
    carousel_tap_limit_text: null,
    folder_id: null,
    created_at: '2026-09-01T00:00:00+09:00',
    updated_at: '2026-09-01T00:00:00+09:00',
    line_account_id: 'account-1',
    ...overrides,
  };
}

function postCreate(body: Record<string, unknown>) {
  return app().request('/api/templates', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accountId: 'account-1', name: 'カード', ...body }),
  }, bindings);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hasTemplateDraft.mockReturnValue(false);
  mocks.getCarouselTapTotals.mockResolvedValue(new Map());
  mocks.getTemplateSendCounts.mockResolvedValue(new Map());
  accountAccess.canAccessAllLineAccounts.mockResolvedValue(true);
  accountAccess.getVisibleLineAccountScope.mockResolvedValue({
    allowedAccountIds: ['account-1'],
    canSeeUnassigned: false,
  });
  mocks.createTemplate.mockImplementation(async (_db, input) => storedRow({
    message_type: input.messageType,
    message_content: input.messageContent,
  }));
});

describe('R249: カード型の中身検査', () => {
  it.each([
    ['通常文', '初回のお届け予定はこちらです', 'JSON形式'],
    ['壊れたJSON', '{壊れている', 'JSON形式'],
    ['型がないJSON', '{}', 'バブルかカルーセル'],
  ])('新規作成で%sを422で止め、DBへ書かない', async (_label, messageContent, fragment) => {
    const response = await postCreate({ messageType: 'flex', messageContent });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      success: false,
      error: expect.stringContaining(fragment),
    });
    expect(mocks.createTemplate).not.toHaveBeenCalled();
  });

  it('正常なバブルは新規作成で保存する', async () => {
    const response = await postCreate({ messageType: 'flex', messageContent: VALID_BUBBLE });

    expect(response.status).toBe(201);
    expect(mocks.createTemplate).toHaveBeenCalledOnce();
  });

  it('質問付きは質問文をテキスト保存するので、カードの中身では止めない', async () => {
    const response = await postCreate({
      messageType: 'flex',
      messageContent: '壊れたFlexを送らない',
      question: {
        text: '続けますか？',
        choices: [{ label: 'はい', behavior: 'none' }, { label: 'いいえ', behavior: 'none' }],
      },
      questionStatus: 'draft',
    });

    expect(response.status).toBe(201);
    expect(mocks.createTemplate).toHaveBeenCalledWith(
      bindings.DB,
      expect.objectContaining({ messageType: 'text', messageContent: '続けますか？' }),
    );
  });

  it('更新でカード型へ通常文を入れると422で止め、下書きへ書かない', async () => {
    mocks.getTemplateById.mockResolvedValue(storedRow());

    const response = await app().request('/api/templates/tpl-1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messageContent: '通常文で上書き' }),
    }, bindings);

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      success: false,
      error: expect.stringContaining('JSON形式'),
    });
    expect(mocks.saveTemplateDraft).not.toHaveBeenCalled();
  });

  it('更新で正常なバブルは保存する', async () => {
    mocks.getTemplateById.mockResolvedValue(storedRow());

    const response = await app().request('/api/templates/tpl-1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messageContent: VALID_BUBBLE }),
    }, bindings);

    expect(response.status).toBe(200);
    expect(mocks.saveTemplateDraft).toHaveBeenCalledOnce();
  });

  it('本文を変えない整理操作は、古い壊れたカードが残っていても止めない', async () => {
    mocks.getTemplateById.mockResolvedValue(storedRow({ message_content: '通常文のまま残った古いカード' }));

    const response = await app().request('/api/templates/tpl-1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '名前だけ変更' }),
    }, bindings);

    expect(response.status).toBe(200);
    expect(mocks.saveTemplateDraft).not.toHaveBeenCalled();
  });

  it('公開で壊れたカードの下書きは422で止め、版を進めない', async () => {
    mocks.hasTemplateDraft.mockReturnValue(true);
    mocks.getTemplateById.mockResolvedValue(storedRow({
      draft_message_type: 'flex',
      draft_message_content: '通常文のまま残った古いカード',
    }));

    const response = await app().request('/api/templates/tpl-1/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': 'r249-invalid-flex-draft' },
      body: JSON.stringify({ expectedVersion: 0, expectedDraftRevision: 2 }),
    }, bindings);

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      success: false,
      error: expect.stringContaining('JSON形式'),
    });
    expect(mocks.publishTemplate).not.toHaveBeenCalled();
  });
});
