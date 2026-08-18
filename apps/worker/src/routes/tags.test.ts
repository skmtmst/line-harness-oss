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
