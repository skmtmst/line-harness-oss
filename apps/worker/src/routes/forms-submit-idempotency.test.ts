import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { emptyLayout, newBlockId, type FormLayout } from '@line-crm/shared';
import type { Env } from '../index.js';

/**
 * フォーム回答の冪等化(N-165)の契約テスト。
 *
 * 同じフォーム・同じ友だち・同じ冪等キー(Idempotency-Key ヘッダ、UUID)の
 * 再送は保存済みの回答を返し、マイル・通知・タグなどの副作用を重ねない。
 * 同じキーで内容が違う使い回しは 409 で断る。
 * 流儀は一斉配信の冪等化(broadcasts-idempotency.test.ts)と同じ。
 */

const KEY = '11111111-2222-4333-8444-555555555555';
const KEY_2 = '22222222-3333-4444-8555-666666666666';

const mocks = vi.hoisted(() => ({
  getFormById: vi.fn(),
  getFormSubmissionById: vi.fn(),
  getFriendByLineUserIdForAccount: vi.fn(),
  getFriendById: vi.fn(),
  createFormSubmission: vi.fn(),
  updateFormSubmissionDestinationWriteResult: vi.fn(),
  verifyCallerLineIdentity: vi.fn(),
  countFormSubmissionsByFriend: vi.fn(),
  countChoiceUsage: vi.fn(),
  attachTag: vi.fn(),
  setFriendFieldValue: vi.fn(),
  getFriendFieldById: vi.fn(),
  awardActivityMileage: vi.fn(),
  formBelongsToLineAccount: vi.fn(),
}));

vi.mock('@line-crm/db', () => ({
  getForms: vi.fn(),
  getFormsWithStats: vi.fn(),
  getFormById: mocks.getFormById,
  getFormSubmissionById: mocks.getFormSubmissionById,
  formBelongsToLineAccount: mocks.formBelongsToLineAccount,
  createForm: vi.fn(),
  updateForm: vi.fn(),
  deleteForm: vi.fn(),
  getFormSubmissions: vi.fn(),
  getFormSubmissionsPage: vi.fn(),
  getFormSubmissionAnalytics: vi.fn(),
  getLatestFormSubmission: vi.fn(),
  createFormSubmission: mocks.createFormSubmission,
  updateFormSubmissionDestinationWriteResult: mocks.updateFormSubmissionDestinationWriteResult,
  getFriendByLineUserIdForAccount: mocks.getFriendByLineUserIdForAccount,
  getFriendById: mocks.getFriendById,
  getTrackedLinkById: vi.fn(),
  getMessageTemplateById: vi.fn(),
  getLineAccountById: vi.fn(async () => null),
  enrollFriendInScenario: vi.fn(),
  enrollFriendInReminder: vi.fn(),
  removeTagFromFriend: vi.fn(),
  setFriendFieldValue: mocks.setFriendFieldValue,
  getFriendFieldById: mocks.getFriendFieldById,
  countFormSubmissionsByFriend: mocks.countFormSubmissionsByFriend,
  countChoiceUsage: mocks.countChoiceUsage,
  jstNow: vi.fn(() => '2026-08-20T12:00:00+09:00'),
}));

vi.mock('../services/liff-auth.js', () => ({
  verifyCallerLineIdentity: mocks.verifyCallerLineIdentity,
}));

vi.mock('../services/friend-tag-attach.js', () => ({
  attachTagAndFireSideEffects: mocks.attachTag,
}));

vi.mock('../services/local-line-proxy.js', () => ({
  dispatchLineProxyLocally: vi.fn(async () => new Response(null, { status: 200 })),
}));

vi.mock('../services/line-proxy-send.js', () => ({
  pushViaHarnessProxy: vi.fn(async () => undefined),
}));

vi.mock('../services/activity-mileage.js', () => ({
  awardActivityMileage: mocks.awardActivityMileage,
}));

import { forms } from './forms.js';

function simpleLayout(): FormLayout {
  const layout = emptyLayout();
  layout.sections[0].blocks = [
    {
      id: newBlockId(),
      kind: 'input',
      type: 'text',
      name: 'full_name',
      label: 'お名前',
      required: true,
    },
  ];
  return layout;
}

