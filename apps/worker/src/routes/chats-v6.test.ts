import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const mocks = vi.hoisted(() => ({
  getVisibleLineAccountScope: vi.fn(),
  getSavedSearches: vi.fn(),
  createSavedSearch: vi.fn(),
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
    createSavedSearch: mocks.createSavedSearch,
  };
});

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
});

describe('V6受信箱のアカウント境界', () => {
  test('見えないLINEアカウントを一覧条件へ直接指定しても存在を返さない', async () => {
    const response = await app().request('/api/chats?lineAccountId=account-2', {}, {
      DB: {} as D1Database,
    } as Env['Bindings']);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ success: false });
  });
});

describe('V6受信箱の保存検索', () => {
  test('共有検索と自分の個人検索だけを返す', async () => {
    mocks.getSavedSearches.mockResolvedValue([
      saved('own', '自分用', 'staff-1', 0),
      saved('shared', '共有', 'staff-2', 1),
      saved('private', '他人用', 'staff-2', 0),
    ]);
    const response = await app().request('/api/inbox/saved-views', {}, {
      DB: {} as D1Database,
    } as Env['Bindings']);
    expect(response.status).toBe(200);
    const body = await response.json() as { data: Array<{ id: string }> };
    expect(body.data.map((row) => row.id)).toEqual(['own', 'shared']);
  });

  test('同じ所有者の同名と未知の状態を個別に拒否する', async () => {
    mocks.getSavedSearches.mockResolvedValue([saved('own', '未対応', 'staff-1', 0)]);
    const conditions = JSON.parse(saved('x', 'x', 'staff-1', 0).conditions_json);
    const duplicate = await app().request('/api/inbox/saved-views', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '未対応', conditions }),
    }, { DB: {} as D1Database } as Env['Bindings']);
    expect(duplicate.status).toBe(409);

    const invalid = await app().request('/api/inbox/saved-views', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '不正', conditions: { ...conditions, statuses: ['waiting'] } }),
    }, { DB: {} as D1Database } as Env['Bindings']);
    expect(invalid.status).toBe(422);
  });
});
