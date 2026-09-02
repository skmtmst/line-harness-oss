import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { emptyLayout, newBlockId } from '@line-crm/shared';
import type { Env } from '../index.js';

/**
 * 回答に添付する画像の預かり口。
 *
 * ここは**認証なしでも叩ける場所に生えている**（友だちが使うため）ので、
 * 誰でも画像を置ける置き場になっていないかを、重点的に見る。
 */

const mocks = vi.hoisted(() => ({
  getFormById: vi.fn(),
  getFriendByLineUserIdForAccount: vi.fn(),
  verifyCallerLineIdentity: vi.fn(),
  formBelongsToLineAccount: vi.fn(),
}));

vi.mock('@line-crm/db', () => ({
  getForms: vi.fn(),
  getFormsWithStats: vi.fn(),
  getFormById: mocks.getFormById,
  formBelongsToLineAccount: mocks.formBelongsToLineAccount,
  createForm: vi.fn(),
  updateForm: vi.fn(),
  deleteForm: vi.fn(),
  getFormSubmissions: vi.fn(),
  getFormSubmissionsPage: vi.fn(),
  getLatestFormSubmission: vi.fn(),
  createFormSubmission: vi.fn(),
  getFriendByLineUserIdForAccount: mocks.getFriendByLineUserIdForAccount,
  getFriendById: vi.fn(),
  getTrackedLinkById: vi.fn(),
  getMessageTemplateById: vi.fn(),
  getLineAccountById: vi.fn(),
  enrollFriendInScenario: vi.fn(),
  jstNow: vi.fn(() => '2026-08-19T12:00:00+09:00'),
}));

vi.mock('../services/liff-auth.js', () => ({
  verifyCallerLineIdentity: mocks.verifyCallerLineIdentity,
}));

vi.mock('../services/friend-tag-attach.js', () => ({
  attachTagAndFireSideEffects: vi.fn(),
}));

vi.mock('../services/local-line-proxy.js', () => ({
  dispatchLineProxyLocally: vi.fn(),
}));

import { forms } from './forms.js';

/** ファイルブロックを1つ持つフォーム。 */
function formWithFile(overrides: Record<string, unknown> = {}) {
  const layout = emptyLayout();
  layout.sections[0].blocks = [
    {
      id: newBlockId(),
      kind: 'input',
      type: 'file',
      name: 'photo',
      label: 'お写真',
    },
  ];
  return {
    id: 'form-1',
    name: '写真つきのフォーム',
    description: null,
    fields: '[]',
    layout: JSON.stringify(layout),
    is_active: 1,
    submit_count: 0,
    ...overrides,
  };
}

/** ファイルブロックを持たないフォーム。 */
function formWithoutFile() {
  const layout = emptyLayout();
  layout.sections[0].blocks = [
    { id: newBlockId(), kind: 'input', type: 'text', name: 'name', label: 'お名前' },
  ];
  return formWithFile({ layout: JSON.stringify(layout) });
}

function env() {
  const put = vi.fn(async () => undefined);
  return {
    bindings: {
      DB: {} as D1Database,
      IMAGES: { put } as unknown as R2Bucket,
      LINE_CHANNEL_ACCESS_TOKEN: 'line-token',
      WORKER_URL: 'https://worker.example.test',
    } as Env['Bindings'],
    put,
  };
}

function app() {
  const a = new Hono<Env>();
  a.route('/', forms);
  return a;
}

function upload(mimeType = 'image/jpeg', bytes = 1024) {
  return new Request('https://worker.example.test/api/forms/form-1/files', {
    method: 'POST',
    headers: { 'Content-Type': mimeType, Authorization: 'Bearer id-token' },
    body: new Uint8Array(bytes),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getFormById.mockResolvedValue(formWithFile());
  mocks.verifyCallerLineIdentity.mockResolvedValue({
    lineUserId: 'U-line-user',
    lineAccountId: 'account-a',
  });
  mocks.formBelongsToLineAccount.mockResolvedValue(true);
  mocks.getFriendByLineUserIdForAccount.mockResolvedValue({ id: 'friend-1', line_user_id: 'U-line-user' });
});

describe('回答に添付する画像を預かる', () => {
  test('友だちからの画像を受け取り、URLを返す', async () => {
    const { bindings, put } = env();
    const res = await app().fetch(upload(), bindings);

    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { url: string; key: string } };
    expect(body.data.key).toMatch(/^form-uploads\/form-1\/friend-1\/.+\.jpg$/);
    expect(body.data.url).toBe(`https://worker.example.test/images/${body.data.key}`);

    // 誰の・どのフォームの添付かが、後から分かるようにしてある
    expect(put).toHaveBeenCalledWith(
      body.data.key,
      expect.anything(),
      expect.objectContaining({
        customMetadata: { formId: 'form-1', friendId: 'friend-1' },
      }),
    );
  });

  test('本人が確かめられないときは預からない', async () => {
    mocks.verifyCallerLineIdentity.mockResolvedValue(null);
    const { bindings, put } = env();

    const res = await app().fetch(upload(), bindings);
    expect(res.status).toBe(401);
    expect(put).not.toHaveBeenCalled();
  });

  test('友だちでない人からは預からない', async () => {
    mocks.getFriendByLineUserIdForAccount.mockResolvedValue(null);
    const { bindings, put } = env();

    const res = await app().fetch(upload(), bindings);
    expect(res.status).toBe(404);
    expect(put).not.toHaveBeenCalled();
  });

  test('ファイルを受け取らないフォームには置かせない', async () => {
    // これが無いと、フォームIDを知っているだけで画像置き場として使える
    mocks.getFormById.mockResolvedValue(formWithoutFile());
    const { bindings, put } = env();

    const res = await app().fetch(upload(), bindings);
    expect(res.status).toBe(400);
    expect(put).not.toHaveBeenCalled();
  });

  test('停止中のフォームには置かせない', async () => {
    mocks.getFormById.mockResolvedValue(formWithFile({ is_active: 0 }));
    const { bindings, put } = env();

    const res = await app().fetch(upload(), bindings);
    expect(res.status).toBe(400);
    expect(put).not.toHaveBeenCalled();
  });

  test('画像以外は断る', async () => {
    const { bindings, put } = env();

    for (const mimeType of ['application/pdf', 'text/html', 'application/octet-stream']) {
      const res = await app().fetch(upload(mimeType), bindings);
      expect(res.status, mimeType).toBe(400);
    }
    expect(put).not.toHaveBeenCalled();
  });

  test('iPhone の heic を受け取る', async () => {
    const { bindings } = env();
    const res = await app().fetch(upload('image/heic'), bindings);

    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { key: string } };
    expect(body.data.key).toMatch(/\.heic$/);
  });

  test('10MBを超える画像は断る', async () => {
    const { bindings, put } = env();
    const res = await app().fetch(upload('image/png', 10 * 1024 * 1024 + 1), bindings);

    expect(res.status).toBe(400);
    expect(put).not.toHaveBeenCalled();
  });

  test('中身が空のときは断る', async () => {
    const { bindings, put } = env();
    const res = await app().fetch(upload('image/png', 0), bindings);

    expect(res.status).toBe(400);
    expect(put).not.toHaveBeenCalled();
  });

  test('無いフォームには置かせない', async () => {
    mocks.getFormById.mockResolvedValue(null);
    const { bindings, put } = env();

    const res = await app().fetch(upload(), bindings);
    expect(res.status).toBe(404);
    expect(put).not.toHaveBeenCalled();
  });
});