function formRow(layout: FormLayout | null, overrides: Record<string, unknown> = {}) {
  return {
    id: 'form-1',
    name: '事前カルテ',
    description: null,
    fields: JSON.stringify([{ name: 'full_name', label: 'お名前', type: 'text', required: true }]),
    layout: layout ? JSON.stringify(layout) : null,
    on_submit_tag_id: null,
    on_submit_scenario_id: null,
    on_submit_message_type: null,
    on_submit_message_content: null,
    on_submit_webhook_url: null,
    on_submit_webhook_headers: null,
    on_submit_webhook_fail_message: null,
    save_to_metadata: 0,
    is_active: 1,
    submit_count: 0,
    og_title: null,
    og_description: null,
    og_image_url: null,
    created_at: '2026-08-01T00:00:00+09:00',
    updated_at: '2026-08-01T00:00:00+09:00',
    ...overrides,
  };
}

/** 保存済みの回答行。2回目の照合はここから読む。 */
function submissionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: KEY,
    form_id: 'form-1',
    friend_id: 'friend-1',
    data: JSON.stringify({ full_name: '山田' }),
    destination_write_status: 'not_requested',
    destination_write_attempted: 0,
    destination_write_succeeded: 0,
    destination_write_failed: 0,
    destination_write_completed_at: null,
    idempotency_hash: 'captured-later',
    idempotency_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    created_at: '2026-08-20T12:00:00+09:00',
    ...overrides,
  };
}

function env() {
  const run = vi.fn(async () => ({ meta: { changes: 1 } }));
  const bind = vi.fn(() => ({ run, first: async () => null, all: async () => ({ results: [] }) }));
  const prepare = vi.fn(() => ({ bind }));
  return {
    DB: { prepare } as unknown as D1Database,
    IMAGES: { put: vi.fn() } as unknown as R2Bucket,
    LINE_CHANNEL_ACCESS_TOKEN: 'line-token',
    WORKER_URL: 'https://worker.example.test',
  } as Env['Bindings'];
}

function app() {
  const a = new Hono<Env>();
  a.route('/', forms);
  return a;
}

