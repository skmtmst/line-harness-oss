import type { TenantRuntimeStatus } from '@line-crm/db';

/** D1 で明示的に停止した統括だけを停止と判定する。 */
export function isStoppedTenantStatus(
  status: TenantRuntimeStatus | null | undefined,
): status is 'suspended' | 'archived' {
  return status === 'suspended' || status === 'archived';
}

/** 所属先のない保存済み行を停止と誤分類しない。この条件は復旧後も再開しない処理の終端化だけに使い、配信選択は別の有効統括条件で安全側に守る。 */
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
