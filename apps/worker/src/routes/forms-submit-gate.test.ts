import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { emptyLayout, newBlockId, type FormLayout } from '@line-crm/shared';
import type { Env } from '../index.js';

/**
 * 送信の入口が、レイアウトの判定に**本当につながっているか**を見る。
 *
 * 判定そのもの（期限・1人1回・定員・入力制限）は
 * `services/form-layout-effects.test.ts` で細かく見ている。ここで見るのは
 * 配線だけ——`POST /api/forms/:id/submit` から実際にその判定が呼ばれ、
 * 断られたら保存されないこと。
 *
 * 分けているのは、**部品が正しくても線がつながっていなければ動かない**から。
 * 判定を関数として試験していても、ルート側で `if (layout)` の条件を逆に
 * 書いたり、`form.layout` の読み方を間違えたりすれば、期限切れのフォームが
 * そのまま受け付けられる。その間違いは、部品の試験では映らない。
 */

const mocks = vi.hoisted(() => ({
  getFormById: vi.fn(),
  getFriendByLineUserIdForAccount: vi.fn(),
  getFriendById: vi.fn(),
  insertFormSubmissionRecord: vi.fn(),
  resyncFormSubmitCount: vi.fn(),
  createFormSubmitClaim: vi.fn(),
  getFormSubmitClaim: vi.fn(),
  takeoverFormSubmitClaim: vi.fn(),
  readFormSubmitClaimSteps: vi.fn(),
  appendFormSubmitClaimStep: vi.fn(),
  saveFormSubmitClaimWebhook: vi.fn(),
  completeFormSubmitClaim: vi.fn(),
  failFormSubmitClaim: vi.fn(),
  ensureFormSubmitOutboxEvent: vi.fn(),
  getFormSubmitOutbox: vi.fn(),
  markFormSubmitOutboxDelivered: vi.fn(),
  readFormSubmitOutboxPayload: vi.fn(),
  readFormSubmitClaimEffectStats: vi.fn(),
  saveFormSubmitClaimEffectStats: vi.fn(),
  findUnfinishedFormSubmitClaimByHash: vi.fn(),
  getFormSubmissionById: vi.fn(),
  applyMileageRulesForEvent: vi.fn(),
  updateFormSubmissionDestinationWriteResult: vi.fn(),
  verifyCallerLineIdentity: vi.fn(),
  countFormSubmissionsByFriend: vi.fn(),
  countChoiceUsage: vi.fn(),
  attachTag: vi.fn(),
  setFriendFieldValue: vi.fn(),
  getFriendFieldById: vi.fn(),
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
  getFormSubmissionAnalytics: vi.fn(),
  getLatestFormSubmission: vi.fn(),
  insertFormSubmissionRecord: mocks.insertFormSubmissionRecord,
  resyncFormSubmitCount: mocks.resyncFormSubmitCount,
  createFormSubmitClaim: mocks.createFormSubmitClaim,
  getFormSubmitClaim: mocks.getFormSubmitClaim,
  takeoverFormSubmitClaim: mocks.takeoverFormSubmitClaim,
  readFormSubmitClaimSteps: mocks.readFormSubmitClaimSteps,
  appendFormSubmitClaimStep: mocks.appendFormSubmitClaimStep,
  saveFormSubmitClaimWebhook: mocks.saveFormSubmitClaimWebhook,
  completeFormSubmitClaim: mocks.completeFormSubmitClaim,
  failFormSubmitClaim: mocks.failFormSubmitClaim,
  ensureFormSubmitOutboxEvent: mocks.ensureFormSubmitOutboxEvent,
  getFormSubmitOutbox: mocks.getFormSubmitOutbox,
  markFormSubmitOutboxDelivered: mocks.markFormSubmitOutboxDelivered,
  readFormSubmitOutboxPayload: mocks.readFormSubmitOutboxPayload,
  readFormSubmitClaimEffectStats: mocks.readFormSubmitClaimEffectStats,
  saveFormSubmitClaimEffectStats: mocks.saveFormSubmitClaimEffectStats,
  findUnfinishedFormSubmitClaimByHash: mocks.findUnfinishedFormSubmitClaimByHash,
  getFormSubmissionById: mocks.getFormSubmissionById,
  applyMileageRulesForEvent: mocks.applyMileageRulesForEvent,
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

import { forms } from './forms.js';

/** ラジオ1つ・必須のテキスト1つを持つフォーム。 */
function layoutWithChoice(): FormLayout {
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
    {
      id: newBlockId(),
      kind: 'input',
      type: 'radio',
      name: 'pet',
      label: '飼っている子',
      choiceMode: 'tag',
      choices: [
        { id: 'c1', label: '犬', tagId: 'tag-dog' },
        { id: 'c2', label: '猫', tagId: 'tag-cat' },
      ],
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

function submit(data: Record<string, unknown>) {
  return new Request('https://worker.example.test/api/forms/form-1/submit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'test-bearer-token',
      'Idempotency-Key': '11111111-2222-4333-8444-555555555555',
    },
    body: JSON.stringify({ data }),
  });
}

async function errorOf(res: Response): Promise<string> {
  const body = (await res.json()) as { error?: string };
  return body.error ?? '';
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
  mocks.getFormSubmitClaim.mockResolvedValue(null);
  mocks.createFormSubmitClaim.mockImplementation(async (_db, input) => ({
    claimed: true,
    claim: { ...input, status: 'in_progress', steps: '[]', owner: input.owner },
  }));
  mocks.readFormSubmitClaimSteps.mockReturnValue([]);
  mocks.appendFormSubmitClaimStep.mockResolvedValue(true);
  mocks.saveFormSubmitClaimWebhook.mockResolvedValue(true);
  mocks.completeFormSubmitClaim.mockResolvedValue(true);
  mocks.failFormSubmitClaim.mockResolvedValue(true);
  mocks.findUnfinishedFormSubmitClaimByHash.mockResolvedValue(null);
  mocks.readFormSubmitClaimEffectStats.mockReturnValue({});
  mocks.saveFormSubmitClaimEffectStats.mockResolvedValue(true);
  mocks.ensureFormSubmitOutboxEvent.mockImplementation(async (_db, _scope, _kind, eventId) => ({
    event_id: eventId,
    status: 'pending',
    payload: null,
  }));
  mocks.getFormSubmitOutbox.mockResolvedValue(null);
  mocks.markFormSubmitOutboxDelivered.mockResolvedValue(true);
  mocks.readFormSubmitOutboxPayload.mockReturnValue(null);
  const answer = {
    id: 'submission-1',
    form_id: 'form-1',
    friend_id: 'friend-1',
    data: JSON.stringify({ full_name: '山田' }),
    destination_write_status: 'pending',
    destination_write_attempted: null,
    destination_write_succeeded: null,
    destination_write_failed: null,
    destination_write_completed_at: null,
    created_at: '2026-08-20T12:00:00+09:00',
  };
  const answers = new Map<string, typeof answer>();
  answers.set('submission-1', { ...answer });
  mocks.insertFormSubmissionRecord.mockImplementation(async (_db, input) => {
    const row = {
      ...answer,
      id: input.id ?? 'submission-1',
      form_id: input.formId,
      friend_id: input.friendId ?? null,
      data: input.data,
    };
    answers.set(row.id, row);
    return { ...row };
  });
  mocks.getFormSubmissionById.mockImplementation(async (_db, id) => {
    const row = answers.get(id);
    return row ? { ...row } : null;
  });
  mocks.resyncFormSubmitCount.mockResolvedValue(undefined);
  mocks.applyMileageRulesForEvent.mockResolvedValue({ event: {}, granted: [], queued: true });
  mocks.updateFormSubmissionDestinationWriteResult.mockResolvedValue('not_requested');
});

describe('送信の入口が、レイアウトの判定につながっている', () => {
  test('必須が空なら、保存せずに断る', async () => {
    mocks.getFormById.mockResolvedValue(formRow(layoutWithChoice()));

    const res = await app().fetch(submit({ pet: '犬' }), env());

    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe('お名前 は必須項目です');
    expect(mocks.insertFormSubmissionRecord).not.toHaveBeenCalled();
  });

  test('用意していない選択肢は、保存せずに断る', async () => {
    mocks.getFormById.mockResolvedValue(formRow(layoutWithChoice()));

    const res = await app().fetch(submit({ full_name: '山田', pet: '鳥' }), env());

    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe('飼っている子 に無い選択肢が選ばれています');
    expect(mocks.insertFormSubmissionRecord).not.toHaveBeenCalled();
  });

  test('回答期限を過ぎていたら、保存せずに断る', async () => {
    const layout = layoutWithChoice();
    layout.options.deadline = {
      enabled: true,
      endsAt: '2026-08-19T23:59',
      message: '締め切りました',
    };
    mocks.getFormById.mockResolvedValue(formRow(layout));

    const res = await app().fetch(submit({ full_name: '山田' }), env());

    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe('締め切りました');
    expect(mocks.insertFormSubmissionRecord).not.toHaveBeenCalled();
  });

  test('1人1回のフォームに2回目を送ると、保存せずに断る', async () => {
    const layout = layoutWithChoice();
    layout.options.oncePerFriend = { enabled: true, message: '1回だけです' };
    mocks.getFormById.mockResolvedValue(formRow(layout));
    mocks.countFormSubmissionsByFriend.mockResolvedValue(1);

    const res = await app().fetch(submit({ full_name: '山田' }), env());

    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe('1回だけです');
    expect(mocks.insertFormSubmissionRecord).not.toHaveBeenCalled();
  });

  test('全体の受付数に達していたら、保存せずに断る', async () => {
    const layout = layoutWithChoice();
    layout.options.totalLimit = { enabled: true, max: 10 };
    mocks.getFormById.mockResolvedValue(formRow(layout, { submit_count: 10 }));

    const res = await app().fetch(submit({ full_name: '山田' }), env());

    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe('このフォームは受付を終了しました');
    expect(mocks.insertFormSubmissionRecord).not.toHaveBeenCalled();
  });

  test('定員が埋まった選択肢を選ぶと、保存せずに断る', async () => {
    const layout = emptyLayout();
    layout.sections[0].blocks = [
      {
        id: newBlockId(),
        kind: 'input',
        type: 'radio',
        name: 'slot',
        label: '希望の回',
        choiceMode: 'tag',
        choices: [{ id: 'c1', label: '午前', capacity: { enabled: true, limit: 2 } }],
      },
    ];
    mocks.getFormById.mockResolvedValue(formRow(layout));
    mocks.countChoiceUsage.mockResolvedValue(new Map([['午前', 2]]));

    const res = await app().fetch(submit({ slot: '午前' }), env());

    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe('「午前」は定員に達しました');
    expect(mocks.insertFormSubmissionRecord).not.toHaveBeenCalled();
  });

  test('通れば保存し、選んだ選択肢のタグが付く', async () => {
    mocks.getFormById.mockResolvedValue(formRow(layoutWithChoice()));

    const res = await app().fetch(submit({ full_name: '山田', pet: '猫' }), env());

    expect(res.status).toBe(201);
    expect(mocks.insertFormSubmissionRecord).toHaveBeenCalledTimes(1);
    const createdId = (
      mocks.insertFormSubmissionRecord.mock.calls[0][1] as { id: string }
    ).id;
    expect(mocks.updateFormSubmissionDestinationWriteResult).toHaveBeenCalledWith(
      expect.anything(),
      createdId,
      { attempted: 0, succeeded: 0, failed: 0 },
    );

    // 選んだほうだけが付く
    const attached = mocks.attachTag.mock.calls.map((call) => call[2]);
    expect(attached).toEqual(['tag-cat']);
  });

  test('レイアウトを持たない古いフォームは、これまでどおり fields の必須だけを見る', async () => {
    // 期限や1人1回は layout にしか無い。古いフォームで新しい判定が
    // 走ってしまうと、これまで通っていた送信が理由もなく断られる。
    mocks.getFormById.mockResolvedValue(formRow(null));

    const rejected = await app().fetch(submit({}), env());
    expect(rejected.status).toBe(400);
    expect(await errorOf(rejected)).toBe('お名前 は必須項目です');

    const accepted = await app().fetch(submit({ full_name: '山田' }), env());
    expect(accepted.status).toBe(201);
    expect(mocks.countFormSubmissionsByFriend).not.toHaveBeenCalled();
    expect(mocks.countChoiceUsage).not.toHaveBeenCalled();
  });
});
