import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const mocks = vi.hoisted(() => ({
  getTemplatesWithUsageCount: vi.fn(),
  getTemplateById: vi.fn(),
  getTemplateUsage: vi.fn(),
  createTemplate: vi.fn(),
  updateTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
  getCarouselTapTotals: vi.fn(),
}));

vi.mock('@line-crm/db', () => mocks);

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

function storedTemplate(messageContent: string) {
  return {
    id: 'tpl-1',
    name: 'お知らせ',
    category: 'general',
    message_type: 'text',
    message_content: messageContent,
    question_json: null,
    question_status: null,
    carousel_actions_json: null,
    carousel_tap_limit_mode: 'none',
    carousel_tap_limit_text: null,
    folder_id: null,
    created_at: '2026-09-01T00:00:00+09:00',
    updated_at: '2026-09-01T00:00:00+09:00',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCarouselTapTotals.mockResolvedValue(new Map());
  mocks.createTemplate.mockImplementation(async (_db, input) => storedTemplate(input.messageContent));
});

describe('テキストテンプレートの本文上限', () => {
  it('新規作成で5,001文字を422で止め、DBへ書かない', async () => {
    const response = await app().request('/api/templates', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: '長すぎる本文',
        messageType: 'text',
        messageContent: 'あ'.repeat(5_001),
      }),
    }, bindings);

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      success: false,
      code: 'TEMPLATE_TEXT_TOO_LONG',
      error: '本文は5,000文字までです。いまは5,001文字です。',
      field: 'messageContent',
      maxCharacters: 5_000,
      actualCharacters: 5_001,
    });
    expect(mocks.createTemplate).not.toHaveBeenCalled();
  });

  it('既存のテキストを本文だけ更新する場合も同じ上限で止める', async () => {
    mocks.getTemplateById.mockResolvedValue(storedTemplate('こんにちは'));

    const response = await app().request('/api/templates/tpl-1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messageContent: '🌿'.repeat(5_001) }),
    }, bindings);

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      code: 'TEMPLATE_TEXT_TOO_LONG',
      actualCharacters: 5_001,
    });
    expect(mocks.updateTemplate).not.toHaveBeenCalled();
  });

  it('旧データの長い本文は、本文を変えない整理操作まで止めない', async () => {
    mocks.getTemplateById
      .mockResolvedValueOnce(storedTemplate('あ'.repeat(5_001)))
      .mockResolvedValueOnce(storedTemplate('あ'.repeat(5_001)));

    const response = await app().request('/api/templates/tpl-1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '名前だけ変更' }),
    }, bindings);

    expect(response.status).toBe(200);
    expect(mocks.updateTemplate).toHaveBeenCalledOnce();
  });

  it('5,000文字ちょうどは新規作成で保存する', async () => {
    const response = await app().request('/api/templates', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: '上限ちょうど',
        messageType: 'text',
        messageContent: 'あ'.repeat(5_000),
      }),
    }, bindings);

    expect(response.status).toBe(201);
    expect(mocks.createTemplate).toHaveBeenCalledOnce();
  });
});
