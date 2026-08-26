import { describe, expect, test, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';

const dbMocks = {
  getTags: vi.fn(),
  getTagsWithUsage: vi.fn(),
  getTagDeleteImpact: vi.fn(),
  createTag: vi.fn(),
  deleteTag: vi.fn(),
  updateTagMileageSettings: vi.fn(),
  enqueueHistoricTagMileage: vi.fn(),
  getTagGroups: vi.fn(),
  createTagGroup: vi.fn(),
  updateTagGroup: vi.fn(),
  deleteTagGroup: vi.fn(),
  assignTagToGroup: vi.fn(),
  updateTag: vi.fn(),
  reorderTags: vi.fn(),
  normalizeTagNameForCleanup: (name: string) => name
    .normalize('NFKC')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLocaleLowerCase('ja-JP'),
};
vi.mock('@line-crm/db', () => dbMocks);

const { tags } = await import('./tags.js');

type TestEnv = {
  Variables: { staff: { id: string; role: 'owner' | 'admin' | 'staff' } };
  Bindings: { DB: D1Database };
};

function app(role: 'owner' | 'admin' | 'staff' = 'owner') {
  const a = new Hono<TestEnv>();
  a.use('*', async (c, next) => {
    c.set('staff', { id: 'staff-1', role });
    c.env = { DB: {} as D1Database };
    await next();
  });
  a.route('/', tags);
  return a;
}

function patch(path: string, body: unknown, role: 'owner' | 'admin' | 'staff' = 'owner') {
  return app(role).request(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function post(path: string, body: unknown, role: 'owner' | 'admin' | 'staff' = 'owner') {
  return app(role).request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const TAG_ROW = {
  id: 'tag-1',
  name: 'VIP',
  color: '#3B82F6',
  group_id: null,
  folder_id: null,
  mileage_reward: 0,
  referral_mileage_reward: 0,
  mileage_multiplier_bps: null,
  mileage_multiplier_priority: 0,
  is_starred: 0,
  display_order: 0,
  created_at: '2026-08-21T00:00:00.000Z',
};

const EMPTY_TAG_REFERENCES = {
  broadcasts: 0,
  forms: 0,
  scenarios: 0,
  autoReplies: 0,
  savedSearches: 0,
  automations: 0,
  commonActions: 0,
  richMenus: 0,
  templates: 0,
  webinars: 0,
  reminders: 0,
  entryRoutes: 0,
  trackedLinks: 0,
  bookingMenus: 0,
  affiliateOffers: 0,
  events: 0,
  analyticsFunnels: 0,
  friendAddSettings: 0,
};

function tagDeleteImpact(overrides: {
  friendCount?: number;
  references?: Partial<typeof EMPTY_TAG_REFERENCES>;
} = {}) {
  const references = { ...EMPTY_TAG_REFERENCES, ...overrides.references };
  const blockingReferenceCount = Object.values(references).reduce((sum, count) => sum + count, 0);
  return {
    tag: { id: 'tag-1', name: 'VIP' },
    friendCount: overrides.friendCount ?? 0,
    references,
    blockingReferenceCount,
    canDelete: blockingReferenceCount === 0,
  };
}

describe('GET /api/tags', () => {
  beforeEach(() => {
    for (const fn of Object.values(dbMocks)) if ('mockReset' in fn) fn.mockReset();
  });

  test('管理一覧では人数と使用先をまとめて取得する', async () => {
    dbMocks.getTagsWithUsage.mockResolvedValue([{
      ...TAG_ROW,
      friend_count: 5,
      assign_source: 'form',
      used_in_broadcasts: 2,
      used_in_forms: 1,
      used_in_scenarios: 0,
      used_in_auto_replies: 0,
      used_in_saved_searches: 0,
      other_action_count: 3,
      cleanup_reasons: ['duplicate_name'],
    }]);

    const res = await app().request('/api/tags?withCounts=1');
    expect(res.status).toBe(200);
    expect(dbMocks.getTagsWithUsage).toHaveBeenCalledWith(expect.anything());
    expect(dbMocks.getTags).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      data: [{
        id: 'tag-1',
        friendCount: 5,
        assignSource: 'form',
        usedIn: { broadcasts: 2, forms: 1 },
        otherActionCount: 3,
        cleanupReasons: ['duplicate_name'],
      }],
    });
  });

  test('0件と未取得を画面用の値として水増ししない', async () => {
    dbMocks.getTagsWithUsage.mockResolvedValue([{
      ...TAG_ROW,
      friend_count: 0,
      assign_source: null,
      used_in_broadcasts: 0,
      used_in_forms: 0,
      used_in_scenarios: 0,
      used_in_auto_replies: 0,
      used_in_saved_searches: 0,
      other_action_count: 0,
      cleanup_reasons: ['unused'],
    }]);

    const res = await app().request('/api/tags?withCounts=1');
    const body = await res.json() as { data: Array<Record<string, unknown>> };
    expect(body.data[0]).not.toHaveProperty('assignSource');
    expect(body.data[0]).not.toHaveProperty('usedIn');
    expect(body.data[0]).not.toHaveProperty('otherActionCount');
    expect(body.data[0]).toHaveProperty('cleanupReasons', ['unused']);
  });

  test('集計済みで候補なしは空配列を返し、未取得と区別する', async () => {
    dbMocks.getTagsWithUsage.mockResolvedValue([{
      ...TAG_ROW,
      friend_count: 1,
      assign_source: null,
      used_in_broadcasts: 0,
      used_in_forms: 0,
      used_in_scenarios: 0,
      used_in_auto_replies: 0,
      used_in_saved_searches: 0,
      other_action_count: 0,
      cleanup_reasons: [],
    }]);

    const res = await app().request('/api/tags?withCounts=1');
    const body = await res.json() as { data: Array<Record<string, unknown>> };
    expect(body.data[0]).toHaveProperty('cleanupReasons', []);
  });

  test('選択部品向けの通常取得は軽い一覧のまま', async () => {
    dbMocks.getTags.mockResolvedValue([TAG_ROW]);
    const res = await app().request('/api/tags');
    expect(res.status).toBe(200);
    expect(dbMocks.getTags).toHaveBeenCalledWith(expect.anything());
    expect(dbMocks.getTagsWithUsage).not.toHaveBeenCalled();
    const body = await res.json() as { data: Array<Record<string, unknown>> };
    expect(body.data[0]).not.toHaveProperty('cleanupReasons');
  });
});

describe('POST /api/tags/import', () => {
  const GROUP_ROW = {
    id: 'folder-sales',
    name: '販売',
    color: '#3B82F6',
    sort_order: 0,
    created_at: '2026-08-21T00:00:00.000Z',
    updated_at: '2026-08-21T00:00:00.000Z',
  };

  beforeEach(() => {
    for (const fn of Object.values(dbMocks)) if ('mockReset' in fn) fn.mockReset();
    dbMocks.getTags.mockResolvedValue([]);
    dbMocks.getTagGroups.mockResolvedValue([GROUP_ROW]);
    dbMocks.createTag.mockImplementation(async (_db, input: { name: string; groupId: string | null }) => ({
      ...TAG_ROW,
      id: `tag-${input.name}`,
      name: input.name,
      folder_id: input.groupId,
    }));
  });

  test('保存せず、既存・CSV内重複・フォルダ不明・空欄を行ごとに判定する', async () => {
    dbMocks.getTags.mockResolvedValue([{ ...TAG_ROW, name: 'VIP' }]);

    const res = await post('/api/tags/import/preview', { rows: [
      { line: 2, name: '新規', folderName: '販売' },
      { line: 3, name: ' ＶＩＰ ' },
      { line: 4, name: 'Ｎｅｗ' },
      { line: 5, name: 'new' },
      { line: 6, name: '別タグ', folderName: '不明' },
      { line: 7, name: '' },
      { line: 8, name: 'x'.repeat(61) },
    ] });

    expect(res.status).toBe(200);
    expect(dbMocks.createTag).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      data: {
        summary: { total: 7, ready: 2, created: 0, skipped: 2, invalid: 3, failed: 0 },
        rows: [
          { line: 2, status: 'ready' },
          { line: 3, status: 'skipped', code: 'already_exists' },
          { line: 4, status: 'ready' },
          { line: 5, status: 'skipped', code: 'duplicate_in_file' },
          { line: 6, status: 'invalid', code: 'folder_not_found' },
          { line: 7, status: 'invalid', code: 'name_required' },
          { line: 8, status: 'invalid', code: 'name_too_long' },
        ],
      },
    });
  });

  test('500件を超える要求はDBを読まずに断る', async () => {
    const res = await post('/api/tags/import/preview', {
      rows: Array.from({ length: 501 }, (_, index) => ({ name: `タグ${index}` })),
    });
    expect(res.status).toBe(422);
    expect(dbMocks.getTags).not.toHaveBeenCalled();
    expect(dbMocks.getTagGroups).not.toHaveBeenCalled();
  });

  test('閲覧だけの人はプレビューも登録もできない', async () => {
    expect((await post('/api/tags/import/preview', { rows: [{ name: 'A' }] }, 'staff')).status)
      .toBe(403);
    expect((await post('/api/tags/import', { rows: [{ name: 'A' }] }, 'staff')).status)
      .toBe(403);
    expect(dbMocks.getTags).not.toHaveBeenCalled();
  });

  test('一部失敗しても残りを登録し、失敗行を返す', async () => {
    dbMocks.createTag.mockImplementation(async (_db, input: { name: string; groupId: string | null }) => {
      if (input.name === '失敗') throw new Error('D1 unavailable');
      return { ...TAG_ROW, id: `tag-${input.name}`, name: input.name, folder_id: input.groupId };
    });

    const res = await post('/api/tags/import', { rows: [
      { line: 2, name: '成功', folderName: '販売' },
      { line: 3, name: '不明フォルダ', folderName: '不明' },
      { line: 4, name: '失敗' },
      { line: 5, name: '次も成功' },
    ] });

    expect(res.status).toBe(200);
    expect(dbMocks.createTag).toHaveBeenCalledTimes(3);
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      data: {
        outcome: 'partial',
        summary: { total: 4, ready: 0, created: 2, skipped: 0, invalid: 1, failed: 1 },
        rows: [
          { line: 2, status: 'created' },
          { line: 3, status: 'invalid', code: 'folder_not_found' },
          { line: 4, status: 'failed', code: 'create_failed' },
          { line: 5, status: 'created' },
        ],
      },
    });
  });

  test('確認後に同名タグが作られても失敗ではなく見送りにする', async () => {
    dbMocks.createTag.mockRejectedValue(new Error('UNIQUE constraint failed: tags.name'));
    const res = await post('/api/tags/import', { rows: [{ name: '競合' }] });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      data: {
        outcome: 'success',
        summary: { created: 0, skipped: 1, invalid: 0, failed: 0 },
        rows: [{ status: 'skipped', code: 'already_exists' }],
      },
    });
  });

  test('登録できる行がなく入力不備だけなら失敗結果にする', async () => {
    const res = await post('/api/tags/import', { rows: [{ name: '', folderName: '不明' }] });
    await expect(res.json()).resolves.toMatchObject({
      data: { outcome: 'failed', summary: { created: 0, invalid: 1 } },
    });
    expect(dbMocks.createTag).not.toHaveBeenCalled();
  });
});

