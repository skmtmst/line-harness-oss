import { Hono } from 'hono';
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

/** Read-only migration diagnostics. This route never returns LINE credentials. */
export const tenants = new Hono<Env>();

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
