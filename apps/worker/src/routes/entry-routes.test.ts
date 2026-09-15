import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const mocks = {
  getEntryRoutes: vi.fn(),
  // N-011: 一覧が共通境界へ委譲するため、範囲解決の口も用意する。
  getLineAccountScopeEntries: vi.fn(async () => []),
  getStaffById: vi.fn(async () => null),
  getStaffAccountScopeIds: vi.fn(async () => []),
  getEntryRouteById: vi.fn(),
  createEntryRoute: vi.fn(),
  updateEntryRoute: vi.fn(),
  deleteEntryRoute: vi.fn(),
  getEntryRouteFunnel: vi.fn(),
  getEntryRouteSources: vi.fn(),
  getEntryRouteGenres: vi.fn(),
  createEntryRouteGenre: vi.fn(),
  updateEntryRouteGenre: vi.fn(),
};
vi.mock('@line-crm/db', () => mocks);

const { entryRoutes } = await import('./entry-routes.js');
const app = new Hono<Env>();
// 更新系はオーナー／管理者限定になった。ここで見たいのは本体の挙動なので、
// 認証は通った状態にしてから渡す。権限の検証は role-guard.test.ts が持つ。
app.use('*', async (c, next) => {
  c.set('staff', { id: 'owner-1', name: 'Owner', role: 'owner', readOnly: false, tenantId: 'tenant-a' });
  return next();
});
app.route('/', entryRoutes);
const env = { DB: {} as D1Database };

function post(body: unknown) {
  return app.fetch(new Request('https://example.com/api/entry-routes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }), env);
}

function postGenre(body: unknown) {
  return app.fetch(new Request('https://example.com/api/entry-route-genres', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }), env);
}

function patchGenre(id: string, body: unknown) {
  return app.fetch(new Request(`https://example.com/api/entry-route-genres/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }), env);
}

beforeEach(() => vi.clearAllMocks());

function deleteRoute(id: string, confirmationName?: string) {
  return app.fetch(new Request(`https://example.com/api/entry-routes/${id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: confirmationName === undefined ? undefined : JSON.stringify({ confirmationName }),
  }), env);
}

describe('POST /api/entry-routes', () => {
  it('creates a named link inside a genre', async () => {
    mocks.createEntryRoute.mockResolvedValue({
      id: 'route-1', ref_code: 'ashop-instagram', genre: 'A店', name: 'Instagram',
      tag_id: null, scenario_id: null, redirect_url: null, pool_id: null,
      intro_template_id: null, run_account_friend_add_scenarios: 1, is_active: 1,
      created_at: '2026-08-14', updated_at: '2026-08-14',
    });
    const response = await post({ genre: ' A店 ', name: ' Instagram ', refCode: 'ashop-instagram' });
    expect(response.status).toBe(201);
    const body = await response.json() as { data: { genre: string; name: string } };
    expect(body.data).toMatchObject({ genre: 'A店', name: 'Instagram' });
    expect(mocks.createEntryRoute).toHaveBeenCalledWith(env.DB, expect.objectContaining({
      genre: 'A店', name: 'Instagram', refCode: 'ashop-instagram', tenantId: 'tenant-a',
    }));
  });

  it('keeps legacy genre-less API calls compatible and rejects unsafe ref codes', async () => {
    mocks.createEntryRoute.mockResolvedValue({
      id: 'route-legacy', ref_code: 'instagram', genre: null, name: 'Instagram',
      tag_id: null, scenario_id: null, redirect_url: null, pool_id: null,
      intro_template_id: null, run_account_friend_add_scenarios: 1, is_active: 1,
      created_at: '2026-08-14', updated_at: '2026-08-14',
    });
    expect((await post({ name: 'Instagram', refCode: 'instagram' })).status).toBe(201);
    expect((await post({ genre: 'A店', name: 'Instagram', refCode: 'bad code' })).status).toBe(400);
    expect(mocks.createEntryRoute).toHaveBeenCalledTimes(1);
  });

  it('returns a useful conflict for duplicate ref codes', async () => {
    mocks.createEntryRoute.mockRejectedValue(new Error('UNIQUE constraint failed: entry_routes.ref_code'));
    const response = await post({ genre: 'A店', name: 'Instagram', refCode: 'duplicate' });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'この ref_code は既に使われています' });
  });
});

