import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const mocks = vi.hoisted(() => ({
  getFormById: vi.fn(),
  getFormAccountIds: vi.fn(),
  getFormDeleteImpact: vi.fn(),
  archiveFormAtRevision: vi.fn(),
  deleteFormAtRevision: vi.fn(),
  getFriendByLineUserIdForAccount: vi.fn(),
  createFormSubmission: vi.fn(),
  createForm: vi.fn(),
  getFormSubmissions: vi.fn(),
  getFormSubmissionsPage: vi.fn(),
  verifyCallerLineIdentity: vi.fn(),
  getLineAccountById: vi.fn(),
  dispatchLineProxyLocally: vi.fn(),
  formBelongsToLineAccount: vi.fn(),
  canAccessAllLineAccounts: vi.fn(),
}));

vi.mock('@line-crm/db', () => ({
  getForms: vi.fn(),
  getFormsWithStats: vi.fn(),
  getFormById: mocks.getFormById,
  getFormAccountIds: mocks.getFormAccountIds,
  getFormDeleteImpact: mocks.getFormDeleteImpact,
  formBelongsToLineAccount: mocks.formBelongsToLineAccount,
  createForm: mocks.createForm,
  updateForm: vi.fn(),
  archiveFormAtRevision: mocks.archiveFormAtRevision,
  deleteFormAtRevision: mocks.deleteFormAtRevision,
  getFormSubmissions: mocks.getFormSubmissions,
  getFormSubmissionsPage: mocks.getFormSubmissionsPage,
  createFormSubmission: mocks.createFormSubmission,
  getFriendByLineUserIdForAccount: mocks.getFriendByLineUserIdForAccount,
  getFriendById: vi.fn(),
  getTrackedLinkById: vi.fn(),
  getMessageTemplateById: vi.fn(),
  getLineAccountById: mocks.getLineAccountById,
  enrollFriendInScenario: vi.fn(),
  applyMileageRulesForEvent: vi.fn(),
  jstNow: vi.fn(() => '2026-08-04T12:00:00+09:00'),
}));

vi.mock('../services/liff-auth.js', () => ({
  verifyCallerLineIdentity: mocks.verifyCallerLineIdentity,
}));

vi.mock('../services/friend-tag-attach.js', () => ({
  attachTagAndFireSideEffects: vi.fn(),
}));

vi.mock('../services/local-line-proxy.js', () => ({
  dispatchLineProxyLocally: mocks.dispatchLineProxyLocally,
}));

vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: mocks.canAccessAllLineAccounts,
}));

import { forms } from './forms.js';

const baseForm = {
  id: 'form-1',
  name: '診断フォーム',
  description: '説明',
  fields: JSON.stringify([{ name: 'x_username', label: 'X ID', type: 'text' }]),
  on_submit_tag_id: 'tag-secret-id',
  on_submit_scenario_id: 'scenario-secret-id',
  on_submit_message_type: 'text',
  on_submit_message_content: '完了しました',
  on_submit_webhook_url:
    'https://verify.example.test/api/engagement-gates/gate-1/verify?username={x_username}',
  on_submit_webhook_headers: JSON.stringify({ Authorization: 'Bearer secret' }),
  on_submit_webhook_fail_message: '条件を満たしていません',
  save_to_metadata: 1,
  is_active: 1,
  status: 'active',
  archived_at: null,
  revision: 4,
  submit_count: 10,
  og_title: null,
  og_description: null,
  og_image_url: null,
  created_at: '2026-01-01T00:00:00+09:00',
  updated_at: '2026-08-01T00:00:00+09:00',
};

function env() {
  const run = vi.fn(async () => ({ success: true }));
  const bind = vi.fn((..._args: unknown[]) => ({ run }));
  const prepare = vi.fn((_sql: string) => ({ bind }));
  return {
    bindings: {
      DB: { prepare } as unknown as D1Database,
      LINE_CHANNEL_ACCESS_TOKEN: 'line-token',
      LINE_LOGIN_CHANNEL_ID: 'login-channel',
      WORKER_URL: 'https://worker.example.test',
    } as Env['Bindings'],
    prepare,
    bind,
  };
}

