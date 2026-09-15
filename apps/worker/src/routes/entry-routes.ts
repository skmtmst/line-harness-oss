import { Hono, type MiddlewareHandler } from 'hono';
import {
  getEntryRoutes,
  getEntryRouteById,
  createEntryRoute,
  updateEntryRoute,
  deleteEntryRoute,
  getEntryRouteFunnel,
  getEntryRouteSources,
  getEntryRouteGenres,
  createEntryRouteGenre,
  updateEntryRouteGenre,
} from '@line-crm/db';
import type { EntryRoute, EntryRouteGenre } from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { DEFAULT_TENANT_ID } from '../lib/tenant.js';
import { resolveRequestBoundary } from '../services/request-boundary.js';

const entryRoutes = new Hono<Env>();
const INFLOW_LINKS_PERMISSION = '/inflow-links';

/**
 * 流入経路の運用は、役割ではなく画面権限にも委譲する。
 * 完全削除は不可逆なので、この門番を使わず従来どおり owner/admin に限定する。
 */
function requireEntryRouteManagement(): MiddlewareHandler<Env> {
  return async (c, next) => {
    const staff = c.get('staff');
    const allowed = staff && (
      staff.role === 'owner'
      || staff.role === 'admin'
      || (staff.role === 'staff' && staff.permissionKeys?.includes(INFLOW_LINKS_PERMISSION))
    );
    if (!allowed) {
      return c.json({ success: false, error: 'この機能を操作する権限がありません' }, 403);
    }
    return next();
  };
}

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

