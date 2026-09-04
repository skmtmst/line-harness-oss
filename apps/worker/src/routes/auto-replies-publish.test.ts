import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import type { AutoReply, AutoReplyDraftSettings, AutoReplyVersionRow } from '@line-crm/db';

const mocks = vi.hoisted(() => ({
  getAutoReplies: vi.fn(),
  getAutoReplyById: vi.fn(),
  createAutoReply: vi.fn(),
  updateAutoReply: vi.fn(),
  deleteAutoReply: vi.fn(),
  getAutoReplyHitCounts: vi.fn(),
  getFolderById: vi.fn(),
  getFriendById: vi.fn(),
  getTemplateById: vi.fn(),
  createAutoReplyWithDraftVersion: vi.fn(),
  getAutoReplyDraftVersion: vi.fn(),
  getAutoReplyPublishedVersion: vi.fn(),
  publishAutoReplyDraftVersion: vi.fn(),
  recordAutoReplyDraftTest: vi.fn(),
  saveAutoReplyDraftVersion: vi.fn(),
  canAccessAllLineAccounts: vi.fn(),
  evaluateAutoReplyCandidates: vi.fn(),
  previewAutoReplyContent: vi.fn(),
}));

function settings(overrides: Partial<AutoReplyDraftSettings> = {}): AutoReplyDraftSettings {
  return {
    keyword: '予約',
    matchType: 'contains',
    responseType: 'text',
    responseContent: 'ご予約を承ります',
    templateId: null,
    lineAccountId: 'account-a',
    activeFrom: null,
    activeUntil: null,
    cooldownMinutes: null,
    skipWhenOperatorActive: false,
    priority: 10,
    messageKinds: null,
    friendConditions: null,
    actions: null,
    responseWeekdays: null,
    responseHolidayRule: null,
    oncePerFriend: false,
    keywords: null,
    respondToAll: false,
    name: '予約問い合わせ',
    keywordMatchMode: 'any',
    folderId: null,
    ...overrides,
  };
}

function rowFromSettings(
  id: string,
  value: AutoReplyDraftSettings,
  createdAt = '2026-08-01T00:00:00.000Z',
): AutoReply {
  return {
    id,
    keyword: value.keyword,
    match_type: value.matchType,
    response_type: value.responseType,
    response_content: value.responseContent,
    template_id: value.templateId,
    line_account_id: value.lineAccountId,
    is_active: 1,
    active_from: value.activeFrom,
    active_until: value.activeUntil,
    cooldown_minutes: value.cooldownMinutes,
    skip_when_operator_active: value.skipWhenOperatorActive ? 1 : 0,
    priority: value.priority,
    message_kinds_json: value.messageKinds,
    friend_conditions_json: value.friendConditions,
    folder_id: value.folderId,
    display_order: 0,
    actions_json: value.actions,
    response_weekdays_json: value.responseWeekdays,
    response_holiday_rule: value.responseHolidayRule,
    once_per_friend: value.oncePerFriend ? 1 : 0,
    keywords_json: value.keywords,
    respond_to_all: value.respondToAll ? 1 : 0,
    name: value.name,
    keyword_match_mode: value.keywordMatchMode,
    created_at: createdAt,
  };
}

function version(overrides: Partial<AutoReplyVersionRow> = {}): AutoReplyVersionRow {
  return {
    id: 'version-draft',
    auto_reply_id: 'rule-draft',
    version_number: 2,
    line_account_id: 'account-a',
    definition_snapshot: JSON.stringify(settings()),
    status: 'draft',
    published_at: null,
    published_by_staff_id: null,
    last_test_status: 'succeeded',
    last_tested_at: '2026-08-30T03:00:00.000Z',
    last_tested_by_staff_id: 'staff-a',
    publish_idempotency_key: null,
    created_at: '2026-08-30T02:00:00.000Z',
    updated_at: '2026-08-30T03:00:00.000Z',
    ...overrides,
  };
}