describe('entry route tenant scope', () => {
  const otherRoute = {
    id: 'route-b', ref_code: 'b-ref', genre: null, name: 'B', tag_id: null,
    scenario_id: null, redirect_url: 'https://before.example', pool_id: null,
    intro_template_id: null, run_account_friend_add_scenarios: 1, is_active: 1,
    tenant_id: 'tenant-b', created_at: '2026-08-14', updated_at: '2026-08-14',
  };

  it('passes the current tenant to the list query', async () => {
    mocks.getEntryRoutes.mockResolvedValue([]);
    const response = await app.fetch(new Request('https://example.com/api/entry-routes'), env);
    expect(response.status).toBe(200);
    expect(mocks.getEntryRoutes).toHaveBeenCalledWith(env.DB, 'tenant-a');
  });

  it('returns 404 without patching another tenant route', async () => {
    mocks.getEntryRouteById.mockResolvedValue(otherRoute);
    const response = await app.fetch(new Request('https://example.com/api/entry-routes/route-b', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirectUrl: 'https://after.example' }),
    }), env);
    expect(response.status).toBe(404);
    expect(mocks.updateEntryRoute).not.toHaveBeenCalled();
  });

  it('rejects changing ref_code after creation', async () => {
    mocks.getEntryRouteById.mockResolvedValue({ ...otherRoute, tenant_id: 'tenant-a' });
    const response = await app.fetch(new Request('https://example.com/api/entry-routes/route-b', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refCode: 'changed-ref' }),
    }), env);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'ref_code は作成後に変更できません' });
    expect(mocks.updateEntryRoute).not.toHaveBeenCalled();
  });

  it('returns 404 without deleting another tenant route', async () => {
    mocks.getEntryRouteById.mockResolvedValue(otherRoute);
    const response = await app.fetch(new Request('https://example.com/api/entry-routes/route-b', {
      method: 'DELETE',
    }), env);
    expect(response.status).toBe(404);
    expect(mocks.deleteEntryRoute).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/entry-routes/:id safety', () => {
  const ownRoute = {
    id: 'route-a', ref_code: 'a-ref', genre: null, name: '店頭QR', tag_id: null,
    scenario_id: null, redirect_url: null, pool_id: null, intro_template_id: null,
    run_account_friend_add_scenarios: 1, is_active: 1, tenant_id: 'tenant-a',
    line_account_id: 'account-a', created_at: '2026-09-16', updated_at: '2026-09-16',
  };

  beforeEach(() => {
    mocks.getEntryRouteById.mockResolvedValue(ownRoute);
    mocks.getLineAccountScopeEntries.mockResolvedValue([
      { id: 'account-a', tenant_id: 'tenant-a' },
    ] as never);
  });

  it('経路名の欠落・不一致は422で、DB削除を呼ばない', async () => {
    expect((await deleteRoute(ownRoute.id)).status).toBe(422);
    const mismatch = await deleteRoute(ownRoute.id, '店頭ＱＲ');
    expect(mismatch.status).toBe(422);
    expect(await mismatch.json()).toMatchObject({
      code: 'ENTRY_ROUTE_NAME_CONFIRMATION_MISMATCH',
    });
    expect(mocks.deleteEntryRoute).not.toHaveBeenCalled();
  });

  it('不正JSONも422へ倒し、DB削除を呼ばない', async () => {
    const response = await app.fetch(new Request(`https://example.com/api/entry-routes/${ownRoute.id}`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: '{',
    }), env);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      code: 'ENTRY_ROUTE_NAME_CONFIRMATION_MISMATCH',
    });
    expect(mocks.deleteEntryRoute).not.toHaveBeenCalled();
  });

  it('利用履歴ありは409で、停止を案内して経路を残す', async () => {
    mocks.deleteEntryRoute.mockResolvedValue('in_use');
    const response = await deleteRoute(ownRoute.id, ownRoute.name);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: 'ENTRY_ROUTE_IN_USE',
      error: expect.stringContaining('受付停止'),
    });
    expect(mocks.deleteEntryRoute).toHaveBeenCalledWith(env.DB, ownRoute.id, ownRoute.name);
  });

  it('未利用かつ現在名が完全一致した場合だけ200にする', async () => {
    mocks.deleteEntryRoute.mockResolvedValue('deleted');
    const response = await deleteRoute(ownRoute.id, ownRoute.name);
    expect(response.status).toBe(200);
  });

  it('別accountの実在経路は404で、削除を呼ばない', async () => {
    mocks.getEntryRouteById.mockResolvedValue({ ...ownRoute, line_account_id: 'account-b' });
    const response = await deleteRoute(ownRoute.id, ownRoute.name);
    expect(response.status).toBe(404);
    expect(mocks.deleteEntryRoute).not.toHaveBeenCalled();
  });

  it('別accountの経路は受付停止への更新も0件にする', async () => {
    mocks.getEntryRouteById.mockResolvedValue({ ...ownRoute, line_account_id: 'account-b' });
    const response = await app.fetch(new Request(`https://example.com/api/entry-routes/${ownRoute.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: false }),
    }), env);
    expect(response.status).toBe(404);
    expect(mocks.updateEntryRoute).not.toHaveBeenCalled();
  });

  it('staff権限は実在経路を読まず、書き込み0件にする', async () => {
    const staffApp = new Hono<Env>();
    staffApp.use('*', async (c, next) => {
      c.set('staff', { id: 'staff-1', name: 'Staff', role: 'staff', readOnly: false, tenantId: 'tenant-a' });
      return next();
    });
    staffApp.route('/', entryRoutes);
    const response = await staffApp.fetch(new Request(`https://example.com/api/entry-routes/${ownRoute.id}`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmationName: ownRoute.name }),
    }), env);
    expect(response.status).toBe(403);
    expect(mocks.getEntryRouteById).not.toHaveBeenCalled();
    expect(mocks.deleteEntryRoute).not.toHaveBeenCalled();
  });
});

