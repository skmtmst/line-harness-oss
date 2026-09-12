import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { emptyLayout, newBlockId, type FormLayout } from '@line-crm/shared';
import type { Env } from '../index.js';

/**
 * フォーム回答の冪等化(N-165)の契約テスト。
 *
 * 外部副作用(Webhook・LINE通知)より前に scope
 * (テナント・LINEアカウント・フォーム・友だち・キー)つきの予約行を原子的に
 * 確保し、同時送信の片方だけが処理を進める。途中失敗は failed に残し、
 * 同じキーでの再送が未完の工程だけを補完する。
 *
 * 予約の原子性はこのファイル内の共有 Map で clock 単位の compare-and-set
 * として再現する(JS の1スレッドでは同期的な確認+確保が原子になる)。
 * 制約そのものの保証は packages/db の実 SQL テストが持つ。
 */

const KEY = '11111111-2222-4333-8444-555555555555';
const KEY_2 = '22222222-3333-4444-8555-666666666666';

type ClaimRow = {
  tenant_id: string;
  line_account_id: string;
  form_id: string;
  friend_id: string;
  idempotency_key: string;
  request_hash: string;
  status: 'in_progress' | 'failed' | 'completed';
  steps: string;
  webhook: string | null;
  submission_id: string | null;
  owner: string;
  version: number;
  lease_generation: number;
  effect_stats: string;
  created_at: string;
  updated_at: string;
  expires_at: string;
};

type OutboxRow = {
  event_id: string;
  status: 'pending' | 'delivered';
  payload: string | null;
};

const claimStore = new Map<string, ClaimRow>();
const answerStore = new Map<string, Record<string, unknown>>();
const outboxStore = new Map<string, OutboxRow>();
const scopeKeyOf = (tenant: string, account: string, form: string, friend: string, key: string) =>
  [tenant, account, form, friend, key].join('\x00');

const failures = {
  insertAnswerOnce: false,
  resyncCountOnce: false,
  attachTagOnce: false,
  mileageOnce: false,
  layoutPartialOnce: false,
  pushOnce: false,
  saveWebhookOnce: false,
  markOutboxOnce: false,
};

const mocks = vi.hoisted(() => ({
  getFormById: vi.fn(),
  getFormSubmitClaim: vi.fn(),
  createFormSubmitClaim: vi.fn(),
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
  insertFormSubmissionRecord: vi.fn(),
  resyncFormSubmitCount: vi.fn(),
  getFriendByLineUserIdForAccount: vi.fn(),
  getFriendById: vi.fn(),
  getLineAccountById: vi.fn(),
  createFormSubmission: vi.fn(),
  updateFormSubmissionDestinationWriteResult: vi.fn(),
  verifyCallerLineIdentity: vi.fn(),
  countFormSubmissionsByFriend: vi.fn(),
  countChoiceUsage: vi.fn(),
  attachTag: vi.fn(),
  setFriendFieldValue: vi.fn(),
  getFriendFieldById: vi.fn(),
  applyMileageRulesForEvent: vi.fn(),
  applyLayout: vi.fn(),
  realApplyLayout: null as unknown as (input: never) => Promise<never>,
  formBelongsToLineAccount: vi.fn(),
  pushViaHarnessProxy: vi.fn(),
}));

vi.mock('@line-crm/db', () => ({
  // #648: 成果計測は packages/db へ移した。この差し替えに書き出しが無いと、
  // 呼び出し口が 500 になる。数えること自体は実DBの試験で見ている。
  recordConversionSourceEvent: vi.fn(async () => ({ matched: 0, recorded: 0, failed: 0, skipped: null })),
  getForms: vi.fn(),
  getFormsWithStats: vi.fn(),
  getFormById: mocks.getFormById,
  formBelongsToLineAccount: mocks.formBelongsToLineAccount,
  getFormSubmitClaim: mocks.getFormSubmitClaim,
  createFormSubmitClaim: mocks.createFormSubmitClaim,
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
  insertFormSubmissionRecord: mocks.insertFormSubmissionRecord,
  resyncFormSubmitCount: mocks.resyncFormSubmitCount,
  getFriendByLineUserIdForAccount: mocks.getFriendByLineUserIdForAccount,
  getFriendById: mocks.getFriendById,
  getLineAccountById: mocks.getLineAccountById,
  getTrackedLinkById: vi.fn(),
  getMessageTemplateById: vi.fn(),
  createForm: vi.fn(),
  updateForm: vi.fn(),
  deleteForm: vi.fn(),
  getFormSubmissions: vi.fn(),
  getFormSubmissionsPage: vi.fn(),
  getFormSubmissionAnalytics: vi.fn(),
  getLatestFormSubmission: vi.fn(),
  createFormSubmission: mocks.createFormSubmission,
  updateFormSubmissionDestinationWriteResult: mocks.updateFormSubmissionDestinationWriteResult,
  enrollFriendInScenario: vi.fn(),
  enrollFriendInReminder: vi.fn(),
  removeTagFromFriend: vi.fn(),
  setFriendFieldValue: mocks.setFriendFieldValue,
  getFriendFieldById: mocks.getFriendFieldById,
  countFormSubmissionsByFriend: mocks.countFormSubmissionsByFriend,
  countChoiceUsage: mocks.countChoiceUsage,
  applyMileageRulesForEvent: mocks.applyMileageRulesForEvent,
  jstNow: vi.fn(() => '2026-08-20T12:00:00+09:00'),
  toJstString: vi.fn((date: Date) => date.toISOString()),
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
  pushViaHarnessProxy: mocks.pushViaHarnessProxy,
}));

