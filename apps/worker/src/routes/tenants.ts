import { Hono, type Context } from 'hono';
import type { Env } from '../index.js';
import { DEFAULT_TENANT_ID } from '../lib/tenant.js';
import { requireRole } from '../middleware/role-guard.js';
import { dbFor } from '../services/db-router.js';
import { getVisibleLineAccountScope } from '../services/account-access.js';

type BoundaryAccount = {
  id: string;
  name: string;
  tenant_id: string | null;
};

type FeaturePack = 'restaurant';
type TenantStatus = 'active' | 'suspended' | 'archived';

type TenantRow = {
  id: string;
  name: string;
  status: string;
  feature_packs: string;
  created_at: string;
  updated_at: string;
};

const ALLOWED_FEATURE_PACKS = new Set<FeaturePack>(['restaurant']);
const ALLOWED_TENANT_STATUSES = new Set<TenantStatus>(['active', 'suspended', 'archived']);

function parseFeaturePacks(value: unknown): FeaturePack[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  if (!value.every((pack): pack is FeaturePack => (
    typeof pack === 'string' && ALLOWED_FEATURE_PACKS.has(pack as FeaturePack)
  ))) return null;
  return [...new Set(value)];
}

/**
 * Cross-tenant operations deliberately use a route-local gate. Query scoping
 * cannot protect these endpoints because they are intended to manage tenants.
 */
function canManageTenants(c: Context<Env>): boolean {
  const staff = c.get('staff');
  return staff?.role === 'owner'
    && !staff.readOnly
    && (staff.tenantId ?? DEFAULT_TENANT_ID) === DEFAULT_TENANT_ID;
}

function forbidden(c: Context<Env>) {
  return c.json({ success: false, error: '統括を管理する権限がありません' }, 403);
}

/** Read-only migration diagnostics. This route never returns LINE credentials. */
export const tenants = new Hono<Env>();

tenants.post('/api/tenants', async (c) => {
  if (!canManageTenants(c)) return forbidden(c);

  const body = await c.req.json<{
    name?: unknown;
    prefecture?: unknown;
    representativeName?: unknown;
    featurePacks?: unknown;
  }>().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 100) {
    return c.json({ success: false, error: '統括名は1〜100文字で入力してください' }, 400);
  }
  // The current tenants schema has nowhere to persist these fields. Rejecting
  // them avoids pretending that supplied business data was saved.
  if (body?.prefecture !== undefined || body?.representativeName !== undefined) {
    return c.json({ success: false, error: '未対応の項目が含まれています' }, 400);
  }
  const featurePacks = parseFeaturePacks(body?.featurePacks);
  if (!featurePacks) {
    return c.json({ success: false, error: '利用できない機能パックが含まれています' }, 400);
  }

  const db = dbFor(c.env);
  const duplicate = await db.prepare('SELECT id FROM tenants WHERE name = ? LIMIT 1')
    .bind(name)
    .first<{ id: string }>();
  if (duplicate) return c.json({ success: false, error: '同じ名前の統括が存在します' }, 400);

  const tenantId = crypto.randomUUID();
  try {
    await db.batch([
      db.prepare(`INSERT INTO tenants (id, name, status, feature_packs)
        VALUES (?, ?, 'active', ?)`).bind(tenantId, name, JSON.stringify(featurePacks)),
    ]);
  } catch {
    return c.json({ success: false, error: '統括を作成できませんでした' }, 500);
  }

  return c.json({
    success: true,
    data: { id: tenantId, name, status: 'active', featurePacks },
  }, 201);
});

tenants.get('/api/tenants', async (c) => {
  if (!canManageTenants(c)) return forbidden(c);
  const includeArchived = c.req.query('include_archived') === '1';
  const query = `SELECT id, name, status, feature_packs, created_at, updated_at
    FROM tenants
    ${includeArchived ? '' : "WHERE status <> 'archived'"}
    ORDER BY created_at ASC, id ASC`;
  const result = await dbFor(c.env).prepare(query).all<TenantRow>();
  return c.json({
    success: true,
    data: result.results.map(({ feature_packs: packs, ...tenant }) => ({
      ...tenant,
      featurePacks: JSON.parse(packs) as FeaturePack[],
    })),
  });
});