function app(asAdmin = false) {
  const a = new Hono<Env>();
  if (asAdmin) {
    a.use('/api/forms/*', async (c, next) => {
      c.set('staff', { id: 'owner-1', name: 'Owner', role: 'owner', readOnly: false });
      return next();
    });
  }
  a.route('/', forms);
  return a;
}

beforeEach(() => {
  mocks.getFormById.mockResolvedValue({ ...baseForm });
  mocks.getFormAccountIds.mockResolvedValue(['account-a']);
  mocks.getFormDeleteImpact.mockResolvedValue({
    form: { id: 'form-1', name: '診断フォーム', isActive: true, status: 'active' },
    submissionCount: 3,
    openCount: 8,
    references: [],
    referenceCount: 0,
    answerUrl: 'https://liff.line.me/liff-a/?page=form&id=form-1',
    revision: 4,
    checkedAt: '2026-08-31T12:00:00+09:00',
    canDelete: false,
    canArchive: true,
    recommendedAction: 'archive',
    blockers: ['published', 'has_submissions', 'has_opens'],
  });
  mocks.archiveFormAtRevision.mockResolvedValue({
    ...baseForm,
    is_active: 0,
    status: 'archived',
    archived_at: '2026-08-31T12:01:00+09:00',
    revision: 5,
  });
  mocks.deleteFormAtRevision.mockResolvedValue(true);
  mocks.verifyCallerLineIdentity.mockResolvedValue(null);
  mocks.getFriendByLineUserIdForAccount.mockResolvedValue(null);
  mocks.formBelongsToLineAccount.mockResolvedValue(true);
  mocks.canAccessAllLineAccounts.mockResolvedValue(true);
  mocks.createFormSubmission.mockImplementation(async (_db, input) => ({
    id: 'submission-1',
    form_id: input.formId,
    friend_id: input.friendId,
    data: input.data,
    created_at: '2026-08-04T12:00:00+09:00',
  }));
  mocks.createForm.mockResolvedValue({
    ...baseForm,
    id: 'draft-form-1',
    name: '名称未設定のフォーム',
    fields: '[]',
    layout: null,
    is_active: 0,
    submit_count: 0,
  });
  mocks.dispatchLineProxyLocally.mockResolvedValue(new Response(null, { status: 200 }));
});

describe('draft creation', () => {
  test('creates an inactive draft before opening the editor', async () => {
    const { bindings } = env();
    const res = await app(true).request('/api/forms/drafts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: 'account-a' }),
    }, bindings);
    expect(res.status).toBe(201);
    expect(mocks.createForm).toHaveBeenCalledWith(bindings.DB, {
      name: '名称未設定のフォーム',
      fields: '[]',
      layout: null,
      isActive: false,
      lineAccountIds: ['account-a'],
    });
    const body = await res.json() as { data: { id: string; isActive: boolean } };
    expect(body.data).toMatchObject({ id: 'draft-form-1', isActive: false });
  });

  test('does not let an unauthenticated caller create a draft', async () => {
    const { bindings } = env();
    const res = await app().request('/api/forms/drafts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }, bindings);
    expect(res.status).toBe(403);
    expect(mocks.createForm).not.toHaveBeenCalled();
  });
});