describe('GET /api/tags/:id/delete-impact', () => {
  beforeEach(() => {
    for (const fn of Object.values(dbMocks)) if ('mockReset' in fn) fn.mockReset();
  });

  test('削除前に友だち人数と運用設定の参照を返す', async () => {
    dbMocks.getTagDeleteImpact.mockResolvedValue({
      tag: { id: 'tag-1', name: 'VIP' },
      friendCount: 5,
      references: {
        broadcasts: 2,
        forms: 0,
        scenarios: 1,
        autoReplies: 0,
        savedSearches: 0,
        automations: 0,
        commonActions: 0,
        richMenus: 0,
        templates: 0,
        webinars: 0,
        reminders: 0,
        entryRoutes: 0,
        trackedLinks: 0,
        bookingMenus: 0,
        affiliateOffers: 0,
        events: 0,
        analyticsFunnels: 0,
        friendAddSettings: 0,
      },
      blockingReferenceCount: 3,
      canDelete: false,
    });

    const res = await app().request('/api/tags/tag-1/delete-impact');
    expect(res.status).toBe(200);
    expect(dbMocks.getTagDeleteImpact).toHaveBeenCalledWith(expect.anything(), 'tag-1');
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      data: { friendCount: 5, blockingReferenceCount: 3, canDelete: false },
    });
  });

  test('存在しないタグは404にする', async () => {
    dbMocks.getTagDeleteImpact.mockResolvedValue(null);
    const res = await app().request('/api/tags/missing/delete-impact');
    expect(res.status).toBe(404);
  });

  test('閲覧だけの人には削除影響を見せない', async () => {
    const res = await app('staff').request('/api/tags/tag-1/delete-impact');
    expect(res.status).toBe(403);
    expect(dbMocks.getTagDeleteImpact).not.toHaveBeenCalled();
  });

  test('集計失敗を空の影響として扱わない', async () => {
    dbMocks.getTagDeleteImpact.mockRejectedValue(new Error('D1 unavailable'));
    const res = await app().request('/api/tags/tag-1/delete-impact');
    expect(res.status).toBe(500);
  });
});

