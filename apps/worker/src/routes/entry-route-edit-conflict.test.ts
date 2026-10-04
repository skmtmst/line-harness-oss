/*
 * 流入リンクの同時編集も「最後に直した日時で比べる」（v8f と同じ形）。
 * PATCH /api/entry-routes/:id は読んだときの更新日時 expectedUpdatedAt を
 * 任意で受ける。違えば409と今の中身を返し、同じなら保存、
 * 送らなければ今までどおり保存する。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const mocks = {
  getEntryRouteById: vi.fn(),
  updateEntryRoute: vi.fn(),
};
vi.mock('@line-crm/db', () => mocks);

const { entryRoutes } = await import('./entry-routes.js');

const SAVED_AT = '2026-10-02T14:02:00.000+09:00';
const ROW = {
  id: 'route-a',
  tenant_id: 'tenant-a',
  line_account_id: null,
  ref_code: 'pop',
  genre: 'SNS',
  name: '秋の店頭POP',
  tag_id: null,
  scenario_id: null,
  redirect_url: null,
  pool_id: null,
  intro_template_id: null,
  run_account_friend_add_scenarios: 1,
  is_active: 1,
  stopped_at: null,
  stopped_reason: null,
  created_at: '2026-10-01T00:00:00.000+09:00',
  updated_at: SAVED_AT,
};

function patch(body: unknown) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'owner-1', name: 'Owner', role: 'owner', readOnly: false, tenantId: 'tenant-a' });
    return next();
  });
  app.route('/', entryRoutes);
  return app.fetch(new Request('https://example.com/api/entry-routes/route-a', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }), { DB: {} as D1Database });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getEntryRouteById.mockResolvedValue(ROW);
  mocks.updateEntryRoute.mockImplementation(async (_db: unknown, _id: string, body: Record<string, unknown>) => ({
    ...ROW, ...body, updated_at: '2026-10-02T15:00:00.000+09:00',
  }));
});

describe('流入リンクの同時編集は更新日時で見分ける', () => {
  it('違えば409で今の中身を返し、書き換えない', async () => {
    const res = await patch({ name: '別名', expectedUpdatedAt: '2000-01-01T00:00:00.000+09:00' });
    expect(res.status).toBe(409);
    const json = await res.json() as Record<string, unknown>;
    expect(json.code).toBe('VERSION_CONFLICT');
    const latest = (json.data as { latest: { name: string; updatedAt: string } }).latest;
    expect(latest.name).toBe('秋の店頭POP');
    expect(latest.updatedAt).toBe(SAVED_AT);
    expect(mocks.updateEntryRoute).not.toHaveBeenCalled();
  });

  it('同じなら保存する', async () => {
    const res = await patch({ name: '秋の店頭POP（10月）', expectedUpdatedAt: SAVED_AT });
    expect(res.status).toBe(200);
    expect(mocks.updateEntryRoute).toHaveBeenCalledTimes(1);
  });

  it('送らなければ今までどおり保存する', async () => {
    const res = await patch({ name: '送らず保存' });
    expect(res.status).toBe(200);
    expect(mocks.updateEntryRoute).toHaveBeenCalledTimes(1);
  });
});
