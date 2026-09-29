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
  getFormAccountIds: vi.fn(async () => ['account-a']),
  listLineAccountsWithTenantStatus: vi.fn(async () => [
    { id: 'account-a', tenant_status: 'active' },
  ]),
  getForms: vi.fn(),
  getFormsWithStats: vi.fn(),
  getFormById: mocks.getFormById,
  formBelongsToLineAccount: mocks.formBelongsToLineAccount,
  createForm: vi.fn(),
  updateForm: vi.fn(),
  deleteForm: vi.fn(),
  getFormSubmissions: vi.fn(),
  getFormSubmissionsPage: vi.fn(),
  getFormSubmissionAnalytics: vi.fn(),
  getLatestFormSubmission: vi.fn(),
  createFormSubmission: vi.fn(),
  updateFormSubmissionDestinationWriteResult: vi.fn(),
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

/** 中身の検査を通すための、本物の最小画像。中身が偽物のバイトは検査で落とす。 */
function minimalImage(mimeType: string, size = 0): Uint8Array {
  let head: number[];
  if (mimeType === 'image/png') {
    head = [
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ];
  } else if (mimeType === 'image/heic' || mimeType === 'image/heif') {
    head = [
      0x00, 0x00, 0x00, 0x14, 0x66, 0x74, 0x79, 0x70,
      0x68, 0x65, 0x69, 0x63, 0x00, 0x00, 0x00, 0x00,
      0x6d, 0x69, 0x66, 0x31,
    ];
  } else {
    head = [
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08,
      0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9,
    ];
  }
  // 後ろに足すと「画像の後ろに別のデータ」でしまうので、大きい物は
  // 大きさの検査だけ見る（中身の検査より先に大きさで断る）。
  if (size === 0) return new Uint8Array(0);
  if (size > 10 * 1024 * 1024) return new Uint8Array(size);
  return Uint8Array.from(head);
}

function upload(mimeType = 'image/jpeg', bytes = 1024) {
  return new Request('https://worker.example.test/api/forms/form-1/files', {
    method: 'POST',
    headers: { 'Content-Type': mimeType, Authorization: 'Bearer id-token' },
    body: minimalImage(mimeType, bytes) as unknown as BodyInit,
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
