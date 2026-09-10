import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

/**
 * テンプレートの公開版固定(#645 / 点検#497 N-131)の口の契約。
 *
 * - 編集・保存(PUTの送信文)は下書きへだけ書き、公開版は変えない
 * - 一覧の主 messageType/messageContent は公開版だけを返す
 * - 公開は確認キー必須・版が1つ進む・再試行は同じ結果(別下書きを出さない)
 * - 同時更新の負けと下書きの書き換わりは409
 * - 別アカウントの公開は存在しないものとして返す
 */

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

/** 公開版が「公開中の本文」版1、下書きなしの行。 */
function liveRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tpl-1',
    name: 'あいさつ',
    category: 'general',
    message_type: 'text',
    message_content: '公開中の本文',
    question_json: null,
    question_status: 'published',
    carousel_actions_json: null,
    carousel_tap_limit_mode: 'none',
    carousel_tap_limit_text: null,
    folder_id: null,
    line_account_id: 'account-1',
    published_version: 1,
    published_at: '2026-09-01T00:00:00+09:00',
    draft_message_type: null,
    draft_message_content: null,
    draft_carousel_actions_json: null,
    draft_carousel_tap_limit_mode: null,
    draft_carousel_tap_limit_text: null,
    draft_question_json: null,
    draft_question_status: null,
    draft_revision: 0,
    publish_idempotency_key: null,
    created_at: '2026-09-01T00:00:00+09:00',
    updated_at: '2026-09-01T00:00:00+09:00',
    ...overrides,
  };
}

function put(body: Record<string, unknown>) {
  return app().request('/api/templates/tpl-1', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }, bindings);
}

function publish(body: Record<string, unknown> = {}, key: string | null = 'publish-key-0001') {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (key !== null) headers['Idempotency-Key'] = key;
  return app().request('/api/templates/tpl-1/publish', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }, bindings);
}

beforeEach(() => {
  vi.clearAllMocks();
  accountAccess.canAccessAllLineAccounts.mockResolvedValue(true);
  accountAccess.getVisibleLineAccountScope.mockResolvedValue({
    allowedAccountIds: ['account-1'],
    canSeeUnassigned: false,
  });
  mocks.getCarouselTapTotals.mockResolvedValue(new Map());
  mocks.getTemplateSendCounts.mockResolvedValue(new Map());
  mocks.hasTemplateDraft.mockImplementation((row) =>
    row != null && (
      row.draft_message_type != null
      || row.draft_message_content != null
      || row.draft_carousel_actions_json != null
      || row.draft_carousel_tap_limit_mode != null
      || row.draft_carousel_tap_limit_text != null
      || row.draft_question_json != null
      || row.draft_question_status != null
    ),
  );
  mocks.getFolderById.mockResolvedValue(null);
});

describe('編集・保存は下書きへだけ書く', () => {
  it('本文の保存は公開版を触らず、下書きへ回す', async () => {
    // 1回目は存在確認、2回目は保存後の再読込(下書き付きで返る)。
    mocks.getTemplateById
      .mockResolvedValueOnce(liveRow())
      .mockResolvedValue(liveRow({ draft_message_content: '編集中の本文' }));
    mocks.updateTemplate.mockResolvedValue(undefined);
    mocks.saveTemplateDraft.mockResolvedValue(liveRow({ draft_message_content: '編集中の本文' }));

    const response = await put({ messageContent: '編集中の本文' });

    expect(response.status).toBe(200);
    // live 列への直接書き込みには送信文を渡さない。
    expect(mocks.updateTemplate).not.toHaveBeenCalled();
    expect(mocks.saveTemplateDraft).toHaveBeenCalledWith(bindings.DB, 'tpl-1', expect.objectContaining({
      messageType: 'text',
      messageContent: '編集中の本文',
    }));
    const body = await response.json() as { data: Record<string, unknown> };
    expect(body.data).toMatchObject({
      messageContent: '編集中の本文',
      hasDraft: true,
      publishedVersion: 1,
      published: { messageContent: '公開中の本文' },
    });
  });

  it('2回目の保存は1回目の下書きへ足し、公開版は変わらない', async () => {
    mocks.getTemplateById
      .mockResolvedValueOnce(liveRow({ draft_message_content: '1回目の編集' }))
      .mockResolvedValue(liveRow({ draft_message_content: '2回目の編集' }));
    mocks.saveTemplateDraft.mockResolvedValue(liveRow({ draft_message_content: '2回目の編集' }));

    const response = await put({ messageContent: '2回目の編集' });

    expect(response.status).toBe(200);
    expect(mocks.updateTemplate).not.toHaveBeenCalled();
    const body = await response.json() as { data: Record<string, unknown> };
    expect(body.data).toMatchObject({
      messageContent: '2回目の編集',
      published: { messageContent: '公開中の本文' },
    });
  });

  it('名前だけの整理は下書きを作らず、従来どおり即時反映する', async () => {
    mocks.getTemplateById.mockResolvedValue(liveRow());
    mocks.updateTemplate.mockResolvedValue(undefined);

    const response = await put({ name: '名前だけ直す' });

    expect(response.status).toBe(200);
    expect(mocks.updateTemplate).toHaveBeenCalledWith(bindings.DB, 'tpl-1', { name: '名前だけ直す' });
    expect(mocks.saveTemplateDraft).not.toHaveBeenCalled();
  });
});

