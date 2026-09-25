import type { TenantRuntimeStatus } from '@line-crm/db';

/** True only for a tenant that is explicitly stopped in D1. */
export function isStoppedTenantStatus(
  status: TenantRuntimeStatus | null | undefined,
): status is 'suspended' | 'archived' {
  return status === 'suspended' || status === 'archived';
}

/**
 * SQL predicate for rows that belong to an explicitly stopped tenant.
 *
 * Missing legacy account rows are not labelled as suspended here. Dispatch
 * selection still fails closed through activeTenantLineAccountSql; this helper
 * is only for terminally consuming work that must not resume after restoration.
 */
export function stoppedTenantLineAccountSql(accountIdExpression: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(accountIdExpression)) {
    throw new Error('Invalid line account SQL expression');
  }
  return `EXISTS (
    SELECT 1
      FROM line_accounts tenant_gate_account
      INNER JOIN tenants tenant_gate_tenant
        ON tenant_gate_tenant.id = tenant_gate_account.tenant_id
     WHERE tenant_gate_account.id = ${accountIdExpression}
       AND tenant_gate_tenant.status IN ('suspended', 'archived')
  )`;
}
