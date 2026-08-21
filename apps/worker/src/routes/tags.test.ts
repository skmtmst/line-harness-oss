import { describe, expect, test, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';

const dbMocks = {
  getTags: vi.fn(),
  getTagsWithCounts: vi.fn(),
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

describe('PATCH /api/tags/reorder', () => {
  beforeEach(() => {
    for (const fn of Object.values(dbMocks)) fn.mockReset();
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

  test('閲覧だけの人は並び替えられない', async () => {
    const res = await patch('/api/tags/reorder', { ids: ['a'] }, 'staff');
    expect(res.status).toBe(403);
    expect(dbMocks.reorderTags).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/tags/:id/mileage', () => {
  const storedTag = {
    id: 'tag-1',
    name: 'VIP',
    color: '#3B82F6',
    group_id: null,
    folder_id: null,
    mileage_reward: 100,
    referral_mileage_reward: 20,
    mileage_multiplier_bps: 15000,
    mileage_multiplier_priority: 1,
    is_starred: 0,
    display_order: 0,
    created_at: '2026-08-21T00:00:00.000Z',
  };

  beforeEach(() => {
    for (const fn of Object.values(dbMocks)) fn.mockReset();
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