describe('LINE公式アカウントの範囲', () => {
  test('所属していないフォームの管理設定を返さない', async () => {
    mocks.formBelongsToLineAccount.mockResolvedValue(false);
    const { bindings } = env();
    const res = await app(true).request(
      '/api/forms/form-1?account_id=account-other',
      {},
      bindings,
    );
    expect(res.status).toBe(404);
    expect(JSON.stringify(await res.json())).not.toContain('Bearer secret');
  });

  test('権限のないアカウントには下書きを作らない', async () => {
    mocks.canAccessAllLineAccounts.mockResolvedValue(false);
    const { bindings } = env();
    const res = await app(true).request('/api/forms/drafts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: 'account-other' }),
    }, bindings);
    expect(res.status).toBe(404);
    expect(mocks.createForm).not.toHaveBeenCalled();
  });

  test('別アカウントの友だちからの回答を保存しない', async () => {
    mocks.verifyCallerLineIdentity.mockResolvedValue({
      lineUserId: 'U-other',
      lineAccountId: 'account-other',
    });
    mocks.formBelongsToLineAccount.mockResolvedValue(false);
    const { bindings } = env();
    const res = await app().request('/api/forms/form-1/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer id-token' },
      body: JSON.stringify({ data: { x_username: 'other' } }),
    }, bindings);
    expect(res.status).toBe(404);
    expect(mocks.createFormSubmission).not.toHaveBeenCalled();
  });
});

describe('submission pagination compatibility', () => {
  test('returns the existing array shape when pagination is not requested', async () => {
    mocks.getFormSubmissions.mockResolvedValue([]);
    const { bindings } = env();
    const res = await app(true).request(
      '/api/forms/form-1/submissions?account_id=account-a',
      {},
      bindings,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, data: [] });
    expect(mocks.getFormSubmissions).toHaveBeenCalledWith(bindings.DB, 'form-1');
    expect(mocks.getFormSubmissionsPage).not.toHaveBeenCalled();
  });

  test('returns page metadata when the V6 list requests page and limit', async () => {
    mocks.getFormSubmissionsPage.mockResolvedValue({ items: [], total: 42, page: 2, limit: 20 });
    const { bindings } = env();
    const res = await app(true).request(
      '/api/forms/form-1/submissions?page=2&limit=20&account_id=account-a',
      {},
      bindings,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true,
      data: { items: [], total: 42, page: 2, limit: 20 },
    });
    expect(mocks.getFormSubmissionsPage).toHaveBeenCalledWith(
      bindings.DB,
      'form-1',
      { page: 2, limit: 20 },
    );
    expect(mocks.getFormSubmissions).not.toHaveBeenCalled();
  });

  test.each([
    ['999999', 200],
    ['-1', 20],
    ['NaN', 20],
  ])('回答一覧の limit=%s を最大200件以内へ直す', async (raw, expected) => {
    mocks.getFormSubmissionsPage.mockResolvedValue({ items: [], total: 0, page: 1, limit: expected });
    const { bindings } = env();
    const res = await app(true).request(
      `/api/forms/form-1/submissions?page=-1&limit=${raw}&account_id=account-a`,
      {},
      bindings,
    );
    expect(res.status).toBe(200);
    expect(mocks.getFormSubmissionsPage).toHaveBeenCalledWith(
      bindings.DB,
      'form-1',
      { page: 1, limit: expected },
    );
  });
});

