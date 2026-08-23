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
    (account) => account.tenant_id === staffTenantId,
  );
  const wouldLose = visibleNow
    .filter((account) => account.tenant_id !== staffTenantId)
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
