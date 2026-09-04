import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const mocks = vi.hoisted(() => ({
  getVisibleLineAccountScope: vi.fn(),
  getSavedSearches: vi.fn(),
  getSavedSearchById: vi.fn(),
  createSavedSearch: vi.fn(),
  updateSavedSearch: vi.fn(),
  deleteSavedSearch: vi.fn(),
  computeUnansweredInbox: vi.fn(),
}));

vi.mock('../services/account-access.js', () => ({
  getVisibleLineAccountScope: mocks.getVisibleLineAccountScope,
  canAccessAllLineAccounts: vi.fn(async () => true),
}));

vi.mock('@line-crm/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@line-crm/db')>();
  return {
    ...actual,
    getSavedSearches: mocks.getSavedSearches,
    getSavedSearchById: mocks.getSavedSearchById,
    createSavedSearch: mocks.createSavedSearch,
    updateSavedSearch: mocks.updateSavedSearch,
    deleteSavedSearch: mocks.deleteSavedSearch,
  };
});

vi.mock('../services/unanswered-inbox.js', () => ({
  computeUnansweredInbox: mocks.computeUnansweredInbox,
}));

import { chats } from './chats.js';

function app() {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', {
      id: 'staff-1',
      name: '担当者',
      role: 'staff',
      readOnly: false,
      tenantId: 'tenant-1',
      permissionKeys: ['/chats'],
      assignedLineAccountId: 'account-1',
      canAccessDescendantAccounts: false,
    });
    return next();
  });
  app.route('/', chats);
  return app;
}

const saved = (id: string, name: string, createdBy: string, isShared: number) => ({
  id,
  name,
  scope: 'chats',
  conditions_json: JSON.stringify({
    version: 1,
    query: '',
    channels: ['line'],
    statuses: ['unread'],
    assignees: [],
    unread: 'all',
    messageTypes: [],
    receivedFrom: null,
    receivedTo: null,
    sort: 'newest',
  }),
  created_by: createdBy,
  line_account_id: 'account-1',
  is_shared: isShared,
  display_order: 0,
  created_at: '2026-08-26T10:00:00Z',
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getVisibleLineAccountScope.mockResolvedValue({
    accounts: [{ id: 'account-1' }],
    ids: ['account-1'],
    allowedAccountIds: ['account-1'],
    canSeeUnassigned: false,
  });
  mocks.getSavedSearches.mockResolvedValue([]);
  mocks.getSavedSearchById.mockResolvedValue(null);
  mocks.updateSavedSearch.mockResolvedValue(null);
  mocks.deleteSavedSearch.mockResolvedValue(false);
  mocks.computeUnansweredInbox.mockResolvedValue({
    total: 0,
    page: 1,
    pageSize: 200,
    rows: [],
  });
});

describe('V6受信箱のアカウント境界', () => {
  test('見えないLINEアカウントを一覧条件へ直接指定しても存在を返さない', async () => {
    const response = await app().request('/api/chats?lineAccountId=account-2', {}, {
      DB: {} as D1Database,
    } as Env['Bindings']);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ success: false });
  });

  test('未対応一覧は要求値が大きくてもDBページを200件に制限する', async () => {
    const response = await app().request('/api/chats?unansweredOnly=true&limit=999', {}, {
      DB: {} as D1Database,
    } as Env['Bindings']);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: [] });
    expect(mocks.computeUnansweredInbox).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ page: 1, pageSize: 200 }),
    );
  });

  test('未対応一覧の検索・アカウント・状態・担当者をDBページングへ渡す', async () => {
    const response = await app().request(
      '/api/chats?unansweredOnly=true&q=%E8%A6%81%E7%A2%BA%E8%AA%8D&lineAccountId=account-1&status=unread&operatorId=operator-1&limit=25',
      {},
      { DB: {} as D1Database } as Env['Bindings'],
    );

    expect(response.status).toBe(200);
    expect(mocks.computeUnansweredInbox).toHaveBeenCalledWith(expect.anything(), {
      q: '要確認',
      account: 'account-1',
      status: 'unread',
      operatorId: 'operator-1',
      page: 1,
      pageSize: 25,
      allowedAccountIds: ['account-1'],
      canSeeUnassigned: false,
    });
  });

  test.each([
    ['/api/chats?limit=999999', 200],
    ['/api/chats?limit=-1', 200],
    ['/api/chats?limit=NaN', 200],
    ['/api/chats?unansweredOnly=false', 200],
  ])('%s は無制限取得せず最大200件に止める', async (path, expected) => {
    const calls: Array<{ sql: string; binds: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        const call = { sql, binds: [] as unknown[] };
        calls.push(call);
        const statement = {
          bind(...binds: unknown[]) { call.binds = binds; return statement; },
          all: vi.fn(async () => ({ results: [] })),
        };
        return statement;
      },
    } as unknown as D1Database;

    const response = await app().request(path, {}, { DB: db } as Env['Bindings']);
    expect(response.status).toBe(200);
    const list = calls.find(({ sql }) => sql.includes('WITH last_any AS MATERIALIZED'));
    expect(list?.binds.at(-2)).toBe(expected);
    expect(list?.binds).not.toContain(-1);
  });
});

describe('V6受信箱の保存検索', () => {
  test('共有検索と自分の個人検索だけを返す', async () => {
    mocks.getSavedSearches.mockResolvedValue([
      saved('own', '自分用', 'staff-1', 0),
      saved('shared', '共有', 'staff-2', 1),
      saved('private', '他人用', 'staff-2', 0),
    ]);
    const response = await app().request('/api/inbox/saved-views?lineAccountId=account-1', {}, {
      DB: {} as D1Database,
    } as Env['Bindings']);
    expect(response.status).toBe(200);
    const body = await response.json() as { data: Array<{ id: string }> };
    expect(body.data.map((row) => row.id)).toEqual(['own', 'shared']);
  });

  test('同じ所有者の同名と未知の状態を個別に拒否する', async () => {
    mocks.getSavedSearches.mockResolvedValue([saved('own', '未対応', 'staff-1', 0)]);
    const conditions = JSON.parse(saved('x', 'x', 'staff-1', 0).conditions_json);
    const duplicate = await app().request('/api/inbox/saved-views?lineAccountId=account-1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '未対応', conditions }),
    }, { DB: {} as D1Database } as Env['Bindings']);
    expect(duplicate.status).toBe(409);

    const invalid = await app().request('/api/inbox/saved-views?lineAccountId=account-1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '不正', conditions: { ...conditions, statuses: ['waiting'] } }),
    }, { DB: {} as D1Database } as Env['Bindings']);
    expect(invalid.status).toBe(422);
  });

  test('他人の個人検索と別アカウントIDは更新・削除できない', async () => {
    mocks.getSavedSearchById.mockResolvedValue(saved('private', '他人用', 'staff-2', 0));
    const patchResponse = await app().request('/api/inbox/saved-views/private?lineAccountId=account-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '変更' }),
    }, { DB: {} as D1Database } as Env['Bindings']);
    mocks.getSavedSearchById.mockResolvedValue({
      ...saved('wrong-account', '別店舗', 'staff-1', 0),
      line_account_id: 'account-2',
    });
    const deleteResponse = await app().request('/api/inbox/saved-views/wrong-account?lineAccountId=account-1', {
      method: 'DELETE',
    }, { DB: {} as D1Database } as Env['Bindings']);
    expect(patchResponse.status).toBe(404);
    expect(deleteResponse.status).toBe(404);
    expect(mocks.updateSavedSearch).not.toHaveBeenCalled();
    expect(mocks.deleteSavedSearch).not.toHaveBeenCalled();
  });
});
