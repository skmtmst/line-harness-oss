import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const marks = {
  getSupportMarks: vi.fn(),
  getSupportMarkById: vi.fn(),
  createSupportMark: vi.fn(),
  updateSupportMark: vi.fn(),
  deleteSupportMark: vi.fn(),
  replaceAndDeleteSupportMark: vi.fn(),
  countFriendsWithMark: vi.fn(),
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
const accountAccess = {
  getVisibleLineAccountScope: vi.fn(),
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
  marks.getSupportMarks.mockResolvedValue([MARK]);
  marks.getSupportMarkById.mockResolvedValue(MARK);
  marks.createSupportMark.mockResolvedValue(MARK);
  marks.updateSupportMark.mockResolvedValue(MARK);
  marks.getDefaultSupportMark.mockResolvedValue(MARK);
  marks.replaceAndDeleteSupportMark.mockResolvedValue(0);
  marks.countFriendsWithMark.mockResolvedValue(0);
  marks.setFriendSupportMark.mockResolvedValue(true);
  marks.setFriendSupportMarkBulk.mockResolvedValue(2);
  searches.getSavedSearches.mockResolvedValue([SEARCH]);
  searches.getSavedSearchById.mockResolvedValue(SEARCH);
  searches.createSavedSearch.mockResolvedValue(SEARCH);
  searches.updateSavedSearch.mockResolvedValue(SEARCH);
  searches.deleteSavedSearch.mockResolvedValue(true);
  searches.countSavedSearches.mockResolvedValue(0);
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
    expect(marks.getSupportMarks).not.toHaveBeenCalled();
  });

  it('見えないLINE公式アカウントは404にする', async () => {
    const res = await req('/api/support-marks?lineAccountId=account-other', 'GET');
    expect(res.status).toBe(404);
    expect(marks.getSupportMarks).not.toHaveBeenCalled();
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
    expect(marks.getSupportMarks).not.toHaveBeenCalled();
  });

  it('一覧に付いている人数が入る', async () => {
    marks.countFriendsWithMark.mockResolvedValue(7);
    const res = await req('/api/support-marks?lineAccountId=account-1', 'GET');
    const body = (await res.json()) as { data: Array<{ friendCount: number }> };
    expect(body.data[0].friendCount).toBe(7);
    expect(marks.getSupportMarks).toHaveBeenCalledWith(env.DB, {
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
    expect(marks.deleteSupportMark).not.toHaveBeenCalled();
  });

  it('付いている人がいれば人数を返して止める', async () => {
    marks.getSupportMarkById.mockResolvedValue({ ...MARK, is_default: 0 });
    marks.countFriendsWithMark.mockResolvedValue(5);
    const res = await req('/api/support-marks/m-2?lineAccountId=account-1', 'DELETE');
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      friendCount: number;
      replacementMark: { id: string; name: string };
    };
    expect(body.friendCount).toBe(5);
    expect(body.replacementMark).toMatchObject({ id: 'm-1', name: '未対応' });
  });

  it('force=1 なら初期値へ置換してから消す', async () => {
    marks.getSupportMarkById.mockResolvedValue({ ...MARK, id: 'm-2', is_default: 0 });
    marks.countFriendsWithMark.mockResolvedValue(5);
    marks.replaceAndDeleteSupportMark.mockResolvedValue(5);
    const res = await req('/api/support-marks/m-2?lineAccountId=account-1&force=1', 'DELETE');
    expect(res.status).toBe(200);
    expect(marks.replaceAndDeleteSupportMark).toHaveBeenCalledWith(
      env.DB,
      'm-2',
      'm-1',
      { tenantId: 'tenant-1', lineAccountId: 'account-1' },
      'u-1',
    );
    expect(marks.deleteSupportMark).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({
      data: { replacedFriendCount: 5, replacementMark: { id: 'm-1' } },
    });
  });

  it('誰にも付いていないマークはそのまま消す', async () => {
    marks.getSupportMarkById.mockResolvedValue({ ...MARK, id: 'm-2', is_default: 0 });
    marks.countFriendsWithMark.mockResolvedValue(0);
    const res = await req('/api/support-marks/m-2?lineAccountId=account-1', 'DELETE');
    expect(res.status).toBe(200);
    expect(marks.deleteSupportMark).toHaveBeenCalledWith(
      env.DB,
      'm-2',
      { tenantId: 'tenant-1', lineAccountId: 'account-1' },
    );
    expect(marks.replaceAndDeleteSupportMark).not.toHaveBeenCalled();
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
    const body = (await res.json()) as { data: Array<{ conditions: { all: unknown[] } }> };
    expect(body.data[0].conditions.all).toHaveLength(1);
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
