import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { FRIEND_ADD_ROUTING_DEFAULT } from '@line-crm/shared';
import type { Env } from '../index.js';

const db = vi.hoisted(() => ({
  getLineAccounts: vi.fn(),
  getStaffById: vi.fn(),
  getStaffAccountScopeIds: vi.fn(),
  listFriendAddEvents: vi.fn(),
}));

const routing = vi.hoisted(() => ({
  loadFriendAddRouting: vi.fn(),
  saveFriendAddRouting: vi.fn(),
  normalizeRouting: vi.fn(),
  previewFriendAddRouting: vi.fn(),
  listFriendAddScenarios: vi.fn(),
  classifyFriend: vi.fn(),
}));

vi.mock('@line-crm/db', () => db);
vi.mock('../services/friend-add-routing.js', () => routing);

const { friendAddRouting } = await import('./friend-add-routing.js');

const app = new Hono<Env>();
app.use('*', async (c, next) => {
  c.set('staff', {
    id: 'staff-1', name: '担当者', role: 'admin', readOnly: false,
    tenantId: 'tenant-1', permissionKeys: ['/friend-add-settings'],
  });
  await next();
});
app.route('/', friendAddRouting);

function makeEnv(friend: Record<string, unknown> | null = null) {
  const bind = vi.fn(() => ({
    all: vi.fn().mockResolvedValue({ results: [{ id: 'tag-1', name: '来店済み' }] }),
    first: vi.fn().mockResolvedValue(friend),
  }));
  const prepare = vi.fn(() => ({ bind }));
  return {
    env: { DB: { prepare } as unknown as D1Database } as Env['Bindings'],
    prepare,
    bind,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.getLineAccounts.mockResolvedValue([
    { id: 'account-1', tenant_id: 'tenant-1' },
    { id: 'account-2', tenant_id: 'tenant-2' },
  ]);
  db.getStaffById.mockResolvedValue({ account_scope: 'all' });
  db.getStaffAccountScopeIds.mockResolvedValue([]);
  routing.loadFriendAddRouting.mockResolvedValue(null);
  routing.listFriendAddScenarios.mockResolvedValue([]);
  routing.normalizeRouting.mockReturnValue(FRIEND_ADD_ROUTING_DEFAULT);
});

describe('friend-add-routing account scope', () => {
  test('別統括の設定は取得できない', async () => {
    const { env } = makeEnv();
    const response = await app.request('/api/friend-add-routing?account_id=account-2', {}, env);

    expect(response.status).toBe(404);
    expect(routing.loadFriendAddRouting).not.toHaveBeenCalled();
  });

  test('別統括の設定は保存できない', async () => {
    const { env } = makeEnv();
    const response = await app.request(
      '/api/friend-add-routing?account_id=account-2',
      { method: 'PUT', body: JSON.stringify({ routing: FRIEND_ADD_ROUTING_DEFAULT }) },
      env,
    );

    expect(response.status).toBe(404);
    expect(routing.saveFriendAddRouting).not.toHaveBeenCalled();
  });

  test('テスト対象の友だちは選択中アカウントで絞る', async () => {
    const { env, prepare, bind } = makeEnv(null);
    const response = await app.request(
      '/api/friend-add-routing/test?account_id=account-1',
      { method: 'POST', body: JSON.stringify({ friendId: 'other-friend' }) },
      env,
    );

    expect(response.status).toBe(404);
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining('line_account_id = ?'));
    expect(bind).toHaveBeenCalledWith('other-friend', 'account-1');
    expect(routing.previewFriendAddRouting).not.toHaveBeenCalled();
  });

  test('選択中アカウントの候補だけを返すSQLを使う', async () => {
    const { env, prepare, bind } = makeEnv();
    const response = await app.request('/api/friend-add-routing?account_id=account-1', {}, env);

    expect(response.status).toBe(200);
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining('WHERE line_account_id = ?'));
    expect(bind).toHaveBeenCalledWith('account-1');
    const body = await response.json() as { data: { tags: Array<{ id: string }> } };
    expect(body.data.tags).toEqual([{ id: 'tag-1', name: '来店済み' }]);
  });
});
