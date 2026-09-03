import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const mocks = vi.hoisted(() => ({
  getAutoReplies: vi.fn(),
  getAutoReplyEvaluationSummary: vi.fn(),
  getAutoReplyTriggerBreakdown: vi.fn(),
  listAutoReplyEvaluationRuns: vi.fn(),
  getVisibleLineAccountScope: vi.fn(),
}));

vi.mock('@line-crm/db', () => ({
  getAutoReplies: mocks.getAutoReplies,
  getAutoReplyEvaluationSummary: mocks.getAutoReplyEvaluationSummary,
  getAutoReplyTriggerBreakdown: mocks.getAutoReplyTriggerBreakdown,
  listAutoReplyEvaluationRuns: mocks.listAutoReplyEvaluationRuns,
  jstNow: () => '2026-08-28T12:00:00.000',
}));
vi.mock('../services/account-access.js', () => ({
  getVisibleLineAccountScope: mocks.getVisibleLineAccountScope,
}));

import { autoReplyRuns } from './auto-reply-runs.js';

const db = {} as D1Database;
const staff = {
  id: 'staff-a',
  name: '担当者',
  role: 'staff' as const,
  readOnly: false,
  tenantId: 'tenant-a',
  permissionKeys: [] as string[],
};

function app(currentStaff = staff) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', currentStaff);
    return next();
  });
  instance.route('/', autoReplyRuns);
  return instance;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getVisibleLineAccountScope.mockResolvedValue({
    accounts: [],
    ids: ['account-a'],
    allowedAccountIds: ['account-a'],
    canSeeUnassigned: false,
  });
  mocks.getAutoReplies.mockResolvedValue([{
    id: 'rule-a',
    keyword: '予約',
    name: '予約問い合わせ',
    line_account_id: 'account-a',
    is_active: 1,
    priority: 1,
    created_at: '2026-08-01T00:00:00.000',
  }, {
    id: 'rule-b',
    keyword: '秘密',
    name: '別店舗',
    line_account_id: 'account-b',
    is_active: 1,
    priority: 0,
    created_at: '2026-08-01T00:00:00.000',
  }]);
  mocks.listAutoReplyEvaluationRuns.mockResolvedValue({
    total: 1,
    items: [{
      id: 'evaluation-1',
      incoming_event_id: 'event-1',
      incoming_message_log_id: 'message-1',
      line_account_id: 'account-a',
      friend_id: 'friend-1',
      message_kind: 'text',
      normalized_text_hash: 'hash',
      input_preview_masked: '予約したい',
      evaluated_at: '2026-08-28T01:30:00.000Z',
      completed_at: '2026-08-28T01:30:00.800Z',
      winning_auto_reply_id: 'rule-a',
      winning_version_id: 'version-1',
      status: 'completed',
      skip_reason: null,
      matched_keyword: '予約',
      reply_status: 'accepted',
      line_request_id: 'line-request-1',
      message_log_id: 'outgoing-1',
      action_summary: '{"executed":1}',
      error_code: null,
      duration_ms: 800,
      created_at: '2026-08-28T01:30:00.000Z',
      updated_at: '2026-08-28T01:30:00.800Z',
      friend_name: '田中さん',
      account_label: '店舗A',
      rule_name: '予約問い合わせ',
      rule_keyword: '予約',
      rule_priority: 1,
      version_number: 2,
      candidate_result: 'won',
      candidate_reason_codes: '[]',
    }],
  });
  mocks.getAutoReplyEvaluationSummary.mockResolvedValue({
    monthHits: 1,
    totalHits: 1,
    handovers: 0,
    errors: 0,
    lastRunAt: '2026-08-28T01:30:00.000Z',
    averageResponseMs: 800,
    handoverWaiting: 0,
    handoverInProgress: 0,
    handoverCompleted: 0,
  });
  mocks.getAutoReplyTriggerBreakdown.mockResolvedValue([{ trigger: '予約', count: 1 }]);
});