describe('回答フォームの削除影響と保管', () => {
  test('フォーム名・公開状態・回答数・利用先・開けなくなるURLを返す', async () => {
    const { bindings } = env();
    const res = await app(true).request(
      '/api/forms/form-1/delete-impact?account_id=account-a',
      {},
      bindings,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      data: {
        form: { name: '診断フォーム', isActive: true },
        submissionCount: 3,
        openCount: 8,
        answerUrl: 'https://liff.line.me/liff-a/?page=form&id=form-1',
        recommendedAction: 'archive',
      },
    });
  });

  test('影響を取得できないときは0件を作らず503', async () => {
    mocks.getFormDeleteImpact.mockRejectedValueOnce(new Error('D1 unavailable'));
    const { bindings } = env();
    const res = await app(true).request(
      '/api/forms/form-1/delete-impact?account_id=account-a',
      {},
      bindings,
    );

    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain('submissionCount');
  });

  test('所属する全アカウントを見られなければ影響を漏らさない', async () => {
    mocks.getFormAccountIds.mockResolvedValueOnce(['account-a', 'account-secret']);
    mocks.canAccessAllLineAccounts
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const { bindings } = env();
    const res = await app(true).request(
      '/api/forms/form-1/delete-impact?account_id=account-a',
      {},
      bindings,
    );

    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).not.toContain('診断フォーム');
  });

  test('影響確認後に版が変わったら409で最新の影響を返す', async () => {
    const { bindings } = env();
    const res = await app(true).request(
      '/api/forms/form-1/archive?account_id=account-a',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: 3 }),
      },
      bindings,
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: 'form_delete_changed',
      data: { revision: 4, submissionCount: 3 },
    });
    expect(mocks.archiveFormAtRevision).not.toHaveBeenCalled();
  });

  test('保管は回答と利用先を残した件数を返す', async () => {
    const { bindings } = env();
    const res = await app(true).request(
      '/api/forms/form-1/archive?account_id=account-a',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: 4 }),
      },
      bindings,
    );

    expect(res.status).toBe(200);
    expect(mocks.archiveFormAtRevision).toHaveBeenCalledWith(bindings.DB, 'form-1', 4);
    expect(await res.json()).toMatchObject({
      data: {
        status: 'archived',
        retainedSubmissionCount: 3,
        retainedOpenCount: 8,
        retainedReferenceCount: 0,
        answerUrlUnavailable: true,
      },
    });
  });

  test('保管本文が16KiBを超えたら読む前後で413', async () => {
    const { bindings } = env();
    const res = await app(true).request(
      '/api/forms/form-1/archive?account_id=account-a',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: 4, padding: 'x'.repeat(17 * 1024) }),
      },
      bindings,
    );

    expect(res.status).toBe(413);
    expect(mocks.getFormDeleteImpact).not.toHaveBeenCalled();
  });

  test('公開・回答あり・利用中は物理削除せず保管を案内する', async () => {
    const { bindings } = env();
    const res = await app(true).request(
      '/api/forms/form-1?account_id=account-a&expected_revision=4',
      { method: 'DELETE' },
      bindings,
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: 'form_archive_required',
      data: { recommendedAction: 'archive' },
    });
    expect(mocks.deleteFormAtRevision).not.toHaveBeenCalled();
  });

  test('影響0件・非公開・同じ版だけを物理削除する', async () => {
    mocks.getFormDeleteImpact.mockResolvedValueOnce({
      form: { id: 'form-1', name: '空フォーム', isActive: false, status: 'active' },
      submissionCount: 0,
      openCount: 0,
      references: [],
      referenceCount: 0,
      answerUrl: null,
      revision: 4,
      checkedAt: '2026-08-31T12:00:00+09:00',
      canDelete: true,
      canArchive: true,
      recommendedAction: 'delete',
      blockers: [],
    });
    const { bindings } = env();
    const res = await app(true).request(
      '/api/forms/form-1?account_id=account-a&expected_revision=4',
      { method: 'DELETE' },
      bindings,
    );

    expect(res.status).toBe(200);
    expect(mocks.deleteFormAtRevision).toHaveBeenCalledWith(bindings.DB, 'form-1', 4);
  });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('public form representation', () => {
  test('redacts webhook secrets and internal automation IDs', async () => {
    const { bindings } = env();
    const res = await app().request('/api/forms/form-1', {}, bindings);
    expect(res.status).toBe(200);

    const body = await res.json() as { data: Record<string, unknown> };
    expect(body.data).toMatchObject({
      id: 'form-1',
      hasSubmitWebhook: true,
      webhookOrigin: 'https://verify.example.test',
      webhookGateId: 'gate-1',
    });
    expect(body.data).not.toHaveProperty('onSubmitWebhookUrl');
    expect(body.data).not.toHaveProperty('onSubmitWebhookHeaders');
    expect(body.data).not.toHaveProperty('onSubmitTagId');
    expect(body.data).not.toHaveProperty('onSubmitScenarioId');
    expect(JSON.stringify(body.data)).not.toContain('Bearer secret');
  });

  test('keeps the full representation for an authenticated admin', async () => {
    const { bindings } = env();
    const res = await app(true).request('/api/forms/form-1?account_id=account-a', {}, bindings);
    expect(res.status).toBe(200);

    const body = await res.json() as { data: Record<string, unknown> };
    expect(body.data.onSubmitWebhookUrl).toBe(baseForm.on_submit_webhook_url);
    expect(body.data.onSubmitWebhookHeaders).toBe(baseForm.on_submit_webhook_headers);
    expect(body.data.onSubmitTagId).toBe('tag-secret-id');
    expect(body.data.onSubmitScenarioId).toBe('scenario-secret-id');
  });
});