function serializeGenre(row: EntryRouteGenre) {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function canAccessEntryRoute(row: EntryRoute, tenantId: string): boolean {
  return row.tenant_id === tenantId || (row.tenant_id === null && tenantId === DEFAULT_TENANT_ID);
}

async function canAccessEntryRouteAccount(
  db: D1Database,
  staff: NonNullable<Env['Variables']['staff']>,
  row: EntryRoute,
): Promise<boolean> {
  // migration 308 より前の未割当行は従来どおりtenant境界で扱う。
  // 所有accountがある行は、同じtenantのowner/adminでも担当外なら変更させない。
  const accountId = row.line_account_id ?? null;
  if (accountId === null) return true;
  return (await resolveRequestBoundary(db, staff, accountId)).allowed;
}

entryRoutes.get('/api/entry-route-genres', async (c) => {
  try {
    const rows = await getEntryRouteGenres(c.env.DB);
    return c.json({ success: true, data: rows.map(serializeGenre) });
  } catch (err) {
    console.error('GET /api/entry-route-genres error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

entryRoutes.post('/api/entry-route-genres', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{ name?: string }>();
    const name = body.name?.trim();
    if (!name || name.length > 80) {
      return c.json({ success: false, error: 'ジャンル名は1〜80文字で入力してください' }, 400);
    }
    const row = await createEntryRouteGenre(c.env.DB, name);
    return c.json({ success: true, data: serializeGenre(row) }, 201);
  } catch (err) {
    console.error('POST /api/entry-route-genres error:', err);
    if (String(err).includes('UNIQUE constraint failed: entry_route_genres.name')) {
      return c.json({ success: false, error: '同じ名前のジャンルが既にあります' }, 409);
    }
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

entryRoutes.patch('/api/entry-route-genres/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json<{ name?: string }>();
    const name = body.name?.trim();
    if (!name || name.length > 80) {
      return c.json({ success: false, error: 'ジャンル名は1〜80文字で入力してください' }, 400);
    }
    const row = await updateEntryRouteGenre(c.env.DB, id, name);
    if (!row) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: serializeGenre(row) });
  } catch (err) {
    console.error('PATCH /api/entry-route-genres/:id error:', err);
    if (String(err).includes('UNIQUE constraint failed: entry_route_genres.name')) {
      return c.json({ success: false, error: '同じ名前のジャンルが既にあります' }, 409);
    }
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/entry-routes — list all
entryRoutes.get('/api/entry-routes', async (c) => {
  try {
    const staff = c.get('staff');
    const tenantId = staff.tenantId ?? DEFAULT_TENANT_ID;
    // N-011: 選択accountをAPIへ渡し、DBの行と共通境界で照合する。
    // 範囲外の指定は「ない」ものとして404にする。
    const requested = (c.req.query('account_id') ?? '').trim();
    const decision = await resolveRequestBoundary(c.env.DB, staff, requested || undefined);
    if (!decision.allowed) return c.json({ success: false, error: 'Not found' }, 404);
    const scope = decision.scope;
    const rows = await getEntryRoutes(c.env.DB, tenantId);
    const visible = rows.filter((row) => {
      const accountId = (row as { line_account_id?: string | null }).line_account_id ?? null;
      if (requested) return accountId === requested;
      return accountId == null ? scope.canSeeUnassigned : scope.allowedAccountIds.includes(accountId);
    });
    return c.json({ success: true, data: visible.map(serialize) });
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
    const tenantId = c.get('staff').tenantId ?? DEFAULT_TENANT_ID;
    if (!row || !canAccessEntryRoute(row, tenantId)) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: serialize(row) });
  } catch (err) {
    console.error('GET /api/entry-routes/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/entry-routes — create
entryRoutes.post('/api/entry-routes', requireEntryRouteManagement(), async (c) => {
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
    const tenantId = c.get('staff').tenantId ?? DEFAULT_TENANT_ID;
    const row = await createEntryRoute(c.env.DB, { ...body, refCode, name, genre, tenantId });
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
entryRoutes.patch('/api/entry-routes/:id', requireEntryRouteManagement(), async (c) => {
  try {
    const id = c.req.param('id');
    const tenantId = c.get('staff').tenantId ?? DEFAULT_TENANT_ID;
    const existing = await getEntryRouteById(c.env.DB, id);
    if (!existing || !canAccessEntryRoute(existing, tenantId)) return c.json({ success: false, error: 'Not found' }, 404);
    if (!await canAccessEntryRouteAccount(c.env.DB, c.get('staff'), existing)) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
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
    if (body.refCode !== undefined && body.refCode.trim() !== existing.ref_code) {
      return c.json({ success: false, error: 'ref_code は作成後に変更できません' }, 400);
    }
    if (body.genre !== undefined && body.genre !== null && (!body.genre.trim() || body.genre.trim().length > 80)) {
      return c.json({ success: false, error: 'ジャンルは1〜80文字で入力してください' }, 400);
    }
    if (body.name !== undefined && (!body.name.trim() || body.name.trim().length > 120)) {
      return c.json({ success: false, error: '名前は1〜120文字で入力してください' }, 400);
    }
    delete body.refCode;
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
entryRoutes.delete('/api/entry-routes/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id');
    const tenantId = c.get('staff').tenantId ?? DEFAULT_TENANT_ID;
    const existing = await getEntryRouteById(c.env.DB, id);
    if (!existing || !canAccessEntryRoute(existing, tenantId)) return c.json({ success: false, error: 'Not found' }, 404);
    if (!await canAccessEntryRouteAccount(c.env.DB, c.get('staff'), existing)) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const body: { confirmationName?: unknown } = await c.req
      .json<{ confirmationName?: unknown }>()
      .catch(() => ({}));
    if (typeof body.confirmationName !== 'string' || body.confirmationName !== existing.name) {
      return c.json({
        success: false,
        error: '完全削除する経路名を正確に入力してください。',
        code: 'ENTRY_ROUTE_NAME_CONFIRMATION_MISMATCH',
      }, 422);
    }
    const result = await deleteEntryRoute(c.env.DB, id, body.confirmationName);
    if (result === 'not_found') return c.json({ success: false, error: 'Not found' }, 404);
    if (result === 'name_mismatch') {
      return c.json({
        success: false,
        error: '経路名が変更されています。画面を読み直してから、もう一度確認してください。',
        code: 'ENTRY_ROUTE_NAME_CONFIRMATION_MISMATCH',
      }, 422);
    }
    if (result === 'in_use') {
      return c.json({
        success: false,
        error: '利用履歴がある経路は完全削除できません。受付停止を選んでください。',
        code: 'ENTRY_ROUTE_IN_USE',
      }, 409);
    }
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
    const tenantId = c.get('staff').tenantId ?? DEFAULT_TENANT_ID;
    if (!route || !canAccessEntryRoute(route, tenantId)) return c.json({ success: false, error: 'Not found' }, 404);
    const funnel = await getEntryRouteFunnel(c.env.DB, id);
    return c.json({ success: true, data: funnel });
  } catch (err) {
    console.error('GET /api/entry-routes/:id/funnel error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/entry-routes/:id/sources
// そのリンクのクリックが「どこから来ているか」。utm_source > 参照元URLの
// ホスト名 > 「直接アクセス」の順で寄せる。
entryRoutes.get('/api/entry-routes/:id/sources', async (c) => {
  try {
    const id = c.req.param('id');
    const route = await getEntryRouteById(c.env.DB, id);
    const tenantId = c.get('staff').tenantId ?? DEFAULT_TENANT_ID;
    if (!route || !canAccessEntryRoute(route, tenantId)) return c.json({ success: false, error: 'Not found' }, 404);
    const sources = await getEntryRouteSources(c.env.DB, id);
    return c.json({ success: true, data: sources });
  } catch (err) {
    console.error('GET /api/entry-routes/:id/sources error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { entryRoutes };