vi.mock('../services/form-layout-effects.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/form-layout-effects.js')>();
  mocks.realApplyLayout = actual.applyFormLayoutEffects as never;
  return { ...actual, applyFormLayoutEffects: mocks.applyLayout };
});

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

function answerRow(id: string, data: unknown) {
  return {
    id,
    form_id: 'form-1',
    friend_id: 'friend-1',
    data: typeof data === 'string' ? data : JSON.stringify(data),
    destination_write_status: 'pending',
    destination_write_attempted: null,
    destination_write_succeeded: null,
    destination_write_failed: null,
    destination_write_completed_at: null,
    created_at: '2026-08-20T12:00:00+09:00',
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
  key: string = KEY,
  extra: Record<string, unknown> = {},
) {
  return new Request('https://worker.example.test/api/forms/form-1/submit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer dummy-redacted-auth',
      'Idempotency-Key': key,
    },
    body: JSON.stringify({ data, ...extra }),
  });
}

function readSteps(row: ClaimRow): string[] {
  try {
    const parsed: unknown = JSON.parse(row.steps || '[]');
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

mocks.readFormSubmitClaimSteps.mockImplementation((claim: { steps: string }) => readSteps(claim as ClaimRow));

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function stubWebhookOncePending() {
  let release!: (response: Response) => void;
  const gate = new Promise<Response>((resolve) => { release = resolve; });
  const fetchMock = vi.fn(async () => gate);
  vi.stubGlobal('fetch', fetchMock);
  return {
    fetchMock,
    release: (body: unknown = { eligible: true }) => release(
      new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    ),
  };
}

function stubWebhookPassing() {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(
    JSON.stringify({ eligible: true }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  ));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.clearAllMocks();
  claimStore.clear();
  answerStore.clear();
  outboxStore.clear();
  failures.insertAnswerOnce = false;
  failures.resyncCountOnce = false;
  failures.attachTagOnce = false;
  failures.mileageOnce = false;
  failures.layoutPartialOnce = false;
  failures.pushOnce = false;
  failures.saveWebhookOnce = false;
  failures.markOutboxOnce = false;

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
  mocks.getFriendById.mockResolvedValue({
    id: 'friend-1',
    line_user_id: 'U-line-user',
    metadata: '{}',
    display_name: 'テスト',
  });
  mocks.getLineAccountById.mockResolvedValue({ id: 'account-a', tenant_id: 'tenant-1' });
  mocks.countFormSubmissionsByFriend.mockResolvedValue(0);
  mocks.countChoiceUsage.mockResolvedValue(new Map());
  mocks.getFriendFieldById.mockResolvedValue({ id: 'ff-1', ec_is_master: 0 });
  mocks.getFormById.mockResolvedValue(formRow(simpleLayout()));
  mocks.pushViaHarnessProxy.mockImplementation(async () => {
    if (failures.pushOnce) {
      failures.pushOnce = false;
      throw new Error('push failed');
    }
  });
  mocks.applyMileageRulesForEvent.mockImplementation(async () => {
    if (failures.mileageOnce) {
      failures.mileageOnce = false;
      throw new Error('mileage DB failed');
    }
    return { event: {}, granted: [], queued: true };
  });
  mocks.applyLayout.mockImplementation((input: never) => {
    if (failures.layoutPartialOnce) {
      failures.layoutPartialOnce = false;
      return Promise.resolve({ destinationWrites: { attempted: 0, succeeded: 0, failed: 0 }, failedEffects: ['choices:x'] });
    }
    return mocks.realApplyLayout(input);
  });

  // 予約表の実挙動を再現する。確認+確保は同期的に行い、同時送信の片方だけが
  // true で返る(主キーの原子性の再現)。
  mocks.createFormSubmitClaim.mockImplementation(async (_db, input) => {
    const key = scopeKeyOf(input.tenantId, input.lineAccountId, input.formId, input.friendId, input.key);
    const existing = claimStore.get(key);
    if (existing) return { claimed: false, claim: { ...existing } };
    const row: ClaimRow = {
      tenant_id: input.tenantId,
      line_account_id: input.lineAccountId,
      form_id: input.formId,
      friend_id: input.friendId,
      idempotency_key: input.key,
      request_hash: input.requestHash,
      status: 'in_progress',
      steps: '[]',
      webhook: null,
      submission_id: input.submissionId,
      owner: input.owner,
      version: 1,
      lease_generation: 1,
      effect_stats: '{}',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      expires_at: input.expiresAt,
    };
    claimStore.set(key, row);
    return { claimed: true, claim: { ...row } };
  });
  mocks.getFormSubmitClaim.mockImplementation(async (_db, scope) => {
    const row = claimStore.get(scopeKeyOf(scope.tenantId, scope.lineAccountId, scope.formId, scope.friendId, scope.key));
    return row ? { ...row } : null;
  });
  // 読み取った所有者と版の CAS で横取りし、版と世代を進める。
  mocks.takeoverFormSubmitClaim.mockImplementation(async (_db, scope, owner, staleBefore, observed) => {
    const key = scopeKeyOf(scope.tenantId, scope.lineAccountId, scope.formId, scope.friendId, scope.key);
    const row = claimStore.get(key);
    if (!row) return { taken: false, generation: 0 };
    if (row.owner !== observed.owner || row.version !== observed.version) {
      return { taken: false, generation: 0 };
    }
    if (row.status === 'failed' || (row.status === 'in_progress' && row.updated_at < staleBefore)) {
      row.owner = owner;
      row.status = 'in_progress';
      row.version += 1;
      row.lease_generation += 1;
      row.updated_at = new Date().toISOString();
      return { taken: true, generation: row.lease_generation };
    }
    return { taken: false, generation: 0 };
  });
  mocks.appendFormSubmitClaimStep.mockImplementation(async (_db, scope, owner, step, version) => {
    const key = scopeKeyOf(scope.tenantId, scope.lineAccountId, scope.formId, scope.friendId, scope.key);
    const row = claimStore.get(key);
    if (!row || row.owner !== owner || row.version !== version) return false;
    const steps = readSteps(row);
    if (!steps.includes(step)) steps.push(step);
    row.steps = JSON.stringify(steps);
    row.updated_at = new Date().toISOString();
    return true;
  });
  mocks.saveFormSubmitClaimWebhook.mockImplementation(async (_db, scope, owner, webhook, version) => {
    if (failures.saveWebhookOnce) {
      failures.saveWebhookOnce = false;
      // 送達後の停止の再現。投げた失敗は予約を failed に残し、再開へ託す。
      throw new Error('claim save failed');
    }
    const key = scopeKeyOf(scope.tenantId, scope.lineAccountId, scope.formId, scope.friendId, scope.key);
    const row = claimStore.get(key);
    if (!row || row.owner !== owner || row.version !== version) return false;
    row.webhook = JSON.stringify(webhook);
    row.updated_at = new Date().toISOString();
    return mocks.appendFormSubmitClaimStep(_db, scope, owner, 'webhook', version);
  });
  mocks.completeFormSubmitClaim.mockImplementation(async (_db, scope, owner, version) => {
    const key = scopeKeyOf(scope.tenantId, scope.lineAccountId, scope.formId, scope.friendId, scope.key);
    const row = claimStore.get(key);
    if (!row || row.owner !== owner || row.version !== version) return false;
    row.status = 'completed';
    row.updated_at = new Date().toISOString();
    return true;
  });
  mocks.failFormSubmitClaim.mockImplementation(async (_db, scope, owner, version) => {
    const key = scopeKeyOf(scope.tenantId, scope.lineAccountId, scope.formId, scope.friendId, scope.key);
    const row = claimStore.get(key);
    if (!row || row.owner !== owner || row.version !== version) return false;
    row.status = 'failed';
    row.updated_at = new Date().toISOString();
    return true;
  });
  mocks.ensureFormSubmitOutboxEvent.mockImplementation(async (_db, scope, kind, eventId) => {
    const key = `${scopeKeyOf(scope.tenantId, scope.lineAccountId, scope.formId, scope.friendId, scope.key)}|${kind}`;
    const existing = outboxStore.get(key);
    if (existing) return { ...existing };
    const row: OutboxRow = { event_id: eventId, status: 'pending', payload: null };
    outboxStore.set(key, row);
    return { ...row };
  });
  mocks.getFormSubmitOutbox.mockImplementation(async (_db, scope, kind) => {
    const row = outboxStore.get(`${scopeKeyOf(scope.tenantId, scope.lineAccountId, scope.formId, scope.friendId, scope.key)}|${kind}`);
    return row ? { ...row } : null;
  });
  mocks.markFormSubmitOutboxDelivered.mockImplementation(async (_db, scope, kind, eventId, payload) => {
    if (failures.markOutboxOnce) {
      failures.markOutboxOnce = false;
      throw new Error('outbox mark failed');
    }
    const key = `${scopeKeyOf(scope.tenantId, scope.lineAccountId, scope.formId, scope.friendId, scope.key)}|${kind}`;
    const row = outboxStore.get(key);
    if (!row || row.event_id !== eventId || row.status !== 'pending') return false;
    row.status = 'delivered';
    row.payload = JSON.stringify(payload);
    return true;
  });
  mocks.readFormSubmitOutboxPayload.mockImplementation((payload: string | null) => {
    if (!payload) return null;
    try {
      const parsed = JSON.parse(payload) as { passed?: unknown; data?: unknown };
      if (!parsed || typeof parsed.passed !== 'boolean') return null;
      return { passed: parsed.passed, data: parsed.data };
    } catch {
      return null;
    }
  });
  mocks.readFormSubmitClaimEffectStats.mockImplementation((claim: { effect_stats: string }) => {
    try {
      const parsed: unknown = JSON.parse(claim.effect_stats || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, { attempted: number; succeeded: number; failed: number }>
        : {};
    } catch {
      return {};
    }
  });
  mocks.saveFormSubmitClaimEffectStats.mockImplementation(
    async (_db, scope, owner, version, effectId, stats) => {
      const key = scopeKeyOf(scope.tenantId, scope.lineAccountId, scope.formId, scope.friendId, scope.key);
      const row = claimStore.get(key);
      if (!row || row.owner !== owner || row.version !== version) return false;
      const merged = mocks.readFormSubmitClaimEffectStats(row);
      merged[effectId] = stats;
      row.effect_stats = JSON.stringify(merged);
      row.updated_at = new Date().toISOString();
      return true;
    },
  );
  mocks.findUnfinishedFormSubmitClaimByHash.mockImplementation(async (_db, scope, requestHash) => {
    const candidates: ClaimRow[] = [];
    for (const row of claimStore.values()) {
      if (row.tenant_id === scope.tenantId
        && row.line_account_id === scope.lineAccountId
        && row.form_id === scope.formId
        && row.friend_id === scope.friendId
        && row.request_hash === requestHash
        && row.status !== 'completed') {
        candidates.push(row);
      }
    }
    candidates.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
    return candidates.length > 0 ? { ...candidates[0] } : null;
  });

  mocks.insertFormSubmissionRecord.mockImplementation(async (_db, input) => {
    if (failures.insertAnswerOnce) {
      failures.insertAnswerOnce = false;
      throw new Error('D1 INSERT failed');
    }
    const id = input.id ?? 'answer-new';
    if (answerStore.has(id)) throw new Error('UNIQUE constraint failed: form_submissions.id');
    const row = answerRow(id, input.data);
    row.form_id = input.formId;
    row.friend_id = input.friendId ?? null;
    answerStore.set(id, row);
    return { ...row };
  });
  mocks.getFormSubmissionById.mockImplementation(async (_db, id) => {
    const row = answerStore.get(id);
    return row ? { ...row } : null;
  });
  mocks.resyncFormSubmitCount.mockImplementation(async () => {
    if (failures.resyncCountOnce) {
      failures.resyncCountOnce = false;
      throw new Error('D1 UPDATE failed');
    }
  });
  mocks.createFormSubmission.mockImplementation(async (_db, input) => {
    const id = 'answer-legacy';
    const row = answerRow(id, input.data);
    row.form_id = input.formId;
    row.friend_id = input.friendId ?? null;
    answerStore.set(id, row);
    return { ...row };
  });
  mocks.updateFormSubmissionDestinationWriteResult.mockImplementation(async (_db, id, result) => {
    const row = answerStore.get(id);
    if (row) {
      row.destination_write_status = 'succeeded';
      row.destination_write_attempted = result.attempted;
      row.destination_write_succeeded = result.succeeded;
      row.destination_write_failed = result.failed;
    }
    return 'succeeded';
  });
  mocks.attachTag.mockImplementation(async () => {
    if (failures.attachTagOnce) {
      failures.attachTagOnce = false;
      throw new Error('tag attach failed');
    }
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function claimOf(key: string = KEY): ClaimRow {
  const row = claimStore.get(scopeKeyOf('tenant-1', 'account-a', 'form-1', 'friend-1', key));
  if (!row) throw new Error('claim not found');
  return row;
}

describe('フォーム回答の冪等予約', () => {
  test('初回は予約→回答→副作用を実行し、予約を完了にする', async () => {
    const res = await app().fetch(submitRequest({ full_name: '山田' }), env());

    expect(res.status).toBe(201);
    expect(mocks.createFormSubmitClaim).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: 'tenant-1',
        lineAccountId: 'account-a',
        formId: 'form-1',
        friendId: 'friend-1',
        key: KEY,
      }),
    );
    expect(answerStore.size).toBe(1);
    expect(mocks.applyMileageRulesForEvent).toHaveBeenCalledTimes(1);
    expect(mocks.pushViaHarnessProxy).toHaveBeenCalledTimes(1);
    const claim = claimOf();
    expect(claim.status).toBe('completed');
    const steps = readSteps(claim);
    // 粗い完了だけでなく、layout の効果ごとの記録も残る。
    expect(steps.filter((step) => !step.startsWith('layout:')).sort()).toEqual(
      ['answer', 'submit_count', 'mileage', 'layout_effects', 'reply', 'destination_status'].sort(),
    );
    expect(steps.some((step) => step.startsWith('layout:destinations:'))).toBe(true);
    // LINE 再送キーは UUID 形の固定値。
    const retryKey = mocks.pushViaHarnessProxy.mock.calls[0][4] as string;
    expect(retryKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  test('真の並行2要求でも外部副作用(Webhook・失敗通知)は1回だけ', async () => {
    mocks.getFormById.mockResolvedValue(formRow(simpleLayout(), {
      on_submit_webhook_url: 'https://verify.example.test/verify',
      on_submit_webhook_fail_message: '確認できませんでした',
    }));
    mocks.getFriendById.mockResolvedValue({
      id: 'friend-1',
      line_user_id: 'U-line-user',
      metadata: '{}',
      display_name: 'テスト',
    });
    const { fetchMock, release } = stubWebhookOncePending();

    const first = app().fetch(submitRequest({ full_name: '山田' }), env());
    await delay(30);
    const second = app().fetch(submitRequest({ full_name: '山田' }), env());
    const settledSecond = await Promise.race([second, delay(1000).then(() => 'TIMEOUT' as const)]);
    release({ eligible: false });
    const firstRes = await first;
    const secondRes = settledSecond === 'TIMEOUT' ? await second : settledSecond;

    // 片方が 201、もう片方は再送(200)か処理中(409)。どちらもありうる。
    const statuses = [firstRes.status, secondRes.status];
    expect(statuses).toContain(201);
    expect(statuses.find((status) => status !== 201) === 200
      || statuses.find((status) => status !== 201) === 429).toBe(true);

    // 外部への呼び出しは勝った側の1回だけ。
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(answerStore.size).toBe(1);
    expect(mocks.applyMileageRulesForEvent).not.toHaveBeenCalled();
    // 失敗通知は勝った側の1通だけ。負けた側は送らない。
    expect(mocks.pushViaHarnessProxy).toHaveBeenCalledTimes(1);
    const sentTo = mocks.pushViaHarnessProxy.mock.calls[0][2];
    expect(sentTo).toBe('U-line-user');
    // 両方の応答の中身を見る。201側は成功、もう片方は再送か処理中。
    const bodies = (await Promise.all([firstRes.json(), secondRes.json()])) as Array<{
      success: boolean;
      retryable?: boolean;
    }>;
    const winner = bodies.find((body) => body.success);
    const loser = bodies.find((body) => !body.success);
    expect(winner).toBeDefined();
    if (loser) {
      expect(loser.retryable).toBe(true);
      expect((loser as { error?: string }).error).toBe('idempotent_in_progress');
    }
  });

  test('処理中の再送は409で送り直しを求め、Webhookを呼ばない', async () => {
    mocks.getFormById.mockResolvedValue(formRow(simpleLayout(), {
      on_submit_webhook_url: 'https://verify.example.test/verify',
    }));
    const { fetchMock, release } = stubWebhookOncePending();

    const first = app().fetch(submitRequest({ full_name: '山田' }), env());
    await delay(30);
    // 先に進んだ試行が Webhook 待ちの間に再送する。
    const waiting = await Promise.race([app().fetch(submitRequest({ full_name: '山田' }), env()), delay(1000).then(() => 'TIMEOUT' as const)]);
    if (waiting !== 'TIMEOUT') {
      expect(waiting.status).toBe(429);
      expect(await waiting.json()).toMatchObject({
        success: false,
        error: 'idempotent_in_progress',
        retryable: true,
      });
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    release({ eligible: true });
    const done = await first;
    expect(done.status).toBe(201);
    expect(answerStore.size).toBe(1);
  });

  test('同じキーの再送は保存済みを返し、保存も副作用も重ねない', async () => {
    const first = await app().fetch(submitRequest({ full_name: '山田' }), env());
    expect(first.status).toBe(201);

    const replayed = await app().fetch(submitRequest({ full_name: '山田' }), env());
    expect(replayed.status).toBe(200);
    expect(replayed.headers.get('Idempotency-Replayed')).toBe('true');
    expect(answerStore.size).toBe(1);
    expect(mocks.applyMileageRulesForEvent).toHaveBeenCalledTimes(1);
    expect(mocks.pushViaHarnessProxy).toHaveBeenCalledTimes(1);
    const body = (await replayed.json()) as { success: boolean; data: { id: string } };
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(claimOf().submission_id);
  });

  test('INSERT後の件数更新に失敗したら500にし、同じキーで再開して補完する', async () => {
    failures.resyncCountOnce = true;

    const failed = await app().fetch(submitRequest({ full_name: '山田' }), env());
    expect(failed.status).toBe(500);
    // 回答は残るが、マイルには進まない。予約は失敗として残る。
    expect(answerStore.size).toBe(1);
    expect(mocks.applyMileageRulesForEvent).not.toHaveBeenCalled();
    expect(claimOf().status).toBe('failed');

    const resumed = await app().fetch(submitRequest({ full_name: '山田' }), env());
    expect(resumed.status).toBe(200);
    expect(resumed.headers.get('Idempotency-Replayed')).toBe('true');
    expect(answerStore.size).toBe(1);
    expect(mocks.applyMileageRulesForEvent).toHaveBeenCalledTimes(1);
    expect(mocks.pushViaHarnessProxy).toHaveBeenCalledTimes(1);
    expect(claimOf().status).toBe('completed');
  });

  test('副作用の部分失敗は202で未完を返し、再送で未完だけ補完する', async () => {
    mocks.getFormById.mockResolvedValue(formRow(simpleLayout(), { on_submit_tag_id: 'tag-1' }));
    failures.attachTagOnce = true;

    const first = await app().fetch(submitRequest({ full_name: '山田' }), env());
    // 201 ではなく 202 で未完の一覧と送り直しの合図を返す。
    expect(first.status).toBe(202);
    const firstBody = (await first.json()) as {
      success: boolean;
      data: { complete: boolean; pendingEffects: string[] };
      retryable: boolean;
    };
    expect(firstBody.success).toBe(true);
    expect(firstBody.data.complete).toBe(false);
    expect(firstBody.data.pendingEffects).toEqual(['tag']);
    expect(firstBody.retryable).toBe(true);
    expect(mocks.attachTag).toHaveBeenCalledTimes(1);
    expect(claimOf().status).toBe('failed');

    const resumed = await app().fetch(submitRequest({ full_name: '山田' }), env());
    expect(resumed.status).toBe(200);
    // 失敗したタグ付けだけが再実行され、成功済みは重ならない。
    expect(mocks.attachTag).toHaveBeenCalledTimes(2);
    expect(mocks.applyMileageRulesForEvent).toHaveBeenCalledTimes(1);
    expect(mocks.pushViaHarnessProxy).toHaveBeenCalledTimes(1);
    expect(claimOf().status).toBe('completed');
  });

  test('Webhookで弾かれた回答の失敗通知は再送で重ねない', async () => {
    mocks.getFormById.mockResolvedValue(formRow(simpleLayout(), {
      on_submit_webhook_url: 'https://verify.example.test/verify',
      on_submit_webhook_fail_message: '確認できませんでした',
    }));
    mocks.getFriendById.mockResolvedValue({
      id: 'friend-1',
      line_user_id: 'U-line-user',
      metadata: '{}',
      display_name: 'テスト',
    });
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ eligible: false }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const first = await app().fetch(submitRequest({ full_name: '山田' }), env());
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { data: { webhookPassed: boolean } };
    expect(firstBody.data.webhookPassed).toBe(false);
    expect(mocks.applyMileageRulesForEvent).not.toHaveBeenCalled();

    const replayed = await app().fetch(submitRequest({ full_name: '山田' }), env());
    expect(replayed.status).toBe(200);
    const replayBody = (await replayed.json()) as { data: { webhookPassed: boolean } };
    expect(replayBody.data.webhookPassed).toBe(false);
    // Webhook の呼び直しも失敗通知の送り直しもない。
    // (弾かれた回答に確認返信は送らない仕様のため、通知は失敗分の1通だけ)
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.pushViaHarnessProxy).toHaveBeenCalledTimes(1);
    expect(mocks.pushViaHarnessProxy.mock.calls[0][3]).toEqual([
      { type: 'text', text: '確認できませんでした' },
    ]);
  });

  test('別 scope(友だち違い)の同じキーは独立に成功する', async () => {
    const first = await app().fetch(submitRequest({ full_name: '山田' }), env());
    expect(first.status).toBe(201);

    mocks.getFriendByLineUserIdForAccount.mockResolvedValue({
      id: 'friend-2',
      line_user_id: 'U-other',
      line_account_id: null,
      metadata: '{}',
      display_name: '別人',
    });
    const second = await app().fetch(submitRequest({ full_name: '山田' }), env());
    expect(second.status).toBe(201);
    expect(answerStore.size).toBe(2);
    expect(mocks.applyMileageRulesForEvent).toHaveBeenCalledTimes(2);
  });

  test('同じ scope で内容が違う使い回しは409で断り、保存しない', async () => {
    const first = await app().fetch(submitRequest({ full_name: '山田' }), env());
    expect(first.status).toBe(201);

    const res = await app().fetch(submitRequest({ full_name: '別人' }), env());
    expect(res.status).toBe(409);
    // 自動の付け替えをしないよう、送り直し不可をはっきり返す。
    expect(await res.json()).toMatchObject({
      success: false,
      code: 'idempotency_content_mismatch',
      retryable: false,
    });
    expect(answerStore.size).toBe(1);
    expect(mocks.applyMileageRulesForEvent).toHaveBeenCalledTimes(1);
  });

  test('期限切れのキーの再送は新しいキーでの送り直しを求める', async () => {
    const first = await app().fetch(submitRequest({ full_name: '山田' }), env());
    expect(first.status).toBe(201);
    claimOf().expires_at = '2026-08-19T00:00:00.000Z';

    const res = await app().fetch(submitRequest({ full_name: '山田' }), env());
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      success: false,
      code: 'idempotency_expired',
      retryable: false,
    });
    expect(answerStore.size).toBe(1);
  });

  test('Webhook送達後の記録失敗は再送で呼び直さず、残した結果を使う', async () => {
    mocks.getFormById.mockResolvedValue(formRow(simpleLayout(), {
      on_submit_webhook_url: 'https://verify.example.test/verify',
    }));
    const fetchMock = stubWebhookPassing();
    // 配達はできたが、結果の記録だけ落ちた(送達後の停止の再現)。
    failures.saveWebhookOnce = true;

    const lost = await app().fetch(submitRequest({ full_name: '山田' }), env());
    expect(lost.status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const resumed = await app().fetch(submitRequest({ full_name: '山田' }), env());
    expect(resumed.status).toBe(200);
    // outbox に配達済みの結果があるので、Webhook を呼び直さない。
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(answerStore.size).toBe(1);
    expect(claimOf().status).toBe('completed');
  });

  test('配達も記録も残せなかった再開は、同じ event id で呼び直す', async () => {
    mocks.getFormById.mockResolvedValue(formRow(simpleLayout(), {
      on_submit_webhook_url: 'https://verify.example.test/verify',
    }));
    const fetchMock = stubWebhookPassing();
    // 配達の記録が落ちた(送達直後の停止の再現)。結果の記録には到達しない。
    failures.markOutboxOnce = true;

    const lost = await app().fetch(submitRequest({ full_name: '山田' }), env());
    expect(lost.status).toBe(500);

    const resumed = await app().fetch(submitRequest({ full_name: '山田' }), env());
    expect(resumed.status).toBe(200);
    // 呼び直しはするが、event id は同じ値なので受け側は重複を除ける。
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstInit = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    const secondInit = fetchMock.mock.calls[1][1] as { headers: Record<string, string> };
    const firstEventId = firstInit.headers['X-Form-Event-Id'];
    const secondEventId = secondInit.headers['X-Form-Event-Id'];
    expect(firstEventId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(secondEventId).toBe(firstEventId);
    expect(claimOf().status).toBe('completed');
  });

  test('キーが変わっても同じ内容の未完があれば、元のキーでの再開へ誘導する', async () => {
    failures.resyncCountOnce = true;
    const failed = await app().fetch(submitRequest({ full_name: '山田' }), env());
    expect(failed.status).toBe(500);
    expect(claimOf().status).toBe('failed');

    // 画面を開き直してキーが変わった再送。新しい回答は作らない。
    const guided = await app().fetch(submitRequest({ full_name: '山田' }, KEY_2), env());
    expect(guided.status).toBe(409);
    const guidedBody = (await guided.json()) as {
      success: boolean;
      code: string;
      retryable: boolean;
      idempotencyKey: string;
    };
    expect(guidedBody.code).toBe('idempotency_recovery_pending');
    expect(guidedBody.retryable).toBe(true);
    expect(guidedBody.idempotencyKey).toBe(KEY);
    expect(answerStore.size).toBe(1);

    // 元のキーで再開すると補完して終わる。
    const resumed = await app().fetch(submitRequest({ full_name: '山田' }), env());
    expect(resumed.status).toBe(200);
    expect(answerStore.size).toBe(1);
    expect(claimOf().status).toBe('completed');
  });

  test('形の違う回答・リンク指定・壊れた JSON は保存前に400', async () => {
    const arrayBody = await app().fetch(submitRequest(['山田'] as unknown as Record<string, unknown>), env());
    expect(arrayBody.status).toBe(400);

    const badLink = await app().fetch(
      submitRequest({ full_name: '山田' }, KEY, { trackedLinkId: 123 }),
      env(),
    );
    expect(badLink.status).toBe(400);

    const tooBig = await app().fetch(
      submitRequest({ full_name: 'x'.repeat(101 * 1024) }),
      env(),
    );
    expect(tooBig.status).toBe(400);

    const broken = await app().fetch(new Request('https://worker.example.test/api/forms/form-1/submit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer [REDACTED]',
        'Idempotency-Key': KEY,
      },
      body: '{壊れた',
    }), env());
    expect(broken.status).toBe(400);

    expect(answerStore.size).toBe(0);
    expect(mocks.createFormSubmitClaim).not.toHaveBeenCalled();
  });

  test('回答期限後の再送は最初の結果をそのまま返す', async () => {
    const first = await app().fetch(submitRequest({ full_name: '山田' }), env());
    expect(first.status).toBe(201);

    const layout = simpleLayout();
    layout.options.deadline = { enabled: true, endsAt: '2026-08-19T23:59', message: '締め切りました' };
    mocks.getFormById.mockResolvedValue(formRow(layout));

    const replayed = await app().fetch(submitRequest({ full_name: '山田' }), env());
    expect(replayed.status).toBe(200);

    const fresh = await app().fetch(submitRequest({ full_name: '山田' }, KEY_2), env());
    expect(fresh.status).toBe(400);
  });

  test('別アカウントのキーでは回答の有無を見せず404', async () => {
    mocks.formBelongsToLineAccount.mockResolvedValue(false);

    const res = await app().fetch(submitRequest({ full_name: '山田' }), env());
    expect(res.status).toBe(404);
    expect(mocks.createFormSubmitClaim).not.toHaveBeenCalled();
    expect(mocks.getFormSubmitClaim).not.toHaveBeenCalled();
  });

  test('キーなし送信は400で断り、DBに触らない', async () => {
    const res = await app().fetch(new Request('https://worker.example.test/api/forms/form-1/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer dummy-redacted-auth' },
      body: JSON.stringify({ data: { full_name: '山田' } }),
    }), env());
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false, error: 'idempotency_key_required' });
    expect(mocks.getFormById).not.toHaveBeenCalled();
    expect(mocks.createFormSubmitClaim).not.toHaveBeenCalled();
  });

  test('形の違うキーはDBに触る前に400', async () => {
    const res = await app().fetch(submitRequest({ full_name: '山田' }, 'not-a-uuid'), env());
    expect(res.status).toBe(400);
    expect(mocks.getFormById).not.toHaveBeenCalled();
    expect(mocks.getFormSubmitClaim).not.toHaveBeenCalled();
    expect(mocks.createFormSubmitClaim).not.toHaveBeenCalled();
  });

  test('LINE再送キーは回答と工程で固定され、再開時の送り直しも同じ値になる', async () => {
    failures.pushOnce = true;

    const first = await app().fetch(submitRequest({ full_name: '山田' }), env());
    expect(first.status).toBe(202);
    expect(claimOf().status).toBe('failed');

    const resumed = await app().fetch(submitRequest({ full_name: '山田' }), env());
    expect(resumed.status).toBe(200);
    expect(mocks.pushViaHarnessProxy).toHaveBeenCalledTimes(2);
    const firstKey = mocks.pushViaHarnessProxy.mock.calls[0][4];
    const secondKey = mocks.pushViaHarnessProxy.mock.calls[1][4];
    expect(firstKey).toBe(secondKey);
    // UUID 形の固定値(randomUUID の作り直しはしない)。
    expect(firstKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    // 横取りで版と世代が進む。
    expect(claimOf().version).toBe(2);
    expect(claimOf().lease_generation).toBe(2);
    expect(claimOf().status).toBe('completed');
  });

  test('マイル付与のDB失敗は握らず未完に残し、再送で付け直す', async () => {
    failures.mileageOnce = true;

    const first = await app().fetch(submitRequest({ full_name: '山田' }), env());
    expect(first.status).toBe(202);
    const firstBody = (await first.json()) as {
      data: { complete: boolean; pendingEffects: string[] };
    };
    expect(firstBody.data.complete).toBe(false);
    expect(firstBody.data.pendingEffects).toContain('mileage');
    expect(mocks.applyMileageRulesForEvent).toHaveBeenCalledTimes(1);
    expect(claimOf().status).toBe('failed');

    const resumed = await app().fetch(submitRequest({ full_name: '山田' }), env());
    expect(resumed.status).toBe(200);
    expect(mocks.applyMileageRulesForEvent).toHaveBeenCalledTimes(2);
    expect(claimOf().status).toBe('completed');
  });

  test('レイアウトの部分失敗は欠落を固定せず、再送で補完する', async () => {
    failures.layoutPartialOnce = true;

    const first = await app().fetch(submitRequest({ full_name: '山田' }), env());
    expect(first.status).toBe(202);
    expect(claimOf().status).toBe('failed');

    const resumed = await app().fetch(submitRequest({ full_name: '山田' }), env());
    expect(resumed.status).toBe(200);
    expect(mocks.applyLayout).toHaveBeenCalledTimes(2);
    expect(mocks.pushViaHarnessProxy).toHaveBeenCalledTimes(1);
    expect(claimOf().status).toBe('completed');
  });

  test('判定落ちでは予約を作らず、直して同じキーで送り直せる', async () => {
    const rejected = await app().fetch(submitRequest({}), env());
    expect(rejected.status).toBe(400);
    expect(mocks.createFormSubmitClaim).not.toHaveBeenCalled();

    const retried = await app().fetch(submitRequest({ full_name: '山田' }), env());
    expect(retried.status).toBe(201);
  });
});