tenants.patch('/api/tenants/:id/status', async (c) => {
  if (!canManageTenants(c)) return forbidden(c);
  const body = await c.req.json<{ status?: unknown }>().catch(() => null);
  const status = body?.status;
  if (typeof status !== 'string' || !ALLOWED_TENANT_STATUSES.has(status as TenantStatus)) {
    return c.json({ success: false, error: '利用できない状態です' }, 400);
  }

  // This only records the tenant state. Enforcing it for login and delivery is
  // a separate rollout; changing the state here does not delete child data.
  const result = await dbFor(c.env).prepare(`UPDATE tenants
    SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
    WHERE id = ?`)
    .bind(status, c.req.param('id'))
    .run();
  if (!result.meta.changes) return c.json({ success: false, error: 'tenant not found' }, 404);
  return c.json({ success: true, data: { status: status as TenantStatus } });
});

tenants.patch('/api/tenants/:id/feature-packs', async (c) => {
  if (!canManageTenants(c)) return forbidden(c);
  const body = await c.req.json<{ featurePacks?: unknown }>().catch(() => null);
  const featurePacks = parseFeaturePacks(body?.featurePacks);
  if (!featurePacks) {
    return c.json({ success: false, error: '利用できない機能パックが含まれています' }, 400);
  }
  const result = await dbFor(c.env).prepare(`UPDATE tenants
    SET feature_packs = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
    WHERE id = ?`)
    .bind(JSON.stringify(featurePacks), c.req.param('id'))
    .run();
  if (!result.meta.changes) return c.json({ success: false, error: 'tenant not found' }, 404);
  return c.json({ success: true, data: { featurePacks } });
});

/** 統括コンソールの見出しに使う名前だけを返す。 */
tenants.get('/api/tenants/me', async (c) => {
  const db = dbFor(c.env);
  const staffTenantId = c.get('staff')?.tenantId ?? DEFAULT_TENANT_ID;
  const tenant = await db.prepare(`SELECT name FROM tenants WHERE id = ?`)
    .bind(staffTenantId)
    .first<{ name: string }>();
  if (!tenant) return c.json({ success: false, error: 'tenant not found' }, 404);
  return c.json({ success: true, data: { name: tenant.name } });
});

/** 認証スタッフ自身が所属する統括の表示名だけを更新する。 */
tenants.patch('/api/tenants/me', requireRole('owner', 'admin'), async (c) => {
  const body = await c.req.json<{ name?: unknown }>().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) return c.json({ success: false, error: '統括名を入力してください' }, 400);
  if (name.length > 100) return c.json({ success: false, error: '統括名は100文字以内で入力してください' }, 400);

  const db = dbFor(c.env);
  const staffTenantId = c.get('staff')?.tenantId ?? DEFAULT_TENANT_ID;
  const result = await db.prepare(`UPDATE tenants
    SET name = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
    WHERE id = ?`)
    .bind(name, staffTenantId)
    .run();
  if (!result.meta.changes) return c.json({ success: false, error: 'tenant not found' }, 404);
  return c.json({ success: true, data: { name } });
});

tenants.get('/api/tenants/boundary-preview', requireRole('owner', 'admin'), async (c) => {
  const db = dbFor(c.env);
  const staffTenantId = c.get('staff')?.tenantId ?? DEFAULT_TENANT_ID;
  const [scope, accounts, staffWithoutTenant] = await Promise.all([
    getVisibleLineAccountScope(db, c.get('staff')),
    db.prepare(`SELECT id, name, tenant_id
      FROM line_accounts
      ORDER BY display_order ASC, created_at ASC`).all<BoundaryAccount>(),
    db.prepare(`SELECT COUNT(*) AS count
      FROM staff_members
      WHERE tenant_id IS NULL`).first<{ count: number }>(),
  ]);
  const visibleAccountIds = new Set(scope.ids);
  const visibleNow = accounts.results.filter((account) => visibleAccountIds.has(account.id));
  const visibleIfEnforced = visibleNow.filter(
    (account) => (account.tenant_id ?? DEFAULT_TENANT_ID) === staffTenantId,
  );
  const wouldLose = visibleNow
    .filter((account) => (account.tenant_id ?? DEFAULT_TENANT_ID) !== staffTenantId)
    .map(({ id, name }) => ({ id, name }));

  return c.json({
    success: true,
    data: {
      staffTenantId,
      visibleNow: visibleNow.length,
      visibleIfEnforced: visibleIfEnforced.length,
      wouldLose,
      accountsWithoutTenant: accounts.results.filter((account) => account.tenant_id === null).length,
      staffWithoutTenant: staffWithoutTenant?.count ?? 0,
    },
  });
});
