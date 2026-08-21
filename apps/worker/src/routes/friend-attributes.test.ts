import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const marks = {
  getSupportMarks: vi.fn(),
  getSupportMarkById: vi.fn(),
  createSupportMark: vi.fn(),
  updateSupportMark: vi.fn(),
  deleteSupportMark: vi.fn(),
  countFriendsWithMark: vi.fn(),
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
  SAVED_SEARCH_LIMIT: 50,
  SAVED_SEARCH_SCOPES: ['friends', 'chats', 'bookings'],
  validateSearchConditions: (raw: unknown) => {
    const obj = raw as { all?: unknown[]; any?: unknown[] } | null;
    if (!obj || (!obj.all?.length && !obj.any?.length)) {
      return { ok: false as const, error: '条件が1つもありません' };
    }
    return { ok: true as const, value: obj };
  },
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

const { friendAttributes } = await import('./friend-attributes.js');

function makeApp(role: 'owner' | 'admin' | 'staff' = 'owner') {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'u-1', name: 'テスト', role, readOnly: false });
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
};

const SEARCH = {
  id: 's-1',
  name: '犬の飼い主',
  scope: 'friends',
  conditions_json: '{"all":[{"kind":"tag","op":"has","value":"t1"}]}',
  created_by: 'u-1',
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
  marks.getSupportMarks.mockResolvedValue([MARK]);
  marks.getSupportMarkById.mockResolvedValue(MARK);
  marks.createSupportMark.mockResolvedValue(MARK);
  marks.updateSupportMark.mockResolvedValue(MARK);
  marks.countFriendsWithMark.mockResolvedValue(0);
  marks.setFriendSupportMarkBulk.mockResolvedValue(2);
  searches.getSavedSearches.mockResolvedValue([SEARCH]);
  searches.getSavedSearchById.mockResolvedValue(SEARCH);
  searches.createSavedSearch.mockResolvedValue(SEARCH);
  searches.updateSavedSearch.mockResolvedValue(SEARCH);
  searches.countSavedSearches.mockResolvedValue(0);
  folders.getFolders.mockResolvedValue([FOLDER]);
  folders.getFolderById.mockResolvedValue(FOLDER);
  folders.createFolder.mockResolvedValue(FOLDER);
  folders.updateFolder.mockResolvedValue(FOLDER);
});

describe('対応マーク', () => {
  it('一覧に付いている人数が入る', async () => {
    marks.countFriendsWithMark.mockResolvedValue(7);
    const res = await req('/api/support-marks', 'GET');
    const body = (await res.json()) as { data: Array<{ friendCount: number }> };
    expect(body.data[0].friendCount).toBe(7);
  });

  it('色の形が違えば弾く', async () => {
    const res = await req('/api/support-marks', 'POST', { name: 'x', color: 'red' });
    expect(res.status).toBe(400);
    expect(marks.createSupportMark).not.toHaveBeenCalled();
  });

  it('既定を外す操作は止める', async () => {
    // 既定が1つも無いと、新しい友だちに何も付かない。
    const res = await req('/api/support-marks/m-1', 'PATCH', { isDefault: false });
    expect(res.status).toBe(409);
    expect(marks.updateSupportMark).not.toHaveBeenCalled();
  });

  it('別のマークを既定にするのは通る', async () => {
    marks.getSupportMarkById.mockResolvedValue({ ...MARK, id: 'm-2', is_default: 0 });
    const res = await req('/api/support-marks/m-2', 'PATCH', { isDefault: true });
    expect(res.status).toBe(200);
  });

  it('既定のマークは削除できない', async () => {
    const res = await req('/api/support-marks/m-1', 'DELETE');
    expect(res.status).toBe(409);
    expect(marks.deleteSupportMark).not.toHaveBeenCalled();
  });

  it('付いている人がいれば人数を返して止める', async () => {
    marks.getSupportMarkById.mockResolvedValue({ ...MARK, is_default: 0 });
    marks.countFriendsWithMark.mockResolvedValue(5);
    const res = await req('/api/support-marks/m-2', 'DELETE');
    expect(res.status).toBe(409);
    const body = (await res.json()) as { friendCount: number };
    expect(body.friendCount).toBe(5);
  });

  it('force=1 なら消す', async () => {
    marks.getSupportMarkById.mockResolvedValue({ ...MARK, is_default: 0 });
    marks.countFriendsWithMark.mockResolvedValue(5);
    const res = await req('/api/support-marks/m-2?force=1', 'DELETE');
    expect(res.status).toBe(200);
  });

  it('無いマークは付けられない', async () => {
    marks.getSupportMarkById.mockResolvedValue(null);
    const res = await req('/api/friends/f-1/support-mark', 'PATCH', { markId: 'ghost' });
    expect(res.status).toBe(400);
    expect(marks.setFriendSupportMark).not.toHaveBeenCalled();
  });

  it('null は未設定に戻す（存在確認をしない）', async () => {
    await req('/api/friends/f-1/support-mark', 'PATCH', { markId: null });
    expect(marks.setFriendSupportMark).toHaveBeenCalledWith(env.DB, 'f-1', null);
  });

  it('スタッフでもマークは変えられる', async () => {
    // 対応の状態は現場が付けるもの。管理者しか触れないと運用が回らない。
    const res = await req('/api/friends/f-1/support-mark', 'PATCH', { markId: 'm-1' }, 'staff');
    expect(res.status).toBe(200);
  });

  it('一括は1000人まで', async () => {
    const res = await req('/api/friends/support-mark/bulk', 'POST', {
      friendIds: Array.from({ length: 1001 }, (_, i) => `f-${i}`),
      markId: 'm-1',
    });
    expect(res.status).toBe(422);
  });
});

describe('保存した検索', () => {
  it('50件を超えたら422', async () => {
    searches.countSavedSearches.mockResolvedValue(50);
    const res = await req('/api/saved-searches', 'POST', {
      name: 'x',
      conditions: { all: [{ kind: 'tag', op: 'has' }] },
    });
    expect(res.status).toBe(422);
    expect(searches.createSavedSearch).not.toHaveBeenCalled();
  });

  it('上限は条件の検証より先に見る', async () => {
    // 条件を通してから弾くと、書いた条件が無駄になる。
    searches.countSavedSearches.mockResolvedValue(50);
    const res = await req('/api/saved-searches', 'POST', { name: 'x', conditions: {} });
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('50');
  });

  it('条件が空なら422', async () => {
    const res = await req('/api/saved-searches', 'POST', { name: 'x', conditions: {} });
    expect(res.status).toBe(422);
  });

  it('知らない scope は friends に寄せる', async () => {
    await req('/api/saved-searches', 'POST', {
      name: 'x',
      scope: 'planets',
      conditions: { all: [{ kind: 'tag', op: 'has' }] },
    });
    expect(searches.createSavedSearch).toHaveBeenCalledWith(
      env.DB,
      expect.objectContaining({ scope: 'friends' }),
    );
  });

  it('条件はJSONを解いて返す', async () => {
    const res = await req('/api/saved-searches', 'GET');
    const body = (await res.json()) as { data: Array<{ conditions: { all: unknown[] } }> };
    expect(body.data[0].conditions.all).toHaveLength(1);
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