vi.mock('@line-crm/db', () => ({
  getAutoReplies: mocks.getAutoReplies,
  getAutoReplyById: mocks.getAutoReplyById,
  createAutoReply: mocks.createAutoReply,
  updateAutoReply: mocks.updateAutoReply,
  deleteAutoReply: mocks.deleteAutoReply,
  getAutoReplyHitCounts: mocks.getAutoReplyHitCounts,
  getFolderById: mocks.getFolderById,
  getFriendById: mocks.getFriendById,
  getTemplateById: mocks.getTemplateById,
  autoReplyRowFromDraftSettings: rowFromSettings,
  createAutoReplyWithDraftVersion: mocks.createAutoReplyWithDraftVersion,
  getAutoReplyDraftVersion: mocks.getAutoReplyDraftVersion,
  getAutoReplyPublishedVersion: mocks.getAutoReplyPublishedVersion,
  parseAutoReplyVersionSettings: (item: AutoReplyVersionRow) => JSON.parse(item.definition_snapshot),
  publishAutoReplyDraftVersion: mocks.publishAutoReplyDraftVersion,
  recordAutoReplyDraftTest: mocks.recordAutoReplyDraftTest,
  saveAutoReplyDraftVersion: mocks.saveAutoReplyDraftVersion,
  jstNow: () => '2026-08-30T10:00:00.000',
}));
vi.mock('../middleware/role-guard.js', () => ({
  requireRole: () => async (_c: unknown, next: () => Promise<void>) => next(),
}));
vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: mocks.canAccessAllLineAccounts,
}));
vi.mock('../services/auto-reply.js', () => ({
  compareAutoReplyCandidates: (a: AutoReply, b: AutoReply) => Number(a.line_account_id === null)
    - Number(b.line_account_id === null)
    || a.priority - b.priority
    || a.respond_to_all - b.respond_to_all
    || a.created_at.localeCompare(b.created_at),
  evaluateAutoReplyCandidates: mocks.evaluateAutoReplyCandidates,
  keywordMatches: (item: AutoReply, text: string) => item.respond_to_all === 1 || text.includes(item.keyword),
  parseAutoReplyActions: () => [],
  previewAutoReplyContent: mocks.previewAutoReplyContent,
  resolveKeywordRules: (item: AutoReply) => [{ keyword: item.keyword, matchType: item.match_type }],
}));

import { autoReplies } from './auto-replies.js';

const activeRules: AutoReply[] = [];
const db = {
  prepare: vi.fn(() => {
    const statement = {
      bind: vi.fn(() => statement),
      all: vi.fn(async () => ({ results: activeRules })),
    };
    return statement;
  }),
} as unknown as D1Database;

const staff = {
  id: 'staff-a',
  name: '担当者',
  role: 'admin' as const,
  readOnly: false,
  tenantId: 'tenant-a',
};

function app() {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', staff);
    return next();
  });
  instance.route('/', autoReplies);
  return instance;
}

const bindings = { DB: db, WORKER_URL: 'https://worker.test' } as Env['Bindings'];

beforeEach(() => {
  vi.clearAllMocks();
  activeRules.splice(0);
  const current = rowFromSettings('rule-draft', settings());
  mocks.getAutoReplyById.mockResolvedValue(current);
  mocks.getAutoReplyDraftVersion.mockResolvedValue(version());
  mocks.createAutoReplyWithDraftVersion.mockResolvedValue({ rule: current, version: version() });
  mocks.saveAutoReplyDraftVersion.mockResolvedValue(version());
  mocks.getTemplateById.mockResolvedValue(null);
  mocks.canAccessAllLineAccounts.mockResolvedValue(true);
  mocks.getFriendById.mockResolvedValue({
    id: 'friend-a',
    line_account_id: 'account-a',
    display_name: '山田さん',
  });
  mocks.previewAutoReplyContent.mockResolvedValue({
    messageType: 'text',
    content: '山田さん、ご予約を承ります',
  });
  mocks.publishAutoReplyDraftVersion.mockResolvedValue(version({
    id: 'version-published',
    status: 'published',
    published_at: '2026-08-30T04:00:00.000Z',
  }));
});