describe('公開口の契約', () => {
  it('確認キーがなければ公開しない', async () => {
    mocks.getTemplateById.mockResolvedValue(liveRow({ draft_message_content: '編集中' }));

    const response = await publish({}, null);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: '公開操作の確認キーが必要です' });
    expect(mocks.publishTemplate).not.toHaveBeenCalled();
  });

  it('別アカウントの公開は存在しないものとして返す', async () => {
    accountAccess.canAccessAllLineAccounts.mockResolvedValue(false);
    mocks.getTemplateById.mockResolvedValue(liveRow());

    const response = await publish();

    expect(response.status).toBe(404);
    expect(mocks.publishTemplate).not.toHaveBeenCalled();
  });

  it('公開すると版が1つ進み、本文が公開版になる', async () => {
    mocks.getTemplateById.mockResolvedValue(liveRow({ draft_message_content: '公開したい本文' }));
    mocks.publishTemplate.mockResolvedValue({
      row: liveRow({ message_content: '公開したい本文', published_version: 2 }),
      published: true,
      replayed: false,
    });

    const response = await publish({ expectedVersion: 1, expectedDraftRevision: 0 });

    expect(response.status).toBe(200);
    expect(mocks.publishTemplate).toHaveBeenCalledWith(bindings.DB, 'tpl-1', {
      expectedVersion: 1,
      expectedDraftRevision: 0,
      idempotencyKey: 'publish-key-0001',
    });
    expect(await response.json()).toMatchObject({
      success: true,
      data: {
        messageContent: '公開したい本文',
        publishedVersion: 2,
        published: true,
        replayed: false,
        hasDraft: false,
      },
    });
  });

  it('同じ確認キーの再試行は公開済みの結果をそのまま返す', async () => {
    mocks.getTemplateById.mockResolvedValue(
      liveRow({ message_content: '公開したい本文', published_version: 2 }),
    );
    mocks.publishTemplate.mockResolvedValue({
      row: liveRow({ message_content: '公開したい本文', published_version: 2 }),
      published: false,
      replayed: true,
    });

    const response = await publish({ expectedVersion: 2, expectedDraftRevision: 0 });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      data: { publishedVersion: 2, published: false, replayed: true },
    });
  });

  it('同時更新の負けは409で止め、開き直しを求める', async () => {
    mocks.getTemplateById.mockResolvedValue(
      liveRow({ draft_message_content: '遅れてきた公開', published_version: 2 }),
    );
    mocks.publishTemplate.mockRejectedValue(new Error('TEMPLATE_VERSION_CONFLICT'));

    const response = await publish({ expectedVersion: 1, expectedDraftRevision: 0 });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: 'ほかの人が先に公開しました。開き直して確認してください',
    });
  });

  it('下書きが書き換わっていたら409で止め、開き直しを求める', async () => {
    mocks.getTemplateById.mockResolvedValue(
      liveRow({ draft_message_content: '確認していない本文', draft_revision: 3 }),
    );
    mocks.publishTemplate.mockRejectedValue(new Error('TEMPLATE_DRAFT_CONFLICT'));

    const response = await publish({ expectedVersion: 1, expectedDraftRevision: 2 });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: '下書きが書き換わっています。開き直して確認してください',
    });
  });

  it('同じ内容の同キー再試行は記録時の版・本文をそのまま返す(固定応答)', async () => {
    mocks.getTemplateById.mockResolvedValue(liveRow({ message_content: '2回目の公開' }));
    mocks.publishTemplate.mockResolvedValue({
      row: liveRow({ message_content: '最初の公開', published_version: 1 }),
      published: false,
      replayed: true,
    });

    const response = await publish({ expectedVersion: 1, expectedDraftRevision: 0 });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      data: {
        messageContent: '最初の公開',
        publishedVersion: 1,
        published: false,
        replayed: true,
        hasDraft: false,
      },
    });
  });

  it('同じ確認キーで別の下書きを出す使い回しは409で止める', async () => {
    mocks.getTemplateById.mockResolvedValue(
      liveRow({
        message_content: '最初の公開',
        published_version: 1,
        draft_message_content: '次の編集',
      }),
    );
    mocks.publishTemplate.mockRejectedValue(new Error('TEMPLATE_PUBLISH_KEY_CONFLICT'));

    const response = await publish({ expectedVersion: 1, expectedDraftRevision: 0 });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: '同じ確認キーが別の公開操作で使われています',
    });
  });

  it('版の番号が数でなければ400で止める', async () => {
    mocks.getTemplateById.mockResolvedValue(liveRow({ draft_message_content: '編集中' }));

    const response = await publish({ expectedVersion: '最新' });

    expect(response.status).toBe(400);
    expect(mocks.publishTemplate).not.toHaveBeenCalled();
  });

  it('下書き版の番号が数でなければ400で止める', async () => {
    mocks.getTemplateById.mockResolvedValue(liveRow({ draft_message_content: '編集中' }));

    const response = await publish({ expectedDraftRevision: '最新' });

    expect(response.status).toBe(400);
    expect(mocks.publishTemplate).not.toHaveBeenCalled();
  });

  it('版の確認がなければ400で止める(独立審査P2)', async () => {
    mocks.getTemplateById.mockResolvedValue(liveRow({ draft_message_content: '編集中' }));

    for (const body of [{}, { expectedVersion: 1 }, { expectedDraftRevision: 0 }]) {
      const response = await publish(body);
      expect(response.status).toBe(400);
    }
    expect(mocks.publishTemplate).not.toHaveBeenCalled();
  });
});

