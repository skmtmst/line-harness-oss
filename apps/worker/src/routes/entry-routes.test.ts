import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const mocks = {
  getEntryRoutes: vi.fn(),
  getEntryRouteById: vi.fn(),
  createEntryRoute: vi.fn(),
  updateEntryRoute: vi.fn(),
  deleteEntryRoute: vi.fn(),
  getEntryRouteFunnel: vi.fn(),
  getEntryRouteGenres: vi.fn(),
  createEntryRouteGenre: vi.fn(),
};
vi.mock('@line-crm/db', () => mocks);

const { entryRoutes } = await import('./entry-routes.js');
const app = new Hono();
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

beforeEach(() => vi.clearAllMocks());

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
      genre: 'A店', name: 'Instagram', refCode: 'ashop-instagram',
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
});
