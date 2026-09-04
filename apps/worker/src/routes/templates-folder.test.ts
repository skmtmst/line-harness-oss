import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

/**
 * テンプレートの置き場（`folder_id`）を書く口。台帳 #124。
 *
 * それまで、一覧は `folderId` を返すのに書く口が無かった——**読めるのに書けない**。
 * フォルダを作れてもテンプレートを入れられず、どのフォルダも 0 件のままだった。
 *
 * ここで守りたいのは 1 点——**移したつもりが未分類になっていない**こと。
 * 消えたフォルダを指されたときに黙って `null` にすると、画面では
 * 「移せた」ように見えて、次に開くと消えている。
 */

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

const TEMPLATE_FOLDER = {
  id: 'fld-1',
  kind: 'template',
  name: 'お知らせ',
  parent_id: null,
  display_order: 0,
  color: null,
  created_at: '2026-09-04T00:00:00+09:00',
  updated_at: '2026-09-04T00:00:00+09:00',
};

function post(body: Record<string, unknown>) {
  return new Request('https://example.com/api/templates', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      accountId: 'account-1',
      name: 'あいさつ',
      messageType: 'text',
      messageContent: 'こんにちは',
      ...body,
    }),
  });
}

function put(body: Record<string, unknown>) {
  return new Request('https://example.com/api/templates/tpl-1', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  accountAccess.canAccessAllLineAccounts.mockResolvedValue(true);
  mocks.getTemplateById.mockResolvedValue({
    id: 'tpl-1',
    line_account_id: 'account-1',
    message_type: 'text',
    message_content: 'こんにちは',
    folder_id: null,
    question_status: 'published',
  });
  mocks.createTemplate.mockResolvedValue({
    id: 'tpl-1',
    name: 'あいさつ',
    category: 'general',
    message_type: 'text',
    question_json: null,
    question_status: 'published',
    folder_id: 'fld-1',
    created_at: '2026-09-04T00:00:00+09:00',
  });
  mocks.updateTemplate.mockResolvedValue(undefined);
  mocks.getFolderById.mockResolvedValue(TEMPLATE_FOLDER);
});

describe('作るときに置き場を決められる', () => {
  it('フォルダを指すと、そのフォルダへ入る', async () => {
    const res = await makeApp().fetch(post({ folderId: 'fld-1' }), env);
    expect(res.status).toBe(201);
    expect(mocks.createTemplate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ folderId: 'fld-1' }),
    );
    expect(await res.json()).toMatchObject({ data: { folderId: 'fld-1' } });
  });

  it('置き場を送らなければ未分類で作る', async () => {
    await makeApp().fetch(post({}), env);
    expect(mocks.createTemplate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ folderId: null }),
    );
    // 無いフォルダを探しに行かない。
    expect(mocks.getFolderById).not.toHaveBeenCalled();
  });
});

describe('あとから置き場を移せる', () => {
  it('フォルダを指すと移る', async () => {
    const res = await makeApp().fetch(put({ folderId: 'fld-1' }), env);
    expect(res.status).toBe(200);
    expect(mocks.updateTemplate).toHaveBeenCalledWith(
      expect.anything(),
      'tpl-1',
      expect.objectContaining({ folderId: 'fld-1' }),
    );
  });

  /*
    **`null` は「値が来なかった」ではなく「未分類へ戻す」。**
    ここを `undefined` と同じに扱うと、フォルダから出せなくなる。
  */
  it('null を送ると未分類へ戻る', async () => {
    await makeApp().fetch(put({ folderId: null }), env);
    expect(mocks.updateTemplate).toHaveBeenCalledWith(
      expect.anything(),
      'tpl-1',
      expect.objectContaining({ folderId: null }),
    );
  });

  it('置き場を送らなければ、いまの置き場のまま', async () => {
    await makeApp().fetch(put({ name: '名前だけ直す' }), env);
    const [, , updates] = mocks.updateTemplate.mock.calls[0];
    expect(updates).not.toHaveProperty('folderId');
  });
});

describe('移したつもりが未分類にならない', () => {
  it('消えたフォルダを指されたら断る（黙って未分類にしない）', async () => {
    mocks.getFolderById.mockResolvedValue(null);
    const res = await makeApp().fetch(put({ folderId: 'fld-消えた' }), env);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: 'そのフォルダはありません' });
    expect(mocks.updateTemplate).not.toHaveBeenCalled();
  });

  /*
    フォルダは 1 つの表を `kind` で使い分けている。タグの分類を指されても
    通ってしまうと、テンプレートの一覧に出てこないフォルダへ入る。
  */
  it('別の用途のフォルダを指されたら断る', async () => {
    mocks.getFolderById.mockResolvedValue({ ...TEMPLATE_FOLDER, kind: 'tag' });
    const res = await makeApp().fetch(post({ folderId: 'fld-tag' }), env);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: 'テンプレートのフォルダではありません' });
    expect(mocks.createTemplate).not.toHaveBeenCalled();
  });

  it('空文字は未分類として扱う（フォルダを探しに行かない）', async () => {
    await makeApp().fetch(put({ folderId: '' }), env);
    expect(mocks.getFolderById).not.toHaveBeenCalled();
    expect(mocks.updateTemplate).toHaveBeenCalledWith(
      expect.anything(),
      'tpl-1',
      expect.objectContaining({ folderId: null }),
    );
  });
});