describe('一覧は公開版だけを主に返し、詳細は下書きも返す', () => {
  it('一覧は編集中の下書きがあっても公開版を主に返す', async () => {
    mocks.getTemplatesWithUsageCount.mockResolvedValue({
      items: [{
        ...liveRow({
          draft_message_type: 'text',
          draft_message_content: '編集中の本文',
          draft_revision: 2,
        }),
        usage_count: 0,
      }],
      total: 1,
    });

    const response = await app().request('/api/templates?account_id=account-1', {}, bindings);

    expect(response.status).toBe(200);
    const body = await response.json() as { data: Array<Record<string, unknown>> };
    expect(body.data[0]).toMatchObject({
      messageContent: '公開中の本文',
      hasDraft: true,
      publishedVersion: 1,
      draftRevision: 2,
      published: { messageContent: '公開中の本文' },
    });
  });

  it('一覧は未公開を版0・公開日時なしで返し、送信候補の目印にする', async () => {
    mocks.getTemplatesWithUsageCount.mockResolvedValue({
      items: [{
        ...liveRow({
          message_content: '最初の本文',
          published_version: 0,
          published_at: null,
          draft_message_type: 'text',
          draft_message_content: '最初の本文',
          draft_revision: 1,
        }),
        usage_count: 0,
      }],
      total: 1,
    });

    const response = await app().request('/api/templates?account_id=account-1', {}, bindings);

    expect(response.status).toBe(200);
    const body = await response.json() as { data: Array<Record<string, unknown>> };
    expect(body.data[0]).toMatchObject({
      hasDraft: true,
      publishedVersion: 0,
      publishedAt: null,
      draftRevision: 1,
    });
  });

  it('詳細は下書きがあれば編集中の内容を主に返す', async () => {
    mocks.getTemplateById.mockResolvedValue(liveRow({ draft_message_content: '編集中の本文' }));
    mocks.getTemplateUsage.mockResolvedValue({
      autoReplies: [], automations: [], scenarioSteps: [], reminderSteps: [],
      richMenuAreas: [], trackedLinks: [],
    });

    const response = await app().request('/api/templates/tpl-1', {}, bindings);

    expect(response.status).toBe(200);
    const body = await response.json() as { data: Record<string, unknown> };
    expect(body.data).toMatchObject({
      messageContent: '編集中の本文',
      hasDraft: true,
      published: { messageContent: '公開中の本文' },
    });
  });
});
