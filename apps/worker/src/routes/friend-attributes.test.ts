import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const marks = {
  getSupportMarksWithUsage: vi.fn(),
  getSupportMarkById: vi.fn(),
  createSupportMark: vi.fn(),
  updateSupportMark: vi.fn(),
  replaceAndArchiveSupportMark: vi.fn(),
  getDefaultSupportMark: vi.fn(),
  setFriendSupportMark: vi.fn(),
  setFriendSupportMarkBulk: vi.fn(),
};
const searches = {
  getSavedSearches: vi.fn(),
  getSavedSearchById: vi.fn(),
  createSavedSearch: vi.fn(),
  updateSavedSearch: vi.fn(),
  deleteSavedSearch: vi.fn(),
  countSavedSearches: vi.fn(),
  getSavedSearchReferences: vi.fn(),
  SAVED_SEARCH_LIMIT: 50,
  SAVED_SEARCH_SCOPES: ['friends', 'chats', 'bookings'],
  validateSearchConditions: (raw: unknown) => {
    const obj = raw as { all?: unknown[]; any?: unknown[] } | null;
    if (!obj || (!obj.all?.length && !obj.any?.length)) {
      return { ok: false as const, error: '条件が1つもありません' };
    }
    return { ok: true as const, value: obj };
  },
  validateSavedSegmentConditions: (raw: unknown) => {
    const obj = raw as { version?: unknown; condition?: { rules?: unknown[] } } | null;
    if (!obj || obj.version !== 1 || !obj.condition?.rules?.length) {
      return { ok: false as const, error: '対象条件が1つもありません' };
    }
    return { ok: true as const, value: obj };
  },
};
const accountAccess = {
  getVisibleLineAccountScope: vi.fn(),
};
const savedSearchInsights = {
  getSavedSearchMatchInsights: vi.fn(),
};
const supportMarkAutomation = {
  SUPPORT_MARK_RULE_EVENTS: [
    'message_received', 'manual_reply_sent', 'staff_assigned', 'response_overdue', 'condition_matched',
  ],
  listSupportMarkAutomationRules: vi.fn(),
  createSupportMarkAutomationRule: vi.fn(),
  updateSupportMarkAutomationRule: vi.fn(),
  archiveSupportMarkAutomationRule: vi.fn(),
};
const segmentQuery = {
  buildSegmentWhere: vi.fn(),
};
const folders = {
  getFolders: vi.fn(),
  getFolderById: vi.fn(),
  createFolder: vi.fn(),
  updateFolder: vi.fn(),
  deleteFolder: vi.fn(),
  isFolderKind: (v: unknown) =>
    typeof v === 'string' && ['tag', 'template', 'media'].includes(v),
};
vi.mock('@line-crm/db', () => ({ ...marks, ...searches, ...folders }));
vi.mock('../services/account-access.js', () => accountAccess);
vi.mock('../services/saved-search-insights.js', () => savedSearchInsights);
vi.mock('../services/support-mark-automation.js', () => supportMarkAutomation);
vi.mock('../services/segment-query.js', () => segmentQuery);

const { friendAttributes } = await import('./friend-attributes.js');

function makeApp(role: 'owner' | 'admin' | 'staff' = 'owner') {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'u-1', name: 'テスト', role, readOnly: false, tenantId: 'tenant-1' });
    return next();
  });
  app.route('/', friendAttributes);
  return app;
}
const env = { DB: {} as D1Database };

