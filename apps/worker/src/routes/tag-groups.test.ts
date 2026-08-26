import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const mocks = {
  getTags: vi.fn(),
  getTagsWithUsage: vi.fn(),
  createTag: vi.fn(),
  deleteTag: vi.fn(),
  updateTagMileageSettings: vi.fn(),
  enqueueHistoricTagMileage: vi.fn(),
  getTagGroups: vi.fn(),
  createTagGroup: vi.fn(),
  updateTagGroup: vi.fn(),
  deleteTagGroup: vi.fn(),
  assignTagToGroup: vi.fn(),
};
vi.mock('@line-crm/db', () => mocks);

const { tags } = await import('./tags.js');
const app = new Hono<Env>();
// 更新系はオーナー／管理者限定。ここで見たいのは本体の挙動なので、
// 認証は通った状態にしてから渡す。権限の検証は role-guard.test.ts が持つ。
app.use('*', async (c, next) => {
  c.set('staff', { id: 'owner-1', name: 'Owner', role: 'owner', readOnly: false });
  return next();
});
app.route('/', tags);
const env = { DB: {} as D1Database };

function req(path: string, method: string, body?: unknown) {
  return app.fetch(
    new Request(`https://example.com${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
}

const GROUP = {
  id: 'g-1',
  name: 'お悩み',
  sort_order: 0,
  created_at: '2026-08-15',
  updated_at: '2026-08-15',
};

const TAG = {
  id: 't-1',
  name: '腰痛',
  color: '#3B82F6',
  // group_idは旧互換列。APIはfoldersを正本とするfolder_idを返す。
  group_id: null,
  folder_id: 'g-1',
  mileage_reward: 0,
  referral_mileage_reward: 0,
  mileage_multiplier_bps: null,
  mileage_multiplier_priority: 0,
  created_at: '2026-08-15',
};

beforeEach(() => vi.clearAllMocks());

describe('タグの親分類', () => {
  it('分類を作れる', async () => {
    mocks.createTagGroup.mockResolvedValue(GROUP);
    const res = await req('/api/tag-groups', 'POST', { name: ' お悩み ' });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { name: string; sortOrder: number } };
    expect(body.data).toMatchObject({ name: 'お悩み', sortOrder: 0 });
    // 前後の空白は落とす。画面から貼り付けたときに空白付きの分類ができるのを防ぐ。
    // 色を指定しなければ null。色はフォルダに付く（115）。
    expect(mocks.createTagGroup).toHaveBeenCalledWith(env.DB, {
      name: 'お悩み',
      sortOrder: 0,
      color: null,
    });
  });

  it('色を付けて作れる', async () => {
    mocks.createTagGroup.mockResolvedValue({ ...GROUP, color: '#10B981' });
    const res = await req('/api/tag-groups', 'POST', { name: 'お悩み', color: '#10B981' });
    expect(res.status).toBe(201);
    expect(mocks.createTagGroup).toHaveBeenCalledWith(env.DB, {
      name: 'お悩み',
      sortOrder: 0,
      color: '#10B981',
    });
  });

  it('色の形が違うと作れない', async () => {
    // 名前付きの色を混ぜると、画面での見た目が揃わない。
    const res = await req('/api/tag-groups', 'POST', { name: 'お悩み', color: 'red' });
    expect(res.status).toBe(400);
    expect(mocks.createTagGroup).not.toHaveBeenCalled();
  });

  it('名前が空の分類は作れない', async () => {
    const res = await req('/api/tag-groups', 'POST', { name: '   ' });
    expect(res.status).toBe(400);
    expect(mocks.createTagGroup).not.toHaveBeenCalled();
  });

  it('並び順に整数以外は入らない', async () => {
    const res = await req('/api/tag-groups', 'POST', { name: 'お悩み', sortOrder: 1.5 });
    expect(res.status).toBe(400);
    expect(mocks.createTagGroup).not.toHaveBeenCalled();
  });

  it('無い分類の更新は404', async () => {
    mocks.updateTagGroup.mockResolvedValue(null);
    const res = await req('/api/tag-groups/nope', 'PATCH', { name: 'ペット' });
    expect(res.status).toBe(404);
  });

  it('送られた項目だけを更新する', async () => {
    mocks.updateTagGroup.mockResolvedValue(GROUP);
    await req('/api/tag-groups/g-1', 'PATCH', { sortOrder: 3 });
    expect(mocks.updateTagGroup).toHaveBeenCalledWith(env.DB, 'g-1', { sortOrder: 3 });
  });

  it('一覧は並び順つきで返る', async () => {
    mocks.getTagGroups.mockResolvedValue([GROUP]);
    const res = await req('/api/tag-groups', 'GET');
    const body = (await res.json()) as { data: Array<{ id: string; sortOrder: number }> };
    expect(body.data).toEqual([
      expect.objectContaining({ id: 'g-1', name: 'お悩み', sortOrder: 0 }),
    ]);
  });
});

describe('タグの所属', () => {
  it('タグを分類へ移せる', async () => {
    mocks.assignTagToGroup.mockResolvedValue(TAG);
    const res = await req('/api/tags/t-1/group', 'PATCH', { groupId: 'g-1' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { groupId: string | null } };
    expect(body.data.groupId).toBe('g-1');
  });

  it('null を送ると未分類に戻る', async () => {
    mocks.assignTagToGroup.mockResolvedValue({ ...TAG, folder_id: null });
    const res = await req('/api/tags/t-1/group', 'PATCH', { groupId: null });
    expect(mocks.assignTagToGroup).toHaveBeenCalledWith(env.DB, 't-1', null);
    const body = (await res.json()) as { data: { groupId: string | null } };
    expect(body.data.groupId).toBeNull();
  });

  it('空文字も未分類として扱う', async () => {
    // 画面のプルダウンで「未分類」を選ぶと空文字が飛ぶ。null と同じ意味にする。
    mocks.assignTagToGroup.mockResolvedValue({ ...TAG, folder_id: null });
    await req('/api/tags/t-1/group', 'PATCH', { groupId: '' });
    expect(mocks.assignTagToGroup).toHaveBeenCalledWith(env.DB, 't-1', null);
  });

  it('無い分類を指定すると400で理由が返る', async () => {
    // 500 だと画面側は「サーバーが壊れた」としか出せない。
    mocks.assignTagToGroup.mockRejectedValue(new Error('FOREIGN KEY constraint failed'));
    const res = await req('/api/tags/t-1/group', 'PATCH', { groupId: 'ghost' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('group not found');
  });

  it('タグの作成時に分類を指定できる', async () => {
    mocks.createTag.mockResolvedValue(TAG);
    const res = await req('/api/tags', 'POST', { name: '腰痛', groupId: 'g-1' });
    expect(res.status).toBe(201);
    expect(mocks.createTag).toHaveBeenCalledWith(
      env.DB,
      expect.objectContaining({ name: '腰痛', groupId: 'g-1' }),
    );
  });

  it('分類を指定せずに作ると未分類になる', async () => {
    mocks.createTag.mockResolvedValue({ ...TAG, folder_id: null });
    await req('/api/tags', 'POST', { name: '腰痛' });
    expect(mocks.createTag).toHaveBeenCalledWith(
      env.DB,
      expect.objectContaining({ groupId: null }),
    );
  });

  it('一覧のタグに所属が含まれる', async () => {
    mocks.getTags.mockResolvedValue([TAG]);
    const res = await req('/api/tags', 'GET');
    const body = (await res.json()) as { data: Array<{ groupId: string | null }> };
    expect(body.data[0].groupId).toBe('g-1');
  });

  it('旧group_idに値が残っていてもfolder_idを正として返す', async () => {
    mocks.getTags.mockResolvedValue([{ ...TAG, group_id: 'legacy-group', folder_id: 'folder-group' }]);
    const res = await req('/api/tags', 'GET');
    const body = (await res.json()) as { data: Array<{ groupId: string | null }> };
    expect(body.data[0].groupId).toBe('folder-group');
  });
});