describe('entry route genre API', () => {
  it('lists independent genres, including genres with no links', async () => {
    mocks.getEntryRouteGenres.mockResolvedValue([
      { id: 'genre-1', name: 'A店', created_at: '2026-08-14', updated_at: '2026-08-14' },
    ]);
    const response = await app.fetch(new Request('https://example.com/api/entry-route-genres'), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: [{ id: 'genre-1', name: 'A店' }] });
  });

  it('creates a trimmed genre', async () => {
    mocks.createEntryRouteGenre.mockResolvedValue({
      id: 'genre-1', name: 'A店', created_at: '2026-08-14', updated_at: '2026-08-14',
    });
    const response = await postGenre({ name: ' A店 ' });
    expect(response.status).toBe(201);
    expect(mocks.createEntryRouteGenre).toHaveBeenCalledWith(env.DB, 'A店');
  });

  it('renames a genre and returns the updated value', async () => {
    mocks.updateEntryRouteGenre.mockResolvedValue({
      id: 'genre-1', name: 'A店 SNS', created_at: '2026-08-14', updated_at: '2026-08-14',
    });
    const response = await patchGenre('genre-1', { name: ' A店 SNS ' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { id: 'genre-1', name: 'A店 SNS' } });
    expect(mocks.updateEntryRouteGenre).toHaveBeenCalledWith(env.DB, 'genre-1', 'A店 SNS');
  });
});
