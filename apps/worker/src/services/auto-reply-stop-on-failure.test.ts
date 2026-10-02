import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LineClient } from '@line-crm/line-sdk';

const dbMocks = vi.hoisted(() => ({
  ensureAutoReplyPublishedVersion: vi.fn(),
  isOperationCapabilityStopped: vi.fn(async () => false),
  finishAutoReplyActionRun: vi.fn(),
  getTemplateById: vi.fn(),
  markAutoReplyEvaluationFinished: vi.fn(),
  markAutoReplyEvaluationMatched: vi.fn(),
  markAutoReplyEvaluationSkipped: vi.fn(),
  recordAutoReplyEvaluationDetail: vi.fn(),
  reserveAutoReplyActionRun: vi.fn(),
  reserveAutoReplyEvaluation: vi.fn(),
  recordAutoReplyHit: vi.fn(),
}));

const conditionMocks = vi.hoisted(() => ({
  evaluateAutoReplyConditions: vi.fn(),
}));

const actionMocks = vi.hoisted(() => ({
  runActionRows: vi.fn(),
}));

const eventMocks = vi.hoisted(() => ({
  logOutgoingMessage: vi.fn(),
}));

vi.mock('@line-crm/db', () => dbMocks);
vi.mock('./auto-reply-conditions.js', () => conditionMocks);
vi.mock('./scenario-actions.js', () => actionMocks);
vi.mock('./event-bus.js', () => eventMocks);
vi.mock('./interpolation-context.js', () => ({
  resolveInterpolationExtra: vi.fn().mockResolvedValue({}),
  resolveSendInterpolationExtra: vi.fn().mockResolvedValue({}),
  resolveSendCommonVars: vi.fn().mockResolvedValue(undefined),
  contentNeedsFriendFields: vi.fn().mockReturnValue(false),
}));
vi.mock('./step-delivery.js', () => ({
  resolveMetadata: vi.fn().mockResolvedValue({}),
  expandVariables: vi.fn((value: string) => value),
  buildMessage: vi.fn(() => ({ type: 'text', text: '返信しました' })),
  messageToLogPayload: vi.fn(() => ({ messageType: 'text', content: '返信しました' })),
}));

import { matchAndReply, parseAutoReplyActions } from './auto-reply.js';

const friend = {
  id: 'friend-1',
  line_user_id: 'U1',
  display_name: '田中さん',
  picture_url: null,
  status_message: null,
  is_following: 1,
  user_id: null,
  line_account_id: 'account-1',
  metadata: '{}',
  first_tracked_link_id: null,
  created_at: '2026-08-28T10:00:00.000+09:00',
  updated_at: '2026-08-28T10:00:00.000+09:00',
} as never;

function rule(actions: unknown[]) {
  return {
    id: 'rule-1',
    keyword: '予約',
    match_type: 'contains',
    response_type: 'silent',
    response_content: '',
    template_id: null,
    line_account_id: 'account-1',
    is_active: 1,
    active_from: null,
    active_until: null,
    cooldown_minutes: null,
    skip_when_operator_active: 0,
    priority: 1,
    message_kinds_json: null,
    friend_conditions_json: null,
    folder_id: null,
    display_order: 1,
    actions_json: JSON.stringify(actions),
    response_weekdays_json: null,
    response_holiday_rule: null,
    once_per_friend: 0,
    keywords_json: null,
    respond_to_all: 0,
    name: '予約問い合わせ',
    keyword_match_mode: 'any',
    created_at: '2026-08-01T00:00:00.000+09:00',
  };
}

function dbWithRules(items: unknown[]) {
  const statement = {
    bind: vi.fn(),
    all: vi.fn().mockResolvedValue({ results: items }),
  };
  statement.bind.mockReturnValue(statement);
  return { prepare: vi.fn().mockReturnValue(statement) } as unknown as D1Database;
}

function opts(eventId = 'event-1') {
  return {
    lineAccountId: 'account-1',
    incomingEventId: eventId,
    incomingMessageLogId: 'incoming-log-1',
    occurredAt: '2026-08-28T01:00:00.000Z',
  };
}

const okResult = {
  executed: 1,
  skippedByCondition: 0,
  skippedByOnce: 0,
  failed: 0,
  skippedIncomplete: 0,
  scenarioTouched: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.reserveAutoReplyEvaluation.mockResolvedValue({
    created: true,
    row: { id: 'evaluation-1', status: 'received', reply_status: 'not_attempted' },
  });
  dbMocks.ensureAutoReplyPublishedVersion.mockResolvedValue({ id: 'version-1' });
  dbMocks.reserveAutoReplyActionRun.mockResolvedValue({ id: 'action-run-1', acquired: true });
  conditionMocks.evaluateAutoReplyConditions.mockResolvedValue({ matches: true, reasonCodes: [] });
  actionMocks.runActionRows.mockResolvedValue(okResult);
  eventMocks.logOutgoingMessage.mockResolvedValue('outgoing-log-1');
});

/*
 * 失敗したら止めるか続けるかをアクションごとに選べる。
 *
 * 今は失敗しても次へ進む固定で、止めたい運用（1つ目が TesTest 失敗したら
 * 2つ目を動かさない） ができない。既定は今の動き＝続ける。
 */
describe('自動応答の失敗時の止める/続ける (P1-08)', () => {
  it('読み取りは onFailure を保ち、無指定は続けるに倒す', () => {
    const parsed = parseAutoReplyActions(JSON.stringify([
      { actionType: 'tag', config: { op: 'add', tagIds: ['tag-1'] }, onFailure: 'stop' },
      { actionType: 'tag', config: { op: 'add', tagIds: ['tag-2'] } },
      { actionType: 'tag', config: { op: 'add', tagIds: ['tag-3'] }, onFailure: 'wat' },
    ]));
    expect(parsed.map((action) => (action as { onFailure?: unknown }).onFailure)).toEqual([
      'stop',
      'continue',
      'continue',
    ]);
  });

  it('止める設定のアクションが失敗したら、後続を実行しない', async () => {
    actionMocks.runActionRows.mockRejectedValueOnce(new Error('tag store down'));
    const db = dbWithRules([rule([
      { actionType: 'tag', config: { op: 'add', tagIds: ['tag-1'] }, onFailure: 'stop' },
      { actionType: 'tag', config: { op: 'add', tagIds: ['tag-2'] } },
    ])]);
    const line = { replyMessageWithRequestId: vi.fn() } as unknown as LineClient;

    const result = await matchAndReply(db, line, friend, '予約したい', 'reply-token', opts());

    expect(result.matched).toBe(true);
    expect(actionMocks.runActionRows).toHaveBeenCalledTimes(1);
  });

  it('設定が無いときは今までどおり続ける', async () => {
    actionMocks.runActionRows.mockRejectedValueOnce(new Error('tag store down'));
    const db = dbWithRules([rule([
      { actionType: 'tag', config: { op: 'add', tagIds: ['tag-1'] } },
      { actionType: 'tag', config: { op: 'add', tagIds: ['tag-2'] } },
    ])]);
    const line = { replyMessageWithRequestId: vi.fn() } as unknown as LineClient;

    const result = await matchAndReply(db, line, friend, '予約したい', 'reply-token', opts());

    expect(result.matched).toBe(true);
    expect(actionMocks.runActionRows).toHaveBeenCalledTimes(2);
  });
});