describe('自動応答の試験と公開', () => {
  it('新規保存は公開中ルールを作らず、下書き作成だけを呼ぶ', async () => {
    const response = await app().request('/api/auto-replies/drafts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(settings()),
    }, bindings);

    expect(response.status).toBe(201);
    expect(mocks.createAutoReplyWithDraftVersion).toHaveBeenCalledOnce();
    expect(mocks.createAutoReply).not.toHaveBeenCalled();
  });

  it('編集保存は公開中ルールを変えず、下書き版だけを更新する', async () => {
    const response = await app().request('/api/auto-replies/rule-draft/draft', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(settings({ responseContent: '下書きの新しい返事' })),
    }, bindings);

    expect(response.status).toBe(200);
    expect(mocks.saveAutoReplyDraftVersion).toHaveBeenCalledOnce();
    expect(mocks.updateAutoReply).not.toHaveBeenCalled();
  });

  it('試験は本番評価器の結果を返し、送信や状態変更を行わない', async () => {
    const winner = rowFromSettings('rule-draft', settings());
    mocks.evaluateAutoReplyCandidates.mockResolvedValue([
      { rule: winner, order: 1, result: 'won', reasonCodes: [] },
    ]);

    const response = await app().request('/api/auto-replies/rule-draft/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        friendId: 'friend-a',
        incomingText: '予約したいです',
        occurredAt: '2026-08-30T03:00:00.000Z',
      }),
    }, bindings);
    const json = await response.json() as { data: { draftWon: boolean; stateChanged: boolean } };

    expect(response.status).toBe(200);
    expect(json.data).toMatchObject({ draftWon: true, stateChanged: false });
    expect(mocks.evaluateAutoReplyCandidates).toHaveBeenCalledOnce();
    expect(mocks.recordAutoReplyDraftTest).toHaveBeenCalledWith(db, 'version-draft', {
      succeeded: true,
      staffId: 'staff-a',
    });
    expect(mocks.publishAutoReplyDraftVersion).not.toHaveBeenCalled();
  });

  it('試験に成功していない下書きは公開しない', async () => {
    mocks.getAutoReplyDraftVersion.mockResolvedValue(version({ last_test_status: 'failed' }));

    const response = await app().request('/api/auto-replies/rule-draft/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': 'publish-test-0001' },
      body: '{}',
    }, bindings);

    expect(response.status).toBe(422);
    expect(mocks.publishAutoReplyDraftVersion).not.toHaveBeenCalled();
  });

  it('競合を確認するまで公開せず、確認後は同じキーをDBへ渡す', async () => {
    activeRules.push(rowFromSettings('rule-existing', settings({
      name: '既存の予約応答',
      priority: 1,
    })));

    const blocked = await app().request('/api/auto-replies/rule-draft/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': 'publish-test-0002' },
      body: '{}',
    }, bindings);
    expect(blocked.status).toBe(409);
    expect(mocks.publishAutoReplyDraftVersion).not.toHaveBeenCalled();

    const accepted = await app().request('/api/auto-replies/rule-draft/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': 'publish-test-0002' },
      body: JSON.stringify({ acknowledgedConflictIds: ['rule-existing'] }),
    }, bindings);
    expect(accepted.status).toBe(200);
    expect(mocks.publishAutoReplyDraftVersion).toHaveBeenCalledWith(db, 'rule-draft', {
      staffId: 'staff-a',
      idempotencyKey: 'publish-test-0002',
    });
  });

  it('別アカウントの下書きは存在を隠す', async () => {
    mocks.canAccessAllLineAccounts.mockResolvedValue(false);

    const response = await app().request('/api/auto-replies/rule-draft/validate', {
      method: 'POST',
    }, bindings);

    expect(response.status).toBe(404);
    expect(mocks.getAutoReplyDraftVersion).not.toHaveBeenCalled();
  });
});