function submitRequest(
  data: Record<string, unknown>,
  key: string | null = KEY,
  extra: Record<string, unknown> = {},
) {
  return new Request('https://worker.example.test/api/forms/form-1/submit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer [REDACTED]',
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    body: JSON.stringify({ data, ...extra }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyCallerLineIdentity.mockResolvedValue({
    lineUserId: 'U-line-user',
    lineAccountId: 'account-a',
  });
  mocks.formBelongsToLineAccount.mockResolvedValue(true);
  mocks.getFriendByLineUserIdForAccount.mockResolvedValue({
    id: 'friend-1',
    line_user_id: 'U-line-user',
    line_account_id: null,
    metadata: '{}',
    display_name: 'テスト',
  });
  mocks.getFriendById.mockResolvedValue({ id: 'friend-1', line_user_id: null, metadata: '{}' });
  mocks.countFormSubmissionsByFriend.mockResolvedValue(0);
  mocks.countChoiceUsage.mockResolvedValue(new Map());
  mocks.getFriendFieldById.mockResolvedValue({ id: 'ff-1', ec_is_master: 0 });
  mocks.getFormSubmissionById.mockResolvedValue(null);
  mocks.createFormSubmission.mockImplementation(async (_db, input) => ({
    id: input.id ?? 'submission-new',
    form_id: input.formId,
    friend_id: input.friendId,
    data: input.data,
    destination_write_status: 'not_requested',
    destination_write_attempted: 0,
    destination_write_succeeded: 0,
    destination_write_failed: 0,
    destination_write_completed_at: null,
    idempotency_hash: input.idempotencyHash ?? null,
    idempotency_expires_at: input.idempotencyExpiresAt ?? null,
    created_at: '2026-08-20T12:00:00+09:00',
  }));
  mocks.updateFormSubmissionDestinationWriteResult.mockResolvedValue('not_requested');
  mocks.getFormById.mockResolvedValue(formRow(simpleLayout()));
});

describe('フォーム回答の冪等化', () => {
  test('同じキーの再送は保存済みを返し、保存も副作用も重ねない', async () => {
    const first = await app().fetch(submitRequest({ full_name: '山田' }), env());
    expect(first.status).toBe(201);
    expect(first.headers.get('Idempotency-Replayed')).toBeNull();
    const createdInput = mocks.createFormSubmission.mock.calls[0][1] as Record<string, unknown>;
    expect(createdInput.id).toBe(KEY);

    // 2回目は保存済みの行として返す。ハッシュは1回目に付けたものを使う。
    mocks.getFormSubmissionById.mockResolvedValue(submissionRow({
      idempotency_hash: createdInput.idempotencyHash,
    }));

    const replayed = await app().fetch(submitRequest({ full_name: '山田' }), env());
    expect(replayed.status).toBe(200);
    expect(replayed.headers.get('Idempotency-Replayed')).toBe('true');
    expect(mocks.createFormSubmission).toHaveBeenCalledTimes(1);
    expect(mocks.awardActivityMileage).toHaveBeenCalledTimes(1);
    expect(mocks.attachTag).not.toHaveBeenCalled();
    const body = (await replayed.json()) as { success: boolean; data: { id: string } };
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(KEY);
  });

  test('タグ付け・マイルの副作用も再送では重ねない', async () => {
    mocks.getFormById.mockResolvedValue(formRow(simpleLayout(), { on_submit_tag_id: 'tag-1' }));

    const first = await app().fetch(submitRequest({ full_name: '山田' }), env());
    expect(first.status).toBe(201);
    expect(mocks.attachTag).toHaveBeenCalledTimes(1);
    const hash = (mocks.createFormSubmission.mock.calls[0][1] as Record<string, unknown>).idempotencyHash;
    mocks.getFormSubmissionById.mockResolvedValue(submissionRow({ idempotency_hash: hash }));

    const replayed = await app().fetch(submitRequest({ full_name: '山田' }), env());
    expect(replayed.status).toBe(200);
    expect(mocks.createFormSubmission).toHaveBeenCalledTimes(1);
    expect(mocks.attachTag).toHaveBeenCalledTimes(1);
    expect(mocks.awardActivityMileage).toHaveBeenCalledTimes(1);
  });

  test('同時送信の負け側(保存時競合)は保存済みを200で返す', async () => {
    const first = await app().fetch(submitRequest({ full_name: '山田' }), env());
    expect(first.status).toBe(201);
    const hash = (mocks.createFormSubmission.mock.calls[0][1] as Record<string, unknown>).idempotencyHash;

    // 事前照合をすり抜け、保存だけが競合した想定。
    mocks.getFormSubmissionById
      .mockResolvedValueOnce(null)
      .mockResolvedValue(submissionRow({ idempotency_hash: hash }));
    mocks.createFormSubmission.mockRejectedValueOnce(new Error('UNIQUE constraint failed: form_submissions.id'));

    const loser = await app().fetch(submitRequest({ full_name: '山田' }), env());
    expect(loser.status).toBe(200);
    expect(loser.headers.get('Idempotency-Replayed')).toBe('true');
    // 負けた側は副作用を重ねない
    expect(mocks.awardActivityMileage).toHaveBeenCalledTimes(1);
  });

  test('同じキーで内容が違う使い回しは409で断り、保存しない', async () => {
    mocks.getFormSubmissionById.mockResolvedValue(submissionRow({
      idempotency_hash: 'different-content-hash',
    }));

    const res = await app().fetch(submitRequest({ full_name: '別人' }), env());
    expect(res.status).toBe(409);
    expect(mocks.createFormSubmission).not.toHaveBeenCalled();
    expect(mocks.awardActivityMileage).not.toHaveBeenCalled();
  });

  test('別アカウントのキーでは回答の有無を見せず404', async () => {
    mocks.formBelongsToLineAccount.mockResolvedValue(false);

    const res = await app().fetch(submitRequest({ full_name: '山田' }), env());
    expect(res.status).toBe(404);
    expect(mocks.getFormSubmissionById).not.toHaveBeenCalled();
    expect(mocks.createFormSubmission).not.toHaveBeenCalled();
  });

  test('別人の回答のキーを使い回すと409', async () => {
    const first = await app().fetch(submitRequest({ full_name: '山田' }), env());
    expect(first.status).toBe(201);
    const hash = (mocks.createFormSubmission.mock.calls[0][1] as Record<string, unknown>).idempotencyHash;
    // 同じアカウントの別人(friend-2)が同じキーで送る
    mocks.getFriendByLineUserIdForAccount.mockResolvedValue({
      id: 'friend-2',
      line_user_id: 'U-other',
      line_account_id: null,
      metadata: '{}',
      display_name: '別人',
    });
    mocks.getFormSubmissionById.mockResolvedValue(submissionRow({ idempotency_hash: hash }));

    const res = await app().fetch(submitRequest({ full_name: '山田' }), env());
    expect(res.status).toBe(409);
  });

  test('キーなし送信は従来どおり採番し、照合もしない', async () => {
    const res = await app().fetch(submitRequest({ full_name: '山田' }, null), env());
    expect(res.status).toBe(201);
    expect(mocks.getFormSubmissionById).not.toHaveBeenCalled();
    const input = mocks.createFormSubmission.mock.calls[0][1] as Record<string, unknown>;
    expect(input).not.toHaveProperty('id');
  });

  test('形の違うキーはDBに触る前に400', async () => {
    const res = await app().fetch(submitRequest({ full_name: '山田' }, 'not-a-uuid'), env());
    expect(res.status).toBe(400);
    expect(mocks.getFormById).not.toHaveBeenCalled();
    expect(mocks.getFormSubmissionById).not.toHaveBeenCalled();
    expect(mocks.createFormSubmission).not.toHaveBeenCalled();
  });

  test('判定落ちではキーを消費せず、直して同じキーで送り直せる', async () => {
    // 必須が空で400。保存していないのでキーは残る。
    const rejected = await app().fetch(submitRequest({}), env());
    expect(rejected.status).toBe(400);
    expect(mocks.createFormSubmission).not.toHaveBeenCalled();

    const retried = await app().fetch(submitRequest({ full_name: '山田' }), env());
    expect(retried.status).toBe(201);
  });

  test('期限切れのキーの再送は新しいキーでの送り直しを求める', async () => {
    const first = await app().fetch(submitRequest({ full_name: '山田' }), env());
    expect(first.status).toBe(201);
    const hash = (mocks.createFormSubmission.mock.calls[0][1] as Record<string, unknown>).idempotencyHash;
    mocks.getFormSubmissionById.mockResolvedValue(submissionRow({
      idempotency_hash: hash,
      idempotency_expires_at: '2026-08-19T00:00:00.000Z',
    }));

    const res = await app().fetch(submitRequest({ full_name: '山田' }), env());
    expect(res.status).toBe(409);
    expect(mocks.createFormSubmission).toHaveBeenCalledTimes(1);
  });

  test('回答期限後の再送は最初の結果をそのまま返す', async () => {
    const first = await app().fetch(submitRequest({ full_name: '山田' }), env());
    expect(first.status).toBe(201);
    const hash = (mocks.createFormSubmission.mock.calls[0][1] as Record<string, unknown>).idempotencyHash;

    // 締め切り後でも、受け付け済みの再送は断らない
    const layout = simpleLayout();
    layout.options.deadline = { enabled: true, endsAt: '2026-08-19T23:59', message: '締め切りました' };
    mocks.getFormById.mockResolvedValue(formRow(layout));
    mocks.getFormSubmissionById.mockResolvedValue(submissionRow({ idempotency_hash: hash }));

    const replayed = await app().fetch(submitRequest({ full_name: '山田' }), env());
    expect(replayed.status).toBe(200);

    // 新しいキーでの送信は締め切りで断る
    mocks.getFormSubmissionById.mockResolvedValue(null);
    const fresh = await app().fetch(submitRequest({ full_name: '山田' }, KEY_2), env());
    expect(fresh.status).toBe(400);
  });
});