function req(path: string, method: string, body?: unknown, role?: 'owner' | 'admin' | 'staff') {
  return makeApp(role).fetch(
    new Request(`https://example.com${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
}

const MARK = {
  id: 'm-1',
  name: '未対応',
  color: '#F59E0B',
  is_default: 1,
  auto_on_inbound: 1,
  display_order: 0,
  created_at: '2026-08-16',
  archived_at: null,
  tenant_id: 'tenant-1',
  line_account_id: 'account-1',
  is_inherited: 0,
};

const SEARCH = {
  id: 's-1',
  name: '犬の飼い主',
  scope: 'friends',
  conditions_json: '{"all":[{"kind":"tag","op":"has","value":"t1"}]}',
  created_by: 'u-1',
  line_account_id: 'account-1',
  is_shared: 1,
  display_order: 0,
  created_at: '2026-08-16',
};

const FOLDER = {
  id: 'fo-1',
  kind: 'template',
  name: 'よく使う',
  parent_id: null,
  display_order: 0,
  created_at: '2026-08-16',
  updated_at: '2026-08-16',
};

beforeEach(() => {
  vi.clearAllMocks();
  marks.getSupportMarksWithUsage.mockResolvedValue([{
    ...MARK,
    friend_count: 7,
    broadcasts: 2,
    scenarios: 1,
    auto_replies: 0,
    saved_searches: 3,
    automations: 1,
  }]);
  marks.getSupportMarkById.mockResolvedValue(MARK);
  marks.createSupportMark.mockResolvedValue(MARK);
  marks.updateSupportMark.mockResolvedValue(MARK);
  marks.getDefaultSupportMark.mockResolvedValue(MARK);
  marks.replaceAndArchiveSupportMark.mockResolvedValue(0);
  marks.setFriendSupportMark.mockResolvedValue(true);
  marks.setFriendSupportMarkBulk.mockResolvedValue(2);
  supportMarkAutomation.listSupportMarkAutomationRules.mockResolvedValue([]);
  supportMarkAutomation.createSupportMarkAutomationRule.mockResolvedValue({
    id: 'rule-1', name: '担当者が決まったら対応中へ', markId: 'm-1', event: 'staff_assigned',
    condition: null, priority: 100, manualProtectionMinutes: 60, isActive: true,
    version: 1, updatedAt: '2026-09-04T09:00:00+09:00',
  });
  supportMarkAutomation.updateSupportMarkAutomationRule.mockResolvedValue({
    id: 'rule-1', version: 2,
  });
  supportMarkAutomation.archiveSupportMarkAutomationRule.mockResolvedValue('archived');
  searches.getSavedSearches.mockResolvedValue([SEARCH]);
  searches.getSavedSearchById.mockResolvedValue(SEARCH);
  searches.createSavedSearch.mockResolvedValue(SEARCH);
  searches.updateSavedSearch.mockResolvedValue(SEARCH);
  searches.deleteSavedSearch.mockResolvedValue(true);
  searches.countSavedSearches.mockResolvedValue(0);
  searches.getSavedSearchReferences.mockResolvedValue([]);
  savedSearchInsights.getSavedSearchMatchInsights.mockResolvedValue(new Map([
    ['s-1', { matchCount: 7, matchCountError: null }],
  ]));
  segmentQuery.buildSegmentWhere.mockReturnValue({ sql: '1 = 1', bindings: [] });
  accountAccess.getVisibleLineAccountScope.mockResolvedValue({
    accounts: [{ id: 'account-1' }],
    ids: ['account-1'],
    allowedAccountIds: ['account-1'],
    canSeeUnassigned: false,
  });
  folders.getFolders.mockResolvedValue([FOLDER]);
  folders.getFolderById.mockResolvedValue(FOLDER);
  folders.createFolder.mockResolvedValue(FOLDER);
  folders.updateFolder.mockResolvedValue(FOLDER);
});

describe('対応マーク', () => {
  it('LINE公式アカウント未選択なら一覧を返さない', async () => {
    const res = await req('/api/support-marks', 'GET');
    expect(res.status).toBe(400);
    expect(marks.getSupportMarksWithUsage).not.toHaveBeenCalled();
  });

  it('見えないLINE公式アカウントは404にする', async () => {
    const res = await req('/api/support-marks?lineAccountId=account-other', 'GET');
    expect(res.status).toBe(404);
    expect(marks.getSupportMarksWithUsage).not.toHaveBeenCalled();
  });

  it('所属テナントを確認できない利用者には返さない', async () => {
    const app = new Hono<Env>();
    app.use('*', async (c, next) => {
      c.set('staff', {
        id: 'u-no-tenant',
        name: '所属不明',
        role: 'staff',
        readOnly: false,
        tenantId: null,
      });
      return next();
    });
    app.route('/', friendAttributes);
    const res = await app.fetch(
      new Request('https://example.com/api/support-marks?lineAccountId=account-1'),
      env,
    );
    expect(res.status).toBe(403);
    expect(accountAccess.getVisibleLineAccountScope).not.toHaveBeenCalled();
    expect(marks.getSupportMarksWithUsage).not.toHaveBeenCalled();
  });

  it('一覧に付いている人数が入る', async () => {
    const res = await req('/api/support-marks?lineAccountId=account-1', 'GET');
    const body = (await res.json()) as { data: Array<{ friendCount: number; usedIn: { broadcasts: number; savedSearches: number } }> };
    expect(body.data[0].friendCount).toBe(7);
    expect(body.data[0].usedIn).toMatchObject({ broadcasts: 2, savedSearches: 3 });
    expect(marks.getSupportMarksWithUsage).toHaveBeenCalledWith(env.DB, {
      tenantId: 'tenant-1',
      lineAccountId: 'account-1',
    });
  });

  it('色の形が違えば弾く', async () => {
    const res = await req('/api/support-marks?lineAccountId=account-1', 'POST', { name: 'x', color: 'red' });
    expect(res.status).toBe(400);
    expect(marks.createSupportMark).not.toHaveBeenCalled();
  });

  it('既定を外す操作は止める', async () => {
    // 既定が1つも無いと、新しい友だちに何も付かない。
    const res = await req('/api/support-marks/m-1?lineAccountId=account-1', 'PATCH', { isDefault: false });
    expect(res.status).toBe(409);
    expect(marks.updateSupportMark).not.toHaveBeenCalled();
  });

  it('別のマークを既定にするのは通る', async () => {
    marks.getSupportMarkById.mockResolvedValue({ ...MARK, id: 'm-2', is_default: 0 });
    const res = await req('/api/support-marks/m-2?lineAccountId=account-1', 'PATCH', { isDefault: true });
    expect(res.status).toBe(200);
  });

  it('既定のマークは削除できない', async () => {
    const res = await req('/api/support-marks/m-1?lineAccountId=account-1', 'DELETE');
    expect(res.status).toBe(409);
    expect(marks.replaceAndArchiveSupportMark).not.toHaveBeenCalled();
  });

  it('設定参照があれば友だちと使用先の影響を返して止める', async () => {
    marks.getSupportMarkById.mockResolvedValue({ ...MARK, id: 'm-2', is_default: 0 });
    marks.getSupportMarksWithUsage.mockResolvedValue([{
      ...MARK,
      id: 'm-2',
      is_default: 0,
      friend_count: 5,
      broadcasts: 2,
      scenarios: 1,
      auto_replies: 0,
      saved_searches: 3,
      automations: 1,
    }]);
    const res = await req('/api/support-marks/m-2?lineAccountId=account-1', 'DELETE', {});
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      friendCount: number;
      usedIn: { broadcasts: number; savedSearches: number };
      replacementMark: { id: string; name: string };
    };
    expect(body.friendCount).toBe(5);
    expect(body.usedIn).toMatchObject({ broadcasts: 2, savedSearches: 3 });
    expect(body).toMatchObject({ code: 'REFERENCED' });
    expect(marks.replaceAndArchiveSupportMark).not.toHaveBeenCalled();
  });

  it('使用先が無くても置換先を明示しなければ保管しない', async () => {
    marks.getSupportMarkById.mockResolvedValue({ ...MARK, id: 'm-2', is_default: 0 });
    marks.getSupportMarksWithUsage.mockResolvedValue([{
      ...MARK,
      id: 'm-2',
      is_default: 0,
      friend_count: 0,
      broadcasts: 0,
      scenarios: 0,
      auto_replies: 0,
      saved_searches: 0,
      automations: 0,
    }]);
    const res = await req('/api/support-marks/m-2?lineAccountId=account-1', 'DELETE', {});
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'REPLACEMENT_REQUIRED' });
    expect(marks.replaceAndArchiveSupportMark).not.toHaveBeenCalled();
  });

  it('確認した影響が同じなら友だちを置換してマークを保管する', async () => {
    marks.getSupportMarkById.mockResolvedValue({ ...MARK, id: 'm-2', is_default: 0 });
    marks.getSupportMarksWithUsage.mockResolvedValue([{
      ...MARK,
      id: 'm-2',
      is_default: 0,
      friend_count: 5,
      broadcasts: 0,
      scenarios: 0,
      auto_replies: 0,
      saved_searches: 0,
      automations: 0,
    }]);
    marks.replaceAndArchiveSupportMark.mockResolvedValue(5);
    const expectedImpact = {
      friendCount: 5,
      usedIn: { broadcasts: 0, scenarios: 0, autoReplies: 0, savedSearches: 0, automations: 0 },
    };
    const res = await req('/api/support-marks/m-2?lineAccountId=account-1', 'DELETE', {
      replacementMarkId: 'm-1',
      expectedImpact,
    });
    expect(res.status).toBe(200);
    expect(marks.replaceAndArchiveSupportMark).toHaveBeenCalledWith(
      env.DB,
      'm-2',
      'm-1',
      { tenantId: 'tenant-1', lineAccountId: 'account-1' },
      'u-1',
    );
    expect(await res.json()).toMatchObject({
      data: {
        archived: true,
        replacedFriendCount: 5,
        replacementMark: { id: 'm-1' },
      },
    });
  });

  it('確認後に影響が変われば保管せず読み直させる', async () => {
    marks.getSupportMarkById.mockResolvedValue({ ...MARK, id: 'm-2', is_default: 0 });
    marks.getSupportMarksWithUsage.mockResolvedValue([{
      ...MARK,
      id: 'm-2',
      is_default: 0,
      friend_count: 1,
      broadcasts: 0,
      scenarios: 0,
      auto_replies: 0,
      saved_searches: 0,
      automations: 0,
    }]);
    const res = await req('/api/support-marks/m-2?lineAccountId=account-1', 'DELETE', {
      replacementMarkId: 'm-1',
      expectedImpact: {
        friendCount: 0,
        usedIn: { broadcasts: 0, scenarios: 0, autoReplies: 0, savedSearches: 0, automations: 0 },
      },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'IMPACT_CHANGED', friendCount: 1 });
    expect(marks.replaceAndArchiveSupportMark).not.toHaveBeenCalled();
  });

  it('使用先がある共有マークは編集せず止める', async () => {
    marks.getSupportMarkById.mockResolvedValue({ ...MARK, id: 'm-shared', is_default: 0, is_inherited: 1 });
    marks.getSupportMarksWithUsage.mockResolvedValue([{
      ...MARK,
      id: 'm-shared',
      is_default: 0,
      is_inherited: 1,
      friend_count: 2,
      broadcasts: 1,
      scenarios: 0,
      auto_replies: 0,
      saved_searches: 0,
      automations: 0,
    }]);
    const res = await req('/api/support-marks/m-shared?lineAccountId=account-1', 'PATCH', {
      name: '店舗専用',
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'INHERITED_MARK_IN_USE' });
    expect(marks.updateSupportMark).not.toHaveBeenCalled();
  });

  it('無いマークは付けられない', async () => {
    marks.getSupportMarkById.mockResolvedValue(null);
    const res = await req('/api/friends/f-1/support-mark?lineAccountId=account-1', 'PATCH', { markId: 'ghost' });
    expect(res.status).toBe(400);
    expect(marks.setFriendSupportMark).not.toHaveBeenCalled();
  });

  it('null は未設定に戻す（存在確認をしない）', async () => {
    await req('/api/friends/f-1/support-mark?lineAccountId=account-1', 'PATCH', { markId: null });
    expect(marks.setFriendSupportMark).toHaveBeenCalledWith(
      env.DB,
      'f-1',
      null,
      { tenantId: 'tenant-1', lineAccountId: 'account-1' },
      'u-1',
    );
  });

  it('スタッフでもマークは変えられる', async () => {
    // 対応の状態は現場が付けるもの。管理者しか触れないと運用が回らない。
    const res = await req('/api/friends/f-1/support-mark?lineAccountId=account-1', 'PATCH', { markId: 'm-1' }, 'staff');
    expect(res.status).toBe(200);
  });

  it('一括は1000人まで', async () => {
    const res = await req('/api/friends/support-mark/bulk?lineAccountId=account-1', 'POST', {
      friendIds: Array.from({ length: 1001 }, (_, i) => `f-${i}`),
      markId: 'm-1',
    });
    expect(res.status).toBe(422);
  });

  it('自動変更ルールは選択中のアカウントとマークだけを一覧する', async () => {
    const res = await req('/api/support-marks/m-1/automation-rules?lineAccountId=account-1', 'GET');
    expect(res.status).toBe(200);
    expect(supportMarkAutomation.listSupportMarkAutomationRules).toHaveBeenCalledWith(
      env.DB,
      { tenantId: 'tenant-1', lineAccountId: 'account-1' },
      'm-1',
    );
  });

  it('自動変更ルールを選択中のマークへ作成する', async () => {
    const input = {
      name: '担当者が決まったら対応中へ', event: 'staff_assigned', condition: null,
      priority: 100, manualProtectionMinutes: 60, isActive: true,
    };
    const res = await req(
      '/api/support-marks/m-1/automation-rules?lineAccountId=account-1',
      'POST',
      input,
    );
    expect(res.status).toBe(201);
    expect(supportMarkAutomation.createSupportMarkAutomationRule).toHaveBeenCalledWith(
      env.DB,
      { tenantId: 'tenant-1', lineAccountId: 'account-1' },
      'm-1',
      'u-1',
      input,
    );
  });

  it('版競合を成功扱いにせず409で読み直しを促す', async () => {
    supportMarkAutomation.updateSupportMarkAutomationRule.mockResolvedValue('conflict');
    const res = await req('/api/support-mark-rules/rule-1?lineAccountId=account-1', 'PATCH', {
      name: '担当者が決まったら対応中へ', event: 'staff_assigned', condition: null,
      priority: 100, manualProtectionMinutes: 60, isActive: true, expectedVersion: 1,
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'SUPPORT_MARK_RULE_VERSION_CONFLICT' });
  });

  it('読み込んだ版を指定して自動変更ルールを更新する', async () => {
    const input = {
      name: '担当者が決まったら対応中へ', event: 'staff_assigned', condition: null,
      priority: 100, manualProtectionMinutes: 60, isActive: true,
    };

    const res = await req('/api/support-mark-rules/rule-1?lineAccountId=account-1', 'PATCH', {
      ...input,
      expectedVersion: 1,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, data: { id: 'rule-1', version: 2 } });
    expect(supportMarkAutomation.updateSupportMarkAutomationRule).toHaveBeenCalledWith(
      env.DB,
      { tenantId: 'tenant-1', lineAccountId: 'account-1' },
      'rule-1',
      'u-1',
      1,
      input,
    );
  });

  it('スタッフは自動変更ルールを作れない', async () => {
    const res = await req('/api/support-marks/m-1/automation-rules?lineAccountId=account-1', 'POST', {
      name: '受信で未対応へ', event: 'message_received', condition: null,
      priority: 10, manualProtectionMinutes: 0, isActive: true,
    }, 'staff');
    expect(res.status).toBe(403);
    expect(supportMarkAutomation.createSupportMarkAutomationRule).not.toHaveBeenCalled();
  });

  it('保管は読み込んだ版を必須にし、競合を409で返す', async () => {
    const missingVersion = await req(
      '/api/support-mark-rules/rule-1?lineAccountId=account-1',
      'DELETE',
    );
    expect(missingVersion.status).toBe(400);
    expect(supportMarkAutomation.archiveSupportMarkAutomationRule).not.toHaveBeenCalled();

    supportMarkAutomation.archiveSupportMarkAutomationRule.mockResolvedValueOnce('conflict');
    const conflict = await req(
      '/api/support-mark-rules/rule-1?lineAccountId=account-1',
      'DELETE',
      { expectedVersion: 2 },
    );
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: 'SUPPORT_MARK_RULE_VERSION_CONFLICT' });
    expect(supportMarkAutomation.archiveSupportMarkAutomationRule).toHaveBeenCalledWith(
      env.DB,
      { tenantId: 'tenant-1', lineAccountId: 'account-1' },
      'rule-1',
      2,
    );
  });

  it('読み込んだ版を指定して自動変更ルールを停止する', async () => {
    const res = await req(
      '/api/support-mark-rules/rule-1?lineAccountId=account-1',
      'DELETE',
      { expectedVersion: 2 },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: null });
    expect(supportMarkAutomation.archiveSupportMarkAutomationRule).toHaveBeenCalledWith(
      env.DB,
      { tenantId: 'tenant-1', lineAccountId: 'account-1' },
      'rule-1',
      2,
    );
  });
});

describe('保存した検索', () => {
  it('50件を超えたら422', async () => {
    searches.countSavedSearches.mockResolvedValue(50);
    const res = await req('/api/saved-searches?lineAccountId=account-1', 'POST', {
      name: 'x',
      conditions: { all: [{ kind: 'tag', op: 'has' }] },
    });
    expect(res.status).toBe(422);
    expect(searches.createSavedSearch).not.toHaveBeenCalled();
  });

  it('上限は条件の検証より先に見る', async () => {
    // 条件を通してから弾くと、書いた条件が無駄になる。
    searches.countSavedSearches.mockResolvedValue(50);
    const res = await req('/api/saved-searches?lineAccountId=account-1', 'POST', { name: 'x', conditions: {} });
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('50');
  });

  it('条件が空なら422', async () => {
    const res = await req('/api/saved-searches?lineAccountId=account-1', 'POST', { name: 'x', conditions: {} });
    expect(res.status).toBe(422);
  });

  it('配信対象条件は専用形式で保存し、同じ条件評価器を通す', async () => {
    const conditions = {
      version: 1,
      condition: { operator: 'AND', rules: [{ type: 'tag_exists', value: 'tag-1' }] },
    };
    searches.createSavedSearch.mockResolvedValueOnce({
      ...SEARCH,
      condition_format: 'segment_v1',
      conditions_json: JSON.stringify(conditions),
    });
    const res = await req('/api/saved-searches?format=segment_v1&lineAccountId=account-1', 'POST', {
      name: 'VIP向け',
      conditions,
    });
    expect(res.status).toBe(201);
    expect(segmentQuery.buildSegmentWhere).toHaveBeenCalledWith(conditions.condition);
    expect(searches.countSavedSearches).toHaveBeenCalledWith(env.DB, expect.objectContaining({
      scope: 'friends',
      conditionFormat: 'segment_v1',
    }));
    expect(searches.createSavedSearch).toHaveBeenCalledWith(env.DB, expect.objectContaining({
      name: 'VIP向け',
      scope: 'friends',
      conditionFormat: 'segment_v1',
      conditions,
    }));
  });

  it('実送信の評価器が読めない配信対象条件は保存しない', async () => {
    segmentQuery.buildSegmentWhere.mockImplementationOnce(() => { throw new Error('bad rule'); });
    const res = await req('/api/saved-searches?format=segment_v1&lineAccountId=account-1', 'POST', {
      name: '壊れた条件',
      conditions: {
        version: 1,
        condition: { operator: 'AND', rules: [{ type: 'tag_exists', value: 'tag-1' }] },
      },
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: '保存した対象条件を確認してください' });
    expect(searches.createSavedSearch).not.toHaveBeenCalled();
  });

  it('配信対象条件の一覧では旧検索の集計器を使わない', async () => {
    searches.getSavedSearches.mockResolvedValueOnce([{ ...SEARCH, condition_format: 'segment_v1' }]);
    const res = await req('/api/saved-searches?format=segment_v1&lineAccountId=account-1', 'GET');
    expect(res.status).toBe(200);
    expect(searches.getSavedSearches).toHaveBeenCalledWith(
      env.DB,
      'friends',
      expect.objectContaining({ lineAccountId: 'account-1' }),
      'segment_v1',
    );
    expect(savedSearchInsights.getSavedSearchMatchInsights).not.toHaveBeenCalled();
  });

  it('旧検索の口から配信対象条件を更新できない', async () => {
    searches.getSavedSearchById.mockResolvedValueOnce({ ...SEARCH, condition_format: 'segment_v1' });
    const res = await req('/api/saved-searches/s-1?lineAccountId=account-1', 'PATCH', {
      name: '別の名前',
    });
    expect(res.status).toBe(404);
    expect(searches.updateSavedSearch).not.toHaveBeenCalled();
  });

  it('別機能の scope は汎用APIで扱わない', async () => {
    const res = await req('/api/saved-searches?lineAccountId=account-1', 'POST', {
      name: 'x',
      scope: 'planets',
      conditions: { all: [{ kind: 'tag', op: 'has' }] },
    });
    expect(res.status).toBe(400);
    expect(searches.createSavedSearch).not.toHaveBeenCalled();
  });

  it('条件はJSONを解いて返す', async () => {
    const res = await req('/api/saved-searches?lineAccountId=account-1', 'GET');
    const body = (await res.json()) as {
      data: Array<{
        conditions: { all: unknown[] };
        matchCount: number | null;
        usedIn: unknown[];
        canDelete: boolean;
      }>;
    };
    expect(body.data[0].conditions.all).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ matchCount: 7, usedIn: [], canDelete: true });
  });

  it('使用先と該当人数を同じ一覧APIで返す', async () => {
    searches.getSavedSearchReferences.mockResolvedValue([{
      saved_search_id: 's-1',
      line_account_id: 'account-1',
      reference_kind: 'broadcast',
      reference_id: 'broadcast-1',
      reference_name: '月末のご案内',
      reference_mode: 'live',
      last_used_at: '2026-08-28T10:00:00.000',
      created_at: '2026-08-28T09:00:00.000',
    }]);
    const res = await req('/api/saved-searches?lineAccountId=account-1', 'GET');
    const body = (await res.json()) as {
      data: Array<{ usedIn: Array<{ name: string; mode: string }>; canDelete: boolean }>;
    };
    expect(body.data[0]).toMatchObject({
      usedIn: [{ name: '月末のご案内', mode: 'live' }],
      canDelete: false,
    });
    expect(searches.getSavedSearchReferences).toHaveBeenCalledWith(env.DB, ['s-1'], 'account-1');
  });

  it('スタッフ一覧は同じアカウントの共有・本人と本人の旧検索だけを返す', async () => {
    searches.getSavedSearches.mockResolvedValue([
      SEARCH,
      { ...SEARCH, id: 'own', created_by: 'u-1', is_shared: 0 },
      { ...SEARCH, id: 'private', created_by: 'u-2', is_shared: 0 },
      { ...SEARCH, id: 'other-account', line_account_id: 'account-2' },
      { ...SEARCH, id: 'other-scope', scope: 'chats' },
      { ...SEARCH, id: 'legacy-own', line_account_id: null, created_by: 'u-1', is_shared: 0 },
      { ...SEARCH, id: 'legacy-other', line_account_id: null, created_by: 'u-2', is_shared: 1 },
    ]);
    const res = await req('/api/saved-searches?lineAccountId=account-1', 'GET', undefined, 'staff');
    const body = (await res.json()) as { data: Array<{ id: string }> };
    expect(body.data.map((item) => item.id)).toEqual(['s-1', 'own', 'legacy-own']);
  });

  it('選択中のLINEアカウントが無ければ一覧を返さない', async () => {
    const res = await req('/api/saved-searches', 'GET');
    expect(res.status).toBe(400);
    expect(searches.getSavedSearches).not.toHaveBeenCalled();
  });

  it('他人の個人検索をスタッフが更新・削除できない', async () => {
    searches.getSavedSearchById.mockResolvedValue({ ...SEARCH, created_by: 'u-2', is_shared: 0 });
    const patchRes = await req('/api/saved-searches/s-1?lineAccountId=account-1', 'PATCH', { name: '盗用' }, 'staff');
    const deleteRes = await req('/api/saved-searches/s-1?lineAccountId=account-1', 'DELETE', undefined, 'staff');
    expect(patchRes.status).toBe(404);
    expect(deleteRes.status).toBe(404);
    expect(searches.updateSavedSearch).not.toHaveBeenCalled();
    expect(searches.deleteSavedSearch).not.toHaveBeenCalled();
  });

  it('管理者は同じアカウントの個人検索を更新できる', async () => {
    searches.getSavedSearchById.mockResolvedValue({ ...SEARCH, created_by: 'u-2', is_shared: 0 });
    const res = await req('/api/saved-searches/s-1?lineAccountId=account-1', 'PATCH', { name: '管理名' }, 'admin');
    expect(res.status).toBe(200);
    expect(searches.updateSavedSearch).toHaveBeenCalledWith(
      env.DB,
      's-1',
      expect.objectContaining({ lineAccountId: 'account-1', canManageAll: true }),
      expect.objectContaining({ name: '管理名' }),
    );
  });

  it('担当外アカウントは存在を漏らさず404にする', async () => {
    const res = await req('/api/saved-searches?lineAccountId=account-2', 'GET', undefined, 'staff');
    expect(res.status).toBe(404);
    expect(searches.getSavedSearches).not.toHaveBeenCalled();
  });

  it('別scopeや別アカウントのIDは管理者でも更新できない', async () => {
    searches.getSavedSearchById.mockResolvedValue({ ...SEARCH, scope: 'chats' });
    const wrongScope = await req('/api/saved-searches/s-1?lineAccountId=account-1', 'PATCH', { name: 'x' }, 'admin');
    searches.getSavedSearchById.mockResolvedValue({ ...SEARCH, line_account_id: 'account-2' });
    const wrongAccount = await req('/api/saved-searches/s-1?lineAccountId=account-1', 'DELETE', undefined, 'admin');
    expect(wrongScope.status).toBe(404);
    expect(wrongAccount.status).toBe(404);
    expect(searches.updateSavedSearch).not.toHaveBeenCalled();
    expect(searches.deleteSavedSearch).not.toHaveBeenCalled();
  });

  it('使用中の検索はAPIを直接呼んでも削除できない', async () => {
    searches.getSavedSearchReferences.mockResolvedValue([{
      saved_search_id: 's-1',
      line_account_id: 'account-1',
      reference_kind: 'automation',
      reference_id: 'automation-1',
      reference_name: '休眠顧客フォロー',
      reference_mode: 'live',
      last_used_at: null,
      created_at: '2026-08-28T09:00:00.000',
    }]);
    const res = await req('/api/saved-searches/s-1?lineAccountId=account-1', 'DELETE');
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      success: false,
      data: { usedIn: [{ name: '休眠顧客フォロー', mode: 'live' }] },
    });
    expect(searches.deleteSavedSearch).not.toHaveBeenCalled();
  });
});

describe('フォルダ', () => {
  it('知らない種類は弾く', async () => {
    const res = await req('/api/folders', 'POST', { kind: 'planets', name: 'x' });
    expect(res.status).toBe(400);
  });

  it('2段までしか作れない', async () => {
    // 深くすると画面が組み立てられなくなる。
    folders.getFolderById.mockResolvedValue({ ...FOLDER, parent_id: 'fo-0' });
    const res = await req('/api/folders', 'POST', {
      kind: 'template',
      name: '孫',
      parentId: 'fo-1',
    });
    expect(res.status).toBe(422);
  });

  it('別の種類のフォルダには入れられない', async () => {
    folders.getFolderById.mockResolvedValue({ ...FOLDER, kind: 'media' });
    const res = await req('/api/folders', 'POST', {
      kind: 'template',
      name: 'x',
      parentId: 'fo-1',
    });
    expect(res.status).toBe(422);
  });

  it('自分を自分の親にはできない', async () => {
    const res = await req('/api/folders/fo-1', 'PATCH', { parentId: 'fo-1' });
    expect(res.status).toBe(422);
  });

  it('種類で絞れる', async () => {
    await req('/api/folders?kind=template', 'GET');
    expect(folders.getFolders).toHaveBeenCalledWith(env.DB, 'template');
  });

  it('知らない種類での絞り込みは弾く', async () => {
    const res = await req('/api/folders?kind=planets', 'GET');
    expect(res.status).toBe(400);
  });
});