describe('DELETE /api/tags/:id', () => {
  beforeEach(() => {
    for (const fn of Object.values(dbMocks)) if ('mockReset' in fn) fn.mockReset();
  });

  test('運用設定から参照中のタグはAPIを直接呼んでも削除しない', async () => {
    dbMocks.getTagDeleteImpact.mockResolvedValue(tagDeleteImpact({
      references: { broadcasts: 2, automations: 1 },
    }));

    const res = await app().request('/api/tags/tag-1', { method: 'DELETE' });

    expect(res.status).toBe(409);
    expect(dbMocks.deleteTag).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({
      success: false,
      code: 'TAG_IN_USE',
      data: {
        blockingReferenceCount: 3,
        references: { broadcasts: 2, automations: 1 },
      },
    });
  });

  test('友だちへの付与だけなら警告対象のまま削除できる', async () => {
    dbMocks.getTagDeleteImpact.mockResolvedValue(tagDeleteImpact({ friendCount: 12 }));
    dbMocks.deleteTag.mockResolvedValue(undefined);

    const res = await app().request('/api/tags/tag-1', { method: 'DELETE' });

    expect(res.status).toBe(200);
    expect(dbMocks.deleteTag).toHaveBeenCalledWith(expect.anything(), 'tag-1');
  });

  test('存在しないタグは削除しない', async () => {
    dbMocks.getTagDeleteImpact.mockResolvedValue(null);

    const res = await app().request('/api/tags/missing', { method: 'DELETE' });

    expect(res.status).toBe(404);
    expect(dbMocks.deleteTag).not.toHaveBeenCalled();
  });

  test('影響を確認できないときは安全側に止める', async () => {
    dbMocks.getTagDeleteImpact.mockRejectedValue(new Error('D1 unavailable'));

    const res = await app().request('/api/tags/tag-1', { method: 'DELETE' });

    expect(res.status).toBe(500);
    expect(dbMocks.deleteTag).not.toHaveBeenCalled();
  });

  test('影響確認後に外部キー競合が起きても409で止める', async () => {
    dbMocks.getTagDeleteImpact.mockResolvedValue(tagDeleteImpact());
    dbMocks.deleteTag.mockRejectedValue(new Error('FOREIGN KEY constraint failed'));

    const res = await app().request('/api/tags/tag-1', { method: 'DELETE' });

    expect(res.status).toBe(409);
  });

  test('閲覧だけの人は影響確認にも削除にも進めない', async () => {
    const res = await app('staff').request('/api/tags/tag-1', { method: 'DELETE' });

    expect(res.status).toBe(403);
    expect(dbMocks.getTagDeleteImpact).not.toHaveBeenCalled();
    expect(dbMocks.deleteTag).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/tags/reorder', () => {
  beforeEach(() => {
    for (const fn of Object.values(dbMocks)) if ('mockReset' in fn) fn.mockReset();
    dbMocks.updateTag.mockResolvedValue(null);
  });

  test('渡された並びをそのまま保存する', async () => {
    const res = await patch('/api/tags/reorder', { ids: ['c', 'a', 'b'] });
    expect(res.status).toBe(200);
    expect(dbMocks.reorderTags).toHaveBeenCalledWith(expect.anything(), ['c', 'a', 'b']);
  });

  test(':id に食われない', async () => {
    // Hono は先に登録した経路が勝つ。/api/tags/:id が先にあると "reorder" が
    // タグIDとして扱われ、並び替えのつもりが名前の変更として届く。
    await patch('/api/tags/reorder', { ids: ['a'] });
    expect(dbMocks.reorderTags).toHaveBeenCalled();
    expect(dbMocks.updateTag).not.toHaveBeenCalled();
  });

  test('配列でないものは断る', async () => {
    const res = await patch('/api/tags/reorder', { ids: 'a,b' });
    expect(res.status).toBe(400);
    expect(dbMocks.reorderTags).not.toHaveBeenCalled();
  });

  test('文字列以外が混じっていたら断る', async () => {
    const res = await patch('/api/tags/reorder', { ids: ['a', 42] });
    expect(res.status).toBe(400);
    expect(dbMocks.reorderTags).not.toHaveBeenCalled();
  });

  test('多すぎる並びは断る', async () => {
    // 取り違えか壊れた要求。まとめ書きが際限なく走るのを止める。
    const res = await patch('/api/tags/reorder', { ids: Array(501).fill('a') });
    expect(res.status).toBe(400);
    expect(dbMocks.reorderTags).not.toHaveBeenCalled();
  });

  test('同じIDが重複していたら断る', async () => {
    const res = await patch('/api/tags/reorder', { ids: ['a', 'b', 'a'] });
    expect(res.status).toBe(400);
    expect(dbMocks.reorderTags).not.toHaveBeenCalled();
  });

  test('閲覧だけの人は並び替えられない', async () => {
    const res = await patch('/api/tags/reorder', { ids: ['a'] }, 'staff');
    expect(res.status).toBe(403);
    expect(dbMocks.reorderTags).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/tags/:id/mileage', () => {
  const storedTag = {
    ...TAG_ROW,
    mileage_reward: 100,
    referral_mileage_reward: 20,
    mileage_multiplier_bps: 15000,
    mileage_multiplier_priority: 1,
  };

  beforeEach(() => {
    for (const fn of Object.values(dbMocks)) if ('mockReset' in fn) fn.mockReset();
    dbMocks.updateTagMileageSettings.mockResolvedValue(storedTag);
    dbMocks.enqueueHistoricTagMileage.mockResolvedValue(12);
  });

  test('通常の保存では既存ユーザーへ遡及しない', async () => {
    const res = await patch('/api/tags/tag-1/mileage', {
      rewardMiles: 100,
      referralRewardMiles: 20,
      multiplierBps: 15000,
      multiplierPriority: 1,
    });

    expect(res.status).toBe(200);
    expect(dbMocks.enqueueHistoricTagMileage).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({ success: true, data: { queued: 0 } });
  });

  test('遡及を明示した場合だけ既存ユーザーをキューへ登録する', async () => {
    const res = await patch('/api/tags/tag-1/mileage', {
      rewardMiles: 100,
      referralRewardMiles: 20,
      multiplierBps: 15000,
      multiplierPriority: 1,
      applyToExisting: true,
    });

    expect(res.status).toBe(200);
    expect(dbMocks.enqueueHistoricTagMileage).toHaveBeenCalledWith(expect.anything(), 'tag-1');
    await expect(res.json()).resolves.toMatchObject({ success: true, data: { queued: 12 } });
  });
});
