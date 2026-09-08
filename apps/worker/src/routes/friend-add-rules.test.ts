import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';

const db = vi.hoisted(() => ({
  archiveFriendAddRule: vi.fn(),
  createFriendAddRuleDraft: vi.fn(),
  ensureFriendAddFallbackRules: vi.fn(),
  getFriendAddRule: vi.fn(),
  listFriendAddRules: vi.fn(),
  listFriendAddRulesPage: vi.fn(),
  publishFriendAddRule: vi.fn(),
  recordFriendAddRuleTest: vi.fn(),
  saveFriendAddRuleDraft: vi.fn(),
  stopFriendAddRule: vi.fn(),
}));

const access = vi.hoisted(() => ({ getVisibleLineAccountScope: vi.fn() }));

vi.mock('@line-crm/db', () => db);
vi.mock('../services/account-access.js', () => access);

const { friendAddRules } = await import('./friend-add-rules.js');

function makeApp(staff: AuthenticatedStaff) {
  const result = new Hono<Env>();
  result.use('*', async (c, next) => {
    c.set('staff', staff);
    await next();
  });
  result.route('/', friendAddRules);
  return result;
}

const app = makeApp({
  id: 'staff-1', name: '担当者', role: 'admin', readOnly: false,
  tenantId: 'tenant-1', permissionKeys: ['/friend-add-settings'],
});

const definition = {
  routeIds: ['route-1'],
  scenarioId: 'scenario-1',
  messageType: 'text' as const,
  messageText: 'はじめまして',
  timing: 'immediate' as const,
  actions: [],
  friendCondition: '',
  activeFrom: null,
  activeUntil: null,
};

const rule = {
  id: 'rule-1', line_account_id: 'account-1', friend_kind: 'first_time' as const,
  name: '紹介QR', folder_name: null, priority: 1, is_unknown_route_fallback: 0,
  status: 'draft' as const, current_version_id: null, archived_at: null,
  created_at: '2026-09-06T00:00:00', updated_at: '2026-09-06T00:00:00',
  version_id: 'version-1', version_number: 1, version_status: 'draft' as const,
  definition_snapshot: JSON.stringify(definition), last_test_status: null,
  last_tested_at: null, last_tested_by_staff_id: null, last_tested_by_staff_name: null,
  published_at: null, matched_last_7_days: null,
  lock_version: 1,
};

function makeEnv() {
  const prepare = vi.fn((sql: string) => ({
    bind: vi.fn(() => ({
      all: vi.fn().mockResolvedValue(sql.includes('entry_routes')
        ? { results: [{ id: 'route-1', name: '紹介QR', kind: 'QR' }] }
        : sql.includes('scenarios')
          ? { results: [{ id: 'scenario-1', name: '初回案内' }] }
          : sql.includes('tags')
            ? { results: [{ id: 'tag-1', name: '紹介' }] }
            : { results: [] }),
      first: vi.fn().mockResolvedValue(sql.includes('FROM scenarios')
        ? { id: 'scenario-1' }
        : { today: 1, captured: 1, unknown_route: 0, delivered: 1, failed: 0 }),
      run: vi.fn().mockResolvedValue({ success: true }),
    })),
  }));
  return { DB: { prepare } as unknown as D1Database } as Env['Bindings'];
}

beforeEach(() => {
  vi.clearAllMocks();
  access.getVisibleLineAccountScope.mockResolvedValue({ ids: ['account-1'] });
  db.listFriendAddRules.mockResolvedValue([rule]);
  db.listFriendAddRulesPage.mockResolvedValue({ items: [rule], total: 1, nextCursor: null });
  db.getFriendAddRule.mockResolvedValue(rule);
  db.createFriendAddRuleDraft.mockResolvedValue(rule);
  db.publishFriendAddRule.mockResolvedValue({ ...rule, version_status: 'published', published_at: '2026-09-06T00:01:00' });
});

describe('friend add rules API', () => {
  test('選択できないLINEアカウントの設定を返さない', async () => {
    const response = await app.request('/api/friend-add-rules?account_id=account-2&kind=first_time', {}, makeEnv());
    expect(response.status).toBe(404);
    expect(db.listFriendAddRules).not.toHaveBeenCalled();
  });

  test('一覧はLINEアカウントと判定する人で絞る', async () => {
    const response = await app.request('/api/friend-add-rules?account_id=account-1&kind=first_time', {}, makeEnv());
    expect(response.status).toBe(200);
    expect(db.listFriendAddRulesPage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      lineAccountId: 'account-1', friendKind: 'first_time',
    }));
    const body = await response.json() as { data: { items: Array<{ id: string }> } };
    expect(body.data.items).toEqual([expect.objectContaining({ id: 'rule-1' })]);
  });

  test('参照先を確認して同じLINEアカウントの下書きを作る', async () => {
    const response = await app.request('/api/friend-add-rules/drafts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': 'friend-rule-create-0001' },
      body: JSON.stringify({ accountId: 'account-1', friendKind: 'first_time', name: '紹介QR', priority: 1, definition }),
    }, makeEnv());
    expect(response.status).toBe(201);
    expect(db.createFriendAddRuleDraft).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      lineAccountId: 'account-1', friendKind: 'first_time',
    }));
  });

  test('テストは実データを更新せず、成功した下書きに印だけを残す', async () => {
    const response = await app.request('/api/friend-add-rules/test', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accountId: 'account-1', ruleId: 'rule-1' }),
    }, makeEnv());
    expect(response.status).toBe(200);
    const body = await response.json() as { data: { stateChanged: boolean; matched: boolean } };
    expect(body.data).toMatchObject({ stateChanged: false, matched: true });
    expect(db.recordFriendAddRuleTest).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      lineAccountId: 'account-1', ruleId: 'rule-1', staffId: 'staff-1', succeeded: true,
    }));
  });

  test('スタッフは機能権限があるときだけテストでき、実施者を記録する', async () => {
    const allowed = makeApp({
      id: 'staff-allowed', name: 'テスト担当', role: 'staff', readOnly: false,
      tenantId: 'tenant-1', permissionKeys: ['/friend-add-settings'],
    });
    const denied = makeApp({
      id: 'staff-denied', name: '権限なし', role: 'staff', readOnly: false,
      tenantId: 'tenant-1', permissionKeys: [],
    });
    const request = {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accountId: 'account-1', ruleId: 'rule-1' }),
    };

    expect((await allowed.request('/api/friend-add-rules/test', request, makeEnv())).status).toBe(200);
    expect(db.recordFriendAddRuleTest).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
      staffId: 'staff-allowed',
    }));

    db.recordFriendAddRuleTest.mockClear();
    expect((await denied.request('/api/friend-add-rules/test', request, makeEnv())).status).toBe(403);
    expect(db.recordFriendAddRuleTest).not.toHaveBeenCalled();
    expect((await allowed.request('/api/friend-add-rules/rule-1/publish?account_id=account-1', {
      method: 'POST', headers: { 'Idempotency-Key': 'friend-rule-publish-0001' },
    }, makeEnv())).status).toBe(403);
  });

  test('公開は冪等キーをDB処理へ渡す', async () => {
    const response = await app.request('/api/friend-add-rules/rule-1/publish?account_id=account-1', {
      method: 'POST', headers: { 'Idempotency-Key': 'friend-rule-publish-0001' },
    }, makeEnv());
    expect(response.status).toBe(200);
    expect(db.publishFriendAddRule).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      idempotencyKey: 'friend-rule-publish-0001',
    }));
  });
});
