import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutoReply } from '@line-crm/db';

const mocks = vi.hoisted(() => ({
  evaluateAutoReplyConditions: vi.fn(),
}));

vi.mock('./auto-reply-conditions.js', () => ({
  evaluateAutoReplyConditions: mocks.evaluateAutoReplyConditions,
}));

import {
  compareAutoReplyCandidates,
  evaluateAutoReplyCandidates,
} from './auto-reply.js';

const db = {} as D1Database;

function rule(overrides: Partial<AutoReply> = {}): AutoReply {
  return {
    id: 'rule-a',
    keyword: '予約',
    match_type: 'contains',
    response_type: 'text',
    response_content: 'ご予約を承ります',
    template_id: null,
    line_account_id: 'account-a',
    is_active: 1,
    active_from: null,
    active_until: null,
    cooldown_minutes: null,
    skip_when_operator_active: 0,
    priority: 10,
    message_kinds_json: null,
    friend_conditions_json: null,
    folder_id: null,
    display_order: 0,
    actions_json: null,
    response_weekdays_json: null,
    response_holiday_rule: null,
    once_per_friend: 0,
    keywords_json: null,
    respond_to_all: 0,
    name: '予約問い合わせ',
    keyword_match_mode: 'any',
    created_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.evaluateAutoReplyConditions.mockResolvedValue({ matches: true, reasonCodes: [] });
});

describe('自動応答の公開前試験が本番の判定順を共有する', () => {
  it('優先順位、全件応答、作成時刻の順で並べる', () => {
    const ordered = [
      rule({ id: 'newer', priority: 1, created_at: '2026-08-02T00:00:00.000Z' }),
      rule({ id: 'later-priority', priority: 2 }),
      rule({ id: 'respond-all', priority: 1, respond_to_all: 1 }),
      rule({ id: 'global', priority: 0, line_account_id: null }),
      rule({ id: 'older', priority: 1, created_at: '2026-08-01T00:00:00.000Z' }),
    ].sort(compareAutoReplyCandidates);

    expect(ordered.map((item) => item.id)).toEqual([
      'older',
      'newer',
      'respond-all',
      'later-priority',
      'global',
    ]);
  });

  it('先のルールが条件で見送られた理由を残し、次の勝者で止まる', async () => {
    mocks.evaluateAutoReplyConditions
      .mockResolvedValueOnce({ matches: false, reasonCodes: ['cooldown_active'] })
      .mockResolvedValueOnce({ matches: true, reasonCodes: [] });
    const third = rule({ id: 'third', priority: 30 });

    const result = await evaluateAutoReplyCandidates(db, [
      rule({ id: 'first', priority: 10 }),
      rule({ id: 'second', priority: 20 }),
      third,
    ], {
      friendId: 'friend-a',
      incomingText: '予約したいです',
      messageKind: 'text',
      now: new Date('2026-08-30T03:00:00.000Z'),
    });

    expect(result.map((item) => ({
      id: item.rule.id,
      result: item.result,
      reasons: item.reasonCodes,
    }))).toEqual([
      { id: 'first', result: 'skipped', reasons: ['cooldown_active'] },
      { id: 'second', result: 'won', reasons: [] },
    ]);
    expect(result.some((item) => item.rule.id === third.id)).toBe(false);
    expect(mocks.evaluateAutoReplyConditions).toHaveBeenCalledTimes(2);
  });

  it('種別や言葉が合わない候補では状態判定を呼ばない', async () => {
    const result = await evaluateAutoReplyCandidates(db, [
      rule({ id: 'image-only', message_kinds_json: '["image"]' }),
      rule({ id: 'other-word', keyword: '返品' }),
    ], {
      friendId: 'friend-a',
      incomingText: '予約したいです',
      messageKind: 'text',
      now: new Date('2026-08-30T03:00:00.000Z'),
    });

    expect(result.map((item) => item.reasonCodes)).toEqual([
      ['message_kind_not_matched'],
      ['keyword_not_matched'],
    ]);
    expect(mocks.evaluateAutoReplyConditions).not.toHaveBeenCalled();
  });
});