describe('GET /api/auto-reply-runs', () => {
  it('担当者が見えるLINEアカウントだけをDB取得条件へ渡す', async () => {
    const response = await app().request('/api/auto-reply-runs?rule_id=rule-a&limit=20', {}, { DB: db } as Env['Bindings']);
    expect(response.status).toBe(200);
    expect(mocks.getVisibleLineAccountScope).toHaveBeenCalledWith(db, staff);
    expect(mocks.listAutoReplyEvaluationRuns).toHaveBeenCalledWith(db, expect.objectContaining({
      ruleId: 'rule-a',
      lineAccountIds: ['account-a'],
      includeUnassigned: false,
      limit: 20,
      offset: 0,
    }));
    const json = await response.json() as {
      success: boolean;
      data: { items: Array<{ status: string; inputPreview: string | null }> };
    };
    expect(json.success).toBe(true);
    expect(json.data.items[0].status).toBe('succeeded');
    expect(json.data.items[0].inputPreview).toBeNull();
  });

  it('受信本文はチャット閲覧権限がある担当者にだけ返す', async () => {
    const response = await app({ ...staff, permissionKeys: ['/chats'] }).request(
      '/api/auto-reply-runs?rule_id=rule-a',
      {},
      { DB: db } as Env['Bindings'],
    );
    const json = await response.json() as {
      data: { items: Array<{ inputPreview: string | null }> };
    };
    expect(json.data.items[0].inputPreview).toBe('予約したい');
  });

  it('ルール未指定なら先頭ルールへ絞らず、見える実行結果をすべて取得する', async () => {
    const response = await app().request('/api/auto-reply-runs', {}, { DB: db } as Env['Bindings']);
    expect(response.status).toBe(200);
    expect(mocks.listAutoReplyEvaluationRuns.mock.calls.at(-1)?.[1].ruleId).toBeUndefined();
    const json = await response.json() as { data: { rule: { id: string | null } } };
    expect(json.data.rule.id).toBeNull();
  });

  it('別アカウントの自動応答IDは存在を隠して404にする', async () => {
    const response = await app().request('/api/auto-reply-runs?ruleId=rule-b', {}, { DB: db } as Env['Bindings']);
    expect(response.status).toBe(404);
    expect(mocks.listAutoReplyEvaluationRuns).not.toHaveBeenCalled();
  });

  it('選択したルールを条件で見送り、後続ルールが動いても成功とは表示しない', async () => {
    mocks.listAutoReplyEvaluationRuns.mockResolvedValueOnce({
      total: 1,
      items: [{
        id: 'evaluation-2',
        incoming_event_id: 'event-2',
        incoming_message_log_id: 'message-2',
        line_account_id: 'account-a',
        friend_id: 'friend-2',
        message_kind: 'text',
        normalized_text_hash: 'hash',
        input_preview_masked: '予約したい',
        evaluated_at: '2026-08-28T01:31:00.000Z',
        completed_at: '2026-08-28T01:31:00.800Z',
        winning_auto_reply_id: 'rule-later',
        winning_version_id: 'version-later',
        status: 'completed',
        skip_reason: null,
        matched_keyword: '予約',
        reply_status: 'accepted',
        line_request_id: 'line-request-2',
        message_log_id: 'outgoing-2',
        action_summary: '{}',
        error_code: null,
        duration_ms: 800,
        created_at: '2026-08-28T01:31:00.000Z',
        updated_at: '2026-08-28T01:31:00.800Z',
        friend_name: '佐藤さん',
        account_label: '店舗A',
        rule_name: '後続ルール',
        rule_keyword: '予約',
        rule_priority: 2,
        version_number: 1,
        candidate_result: 'skipped',
        candidate_reason_codes: '["operator_handling"]',
      }],
    });

    const response = await app().request('/api/auto-reply-runs?ruleId=rule-a', {}, { DB: db } as Env['Bindings']);
    const json = await response.json() as {
      data: { items: Array<{ status: string; domainStatus: string; autoReplyId: string; detail: string }> };
    };

    expect(json.data.items[0]).toMatchObject({
      status: 'skipped',
      domainStatus: 'skipped',
      autoReplyId: 'rule-a',
      detail: '担当者が対応中のため何もしませんでした',
    });
  });
});