describe('LIFF identity enforcement', () => {
  test('stores every required AI consultation field including the selected meeting slot', async () => {
    mocks.getFormById.mockResolvedValue({
      ...baseForm,
      fields: JSON.stringify([
        { name: 'name', label: 'お名前', type: 'text', required: true },
        { name: 'company', label: '会社名・屋号', type: 'text', required: true },
        { name: 'annual_revenue', label: '年商規模', type: 'select', required: true },
        { name: 'budget', label: '予算感', type: 'select', required: true },
        { name: 'ai_goal', label: '改善したいこと', type: 'textarea', required: true },
        { name: 'meeting_date_1', label: '第1希望日', type: 'date', required: true },
        { name: 'meeting_time_1', label: '第1希望開始時刻', type: 'select', required: true },
      ]),
      on_submit_tag_id: null,
      on_submit_scenario_id: null,
      on_submit_message_type: null,
      on_submit_message_content: null,
      on_submit_webhook_url: null,
      on_submit_webhook_headers: null,
      on_submit_webhook_fail_message: null,
      save_to_metadata: 0,
    });
    mocks.verifyCallerLineIdentity.mockResolvedValue({ lineUserId: 'line-real', lineAccountId: 'account-a' });
    mocks.getFriendByLineUserIdForAccount.mockResolvedValue({
      id: 'friend-real',
      line_user_id: null,
      display_name: 'Real User',
      metadata: '{}',
    });
    const { bindings } = env();
    const data = {
      name: '山田太郎',
      company: '株式会社テスト',
      annual_revenue: '3,000万〜1億円',
      budget: '10万〜30万円',
      ai_goal: '問い合わせ対応を自動化したい',
      meeting_date_1: '2026-08-12',
      meeting_time_1: '14:30',
    };

    const res = await app().request('/api/forms/form-1/submit', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-line-id-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ data }),
    }, bindings);

    expect(res.status).toBe(201);
    expect(mocks.createFormSubmission).toHaveBeenCalledWith(bindings.DB, {
      formId: 'form-1',
      friendId: 'friend-real',
      data: JSON.stringify(data),
    });
  });

  test('rejects partial metadata writes without a valid LINE ID token', async () => {
    const { bindings, prepare } = env();
    const res = await app().request('/api/forms/form-1/partial', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ friendId: 'victim-friend', data: { score: 999 } }),
    }, bindings);

    expect(res.status).toBe(401);
    expect(mocks.getFriendByLineUserIdForAccount).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });

  test('writes partial metadata only to the token-authenticated friend', async () => {
    mocks.verifyCallerLineIdentity.mockResolvedValue({ lineUserId: 'line-real', lineAccountId: 'account-a' });
    mocks.getFriendByLineUserIdForAccount.mockResolvedValue({
      id: 'friend-real',
      metadata: JSON.stringify({ existing: true }),
    });
    const { bindings, bind } = env();

    const res = await app().request('/api/forms/form-1/partial', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-line-id-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ friendId: 'victim-friend', data: { score: 42 } }),
    }, bindings);

    expect(res.status).toBe(200);
    expect(mocks.getFriendByLineUserIdForAccount).toHaveBeenCalledWith(
      bindings.DB,
      'line-real',
      'account-a',
    );
    expect(bind).toHaveBeenCalledWith(
      JSON.stringify({ existing: true, score: 42 }),
      '2026-08-04T12:00:00+09:00',
      'friend-real',
    );
  });

  test('rejects submit without a valid LINE ID token even when a friendId is supplied', async () => {
    const { bindings } = env();
    const res = await app().request('/api/forms/form-1/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ friendId: 'victim-friend', data: { x_username: 'alice' } }),
    }, bindings);

    expect(res.status).toBe(401);
    expect(mocks.createFormSubmission).not.toHaveBeenCalled();
  });

  test('ignores _skipWebhook and checks the webhook for the authenticated friend', async () => {
    mocks.verifyCallerLineIdentity.mockResolvedValue({ lineUserId: 'line-real', lineAccountId: 'account-a' });
    mocks.getFriendByLineUserIdForAccount.mockResolvedValue({
      id: 'friend-real',
      line_user_id: null,
      display_name: 'Real User',
      metadata: '{}',
    });
    const webhookFetch = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async () => new Response(
      JSON.stringify({ eligible: false }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', webhookFetch);
    const { bindings } = env();

    const res = await app().request('/api/forms/form-1/submit', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-line-id-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        friendId: 'victim-friend',
        lineUserId: 'victim-line-user',
        _skipWebhook: true,
        data: { x_username: 'alice' },
      }),
    }, bindings);

    expect(res.status).toBe(201);
    expect(webhookFetch).toHaveBeenCalledOnce();
    expect(webhookFetch.mock.calls[0][0]).toBe(
      'https://verify.example.test/api/engagement-gates/gate-1/verify?username=alice',
    );
    expect(webhookFetch.mock.calls[0][1]).toMatchObject({
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer secret',
      },
    });
    expect(mocks.createFormSubmission).toHaveBeenCalledWith(bindings.DB, expect.objectContaining({
      formId: 'form-1',
      friendId: 'friend-real',
    }));
    expect(mocks.createFormSubmission).not.toHaveBeenCalledWith(
      bindings.DB,
      expect.objectContaining({ friendId: 'victim-friend' }),
    );
    expect((await res.json() as { data: { webhookPassed: boolean } }).data.webhookPassed).toBe(false);
  });

  test('webhook rejection reply goes through the Harness proxy', async () => {
    mocks.verifyCallerLineIdentity.mockResolvedValue({ lineUserId: 'line-real', lineAccountId: 'account-a' });
    mocks.getFriendByLineUserIdForAccount.mockResolvedValue({
      id: 'friend-real',
      line_user_id: 'U-real',
      line_account_id: null,
      display_name: 'Real User',
      metadata: '{}',
    });
    const fetchMock = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async (input) => {
      const url = String(input);
      if (url.startsWith('https://verify.example.test/')) {
        return new Response(JSON.stringify({ eligible: false }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(null, { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { bindings } = env();

    const res = await app().request('/api/forms/form-1/submit', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-line-id-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ data: { x_username: 'alice' } }),
    }, bindings);

    expect(res.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.dispatchLineProxyLocally).toHaveBeenCalledTimes(1);
    const proxyRequest = mocks.dispatchLineProxyLocally.mock.calls[0][0] as Request;
    expect(proxyRequest.url).toBe('http://localhost/line-api/v2/bot/message/push');
    expect(proxyRequest.headers.get('Authorization')).toBe('Bearer line-token');
    expect(await proxyRequest.json()).toEqual({
      to: 'U-real',
      messages: [{ type: 'text', text: '条件を満たしていません' }],
    });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('api.line.me'))).toBe(false);
  });
});
