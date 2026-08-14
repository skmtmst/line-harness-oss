import { Hono } from 'hono';
import {
  getEntryRoutes,
  getEntryRouteById,
  createEntryRoute,
  updateEntryRoute,
  deleteEntryRoute,
  getEntryRouteFunnel,
} from '@line-crm/db';
import type { EntryRoute } from '@line-crm/db';
import type { Env } from '../index.js';

const entryRoutes = new Hono<Env>();

function serialize(row: EntryRoute) {
  return {
    id: row.id,
    refCode: row.ref_code,
    genre: row.genre,
    name: row.name,
    tagId: row.tag_id,
    scenarioId: row.scenario_id,
    redirectUrl: row.redirect_url,
    poolId: row.pool_id,
    introTemplateId: row.intro_template_id,
    runAccountFriendAddScenarios: row.run_account_friend_add_scenarios === 1,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// GET /api/entry-routes — list all
entryRoutes.get('/api/entry-routes', async (c) => {
  try {
    const rows = await getEntryRoutes(c.env.DB);
    return c.json({ success: true, data: rows.map(serialize) });
  } catch (err) {
    console.error('GET /api/entry-routes error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/entry-routes/:id — single
entryRoutes.get('/api/entry-routes/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const row = await getEntryRouteById(c.env.DB, id);
    if (!row) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: serialize(row) });
  } catch (err) {
    console.error('GET /api/entry-routes/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/entry-routes — create
entryRoutes.post('/api/entry-routes', async (c) => {
  try {
    const body = await c.req.json<{
      refCode: string;
      genre?: string | null;
      name: string;
      tagId?: string | null;
      scenarioId?: string | null;
      redirectUrl?: string | null;
      poolId?: string | null;
      introTemplateId?: string | null;
      runAccountFriendAddScenarios?: boolean;
      isActive?: boolean;
    }>();
    const refCode = body.refCode?.trim();
    const name = body.name?.trim();
    const genre = body.genre?.trim() || null;
    if (!refCode || !name) {
      return c.json({ success: false, error: '名前と ref_code は必須です' }, 400);
    }
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(refCode)) {
      return c.json({ success: false, error: 'ref_code は64文字以内の半角英数字・_・-で入力してください' }, 400);
    }
    if ((genre?.length ?? 0) > 80 || name.length > 120) {
      return c.json({ success: false, error: 'ジャンルは80文字、名前は120文字以内で入力してください' }, 400);
    }
    const row = await createEntryRoute(c.env.DB, { ...body, refCode, name, genre });
    return c.json({ success: true, data: serialize(row) }, 201);
  } catch (err) {
    console.error('POST /api/entry-routes error:', err);
    if (String(err).includes('UNIQUE constraint failed: entry_routes.ref_code')) {
      return c.json({ success: false, error: 'この ref_code は既に使われています' }, 409);
    }
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PATCH /api/entry-routes/:id — update
entryRoutes.patch('/api/entry-routes/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json<
      Partial<{
        refCode: string;
        genre: string | null;
        name: string;
        tagId: string | null;
        scenarioId: string | null;
        redirectUrl: string | null;
        poolId: string | null;
        introTemplateId: string | null;
        runAccountFriendAddScenarios: boolean;
        isActive: boolean;
      }>
    >();
    if (body.refCode !== undefined && !/^[A-Za-z0-9_-]{1,64}$/.test(body.refCode.trim())) {
      return c.json({ success: false, error: 'ref_code は64文字以内の半角英数字・_・-で入力してください' }, 400);
    }
    if (body.genre !== undefined && body.genre !== null && (!body.genre.trim() || body.genre.trim().length > 80)) {
      return c.json({ success: false, error: 'ジャンルは1〜80文字で入力してください' }, 400);
    }
    if (body.name !== undefined && (!body.name.trim() || body.name.trim().length > 120)) {
      return c.json({ success: false, error: '名前は1〜120文字で入力してください' }, 400);
    }
    if (body.refCode !== undefined) body.refCode = body.refCode.trim();
    if (typeof body.genre === 'string') body.genre = body.genre.trim();
    if (body.name !== undefined) body.name = body.name.trim();
    const row = await updateEntryRoute(c.env.DB, id, body);
    if (!row) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: serialize(row) });
  } catch (err) {
    console.error('PATCH /api/entry-routes/:id error:', err);
    if (String(err).includes('UNIQUE constraint failed: entry_routes.ref_code')) {
      return c.json({ success: false, error: 'この ref_code は既に使われています' }, 409);
    }
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/entry-routes/:id
entryRoutes.delete('/api/entry-routes/:id', async (c) => {
  try {
    const id = c.req.param('id');
    await deleteEntryRoute(c.env.DB, id);
    return c.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/entry-routes/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/entry-routes/:id/funnel
entryRoutes.get('/api/entry-routes/:id/funnel', async (c) => {
  try {
    const id = c.req.param('id');
    const route = await getEntryRouteById(c.env.DB, id);
    if (!route) return c.json({ success: false, error: 'Not found' }, 404);
    const funnel = await getEntryRouteFunnel(c.env.DB, id);
    return c.json({ success: true, data: funnel });
  } catch (err) {
    console.error('GET /api/entry-routes/:id/funnel error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { entryRoutes };
